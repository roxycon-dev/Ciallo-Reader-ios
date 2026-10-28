import type { FileSystemApi, PickedFile } from '@platform/interfaces';
import type { BookRepository } from '@core/library/bookRepository';
import type { BookRow } from '@core/library/bookTypes';
import { contentMutationGate } from '@core/library/contentMutationGate';
import { decodeTextWithCharsetDetection } from '@core/parser/charsetSniffer';
import { parseEpubFromZip } from '@core/parser/epubParser';
import { importFb2 } from '@core/parser/fb2Parser';
import { importDocx } from '@core/parser/docxParser';
import { importComic } from '@core/parser/comicParser';
import { splitChapterText } from '@core/data/splitChapterText';
import type { NovelBookImporter } from '@core/download/downloadWorker';
import { importMobi } from '@core/parser/mobiParser';
import { importPdfBook } from './ios-native/pdfImport';

export const LOCAL_BOOK_ACCEPT = '.txt,.epub,.fb2,.docx,.cbz,.zip,.mobi,.azw3,.azw,.pdf';

export function createNovelBookImporter(
  repo: BookRepository,
  fs: FileSystemApi,
  onImported: () => Promise<void>,
): NovelBookImporter {
  const importFile = async (
    path: string,
    name: string,
    sourceId: string,
    comicId: string,
  ): Promise<void> => {
    const imported = await importLocalBook(
      { name, mime: 'application/octet-stream', bytes: await fs.readFile(path) },
      repo,
      fs,
    );
    await repo.updateBook({ ...imported, sourceId, comicId });
    await onImported();
  };
  return {
    importBookFromUri: importFile,
    async importDownloadedNovel(path, book, replace) {
      const existing = await repo.getBookBySourceResource(book.sourceId, book.id);
      if (existing !== null && !replace) return;
      const parsed = await importLocalBook({ name: `${book.title}.${book.format ?? 'epub'}`, mime: '', bytes: await fs.readFile(path) }, repo, fs);
      try {
        await repo.mergeDownloadedNovel({ ...parsed, author: book.author || parsed.author, coverUri: parsed.coverUri ?? book.cover ?? null }, book.sourceId, book.id, replace);
      } catch (error) {
        await repo.deleteBookDb(parsed);
        if (parsed.filePath) await fs.delete(parsed.filePath);
        throw error;
      }
      await onImported();
    },
  };
}

/** Store real files and parser output; a file picker must never insert sample books. */
export async function importLocalBook(
  file: PickedFile,
  repo: BookRepository,
  fs: FileSystemApi,
): Promise<BookRow> {
  const name = file.name.replace(/[/\\]/g, '_');
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (!LOCAL_BOOK_ACCEPT.split(',').includes(extension))
    throw new Error('暂不支持此格式，请导入 TXT、EPUB、FB2、DOCX 或 CBZ 文件。');
  if (file.bytes.length === 0) throw new Error('文件为空，无法导入');
  if (file.bytes.length > 200 * 1024 * 1024) throw new Error('文件超过 200 MB，请拆分后导入。');
  const directory = `imports/${crypto.randomUUID()}`;
  const path = `${directory}/${name}`;
  await fs.writeFile(path, file.bytes);
  const assets: string[] = [path];
  const trackedFs: FileSystemApi = {
    readFile: (target) => fs.readFile(target), exists: (target) => fs.exists(target),
    delete: (target) => fs.delete(target), list: (target) => fs.list(target),
    async writeFile(target, bytes) { assets.push(target); await fs.writeFile(target, bytes); },
  };
  try {
    return await contentMutationGate.mutex.withLock(async () => {
      const deps = { fs: trackedFs, filesDir: '', bookDao: repo };
      if (extension === '.pdf') return importPdfBook(path, name, repo, (pages) => assets.push(...pages));
      if (extension === '.cbz' || extension === '.zip') return importComic(file.bytes, name, deps);
      if (extension === '.fb2') return importFb2(file.bytes, name, path, deps);
      if (extension === '.docx') return importDocx(file.bytes, name, path, deps);
      if (['.mobi', '.azw3', '.azw'].includes(extension)) return importMobi(file.bytes, name, path, deps);
      if (extension === '.txt') {
        const text = decodeTextWithCharsetDetection(file.bytes);
        if (text.trim() === '') throw new Error('文件中没有可阅读的正文');
        const book = await repo.importTextBook(path, text.split(/\r?\n/));
        // The parser receives a stable disk path; display the original file name.
        const updated = { ...book, title: name.replace(/\.[^.]+$/, ''), filePath: path };
        await repo.updateBook(updated);
        return updated;
      }
      const writes: Promise<void>[] = [];
      let illustration = 0;
      let coverUri: string | null = null;
      const parsed = parseEpubFromZip(file.bytes, {
        writeImage(imageName, bytes) {
          const imagePath = `${directory}/images/${++illustration}_${imageName.replace(/[/\\]/g, '_')}`;
          assets.push(imagePath);
          writes.push(fs.writeFile(imagePath, bytes));
          return imagePath;
        },
        writeCover(entryPath, bytes) {
          const extension = /\.(png|jpe?g|webp|gif)$/i.exec(entryPath)?.[1] ?? 'jpg';
          coverUri = `${directory}/cover.${extension}`;
          assets.push(coverUri);
          writes.push(fs.writeFile(coverUri, bytes));
        },
      });
      await Promise.all(writes);
      const chapters = parsed.chapters.flatMap((chapter) =>
        splitChapterText(chapter.content).map((content, part) => ({
          title: part === 0 ? chapter.title : `${chapter.title} (续)`,
          content,
        })),
      );
      if (chapters.length === 0) throw new Error('EPUB 中没有可阅读的正文');
      let offset = 0;
      return repo.insertBookWithChapters(
        {
          title: parsed.title ?? name.replace(/\.[^.]+$/, ''),
          author: parsed.author ?? '未知作者',
          filePath: path,
          coverUri,
          category: '默认',
          currentChapterIndex: 0,
          scrollOffset: 0,
          isFinished: 0,
          totalChapters: chapters.length,
          contentType: 'NOVEL',
          addedTime: Date.now(),
          lastReadTime: 0,
          sourceId: null,
          comicId: null,
        },
        chapters.map((chapter, chapterOrder) => {
          const startCharIndex = offset;
          offset += chapter.content.length;
          return { ...chapter, bookId: 0, chapterOrder, startCharIndex, endCharIndex: offset };
        }),
      );
    });
  } catch (error) {
    await Promise.all(assets.map((asset) => fs.delete(asset).catch(() => {})));
    throw error;
  }
}
