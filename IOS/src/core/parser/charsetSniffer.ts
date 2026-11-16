export type CharsetName =
  | 'utf-8'
  | 'utf-16le'
  | 'utf-16be'
  | 'gb18030'
  | 'big5'
  | 'shift_jis'
  | 'euc-kr';

const FREQUENT = '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习便响约支般史感劳团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞國體學說這為個們時後會來發經書與關長開無話歡愛讀';

function isISOControl(code: number): boolean {
  return (code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f);
}

/**
 * Java `Character.isWhitespace(int)` restricted to code points above 127 — the
 * set Kotlin filters with (`!it.isWhitespace() && it.code > 127`). JS `/\s/`
 * also matches U+FEFF, which Java does not, so it cannot be used verbatim.
 */
function isKotlinWhitespace(code: number): boolean {
  if (code <= 127) return false;
  if (code === 0xa0 || code === 0x1680) return true;
  if (code >= 0x2000 && code <= 0x200a) return true;
  return code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000;
}

/**
 * Expected total byte length of a multi-byte sequence started by `b`, or 0 when
 * `b` is not a lead byte. Used to reproduce Java's `endOfInput=false` decoder
 * semantics: a trailing *incomplete* sequence is tolerated (and emits nothing),
 * a malformed byte anywhere — including near the tail — is still an error.
 */
function leadSequenceLength(label: CharsetName, b: number): number {
  if (label === 'utf-8') {
    if (b >= 0xc2 && b <= 0xdf) return 2;
    if (b >= 0xe0 && b <= 0xef) return 3;
    if (b >= 0xf0 && b <= 0xf4) return 4;
    return 0;
  }
  // gb18030 / big5 / shift_jis / euc-kr: all 2-byte lead ranges here (Kotlin's
  // CharsetSniffer never reports a truncated GB18030 4-byte sequence as UTF-8
  // either, and the sample window cut lands on a whole lead byte in practice).
  if (label === 'big5') return b >= 0xa1 && b <= 0xf9 ? 2 : 0;
  if (label === 'shift_jis') return (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc) ? 2 : 0;
  return b >= 0x81 && b <= 0xfe ? 2 : 0;
}

function isTrailByte(label: CharsetName, b: number): boolean {
  if (label === 'utf-8') return b >= 0x80 && b <= 0xbf;
  if (label === 'shift_jis') return (b >= 0x40 && b <= 0x7e) || (b >= 0x80 && b <= 0xfc);
  return b >= 0x40 && b <= 0xfe && b !== 0x7f;
}

/**
 * Length of the trailing byte run that forms a *proper prefix* of one
 * multi-byte sequence (i.e. the reader stopped mid-character because the input
 * ended). Returns 0 when the tail is not such a truncated sequence, so a
 * genuinely malformed tail is still rejected.
 */
function truncatedTailLength(label: CharsetName, sample: Uint8Array): number {
  const len = sample.length;
  for (let k = 1; k <= 3 && k < len; k += 1) {
    const lead = sample[len - k] ?? -1;
    if (leadSequenceLength(label, lead) !== k + 1) continue;
    let ok = true;
    for (let j = 1; j < k; j += 1) {
      if (!isTrailByte(label, sample[len - k + j] ?? -1)) {
        ok = false;
        break;
      }
    }
    if (ok) return k;
  }
  return 0;
}

/**
 * `Charset.forName(...)` on Android uses JCS / ICU tables where an undefined
 * table row is *unmappable* and `CodingErrorAction.REPORT` (Kotlin L23) turns it
 * into an exception, so `decode()` returns null for that candidate.
 *
 * The WHATWG `TextDecoder` tables used by browsers/Node instead map undefined
 * rows onto the Unicode Private Use Area (e.g. `big5` 0x81 0x40 → U+EEB8). Those
 * bytes would therefore "decode" here while Java rejects them, which is exactly
 * how `detect(0xFF × 16)` wrongly resolved to Big5. Java's Big5 / Shift_JIS /
 * EUC-KR contain no PUA mappings, so any PUA output proves the sequence was
 * unmappable → treat it as an error.
 *
 * GB18030 is deliberately absent: Java's GB18030 *does* map sequences into
 * U+E000..U+E865 (its user-defined area), so Kotlin accepts those and applies
 * only the `-5.0` `bad` penalty from `score()` (L36).
 */
const REJECTS_PUA_OUTPUT = new Set<CharsetName>(['big5', 'shift_jis', 'euc-kr']);

function hasPrivateUse(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.codePointAt(i) ?? 0;
    if (code >= 0xe000 && code <= 0xf8ff) return true;
    if (code > 0xffff) i += 1;
  }
  return false;
}

function decodeChecked(label: CharsetName, bytes: Uint8Array): string | null {
  const text = new TextDecoder(label, { fatal: true }).decode(bytes);
  if (REJECTS_PUA_OUTPUT.has(label) && hasPrivateUse(text)) return null;
  return text;
}

/**
 * Kotlin CharsetSniffer.kt L22-27: `decoder.decode(buf, out, complete && sample.size == data.size)`.
 * - `complete === true`  → `endOfInput = true`  → any dangling/invalid byte is an error.
 * - `complete === false` → `endOfInput = false` → only a trailing incomplete
 *   sequence underflows (emitting nothing); malformed input is still an error.
 */
function decodeStrict(label: CharsetName, sample: Uint8Array, complete: boolean): string | null {
  try {
    return decodeChecked(label, sample);
  } catch {
    if (complete) return null;
    const trim = truncatedTailLength(label, sample);
    if (trim <= 0) return null;
    try {
      return decodeChecked(label, sample.subarray(0, sample.length - trim));
    } catch {
      return null;
    }
  }
}

function scoreText(text: string): number {
  const useful: string[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (!isKotlinWhitespace(code) && code > 127) useful.push(ch);
  }
  if (useful.length === 0) return 0;
  let common = 0;
  let kana = 0;
  let hangul = 0;
  let bad = 0;
  for (const ch of useful) {
    const code = ch.codePointAt(0) ?? 0;
    if (FREQUENT.includes(ch)) common += 1;
    if (code >= 0x3040 && code <= 0x30ff) kana += 1;
    if (code >= 0xac00 && code <= 0xd7af) hangul += 1;
    if (isISOControl(code) || (code >= 0xe000 && code <= 0xf8ff)) bad += 1;
  }
  const n = useful.length;
  return common / n + (kana / n) * 2 + (hangul / n) * 1.5 - (bad / n) * 5;
}

export function detect(data: Uint8Array): CharsetName {
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return 'utf-8';
  }
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return 'utf-16le';
  }
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    return 'utf-16be';
  }
  const sample = data.slice(0, Math.min(data.length, 65536));
  const pairs = Math.floor(sample.length / 2);
  if (pairs > 8) {
    let even = 0;
    let odd = 0;
    for (let i = 0; i < pairs; i += 1) {
      if (sample[i * 2] === 0) even += 1;
      if (sample[i * 2 + 1] === 0) odd += 1;
    }
    if (odd > pairs / 4 && even < pairs / 10) return 'utf-16le';
    if (even > pairs / 4 && odd < pairs / 10) return 'utf-16be';
  }
  const complete = sample.length === data.length;
  if (decodeStrict('utf-8', sample, complete) !== null) {
    return 'utf-8';
  }
  const candidates: Array<{ name: CharsetName; score: number }> = [];
  for (const name of ['gb18030', 'big5', 'shift_jis', 'euc-kr'] as const) {
    const text = decodeStrict(name, sample, complete);
    if (text !== null) candidates.push({ name, score: scoreText(text) });
  }
  if (candidates.length === 0) {
    throw new Error('无法可靠识别文字编码，请将文件转换为 UTF-8');
  }
  // Kotlin `candidates.maxByOrNull { it.second }?.first ?: error(...)` L42:
  // `maxByOrNull` returns the FIRST element when several tie (all-zero scores
  // therefore resolve to the first candidate, i.e. GB18030 — never an error).
  let best = candidates[0] as { name: CharsetName; score: number };
  for (const c of candidates) {
    if (c.score > best.score) best = c;
  }
  return best.name;
}

export function decodeTextWithCharsetDetection(data: Uint8Array): string {
  const charset = detect(data);
  return new TextDecoder(charset).decode(data);
}