import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeDocumentPort } from '@platform/ios-native/documentPort';
import {
  createNativeAppInfoPort,
  createNativeClipboardPort,
  createNativeScreenAwakePort,
  createNativeShareTextPort,
  createNativeStorageStatsPort,
} from '@platform/ios-native/readerDevicePort';

const native = vi.hoisted(() => ({
  setScreenAwake: vi.fn(async (_value: { enabled: boolean }) => {}),
  writeClipboard: vi.fn(async (_value: { text: string }) => {}),
  shareText: vi.fn(async (_value: { title: string; text: string }) => {}),
  volumeStats: vi.fn(async () => ({ freeBytes: 123, totalBytes: 456 })),
  pickFile: vi.fn(async () => ({
    files: [{ name: '书籍.epub', mime: 'application/epub+zip', data: 'AP8B' }],
  })),
  saveFile: vi.fn(async (_value: { fileName: string; mime: string; data: string }) => {}),
}));
vi.mock('@capacitor/core', () => ({
  registerPlugin: (name: string) => {
    if (name !== 'ReaderDevice' && name !== 'ReaderDocuments')
      throw new Error(`unexpected plugin ${name}`);
    return native;
  },
}));
vi.mock('@capacitor/app', () => ({ App: { getInfo: async () => ({ version: '1.0.2' }) } }));

describe('iOS device and file capabilities', () => {
  beforeEach(() => vi.clearAllMocks());
  it('controls idle sleep using the native plugin', async () => {
    const port = createNativeScreenAwakePort();
    await port.setEnabled(true);
    await port.setEnabled(false);
    expect(native.setScreenAwake.mock.calls).toEqual([[{ enabled: true }], [{ enabled: false }]]);
  });
  it('uses native clipboard and share instead of unsupported WKWebView APIs', async () => {
    await createNativeClipboardPort().writeText('章节链接');
    await createNativeShareTextPort().shareText({ title: '书名', text: '链接' });
    expect(native.writeClipboard).toHaveBeenCalledWith({ text: '章节链接' });
    expect(native.shareText).toHaveBeenCalledWith({ title: '书名', text: '链接' });
  });
  it('reads real disk capacity and the installed app version', async () => {
    expect(await createNativeStorageStatsPort().volumeStats()).toEqual({
      freeBytes: 123,
      totalBytes: 456,
    });
    expect(await createNativeAppInfoPort().versionName()).toBe('1.0.2');
  });
  it('decodes binary document contents without UTF-8 corruption', async () => {
    const files = await createNativeDocumentPort().pickFile({ accept: '.epub', multiple: true });
    expect(files[0]?.bytes).toEqual(new Uint8Array([0, 255, 1]));
    expect(files[0]?.name).toBe('书籍.epub');
    expect(native.pickFile).toHaveBeenCalledWith({ accept: '.epub', multiple: true });
  });
  it('exports the complete backup payload and propagates a cancelled save', async () => {
    const port = createNativeDocumentPort();
    await port.saveFile({
      fileName: 'backup.zip',
      mime: 'application/zip',
      bytes: new Uint8Array([0, 255, 1]),
    });
    expect(native.saveFile).toHaveBeenCalledWith({
      fileName: 'backup.zip',
      mime: 'application/zip',
      data: 'AP8B',
    });
    native.saveFile.mockRejectedValueOnce(new Error('已取消保存文件'));
    await expect(
      port.saveFile({ fileName: 'a.zip', mime: 'application/zip', bytes: new Uint8Array() }),
    ).rejects.toThrow('已取消');
  });
});
