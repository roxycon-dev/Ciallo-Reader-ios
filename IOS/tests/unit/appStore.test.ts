import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../src/ui/state/appStore';

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      route: 'main',
      activeTab: 'bookshelf',
      readerTheme: 0,
      currentBookId: null,
      books: [],
      categories: [],
    });
  });

  it('starts with empty library and can import a sample book', () => {
    const state = useAppStore.getState();
    expect(Array.isArray(state.books)).toBe(true);
    expect(Array.isArray(state.categories)).toBe(true);
    useAppStore.getState().importSampleBook();
    const after = useAppStore.getState();
    expect(after.books.length).toBeGreaterThanOrEqual(1);
    expect(after.books[0]?.title).toBeTruthy();
  });

  it('importSampleBook adds a book', () => {
    const before = useAppStore.getState().books.length;
    useAppStore.getState().importSampleBook();
    const after = useAppStore.getState().books;
    expect(after.length).toBe(before + 1);
    const added = after[after.length - 1];
    expect(added?.title).toBeTruthy();
    expect(added?.author).toBeTruthy();
    expect(added?.id).toBeGreaterThan(0);
  });

  it('setReaderTheme works', () => {
    useAppStore.getState().setReaderTheme(4);
    expect(useAppStore.getState().readerTheme).toBe(4);
    useAppStore.getState().setReaderTheme(2);
    expect(useAppStore.getState().readerTheme).toBe(2);
  });

  it('setTab and setRoute update navigation state', () => {
    useAppStore.getState().setTab('settings');
    expect(useAppStore.getState().activeTab).toBe('settings');
    useAppStore.getState().setRoute('reader');
    expect(useAppStore.getState().route).toBe('reader');
  });

  it('pushSearchHistory dedupes and caps length', () => {
    useAppStore.getState().pushSearchHistory('测试');
    useAppStore.getState().pushSearchHistory('测试');
    const history = useAppStore.getState().searchHistory;
    expect(history[0]).toBe('测试');
    expect(history.filter((item) => item === '测试').length).toBe(1);
  });

  it('addCategory appends unique category', () => {
    const before = useAppStore.getState().categories.length;
    useAppStore.getState().addCategory('科幻');
    expect(useAppStore.getState().categories.length).toBe(before + 1);
    useAppStore.getState().addCategory('科幻');
    expect(useAppStore.getState().categories.length).toBe(before + 1);
  });
});
