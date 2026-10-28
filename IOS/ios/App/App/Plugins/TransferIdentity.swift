import Foundation
import Security
import CryptoKit
import Network

enum TransferNativeError: LocalizedError {
    case invalid(String)
    var errorDescription: String? { if case .invalid(let text) = self { return text }; return nil }
}

/// A device-only RSA identity. The private key stays in Keychain; only its
/// certificate fingerprint crosses the Capacitor bridge. This is pairing TLS,
/// whose trust is completed by the transcript code on both devices.
struct TransferIdentity {
    let identity: SecIdentity
    let fingerprint: String
    private static let identityLabel = "ciallo.transfer.identity.v1"

    static func load(label: String = identityLabel) throws -> TransferIdentity {
        let query: [CFString: Any] = [kSecClass: kSecClassIdentity, kSecAttrLabel: label, kSecReturnRef: true]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let item = item, CFGetTypeID(item) == SecIdentityGetTypeID() {
            let identity = item as! SecIdentity
            var certificate: SecCertificate?
            guard SecIdentityCopyCertificate(identity, &certificate) == errSecSuccess, let certificate = certificate else {
                throw TransferNativeError.invalid("无法读取互传设备证书")
            }
            return TransferIdentity(identity: identity, fingerprint: try validate(certificate))
        }
        guard status == errSecItemNotFound else { throw TransferNativeError.invalid("无法读取互传身份：\(status)") }
        let tag = Data(label.utf8)
        let keyQuery: [CFString: Any] = [kSecClass: kSecClassKey, kSecAttrApplicationTag: tag,
            kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPrivate, kSecReturnRef: true]
        var keyItem: CFTypeRef?
        let keyStatus = SecItemCopyMatching(keyQuery as CFDictionary, &keyItem)
        let key: SecKey
        if keyStatus == errSecSuccess, let keyItem = keyItem, CFGetTypeID(keyItem) == SecKeyGetTypeID() {
            key = keyItem as! SecKey
        } else if keyStatus == errSecItemNotFound {
            var error: Unmanaged<CFError>?
            let attributes: [CFString: Any] = [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeySizeInBits: 2048,
                kSecPrivateKeyAttrs: [kSecAttrIsPermanent: true, kSecAttrApplicationTag: tag,
                    kSecAttrLabel: label, kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]]
            guard let generated = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
                if let error = error { throw error.takeRetainedValue() }
                throw TransferNativeError.invalid("无法创建互传私钥")
            }
            key = generated
        } else { throw TransferNativeError.invalid("无法读取互传私钥：\(keyStatus)") }
        let data = try makeCertificate(key: key)
        guard let certificate = SecCertificateCreateWithData(nil, data as CFData) else { throw TransferNativeError.invalid("无法创建互传证书") }
        let addition: [CFString: Any] = [kSecClass: kSecClassCertificate, kSecValueRef: certificate,
            kSecAttrLabel: label, kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let added = SecItemAdd(addition as CFDictionary, nil)
        guard added == errSecSuccess || added == errSecDuplicateItem else { throw TransferNativeError.invalid("无法保存互传证书：\(added)") }
        item = nil
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let item = item,
              CFGetTypeID(item) == SecIdentityGetTypeID() else { throw TransferNativeError.invalid("证书与设备私钥不匹配") }
        let identity = item as! SecIdentity
        var stored: SecCertificate?
        guard SecIdentityCopyCertificate(identity, &stored) == errSecSuccess, let stored = stored else { throw TransferNativeError.invalid("互传证书缺失") }
        return TransferIdentity(identity: identity, fingerprint: try validate(stored))
    }

    private static func makeCertificate(key: SecKey) throws -> Data {
        var error: Unmanaged<CFError>?
        guard let publicKey = SecKeyCopyPublicKey(key), let raw = SecKeyCopyExternalRepresentation(publicKey, &error) else {
            throw TransferNativeError.invalid("无法读取互传公钥")
        }
        var random = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else { throw TransferNativeError.invalid("系统随机数不可用") }
        random[0] &= 0x7f; random[0] |= 1
        let signatureAlgorithm = der(0x30, der(0x06, Data([0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x0b])) + der(0x05, Data()))
        let name = der(0x30, der(0x31, der(0x30, der(0x06, Data([0x55,0x04,0x03])) + der(0x0c, Data("Ciallo device".utf8)))))
        let format = DateFormatter(); format.locale = Locale(identifier: "en_US_POSIX"); format.calendar = Calendar(identifier: .gregorian)
        format.timeZone = TimeZone(secondsFromGMT: 0); format.dateFormat = "yyyyMMddHHmmss'Z'"
        let validity = der(0x30, der(0x18, Data(format.string(from: Date().addingTimeInterval(-86400)).utf8)) + der(0x18, Data("21000101000000Z".utf8)))
        let rsaAlgorithm = der(0x30, der(0x06, Data([0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01])) + der(0x05, Data()))
        let publicInfo = der(0x30, rsaAlgorithm + der(0x03, Data([0]) + (raw as Data)))
        let constraints = der(0x30, der(0x06, Data([0x55,0x1d,0x13])) + der(0x04, der(0x30, Data())))
        let usage = der(0x30, der(0x06, Data([0x55,0x1d,0x0f])) + der(0x01, Data([0xff])) + der(0x04, der(0x03, Data([5,0xa0]))))
        let tbs = der(0x30, der(0xa0, der(0x02, Data([2]))) + der(0x02, Data(random)) + signatureAlgorithm + name + validity + name + publicInfo + der(0xa3, der(0x30, constraints + usage)))
        guard let signature = SecKeyCreateSignature(key, .rsaSignatureMessagePKCS1v15SHA256, tbs as CFData, &error) else { throw TransferNativeError.invalid("互传证书签名失败") }
        return der(0x30, tbs + signatureAlgorithm + der(0x03, Data([0]) + (signature as Data)))
    }

    /// Validate the single self-signed leaf, including its own signature and
    /// validity dates. Accepting a user-confirmed leaf does not trust a CA or
    /// change the device's ordinary HTTPS trust policies.
    static func validate(_ certificate: SecCertificate, now: Date = Date()) throws -> String {
        let data = SecCertificateCopyData(certificate) as Data
        guard data.count <= 65536 else { throw TransferNativeError.invalid("设备证书过大") }
        let root = try ASN.read(data), parts = try root.children()
        guard root.tag == 0x30, parts.count == 3, parts[0].tag == 0x30, parts[1].tag == 0x30,
              parts[2].tag == 0x03, parts[2].body.first == 0 else { throw TransferNativeError.invalid("设备证书结构无效") }
        let fields = try parts[0].children(), base = fields.first?.tag == 0xa0 ? 1 : 0
        guard fields.count >= base + 6, fields[base + 1].encoded == parts[1].encoded,
              fields[base + 2].encoded == fields[base + 4].encoded else { throw TransferNativeError.invalid("需要单一自签名设备证书") }
        let dates = try fields[base + 3].children()
        guard dates.count == 2, let start = certificateDate(dates[0]), let end = certificateDate(dates[1]), start <= now, now <= end else { throw TransferNativeError.invalid("设备证书已过期或尚未生效") }
        let algorithmFields = try parts[1].children()
        guard let oid = algorithmFields.first, oid.tag == 0x06 else { throw TransferNativeError.invalid("设备签名算法无效") }
        let algorithm: SecKeyAlgorithm
        switch Array(oid.body) {
        case [0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x0b]: algorithm = .rsaSignatureMessagePKCS1v15SHA256
        case [0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x0c]: algorithm = .rsaSignatureMessagePKCS1v15SHA384
        case [0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x0d]: algorithm = .rsaSignatureMessagePKCS1v15SHA512
        default: throw TransferNativeError.invalid("设备签名算法不受支持")
        }
        guard let key = SecCertificateCopyKey(certificate), let attrs = SecKeyCopyAttributes(key) as? [CFString: Any],
              let bits = attrs[kSecAttrKeySizeInBits] as? Int, bits >= 2048,
              SecKeyIsAlgorithmSupported(key, .verify, algorithm),
              SecKeyVerifySignature(key, algorithm, parts[0].encoded as CFData, Data(parts[2].body.dropFirst()) as CFData, nil) else { throw TransferNativeError.invalid("设备证书自签名校验失败") }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    private static func certificateDate(_ node: ASN) -> Date? {
        guard let text = String(data: node.body, encoding: .ascii), (node.tag == 0x17 && text.count == 13) || (node.tag == 0x18 && text.count == 15),
              text.last == "Z", text.dropLast().allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.isLenient = false
        formatter.twoDigitStartDate = Date(timeIntervalSince1970: -631152000) // X.509 UTCTime starts in 1950.
        formatter.dateFormat = node.tag == 0x17 ? "yyMMddHHmmss'Z'" : "yyyyMMddHHmmss'Z'"
        return formatter.date(from: text)
    }
    private static func der(_ tag: UInt8, _ body: Data) -> Data {
        var size = body.count, length = [UInt8]()
        if size < 128 { length = [UInt8(size)] }
        else { while size > 0 { length.insert(UInt8(size & 255), at: 0); size >>= 8 }; length.insert(0x80 | UInt8(length.count), at: 0) }
        return Data([tag] + length) + body
    }
    private struct ASN {
        let tag: UInt8
        let encoded: Data
        let body: Data
        static func read(_ data: Data) throws -> ASN {
            let bytes = [UInt8](data); var offset = 0
            let result = try parse(bytes, &offset)
            guard offset == bytes.count else { throw TransferNativeError.invalid("设备证书包含尾随数据") }
            return result
        }
        private static func parse(_ bytes: [UInt8], _ offset: inout Int) throws -> ASN {
            let start = offset
            guard bytes.count - offset >= 2 else { throw TransferNativeError.invalid("设备证书已截断") }
            let tag = bytes[offset], first = bytes[offset + 1]; offset += 2
            var size = Int(first)
            if first >= 128 {
                let width = Int(first & 0x7f)
                guard width > 0 && width <= 4 && bytes.count - offset >= width, bytes[offset] != 0 else { throw TransferNativeError.invalid("设备证书长度无效") }
                size = 0
                for _ in 0..<width { size = (size << 8) | Int(bytes[offset]); offset += 1 }
                guard size >= 128 else { throw TransferNativeError.invalid("设备证书非规范 DER") }
            }
            guard size <= bytes.count - offset else { throw TransferNativeError.invalid("设备证书长度越界") }
            let body = Data(bytes[offset..<(offset + size)]); offset += size
            return ASN(tag: tag, encoded: Data(bytes[start..<offset]), body: body)
        }
        func children() throws -> [ASN] {
            let bytes = [UInt8](body); var offset = 0, nodes = [ASN]()
            while offset < bytes.count { nodes.append(try ASN.parse(bytes, &offset)); guard nodes.count <= 64 else { throw TransferNativeError.invalid("设备证书结构过深") } }
            return nodes
        }
    }

    func parameters(queue: DispatchQueue) throws -> NWParameters {
        let options = NWProtocolTLS.Options()
        guard let local = sec_identity_create(identity) else { throw TransferNativeError.invalid("TLS 设备身份不可用") }
        sec_protocol_options_set_local_identity(options.securityProtocolOptions, local)
        sec_protocol_options_set_min_tls_protocol_version(options.securityProtocolOptions, .TLSv12)
        sec_protocol_options_set_max_tls_protocol_version(options.securityProtocolOptions, .TLSv13)
        sec_protocol_options_set_peer_authentication_required(options.securityProtocolOptions, true)
        sec_protocol_options_set_verify_block(options.securityProtocolOptions, { _, trust, complete in
            let value = sec_trust_copy_ref(trust).takeRetainedValue()
            guard let chain = SecTrustCopyCertificateChain(value) as? [SecCertificate], chain.count == 1 else { complete(false); return }
            do { _ = try TransferIdentity.validate(chain[0]); complete(true) } catch { complete(false) }
        }, queue)
        let tcp = NWProtocolTCP.Options(); tcp.noDelay = true
        let parameters = NWParameters(tls: options, tcp: tcp)
        parameters.includePeerToPeer = true
        return parameters
    }
    static func peerFingerprint(_ connection: NWConnection) throws -> String {
        guard let metadata = connection.metadata(definition: NWProtocolTLS.definition) as? NWProtocolTLS.Metadata else { throw TransferNativeError.invalid("连接不是 TLS") }
        var certificates = [SecCertificate]()
        let accessible = sec_protocol_metadata_access_peer_certificate_chain(metadata.securityProtocolMetadata) { certificate in
            certificates.append(sec_certificate_copy_ref(certificate).takeRetainedValue())
        }
        guard accessible, certificates.count == 1 else { throw TransferNativeError.invalid("对方设备证书缺失") }
        return try validate(certificates[0])
    }
}
