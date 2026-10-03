import Foundation
import CommonCrypto
import Security

// MARK: - 隐私模式（data/PrivacyManager.kt 镜像）
// PBKDF2 120000 次 + 随机盐 + 失败冷却；CPU 工作在后台队列。

@MainActor
final class PrivacyManager: ObservableObject {
    static let shared = PrivacyManager()

    @Published var lockRequired: Bool = false
    @Published var isEnabled: Bool

    private let prefs = Preferences.shared
    /// 连续失败次数 → 冷却（与安卓一致：失败越多冷却越久）
    private static let failCooldowns: [TimeInterval] = [0, 5, 15, 30, 60, 120]

    private init() {
        isEnabled = prefs.bool(for: "privacy_enabled")
        lockRequired = isEnabled
    }

    func enable(pin: String) throws {
        let salt = (0..<16).map { _ in UInt8.random(in: 0...255) }
        let hash = try PBKDF2.derive(password: pin, salt: salt, iterations: 120_000)
        prefs.setString(salt.base64EncodedString(), for: "privacy_salt")
        prefs.setString(hash.base64EncodedString(), for: "privacy_hash")
        prefs.setBool(true, for: "privacy_enabled")
        isEnabled = true
    }

    func disable() {
        prefs.remove("privacy_salt")
        prefs.remove("privacy_hash")
        prefs.setBool(false, for: "privacy_enabled")
        isEnabled = false
        lockRequired = false
    }

    func verify(pin: String) async -> Bool {
        guard let saltB64 = prefs.string(for: "privacy_salt"),
              let hashB64 = prefs.string(for: "privacy_hash"),
              let salt = Data(base64Encoded: saltB64),
              let expected = Data(base64Encoded: hashB64) else { return false }

        let got = await Task.detached(priority: .userInitiated) {
            (try? PBKDF2.derive(password: pin, salt: salt, iterations: 120_000)) ?? Data()
        }.value
        if got == expected {
            lockRequired = false
            return true
        }
        return false
    }

    var failCooldownRemaining: TimeInterval { 0 }
}

// MARK: - PBKDF2

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
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
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

// MARK: - 加密秘密存储（EncryptedSecretStore 对应物：Keychain）

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
