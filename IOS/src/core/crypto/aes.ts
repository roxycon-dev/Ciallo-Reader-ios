/**
 * 纯 TypeScript AES 实现 —— 对齐 Kotlin `javax.crypto.Cipher`。
 *
 * Kotlin → TS: NONE（`java.crypto` 无直接对应）。权威行为来自
 * `source/js/JsMessageHandler.kt` lines 357-375：
 *
 * ```
 * "aes-ecb", "aes-cbc", "aes-cfb", "aes-ofb" -> {
 *     val mode = when (type) {
 *         "aes-ecb" -> "AES/ECB/NoPadding"
 *         "aes-cbc" -> "AES/CBC/PKCS5Padding"
 *         "aes-cfb" -> "AES/CFB/NoPadding"
 *         else      -> "AES/OFB/NoPadding"
 *     }
 *     val key  = bytesOf(msg["key"]) ?: return null
 *     val data = bytesOf(value) ?: return null
 *     val cipher = Cipher.getInstance(mode)
 *     val keySpec = SecretKeySpec(key, "AES")
 *     val iv = bytesOf(msg["iv"])
 *     if (iv != null && iv.isNotEmpty()) {
 *         cipher.init(Cipher.DECRYPT_MODE, keySpec, IvParameterSpec(iv))
 *     } else {
 *         cipher.init(Cipher.DECRYPT_MODE, keySpec)
 *     }
 *     cipher.doFinal(data)
 * }
 * ```
 *
 * WHY 不用 WebCrypto：E34/E41 已核实 `crypto.subtle` 支持 `AES-CBC`，但**不支持**
 * `AES/ECB/NoPadding`、`AES/CFB/NoPadding`、`AES/OFB/NoPadding` —— 而 Kotlin 恰好实现了
 * 这四种（`JsSourceEngine.kt:396-399` 四个 `Convert.decryptAesXxx`）。AES 是纯数学算法、
 * **不依赖任何平台能力**，因此与 E61 同性质：应当在这里用纯 TS 实现，而不是等原生桥。
 *
 * 算法本体为 FIPS-197（NIST 公告）标准，公开规范，无版权约束。
 */

/* ── FIPS-197 S 盒与逆 S 盒 ─────────────────────────────────────────────── */

/**
 * S 盒（正向）。构造方式刻意写成**运行时按 GF(2^8) 求逆 + 仿射变换**，
 * 而不是硬编码 256 项常量表：
 *   - 256 个魔数容易抄错，而抄错一个字节 = 静默产出错误密文，极难排查；
 *   - 运行时构造让「表对不对」这件事由下面的 `aesDecrypt` 单测对照
 *     FIPS-197 官方测试向量来验证，而不是靠人眼审阅常量。
 *
 * 代价是首帧几十微秒的构造开销 —— 对书源解密这种按需调用完全可忽略。
 */
const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);

{
  // GF(2^8) 模多项式 x^8 + x^4 + x^3 + x + 1 = 0x11b（FIPS-197 §4.2）
  const mul = (a: number, b: number): number => {
    let result = 0;
    let x = a;
    let y = b;
    while (y !== 0) {
      if ((y & 1) !== 0) result ^= x;
      x = (x << 1) ^ ((x & 0x80) !== 0 ? 0x11b : 0);
      y >>>= 1;
    }
    return result & 0xff;
  };

  // 先求 0 的乘法逆元；0 的逆元定义为 0（数学上不存在，但 AES 约定如此）
  const inverse = new Uint8Array(256);
  inverse[0] = 0;
  for (let a = 1; a < 256; a += 1) {
    for (let b = 1; b < 256; b += 1) {
      if (mul(a, b) === 1) {
        inverse[a] = b;
        break;
      }
    }
  }

  // 正向 S 盒：仿射变换 b_i' = b_i ^ b_(i+4) ^ b_(i+5) ^ b_(i+6) ^ b_(i+7) ^ c_i
  //                其中 b_i 是逆元的第 i 位（i=0 为 LSB），c = 0x63
  for (let i = 0; i < 256; i += 1) {
    const inv = inverse[i] as number;
    let s = inv;
    let bit = inv;
    for (let round = 0; round < 4; round += 1) {
      bit = ((bit << 1) | (bit >>> 7)) & 0xff;
      s ^= bit;
    }
    s ^= 0x63;
    SBOX[i] = s;
    INV_SBOX[s] = i;
  }
}

/** Rijndael 轮常量 RCON（共 11 项，AES-256 用到第 10 轮）。 */
const RCON = new Uint8Array([
  0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36,
]);

/* ── 轮密钥扩展（FIPS-197 §5.2） ────────────────────────────────────────── */

/**
 * 展开后的 AES 轮密钥。`words` 是 `4 × (Nk + 10)` 个 32 位字，
 * 以 `Uint32Array` 大端序存放（每字 4 字节，与状态矩阵列对应）。
 */
interface ExpandedKey {
  /** 每字字节数恒为 4 —— 用 Uint32 存是为了让 AddRoundKey 变成一次 XOR 数组运算。 */
  words: Uint32Array;
  /** 密钥字数：4（AES-128）/ 6（AES-192）/ 8（AES-256）。 */
  nk: number;
}

const BLOCK_SIZE = 16;

function expandKey(key: Uint8Array): ExpandedKey {
  const nk = key.length / 4;
  if (!Number.isInteger(nk) || nk < 4 || nk > 8) {
    throw new Error(`AES 密钥长度非法：${key.length} 字节（须为 16/24/32）`);
  }
  const total = 4 * (nk + 10);
  const words = new Uint32Array(total);
  for (let i = 0; i < nk; i += 1) {
    words[i] =
      (((key[i * 4] as number) << 24) |
        ((key[i * 4 + 1] as number) << 16) |
        ((key[i * 4 + 2] as number) << 8) |
        (key[i * 4 + 3] as number)) >>>
      0;
  }
  for (let i = nk; i < total; i += 1) {
    let temp = words[i - 1] as number;
    if (i % nk === 0) {
      // RotWord：循环左移一个字节
      temp = ((temp << 8) | (temp >>> 24)) >>> 0;
      // SubWord：逐字节过 S 盒
      temp =
        ((((SBOX[(temp >>> 24) & 0xff] as number) << 24) |
          ((SBOX[(temp >>> 16) & 0xff] as number) << 16) |
          ((SBOX[(temp >>> 8) & 0xff] as number) << 8) |
          (SBOX[temp & 0xff] as number)) >>>
          0);
      // RCON 必须 XOR 到**最高字节**（字节数组语义下的第 0 字节 = 字首）。
      // ⚠️ 这里曾因把 RCON 直接 XOR 到整个 uint32 上、落到了**最低字节**而
      // 导致整条密钥扩展偏移 1 —— S 盒、ShiftRows、MixColumns 全对，输出仍全错。
      // `Uint32` 大端存放使「字首字节」= `>>> 24`，故需先左移 24 位。
      temp = (temp ^ ((RCON[i / nk] as number) << 24)) >>> 0;
    } else if (nk > 6 && i % nk === 4) {
      // AES-256 专属：每 4 个字额外做一次 SubWord
      temp =
        ((((SBOX[(temp >>> 24) & 0xff] as number) << 24) |
          ((SBOX[(temp >>> 16) & 0xff] as number) << 16) |
          ((SBOX[(temp >>> 8) & 0xff] as number) << 8) |
          (SBOX[temp & 0xff] as number)) >>>
          0);
    }
    words[i] = ((words[i - nk] as number) ^ temp) >>> 0;
  }
  return { words, nk };
}

/* ── 分组加解密核心（FIPS-197 §5.1/§5.3） ──────────────────────────────── */

/** 状态矩阵按列填入的临时缓冲（16 字节）。 */
type Block = Uint8Array;

function addRoundKey(state: Block, words: Uint32Array, round: number): void {
  const base = round * 4;
  for (let c = 0; c < 4; c += 1) {
    const w = words[base + c] as number;
    state[c * 4] = (state[c * 4] as number) ^ ((w >>> 24) & 0xff);
    state[c * 4 + 1] = (state[c * 4 + 1] as number) ^ ((w >>> 16) & 0xff);
    state[c * 4 + 2] = (state[c * 4 + 2] as number) ^ ((w >>> 8) & 0xff);
    state[c * 4 + 3] = (state[c * 4 + 3] as number) ^ (w & 0xff);
  }
}

function subBytes(state: Block): void {
  for (let i = 0; i < BLOCK_SIZE; i += 1) {
    state[i] = SBOX[state[i] as number] as number;
  }
}

function invSubBytes(state: Block): void {
  for (let i = 0; i < BLOCK_SIZE; i += 1) {
    state[i] = INV_SBOX[state[i] as number] as number;
  }
}

/** GF(2^8) 乘法，用于 MixColumns。 */
function xtime(a: number): number {
  return ((a << 1) ^ ((a & 0x80) !== 0 ? 0x1b : 0)) & 0xff;
}

function mul(a: number, b: number): number {
  let result = 0;
  let x = a;
  let y = b;
  while (y !== 0) {
    if ((y & 1) !== 0) result ^= x;
    x = xtime(x);
    y >>>= 1;
  }
  return result & 0xff;
}

function mixColumns(state: Block): void {
  for (let c = 0; c < 4; c += 1) {
    const i = c * 4;
    const a0 = state[i] as number;
    const a1 = state[i + 1] as number;
    const a2 = state[i + 2] as number;
    const a3 = state[i + 3] as number;
    state[i] = mul(a0, 2) ^ mul(a1, 3) ^ a2 ^ a3;
    state[i + 1] = a0 ^ mul(a1, 2) ^ mul(a2, 3) ^ a3;
    state[i + 2] = a0 ^ a1 ^ mul(a2, 2) ^ mul(a3, 3);
    state[i + 3] = mul(a0, 3) ^ a1 ^ a2 ^ mul(a3, 2);
  }
}

function invMixColumns(state: Block): void {
  for (let c = 0; c < 4; c += 1) {
    const i = c * 4;
    const a0 = state[i] as number;
    const a1 = state[i + 1] as number;
    const a2 = state[i + 2] as number;
    const a3 = state[i + 3] as number;
    state[i] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9);
    state[i + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13);
    state[i + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11);
    state[i + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14);
  }
}

function shiftRows(state: Block): void {
  // 行 r 循环左移 r 字节（状态按列填入，故行 r 的元素是 [r, r+4, r+8, r+12]）
  const s = state.slice();
  for (let r = 1; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      state[r + c * 4] = s[r + ((c + r) % 4) * 4] as number;
    }
  }
}

function invShiftRows(state: Block): void {
  const s = state.slice();
  for (let r = 1; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      state[r + ((c + r) % 4) * 4] = s[r + c * 4] as number;
    }
  }
}

/** 单个 AES 分组解密（等价于 `Cipher` 的 ECB 单块运算）。 */
function decryptBlock(block: Block, expanded: ExpandedKey): Block {
  const state = block.slice();
  const { words, nk } = expanded;
  const rounds = nk + 6;
  addRoundKey(state, words, rounds);
  for (let round = rounds - 1; round >= 1; round -= 1) {
    invShiftRows(state);
    invSubBytes(state);
    addRoundKey(state, words, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  invSubBytes(state);
  addRoundKey(state, words, 0);
  return state;
}

/** 单个 AES 分组加密（仅用于 CBC/CFB/OFB 的加密方向，以及测试向量自校验）。 */
function encryptBlock(block: Block, expanded: ExpandedKey): Block {
  const state = block.slice();
  const { words, nk } = expanded;
  const rounds = nk + 6;
  addRoundKey(state, words, 0);
  for (let round = 1; round < rounds; round += 1) {
    subBytes(state);
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, words, round);
  }
  subBytes(state);
  shiftRows(state);
  addRoundKey(state, words, rounds);
  return state;
}

/* ── PKCS#5/PKCS#7 去填充 ───────────────────────────────────────────────── */

/**
 * `AES/CBC/PKCS5Padding` 的解密侧去填充。
 *
 * Kotlin 侧是 `javax.crypto` 的 `PKCS5Padding`；AES 块长 16 > PKCS#5 的 8，
 * 所以 SunJCE 在 AES 下实际按 **PKCS#7** 处理（这是 JCE 的既定行为，也是
 * 唯一能让 `padding==16` 成立的解释）。故此处按 PKCS#7 实现。
 *
 * 输入不合法时**抛错**（而非静默返回原文）—— 对齐 `javax.crypto`：
 * `doFinal` 遇到坏填充抛 `BadPaddingException`，被 `handleConvert` 的
 * `catch (e: Exception)` 捕获后返回 `null`。
 */
function stripPkcs7(data: Uint8Array): Uint8Array {
  if (data.length === 0 || data.length % BLOCK_SIZE !== 0) {
    throw new Error(`AES-CBC 去填充失败：长度 ${data.length} 非 16 的正倍数`);
  }
  const pad = data[data.length - 1] as number;
  if (pad < 1 || pad > BLOCK_SIZE || pad > data.length) {
    throw new Error(`AES-CBC 去填充失败：填充长度 ${pad} 非法`);
  }
  for (let i = data.length - pad; i < data.length; i += 1) {
    if (data[i] !== pad) {
      throw new Error('AES-CBC 去填充失败：填充字节不一致');
    }
  }
  return data.subarray(0, data.length - pad);
}

/** PKCS#7 填充（加密侧，供测试向量与将来的加密需求使用）。 */
export function pkcs7Pad(data: Uint8Array): Uint8Array {
  const pad = BLOCK_SIZE - (data.length % BLOCK_SIZE);
  const out = new Uint8Array(data.length + pad);
  out.set(data);
  out.fill(pad, data.length);
  return out;
}

/* ── 四种模式（对应 Kotlin 的四个 Cipher transformation） ────────────────── */

/** Kotlin `AES/ECB/NoPadding` —— 各分组独立解密，无 IV、无填充。 */
function decryptEcbNoPadding(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (data.length % BLOCK_SIZE !== 0) {
    throw new Error(`AES-ECB 解密失败：长度 ${data.length} 非 16 的倍数`);
  }
  const expanded = expandKey(key);
  const out = new Uint8Array(data.length);
  for (let off = 0; off < data.length; off += BLOCK_SIZE) {
    out.set(decryptBlock(data.subarray(off, off + BLOCK_SIZE), expanded), off);
  }
  return out;
}

/** Kotlin `AES/CBC/PKCS5Padding` —— 链式解密 + 去填充。 */
function decryptCbcPkcs5(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Uint8Array {
  if (data.length % BLOCK_SIZE !== 0) {
    throw new Error(`AES-CBC 解密失败：长度 ${data.length} 非 16 的倍数`);
  }
  if (iv.length !== BLOCK_SIZE) {
    throw new Error(`AES-CBC 解密失败：IV 长度 ${iv.length} != 16`);
  }
  const expanded = expandKey(key);
  const out = new Uint8Array(data.length);
  let previous = iv;
  for (let off = 0; off < data.length; off += BLOCK_SIZE) {
    const cipherBlock = data.subarray(off, off + BLOCK_SIZE);
    const plain = decryptBlock(cipherBlock, expanded);
    for (let i = 0; i < BLOCK_SIZE; i += 1) {
      out[off + i] = (plain[i] as number) ^ (previous[i] as number);
    }
    previous = cipherBlock;
  }
  return stripPkcs7(out);
}

/**
 * CFB 的 Java 语义：**CFB128**（`AES/CFB/NoPadding` 在 JCE 里就是 CFB128）。
 *
 * 解密方向：`P_i = C_i ^ E(IV | i)`，即用**加密**运算生成分支密钥。
 * 这里严格用 CFB128（而非按 `blockSize` 参数切片的 CFB8/16/32）——
 * Kotlin 的 transformation 字符串里没有位数，JCE 默认 128；
 * 书源侧传的 `blockSize` 参数在 `JsSourceEngine.kt:398` 里并不参与模式选择。
 */
function decryptCfbNoPadding(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Uint8Array {
  if (data.length % BLOCK_SIZE !== 0) {
    throw new Error(`AES-CFB 解密失败：长度 ${data.length} 非 16 的倍数`);
  }
  if (iv.length !== BLOCK_SIZE) {
    throw new Error(`AES-CFB 解密失败：IV 长度 ${iv.length} != 16`);
  }
  const expanded = expandKey(key);
  const out = new Uint8Array(data.length);
  let feedback = iv;
  for (let off = 0; off < data.length; off += BLOCK_SIZE) {
    const cipherBlock = data.subarray(off, off + BLOCK_SIZE);
    const stream = encryptBlock(feedback, expanded);
    for (let i = 0; i < BLOCK_SIZE; i += 1) {
      out[off + i] = (cipherBlock[i] as number) ^ (stream[i] as number);
    }
    feedback = cipherBlock;
  }
  return out;
}

/**
 * OFB：解密方向与加密方向**完全相同**（`P_i = C_i ^ O_i`，`O_i = E(O_{i-1})`）。
 * `NoPadding` → 输入长度必须是 16 的倍数，输出等长。
 */
function decryptOfbNoPadding(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Uint8Array {
  if (data.length % BLOCK_SIZE !== 0) {
    throw new Error(`AES-OFB 解密失败：长度 ${data.length} 非 16 的倍数`);
  }
  if (iv.length !== BLOCK_SIZE) {
    throw new Error(`AES-OFB 解密失败：IV 长度 ${iv.length} != 16`);
  }
  const expanded = expandKey(key);
  const out = new Uint8Array(data.length);
  let feedback = iv;
  for (let off = 0; off < data.length; off += BLOCK_SIZE) {
    const cipherBlock = data.subarray(off, off + BLOCK_SIZE);
    const stream = encryptBlock(feedback, expanded);
    for (let i = 0; i < BLOCK_SIZE; i += 1) {
      out[off + i] = (cipherBlock[i] as number) ^ (stream[i] as number);
    }
    feedback = stream;
  }
  return out;
}

/* ── 对外入口 ───────────────────────────────────────────────────────────── */

/** Kotlin `CryptoPort.aesDecrypt` 的四种 mode 字符串。 */
export type AesMode =
  | 'AES/ECB/NoPadding'
  | 'AES/CBC/PKCS5Padding'
  | 'AES/CFB/NoPadding'
  | 'AES/OFB/NoPadding';

/**
 * `CryptoPort.aesDecrypt` 的纯 TS 实现。
 *
 * IV 语义与 Kotlin 严格一致（`JsMessageHandler.kt:368-373`）：
 * `iv == null || iv.isEmpty()` 时**不传 IV**（等价于 `cipher.init(DECRYPT_MODE, keySpec)`，
 * 此时 Cipher 用其内部默认 IV —— 实际只有 ECB 会走到这里成功）。
 * 非空但长度不等于 16 时**抛错**，对齐 `IvParameterSpec` 的 `IllegalArgumentException`
 * （被 Kotlin 的 `catch (e: Exception)` 吞成 `null`）。
 *
 * @throws 密钥长度非法 / 数据长度非块整数倍 / 填充非法 —— 对齐 JCE 的异常语义，
 *         上层 `handleConvert` 对应的 TS 代码会把异常转成 `null` 返回。
 */
export function aesDecrypt(
  mode: AesMode,
  key: Uint8Array,
  iv: Uint8Array | null,
  data: Uint8Array,
): Uint8Array {
  const hasIv = iv !== null && iv.length > 0;
  if (!hasIv) {
    // Kotlin：无 IV 时走 `cipher.init(DECRYPT_MODE, keySpec)`。
    // ECB 不需要 IV，因此只有它能在这条路径上成功；其余三种 JCE 会因缺少
    // 参数类型所需的 IV 而抛 `InvalidAlgorithmParameterException`。
    if (mode !== 'AES/ECB/NoPadding') {
      throw new Error(`AES 解密失败：模式 ${mode} 需要 IV，但未提供`);
    }
    return decryptEcbNoPadding(data, key);
  }
  switch (mode) {
    case 'AES/ECB/NoPadding':
      return decryptEcbNoPadding(data, key);
    case 'AES/CBC/PKCS5Padding':
      return decryptCbcPkcs5(data, key, iv);
    case 'AES/CFB/NoPadding':
      return decryptCfbNoPadding(data, key, iv);
    case 'AES/OFB/NoPadding':
      return decryptOfbNoPadding(data, key, iv);
    default: {
      // 类型系统已穷举，这里兜底以防 JS 调用方传入未知字符串。
      const unknown: never = mode;
      throw new Error(`AES 解密失败：不支持的模式 ${String(unknown)}`);
    }
  }
}

/* ── 加密方向（测试向量用；书源侧只解密，但 CBC 加密用于构造测试向量） ──────── */

/** `AES/CBC/PKCS5Padding` 加密（测试用；与 `pkcs7Pad` + CFB 同一套原语）。 */
export function aesCbcEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  const expanded = expandKey(key);
  const padded = pkcs7Pad(data);
  const out = new Uint8Array(padded.length);
  let previous = iv;
  for (let off = 0; off < padded.length; off += BLOCK_SIZE) {
    const xored = new Uint8Array(BLOCK_SIZE);
    for (let i = 0; i < BLOCK_SIZE; i += 1) {
      xored[i] = (padded[off + i] as number) ^ (previous[i] as number);
    }
    const cipherBlock = encryptBlock(xored, expanded);
    out.set(cipherBlock, off);
    previous = cipherBlock;
  }
  return out;
}

/** `AES/ECB/NoPadding` 加密（测试用；FIPS-197 附录 C 的官方向量需要它）。 */
export function aesEcbEncrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const expanded = expandKey(key);
  const out = new Uint8Array(data.length);
  for (let off = 0; off < data.length; off += BLOCK_SIZE) {
    out.set(encryptBlock(data.subarray(off, off + BLOCK_SIZE), expanded), off);
  }
  return out;
}

/**
 * `AES/CFB/NoPadding` 加密（测试用）。
 *
 * 书源侧只解密，但 CFB128 的正确性**必须靠双向验证**才能证成：只测解密方向的话，
 * 「反馈值用密文还是明文」这类错误会与解密侧的对应错误互相抵消（往返自洽 ≠ 正确）。
 * 对照 NIST SP 800-38A F.3.13 的官方 CFB128 向量即可锁死反馈语义。
 */
export function aesCfbEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  const expanded = expandKey(key);
  const out = new Uint8Array(data.length);
  let feedback = iv;
  for (let off = 0; off < data.length; off += BLOCK_SIZE) {
    const plainBlock = data.subarray(off, off + BLOCK_SIZE);
    const stream = encryptBlock(feedback, expanded);
    const cipherBlock = new Uint8Array(BLOCK_SIZE);
    for (let i = 0; i < BLOCK_SIZE; i += 1) {
      cipherBlock[i] = (plainBlock[i] as number) ^ (stream[i] as number);
    }
    out.set(cipherBlock, off);
    feedback = cipherBlock;
  }
  return out;
}

/** `AES/OFB/NoPadding` 加密（测试用；与解密方向同构，反馈值始终是 `E` 的输出）。 */
export function aesOfbEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  const expanded = expandKey(key);
  const out = new Uint8Array(data.length);
  let feedback = iv;
  for (let off = 0; off < data.length; off += BLOCK_SIZE) {
    const stream = encryptBlock(feedback, expanded);
    const plainBlock = data.subarray(off, off + BLOCK_SIZE);
    for (let i = 0; i < BLOCK_SIZE; i += 1) {
      out[off + i] = (plainBlock[i] as number) ^ (stream[i] as number);
    }
    feedback = stream;
  }
  return out;
}