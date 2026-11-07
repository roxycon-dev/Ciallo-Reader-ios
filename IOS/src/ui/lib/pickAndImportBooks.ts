import { getPlatform } from '@platform/index';
import { importLocalBook, LOCAL_BOOK_ACCEPT } from '@platform/localBookImport';
import { getBookRepository, useAppStore } from '@ui/state/appStore';
import { showToast } from '@ui/toast';

export async function pickAndImportBooks(): Promise<boolean> {
  const platform = getPlatform(), repo = getBookRepository();
  if (!repo) throw new Error('书架尚未准备好，请重试');
  const files = await platform.documents.pickFile({ accept: LOCAL_BOOK_ACCEPT, multiple: true });
  if (!files.length) return false;
  for (const file of files) {
    const book = await importLocalBook(file, repo, platform.fs);
    void showToast('已导入《' + book.title + '》');
  }
  await useAppStore.getState().loadLibrary();
  return true;
}
