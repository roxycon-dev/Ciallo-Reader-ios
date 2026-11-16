import type {
  VeneraEvaluateRequest,
  VeneraResultError,
  VeneraResultSuccess,
  VeneraWorkerFactory,
  VeneraWorkerHandle,
  VeneraWorkerRequest,
  VeneraWorkerResponse,
} from './veneraTypes';
import { VENERA_WORKER_TIMEOUT_MS } from './veneraTypes';

interface PendingEntry {
  resolve: (value: VeneraResultSuccess | VeneraResultError) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CreateVeneraWorkerOptions {
  timeoutMs?: number;
  workerFactory?: VeneraWorkerFactory;
}

function defaultWorkerFactory(): Worker {
  return new Worker(
    new URL('../../../public/venera/worker-entry.ts', import.meta.url),
    { type: 'module' },
  );
}

export function createVeneraWorker(
  options?: CreateVeneraWorkerOptions,
): VeneraWorkerHandle {
  const timeoutMs = options?.timeoutMs ?? VENERA_WORKER_TIMEOUT_MS;
  const factory = options?.workerFactory ?? defaultWorkerFactory;
  const worker = factory();
  const pending = new Map<number, PendingEntry>();
  let nextId = 1;

  const onMessage = (event: MessageEvent<VeneraWorkerResponse>): void => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== 'result') return;
    const entry = pending.get(data.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(data.id);
    entry.resolve(data);
  };

  const onError = (event: ErrorEvent): void => {
    const message =
      event.message !== undefined && event.message !== ''
        ? event.message
        : 'Venera worker error';
    const error = new Error(message);
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  worker.onmessage = onMessage;
  worker.onerror = onError;

  const handle: VeneraWorkerHandle = {
    send(request, requestTimeoutMs) {
      const id = nextId;
      nextId += 1;
      const effectiveTimeout = requestTimeoutMs ?? timeoutMs;
      return new Promise<VeneraResultSuccess | VeneraResultError>(
        (resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(
              new Error(
                `Venera worker request timed out after ${String(effectiveTimeout)}ms`,
              ),
            );
          }, effectiveTimeout);
          pending.set(id, { resolve, reject, timer });
          const message: VeneraWorkerRequest = {
            ...request,
            id,
          } as VeneraEvaluateRequest;
          try {
            worker.postMessage(message);
          } catch (err) {
            clearTimeout(timer);
            pending.delete(id);
            reject(
              err instanceof Error
                ? err
                : new Error('Failed to post message to Venera worker'),
            );
          }
        },
      );
    },
    terminate() {
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Venera worker terminated'));
      }
      pending.clear();
      worker.terminate();
    },
  };

  return handle;
}
