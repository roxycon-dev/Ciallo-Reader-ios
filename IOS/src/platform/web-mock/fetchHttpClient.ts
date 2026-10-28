import type { HttpClient, HttpHeader, HttpRequest, HttpResponse } from '@platform/interfaces';

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
    const headers: HttpHeader = { ...DEFAULT_HEADERS, ...req.headers };
    const init: RequestInit = {
      method: req.method ?? 'GET',
      headers,
      ...(req.redirect ? { redirect: req.redirect } : {}),
    };
    if (req.body !== undefined) {
      init.body = toBodyInit(req.body);
    }

    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (req.timeoutMs !== undefined && req.timeoutMs > 0) {
      controller = new AbortController();
      init.signal = controller.signal;
      timer = setTimeout(() => {
        controller?.abort();
      }, req.timeoutMs);
    }

    try {
      const res = await fetch(req.url, init);
      const body = new Uint8Array(await res.arrayBuffer());
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
    }
  }
}

export function createFetchHttpClient(): FetchHttpClient {
  return new FetchHttpClient();
}
