import type { JsSourceEngineApi } from '@core/source/js/jsSourceEngine';
import type { CancellationSignal, HttpResponseSpec } from '@core/source/js/jsPlatform';
import { checkSourceUrl } from '@core/source/networkCalls';
import type { HttpRequest, SecureStore } from '@platform/interfaces';
import type { PlatformBundle } from '@platform/index';
import type { SourceWorkerBoot, SourceWorkerOperation, SourceWorkerRequest, SourceWorkerResponse, WorkerBitmap } from './protocol';
import { verifySourceWebsite } from '@platform/ios-native/websiteVerification';
import SourceWorker from './entry.ts?worker&inline';

export class EnginePreferences {
  values: Record<string, string> = {};
  private writes: Promise<void> = Promise.resolve();
  private loaded = false;
  constructor(private readonly secure: SecureStore, private readonly key: string) {}
  async load(): Promise<void> {
    if (this.loaded) return;
    const raw = await this.secure.get(this.key);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.values = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
      }
    }
    this.loaded = true;
  }
  update(values: Record<string, string>): void {
    this.values = { ...values };
    const json = JSON.stringify(this.values);
    this.writes = this.writes.catch(() => {}).then(() => this.secure.set(this.key, json));
  }
  flush(): Promise<void> { return this.writes; }
}

export async function decodeImage(bytes: Uint8Array): Promise<WorkerBitmap> {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth; const height = image.naturalHeight;
    if (!width || !height || width * height * 4 > 64 * 1024 * 1024) throw new Error('脚本图像内存预算不足');
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('无法准备图片像素');
    context.drawImage(image, 0, 0);
    return { width, height, data: new Uint8Array(context.getImageData(0, 0, width, height).data.buffer) };
  } finally { URL.revokeObjectURL(url); }
}

/** Main-page proxy. Third-party scripts and synchronous handlers never run here. */
export class SourceWorkerEngine implements JsSourceEngineApi {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private sequence = 0;
  private logged = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly platform: PlatformBundle, private readonly boot: Omit<SourceWorkerBoot, 'preferences'>,
    readonly preferences: EnginePreferences, private readonly input: (title: string, image: string | null) => Promise<string>) {
    this.logged = preferences.values[`logged_${boot.sourceKey}`] === 'true';
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.preferences.load().then(() => {
      this.logged = this.preferences.values[`logged_${this.boot.sourceKey}`] === 'true';
      return this.startLoaded();
    }).catch((error: unknown) => { this.reset(); throw error; });
    return this.ready;
  }

  private startLoaded(): Promise<void> {
    const worker = new SourceWorker();
    this.worker = worker;
    this.ready = new Promise<void>((resolve, reject) => {
      const bootTimeout = setTimeout(() => { reject(new Error('书源引擎初始化超时')); this.reset(); }, 15_000);
      worker.onerror = (event) => { clearTimeout(bootTimeout); reject(new Error(event.message)); this.reset(); };
      worker.onmessage = (event: MessageEvent<SourceWorkerResponse>) => {
        const message = event.data;
        if (message.type === 'ready') { clearTimeout(bootTimeout); resolve(); return; }
        if (message.type === 'preferences') { this.preferences.update(message.values); return; }
        if (message.type === 'host') { void this.handleHost(worker, message); return; }
        if (message.type !== 'result') return;
        this.logged = message.logged;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.ok) void this.preferences.flush().then(() => pending.resolve(message.value), pending.reject);
        else pending.reject(new Error(message.error ?? '书源脚本执行失败'));
      };
      worker.postMessage({ type: 'boot', boot: { ...this.boot, preferences: this.preferences.values } } satisfies SourceWorkerRequest);
    });
    return this.ready;
  }

  private async handleHost(worker: Worker, message: Extract<SourceWorkerResponse, { type: 'host' }>): Promise<void> {
    try {
      let value: HttpResponseSpec | string;
      if (message.request.method === 'input') {
        value = await this.input(message.request.title, message.request.image);
      } else if (message.request.method === 'verify') {
        checkSourceUrl(message.request.url);
        value = JSON.stringify(await verifySourceWebsite(message.request.url, message.request.userAgent));
      } else {
        const request = message.request.request;
        checkSourceUrl(request.url);
        if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(request.method)) throw new Error('无效的书源请求方法');
        const response = await this.platform.http.request({
          url: request.url, method: request.method.toUpperCase() as NonNullable<HttpRequest['method']>, headers: request.headers,
          ...(request.body == null ? {} : { body: request.body }), timeoutMs: request.timeouts?.callMs ?? 60_000,
        });
        const cookie = Object.entries(response.headers).find(([name]) => name.toLowerCase() === 'set-cookie')?.[1];
        value = { status: response.status, finalUrl: response.url, headers: response.headers,
          body: response.body, setCookies: cookie ? cookie.split(/,(?=\s*[^;,=\s]+\s*=)/) : [] };
      }
      worker.postMessage({ type: 'hostResult', id: message.id, ok: true, value } satisfies SourceWorkerRequest);
    } catch (error) {
      if (worker === this.worker) worker.postMessage({ type: 'hostResult', id: message.id, ok: false,
        error: error instanceof Error ? error.message : '书源宿主调用失败' } satisfies SourceWorkerRequest);
    }
  }

  private async run(operation: SourceWorkerOperation, signal: CancellationSignal = null): Promise<unknown> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (this.idleTimer) clearTimeout(this.idleTimer);
    await this.start();
    const id = ++this.sequence;
    const abort = (): void => this.reset(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) { abort(); throw new DOMException('Aborted', 'AbortError'); }
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.reset(new Error('书源脚本执行超过 45 秒')), 46_000);
        this.pending.set(id, { resolve, reject, timer });
        this.worker!.postMessage({ type: 'operation', id, operation } satisfies SourceWorkerRequest);
      });
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.pending.size === 0) this.idleTimer = setTimeout(() => this.reset(), 30_000);
    }
  }

  private reset(reason = new Error('书源引擎已释放')): void {
    this.worker?.terminate(); this.worker = null; this.ready = null;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(reason); }
    this.pending.clear();
  }
  async call(code: string, signal: CancellationSignal = null): Promise<string | null> {
    const result = await this.run({ method: 'call', code }, signal);
    return typeof result === 'string' ? result : null;
  }
  isLoggedIn(): boolean { return this.logged; }
  setLoggedIn(logged: boolean): void {
    this.logged = logged;
    this.preferences.update({ ...this.preferences.values, [`logged_${this.boot.sourceKey}`]: String(logged) });
    if (this.worker) void this.run({ method: 'setLoggedIn', logged }).catch(() => {});
  }
  async fetchImageBytes(url: string, headers: Record<string, string>, signal: CancellationSignal = null): Promise<Uint8Array | null> {
    return await this.run({ method: 'imageBytes', url, headers }, signal) as Uint8Array | null;
  }
  async transformImageBlocking(code: string, bytes: Uint8Array): Promise<Uint8Array | null> {
    return await this.run({ method: 'transform', code, bytes, bitmap: await decodeImage(bytes) }) as Uint8Array | null;
  }
}
