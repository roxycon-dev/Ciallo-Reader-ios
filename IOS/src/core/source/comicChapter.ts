/**
 * Android source: `com.example.source.ComicChapter.kt`
 * Kotlin `Float order` → `number`.
 */

export interface ComicChapter {
  readonly id: string;
  readonly title: string;
  readonly volume: string | null;
  readonly order: number;
  readonly external: boolean;
  readonly externalUrl: string | null;
}

export function createComicChapter(params: {
  id: string;
  title: string;
  volume?: string | null;
  order?: number;
  external?: boolean;
  externalUrl?: string | null;
}): ComicChapter {
  return {
    id: params.id,
    title: params.title,
    volume: params.volume ?? null,
    order: params.order ?? 0,
    external: params.external ?? false,
    externalUrl: params.externalUrl ?? null,
  };
}
