import UIKit
import WebKit
import Capacitor

@objc(ReaderWebsitePlugin)
public class ReaderWebsitePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ReaderWebsitePlugin"
    public let jsName = "ReaderWebsite"
    public let pluginMethods = [CAPPluginMethod(name: "verify", returnType: CAPPluginReturnPromise)]
    private var active: SourceWebsiteController?

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
