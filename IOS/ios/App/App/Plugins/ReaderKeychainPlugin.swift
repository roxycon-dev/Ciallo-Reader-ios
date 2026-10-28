import Foundation
import Security
import Capacitor

@objc(ReaderKeychainPlugin)
public class ReaderKeychainPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ReaderKeychainPlugin"
    public let jsName = "ReaderKeychain"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private var service: String { (Bundle.main.bundleIdentifier ?? "ciallo.reader") + ".secrets" }

    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: key,
         kSecAttrSynchronizable as String: false]
    }

    private func requireKey(_ call: CAPPluginCall) -> String? {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("Keychain key is required", "KEYCHAIN_INVALID_KEY")
            return nil
        }
        return key
    }

    private func reject(_ call: CAPPluginCall, status: OSStatus) {
        // Report only the OS status; neither keys nor values belong in logs.
        call.reject("系统安全存储操作失败 (\(status))", "KEYCHAIN_ERROR")
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let key = requireKey(call) else { return }
        var request = query(key)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
        } else if status == errSecSuccess, let data = result as? Data,
                  let value = String(data: data, encoding: .utf8) {
            call.resolve(["value": value])
        } else {
            reject(call, status: status == errSecSuccess ? errSecDecode : status)
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = requireKey(call) else { return }
        guard let value = call.getString("value") else {
            call.reject("Keychain value is required", "KEYCHAIN_INVALID_VALUE")
            return
        }
        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let request = query(key)
        var status = SecItemUpdate(request as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = request
            attributes.forEach { item[$0.key] = $0.value }
            status = SecItemAdd(item as CFDictionary, nil)
        }
        if status == errSecSuccess { call.resolve() } else { reject(call, status: status) }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = requireKey(call) else { return }
        let status = SecItemDelete(query(key) as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            reject(call, status: status)
        }
    }
}
