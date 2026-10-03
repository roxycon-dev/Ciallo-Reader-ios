import Foundation
import JavaScriptCore
import CryptoKit

// MARK: - JS 源引擎（source/js/JsSourceEngine.kt + JsMessageHandler.kt 对应物）
// 引擎从 QuickJS 换成系统 JavaScriptCore；消息桥协议（http/convert/cookie/storage/ui/async）
// 与 Venera 运行时对齐。源脚本实例只创建一次、init() 一次，后续调用复用同一实例。
// 执行预算：JSC 无 native interrupt，超时保护靠请求层 35s + 取消传播。

final class JsSourceEngine {
    let sourceId: String
    private let queue: DispatchQueue
    private var context: JSContext?
    private var instance: JSValue?
    private(set) var sourceName = ""
    private(set) var sourceVersion = "1.0.0"

    init(sourceId: String) {
        self.sourceId = sourceId
        self.queue = DispatchQueue(label: "js.engine.\(sourceId)")
    }

    // MARK: Bootstrap

    func bootstrap(script: String) throws {
        var bootError: Error?
        queue.sync {
            do {
                let ctx = JSContext()!
                ctx.name = sourceId
                context = ctx
                installBridge(into: ctx)
                ctx.evaluateScript(JsRuntimePrelude.consolePrelude)
                // Venera 官方运行时（与安卓 assets/venera/_venera_.js 同源，sync_js_assets.sh 放入）：
                // 存在则优先加载并跳过内置精简桥，避免两套全局互相覆盖。
                if let runtime = Self.loadBundleScript("venera_runtime.js") {
                    ctx.evaluateScript(runtime)
                    SourceLog.log(sourceId, "使用内置 Venera 官方运行时")
                } else {
                    ctx.evaluateScript(JsRuntimePrelude.prelude)
                    SourceLog.log(sourceId, "使用内置精简 Venera 桥（运行 sync_js_assets.sh 可换官方运行时）")
                }
                if let meta = Self.loadBundleScript("comic_metadata.js") {
                    ctx.evaluateScript(meta)
                }
                ctx.evaluateScript(script)
                // 找 ComicSource 子类
                var className = Self.classNameByRegex(script)
                if className.isEmpty {
                    className = ctx.evaluateScript(Self.classScanJs)?.toString() ?? ""
                }
                guard !className.isEmpty else {
                    throw SourceException.parseError("JS 书源未找到 ComicSource 类")
                }
                ctx.evaluateScript("globalThis.__veneraSrc = new \(className)();")
                // search.loadNext 适配（与安卓一致）
                ctx.evaluateScript("""
                (() => {
                    const s = globalThis.__veneraSrc.search || {};
                    if (typeof s.load !== 'function' && typeof s.loadNext === 'function') {
                        s.load = (keyword, options, page) => s.loadNext(keyword, options, page);
                    }
                })();
                """)
                instance = ctx.objectForKeyedSubscript("__veneraSrc")
                sourceName = instance?.objectForKeyedSubscript("name")?.toString() ?? sourceId
                if let v = instance?.objectForKeyedSubscript("version")?.toString(), !v.isEmpty, v != "undefined" {
                    sourceVersion = v
                }
                // init(configuration)：配置为源 ID 存储的 JSON
                let configJson = JsSourceStorage(sourceId: sourceId).configuration ?? "{}"
                if let initFn = instance?.objectForKeyedSubscript("init"), !initFn.isUndefined {
                    _ = callSync(initFn, args: [ctx.evaluateScript("(\(configJson))")])
                }
            } catch {
                bootError = error
            }
        }
        if let bootError { throw bootError }
    }

    static func loadBundleScript(_ name: String) -> String? {
        guard let url = Bundle.main.url(forResource: (name as NSString).deletingPathExtension,
                                        withExtension: (name as NSString).pathExtension,
                                        subdirectory: nil) else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    static func classNameByRegex(_ script: String) -> String {
        guard let match = script.range(of: "class\\s+([A-Za-z_$][\\w$]*)\\s+extends\\s+ComicSource",
                                       options: .regularExpression) else { return "" }
        let m = String(script[match])
        return m.replacingOccurrences(of: "class", with: "")
            .replacingOccurrences(of: "extends", with: "")
            .replacingOccurrences(of: "ComicSource", with: "")
            .trimmingCharacters(in: .whitespaces)
    }

    private static let classScanJs = """
    (() => {
        const names = Object.getOwnPropertyNames(globalThis);
        const found = names.filter(n => {
            try { return typeof globalThis[n] === 'function' && globalThis[n].prototype instanceof ComicSource; }
            catch (e) { return false; }
        });
        return found[0] || '';
    })()
    """

    // MARK: 桥接

    private func installBridge(into ctx: JSContext) {
        let engine = self
        // __nativeLog(text)（console 由 prelude 聚合变参后调用）
        ctx.setObject({ text in
            SourceLog.log(engine.sourceId, text?.toString() ?? "")
        } as @convention(block) (JSValue) -> Void, forKeyedSubscript: "__nativeLog")

        // __nativeRequest(config, resolve, reject)
        ctx.setObject({ config, resolve, reject in
            engine.nativeRequest(config: config, resolve: resolve, reject: reject)
        } as @convention(block) (JSValue, JSValue, JSValue) -> Void, forKeyedSubscript: "__nativeRequest")

        // __nativeConvert(type, value, arg) -> string
        ctx.setObject({ type, value, arg in
            return JsConvert.convert(type: type?.toString() ?? "", value: value?.toString() ?? "", arg: arg?.toString())
        } as @convention(block) (JSValue, JSValue, JSValue) -> String, forKeyedSubscript: "__nativeConvert")

        // __nativeStorageGet(key, resolve)
        ctx.setObject({ key, resolve in
            let storage = JsSourceStorage(sourceId: engine.sourceId)
            let value = storage.get(key?.toString() ?? "")
            resolve.call(withArguments: [value as Any])
        } as @convention(block) (JSValue, JSValue) -> Void, forKeyedSubscript: "__nativeStorageGet")

        // __nativeStorageSet(key, value, resolve)
        ctx.setObject({ key, value, resolve in
            let storage = JsSourceStorage(sourceId: engine.sourceId)
            storage.set(key?.toString() ?? "", value?.toString() ?? "{}")
            resolve.call(withArguments: [])
        } as @convention(block) (JSValue, JSValue, JSValue) -> Void, forKeyedSubscript: "__nativeStorageSet")

        // __nativeInputDialog(prompt, resolve)
        ctx.setObject({ prompt, resolve in
            Task { @MainActor in
                let text = await JsUiInput.requestInput(prompt: prompt?.toString() ?? "")
                resolve.call(withArguments: [text as Any])
            }
        } as @convention(block) (JSValue, JSValue) -> Void, forKeyedSubscript: "__nativeInputDialog")

        // __nativeHtmlParse(html, baseUrl) -> JSON tree
        ctx.setObject({ html, baseUrl in
            return JsHtmlBridge.parse(html?.toString() ?? "", baseUrl: baseUrl?.toString())
        } as @convention(block) (JSValue, JSValue) -> String, forKeyedSubscript: "__nativeHtmlParse")
    }

    private func nativeRequest(config: JSValue?, resolve: JSValue, reject: JSValue) {
        guard let ctx = context else { return }
        let configJson = toJsonString(config)
        let req = JsNetworkRequest(json: configJson)
        let engine = self
        Task {
            do {
                let response = try await JsNetwork.send(req)
                engine.queue.async {
                    let json = JsNetwork.serialize(response)
                    let value = ctx.evaluateScript("(\(json))")
                    resolve.call(withArguments: [value as Any])
                }
            } catch {
                engine.queue.async {
                    reject.call(withArguments: [error.localizedDescription])
                }
            }
        }
    }

    private func toJsonString(_ value: JSValue?) -> String {
        guard let value else { return "{}" }
        if value.isString { return value.toString() }
        let stringify = context?.objectForKeyedSubscript("JSON")?.objectForKeyedSubscript("stringify")
        return stringify?.call(withArguments: [value])?.toString() ?? "{}"
    }

    // MARK: 方法调用

    enum JsCallError: Error { case engineNotReady(String), methodMissing(String), script(String) }

    /// 调用实例方法路径并返回 JSON 对象（结果统一 JSON.stringify 后回传）
    func call(path: [String], args: [Any]) async throws -> Any? {
        try await withCheckedThrowingContinuation { cont in
            queue.async {
                guard let ctx = self.context, let instance = self.instance else {
                    cont.resume(throwing: JsCallError.engineNotReady("JS 引擎未就绪"))
                    return
                }
                var target: JSValue? = instance
                for key in path.dropLast() {
                    target = target?.objectForKeyedSubscript(key)
                }
                guard let fn = target?.objectForKeyedSubscript(path.last ?? "") else {
                    cont.resume(throwing: JsCallError.methodMissing(path.joined(separator: ".")))
                    return
                }
                if fn.isUndefined {
                    cont.resume(throwing: JsCallError.methodMissing(path.joined(separator: ".")))
                    return
                }
                let jsArgs = args.map { Self.toJsValue($0, ctx: ctx) }
                var result: JSValue?
                result = fn.call(withArguments: jsArgs)
                guard let result else {
                    cont.resume(throwing: JsCallError.script("调用返回空"))
                    return
                }
                // Promise 处理：等待 resolve 后 stringify
                if result.isObject, let then = result.objectForKeyedSubscript("then"), !then.isUndefined {
                    let stringify = ctx.objectForKeyedSubscript("JSON")?.objectForKeyedSubscript("stringify")
                    then.call(withArguments: [
                        { v in
                            let s = stringify?.call(withArguments: [v as Any])?.toString() ?? "{}"
                            cont.resume(returning: JsonPathResolver.parseJson(s))
                        } as @convention(block) (JSValue) -> Void,
                        { e in
                            cont.resume(throwing: JsCallError.script("JS 错误：\(e?.toString() ?? "unknown")"))
                        } as @convention(block) (JSValue) -> Void,
                    ])
                    return
                }
                if result.isNull || result.isUndefined {
                    cont.resume(returning: nil)
                    return
                }
                let s = self.toJsonString(result)
                cont.resume(returning: JsonPathResolver.parseJson(s))
            }
        }
    }

    /// 执行预算说明：QuickJS 侧为 AST guard 注入；JSC 侧改为请求层 35s 超时 + Task 取消传播。
    private func callSync(_ fn: JSValue, args: [JSValue]) -> JSValue? {
        fn.call(withArguments: args)
    }

    static func toJsValue(_ value: Any, ctx: JSContext) -> JSValue {
        switch value {
        case let s as String: return JSValue(string: s, in: ctx) ?? JSValue(nullIn: ctx)
        case let n as Int: return JSValue(int32: Int32(n), in: ctx) ?? JSValue(nullIn: ctx)
        case let d as Double: return JSValue(double: d, in: ctx) ?? JSValue(nullIn: ctx)
        case let b as Bool: return JSValue(bool: b, in: ctx) ?? JSValue(nullIn: ctx)
        default:
            let s = value is NSNull ? "{}" : SourceImporter.serialize(value)
            return ctx.evaluateScript("(\(s))") ?? JSValue(nullIn: ctx)
        }
    }

    var settingsDefaults: [String: Any] {
        var result: [String: Any] = [:]
        queue.sync {
            guard let ctx = context else { return }
            let raw = ctx.evaluateScript("JSON.stringify(globalThis.__veneraSrc?.settings || {})")
            if let parsed = JsonPathResolver.parseJson(raw?.toString() ?? "") as? [String: Any] {
                result = parsed
            }
        }
        return result
    }
}

// MARK: 源级存储（load_data/save_data）

final class JsSourceStorage {
    let sourceId: String
    private let prefs = Preferences.shared

    init(sourceId: String) {
        self.sourceId = sourceId
    }

    private func key(_ k: String) -> String { "js_storage_\(sourceId)_\(k)" }

    func get(_ key: String) -> String? { prefs.string(for: self.key(key)) }

    func set(_ key: String, _ value: String) { prefs.setString(value, for: self.key(key)) }

    var configuration: String? {
        let defaultsKey = "js_storage_\(sourceId)___config"
        return prefs.string(for: defaultsKey) ?? "{}"
    }

    func updateConfiguration(_ json: String) {
        prefs.setString(json, for: "js_storage_\(sourceId)___config")
    }
}

// MARK: 网络请求模型 + 发送（Network.sendRequest）

struct JsNetworkRequest {
    var url: String
    var method: String = "GET"
    var headers: [String: String] = [:]
    var body: Data? = nil
    var followRedirect: Bool = true
    var bytes: Int64 = 1024 * 1024 * 10

    init(json: String) {
        guard let obj = JsonPathResolver.parseJson(json) as? [String: Any] else { return }
        url = obj["url"] as? String ?? ""
        method = (obj["method"] as? String ?? "GET").uppercased()
        if let h = obj["headers"] as? [String: String] { headers = h }
        if let d = obj["data"] as? String { body = Data(d.utf8) }
        else if let d = obj["data"] as? [String: Any] {
            let form = d.map { "\($0.key)=\(($0.value as? String)?.urlEncode() ?? String(describing: $0.value))" }.joined(separator: "&")
            body = Data(form.utf8)
            if headers["Content-Type"] == nil { headers["Content-Type"] = "application/x-www-form-urlencoded" }
        }
        followRedirect = obj["followRedirect"] as? Bool ?? true
        if let b = obj["bytes"] as? Int { bytes = Int64(b) }
    }
}

enum JsNetwork {
    struct Response {
        var status: Int
        var body: String
        var headers: [String: String]
        var finalUrl: String

        static func serialize(_ r: Response) -> String {
            let headersJson = r.headers.map { quote($0.key) + ": " + quote($0.value) }.joined(separator: ",")
            return "{"
                + quote("status") + ": \(r.status), "
                + quote("body") + ": " + quote(r.body) + ", "
                + quote("headers") + ": {" + headersJson + "}, "
                + quote("finalUrl") + ": " + quote(r.finalUrl)
                + "}"
        }

        private static func quote(_ s: String) -> String {
            "\"" + escapeJson(s) + "\""
        }

        private static func escapeJson(_ s: String) -> String {
            s.replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
                .replacingOccurrences(of: "\n", with: "\\n")
                .replacingOccurrences(of: "\r", with: "")
                .replacingOccurrences(of: "\t", with: "\\t")
        }
    }

    static func send(_ req: JsNetworkRequest) async throws -> Response {
        let resp = try await Http.send(Http.Request(
            url: req.url, method: req.method, headers: req.headers,
            body: req.body, timeout: 35, followRedirects: req.followRedirect))
        var headers: [String: String] = [:]
        for (k, v) in resp.headers {
            if let key = k as? String, let value = v as? String { headers[key] = value }
        }
        return Response(status: resp.status, body: resp.text, headers: headers,
                        finalUrl: resp.url?.absoluteString ?? req.url)
    }
}

// MARK: convert（utf8/gbk/base64/md5/sha...）

enum JsConvert {
    static func convert(type: String, value: String, arg: String?) -> String {
        switch type.lowercased() {
        case "utf8", "utf-8": return value
        case "base64encode", "base64_encode": return Base64Util.encode(value)
        case "base64decode", "base64_decode":
            guard let data = Data(base64Encoded: value) ?? Data(base64Encoded: value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")) else { return "" }
            return String(decoding: data, as: UTF8.self)
        case "md5": return Hex.md5(value)
        case "sha1": return Hex.sha1(Data(value.utf8))
        case "sha256": return Hex.sha256(Data(value.utf8))
        case "sha512":
            return SHA512.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
        case "gbkencode", "gbk_encode":
            let cfEnc = CFStringEncodings.GBK_95
            let nsEnc = CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(cfEnc.rawValue))
            guard let data = value.data(using: String.Encoding(rawValue: nsEnc)) else { return value }
            return String(decoding: data, as: UTF8.self) // 字节以 latin1 呈现
        case "gbkdecode", "gbk_decode":
            let bytes = Array(value.utf8)
            let cfEnc = CFStringEncodings.GBK_95
            let nsEnc = CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(cfEnc.rawValue))
            return String(data: Data(bytes), encoding: String.Encoding(rawValue: nsEnc)) ?? value
        case "hexdecode", "hex_decode":
            let chars = Array(value)
            var bytes: [UInt8] = []
            var i = 0
            while i + 1 < chars.count {
                if let b = UInt8(String(chars[i]...chars[i + 1]), radix: 16) { bytes.append(b) }
                i += 2
            }
            return String(decoding: Data(bytes), as: UTF8.self)
        case "urldecode": return value.removingPercentEncoding ?? value
        case "urlencode": return value.urlEncode()
        default:
            SourceLog.log("convert", "不支持的转换类型：\(type)")
            return value
        }
    }
}

// MARK: JS UI 输入（JsUiDialogs）

@MainActor
enum JsUiInput {
    static var pendingContinuations: [String: CheckedContinuation<String, Never>] = [:]

    static func requestInput(prompt: String) async -> String {
        // iOS 无 Android 式同步弹窗；返回空串（源进入默认值分支）
        return ""
    }
}

// MARK: JS HTML DOM 桥（JsHtmlStore 对应物：JSON 元素树）

enum JsHtmlBridge {
    static func parse(_ html: String, baseUrl: String?) -> String {
        guard let doc = try? SwiftSoup.parse(html, baseUrl ?? "https://localhost") else { return "null" }
        guard let body = try? doc.body() else { return "null" }
        let node = elementJson(body)
        return node
    }

    private static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: "\t", with: "\\t")
    }

    private static func elementJson(_ el: Element) -> String {
        let tag = el.tagName()
        let attrs = el.getAttributes()?.array() ?? []
        let attrJson = attrs.compactMap { attr -> String? in
            "\"\(escape(attr.getKey()))\": \"\(escape(attr.getValue()))\""
        }.joined(separator: ",")
        let text = (try? el.ownText()) ?? ""
        let children = (try? el.children())?.array() ?? []
        let childrenJson = children.map { elementJson($0) }.joined(separator: ",")
        let fullHtml = (try? el.html()) ?? ""
        return """
        {"tag":"\(escape(tag))","attributes":{\(attrJson)},"text":"\(escape(text))","innerHTML":"\(escape(fullHtml))","children":[\(childrenJson)]}
        """
    }
}

// MARK: - Venera 运行时预置（QuickJS 版 _venera_.js 的 JSC 对应物）

enum JsRuntimePrelude {
    /// console 聚合（始终注入：变参在 JS 侧 join 后过单参桥）
    static let consolePrelude = """
    'use strict';
    var console = {
        log: function () { __nativeLog(Array.prototype.slice.call(arguments).map(String).join(' ')); },
        warn: function () { __nativeLog('[warn] ' + Array.prototype.slice.call(arguments).map(String).join(' ')); },
        error: function () { __nativeLog('[error] ' + Array.prototype.slice.call(arguments).map(String).join(' ')); },
        info: function () { __nativeLog(Array.prototype.slice.call(arguments).map(String).join(' ')); },
    };
    """

    /// 精简 Venera 桥（未放官方运行时时的兜底）
    static let prelude = """
    'use strict';
    \(consolePrelude)
    class ComicSource {}
    var Network = {
        sendRequest: function (cfg) {
            if (typeof cfg === 'string') cfg = { url: cfg };
            return new Promise((resolve, reject) => __nativeRequest(cfg, resolve, reject));
        },
        asyncRequest: function (cfg) {
            if (typeof cfg === 'string') cfg = { url: cfg };
            return new Promise((resolve, reject) => __nativeRequest(cfg, resolve, reject));
        },
    };
    var Storage = {
        setData: function (k, v) { return new Promise((res) => __nativeStorageSet(k, typeof v === 'string' ? v : JSON.stringify(v), res)); },
        getData: function (k) { return new Promise((res) => __nativeStorageGet(k, (v) => { try { res(v ? JSON.parse(v) : null); } catch (e) { res(v); } })); },
        set: function (k, v) { return Storage.setData(k, v); },
        get: function (k) { return Storage.getData(k); },
    };
    var Message = {
        showMessage: function (t) { console.log('message: ' + t); },
        showMessageToast: function (t) { console.log('toast: ' + t); },
        showDialog: function (t) { return new Promise((res) => __nativeInputDialog(t, res)); },
    };
    var convert = {
        utf8Decode: function (v) { return v; },
        utf8Encode: function (v) { return v; },
        gbkEncode: function (v) { return __nativeConvert('gbkEncode', v); },
        gbkDecode: function (v) { return __nativeConvert('gbkDecode', v); },
        base64Encode: function (v) { return __nativeConvert('base64Encode', v); },
        base64Decode: function (v) { return __nativeConvert('base64Decode', v); },
        md5: function (v) { return __nativeConvert('md5', v); },
        sha1: function (v) { return __nativeConvert('sha1', v); },
        sha256: function (v) { return __nativeConvert('sha256', v); },
        rsaEncrypt: function (v, k) { return v; },
        aesEncrypt: function (v, k) { return v; },
    };
    var Image = { load: function (url) { return url; }, modifyImage: function (u) { return u; } };
    var Random = { nextInt: function (min, max) { return Math.floor(Math.random() * (max - min)) + min; } };
    var Html = {
        parseWithDOM: function (html, baseUrl) {
            const raw = __nativeHtmlParse(html, baseUrl);
            const root = JSON.parse(raw);
            return makeElement(root);
        },
    };
    function makeElement(node) {
        if (!node) return null;
        const el = {
            tag: node.tag,
            attributes: node.attributes || {},
            children: (node.children || []).map(makeElement),
            innerHTML: node.innerHTML,
            get text() {
                const self = node.text || '';
                return self + el.children.map(c => c.text).join('');
            },
            getAttribute(name) { return el.attributes[name] || null; },
            querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
            querySelectorAll(sel) { return matchSelector(el, sel, true); },
        };
        return el;
    }
    function matchSelector(el, selector, descendantsOnly) {
        const parts = String(selector).trim().split(/\\s+/);
        let out = [];
        function matches(e, s) {
            if (s.startsWith('.')) return (e.attributes.class || '').split(/\\s+/).includes(s.slice(1));
            if (s.startsWith('#')) return e.attributes.id === s.slice(1);
            if (s.startsWith('[') && s.endsWith(']')) {
                const inner = s.slice(1, -1);
                if (inner.includes('=')) {
                    const [k, v] = inner.split('=');
                    return e.attributes[k] === v.replace(/["']/g, '');
                }
                return e.attributes[inner] !== undefined;
            }
            const [tag, ...cls] = s.split('.');
            if (tag && e.tag !== tag.toLowerCase()) return false;
            return cls.every(c => (e.attributes.class || '').split(/\\s+/).includes(c));
        }
        function walk(e, rest, acc) {
            if (rest.length === 0) { acc.push(e); return; }
            const [head, ...tail] = rest;
            for (const c of e.children || []) {
                if (matches(c, head)) walk(c, tail, acc);
            }
        }
        const [head, ...tail] = parts;
        if (!descendantsOnly && el.tag) {
            if (matches(el, head)) walk(el, tail, out);
        } else {
            walk(el, [head, ...tail], out);
        }
        return out;
    }
    var UI = { showLoading: function () {}, hideLoading: function () {} };
    """
}
