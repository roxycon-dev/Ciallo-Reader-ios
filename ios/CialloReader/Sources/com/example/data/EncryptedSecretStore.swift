import Foundation
import Security

// 对齐 novel-reader/app/src/main/java/com/example/data/EncryptedSecretStore.kt（37 行）
// A failed keystore never permits a plaintext read or write.
// iOS 侧以 Keychain（kSecClassGenericPassword，AES-256 保护由系统负责）替代 EncryptedSharedPreferences。

final class EncryptedSecretStore {
    private static let service = "com.example.ciallo.app_secure_secrets"
    private let lock = NSLock()

    private func keychainQuery(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: key,
        ]
    }

    private func keychainGet(_ key: String) -> String? {
        var query = keychainQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// commit() 语义：Keychain 写入失败即抛错，绝不静默丢密钥。
    private func keychainSet(_ key: String, _ value: String) throws {
        SecItemDelete(keychainQuery(key) as CFDictionary)
        guard let data = value.data(using: .utf8) else { return }
        var attrs = keychainQuery(key)
        attrs[kSecValueData as String] = data
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        guard SecItemAdd(attrs as CFDictionary, nil) == errSecSuccess else {
            throw NSError(domain: "EncryptedSecretStore", code: -1,
                          userInfo: [NSLocalizedDescriptionKey: "密钥迁移失败"])
        }
    }

    private func keychainRemove(_ key: String) {
        SecItemDelete(keychainQuery(key) as CFDictionary)
    }

    func read(_ key: String, legacy legacyRead: (() -> String?)? = nil) -> String? {
        lock.lock(); defer { lock.unlock() }
        let secure = { self.keychainGet($0) }
        // Keystore 不可用时直接返回 null（never permits a plaintext read）：
        // Keychain 查询失败由 keychainGet 返回 nil 承担。
        do {
            if let v = secure(key) { return v }
            guard let old = legacyRead?() else { return nil }
            try keychainSet(key, old) // check(secure.edit().putString(key, old).commit()) { "密钥迁移失败" }
            old
        } catch {
            return nil
        }
    }

    func write(_ key: String, _ value: String) {
        lock.lock(); defer { lock.unlock() }
        // error("系统安全存储不可用，无法保存 API 密钥")：Keychain 写失败时以异常语义终止。
        do {
            if keychainGet(key) != value {
                try keychainSet(key, value) // check(...) { "API 密钥保存失败" }
            }
        } catch {
            fatalError("系统安全存储不可用，无法保存 API 密钥")
        }
    }

    func remove(_ key: String) {
        keychainRemove(key) // runCatching { prefs?.edit()?.remove(key)?.apply() }
    }
}
