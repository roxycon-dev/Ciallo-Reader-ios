/**
 * `data/NetworkSpeech.kt`（191 行）→ `src/core/data/networkSpeech.ts`。
 *
 * 朗读的两条网络通路：
 *
 * - **`custom`**：用户自建的 OpenAI 兼容 TTS 端点（`POST {model, voice, input, speed,
 *   response_format:"mp3"}`，可选 `Authorization: Bearer`）。这条完整移植。
 * - **`edge` / `voices`**：微软 Edge Read Aloud 的官方端点，需要 `EdgeVoiceProof`
 *   生成的客户端证明（proof-of-work）才能握手。**不移植** —— 见 `PARITY_EXCEPTIONS.md`
 *   E219 与 `parityLedger.mjs` 的 `ADAPTATIONS` 登记。这两个方法保留签名并显式抛错，
 *   调用方（`TtsManager`）在 `source == Edge` 时回落到系统语音。
 *
 * 三处细节：
 * 1. **`CustomVoiceService.valid()` 允许明文仅限本机**（`localhost` / `127.0.0.1` /
 *    `::1`），或 token 为空（无凭据可泄露）；其余必须 HTTPS，且禁止 URL 里带
 *    username/password/fragment —— 否则 token 会明文飞到中间人手里。
 * 2. **`rate` 原样作为 `speed` 传**（Kotlin `rate.toDouble()`），不做 0.5–2.0 夹取：
 *    服务端自己决定范围。
 * 3. **响应上限 8 MiB**（`MAX_CLIP`），空响应直接抛错 —— 空 mp3 会让播放器卡住。
 */

/** L26 `enum class SpeechSource { System, Edge, Custom }`。 */
export const SpeechSource = {
  System: 'System',
  Edge: 'Edge',
  Custom: 'Custom',
} as const;
export type SpeechSource = (typeof SpeechSource)[keyof typeof SpeechSource];

/** L28 `data class CustomVoiceService(url, token, model, voice)`。 */
export interface CustomVoiceService {
  readonly url: string;
  readonly token: string;
  readonly model: string;
  readonly voice: string;
}

/** L179 `const val MAX_CLIP = 8 * 1024 * 1024`。 */
export const MAX_SPEECH_CLIP_BYTES = 8 * 1024 * 1024;

/**
 * L29-34 `CustomVoiceService.valid()`。
 *
 * 明文只允许本机三地址，或 token 为空；URL 不得内嵌凭据或 fragment。
 */
export function customVoiceServiceValid(config: CustomVoiceService): boolean {
  let endpoint: URL;
  try {
    endpoint = new URL(config.url);
  } catch {
    return false;
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') return false;
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
  const httpsOrSafe = endpoint.protocol === 'https:' || config.token.trim() === '' || localHost;
  return (
    httpsOrSafe &&
    endpoint.username === '' &&
    endpoint.password === '' &&
    endpoint.hash === '' &&
    config.model.trim() !== '' &&
    config.voice.trim() !== ''
  );
}

/** L37 `data class EdgeVoice(name, locale, label)`。 */
export interface EdgeVoice {
  readonly name: string;
  readonly locale: string;
  readonly label: string;
}

/** `NetworkSpeech` 需要的 HTTP 能力（`okhttp` 的替身）。 */
export interface SpeechHttpClient {
  request(spec: {
    readonly url: string;
    readonly method: 'GET' | 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: Uint8Array;
    readonly maxBytes?: number;
  }): Promise<{ readonly status: number; readonly body: Uint8Array }>;
}

/** L39 `internal class NetworkSpeech`。 */
export class NetworkSpeech {
  constructor(private readonly http: SpeechHttpClient) {}

  /**
   * L48-61 `voices()` —— **未移植**。
   *
   * 它从 `speech.platform.bing.com` 的 `/voices/list` 拉列表，握手要求
   * `EdgeVoiceProof.value(now)` 生成的 `Sec-MS-GEC` 令牌（客户端证明）。
   */
  async voices(): Promise<EdgeVoice[]> {
    throw new Error('Edge 朗读未移植：需要微软客户端的 proof-of-work 证明，见 E219');
  }

  /**
   * L63-131 `edge(text, voice, rate, pitch)` —— **未移植**，理由同上。
   *
   * WebSocket 握手头里的 `Sec-MS-GEC` / `Sec-MS-GEC-Version` 就是 `EdgeVoiceProof`
   * 的产物；没有它服务端直接 403。
   */
  async edge(_text: string, _voice: EdgeVoice, _rate: number, _pitch: number): Promise<Uint8Array> {
    throw new Error('Edge 朗读未移植：需要微软客户端的 proof-of-work 证明，见 E219');
  }

  /** L132-142 `custom(text, config, rate)` —— 用户自建端点，完整移植。 */
  async custom(text: string, config: CustomVoiceService, rate: number): Promise<Uint8Array> {
    if (!customVoiceServiceValid(config)) throw new Error('require failed: config.valid()');
    const body = JSON.stringify({
      model: config.model,
      voice: config.voice,
      input: text,
      speed: rate,
      response_format: 'mp3',
    });
    const headers: Record<string, string> = {
      Accept: 'audio/mpeg, audio/*, application/octet-stream',
      'Content-Type': 'application/json',
    };
    if (config.token.trim() !== '') headers['Authorization'] = `Bearer ${config.token}`;
    const response = await this.http.request({
      url: config.url,
      method: 'POST',
      headers,
      body: new TextEncoder().encode(body),
      maxBytes: MAX_SPEECH_CLIP_BYTES,
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`Speech HTTP ${String(response.status)}`);
    if (response.body.length === 0) throw new Error('Speech 返回空音频');
    return response.body;
  }
}

/** L183-191 `automaticEdgeVoice(locale)` —— 按语言挑默认神经语音。 */
export function automaticEdgeVoice(locale: string): EdgeVoice {
  const language = locale.toLowerCase().split(/[-_]/)[0] ?? '';
  let name = 'en-US-EmmaMultilingualNeural';
  let tag = 'en-US';
  if (language === 'zh') {
    name = 'zh-CN-XiaoxiaoNeural';
    tag = 'zh-CN';
  } else if (language === 'ja') {
    name = 'ja-JP-NanamiNeural';
    tag = 'ja-JP';
  } else if (language === 'ko') {
    name = 'ko-KR-SunHiNeural';
    tag = 'ko-KR';
  }
  return { name, locale: tag, label: name };
}

/** L173 `signed(value)` —— SSML 里的 `+12` / `-8`。 */
export function signedRate(value: number): string {
  const rounded = Math.trunc(value);
  return `${rounded >= 0 ? '+' : ''}${String(rounded)}`;
}

/** L175-176 `xml(text)` —— 去控制字符并转义三字符。 */
export function speechXml(text: string): string {
  return Array.from(text)
    .filter((char) => char >= ' ' || char === '\n' || char === '\t')
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
