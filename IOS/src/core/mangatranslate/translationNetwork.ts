import type { HttpClient, HttpRequest, KeyValueStore } from '@platform/interfaces';
import {
  LLM_MAX_RESPONSE_BYTES, LlmGlossary, PROMPT_FALLBACK, buildGeminiRequest, buildLlmUserPayload, buildOpenAiCompatibleRequest,
  llmBatchGuard, llmTranslateBuckets, parseGeminiContent, parseOpenAiContent, parseStrictLlmResponse,
  sanitizeLlmEndpoint, type LlmConfig, type LlmItem,
} from './llmTranslator';
import {
  GOOGLE_GTX_ENDPOINT_TEMPLATE, GOOGLE_GTX_USER_AGENT, ONLINE_MAX_RESPONSE_BYTES, ONLINE_READ_TIMEOUT_MS,
  TRANSMART_ENDPOINT, TRANSMART_REFERER, TRANSMART_USER_AGENT, assertTransmartBatchLimits, buildTransmartBody,
  gtxSourceLang, parseGtx, parseTransmart,
} from './scriptDetector';
import type { TranslatedRegion } from './translationCore';
import prompt from './llm_prompt.txt?raw';

class TranslationRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

export class MangaTranslationNetwork {
  constructor(
    private readonly http: HttpClient,
    private readonly preferences: KeyValueStore,
    private readonly privacyAllowed: () => Promise<boolean>,
  ) {}

  private async request(req: HttpRequest, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new DOMException('已取消漫画翻译', 'AbortError');
    if (!await this.privacyAllowed()) throw new TranslationRequestError('隐私模式或无痕浏览下不可翻译', false);
    if (signal?.aborted) throw new DOMException('已取消漫画翻译', 'AbortError');
    const response = await this.http.request({ ...req, ...(signal ? { signal } : {}) });
    if (response.status < 200 || response.status >= 300) {
      throw new TranslationRequestError('翻译请求失败（HTTP ' + response.status + '）', response.status === 408 || response.status === 429 || response.status >= 500);
    }
    return new TextDecoder().decode(response.body);
  }

  private async onlineBatch(texts: string[], lang: string, signal?: AbortSignal): Promise<string[]> {
    assertTransmartBatchLimits(texts);
    try {
      const raw = await this.request({ url: TRANSMART_ENDPOINT, method: 'POST', body: buildTransmartBody(texts, lang),
        headers: { 'Content-Type': 'application/json', 'User-Agent': TRANSMART_USER_AGENT, Referer: TRANSMART_REFERER },
        timeoutMs: ONLINE_READ_TIMEOUT_MS, maxResponseBytes: ONLINE_MAX_RESPONSE_BYTES }, signal);
      const translated = parseTransmart(raw, texts.length);
      if (translated?.some((text) => text.trim())) return translated;
    } catch (error) {
      if (signal?.aborted || (error instanceof TranslationRequestError && error.message.startsWith('隐私'))) throw error;
    }
    const out: string[] = [];
    for (const text of texts) {
      const url = GOOGLE_GTX_ENDPOINT_TEMPLATE.replace('{sl}', encodeURIComponent(gtxSourceLang(lang))).replace('{q}', encodeURIComponent(text));
      try {
        const raw = await this.request({ url, headers: { 'User-Agent': GOOGLE_GTX_USER_AGENT },
          timeoutMs: ONLINE_READ_TIMEOUT_MS, maxResponseBytes: ONLINE_MAX_RESPONSE_BYTES }, signal);
        out.push(parseGtx(raw) ?? '');
      } catch (error) {
        if (signal?.aborted || (error instanceof TranslationRequestError && error.message.startsWith('隐私'))) throw error;
        out.push('');
      }
    }
    return out;
  }

  private async requestAi(config: LlmConfig, instructions: string, batch: readonly LlmItem[],
    glossary: LlmGlossary, timeoutMs: number, signal?: AbortSignal): Promise<Map<number, string>> {
    let url: string, body: string;
    try {
      const payload = buildLlmUserPayload(batch, glossary.snapshot());
      const request = config.geminiFormat ? buildGeminiRequest(config, instructions, payload) : buildOpenAiCompatibleRequest(config, instructions, payload);
      url = sanitizeLlmEndpoint(request.url, config.geminiFormat); body = request.body;
    } catch (error) { throw new TranslationRequestError(error instanceof Error ? error.message : 'API 地址无效', false); }
    const raw = await this.request({ url, method: 'POST', body, redirect: 'error', timeoutMs,
      maxResponseBytes: LLM_MAX_RESPONSE_BYTES, headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: 'Bearer ' + config.apiKey } : {}) } }, signal);
    const content = config.geminiFormat ? parseGeminiContent(raw) : parseOpenAiContent(raw);
    const translations = content && parseStrictLlmResponse(content, batch, glossary);
    if (!translations) throw new TranslationRequestError('大模型译文格式无效', true);
    return translations;
  }

  async testConnection(engine: 'ai' | 'online', config: LlmConfig, signal?: AbortSignal): Promise<string> {
    const text = 'Hello, how are you?', start = performance.now();
    let translated: string | undefined;
    if (engine === 'online') {
      translated = (await this.onlineBatch([text], 'en', signal))[0];
    } else {
      const batch = [{ id: 0, text }];
      if (llmBatchGuard(batch, true, config) !== 'proceed') throw new Error('请先配置 AI 地址和模型名');
      translated = (await this.requestAi(config, PROMPT_FALLBACK, batch, LlmGlossary.fromJson(null), 15_000, signal)).get(0);
    }
    if (!translated?.trim()) throw new Error('未获得有效译文，请检查网络');
    return '连接成功 · ' + Math.round(performance.now() - start) + ' ms · ' + translated.trim();
  }

  private async ai(regions: readonly TranslatedRegion[], config: LlmConfig, signal?: AbortSignal): Promise<Map<number, string>> {
    const items = llmTranslateBuckets(regions);
    const gate = llmBatchGuard(items, await this.privacyAllowed(), config);
    if (gate !== 'proceed') throw new TranslationRequestError(
      gate === 'privacy-blocked' ? '隐私模式或无痕浏览下不可翻译' : gate === 'oversized' ? '翻译请求过大' : '请先配置自定义 AI 翻译引擎', false);
    const batches: LlmItem[][] = [];
    let chars = 0;
    for (const item of items) {
      if (item.text.length > 6000) throw new TranslationRequestError('单个对白过长', false);
      if (!batches.length || batches.at(-1)!.length >= 20 || chars + item.text.length > 6000) { batches.push([]); chars = 0; }
      batches.at(-1)!.push(item); chars += item.text.length;
    }
    const deadline = Date.now() + 28_000, out = new Map<number, string>();
    const glossaryKey = 'mangaTranslate.glossary';
    const glossary = LlmGlossary.fromJson(this.preferences.get(glossaryKey) ?? null);
    for (const batch of batches) {
      for (let attempt = 0; ; attempt++) {
        try {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new TranslationRequestError('大模型翻译超时', true);
          const translations = await this.requestAi(config, prompt, batch, glossary, remaining, signal);
          for (const [id, value] of translations) out.set(id, value);
          this.preferences.set(glossaryKey, glossary.toJson());
          break;
        } catch (error) {
          if (signal?.aborted || attempt > 0 || (error instanceof TranslationRequestError && !error.retryable)) throw error;
          await new Promise<void>((resolve) => setTimeout(resolve, 400));
        }
      }
    }
    return out;
  }

  async translate(regions: readonly TranslatedRegion[], engine: string, config: LlmConfig, signal?: AbortSignal,
    stage: (message: string) => void = () => {}): Promise<TranslatedRegion[]> {
    if (!regions.length) return [];
    if (engine === 'ai') {
      stage('大模型翻译对白…');
      try {
        const out = await this.ai(regions, config, signal);
        const translated = regions.map((region, index) => ({ ...region, translated: out.get(index)?.trim() ?? '' }));
        if (translated.some((region) => region.translated)) return translated;
        throw new TranslationRequestError('大模型未返回可用译文', true);
      } catch (error) {
        if (signal?.aborted || (error instanceof TranslationRequestError && !error.retryable)) throw error;
        stage('大模型暂不可用 · 正在用免 Key 机翻…');
      }
    } else stage('在线翻译对白…');
    const grouped = new Map<string, number[]>(), result = regions.map((region) => ({ ...region }));
    regions.forEach((region, index) => {
      const list = grouped.get(region.lang) ?? []; list.push(index); grouped.set(region.lang, list);
    });
    for (const [lang, indexes] of grouped) {
      const batch = await this.onlineBatch(indexes.map((index) => regions[index]!.original), lang, signal);
      indexes.forEach((index, offset) => { result[index]!.translated = batch[offset]?.trim() ?? ''; });
    }
    if (!result.some((region) => region.translated)) throw new Error('未获取到可用译文');
    return result;
  }
}
