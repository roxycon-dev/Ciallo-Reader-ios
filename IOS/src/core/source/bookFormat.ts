/**
 * Android source: `com.example.source.BookFormat.kt`
 * `@Immutable` annotation dropped — Compose runtime concept, no TS equivalent.
 * Kotlin `Long?` → `number | null`.
 */

export interface BookFormat {
  readonly format: string;
  /** 非空表示该格式已有可直接下载的链接（eapi 的 downloadLink 或 HTML 详情页 /dl/ 直链）。 */
  readonly downloadUrl: string | null;
  readonly size: number | null;
  readonly sizeText: string | null;
  /** eapi 格式变体自己的数字 id（下载该格式时需要）。 */
  readonly eapiId: string | null;
  /** eapi 格式变体自己的短 hash（下载该格式时需要）。 */
  readonly eapiHash: string | null;
}

export function createBookFormat(params: {
  format: string;
  downloadUrl?: string | null;
  size?: number | null;
  sizeText?: string | null;
  eapiId?: string | null;
  eapiHash?: string | null;
}): BookFormat {
  return {
    format: params.format,
    downloadUrl: params.downloadUrl ?? null,
    size: params.size ?? null,
    sizeText: params.sizeText ?? null,
    eapiId: params.eapiId ?? null,
    eapiHash: params.eapiHash ?? null,
  };
}
