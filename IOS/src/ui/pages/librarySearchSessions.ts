import type { LibraryRuntime } from '@core/library/libraryRuntime';
import type { LibraryViewModel } from '@core/library/libraryViewModel';
import type { LibrarySearchRequest } from '@ui/state/appStore';

export interface LibraryPageMemory {
  searchQuery?: string;
  expandedGroups?: Record<string, boolean>;
  gridScrollTop?: number;
  resultsScrollTop?: number;
}

const viewModels = new Map<string, LibraryViewModel>();
const ownedViewModels = new Set<string>();
const releaseViewModels = new Map<string, (viewModel: LibraryViewModel) => void>();
const startedSessions = new Set<string>();
const pageMemory = new Map<string, LibraryPageMemory>();

export function getLibrarySearchViewModel(sessionId: string, runtime: LibraryRuntime): LibraryViewModel {
  const existing = viewModels.get(sessionId);
  if (existing !== undefined) return existing;
  const viewModel = runtime.createSearchSession?.() ?? runtime.viewModel;
  viewModels.set(sessionId, viewModel);
  if (viewModel !== runtime.viewModel) {
    ownedViewModels.add(sessionId);
    releaseViewModels.set(sessionId, runtime.disposeSearchSession ?? ((session) => session.dispose()));
  }
  return viewModel;
}

/** Android's ViewModelProvider initializes once for the life of this route session. */
export function startLibrarySearchSession(
  sessionId: string,
  viewModel: LibraryViewModel,
  request: LibrarySearchRequest,
): void {
  if (startedSessions.has(sessionId)) return;
  startedSessions.add(sessionId);
  viewModel.requestAggregateSearch(request.keyword, request.textMode);
  if (ownedViewModels.has(sessionId)) void viewModel.initialize();
}

export function getLibraryPageMemory(key: string): LibraryPageMemory {
  return pageMemory.get(key) ?? {};
}

export function updateLibraryPageMemory(key: string, update: Partial<LibraryPageMemory>): void {
  pageMemory.set(key, { ...getLibraryPageMemory(key), ...update });
}

export function pruneLibrarySearchSessions(retainedSessionIds: ReadonlySet<string>): void {
  for (const [sessionId, viewModel] of viewModels) {
    if (retainedSessionIds.has(sessionId)) continue;
    if (ownedViewModels.has(sessionId)) {
      (releaseViewModels.get(sessionId) ?? ((session) => session.dispose()))(viewModel);
    }
    viewModels.delete(sessionId);
    ownedViewModels.delete(sessionId);
    releaseViewModels.delete(sessionId);
    startedSessions.delete(sessionId);
    pageMemory.delete(sessionId);
  }
}
