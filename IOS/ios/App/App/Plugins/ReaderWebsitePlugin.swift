import UIKit
import WebKit
import Capacitor

@objc(ReaderWebsitePlugin)
public class ReaderWebsitePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ReaderWebsitePlugin"
    public let jsName = "ReaderWebsite"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "verify", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resolveDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelResolveDownload", returnType: CAPPluginReturnPromise)
    ]
    private var active: SourceWebsiteController?
    private var downloadSessions: [String: ZLibraryDownloadResolver] = [:]
    private var cancelledDownloadRequestIds = Set<String>()

    @objc func verify(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              url.host != nil, url.user == nil, url.password == nil else {
            call.reject("无效的站点验证地址"); return
        }
        DispatchQueue.main.async {
            guard self.active == nil, let host = self.bridge?.viewController,
                  host.presentedViewController == nil else { call.reject("请先关闭当前弹窗"); return }
            let screen = SourceWebsiteController(url: url, userAgent: call.getString("userAgent"), extractPage: call.getBool("extractPage") ?? false) { [weak self] result in
                self?.active = nil
                call.resolve(result)
            }
            self.active = screen
            let navigation = UINavigationController(rootViewController: screen)
            navigation.modalPresentationStyle = .fullScreen
            host.present(navigation, animated: true)
        }
    }

    @objc func resolveDownload(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId"), !requestId.isEmpty,
              let entryRaw = call.getString("entryUrl"), let entryURL = Self.webURL(entryRaw),
              let downloadRaw = call.getString("downloadUrl"), let downloadURL = Self.webURL(downloadRaw) else {
            call.resolve(["url": NSNull(), "cookies": NSNull()])
            return
        }

        DispatchQueue.main.async {
            guard self.cancelledDownloadRequestIds.remove(requestId) == nil,
                  self.downloadSessions[requestId] == nil else {
                call.resolve(["url": NSNull(), "cookies": NSNull()])
                return
            }
            let resolver = ZLibraryDownloadResolver(entryURL: entryURL, downloadURL: downloadURL,
                cookies: call.getString("cookies")) { [weak self] url, cookies in
                    self?.downloadSessions.removeValue(forKey: requestId)
                    if let url = url, let cookies = cookies {
                        call.resolve(["url": url, "cookies": cookies])
                    } else {
                        call.resolve(["url": NSNull(), "cookies": NSNull()])
                    }
                }
            self.downloadSessions[requestId] = resolver
            resolver.start()
        }
    }

    @objc func cancelResolveDownload(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId"), !requestId.isEmpty else {
            call.resolve()
            return
        }
        DispatchQueue.main.async {
            self.cancelledDownloadRequestIds.insert(requestId)
            self.downloadSessions.removeValue(forKey: requestId)?.cancel()
            // A cancel can reach native before its paired start call. Expire its tombstone
            // if that start never arrives, while still closing the bridge-ordering race.
            DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(30)) { [weak self] in
                self?.cancelledDownloadRequestIds.remove(requestId)
            }
            call.resolve()
        }
    }

    private static func webURL(_ raw: String) -> URL? {
        guard let url = URL(string: raw),
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }
}

/** Hidden WKWebView equivalent of Android's bounded Z-Library download handoff. */
private final class ZLibraryDownloadResolver: NSObject, WKNavigationDelegate {
    private let entryURL: URL
    private let downloadURL: URL
    private let initialCookies: String?
    private let complete: (String?, String?) -> Void
    private let websiteDataStore = WKWebsiteDataStore.default()
    private var webView: WKWebView?
    private var timeout: DispatchWorkItem?
    private var openedDownload = false
    private var capturedDownload = false
    private var finished = false

    init(entryURL: URL, downloadURL: URL, cookies: String?, complete: @escaping (String?, String?) -> Void) {
        self.entryURL = entryURL
        self.downloadURL = downloadURL
        self.initialCookies = cookies
        self.complete = complete
        super.init()
    }

    func start() {
        let timeout = DispatchWorkItem { [weak self] in self?.finish(url: nil, cookies: nil) }
        self.timeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)

        let cookieStore = websiteDataStore.httpCookieStore
        let group = DispatchGroup()
        for cookie in parseCookies(initialCookies, for: entryURL) {
            group.enter()
            cookieStore.setCookie(cookie) { group.leave() }
        }
        group.notify(queue: .main) { [weak self] in self?.loadEntry() }
    }

    func cancel() {
        finish(url: nil, cookies: nil)
    }

    private func loadEntry() {
        guard !finished else { return }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = websiteDataStore
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.customUserAgent = "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        webView.navigationDelegate = self
        self.webView = webView
        webView.load(URLRequest(url: entryURL))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !finished, !openedDownload else { return }
        openedDownload = true
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(800)) { [weak self, weak webView] in
            guard let self = self, !self.finished, let webView = webView else { return }
            webView.load(URLRequest(url: self.downloadURL))
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard openedDownload, navigationResponse.response.url != nil else {
            decisionHandler(.allow)
            return
        }
        if let http = navigationResponse.response as? HTTPURLResponse, (300...399).contains(http.statusCode) {
            decisionHandler(.allow)
            return
        }
        let disposition = (navigationResponse.response as? HTTPURLResponse)?
            .value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
        if !navigationResponse.canShowMIMEType || disposition.contains("attachment") {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.cancel { _ in }
        captureDownload(at: navigationResponse.response.url)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.cancel { _ in }
        captureDownload(at: navigationAction.request.url)
    }

    private func captureDownload(at url: URL?) {
        guard !finished, !capturedDownload, let url = url,
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { return }
        capturedDownload = true
        websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            DispatchQueue.main.async {
                guard let self = self, !self.finished else { return }
                let host = self.entryURL.host?.lowercased() ?? ""
                let isSecureRequest = self.entryURL.scheme?.lowercased() == "https"
                let selected = cookies.filter { cookie in
                    let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
                    let matchesDomain = host == domain || host.hasSuffix("." + domain)
                    let matchesRootPath = cookie.path == "/"
                    return matchesDomain && matchesRootPath && (!cookie.isSecure || isSecureRequest)
                }
                let cookieHeader = selected.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
                self.finish(url: url.absoluteString, cookies: cookieHeader)
            }
        }
    }

    private func parseCookies(_ raw: String?, for url: URL) -> [HTTPCookie] {
        guard let raw = raw, let host = url.host else { return [] }
        let secure = url.scheme?.lowercased() == "https"
        return raw.split(separator: ";").compactMap { part in
            let pair = part.trimmingCharacters(in: .whitespacesAndNewlines)
                .split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard pair.count == 2 else { return nil }
            let name = pair[0].trimmingCharacters(in: .whitespacesAndNewlines)
            let value = pair[1].trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { return nil }
            var properties: [HTTPCookiePropertyKey: Any] = [
                .domain: host, .path: "/", .name: name, .value: value
            ]
            if secure { properties[.secure] = "TRUE" }
            return HTTPCookie(properties: properties)
        }
    }

    private func finish(url: String?, cookies: String?) {
        guard !finished else { return }
        finished = true
        timeout?.cancel()
        timeout = nil
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView = nil
        complete(url, cookies)
    }
}

private final class SourceWebsiteController: UIViewController, WKNavigationDelegate {
    private let url: URL
    private let userAgent: String?
    private let extractPage: Bool
    private let complete: ([String: Any]) -> Void
    private var finished = false
    private var checking = false
    private var web: WKWebView!

    init(url: URL, userAgent: String?, extractPage: Bool, complete: @escaping ([String: Any]) -> Void) {
        self.url = url; self.userAgent = userAgent; self.extractPage = extractPage; self.complete = complete
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "站点验证"
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "取消", style: .plain, target: self, action: #selector(cancel))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "完成验证", style: .done, target: self, action: #selector(confirm))
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        web = WKWebView(frame: .zero, configuration: configuration)
        web.customUserAgent = userAgent
        web.navigationDelegate = self
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor), web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor)])
        // Seed URLSession cookies for login continuity in both directions.
        let cookies = HTTPCookieStorage.shared.cookies(for: url) ?? []
        let group = DispatchGroup()
        for cookie in cookies { group.enter(); configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { group.leave() } }
        group.notify(queue: .main) { self.web.load(URLRequest(url: self.url)) }
    }
    @objc private func cancel() { finish(["verified": false, "cookies": []]) }
    @objc private func confirm() {
        guard !checking else { return }
        checking = true
        web.evaluateJavaScript("({text: document.title + '\\n' + (document.body?.innerText || '').slice(0,4000), html: document.documentElement.outerHTML.slice(0,2097152)})") { [weak self] value, error in
            guard let self = self else { return }
            self.checking = false
            guard error == nil, let page = value as? [String: Any] else { return }
            let text = (page["text"] as? String ?? "").lowercased()
            if text.contains("just a moment") || text.contains("checking your browser") || text.contains("performing security verification") {
                let alert = UIAlertController(title: "验证尚未完成", message: "请在页面中完成验证后再点击完成。", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "继续验证", style: .default))
                self.present(alert, animated: true); return
            }
            self.web.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                let host = self.url.host?.lowercased() ?? ""
                let selected = cookies.filter { cookie in
                    let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
                    return host == domain || host.hasSuffix("." + domain)
                }
                for cookie in selected { HTTPCookieStorage.shared.setCookie(cookie) }
                let records: [[String: Any]] = selected.map { cookie in
                    var record: [String: Any] = ["domain": cookie.domain, "name": cookie.name, "value": cookie.value,
                        "path": cookie.path, "secure": cookie.isSecure]
                    if let date = cookie.expiresDate { record["expires"] = date.timeIntervalSince1970 * 1000 }
                    return record
                }
                DispatchQueue.main.async {
                    var result: [String: Any] = ["verified": true, "cookies": records]
                    if self.extractPage { result["html"] = page["html"]; result["url"] = self.web.url?.absoluteString }
                    self.finish(result)
                }
            }
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard extractPage, !finished else { return }
        webView.evaluateJavaScript("!!document.querySelector('z-bookcard, .book-item, .bookRow, #searchResultBox')") { [weak self] value, _ in
            guard let self = self, value as? Bool == true else { return }
            self.confirm()
        }
    }
    private func finish(_ result: [String: Any]) {
        guard !finished else { return }
        finished = true
        dismiss(animated: true) { self.complete(result) }
    }
}
