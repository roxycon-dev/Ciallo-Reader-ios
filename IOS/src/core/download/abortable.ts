/** Observe cancellation without leaving handlers or a rejected host promise behind. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('任务已暂停', 'AbortError');
}

export async function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return operation;
  let abort: () => void = () => {};
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      abort = () => reject(new DOMException('任务已暂停', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}

/** Wait for all writers to stop before releasing a task's filesystem lock. */
export async function drainAll<T>(operations: Array<Promise<T>>): Promise<T[]> {
  const results = await Promise.allSettled(operations);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
}
