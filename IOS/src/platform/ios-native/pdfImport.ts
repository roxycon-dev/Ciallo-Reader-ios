import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BookRepository } from '@core/library/bookRepository';
import type { BookRow } from '@core/library/bookTypes';

interface PdfDocuments { renderPdf(options: { path: string }): Promise<{ pages: string[]; title: string | null; author: string | null }> }
export async function importPdfBook(path: string, fileName: string, repo: BookRepository, track: (pages: string[]) => void = () => {}): Promise<BookRow> {
  if (!Capacitor.isNativePlatform()) throw new Error('PDF 逐页渲染请在 iOS 应用中导入。');
  const result = await registerPlugin<PdfDocuments>('ReaderDocuments').renderPdf({ path });
  track(result.pages);
  if (!result.pages.length) throw new Error('PDF 没有可阅读的页面');
  return repo.insertBookWithChapters({ title: result.title || fileName.replace(/\.pdf$/i, ''), author: result.author || '未知作者',
    filePath: path.slice(0, path.lastIndexOf('/')) + '/pdf-pages', coverUri: result.pages[0]!, category: '默认',
    currentChapterIndex: 0, scrollOffset: 0, isFinished: 0, totalChapters: result.pages.length,
    contentType: 'COMIC', addedTime: Date.now(), lastReadTime: 0, sourceId: null, comicId: null },
  result.pages.map((content, index) => ({ bookId: 0, chapterOrder: index, title: `第 ${index + 1} 页`, content, startCharIndex: 0, endCharIndex: 0 })));
}
