import { createVeneraWorker } from './veneraWorker';
import type {
  VeneraOperation,
  VeneraOperationParams,
  VeneraOperationResult,
  VeneraWorkerHandle,
} from './veneraTypes';

const IDLE_TIMEOUT_MS = 60_000;

interface BridgeEntry {
  handle: VeneraWorkerHandle;
  script: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const bridge = new Map<string, BridgeEntry>();

export interface EvaluateComicSourceOptions {
  timeoutMs?: number;
  sourceKey: string;
  script: string;
}

export interface EvaluateComicSourceResult {
  ok: boolean;
  operation: VeneraOperation;
  data?: VeneraOperationResult;
  error?: string;
}

function clearIdleTimer(entry: BridgeEntry): void {
  if (entry.idleTimer !== null) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
}

function scheduleIdleTermination(sourceKey: string, entry: BridgeEntry): void {
  clearIdleTimer(entry);
  entry.idleTimer = setTimeout(() => {
    const current = bridge.get(sourceKey);
    if (current !== undefined && current === entry) {
      bridge.delete(sourceKey);
      entry.handle.terminate();
    }
  }, IDLE_TIMEOUT_MS);
}

function getOrCreateEntry(
  sourceKey: string,
  script: string,
): BridgeEntry {
  const existing = bridge.get(sourceKey);
  if (existing !== undefined) {
    clearIdleTimer(existing);
    if (existing.script !== script) {
      bridge.delete(sourceKey);
      existing.handle.terminate();
    } else {
      return existing;
    }
  }
  const handle = createVeneraWorker();
  const entry: BridgeEntry = { handle, script, idleTimer: null };
  bridge.set(sourceKey, entry);
  return entry;
}

export async function evaluateComicSource(
  operation: VeneraOperation,
  params: VeneraOperationParams,
  options: EvaluateComicSourceOptions,
): Promise<EvaluateComicSourceResult> {
  const { sourceKey, script, timeoutMs } = options;
  if (sourceKey === '') {
    return { ok: false, operation, error: 'sourceKey is required' };
  }
  if (script === '') {
    return { ok: false, operation, error: 'script is required' };
  }

  const entry = getOrCreateEntry(sourceKey, script);
  scheduleIdleTermination(sourceKey, entry);

  try {
    const request = {
      type: 'evaluate' as const,
      script,
      sourceKey,
      operation,
      params,
    };
    const response = await entry.handle.send(request, timeoutMs);
    scheduleIdleTermination(sourceKey, entry);

    if (response.ok) {
      return {
        ok: true,
        operation: response.operation,
        data: response.data,
      };
    }
    return {
      ok: false,
      operation: response.operation,
      error: response.error,
    };
  } catch (err) {
    scheduleIdleTermination(sourceKey, entry);
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, operation, error: message };
  }
}

export function terminateVeneraBridge(sourceKey?: string): void {
  if (sourceKey !== undefined) {
    const entry = bridge.get(sourceKey);
    if (entry !== undefined) {
      clearIdleTimer(entry);
      entry.handle.terminate();
      bridge.delete(sourceKey);
    }
    return;
  }
  for (const [, entry] of bridge) {
    clearIdleTimer(entry);
    entry.handle.terminate();
  }
  bridge.clear();
}

export function activeVeneraBridgeKeys(): string[] {
  return [...bridge.keys()];
}
