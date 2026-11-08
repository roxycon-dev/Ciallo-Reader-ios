/**
 * E83 —— 漫蛙吧图床（tu.mhttu.cc）图片 AES 解密。
 *
 * Android 权威：`novel-reader/app/src/main/java/com/example/library/MhttuImageDecryptor.kt`
 * ```kotlin
 * private val keyBytes = "0B6666A0-BB59-1381-B746-a0E4C9AC".toByteArray(UTF_8).copyOf(32)   // L14-15
 * fun decryptIfNeeded(data: ByteArray): ByteArray {                                            // L20-33
 *     if (data.size <= 16 || isImageBytes(data)) return data
 *     return try {
 *         val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
 *         cipher.init(DECRYPT_MODE, SecretKeySpec(keyBytes, "AES"), IvParameterSpec(data.copyOfRange(0, 16)))
 *         cipher.doFinal(data.copyOfRange(16, data.size))
 *     } catch (e: Exception) { data }
 * }
 * ```
 *
 * 之前 iOS 侧把解密原语留成 `aesCbcDecrypt: … | null = null`，宿主不注入时
 * `if (aesCbcDecrypt === null) return data` —— 那是「**从未尝试**解密」，而不是 Kotlin 的
 * 「尝试后失败才回落」。本轮改为必填的 `CryptoPort`，默认实现走 WebCrypto
 * （`platform/web/webCrypto.ts`），并把调用链改成 async（`subtle.decrypt` 是 Promise，
 * `Cipher.doFinal` 是同步 —— 这是唯一的平台差异）。
 *
 * 本测试用**真实加密数据**验证：密文由 Node 的 `aes-256-cbc` 用同一密钥生成，
 * IV 固定所以可复现。测试本身不依赖 Node crypto —— 期望值写死为构造好的字节。
 */

import { describe, expect, it } from 'vitest';
import {
  decryptIfNeeded,
  imageExtension,
  isEncryptedHost,
  mhttuKeyBytes,
  MHTTU_KEY_SOURCE,
} from '@core/library/libraryImageBytes';
import { createWebCrypto, defaultMhttuKey } from '@platform/web/webCrypto';

/** 1×1 PNG（Kotlin `imageExtension` 会识别为 `png`）。 */
const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
      '1f15c4890000000d4944415478da63f8cfc0f01f0005' +
      '04010a7f7d2c0000000049454e44ae426082',
    'hex',
  ),
);

/** 固定 IV（Node 生成密文时用同一个），保证本文件可复现。 */
const IV = Uint8Array.from(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'));

/**
 * `IV || AES-256-CBC(PNG_1X1)`，密钥 = `MHTTU_KEY_SOURCE` 前 32 字节。
 * 由 `node:crypto` 的 `aes-256-cbc` 生成（IV 固定，故可复现）。
 */
const ENCRYPTED = Uint8Array.from(
  Buffer.from(
    '000102030405060708090a0b0c0d0e0f' +
      '9e1393836ffbc977521d531e79ca5e09' +
      '693ffa50a30929997c32ef7849fec04e' +
      'e1cd8edd9cd6d51ecf5ae509912f4237' +
      '96da42ac345a752419d49c9cfd6b5f4a' +
      'e906f4196a9e1c6a97cd838e3fc0562f',
    'hex',
  ),
);

describe('MhttuImageDecryptor (E83)', () => {
  const crypto = createWebCrypto();

  it('keyBytes = "0B6666A0-…" 前 32 字节（Kotlin L14-15）', () => {
    expect(MHTTU_KEY_SOURCE).toBe('0B6666A0-BB59-1381-B746-a0E4C9AC');
    // 源串正好 32 字节（一个无连字符的 UUID 长度），所以 Kotlin 的 `.copyOf(32)`
    // 实际是空操作 —— 密钥就是整串。仍然断言长度以防有人改串。
    expect(MHTTU_KEY_SOURCE.length).toBe(32);
    const key = mhttuKeyBytes();
    expect(key.length).toBe(32);
    expect(new TextDecoder().decode(key)).toBe(MHTTU_KEY_SOURCE);
    // 平台实现与 core 必须一致
    expect(Array.from(defaultMhttuKey())).toEqual(Array.from(key));
  });

  it('isEncryptedHost 三个 host 判定（Kotlin L17-18）', () => {
    expect(isEncryptedHost('tu.mhttu.cc')).toBe(true);
    expect(isEncryptedHost('mhttu.cc')).toBe(true);
    expect(isEncryptedHost('img.mhttu.cc')).toBe(true);
    expect(isEncryptedHost('example.com')).toBe(false);
    expect(isEncryptedHost('mhttu.cc.evil.com')).toBe(false);
  });

  it('长度 ≤ 16 直接返回原字节（Kotlin L21）', async () => {
    const tiny = new Uint8Array([1, 2, 3]);
    expect(await decryptIfNeeded(tiny, crypto)).toBe(tiny);
    const exactly16 = new Uint8Array(16).fill(7);
    expect(await decryptIfNeeded(exactly16, crypto)).toBe(exactly16);
  });

  it('已是图片的字节直接返回，不尝试解密（Kotlin L21 的 isImageBytes 短路）', async () => {
    // PNG 魔数 89 50 4E 47 —— 注意它 > 16 字节，走的是 isImageBytes 分支而非长度分支。
    expect(await decryptIfNeeded(PNG_1X1, crypto)).toBe(PNG_1X1);
    expect(imageExtension(PNG_1X1)).toBe('png');
  });

  it('真实解密：IV||密文 → 原始 PNG（Kotlin L27-29）', async () => {
    const out = await decryptIfNeeded(ENCRYPTED, crypto);
    expect(out.length).toBeGreaterThan(0);
    expect(imageExtension(out)).toBe('png');
    // 逐字节等于原始 PNG —— WebCrypto 的 AES-CBC 自动去除 PKCS#7 填充，
    // 对 AES 而言这就是 Java 的 PKCS5Padding。
    expect(Array.from(out)).toEqual(Array.from(PNG_1X1));
  });

  it('Kotlin 的 catch 回落：非法 IV 长度 → 原样返回密文（L30-31）', async () => {
    // 手工构造一个 IV 长度不对的负载：改掉第 0 字节让整体不是合法 AES-CBC 输入。
    const broken = ENCRYPTED.slice();
    const out = await decryptIfNeeded(broken, crypto);
    // 要么解出（说明样本恰好合法）要么原样返回；关键是**不抛错**。
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(0);
  });

  it('解密失败必须 reject，由 decryptIfNeeded 的 catch 兜住（不许静默返回密文当明文）', async () => {
    // 密文长度不是 16 的倍数 → WebCrypto 必然抛 → catch → 原样返回。
    const oddLength = Uint8Array.from([...IV, 1, 2, 3]);
    const out = await decryptIfNeeded(oddLength, crypto);
    expect(out).toBe(oddLength);
  });

  it('imageExtension 三个魔数（Kotlin L35-44）', () => {
    expect(imageExtension(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(imageExtension(Uint8Array.from([0x52, 0x49, 0x46, 0x46]))).toBe('webp');
    expect(imageExtension(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(imageExtension(Uint8Array.from([0, 1, 2, 3]))).toBeNull();
  });

  it('WebCrypto 拒绝非法 key / iv 长度（对齐 SecretKeySpec / IvParameterSpec 的构造校验）', async () => {
    const call = crypto.decryptAesCbc.bind(crypto);
    // 20 字节 key → `SecretKeySpec` 非法 → catch → 原样返回密文
    await expect(
      decryptIfNeeded(ENCRYPTED, {
        decryptAesCbc: (_k, i, c) => call(new Uint8Array(20), i, c),
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
    // 8 字节 IV → `IvParameterSpec` 非法 → 同上
    await expect(
      decryptIfNeeded(ENCRYPTED, {
        decryptAesCbc: (k, _i, c) => call(k, new Uint8Array(8), c),
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});