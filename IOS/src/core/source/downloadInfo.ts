/**
 * Android source: `com.example.source.DownloadInfo.kt`
 * `@Immutable` annotation dropped — Compose runtime concept, no TS equivalent.
 * Kotlin `Long?` → `number | null`; `Map<String, String>` → `Record<string, string>`.
 */

export interface DownloadInfo {
  readonly url: string;
  readonly fileName: string;
  readonly format: string;
  readonly size: number | null;
  readonly headers: Record<string, string>;
  readonly referer: string | null;
}

export function createDownloadInfo(params: {
  url: string;
  fileName: string;
  format?: string;
  size?: number | null;
  headers?: Record<string, string>;
  referer?: string | null;
}): DownloadInfo {
  return {
    url: params.url,
    fileName: params.fileName,
    format: params.format ?? 'epub',
    size: params.size ?? null,
    headers: params.headers ?? {},
    referer: params.referer ?? null,
  };
}
