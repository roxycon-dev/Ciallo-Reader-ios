/**
 * E34/E41 护栏 —— 纯 TS AES 与 Kotlin `javax.crypto.Cipher` 的四种 transformation 对齐。
 *
 * 权威来源：`source/js/JsMessageHandler.kt:357-375`
 *
 * ```
 * "aes-ecb" -> "AES/ECB/NoPadding"
 * "aes-cbc" -> "AES/CBC/PKCS5Padding"
 * "aes-cfb" -> "AES/CFB/NoPadding"
 * "aes-ofb" -> "AES/OFB/NoPadding"
 * ```
 *
 * ## 为什么必须用官方向量
 *
 * 本文件的 S 盒不是硬编码常量表，而是运行时按 GF(2^8) 求逆 + 仿射变换构造的
 * （理由见 `src/core/crypto/aes.ts` 顶部注释）。这意味着**「表对不对」无法靠
 * 人眼审阅常量确认**，只能靠对照 NIST/FIPS-197 公布的测试向量验证。
 * 若 S 盒有任何一处算错，AES 会静默产出错误明文 —— 书源侧表现为「解出来是乱码」，
 * 极难定位。所以下面的官方向量是本实现的**正确性锚点**，一个都不能省。
 */
import { describe, expect, it } from 'vitest';
import { aesCbcEncrypt, aesCfbEncrypt, aesDecrypt, aesEcbEncrypt, aesOfbEncrypt, pkcs7Pad } from '@core/crypto/aes';

const hex = (s: string): Uint8Array => {
  const clean = s.replace(/\s+/gu, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

const toHex = (b: Uint8Array): string =>
  Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');

/* ══════════════ FIPS-197 附录 B/C 官方测试向量 ══════════════ */

describe('E34：FIPS-197 官方测试向量（ECB 方向）', () => {
  // FIPS-197 Appendix B：明文/密文皆取自规范原文，是 AES 的规范级基准。
  const PLAINTEXT = hex('00112233445566778899aabbccddeeff');

  it('AES-128（密钥 000102…0f）→ 69c4e0d86a7b0430d8cdb78070b4c55a', () => {
    const cipher = aesEcbEncrypt(
      hex('000102030405060708090a0b0c0d0e0f'),
      PLAINTEXT,
    );
    expect(toHex(cipher)).toBe('69c4e0d86a7b0430d8cdb78070b4c55a');
  });

  it('AES-192（密钥 000102…17）→ dda97ca4864cdfe06eaf70a0ec0d7191', () => {
    const cipher = aesEcbEncrypt(
      hex('000102030405060708090a0b0c0d0e0f1011121314151617'),
      PLAINTEXT,
    );
    expect(toHex(cipher)).toBe('dda97ca4864cdfe06eaf70a0ec0d7191');
  });

  it('AES-256（密钥 000102…1f）→ 8ea2b7ca516745bfeafc49904b496089', () => {
    const cipher = aesEcbEncrypt(
      hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'),
      PLAINTEXT,
    );
    expect(toHex(cipher)).toBe('8ea2b7ca516745bfeafc49904b496089');
  });

  it('ECB 解密是 ECB 加密的逆运算（三种密钥长度都验）', () => {
    const keys = [
      '000102030405060708090a0b0c0d0e0f',
      '000102030405060708090a0b0c0d0e0f1011121314151617',
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    ];
    for (const k of keys) {
      const round = aesEcbEncrypt(hex(k), PLAINTEXT);
      const back = aesDecrypt('AES/ECB/NoPadding', hex(k), null, round);
      expect(toHex(back)).toBe('00112233445566778899aabbccddeeff');
    }
  });

  it('ECB 解密命中 FIPS-197 附录 C.1 的密文向量', () => {
    const back = aesDecrypt(
      'AES/ECB/NoPadding',
      hex('000102030405060708090a0b0c0d0e0f'),
      null,
      hex('69c4e0d86a7b0430d8cdb78070b4c55a'),
    );
    expect(toHex(back)).toBe('00112233445566778899aabbccddeeff');
  });

  /**
   * 密钥扩展的 RCON 必须 XOR 到**字首字节**（最高字节）。
   *
   * 本条是专门为一次真实缺陷写的防回归护栏。曾经的写法是
   * `temp = (temp ^ RCON[i / nk]) >>> 0` —— 在 `Uint32` 大端存放下，
   * RCON 被 XOR 到了**最低字节**，使整条密钥扩展从 `w[4]` 起全部偏移。
   *
   * 全零密钥是这条护栏的**最佳探针**，因为它让偏差变得可推导、可口述：
   *   - 全零密钥下 `w[0..3]` 全为 0；
   *   - `w[4] = SubWord(RotWord(0)) ^ RCON[1] = S(0)^4 ^ 0x01`，而 `S(0)=0x63`，
   *     所以 `w[4]` 必为 `0x63636363 ^ 0x01`；
   *   - RCON[1] = 0x01 落在**最高字节** → `w[4] = 0x62636363`；
   *     落在**最低字节** → `w[4] = 0x63636362`。
   *
   * 两者只差一个字，且没有任何自洽性检查能发现（自己加密自己解密照样还原），
   * 只有对照外部权威实现才暴露 —— 故这里直接钉一个 OpenSSL 实测值。
   * 该期望值由 `node:crypto` 的 `aes-128-ecb` + 全零密钥产出，非凭记忆书写。
   */
  it('防回归：全零密钥下 RCON 落在字首字节（非字尾）', () => {
    const cipher = aesEcbEncrypt(new Uint8Array(16), PLAINTEXT);
    expect(toHex(cipher)).toBe('c8a331ff8edd3db175e1545dbefb760b');
  });
});

/* ══════════════ NIST SP 800-38A：CBC/CFB/OFB 官方向量 ══════════════ */

/**
 * NIST SP 800-38A 的 F.1/F.2/F.3/F.4 节给出四种模式的标准向量，
 * 三种密钥长度各一组。本测试取 AES-128 与 AES-256 两组（覆盖 Nk=4 与 Nk=8
 * 两条不同的密钥扩展分支 —— Nk=8 有额外的 `i % Nk === 4` SubWord）。
 */
const SP800_38A = {
  key128: '2b7e151628aed2a6abf7158809cf4f3c',
  key256: '603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4',
  iv: '000102030405060708090a0b0c0d0e0f',
  // F.1 CBC / F.3 CFB128 / F.4 OFB 共用的 4 个明文块
  plaintext: hex(
    '6bc1bee22e409f96e93d7e117393172a' +
      'ae2d8a571e03ac9c9eb76fac45af8e51' +
      '30c81c46a35ce411e5fbc1191a0a52ef' +
      'f69f2445df4f9b17ad2b417be66c3710',
  ),
} as const;

const P0 = SP800_38A.plaintext.subarray(0, 16);
const P1 = SP800_38A.plaintext.subarray(16, 32);

describe('E34：NIST SP 800-38A 模式向量（CBC / CFB / OFB）', () => {
  it('AES-128-CBC：K.1 的首个密文块是 7649abac8119b246cee98e9b12e9197d', () => {
    const cipher = aesCbcEncrypt(
      hex(SP800_38A.key128),
      hex(SP800_38A.iv),
      P0,
    );
    expect(toHex(cipher.subarray(0, 16))).toBe('7649abac8119b246cee98e9b12e9197d');
  });

  it('AES-128-CFB128：K.3 的首个密文块是 3b3fd92eb72dad20333449f8e83cfb4a', () => {
    // CFB 解密方向与加密方向互逆，这里用「解密自己加密的产物」验证，
    // 官方向量则由下面的独立 CFB 加密测试覆盖。
    const iv = hex(SP800_38A.iv);
    const key = hex(SP800_38A.key128);
    const cipherText = hex('3b3fd92eb72dad20333449f8e83cfb4a');
    const plain = aesDecrypt('AES/CFB/NoPadding', key, iv, cipherText);
    expect(toHex(plain)).toBe('6bc1bee22e409f96e93d7e117393172a');
  });

  it('AES-128-OFB：K.4 的首个密文块是 3b3fd92eb72dad20333449f8e83cfb4a', () => {
    // OFB 的 C_1 与 CFB128 的 C_1 相同 —— 因为两者都用 E(K, IV) 作首个分支密钥，
    // 差别只在后续反馈值是 C_i（CFB）还是 O_i（OFB）。
    const plain = aesDecrypt(
      'AES/OFB/NoPadding',
      hex(SP800_38A.key128),
      hex(SP800_38A.iv),
      hex('3b3fd92eb72dad20333449f8e83cfb4a'),
    );
    expect(toHex(plain)).toBe('6bc1bee22e409f96e93d7e117393172a');
  });

  it('CFB128 与 OFB 在第二块开始分道扬镳（反馈值不同）', () => {
    // 这是最容易写错的一处：两者首块相同，若反馈值也写成 C_i 则 OFB 会退化成 CFB。
    // K.3(CFB) 第二块密文 = c8a64537a0b3a93fcde3cdad9f1ce58b
    // K.4 (OFB) 第二块密文 = 7789508d16918f03f53c52dac54ed825
    const key = hex(SP800_38A.key128);
    const iv = hex(SP800_38A.iv);
    const twoBlocks = hex(
      '3b3fd92eb72dad20333449f8e83cfb4a' + 'c8a64537a0b3a93fcde3cdad9f1ce58b',
    );
    expect(toHex(aesDecrypt('AES/CFB/NoPadding', key, iv, twoBlocks).subarray(16, 32)))
      .toBe('ae2d8a571e03ac9c9eb76fac45af8e51');

    const ofbTwo = hex(
      '3b3fd92eb72dad20333449f8e83cfb4a' + '7789508d16918f03f53c52dac54ed825',
    );
    expect(toHex(aesDecrypt('AES/OFB/NoPadding', key, iv, ofbTwo).subarray(16, 32)))
      .toBe('ae2d8a571e03ac9c9eb76fac45af8e51');
  });

  it('CFB128 / OFB 加密方向同样对齐官方向量（防止往返自洽掩盖错误）', () => {
    // ⚠️ 这一组是**加密**方向。只测解密会漏掉一类危险错误：CFB 的反馈值
    // 若误写成上一块**明文**，解密侧用同样的错误反馈就能自洽还原，往返测试全绿，
    // 但与 Java Cipher 的字节输出完全不同 —— 书源侧表现为「部分站点解出乱码」。
    // 故加密方向必须单独对照 SP 800-38A 的 C_1..C_4。
    const key = hex(SP800_38A.key128);
    const iv = hex(SP800_38A.iv);
    // K.1 的 P_1..P_4
    const plain = hex(
      '6bc1bee22e409f96e93d7e117393172a' +
      'ae2d8a571e03ac9c9eb76fac45af8e51' +
      '30c81c46a35ce411e5fbc1191a0a52ef' +
      'f69f2445df4f9b17ad2b417be66c3710',
    );

    // K.3 CFB128-AES128 的 C_1..C_4
    // ⚠️ 这些期望值全部由 `node:crypto` 的 `aes-128-cfb` 逐块产出后抄录，
    // 不是凭记忆写的 —— 手写密码学时凭记忆核对规范常量极易出错（本次就踩过：
    // C_3 记忆值写成 `...e9fdea7b59a`，实际是 `...8cf187a4f4dfc`）。
    expect(toHex(aesCfbEncrypt(key, iv, plain))).toBe(
      '3b3fd92eb72dad20333449f8e83cfb4a' +
      'c8a64537a0b3a93fcde3cdad9f1ce58b' +
      '26751f67a3cbb140b1808cf187a4f4df' +
      'c04b05357c5d1c0eeac4c66f9ff7f2e6',
    );

    // K.4 OFB-AES128 的 C_1..C_4
    expect(toHex(aesOfbEncrypt(key, iv, plain))).toBe(
      '3b3fd92eb72dad20333449f8e83cfb4a' +
      '7789508d16918f03f53c52dac54ed825' +
      '9740051e9c5fecf64344f7a82260edcc' +
      '304c6528f659c77866a510d9c1d6ae5e',
    );
  });

  it('AES-256 四种模式都与 AES-128 自洽（覆盖 Nk=8 密钥扩展分支）', () => {
    const key = hex(SP800_38A.key256);
    const iv = hex(SP800_38A.iv);
    // AES-256-CBC F.2 首个密文块
    expect(toHex(aesCbcEncrypt(key, iv, P0).subarray(0, 16)))
      .toBe('f58c4c04d6e5f1ba779eabfb5f7bfbd6');
    // CFB128 / OFB：必须用**真实模式密文**往返，不能拿 ECB 密文代替 ——
    // `E_K(P1) ^ P1 ≠ P1`，用 ECB 密文当 CFB 密文在密码学上不成立。
    const cfb = aesCfbEncrypt(key, iv, P0);
    expect(toHex(aesDecrypt('AES/CFB/NoPadding', key, iv, cfb))).toBe(toHex(P0));
    const ofb = aesOfbEncrypt(key, iv, P0);
    expect(toHex(aesDecrypt('AES/OFB/NoPadding', key, iv, ofb))).toBe(toHex(P0));
  });
});

/* ══════════════ CBC 的 PKCS#7 填充语义 ══════════════ */

describe('E34：AES/CBC/PKCS5Padding 的填充语义', () => {
  const key = hex('000102030405060708090a0b0c0d0e0f');
  const iv = hex('000102030405060708090a0b0c0d0e0f');

  it('明文长度恰好是块长时补满一整块 0x10（PKCS#7 而非 PKCS#5）', () => {
    const padded = pkcs7Pad(new Uint8Array(16));
    expect(padded.length).toBe(32);
    expect(padded[16]).toBe(16);
    expect(padded[31]).toBe(16);
  });

  it('往返：加密 → 解密 得回原文（含空输入）', () => {
    for (const len of [0, 1, 15, 16, 17, 31, 32, 100]) {
      const plain = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) plain[i] = i & 0xff;
      const cipher = aesCbcEncrypt(key, iv, plain);
      const back = aesDecrypt('AES/CBC/PKCS5Padding', key, iv, cipher);
      expect(toHex(back)).toBe(toHex(plain));
    }
  });

  it('填充字节非法时抛错（对齐 javax.crypto 的 BadPaddingException）', () => {
    // 造一个末字节为 0 的密文 —— PKCS#7 不允许 pad=0
    const bad = new Uint8Array(16);
    expect(() => aesDecrypt('AES/CBC/PKCS5Padding', key, iv, bad)).toThrow(/去填充/);
  });

  it('密文长度非块整数倍时抛错', () => {
    expect(() => aesDecrypt('AES/CBC/PKCS5Padding', key, iv, new Uint8Array(17)))
      .toThrow(/非 16 的倍数/);
  });
});

/* ══════════════ 参数校验：逐条对齐 javax.crypto 的异常 ══════════════ */

describe('E34：参数校验与 IV 语义（对齐 JsMessageHandler.kt:364-373）', () => {
  const key = hex('000102030405060708090a0b0c0d0e0f');
  const iv = hex('000102030405060708090a0b0c0d0e0f');

  it('密钥长度非 16/24/32 时抛错（对齐 SecretKeySpec 的 IllegalArgumentException）', () => {
    for (const len of [8, 15, 17, 33]) {
      expect(() => aesDecrypt('AES/ECB/NoPadding', new Uint8Array(len), null, new Uint8Array(16)))
        .toThrow(/密钥长度非法/);
    }
  });

  it('IV 长度非 16 时抛错（对齐 IvParameterSpec 的 IllegalArgumentException）', () => {
    expect(() => aesDecrypt('AES/CBC/PKCS5Padding', key, new Uint8Array(8), new Uint8Array(16)))
      .toThrow(/IV 长度/);
  });

  it('ECB 不需要 IV：传 null 与传空数组都应成功（Kotlin `iv.isNotEmpty()` 判空）', () => {
    const data = aesEcbEncrypt(key, P1);
    expect(aesDecrypt('AES/ECB/NoPadding', key, null, data).length).toBe(16);
    expect(aesDecrypt('AES/ECB/NoPadding', key, new Uint8Array(0), data).length).toBe(16);
  });

  it('ECB 传入非空 IV 时必须**忽略**它（Kotlin 侧 ECB 也会走 iv 分支）', () => {
    // `JsMessageHandler.kt:368-373` 只判断 `iv != null && iv.isNotEmpty()`，
    // 不区分模式 —— 所以书源若给 `aes-ecb` 也带上 iv 字段，Java 侧会用
    // `IvParameterSpec` 调 `cipher.init`，而 `AES/ECB` 的 JCE 实现会
    // **忽略**该参数（ECB 无 IV 概念）。这里钉住「忽略」而非「报错」。
    const data = aesEcbEncrypt(key, P1);
    expect(toHex(aesDecrypt('AES/ECB/NoPadding', key, iv, data))).toBe(toHex(P1));
    // 换一个完全不同的 IV，结果必须不变 —— 证明确实被忽略而非参与了运算
    expect(toHex(aesDecrypt('AES/ECB/NoPadding', key, new Uint8Array(16).fill(0xa5), data)))
      .toBe(toHex(P1));
  });

  it('CBC/CFB/OFB 缺 IV 时抛错（对齐 JCE 缺 IvParameterSpec 的行为）', () => {
    for (const mode of ['AES/CBC/PKCS5Padding', 'AES/CFB/NoPadding', 'AES/OFB/NoPadding'] as const) {
      expect(() => aesDecrypt(mode, key, null, new Uint8Array(16))).toThrow(/需要 IV/);
      expect(() => aesDecrypt(mode, key, new Uint8Array(0), new Uint8Array(16)))
        .toThrow(/需要 IV/);
    }
  });

  it('ECB 密文长度非块整数倍时抛错', () => {
    expect(() => aesDecrypt('AES/ECB/NoPadding', key, null, new Uint8Array(15)))
      .toThrow(/非 16 的倍数/);
  });
});

/* ══════════════ 通过 CryptoPort 端到端验证 ══════════════ */

describe('E34：CryptoPort 端到端（jsSourcePlatform 的 aesDecrypt 已接线）', () => {
  it('四种模式全部可用，未注入原生实现时不再抛「需要原生实现」', async () => {
    const { createWebCryptoPort } = await import('@platform/web/jsSourcePlatform');
    const { installSyncDigestImpl } = await import('@platform/web/jsSourcePlatform');
    // 摘要与 AES 无关，但 CryptoPort.digest 需要它才能构造，这里给个最小桩
    installSyncDigestImpl({
      md5: () => new Uint8Array(16),
      sha1: () => new Uint8Array(20),
      sha256: () => new Uint8Array(32),
      hmac: () => new Uint8Array(32),
    });

    const port = createWebCryptoPort();
    const key = hex('000102030405060708090a0b0c0d0e0f');
    const iv = hex('000102030405060708090a0b0c0d0e0f');

    // ECB 往返
    const ecbCipher = aesEcbEncrypt(key, P0);
    expect(toHex(port.aesDecrypt('AES/ECB/NoPadding', key, null, ecbCipher))).toBe(toHex(P0));

    // CBC 往返
    const cbcCipher = aesCbcEncrypt(key, iv, P0);
    expect(toHex(port.aesDecrypt('AES/CBC/PKCS5Padding', key, iv, cbcCipher))).toBe(toHex(P0));

    // CFB / OFB 往返 —— 用各自模式产生的真实密文，不能复用 ECB 密文
    const cfbCipher = aesCfbEncrypt(key, iv, P0);
    expect(toHex(port.aesDecrypt('AES/CFB/NoPadding', key, iv, cfbCipher))).toBe(toHex(P0));
    const ofbCipher = aesOfbEncrypt(key, iv, P0);
    expect(toHex(port.aesDecrypt('AES/OFB/NoPadding', key, iv, ofbCipher))).toBe(toHex(P0));
  });

  it('注入原生实现时优先走注入（便于与 Java Cipher 逐字节对照）', async () => {
    const { createWebCryptoPort } = await import('@platform/web/jsSourcePlatform');
    const { installSyncDigestImpl } = await import('@platform/web/jsSourcePlatform');
    installSyncDigestImpl({
      md5: () => new Uint8Array(16),
      sha1: () => new Uint8Array(20),
      sha256: () => new Uint8Array(32),
      hmac: () => new Uint8Array(32),
    });

    const seen: string[] = [];
    const port = createWebCryptoPort({
      aesDecrypt: (mode) => {
        seen.push(mode);
        return new Uint8Array([0xaa]);
      },
    });
    const key = hex('000102030405060708090a0b0c0d0e0f');
    const out = port.aesDecrypt('AES/OFB/NoPadding', key, null, new Uint8Array(16));
    expect(seen).toEqual(['AES/OFB/NoPadding']);
    expect(out[0]).toBe(0xaa);
  });

  it('RSA 仍未注入时显式抛错（不静默降级）', async () => {
    const { createWebCryptoPort } = await import('@platform/web/jsSourcePlatform');
    const { installSyncDigestImpl } = await import('@platform/web/jsSourcePlatform');
    installSyncDigestImpl({
      md5: () => new Uint8Array(16),
      sha1: () => new Uint8Array(20),
      sha256: () => new Uint8Array(32),
      hmac: () => new Uint8Array(32),
    });
    const port = createWebCryptoPort();
    expect(() => port.rsaDecrypt(new Uint8Array([1]), 'PEM')).toThrow(/原生实现/);
  });
});