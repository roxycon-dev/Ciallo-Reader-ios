import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Zip, ZipPassThrough } from 'fflate';
import type { BookSharePort } from '@core/library/libraryBookShare';
import type { FileSystemApi } from '@platform/interfaces';

const nativeDocuments = registerPlugin<{ shareFile(options: { paths: string[]; fileNames: string[]; title: string }): Promise<{ presented: boolean }> }>('ReaderDocuments');
const PRIVATE_FILE = 'reader-private:';

export function createBookSharePort(fs: FileSystemApi): BookSharePort {
  const port: BookSharePort = {
    async fileObjectUrl(path) { return PRIVATE_FILE + encodeURIComponent(path.replace(/^\/+/, '')); },
    async share(target) {
      if (!target.objectUrl.startsWith(PRIVATE_FILE)) throw new Error('分享文件引用无效');
      const path = decodeURIComponent(target.objectUrl.slice(PRIVATE_FILE.length));
      if (Capacitor.isNativePlatform()) return (await nativeDocuments.shareFile({ paths: [path], fileNames: [target.fileName], title: target.title })).presented;
      const bytes = await fs.readFile(path);
      const file = new File([bytes as Uint8Array<ArrayBuffer>], target.fileName, { type: target.mime });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ title: target.title, files: [file] }); }
        catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) throw error; }
        return true;
      }
      const url = URL.createObjectURL(file);
      const link = document.createElement('a'); link.href = url; link.download = target.fileName; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return true;
    },
    async shareMany(targets, title) {
      const paths = targets.map((target) => {
        if (!target.objectUrl.startsWith(PRIVATE_FILE)) throw new Error('分享文件引用无效');
        return decodeURIComponent(target.objectUrl.slice(PRIVATE_FILE.length));
      });
      if (Capacitor.isNativePlatform()) return (await nativeDocuments.shareFile({ paths, fileNames: targets.map((target) => target.fileName), title })).presented;
      const files: File[] = [];
      for (let index = 0; index < paths.length; index++) {
        const target = targets[index]!; const bytes = await fs.readFile(paths[index]!);
        files.push(new File([bytes as Uint8Array<ArrayBuffer>], target.fileName, { type: target.mime }));
      }
      if (navigator.canShare?.({ files })) {
        try { await navigator.share({ title, files }); }
        catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) throw error; }
        return true;
      }
      for (const target of targets) await port.share({ ...target, title });
      return true;
    },
  };
  return port;
}

function base64(bytes: Uint8Array): string {
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) result += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(result);
}

/** Stream CBZ output to disk; a whole chapter never needs a second RAM copy. */
export async function writeComicZip(fs: FileSystemApi, entries: Array<{ name: string; path: string }>, outPath: string): Promise<void> {
  await fs.writeFile(outPath, new Uint8Array());
  let writes = Promise.resolve();
  let failure: Error | null = null;
  const zip = new Zip((error, bytes) => {
    if (error) { failure = error; return; }
    if (!bytes.length) return;
    writes = writes.then(async () => {
      if (Capacitor.isNativePlatform()) await Filesystem.appendFile({ path: outPath, directory: Directory.Data, data: base64(bytes) });
      else {
        const previous = await fs.readFile(outPath); const combined = new Uint8Array(previous.length + bytes.length);
        combined.set(previous); combined.set(bytes, previous.length); await fs.writeFile(outPath, combined);
      }
    });
    // A later disk read may yield before the chain is awaited below.
    void writes.catch(() => {});
  });
  try {
    for (const entry of entries) {
      if (failure) throw failure;
      const item = new ZipPassThrough(entry.name); zip.add(item);
      const bytes = await fs.readFile(entry.path);
      for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
        const end = Math.min(offset + 256 * 1024, bytes.length);
        item.push(bytes.subarray(offset, end), end === bytes.length);
        await writes;
      }
      if (bytes.length === 0) item.push(new Uint8Array(), true);
    }
    zip.end(); await writes;
    if (failure) throw failure;
  } catch (error) { zip.terminate(); await writes.catch(() => {}); await fs.delete(outPath); throw error; }
}
