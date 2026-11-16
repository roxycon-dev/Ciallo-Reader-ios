import type { HttpRequestSpec, HttpResponseSpec } from '@core/source/js/jsPlatform';

export interface SourceWorkerBoot {
  initializationCode?: string;
  sourceKey: string; runtimeJs: string; script: string; insecureTls: boolean;
  assets: Record<string, string>; preferences: Record<string, string>;
}
export type SourceWorkerOperation =
  | { method: 'call'; code: string }
  | { method: 'imageBytes'; url: string; headers: Record<string, string> }
  | { method: 'transform'; code: string; bytes: Uint8Array; bitmap: WorkerBitmap }
  | { method: 'setLoggedIn'; logged: boolean };
export interface WorkerBitmap { width: number; height: number; data: Uint8Array }
export type HostRequest =
  | { method: 'verify'; url: string; userAgent: string }
  | { method: 'http'; request: Omit<HttpRequestSpec, 'signal'> }
  | { method: 'input'; title: string; image: string | null };
export type SourceWorkerRequest =
  | { type: 'boot'; boot: SourceWorkerBoot }
  | { type: 'operation'; id: number; operation: SourceWorkerOperation }
  | { type: 'hostResult'; id: number; ok: boolean; value?: HttpResponseSpec | string; error?: string };
export type SourceWorkerResponse =
  | { type: 'ready' }
  | { type: 'bootError'; error: string }
  | { type: 'result'; id: number; ok: boolean; value?: unknown; error?: string; logged: boolean }
  | { type: 'host'; id: number; request: HostRequest }
  | { type: 'preferences'; values: Record<string, string> };
