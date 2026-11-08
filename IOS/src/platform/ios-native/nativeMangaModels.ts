import { registerPlugin } from '@capacitor/core';
import { AsyncMutex } from '@core/data/contentMutationGate';
import { ALL_MODELS, MODEL_DIR, MODEL_MAX_BYTES, MODEL_DOWNLOAD_USER_AGENT, assertModelDownloadSizes, httpFailureMessage, incompleteDownloadMessage, progressCallbacks, validateModelDownloadUrl, type ModelSpec } from '@core/mangatranslate/modelManager';
import type { FileSystemApi, HttpClient, HttpStreamResponse } from '@platform/interfaces';
import { base64ToBytes } from './capacitorHttpClient';
import { nonThenablePlugin } from './pluginProxy';

export type MangaModel = 'det' | 'rec' | 'bubble';
export interface ModelTensor { shape: number[]; data: Float32Array }
export interface RecognitionSteps { tokens: number[]; confidence: number[] }
interface TensorOutput { id: string; tensors: { shape: number[]; size: number }[] }
interface MangaModelsNative {
  status(): Promise<{ files: Record<MangaModel, number> }>;
  commit(options: { model: MangaModel }): Promise<{ size: number }>;
  remove(): Promise<void>;
  infer(options: { model: MangaModel; image: string; validWidth?: number }): Promise<TensorOutput | RecognitionSteps>;
  read(options: { id: string; index: number; offset: number; length: number }): Promise<{ data: string }>;
  release(options: { id?: string; sessions?: boolean }): Promise<void>;
}

const KEYS: readonly MangaModel[] = ['det', 'rec', 'bubble'];
const CHUNK_SIZE = 512 * 1024;
const aborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('已取消漫画翻译', 'AbortError');
};

export class NativeMangaModels {
  private readonly operations = new AsyncMutex();
  private readonly inference = new AsyncMutex();
  private files: Record<MangaModel, number> = { det: 0, rec: 0, bubble: 0 };
  private pending: Promise<string | null> | undefined;
  private readonly observers = new Set<(fraction: number) => void>();

  constructor(
    private readonly fs: FileSystemApi,
    private readonly http: HttpClient,
    private readonly native: MangaModelsNative = nonThenablePlugin(registerPlugin<MangaModelsNative>('ReaderMangaModels')),
  ) {}

  get ready(): boolean { return KEYS.every((key) => this.files[key] > 0); }
  get totalBytes(): number { return KEYS.reduce((total, key) => total + this.files[key], 0); }
  refresh(): Promise<boolean> {
    return this.operations.withLock(async () => {
      this.files = (await this.native.status()).files;
      return this.ready;
    });
  }

  ensureDownloaded(onProgress: (fraction: number) => void = () => {}): Promise<string | null> {
    this.observers.add(onProgress);
    const report = (fraction: number) => {
      for (const observer of this.observers) observer(fraction);
    };
    this.pending ??= this.operations.withLock(async () => {
      this.files = (await this.native.status()).files;
      let done = 0;
      for (const [index, key] of KEYS.entries()) {
        const spec = ALL_MODELS[index]!;
        const progress = progressCallbacks(done, spec);
        if (!this.files[key]) this.files[key] = await this.download(key, spec, (p) => report(progress.during(p)));
        done += this.files[key];
        report(progress.after(done));
      }
      report(1);
      return null;
    }).catch((error: unknown) => error instanceof Error ? error.message : String(error)).finally(() => {
      this.pending = undefined;
    });
    return this.pending.finally(() => { this.observers.delete(onProgress); });
  }

  private async download(key: MangaModel, spec: ModelSpec, progress: (fraction: number) => void): Promise<number> {
    const consume = this.http.consume, append = this.fs.appendFile;
    if (!consume || !append) throw new Error('无法写入翻译模型');
    const path = MODEL_DIR + '/' + spec.fileName + '.part';
    let lastError = '';
    for (const raw of spec.urls) {
      try {
        const url = validateModelDownloadUrl(raw);
        await this.fs.writeFile(path, new Uint8Array());
        const write = async (response: HttpStreamResponse) => {
          validateModelDownloadUrl(response.url);
          if (response.status !== 200) throw new Error(httpFailureMessage(response.status, url));
          if (response.size < spec.minBytes) throw new Error(incompleteDownloadMessage(spec, response.size));
          let written = 0, lastReport = 0;
          for await (const chunk of response.chunks) {
            if (written + chunk.length > response.size) throw new Error('模型文件过大');
            await append.call(this.fs, path, chunk);
            written += chunk.length;
            if (Date.now() - lastReport > 150) { lastReport = Date.now(); progress(written / response.size); }
          }
          assertModelDownloadSizes(response.size, written);
        };
        await consume.call(this.http, { url, timeoutMs: 120_000, maxResponseBytes: MODEL_MAX_BYTES,
          headers: { 'User-Agent': MODEL_DOWNLOAD_USER_AGENT } }, write);
        return (await this.native.commit({ model: key })).size;
      } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
      finally { if (await this.fs.exists(path).catch(() => false)) await this.fs.delete(path).catch(() => {}); }
    }
    throw new Error(spec.label + '下载失败：' + lastError);
  }

  async remove(): Promise<void> {
    await this.operations.withLock(() => this.inference.withLock(async () => {
      await this.native.remove();
      this.files = { det: 0, rec: 0, bubble: 0 };
    }));
  }

  async closeSessions(): Promise<void> {
    await this.inference.withLock(() => this.native.release({ sessions: true }));
  }

  run(model: 'rec', image: string, signal?: AbortSignal, validWidth?: number): Promise<RecognitionSteps>;
  run(model: 'det' | 'bubble', image: string, signal?: AbortSignal): Promise<ModelTensor[]>;
  run(model: MangaModel, image: string, signal?: AbortSignal, validWidth?: number): Promise<RecognitionSteps | ModelTensor[]> {
    return this.inference.withLock(async () => {
      aborted(signal);
      const result = await this.native.infer({ model, image, ...(validWidth === undefined ? {} : { validWidth }) });
      if ('tokens' in result) { aborted(signal); return result; }
      try {
        const output: ModelTensor[] = [];
        for (const [index, tensor] of result.tensors.entries()) {
          if (!tensor.shape.every((size) => Number.isSafeInteger(size) && size > 0) || tensor.size <= 0 ||
            tensor.size > 32 * 1024 * 1024 || tensor.shape.reduce((a, b) => a * b, 4) !== tensor.size) throw new Error('翻译推理结果尺寸无效');
          const bytes = new Uint8Array(tensor.size);
          for (let offset = 0; offset < tensor.size; offset += CHUNK_SIZE) {
            aborted(signal);
            const length = Math.min(CHUNK_SIZE, tensor.size - offset);
            const chunk = base64ToBytes((await this.native.read({ id: result.id, index, offset, length })).data);
            if (chunk.length !== length) throw new Error('翻译推理结果不完整');
            bytes.set(chunk, offset);
          }
          output.push({ shape: tensor.shape, data: new Float32Array(bytes.buffer) });
        }
        aborted(signal);
        return output;
      } finally { await this.native.release({ id: result.id }); }
    });
  }
}
