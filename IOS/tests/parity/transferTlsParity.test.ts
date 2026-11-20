/**
 * transferTlsParity.test.ts —— `transfer/TransferTls.kt`（75 行）。
 *
 * 本轮之前，`TransferTls` 在 iOS 侧只有两样东西：`kotlinAuthorityConstants.ts` 里的
 * 别名常量，和 `transferWire.ts` 里逐字节等价的 `code()`。密钥规格、别名白名单、
 * 协议白名单、信任判定这三块完全没有落点，属于「Web 没有 keystore」被顺手跳过的那类。
 * 现在可判定的那一半落进 `src/core/transfer/transferTls.ts`，平台上真正跑 TLS 的部分
 * 由 `TransferStream` 端口承担 —— 两边规则一致，只是执行者不同。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { TRANSFER_TLS_ALIAS as AUTHORITY_ALIAS } from '@core/ui/kotlinAuthorityConstants';
import {
  TRANSFER_CERTIFICATE_NOT_AFTER_MS,
  TRANSFER_CERTIFICATE_SUBJECT,
  TRANSFER_ENCRYPTION_PADDINGS,
  TRANSFER_KEY_ALGORITHM,
  TRANSFER_KEY_PURPOSES,
  TRANSFER_KEY_SIZE_BITS,
  TRANSFER_MIN_PUBLIC_KEY_BYTES,
  TRANSFER_SIGNATURE_PADDINGS,
  TRANSFER_SO_TIMEOUT_MS,
  TRANSFER_TCP_NO_DELAY,
  TRANSFER_TLS_ALIAS,
  TRANSFER_TLS_IDENTITY_DIGESTS,
  TRANSFER_TLS_PROTOCOLS,
  TransferTlsError,
  chooseTransferClientAlias,
  chooseTransferServerAlias,
  transferIdentityAliases,
  transferIdentityFor,
  transferPeerFingerprint,
  transferSocketOptions,
  validateTransferPeerChain,
  type TransferDeviceCertificate,
} from '@core/transfer/transferTls';
import { transferPairingCode } from '@core/transfer/transferWire';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

const KT = kt('transfer/TransferTls.kt');

function certificate(overrides: Partial<TransferDeviceCertificate> = {}): TransferDeviceCertificate {
  return {
    encoded: new Uint8Array([1, 2, 3]),
    publicKey: new Uint8Array(TRANSFER_MIN_PUBLIC_KEY_BYTES).fill(7),
    notBeforeMs: 1_600_000_000_000,
    notAfterMs: 1_900_000_000_000,
    selfSigned: true,
    ...overrides,
  };
}

describe('TransferTls.kt L19-35 身份与密钥规格', () => {
  it('别名 v3 —— 与 authority 常量同一字符串（旧身份的原始 RSA 运算被砍掉）', () => {
    expect(KT).toContain('internal const val ALIAS = "ciallo_transfer_identity_v3"');
    expect(TRANSFER_TLS_ALIAS).toBe('ciallo_transfer_identity_v3');
    expect(AUTHORITY_ALIAS).toBe(TRANSFER_TLS_ALIAS);
  });

  it('四个摘要、RSA 2048、SIGN|VERIFY、CN=Ciallo device、2100 年到期', () => {
    expect(KT).toContain('internal val identityDigests = arrayOf(KeyProperties.DIGEST_NONE,KeyProperties.DIGEST_SHA256,KeyProperties.DIGEST_SHA384,KeyProperties.DIGEST_SHA512)');
    expect(KT).toContain('.setKeySize(2048)');
    expect(KT).toContain('PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY');
    expect(KT).toContain('X500Principal("CN=Ciallo device")');
    expect(KT).toContain('setCertificateNotAfter(java.util.Date(4102444800000L))');
    expect([...TRANSFER_TLS_IDENTITY_DIGESTS]).toEqual(['NONE', 'SHA256', 'SHA384', 'SHA512']);
    expect(TRANSFER_KEY_ALGORITHM).toBe('RSA');
    expect(TRANSFER_KEY_SIZE_BITS).toBe(2048);
    expect([...TRANSFER_KEY_PURPOSES]).toEqual(['SIGN', 'VERIFY']);
    expect(TRANSFER_CERTIFICATE_SUBJECT).toBe('CN=Ciallo device');
    expect(TRANSFER_CERTIFICATE_NOT_AFTER_MS).toBe(4_102_444_800_000);
  });

  it('签名/加密填充集合逐项一致', () => {
    expect(KT).toContain('.setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1,KeyProperties.SIGNATURE_PADDING_RSA_PSS)');
    expect(KT).toContain('.setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE,KeyProperties.ENCRYPTION_PADDING_RSA_PKCS1)');
    expect([...TRANSFER_SIGNATURE_PADDINGS]).toEqual(['RSA_PKCS1', 'RSA_PSS']);
    expect([...TRANSFER_ENCRYPTION_PADDINGS]).toEqual(['NONE', 'RSA_PKCS1']);
  });
});

describe('TransferTls.kt L36-50 只交出本机身份别名', () => {
  it('客户端/服务端别名都按 `it == alias` 过滤（AndroidKeyStore 里还有别的应用密钥）', () => {
    expect(KT).toContain('delegate.getClientAliases(type,issuers)?.filter {it==alias}?.toTypedArray()');
    expect(KT).toContain('delegate.getServerAliases(type,issuers)?.filter {it==alias}?.toTypedArray()');
    expect(transferIdentityAliases(['other', TRANSFER_TLS_ALIAS, 'v1'])).toEqual([TRANSFER_TLS_ALIAS]);
    expect(transferIdentityAliases(['other', 'v1'])).toEqual([]);
    expect(transferIdentityAliases(null)).toBeNull();
  });

  it('chooseClientAlias 按 types 顺序取第一个可用的；chooseServerAlias 只看单类型', () => {
    expect(KT).toContain('types?.firstNotNullOfOrNull {getClientAliases(it,issuers)?.firstOrNull()}');
    expect(KT).toContain('getServerAliases(type,issuers)?.firstOrNull()');
    const table: Record<string, string[] | null> = { EC: null, RSA: ['other', TRANSFER_TLS_ALIAS] };
    expect(chooseTransferClientAlias(['EC', 'RSA'], (type) => table[type] ?? null)).toBe(TRANSFER_TLS_ALIAS);
    expect(chooseTransferClientAlias(null, () => [TRANSFER_TLS_ALIAS])).toBeNull();
    expect(chooseTransferServerAlias('RSA', (type) => table[type] ?? null)).toBe(TRANSFER_TLS_ALIAS);
    expect(chooseTransferServerAlias(null, () => [TRANSFER_TLS_ALIAS])).toBeNull();
  });

  it('getCertificateChain/getPrivateKey 只在 requested == alias 时给值', () => {
    expect(KT).toContain('if(requested==alias)delegate.getCertificateChain(alias)else null');
    expect(KT).toContain('if(requested==alias)delegate.getPrivateKey(alias)else null');
    expect(transferIdentityFor(TRANSFER_TLS_ALIAS)).toBe(TRANSFER_TLS_ALIAS);
    expect(transferIdentityFor('other')).toBeNull();
    expect(transferIdentityFor(null)).toBeNull();
  });
});

describe('TransferTls.kt L51-60 pairingTrust.validate', () => {
  it('链长必须恰好 1，否则「无效设备证书」', () => {
    expect(KT).toContain('require(chain?.size==1) { tr("无效设备证书") }');
    expect(() => validateTransferPeerChain(null, 1_700_000_000_000)).toThrow(TransferTlsError);
    expect(() => validateTransferPeerChain([], 1_700_000_000_000)).toThrow('无效设备证书');
    expect(() => validateTransferPeerChain([certificate(), certificate()], 1_700_000_000_000)).toThrow('无效设备证书');
  });

  it('checkValidity 的两个方向分别报过期 / 未生效', () => {
    expect(KT).toContain('cert.checkValidity()');
    expect(() => validateTransferPeerChain([certificate({ notAfterMs: 1_000 })], 1_700_000_000_000))
      .toThrow(expect.objectContaining({ failure: 'EXPIRED' }));
    expect(() => validateTransferPeerChain([certificate({ notBeforeMs: 2_000_000_000_000 })], 1_700_000_000_000))
      .toThrow(expect.objectContaining({ failure: 'NOT_YET_VALID' }));
  });

  it('必须自签名（cert.verify(cert.publicKey)）', () => {
    expect(KT).toContain('cert.verify(cert.publicKey)');
    expect(() => validateTransferPeerChain([certificate({ selfSigned: false })], 1_700_000_000_000))
      .toThrow(expect.objectContaining({ failure: 'NOT_SELF_SIGNED' }));
  });

  it('公钥 DER < 128 字节 →「设备证书强度不足」', () => {
    expect(KT).toContain('require(cert.publicKey.encoded.size>=128) { tr("设备证书强度不足") }');
    expect(TRANSFER_MIN_PUBLIC_KEY_BYTES).toBe(128);
    expect(() => validateTransferPeerChain([certificate({ publicKey: new Uint8Array(127) })], 1_700_000_000_000))
      .toThrow('设备证书强度不足');
    expect(validateTransferPeerChain([certificate({ publicKey: new Uint8Array(128) })], 1_700_000_000_000).selfSigned).toBe(true);
  });

  it('附带 issuers 为空数组', () => {
    expect(KT).toContain('override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()');
  });
});

describe('TransferTls.kt L63-67 套接字配置与对端指纹', () => {
  it('协议只留 TLSv1.2 / TLSv1.3；soTimeout 30s；tcpNoDelay', () => {
    expect(KT).toContain('socket.enabledProtocols=socket.supportedProtocols.filter { it in setOf("TLSv1.2","TLSv1.3") }.toTypedArray()');
    expect(KT).toContain('socket.soTimeout=30_000; socket.tcpNoDelay=true');
    expect([...TRANSFER_TLS_PROTOCOLS]).toEqual(['TLSv1.2', 'TLSv1.3']);
    expect(TRANSFER_SO_TIMEOUT_MS).toBe(30_000);
    expect(TRANSFER_TCP_NO_DELAY).toBe(true);
    expect(transferSocketOptions(['TLSv1.1', 'TLSv1.3', 'TLSv1.2', 'SSLv3'])).toEqual({
      enabledProtocols: ['TLSv1.3', 'TLSv1.2'],
      soTimeoutMs: 30_000,
      tcpNoDelay: true,
    });
  });

  it('peerFingerprint = sha256(peerCert.encoded) 的小写十六进制', () => {
    expect(KT).toContain('fun peerFingerprint(socket: SSLSocket): String = sha256(socket.session.peerCertificates.first().encoded)');
    const der = new Uint8Array([0x30, 0x82, 0x01, 0x02]);
    expect(transferPeerFingerprint(certificate({ encoded: der }))).toBe(
      createHash('sha256').update(der).digest('hex'),
    );
  });
});

describe('TransferTls.kt L68-74 code() —— 六位配对码', () => {
  it('证书指纹与 nonce 各自排序后按 | 连接，取 SHA-256 前 4 字节无符号再 % 1e6', () => {
    expect(KT).toContain('val certs=listOf(sha256(socket.session.localCertificates.first().encoded),peerFingerprint(socket)).sorted()');
    expect(KT).toContain('val nonces=listOf(localNonce,remoteNonce).sorted()');
    expect(KT).toContain('val bytes=java.security.MessageDigest.getInstance("SHA-256").digest((certs+nonces).joinToString("|").toByteArray())');
    expect(KT).toContain('val number=java.nio.ByteBuffer.wrap(bytes).int.toLong() and 0xffffffffL');
    expect(KT).toContain("return (number%1_000_000).toString().padStart(6,'0')");

    const a = 'a'.repeat(64), b = 'b'.repeat(64);
    const n1 = '1'.repeat(48), n2 = '2'.repeat(48);
    const transcript = [[a, b].sort().join('|'), [n1, n2].sort().join('|')].join('|');
    const digest = createHash('sha256').update(transcript, 'utf8').digest();
    const expected = String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
    expect(transferPairingCode(a, b, n1, n2)).toBe(expected);
    // 顺序无关：两端各自排序
    expect(transferPairingCode(b, a, n2, n1)).toBe(expected);
    expect(transferPairingCode(a, b, n1, n2)).toMatch(/^\d{6}$/);
  });
});