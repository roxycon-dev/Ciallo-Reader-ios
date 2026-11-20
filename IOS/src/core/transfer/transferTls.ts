/**
 * transferTls.ts  ←  novel-reader/app/src/main/java/com/example/transfer/TransferTls.kt
 *
 * Kotlin source: 75 lines / 61 non-blank.
 *
 * ┌─ 逐行对照（verbatim accounting）──────────────────────────────────────────────┐
 * │ L1-16    package + android.security / javax.net.ssl imports  — 包名与导入     │
 * │ L18      doc comment「Self-signed device certificates are authenticated by an │
 * │          explicit, transcript-bound human comparison.」      — 原文保留       │
 * │ L19      `internal object TransferTls`                       → 本模块导出集合 │
 * │ L20      「Earlier identities omitted raw RSA operations …」— 注释保留        │
 * │ L21      `ALIAS = "ciallo_transfer_identity_v3"`             → 同名常量       │
 * │ L22      `identityDigests`（4 项）                           → 同名元组       │
 * │ L23-35   `context()` 的密钥生成参数                          → `TRANSFER_KEY_*` │
 * │ L36-50   KeyManagerFactory + X509KeyManager 别名白名单       → `transferIdentity*` │
 * │ L51-60   `pairingTrust.validate`                             → `validateTransferPeerChain` │
 * │ L61      `SSLContext.getInstance("TLS")`                     — 平台职责       │
 * │ L63-66   `configure(socket)`                                 → `transferSocketOptions` │
 * │ L67      `peerFingerprint(socket)`                           → `transferPeerFingerprint` │
 * │ L68-74   `code(socket, localNonce, remoteNonce)`             → `transferPairingCode` │
 * │          （`core/transfer/transferWire.ts` L35-42，逐字节等价）              │
 * │ L75      `}`                                                  — 结构           │
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * 为什么只落到「规则层」：
 * - `AndroidKeyStore` / `KeyPairGenerator` / `SSLContext` / `SSLSocket` 是平台 API。
 *   Web 侧对应物是 `TransferStream`（`transferWire.ts` L13-20），真正的 TLS 由
 *   `platform/ios-native` 的 `NWConnection`/`Security` 或浏览器的 `WebSocket(wss:)`
 *   承担；本文件只把**可判定**的那一半（别名、摘要、协议、超时、信任判定）逐条搬过来，
 *   让两边跑同一套规则，而不是把「Web 没有 keystore」当成不移植的借口。
 * - `cert.checkValidity()` / `cert.verify(cert.publicKey)` 在 Web 侧由宿主把
 *   DER 与自签名验签结果喂进来（`TransferDeviceCertificate`），判定顺序与 Kotlin 一致。
 */

import { tr } from '@core/i18n/locale';
import { TransferProtocolError, transferHash } from './transferWire';

/** L21 `internal const val ALIAS = "ciallo_transfer_identity_v3"`。 */
export const TRANSFER_TLS_ALIAS = 'ciallo_transfer_identity_v3';

/** L22 `identityDigests = arrayOf(DIGEST_NONE, DIGEST_SHA256, DIGEST_SHA384, DIGEST_SHA512)`。 */
export const TRANSFER_TLS_IDENTITY_DIGESTS = ['NONE', 'SHA256', 'SHA384', 'SHA512'] as const;

/** L27-32 `KeyGenParameterSpec.Builder(...)`：RSA 2048 / 签名+验签用途 / 2100 年到期。 */
export const TRANSFER_KEY_ALGORITHM = 'RSA';
export const TRANSFER_KEY_SIZE_BITS = 2048;
export const TRANSFER_KEY_PURPOSES = ['SIGN', 'VERIFY'] as const;
export const TRANSFER_CERTIFICATE_SUBJECT = 'CN=Ciallo device';
/** L32 `setCertificateNotAfter(Date(4102444800000L))` —— 2100-01-01T00:00:00Z。 */
export const TRANSFER_CERTIFICATE_NOT_AFTER_MS = 4_102_444_800_000;
/** L29 `setSignaturePaddings(RSA_PKCS1, RSA_PSS)`。 */
export const TRANSFER_SIGNATURE_PADDINGS = ['RSA_PKCS1', 'RSA_PSS'] as const;
/** L30 `setEncryptionPaddings(NONE, RSA_PKCS1)`。 */
export const TRANSFER_ENCRYPTION_PADDINGS = ['NONE', 'RSA_PKCS1'] as const;

/** L64 `setOf("TLSv1.2", "TLSv1.3")`。 */
export const TRANSFER_TLS_PROTOCOLS = ['TLSv1.2', 'TLSv1.3'] as const;
/** L65 `socket.soTimeout = 30_000`。 */
export const TRANSFER_SO_TIMEOUT_MS = 30_000;
/** L65 `socket.tcpNoDelay = true`。 */
export const TRANSFER_TCP_NO_DELAY = true;
/** L56 `require(cert.publicKey.encoded.size >= 128)` —— SubjectPublicKeyInfo DER 下限。 */
export const TRANSFER_MIN_PUBLIC_KEY_BYTES = 128;

/** L54 / L56 的两句 `tr(...)` 文案，逐字照抄（中文原文即 key）。 */
export const TRANSFER_INVALID_CERTIFICATE = '无效设备证书';
export const TRANSFER_WEAK_CERTIFICATE = '设备证书强度不足';

export type TransferTlsFailure =
  | 'INVALID_CHAIN'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'NOT_SELF_SIGNED'
  | 'WEAK_KEY';

/** `IllegalArgumentException`（`require`）/ `CertificateException`（`checkValidity`）的等价物。 */
export class TransferTlsError extends TransferProtocolError {
  readonly failure: TransferTlsFailure;

  constructor(failure: TransferTlsFailure, message: string) {
    super(message);
    this.name = 'TransferTlsError';
    this.failure = failure;
  }
}

/** L63-66 `fun configure(socket: SSLSocket)`：协议白名单 + 30s 读超时 + `tcpNoDelay`。 */
export function transferSocketOptions(
  supportedProtocols: readonly string[],
): { enabledProtocols: string[]; soTimeoutMs: number; tcpNoDelay: boolean } {
  return {
    enabledProtocols: supportedProtocols.filter((protocol) =>
      (TRANSFER_TLS_PROTOCOLS as readonly string[]).includes(protocol),
    ),
    soTimeoutMs: TRANSFER_SO_TIMEOUT_MS,
    tcpNoDelay: TRANSFER_TCP_NO_DELAY,
  };
}

/**
 * L38-43 —— AndroidKeyStore 里还有别的应用密钥（以及 v1 身份），TLS 绝不能选中它们：
 * `getClientAliases(...)?.filter { it == alias }` / 服务端同理。给的候选里只留 `alias`。
 */
export function transferIdentityAliases(
  candidates: readonly string[] | null,
  alias: string = TRANSFER_TLS_ALIAS,
): string[] | null {
  return candidates === null ? null : candidates.filter((candidate) => candidate === alias);
}

/** L44-45 `chooseClientAlias`：按 `types` 顺序取第一个能给出别名的类型。 */
export function chooseTransferClientAlias(
  types: readonly string[] | null,
  aliasesFor: (type: string) => readonly string[] | null,
  alias: string = TRANSFER_TLS_ALIAS,
): string | null {
  if (types === null) return null;
  for (const type of types) {
    const aliases = transferIdentityAliases(aliasesFor(type), alias);
    if (aliases !== null && aliases.length > 0) return aliases[0] ?? null;
  }
  return null;
}

/** L46-47 `chooseServerAlias`：单类型，取第一个。 */
export function chooseTransferServerAlias(
  type: string | null,
  aliasesFor: (type: string) => readonly string[] | null,
  alias: string = TRANSFER_TLS_ALIAS,
): string | null {
  if (type === null) return null;
  const aliases = transferIdentityAliases(aliasesFor(type), alias);
  return aliases !== null && aliases.length > 0 ? (aliases[0] ?? null) : null;
}

/**
 * L48-49：只有请求的别名**正好是**本机身份时才交出证书链 / 私钥，其余一律 null
 * （否则 AndroidKeyStore 会把别的应用密钥交出去）。
 */
export function transferIdentityFor(
  requested: string | null,
  alias: string = TRANSFER_TLS_ALIAS,
): string | null {
  return requested === alias ? alias : null;
}

/** 宿主喂进来的对端证书视图（`X509Certificate` 的可判定投影）。 */
export interface TransferDeviceCertificate {
  /** `cert.encoded` —— 原始 DER，用于 `peerFingerprint`。 */
  readonly encoded: Uint8Array;
  /** `cert.publicKey.encoded` —— SubjectPublicKeyInfo DER。 */
  readonly publicKey: Uint8Array;
  readonly notBeforeMs: number;
  readonly notAfterMs: number;
  /** `cert.verify(cert.publicKey)` 的结果：自签名验签是否通过。 */
  readonly selfSigned: boolean;
}

/**
 * L53-57 `pairingTrust.validate(chain)`：
 * 1. `require(chain?.size == 1)`；2. `cert.checkValidity()`；3. `cert.verify(cert.publicKey)`；
 * 4. `require(cert.publicKey.encoded.size >= 128)`。顺序与报错文案都按 Kotlin 走。
 */
export function validateTransferPeerChain(
  chain: readonly TransferDeviceCertificate[] | null,
  now: number,
): TransferDeviceCertificate {
  if (chain === null || chain.length !== 1) {
    throw new TransferTlsError('INVALID_CHAIN', tr(TRANSFER_INVALID_CERTIFICATE));
  }
  const certificate = chain[0]!;
  if (now > certificate.notAfterMs) {
    throw new TransferTlsError('EXPIRED', 'certificate has expired');
  }
  if (now < certificate.notBeforeMs) {
    throw new TransferTlsError('NOT_YET_VALID', 'certificate is not yet valid');
  }
  if (!certificate.selfSigned) {
    throw new TransferTlsError('NOT_SELF_SIGNED', tr(TRANSFER_INVALID_CERTIFICATE));
  }
  if (certificate.publicKey.length < TRANSFER_MIN_PUBLIC_KEY_BYTES) {
    throw new TransferTlsError('WEAK_KEY', tr(TRANSFER_WEAK_CERTIFICATE));
  }
  return certificate;
}

/** L67 `fun peerFingerprint(socket) = sha256(socket.session.peerCertificates.first().encoded)`。 */
export function transferPeerFingerprint(certificate: TransferDeviceCertificate): string {
  return transferHash(certificate.encoded);
}
