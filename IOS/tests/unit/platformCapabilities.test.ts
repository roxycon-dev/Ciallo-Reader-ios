import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_INFO_UNWIRED,
  CLIPBOARD_UNAVAILABLE,
  SHARE_UNAVAILABLE,
  STORAGE_STATS_UNAVAILABLE,
  WAKE_LOCK_UNAVAILABLE,
  createClipboardPort,
  createDocumentPort,
  createHapticsPort,
  createScreenAwakePort,
  createShareTextPort,
  createStorageStatsPort,
  createUnwiredAppInfoPort,
} from '@platform/capabilities';
import {
  NATIVE_HTTP_UNAVAILABLE,
  CapacitorHttpClient,
  base64ToBytes,
  bytesToBase64,
  decodeNativeBody,
  encodeNativeBody,
  resetNativeHttpTransportCache,
  type NativeHttpRequestOptions,
  type NativeHttpResponse,
  type NativeHttpTransport,
} from '@platform/ios-native/capacitorHttpClient';

const nativeState = { native: false, httpAvailable: true };

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => nativeState.native, isPluginAvailable: () => nativeState.httpAvailable },
}));

function defineGlobals(name: string, value: unknown): void {
  Object.defineProperty(globalThis.navigator, name, { value, configurable: true });
}

function removeGlobal(name: string): void {
  Object.defineProperty(globalThis.navigator, name, { value: undefined, configurable: true });
}

describe('platform/capabilities — 设备能力端口', () => {
  beforeEach(() => {
    nativeState.native = false;
    removeGlobal('clipboard');
    removeGlobal('vibrate');
    removeGlobal('share');
    removeGlobal('wakeLock');
    removeGlobal('storage');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* ── 剪贴板（Android ClipboardManager.setText） ───────────────────────── */

  it('clipboard: 能力缺失时显式抛错（不静默吞掉）', async () => {
    await expect(createClipboardPort().writeText('x')).rejects.toThrow(CLIPBOARD_UNAVAILABLE);
  });

  it('clipboard: 写文本透传给 navigator.clipboard.writeText', async () => {
    const writeText = vi.fn(async () => undefined);
    defineGlobals('clipboard', { writeText });
    await createClipboardPort().writeText('复制的内容');
    expect(writeText).toHaveBeenCalledWith('复制的内容');
  });

  /* ── 触感（Android Vibrator） ─────────────────────────────────────────── */

  it('haptics: 无 navigator.vibrate 时如实返回 false（E28/E47 已登记）', () => {
    expect(createHapticsPort().impact(10)).toBe(false);
  });

  it('haptics: 有 navigator.vibrate 时按时长触发', () => {
    const vibrate = vi.fn(() => true);
    defineGlobals('vibrate', vibrate);
    expect(createHapticsPort().impact(25)).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(25);
  });

  /* ── 文本分享（Android ACTION_SEND） ─────────────────────────────────── */

  it('shareText: 无 navigator.share 时显式抛错', async () => {
    await expect(createShareTextPort().shareText({ title: 'a', text: 'b' })).rejects.toThrow(
      SHARE_UNAVAILABLE,
    );
  });

  it('shareText: 有 navigator.share 时透传 title + text', async () => {
    const share = vi.fn(async () => undefined);
    defineGlobals('share', share);
    await createShareTextPort().shareText({ title: '分享阅读报告', text: '正文' });
    expect(share).toHaveBeenCalledWith({ title: '分享阅读报告', text: '正文' });
  });

  /* ── 屏幕常亮（Android FLAG_KEEP_SCREEN_ON） ──────────────────────────── */

  it('screenAwake: 无 wakeLock API 时开启显式抛错、关闭是 no-op', async () => {
    const port = createScreenAwakePort();
    await expect(port.setEnabled(true)).rejects.toThrow(WAKE_LOCK_UNAVAILABLE);
    await expect(port.setEnabled(false)).resolves.toBeUndefined();
  });

  it('screenAwake: 有 wakeLock API 时 request/release', async () => {
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ released: false, release, addEventListener: () => undefined }));
    defineGlobals('wakeLock', { request });
    const port = createScreenAwakePort();
    await port.setEnabled(true);
    expect(request).toHaveBeenCalledWith('screen');
    await port.setEnabled(true);
    expect(request).toHaveBeenCalledTimes(1);
    await port.setEnabled(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  /* ── 存储统计（Android StatFs） ───────────────────────────────────────── */

  it('storageStats: 无 navigator.storage 时显式抛错（不返回 0）', async () => {
    await expect(createStorageStatsPort().volumeStats()).rejects.toThrow(
      STORAGE_STATS_UNAVAILABLE,
    );
  });

  it('storageStats: quota - usage = freeBytes', async () => {
    defineGlobals('storage', { estimate: async () => ({ quota: 1000, usage: 400 }) });
    await expect(createStorageStatsPort().volumeStats()).resolves.toEqual({
      freeBytes: 600,
      totalBytes: 1000,
    });
  });

  it('storageStats: quota 缺失时显式抛错', async () => {
    defineGlobals('storage', { estimate: async () => ({ usage: 1 }) });
    await expect(createStorageStatsPort().volumeStats()).rejects.toThrow(
      STORAGE_STATS_UNAVAILABLE,
    );
  });

  /* ── 应用版本（Android PackageManager.getPackageInfo） ────────────────── */

  it('appInfo: 未接线时显式抛错', async () => {
    await expect(createUnwiredAppInfoPort().versionName()).rejects.toThrow(APP_INFO_UNWIRED);
  });

  /* ── 文档收发（Android SAF） ──────────────────────────────────────────── */

  it('documents.pickFile: cancel 时返回空数组', async () => {
    const port = createDocumentPort();
    const pending = port.pickFile({ accept: 'image/*' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.accept).toBe('image/*');
    input.dispatchEvent(new Event('cancel'));
    await expect(pending).resolves.toEqual([]);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('documents.saveFile: 走 blob URL + <a download>，随后 revoke', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    // jsdom 没有实现 <a download> 的下载行为，会打印 "navigation not implemented"。
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await createDocumentPort().saveFile({
      fileName: 'Ciallo-backup.zip',
      mime: 'application/zip',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });
});

describe('platform/ios-native/capacitorHttpClient — 原生 URLSession 传输', () => {
  beforeEach(() => {
    nativeState.native = true;
    resetNativeHttpTransportCache();
  });

  afterEach(() => {
    nativeState.native = false;
    resetNativeHttpTransportCache();
  });

  it('base64 <-> bytes 往返对称', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('encodeNativeBody: string 直传，Uint8Array 走 base64 + dataType=file', () => {
    expect(encodeNativeBody('abc')).toEqual({ data: 'abc' });
    const encoded = encodeNativeBody(new Uint8Array([1, 2, 3]));
    expect(encoded.dataType).toBe('file');
    expect(base64ToBytes(String(encoded.data))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('decodeNativeBody: base64 分支精确、JSON 分支语义等价、null → 空', () => {
    const bytes = new Uint8Array([7, 8, 9]);
    expect(decodeNativeBody(bytesToBase64(bytes))).toEqual(bytes);
    expect(decodeNativeBody({ a: 1 })).toEqual(new TextEncoder().encode('{"a":1}'));
    expect(decodeNativeBody(null)).toEqual(new Uint8Array(0));
  });

  it('原生运行时走 CapacitorHttp（headers 小写、url 兜底、状态码透传）', async () => {
    const seen: NativeHttpRequestOptions[] = [];
    const transport: NativeHttpTransport = {
      request: async (options) => {
        seen.push(options);
        return {
          data: bytesToBase64(new Uint8Array([0x50])),
          status: 302,
          headers: { 'Content-Type': 'image/webp' },
          url: null,
        };
      },
    };
    const client = new CapacitorHttpClient({ transport });
    const res = await client.request({
      url: 'https://a.test/x',
      method: 'POST',
      headers: { Referer: 'https://a.test/' },
      body: new Uint8Array([1, 2]),
      timeoutMs: 5000,
    });
    expect(res.status).toBe(302);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.body).toEqual(new Uint8Array([0x50]));
    expect(res.url).toBe('https://a.test/x');
    expect(seen[0]?.responseType).toBe('arraybuffer');
    expect(seen[0]?.dataType).toBe('file');
    expect(seen[0]?.readTimeout).toBe(5000);
    expect(seen[0]?.connectTimeout).toBe(5000);
    expect(seen[0]?.headers?.Referer).toBe('https://a.test/');
  });

  it('原生运行时拿不到传输层时显式抛错（绝不回落 CORS fetch）', async () => {
    nativeState.httpAvailable = false;
    resetNativeHttpTransportCache();
    const client = new CapacitorHttpClient();
    await expect(client.request({ url: 'https://a.test/' })).rejects.toThrow(
      NATIVE_HTTP_UNAVAILABLE,
    );
    nativeState.httpAvailable = true;
    resetNativeHttpTransportCache();
  });

  it('readTimeout 超时让调用方准时失败', async () => {
    const transport: NativeHttpTransport = {
      request: () => new Promise<NativeHttpResponse>(() => undefined),
    };
    const client = new CapacitorHttpClient({ transport });
    await expect(client.request({ url: 'https://a.test/', timeoutMs: 10 })).rejects.toThrow(
      'HTTP 请求超时（10ms）',
    );
  });

  it('非原生运行时回落 fetch（浏览器 dev / Playwright）', async () => {
    nativeState.native = false;
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([1]), { status: 201, headers: { 'X-A': 'b' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new CapacitorHttpClient();
    const res = await client.request({ url: 'https://a.test/' });
    expect(res.status).toBe(201);
    expect(res.headers['x-a']).toBe('b');
    expect(res.body).toEqual(new Uint8Array([1]));
    vi.unstubAllGlobals();
  });
});
