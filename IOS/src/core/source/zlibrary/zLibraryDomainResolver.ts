/**
 * Kotlin → TS: `source/zlibrary/ZLibraryDomainResolver.kt` (44 lines, 37 non-blank)
 *             → `src/core/source/zlibrary/zLibraryDomainResolver.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package com.example.source.zlibrary → SKIPPED (TS has no packages)
 *   L3-4      import android.content.Context / kotlinx.coroutines.* → dropped (Promises; Context is
 *             replaced by the two providers, which the platform layer constructs)
 *   L7-10     class ZLibraryDomainResolver(context, credentialStorage) → constructor takes
 *             `endpointProvider` + `healthChecker` (both injected, both were built from the
 *             `context` at Kotlin L11-12)
 *   L11       private val endpointProvider = ZLibraryEndpointProvider(context, credentialStorage) → param
 *   L12       private val healthChecker = EndpointHealthChecker(context)                     → param
 *   L14-16    suspend fun resolveDomain(forceScan = false) → `async resolveDomain(forceScan = false)`
 *             (the whole body is `endpointProvider.getEndpoint(forceRefresh = forceScan)`)
 *   L18-20    fun saveToCache(domain)   → `async saveToCache(domain)`
 *   L22-24    fun invalidateCache()     → `async invalidateCache()`
 *   L26-35    suspend fun checkDomainHealth(domain): DomainHealthResult → `async checkDomainHealth(domain)`
 *   L38-44    data class DomainHealthResult → readonly interface + `createDomainHealthResult`
 *   (tail)    `error: String? = null` default → `error?: string | null` in the factory
 *
 * Adaptations: `withContext(Dispatchers.IO)` dropped; the Kotlin `error` field is copied
 * verbatim (including a possibly-empty string — `.ifBlank` is NOT applied, matching Kotlin).
 */

import {
  type EndpointHealthChecker,
  type EndpointHealthResult,
} from './endpointHealthChecker';
import type { ZLibraryEndpointProvider } from './zLibraryEndpointProvider';

export interface DomainHealthResult {
  readonly domain: string;
  readonly isAvailable: boolean;
  readonly rtt: number;
  readonly isCloudflare: boolean;
  readonly error: string | null;
}

export function createDomainHealthResult(params: {
  domain: string;
  isAvailable: boolean;
  rtt: number;
  isCloudflare: boolean;
  error?: string | null;
}): DomainHealthResult {
  return {
    domain: params.domain,
    isAvailable: params.isAvailable,
    rtt: params.rtt,
    isCloudflare: params.isCloudflare,
    error: params.error ?? null,
  };
}

export class ZLibraryDomainResolver {
  constructor(
    private readonly endpointProvider: ZLibraryEndpointProvider,
    private readonly healthChecker: EndpointHealthChecker,
  ) {}

  async resolveDomain(forceScan = false): Promise<string> {
    return this.endpointProvider.getEndpoint(forceScan);
  }

  async saveToCache(domain: string): Promise<void> {
    await this.endpointProvider.saveCache(domain);
  }

  async invalidateCache(): Promise<void> {
    await this.endpointProvider.invalidateCache();
  }

  async checkDomainHealth(domain: string): Promise<DomainHealthResult> {
    const health: EndpointHealthResult = await this.healthChecker.checkHealth(domain);
    return createDomainHealthResult({
      domain,
      isAvailable: health.isAvailable,
      rtt: health.rtt,
      isCloudflare: health.isCloudflare,
      error: health.error,
    });
  }
}
