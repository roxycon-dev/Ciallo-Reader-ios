/**
 * WebCrypto 实现 —— `CryptoPort`。
 *
 * 为什么要一个单独的模块：`src/core/**` 禁止 import 平台模块
 * （`eslint.config.js` 的 `no-restricted-imports`，以及 `platform/interfaces.ts` 顶部铁律），
 * 所以 `library/MhttuImageDecryptor` 的移植版只能声明端口。
 *
 * 为什么**一份实现通吃 web 与 iOS**：`crypto.subtle` 是 ECMAScript/Web Crypto API，
 * WKWebView（Safari）原生实现，与 Capacitor 插件无关 —— 不需要 `@capacitor/*` 包，
 * 也不需要 native 侧写 Swift。
 *
 * 与 Kotlin 的唯一差异：`javax.crypto.Cipher.doFinal` 同步，`subtle.decrypt` 异步。
 * 见 `docs/PARITY_EXCEPTIONS.md` E83。
 */

import type { AsyncCryptoPort } from '../interfaces';

/**
 * Kotlin `library/MhttuImageDecryptor.kt:14-15`
 * `"0B6666A0-BB59-1381-B746-a0E4C9AC".toByteArray(UTF_8).copyOf(32)`
 *
 * 源串正好 32 字节（无连字符的 UUID 长度），UTF-8 下 ASCII 一字一字节，所以
 * `.copyOf(32)` 实际是空操作 —— 密钥就是整串 → AES-256。
 */
const MHTTU_KEY_SOURCE = '0B6666A0-BB59-1381-B746-a0E4C9AC';

/** WebCrypto 要求 `CryptoKey` 的数据在 BufferSource 视图内；避免整段拷贝时的隐式共享。 */
function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  // `Uint8Array.prototype.slice` 返回新 ArrayBuffer（不是 SharedArrayBuffer），
  // 且一定是 ArrayBuffer 而非其视图，WebCrypto 接受。
  return bytes.slice().buffer as ArrayBuffer;
}

/** 懒取 `crypto.subtle` —— 模块加载时环境可能还没有（如 SSR / 早期 bootstrap）。 */
function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (c === undefined || c.subtle === undefined) {
    throw new Error(
      'WebCrypto 不可用（crypto.subtle 缺失）：AES-CBC 解密无法进行。' +
        '请确认运行在安全上下文（HTTPS 或 WKWebView 本地加载）。',
    );
  }
  return c.subtle;
}

export interface WebCryptoOptions {
  /** Kotlin `MhttuImageDecryptor.keyBytes`。默认即漫蛙图床密钥。 */
  readonly mhttuKey?: Uint8Array;
}

export class WebCrypto implements AsyncCryptoPort {
  private readonly mhttuKey: Uint8Array;

  constructor(options: WebCryptoOptions = {}) {
    this.mhttuKey = options.mhttuKey ?? defaultMhttuKey();
  }

  /**
   * Android `Cipher.getInstance("AES/CBC/PKCS5Padding")` + `init(DECRYPT_MODE, …)` +
   * `doFinal(ciphertext)`。
   *
   * WebCrypto 的 `AES-CBC` 解密**自动移除 PKCS#7 填充**（对 AES 而言 PKCS#5Padding 与
   * PKCS#7Padding 是同一种填充），语义与 Java 一致。
   *
   * 失败（非法 key/iv 长度、密文长度不是 16 的倍数、填充非法）时 WebCrypto 会 reject，
   * 由 `libraryImageBytes.decryptIfNeeded` 的 `catch` 落回原字节 —— 对齐 Kotlin 的
   * `catch (e: Exception) { data }`。
   */
  async decryptAesCbc(
    key: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array,
  ): Promise<Uint8Array> {
    if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
      // Kotlin 的 `SecretKeySpec(keyBytes, "AES")` 在长度非法时构造即抛
      // `InvalidKeyException`，被外层 catch 吞掉 → 返回原字节。
      throw new Error(`AES key 长度非法: ${key.length}（需 16 / 24 / 32）`);
    }
    if (iv.length !== 16) {
      // `IvParameterSpec` 同样在构造时校验 16 字节。
      throw new Error(`AES-CBC IV 长度非法: ${iv.length}（需 16）`);
    }
    const cryptoKey = await subtle().importKey(
      'raw',
      asBufferSource(key),
      { name: 'AES-CBC' },
      false,
      ['decrypt'],
    );
    const plain = await subtle().decrypt(
      { name: 'AES-CBC', iv: asBufferSource(iv) },
      cryptoKey,
      asBufferSource(ciphertext),
    );
    return new Uint8Array(plain);
  }

  /** Kotlin `MhttuImageDecryptor.keyBytes`（`private`，仅本模块内使用）。 */
  get mhttuKeyBytes(): Uint8Array {
    return this.mhttuKey.slice();
  }
}

/** Kotlin `MhttuImageDecryptor.keyBytes` 的默认构造。 */
export function defaultMhttuKey(): Uint8Array {
  return new TextEncoder().encode(MHTTU_KEY_SOURCE).slice(0, 32);
}

export function createWebCrypto(options: WebCryptoOptions = {}): WebCrypto {
  return new WebCrypto(options);
}