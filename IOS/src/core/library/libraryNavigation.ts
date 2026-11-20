/**
 * 书库路由与搜索会话 —— `library/LibraryNavigation.kt` L12-63 的 Web 版。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L12 `LIBRARY_SESSION_ARGUMENT = "librarySession"`            → 同名
 *   L13 `LIBRARY_SEARCH_ROUTE = "library_search/{librarySession}"` → 同名
 *   L14 `SEARCH_KEYWORD = "detailSearchKeyword"`（private）      → `LIBRARY_SEARCH_KEYWORD`
 *   L15 `SEARCH_TEXT_MODE = "detailSearchTextMode"`（private）    → `LIBRARY_SEARCH_TEXT_MODE`
 *   L17-23 `librarySessionArguments()`：`NavType.StringType` + `nullable` + `defaultValue = null`
 *                                                              → `librarySessionArguments()`
 *   L25-27 `libraryDestinationRoute(destination, sessionId)`
 *          `"$destination?librarySession=${Uri.encode(sessionId)}"` → 同名
 *   L29-38 `NavController.openDetailSearch(keyword, textMode)`：
 *          `keyword.trim()` 空则返回；**总是** push 新 entry（含重复 tag）；
 *          `savedStateHandle[searchKeyword] = query`、`[searchTextMode] = textMode`
 *                                                              → `openDetailSearch`
 *   L40-55 `librarySearchViewModel(entry, sharedLibrary)`         → `librarySearchSession`
 *   L57-63 `libraryViewModelForSession(navController, sessionId, sharedLibrary)` → 同名
 *
 * 平台差异（已登记 E131）：Android 用 `NavController` + `savedStateHandle`；Web 侧用
 * 「应用内路由字符串 + session 表」表达同一语义（每次搜索都生成新 session id，
 * 重复 tag 也各自一条，与 L32 注释一致）。
 */

/** L12。 */
export const LIBRARY_SESSION_ARGUMENT = 'librarySession';
/** L13。 */
export const LIBRARY_SEARCH_ROUTE = `library_search/{${LIBRARY_SESSION_ARGUMENT}}`;
/** L14（Kotlin 里是 private，这里导出以便测试与调用方对齐键名）。 */
export const LIBRARY_SEARCH_KEYWORD = 'detailSearchKeyword';
/** L15。 */
export const LIBRARY_SEARCH_TEXT_MODE = 'detailSearchTextMode';

export interface NavArgumentSpec {
  readonly name: string;
  readonly type: 'StringType';
  readonly nullable: boolean;
  readonly defaultValue: null;
}

/** L17-23 `librarySessionArguments()`。 */
export function librarySessionArguments(): readonly NavArgumentSpec[] {
  return [
    {
      name: LIBRARY_SESSION_ARGUMENT,
      type: 'StringType',
      nullable: true,
      defaultValue: null,
    },
  ];
}

/** `Uri.encode` 的等价实现（保留 `-_.!~*'()` 与字母数字，其余百分号编码）。 */
export function encodeUriComponentCompat(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** L25-27 `libraryDestinationRoute(destination, sessionId)`。 */
export function libraryDestinationRoute(destination: string, sessionId: string | null): string {
  if (sessionId === null) return destination;
  return `${destination}?${LIBRARY_SESSION_ARGUMENT}=${encodeUriComponentCompat(sessionId)}`;
}

/** L33 `navigate("library_search/${UUID.randomUUID()}")` 的 session id 生成。 */
export function newLibrarySessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface DetailSearchRequest {
  readonly sessionId: string;
  readonly keyword: string;
  readonly textMode: boolean;
  readonly route: string;
}

/**
 * L29-38 `openDetailSearch(keyword, textMode)`。
 *
 * 语义逐条：`trim()` 后为空直接返回 `null`；**永远** push 新 entry（同一 tag 重复搜索也各一条）。
 */
export function openDetailSearch(keyword: string, textMode: boolean): DetailSearchRequest | null {
  const query = keyword.trim();
  if (query === '') return null;
  const sessionId = newLibrarySessionId();
  return {
    sessionId,
    keyword: query,
    textMode,
    route: `library_search/${sessionId}`,
  };
}

/** `savedStateHandle` 的最小投影（Kotlin 用 `SavedStateHandle`）。 */
export interface SavedStateHandleLike {
  getString(key: string): string | null;
  getBoolean(key: string): boolean | null;
  set(key: string, value: string | boolean): void;
}

/** 内存实现（`NavBackStackEntry.savedStateHandle` 的等价物）。 */
export class InMemorySavedStateHandle implements SavedStateHandleLike {
  private readonly values = new Map<string, string | boolean>();

  getString(key: string): string | null {
    const v = this.values.get(key);
    return typeof v === 'string' ? v : null;
  }

  getBoolean(key: string): boolean | null {
    const v = this.values.get(key);
    return typeof v === 'boolean' ? v : null;
  }

  set(key: string, value: string | boolean): void {
    this.values.set(key, value);
  }
}

/** L46-51 `LibraryViewModel(sharedLibrary).apply { requestAggregateSearch(...) }` 的入参。 */
export interface AggregateSearchRequest {
  readonly keyword: string;
  readonly textMode: boolean;
  readonly shared: true;
}

/** L40-55 `librarySearchViewModel(entry, sharedLibrary)`。 */
export function librarySearchSession(
  handle: Pick<SavedStateHandleLike, 'getString' | 'getBoolean'>,
  shared: unknown,
): { readonly shared: unknown; readonly aggregateSearch: AggregateSearchRequest } {
  return {
    shared,
    aggregateSearch: {
      // L48 `get<String>(SEARCH_KEYWORD).orEmpty()`
      keyword: handle.getString(LIBRARY_SEARCH_KEYWORD) ?? '',
      // L49 `get<Boolean>(SEARCH_TEXT_MODE) ?: false`
      textMode: handle.getBoolean(LIBRARY_SEARCH_TEXT_MODE) ?? false,
      shared: true,
    },
  };
}

/** L57-63 `libraryViewModelForSession(navController, sessionId, sharedLibrary)`。 */
export function libraryViewModelForSession<VM>(
  sessionId: string | null,
  sharedLibrary: VM,
  searchViewModelFor: (sessionId: string) => VM,
): VM {
  return sessionId === null ? sharedLibrary : searchViewModelFor(sessionId);
}
