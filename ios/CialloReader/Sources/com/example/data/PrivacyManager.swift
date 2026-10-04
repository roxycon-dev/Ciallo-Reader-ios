import Foundation
import CommonCrypto
import Security

// 对齐 novel-reader/app/src/main/java/com/example/data/PrivacyManager.kt（122 行）
/**
 * 隐私模式管理器（第七轮第 6.4 条）。
 *
 * - 全局 6 位数字 PIN：首次开启隐私模式时设置（输入 + 二次确认）；
 * - 存储做基本安全处理：随机盐 + PBKDF2（兼容旧 SHA-256 并在验证后升级），不落明文（补充说明第 3 条）；
 * - 开关状态持久化——重启 App 后受保护分类仍需 PIN 验证；
 * - 无痕浏览（6.5）语义由 MainViewModel 按"隐私模式开启 且 书籍所在分类受保护"
 *   判定，本类只提供开关与校验。
 */
@MainActor
final class PrivacyManager: ObservableObject {
    static let shared = PrivacyManager()

    /// iOS 侧 facade：UI（MainActivity/SettingsTabScreen）订阅这两个状态。
    @Published var lockRequired: Bool = false
    @Published var isEnabled: Bool = false

    /// SharedPreferences("privacy_prefs", MODE_PRIVATE)
    private let prefs = Preferences.shared

    private init() {
        isEnabled = isEnabledValue()
        lockRequired = isEnabled
    }

    private enum Keys {
        static let enabled = "privacy_mode_enabled"        // KEY_ENABLED
        static let pinHash = "privacy_pin_hash"            // KEY_PIN_HASH
        static let pinSalt = "privacy_pin_salt"            // KEY_PIN_SALT
    }
    private static let pinLengthValue = 6 // PIN_LENGTH

    static func pinLength() -> Int { pinLengthValue }

    /// SHA-256(盐 + PIN) 十六进制
    static func hashPin(_ pin: String, _ saltHex: String) -> String {
        var salt = Data()
        var idx = saltHex.startIndex
        while idx < saltHex.endIndex, saltHex.index(idx, offsetBy: 2, limitedBy: saltHex.endIndex) != nil {
            let next = saltHex.index(idx, offsetBy: 2)
            if let byte = UInt8(saltHex[idx..<next], radix: 16) { salt.append(byte) }
            idx = next
        }
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        var ctx = CC_SHA256_CTX()
        CC_SHA256_Init(&ctx)
        salt.withUnsafeBytes { raw in _ = CC_SHA256_Update(&ctx, raw.baseAddress, CC_LONG(salt.count)) }
        let pinBytes = Array(pin.utf8)
        pinBytes.withUnsafeBufferPointer { raw in
            _ = CC_SHA256_Update(&ctx, raw.baseAddress, CC_LONG(pinBytes.count))
        }
        CC_SHA256_Final(&digest, &ctx)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    static func newSaltHex() -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    /// 隐私模式是否开启
    func isEnabledValue() -> Bool { prefs.bool(for: Keys.enabled, default: false) }

    /// 是否已设置过 PIN（用于区分"首次开启"与"后续验证"）
    func hasPin() -> Bool { prefs.string(for: Keys.pinHash) != nil || UserDefaults.standard.object(forKey: Keys.pinHash) != nil }

    /**
     * 设置 PIN 并启用隐私模式（首次开启流程）。
     * @return false = PIN 格式非法（非 6 位数字）
     */
    func enableWithPin(_ pin: String) -> Bool {
        if !isValidPin(pin) { return false }
        let salt = Self.newSaltHex()
        prefs.setString(salt, for: Keys.pinSalt)
        prefs.setString(derivePin(pin, salt), for: Keys.pinHash)
        prefs.setInt(1, for: "pin_kdf_version")
        prefs.setBool(true, for: Keys.enabled)
        isEnabled = true
        lockRequired = false
        return true
    }

    /// iOS 侧 facade 兼容旧签名（SettingsTabScreen 使用）：enable(pin:) 抛错版。
    func enable(pin: String) throws {
        guard enableWithPin(pin) else {
            throw NSError(domain: "PrivacyManager", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "PIN 格式非法（需 6 位数字）"])
        }
    }

    /// 验证 PIN（常数时间比较防时序侧信道的基本形态）
    func verifyPin(_ pin: String) -> Bool {
        guard let salt = prefs.string(for: Keys.pinSalt),
              let stored = prefs.string(for: Keys.pinHash) else { return false }
        if !isValidPin(pin) || salt.count != 32 || salt.contains(where: { UInt8(String($0), radix: 16) == nil }) { return false }
        if Date().timeIntervalSince1970 * 1000 < Double(UserDefaults.standard.object(forKey: "pin_retry_after") as? Int64 ?? 0) { return false }
        let modern = (prefs.int(for: "pin_kdf_version") ?? 0) == 1
        let candidate = modern ? derivePin(pin, salt) : Self.hashPin(pin, salt)
        if candidate.count != stored.count { return false }
        var diff = 0
        let c = Array(candidate.utf16), s = Array(stored.utf16)
        for i in 0..<c.count { diff |= Int(c[i]) ^ Int(s[i]) }
        if diff != 0 {
            let failures = (prefs.int(for: "pin_failures") ?? 0) + 1
            prefs.setInt(failures, for: "pin_failures")
            UserDefaults.standard.set(failures >= 5 ? Int64(Date().timeIntervalSince1970 * 1000) + 30_000 : 0, forKey: "pin_retry_after")
            return false
        }
        prefs.setInt(0, for: "pin_failures")
        UserDefaults.standard.set(Int64(0), forKey: "pin_retry_after")
        if !modern {
            prefs.setString(derivePin(pin, salt), for: Keys.pinHash)
            prefs.setInt(1, for: "pin_kdf_version")
        }
        return true
    }

    /// iOS 侧 facade 兼容旧签名：verify(pin:) async。
    func verify(pin: String) async -> Bool {
        let result = await Task.detached(priority: .userInitiated) { [weak self] in
            await self?.verifyPin(pin) ?? false
        }.value
        if result { lockRequired = false }
        return result
    }

    /// 修改 PIN（需先验证旧 PIN）
    func changePin(_ oldPin: String, _ newPin: String) -> Bool {
        if !verifyPin(oldPin) || !isValidPin(newPin) { return false }
        let salt = Self.newSaltHex()
        prefs.setString(salt, for: Keys.pinSalt)
        prefs.setString(derivePin(newPin, salt), for: Keys.pinHash)
        prefs.setInt(1, for: "pin_kdf_version")
        return true
    }

    /// 关闭隐私模式（需先验证 PIN；分类保护标记保留在 DB，开关关闭期间不生效）
    func disable(_ pin: String) -> Bool {
        if !verifyPin(pin) { return false }
        prefs.setBool(false, for: Keys.enabled)
        isEnabled = false
        lockRequired = false
        return true
    }

    private func derivePin(_ pin: String, _ salt: String) -> String {
        var bytes = Data()
        var idx = salt.startIndex
        while idx < salt.endIndex, saltHexNext(idx, salt) != nil {
            let next = saltHexNext(idx, salt)!
            if let byte = UInt8(salt[idx..<next], radix: 16) { bytes.append(byte) }
            idx = next
        }
        // PBEKeySpec(pin, salt, 120_000, 256) + PBKDF2WithHmacSHA1
        let hash = (try? PBKDF2.derive(password: pin, salt: bytes, iterations: 120_000, keyLength: 32)) ?? Data()
        return hash.map { String(format: "%02x", $0) }.joined()
    }

    private func saltHexNext(_ idx: String.Index, _ salt: String) -> String.Index? {
        salt.index(idx, offsetBy: 2, limitedBy: salt.endIndex)
    }

    func isValidPin(_ pin: String) -> Bool {
        pin.count == Self.pinLengthValue && pin.allSatisfy { $0 >= "0" && $0 <= "9" }
    }
}

// MARK: - PBKDF2（CommonCrypto，kCCPRFHmacAlgSHA1 对应 PBKDF2WithHmacSHA1）

enum PBKDF2 {
    static func derive(password: String, salt: Data, iterations: Int, keyLength: Int = 32) throws -> Data {
        var derived = Data(repeating: 0, count: keyLength)
        let result = derived.withUnsafeMutableBytes { derivedPtr in
            password.withCString { pwdPtr in
                salt.withUnsafeBytes { saltPtr in
                    CCKeyDerivationPBKDF(
                        CCPBKDFAlgorithm(kCCPBKDF2),
                        pwdPtr, password.utf8.count,
                        saltPtr.bindMemory(to: UInt8.self).baseAddress, salt.count,
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA1),
                        UInt32(iterations),
                        derivedPtr.bindMemory(to: UInt8.self).baseAddress, keyLength
                    )
                }
            }
        }
        guard result == kCCSuccess else {
            throw NSError(domain: "PBKDF2", code: Int(result))
        }
        return derived
    }
}

// MARK: - 加密秘密存储（EncryptedSecretStore 对应物：Keychain，iOS 侧辅助门面）

enum SecretStore {
    static func set(_ value: String?, for key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.aistudio.novelreader.kxmpzq",
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else { return }
        var attrs = query
        attrs[kSecValueData as String] = data
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(attrs as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.aistudio.novelreader.kxmpzq",
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
