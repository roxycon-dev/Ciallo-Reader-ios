export function httpResponseLimit(value = 512 * 1024 * 1024): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 512 * 1024 * 1024) throw new Error('HTTP 响应大小限制无效'); return value;
}
/** Stop reading before allocating an oversized combined response. Cancellation
 * of a broken stream must not hold up the caller's error or deadline. */
export async function readHttpResponseBytes(response: Response, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  httpResponseLimit(maximum);
  if (signal.aborted) { void response.body?.cancel().catch(() => {}); throw new DOMException('HTTP 请求已取消', 'AbortError'); }
  const reader = response.body?.getReader();
  if (!reader) { const body = new Uint8Array(await response.arrayBuffer()); if (signal.aborted) throw new DOMException('HTTP 请求已取消', 'AbortError'); if (body.length > maximum) throw new Error('HTTP 响应超过大小限制'); return body; }
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (signal.aborted) throw new DOMException('HTTP 请求已取消', 'AbortError'); if (part.done) break;
      size += part.value.length; if (size > maximum) { abort(); throw new Error('HTTP 响应超过大小限制'); } parts.push(part.value);
    }
    const body = new Uint8Array(size); let offset = 0; for (const part of parts) { body.set(part, offset); offset += part.length; } return body;
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}
