// 对齐 novel-reader/app/src/main/java/com/example/source/BookSource.kt（41 行）

import Foundation

protocol BookSource: AnyObject {
    var id: String { get }
    var name: String { get }
    var capabilities: SourceCapabilities { get }
    /// Kotlin: `val requiresLogin: Boolean get() = capabilities.requiresLogin`（默认实现）
    var requiresLogin: Bool { get }

    func search(keyword: String) async -> SourceResult<[SearchBook]>
    func getDetail(bookId: String) async -> SourceResult<SearchBook>
    func getDownloadInfo(bookId: String) async -> SourceResult<DownloadInfo>
    func login(credential: LoginCredential) async -> SourceResult<Bool>
    func logout() async
    func isLoggedIn() async -> Bool

    /// Kotlin: `suspend fun getRegistrationUrl(): String? = null`。
    /// iOS 骨架为同步属性（LibraryScreen 登录面板读取），语义等价（源提供的注册页地址）。
    var registrationUrl: String? { get }

    /**
     * 返回书籍可用的下载格式列表。默认实现返回空列表（不支持多格式选择）。
     * 调用方可凭此展示"选择格式"弹窗；空列表表示直接走 [getDownloadInfo] 默认格式。
     */
    func getAvailableFormats(book: SearchBook) async -> SourceResult<[BookFormat]>

    /**
     * 按指定格式获取下载信息。默认实现忽略 [preferredFormat]，与单参数版本一致。
     */
    func getDownloadInfo(bookId: String, preferredFormat: String?) async -> SourceResult<DownloadInfo>

    func getAuthenticationState() async -> AuthenticationState
}

extension BookSource {
    var requiresLogin: Bool { capabilities.requiresLogin }

    // registrationUrl：Kotlin 默认 getRegistrationUrl() 返回 null；
    // Swift 协议要求属性，具体源按需返回（默认协议无法再给默认值，遵循方自行实现）。

    func getAvailableFormats(book: SearchBook) async -> SourceResult<[BookFormat]> {
        .success([])
    }

    func getDownloadInfo(bookId: String, preferredFormat: String?) async -> SourceResult<DownloadInfo> {
        await getDownloadInfo(bookId: bookId)
    }

    func getAuthenticationState() async -> AuthenticationState {
        if capabilities.downloadRequiresLogin {
            return await isLoggedIn() ? .authenticated : .required
        } else {
            return .notRequired
        }
    }
}
