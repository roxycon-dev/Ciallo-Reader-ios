/**
 * Kotlin → TS: `source/zlibrary/RemoteEndpointConfig.kt` (13 lines, 12 non-blank)
 *             → `src/core/source/zlibrary/remoteEndpointConfig.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package com.example.source.zlibrary → SKIPPED (TS has no packages)
 *   L3-7      KDoc 远程节点配置（zlib_endpoints.json 的一行）。第十一轮瘦身：去掉 Moshi
 *             @JsonClass（随 KotlinJsonAdapterFactory 一起移除 moshi-kotlin / kotlin-reflect
 *             依赖），序列化改为 org.json 手写。 → preserved verbatim
 *   L8-13     data class RemoteEndpointConfig(url, priority, updatedAt, version)
 *                                                     → readonly interface + `createRemoteEndpointConfig`
 *   (none)    `Long` field `updatedAt` → `number` (ms epoch, same as `System.currentTimeMillis()`).
 */

export interface RemoteEndpointConfig {
  readonly url: string;
  readonly priority: number;
  readonly updatedAt: number;
  readonly version: string;
}

export function createRemoteEndpointConfig(params: {
  url: string;
  priority: number;
  updatedAt: number;
  version: string;
}): RemoteEndpointConfig {
  return {
    url: params.url,
    priority: params.priority,
    updatedAt: params.updatedAt,
    version: params.version,
  };
}
