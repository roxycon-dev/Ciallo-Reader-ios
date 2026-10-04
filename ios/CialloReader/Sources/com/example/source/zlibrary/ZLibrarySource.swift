import Foundation

// MARK: - Z-Library 书源（zlibrary/ZLibrarySource.kt 对应物）
// HTML 搜索（含三道假结果守卫）→ bookcard 解析；HTTP 失败 → eapi 兜底；
// 多格式（eapi formats）→ CDN 直链下载；DiamWall PoW 自动过。

final class ZLibrarySource: BookSource {
    var id: String { "zlibrary" }
    var name: String { "Z-Library" }
    var registrationUrl: String? { "https://z-library.sk/registration" }
    var capabilities: SourceCapabilities {
        SourceCapabilities(supportSearch: true, supportDownload: true,
                           searchRequiresLogin: false, downloadRequiresLogin: true,
                           supportEbook: true)
    }

    let cookieJar = EncryptedCookieJar(scope: "zlib")
    lazy var solver = DiamWallSolver(cookieJar: cookieJar)
    lazy var eapi = ZLEapiClient(cookieJar: cookieJar, solver: solver)
    let storage = ZLCredentialStorage()
    let provider = ZLEndpointProvider.shared

    // MARK: 搜索

    func search(keyword: String) async -> SourceResult<[SearchBook]> {
        do {
            let domain = await provider.resolveDomain()
            // 路径段必须用 %20 而非 +（多词搜索会失效）
            let encodedKw = keyword.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: " ")))?
                .replacingOccurrences(of: " ", with: "%20") ?? keyword
            let searchUrl = "https://\(domain)/s/\(encodedKw)"
            var response = try await withSearchGuard(searchUrl: searchUrl, domain: domain, referer: "https://\(domain)/")

            var html = response.text

            // 官网搜索故障：明确报错，绝不走 /fulltext/ 兜底（假结果）
            if html.range(of: "Search service temporary unavailable", options: .caseInsensitive) != nil {
                return .error(.networkError("Z-Library 搜索服务暂时不可用（官网故障），请稍后重试"))
            }

            // 守卫 #1：入口跳转域把 /s/{kw} 302 丢路径 → 最终 URL 不在 /s/ 即铁证，换真实镜像重试
            let finalPath = response.url?.path ?? "/"
            if response.status == 200 && !finalPath.hasPrefix("/s/") {
                let fallbackDomain = await provider.resolveDomain(forceScan: true)
                response = try await withSearchGuard(searchUrl: "https://\(fallbackDomain)/s/\(encodedKw)", domain: fallbackDomain, referer: "https://\(fallbackDomain)/")
                html = response.text
                let retryPath = response.url?.path ?? "/"
                if response.status == 200 && !retryPath.hasPrefix("/s/") {
                    return .error(.networkError("搜索被重定向（节点为入口跳转域，非真实镜像），请更换节点后重试"))
                }
            }

            if !(200..<300).contains(response.status) {
                // HTTP 层被挡 → eapi 兜底
                let eapiBooks = await eapi.search(keyword: keyword, domain: response.url?.host ?? domain)
                if !eapiBooks.isEmpty { return .success(eapiBooks) }
                return .error(.networkError("搜索请求失败 HTTP \(response.status)"))
            }

            let host = response.url?.host ?? domain
            var books = ZLParser.parseSearchPage(html, baseUrl: "https://\(host)")

            // 守卫 #2：大结果集 + 标题归一化零命中 + 页面无关键词 = 主页充数
            if books.count >= 15 && html.range(of: keyword, options: .caseInsensitive) == nil {
                func norm(_ s: String) -> String {
                    s.lowercased().replacingOccurrences(of: "[\\s\\p{Punct}]+", with: "", options: .regularExpression)
                }
                let want = norm(keyword)
                let anyTitleHit = !want.isEmpty && books.contains { b in
                    let n = norm(b.title)
                    return !n.isEmpty && (n.contains(want) || want.contains(n))
                }
                if !anyTitleHit {
                    let fallbackDomain = await provider.resolveDomain(forceScan: true)
                    let retry = try await withSearchGuard(searchUrl: "https://\(fallbackDomain)/s/\(encodedKw)", domain: fallbackDomain, referer: "https://\(fallbackDomain)/")
                    if retry.status == 200 && (retry.url?.path.hasPrefix("/s/") ?? false),
                       retry.text.range(of: keyword, options: .caseInsensitive) != nil {
                        books = ZLParser.parseSearchPage(retry.text, baseUrl: "https://\(retry.url?.host ?? fallbackDomain)")
                        if !books.isEmpty { return .success(books) }
                    }
                    return .error(.networkError("搜索结果与关键词无关（节点不可信），请稍后重试"))
                }
            }

            if books.isEmpty {
                let eapiBooks = await eapi.search(keyword: keyword, domain: host)
                if !eapiBooks.isEmpty { return .success(eapiBooks) }
            }
            return .success(books)
        } catch is CancellationError {
            return .error(.cancelled)
        } catch {
            return .error(.networkError(Http.describe(error)))
        }
    }

    private func withSearchGuard(searchUrl: String, domain: String, referer: String) async throws -> HttpResponse {
        try await solver.execute(Http.Request(url: searchUrl, headers: ["Referer": referer]
            .merging(cookieHeaderIfAny(domain: domain)) { _, new in new }), host: domain)
    }

    private func cookieHeaderIfAny(domain: String) -> [String: String] {
        let cookie = cookieJar.cookieHeader(for: domain)
        return cookie.isEmpty ? [:] : ["Cookie": cookie]
    }

    // MARK: 详情

    func getDetail(bookId: String) async -> SourceResult<SearchBook> {
        do {
            let domain = await provider.resolveDomain()
            // bookId 形如 "123456/abcdef"
            let url = "https://\(domain)/book/\(bookId)"
            let resp = try await solver.execute(Http.Request(url: url, headers: ["Referer": "https://\(domain)/"]
                .merging(cookieHeaderIfAny(domain: domain)) { _, n in n }), host: domain)
            if (200..<300).contains(resp.status), let parsed = ZLParser.parseDetailPage(resp.text, baseUrl: url) {
                return .success(parsed)
            }
            // eapi 兜底
            let parts = bookId.split(separator: "/")
            if parts.count == 2, let info = await eapi.getBookInfo(eapiId: String(parts[0]), eapiHash: String(parts[1]), domain: domain) {
                return .success(info)
            }
            return .error(.bookNotFound)
        } catch {
            return .error(.networkError(Http.describe(error)))
        }
    }

    // MARK: 格式 / 下载

    func getAvailableFormats(book: SearchBook) async -> SourceResult<[BookFormat]> {
        guard let eapiId = book.eapiId, let eapiHash = book.eapiHash else {
            // 无 eapi 变体：单格式
            return .success([BookFormat(format: book.format, downloadUrl: book.downloadUrl)])
        }
        let domain = await provider.resolveDomain()
        let formats = await eapi.getFormats(eapiId: eapiId, eapiHash: eapiHash, domain: domain)
        if formats.isEmpty {
            return .success([BookFormat(format: book.format, downloadUrl: book.downloadUrl)])
        }
        return .success(formats)
    }

    func getDownloadInfo(bookId: String) async -> SourceResult<DownloadInfo> {
        let detail = await getDetail(bookId: bookId)
        guard let book = detail.getOrNull() else {
            return .error(.bookNotFound)
        }
        return await getDownloadInfo(book: book)
    }

    func getDownloadInfo(book: SearchBook) async -> SourceResult<DownloadInfo> {
        let domain = await provider.resolveDomain()
        // 有 eapi 变体 → /file 直链（含每日额度提示）
        if let eapiId = book.eapiId, let eapiHash = book.eapiHash {
            let result = await eapi.getDownloadLinkResult(eapiId: eapiId, eapiHash: eapiHash, domain: domain)
            if let message = result.limitMessage {
                return .error(.networkError(message))
            }
            if let url = result.url {
                return .success(DownloadInfo(url: url,
                                             fileName: sanitize(book.title) + "." + book.format,
                                             format: book.format,
                                             headers: cookieHeaderIfAny(domain: domain),
                                             referer: "https://\(domain)/"))
            }
        }
        // 无 eapi → HTML /dl/ 直链
        if let dl = book.downloadUrl {
            return .success(DownloadInfo(url: dl, fileName: sanitize(book.title) + "." + book.format,
                                         format: book.format,
                                         headers: cookieHeaderIfAny(domain: domain),
                                         referer: "https://\(domain)/"))
        }
        // 未登录 → 要求登录
        if !storage.isLoggedIn() {
            return .error(.loginRequired)
        }
        return .error(.parseError("未能取得下载链接"))
    }

    // MARK: 登录（eapi）

    func login(credential: LoginCredential) async -> SourceResult<Bool> {
        let domain = await provider.resolveDomain()
        let ok = await eapi.login(email: credential.username, password: credential.password, domain: domain)
        return ok ? .success(true) : .error(.networkError("登录失败：请检查账号密码（或站点暂不可用）"))
    }

    func logout() async {
        storage.clear()
        let domain = await provider.resolveDomain()
        cookieJar.clear(host: domain)
    }

    func isLoggedIn() async -> Bool {
        let domain = await provider.resolveDomain()
        return storage.isLoggedIn() && cookieJar.isLoggedInCookie(host: domain)
    }

    func getAuthenticationState() async -> AuthenticationState {
        await isLoggedIn() ? .authenticated : .required
    }

    func dailyLimit() async -> (Int, Int)? {
        await eapi.dailyDownloadLimit(domain: await provider.resolveDomain())
    }

    private func sanitize(_ s: String) -> String {
        s.replacingOccurrences(of: "[\\\\/:*?\"<>|]", with: "_", options: .regularExpression)
    }
}
