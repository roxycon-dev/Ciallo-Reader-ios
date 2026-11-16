import {
  DEFAULT_CROP_PARAMS,
  type GodMoment,
  type GodMomentInput,
  type GodMomentItem,
  type GodMomentPatch,
  type GodSort,
  clampGodRating,
  coverSourceToTag,
  cropParamsToTag,
  defaultCoverSource,
  rankGodMoments,
  sortGodMoments,
} from './godTypes';
import type { GodMomentRepository } from './godMomentRepository';

let store: GodMoment[] = [];
let editTargetId: number | null = null;
let repository: GodMomentRepository | null = null;
let dbSyncQueue: Promise<void> = Promise.resolve();

export function attachGodMomentRepository(repo: GodMomentRepository | null): void {
  repository = repo;
}

export function getGodMomentRepository(): GodMomentRepository | null {
  return repository;
}

function enqueueDbSync(task: (repo: GodMomentRepository) => Promise<unknown>): void {
  if (!repository) return;
  const repo = repository;
  dbSyncQueue = dbSyncQueue
    .then(() => task(repo))
    .then(() => undefined)
    .catch(() => undefined);
}

export async function hydrateGodMomentsFromDb(): Promise<void> {
  const repo = repository;
  if (!repo) return;
  const moments = await repo.all();
  if (repository !== repo) return;
  if (moments.length === 0) {
    for (const moment of store) {
      await repo.upsert(moment);
    }
    return;
  }
  store = moments;
}

function buildMoment(
  input: GodMomentInput,
  existing: GodMoment | undefined,
  id: number,
  now: number,
): GodMoment {
  return {
    id,
    contentType: input.contentType ?? existing?.contentType ?? 'comic',
    bookId: input.bookId,
    chapterId: input.chapterId,
    bookTitle: input.bookTitle,
    chapterTitle: input.chapterTitle ?? existing?.chapterTitle ?? '',
    chapterNumber: input.chapterNumber ?? existing?.chapterNumber ?? 0,
    title: input.title ?? existing?.title ?? '',
    titleIsCustom: input.titleIsCustom ?? existing?.titleIsCustom ?? false,
    rating: clampGodRating(input.rating ?? existing?.rating ?? 5),
    note: input.note ?? existing?.note ?? '',
    coverPath: input.coverPath !== undefined ? input.coverPath : (existing?.coverPath ?? null),
    coverSource:
      input.coverSource ?? existing?.coverSource ?? coverSourceToTag(defaultCoverSource()),
    cropParams:
      input.cropParams ?? existing?.cropParams ?? cropParamsToTag(DEFAULT_CROP_PARAMS),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function upsertGodMomentIn(
  list: readonly GodMoment[],
  input: GodMomentInput,
  now: number,
): { list: GodMoment[]; saved: GodMoment } {
  const existing = list.find(
    (item) => item.bookId === input.bookId && item.chapterId === input.chapterId,
  );
  const id =
    existing?.id ?? list.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  const saved = buildMoment(input, existing, id, now);
  const next = existing
    ? list.map((item) => (item.id === existing.id ? saved : item))
    : [...list, saved];
  return { list: next, saved };
}

export function applyGodMomentPatch(
  existing: GodMoment,
  patch: GodMomentPatch,
  now: number,
): GodMoment {
  return {
    ...existing,
    ...patch,
    rating: clampGodRating(patch.rating ?? existing.rating),
    coverPath:
      patch.coverPath !== undefined ? patch.coverPath : existing.coverPath,
    coverSource: patch.coverSource ?? existing.coverSource,
    cropParams: patch.cropParams ?? existing.cropParams,
    title: patch.title ?? existing.title,
    titleIsCustom: patch.titleIsCustom ?? existing.titleIsCustom,
    note: patch.note ?? existing.note,
    updatedAt: now,
  };
}

export function deleteGodMomentFrom(
  list: readonly GodMoment[],
  id: number,
): { list: GodMoment[]; deleted: GodMoment | null } {
  const deleted = list.find((item) => item.id === id) ?? null;
  const next = deleted ? list.filter((item) => item.id !== id) : [...list];
  return { list: next, deleted };
}

export function resetGodMoments(): void {
  store = [];
  editTargetId = null;
}

export function listGodMoments(): GodMoment[] {
  return sortGodMoments(store, 'rating');
}

export function listGodMomentsRanked(sort: GodSort = 'rating'): GodMomentItem[] {
  return rankGodMoments(store, sort);
}

export function countGodMoments(): number {
  return store.length;
}

export function getGodMoment(id: number): GodMoment | undefined {
  return store.find((item) => item.id === id);
}

export function findGodMoment(bookId: string, chapterId: string): GodMoment | undefined {
  return store.find((item) => item.bookId === bookId && item.chapterId === chapterId);
}

export function saveGodMoment(input: GodMomentInput): GodMoment {
  const result = upsertGodMomentIn(store, input, Date.now());
  store = result.list;
  const saved = result.saved;
  enqueueDbSync((repo) => repo.upsert(saved));
  return result.saved;
}

export function updateGodMoment(id: number, patch: GodMomentPatch): GodMoment | undefined {
  const existing = getGodMoment(id);
  if (!existing) return undefined;
  const merged = applyGodMomentPatch(existing, patch, Date.now());
  store = store.map((item) => (item.id === id ? merged : item));
  enqueueDbSync((repo) => repo.upsert(merged));
  return merged;
}

export function deleteGodMoment(id: number): boolean {
  const result = deleteGodMomentFrom(store, id);
  store = result.list;
  enqueueDbSync((repo) => repo.delete(id));
  return result.deleted !== null;
}

export function deleteGodMomentsForBook(bookId: string): number {
  const before = store.length;
  store = store.filter((item) => item.bookId !== bookId);
  enqueueDbSync((repo) => repo.deleteForBook(bookId));
  return before - store.length;
}

export function deleteGodMomentsForChapter(bookId: string, chapterId: string): number {
  const before = store.length;
  store = store.filter(
    (item) => !(item.bookId === bookId && item.chapterId === chapterId),
  );
  enqueueDbSync((repo) => repo.deleteForChapter(bookId, chapterId));
  return before - store.length;
}

export function clearGodMoments(): void {
  store = [];
  enqueueDbSync((repo) => repo.clear());
}

export function setGodEditTarget(id: number | null): void {
  editTargetId = id;
}

export function takeGodEditTarget(): number | null {
  const id = editTargetId;
  editTargetId = null;
  return id;
}

export function peekGodEditTarget(): number | null {
  return editTargetId;
}

const SEED_INPUTS: GodMomentInput[] = [
  {
    bookId: 'local_1',
    chapterId: 'gm_ch_120',
    bookTitle: '诡秘之主',
    chapterTitle: '第一百二十章 夜色下的祷告',
    chapterNumber: 120,
    title: '克莱恩成神之夜',
    titleIsCustom: true,
    rating: 5,
    note: '所有伏笔在此刻收束，读完久久不能平静。',
  },
  {
    bookId: 'local_1',
    chapterId: 'gm_ch_98',
    bookTitle: '诡秘之主',
    chapterTitle: '第九十八章 意外的访客',
    chapterNumber: 98,
    rating: 4.5,
    note: '配角的一句台词直接封神。',
  },
  {
    bookId: 'local_2',
    chapterId: 'gm_ch_210',
    bookTitle: '凡人修仙传',
    chapterTitle: '第二百一十章 结丹',
    chapterNumber: 210,
    rating: 4,
    note: '平凡人的坚持最动人。',
  },
  {
    bookId: 'local_3',
    chapterId: 'gm_ch_56',
    bookTitle: '第一序列',
    chapterTitle: '第五十六章 灯塔',
    chapterNumber: 56,
    rating: 3.5,
    note: '世界观展开的高光段落。',
  },
  {
    bookId: 'local_4',
    chapterId: 'gm_ch_8',
    bookTitle: '大奉打更人',
    chapterTitle: '第八章 打更人',
    chapterNumber: 8,
    rating: 3,
    note: '开篇节奏利落。',
  },
];

export function seedGodMomentsIfEmpty(now = Date.now()): void {
  if (store.length > 0) return;
  let list = store;
  SEED_INPUTS.forEach((input, index) => {
    const result = upsertGodMomentIn(list, input, now - index * 3_600_000);
    list = result.list;
  });
  store = list;
  if (repository) {
    const seeded = [...list];
    enqueueDbSync(async (repo) => {
      for (const moment of seeded) {
        await repo.upsert(moment);
      }
    });
  }
}
