import type { HttpClient, HttpHeader, HttpRequest, HttpResponse } from '@platform/interfaces';
import { httpResponseLimit, readHttpResponseBytes } from '@platform/httpResponseBytes';

const DEFAULT_HEADERS: HttpHeader = {
  Accept: 'application/json, text/plain, */*',
};

function toBodyInit(body: string | Uint8Array): BodyInit {
  if (typeof body === 'string') {
    return body;
  }
  return body as unknown as BodyInit;
}

function collectHeaders(res: Response): HttpHeader {
  const headers: HttpHeader = {};
  res.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return headers;
}

export class FetchHttpClient implements HttpClient {
  async request(req: HttpRequest): Promise<HttpResponse> {
    const maximum = httpResponseLimit(req.maxResponseBytes);
    const headers: HttpHeader = { ...DEFAULT_HEADERS, ...req.headers };
    const init: RequestInit = {
      method: req.method ?? 'GET',
      headers,
      ...(req.redirect ? { redirect: req.redirect } : {}),
    };
    if (req.body !== undefined) {
      init.body = toBodyInit(req.body);
    }

    const controller = new AbortController(); init.signal = controller.signal;
    const abort = () => controller.abort(req.signal?.reason);
    if (req.signal?.aborted) abort(); else req.signal?.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (req.timeoutMs !== undefined && req.timeoutMs > 0) {
      timer = setTimeout(() => {
        controller?.abort();
      }, req.timeoutMs);
    }

    try {
      const res = await fetch(req.url, init);
      // Keep the browser's optimized whole-body path for ordinary preview
      // requests. Source Workers explicitly request a bounded streaming body.
      const body = req.maxResponseBytes === undefined ? new Uint8Array(await res.arrayBuffer()) : await readHttpResponseBytes(res, maximum, controller.signal);
      if (body.length > maximum) throw new Error('HTTP 响应超过大小限制');
      return {
        status: res.status,
        headers: collectHeaders(res),
        body,
        url: res.url !== '' ? res.url : req.url,
      };
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      req.signal?.removeEventListener('abort', abort);
    }
  }
}

export function createFetchHttpClient(): FetchHttpClient {
  return new FetchHttpClient();
}
