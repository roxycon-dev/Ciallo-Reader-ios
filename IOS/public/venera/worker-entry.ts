import { parseHtml, HtmlNodeImpl } from '../../src/core/parser/legadoRule';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface PendingHostCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface HtmlStoreEntry {
  kind: 'doc' | 'element' | 'node';
  docKey: number;
  node?: HtmlNodeImpl;
}

const htmlStore = new Map<number, HtmlStoreEntry>();
const dataStorage = new Map<string, unknown>();
const cookieJar = new Map<string, Map<string, string>>();
const settingDefaults = new Map<string, string>();
const pendingHostCalls = new Map<number, PendingHostCall>();

let sourceKey = '';
let srcInstance: Record<string, unknown> | null = null;
let runtimeReady = false;
let gbkEncodeTable: Map<number, number[]> | null = null;
let nextHostCallId = 1;
let nextElementId = 1;

const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.128 Mobile Safari/537.36';
const DEFAULT_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
const DEFAULT_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8';

function postLog(level: 'info' | 'warning' | 'error', title: string, content: string): void {
  (self as unknown as Worker).postMessage({ type: 'log', level, title, content });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.split('/')[0] ?? url;
  }
}

function encodeStored(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return 'JSON:' + JSON.stringify(value);
}

function decodeStored(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw === '') return raw === '' ? undefined : raw;
  if (raw.startsWith('JSON:')) {
    try {
      return JSON.parse(raw.slice(5));
    } catch {
      return raw;
    }
  }
  return raw;
}

function buildGbkEncodeTable(): Map<number, number[]> {
  const table = new Map<number, number[]>();
  const decoder = new TextDecoder('gbk', { fatal: true });
  for (let b = 0; b < 0x80; b += 1) {
    table.set(b, [b]);
  }
  for (let lead = 0x81; lead <= 0xfe; lead += 1) {
    for (let trail = 0x40; trail <= 0xfe; trail += 1) {
      if (trail === 0x7f) continue;
      try {
        const decoded = decoder.decode(new Uint8Array([lead, trail]));
        if (decoded.length === 1) {
          const cp = decoded.codePointAt(0);
          if (cp !== undefined && cp > 0x7f && !table.has(cp)) {
            table.set(cp, [lead, trail]);
          }
        }
      } catch {
        continue;
      }
    }
  }
  return table;
}

function getGbkEncodeTable(): Map<number, number[]> {
  if (gbkEncodeTable === null) {
    gbkEncodeTable = buildGbkEncodeTable();
  }
  return gbkEncodeTable;
}

function encodeGbk(value: string): Uint8Array {
  const table = getGbkEncodeTable();
  const out: number[] = [];
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    const mapped = table.get(cp);
    if (mapped !== undefined) {
      out.push(...mapped);
    } else if (cp < 0x80) {
      out.push(cp);
    }
  }
  return new Uint8Array(out);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function valueToBytes(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i] as number).toString(16).padStart(2, '0');
  }
  return out;
}

const MD5_S = new Int32Array([
  -680876936, -389564586, 606105819, -1044525330, -176418897, 1200080426, -1473231341, -45705983,
  1770035416, -1958414417, -42063, -1990404162, 1804603682, -40341101, -1502002290, 1236535329,
  -165796510, -1069501632, 643717713, -373897302, -701558691, 38016083, -660478335, -405537848,
  568446438, -1019803690, -187363961, 1163531501, -1444681467, -51403784, 1735328473, -1926607734,
  -378558, -2022574463, 1839030562, -35309556, -1530992060, 1272893353, -155497632, -1094730640,
  681279174, -358537222, -722521979, 76029189, -640364487, -421815835, 530742520, -995338651,
  -198630844, 1126891415, -1416354905, -57434055, 1700485571, -1894986606, -1051523, -2054922799,
  1873313359, -30611744, -1560198380, 1309151649, -145523070, -1120210379, 718787259, -343485551,
]);

function md5(input: Uint8Array): Uint8Array {
  const origLen = input.length;
  const bitLen = origLen * 8;
  const padded = new Uint8Array((((origLen + 8) >> 6) + 1) * 64);
  padded.set(input);
  padded[origLen] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLen >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true);

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  const md5Shift = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) | 0;

  for (let offset = 0; offset < padded.length; offset += 64) {
    const m = new Int32Array(16);
    for (let i = 0; i < 16; i += 1) {
      m[i] = dv.getInt32(offset + i * 4, true);
    }
    let aa = a;
    let bb = b;
    let cc = c;
    let dd = d;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (bb & cc) | (~bb & dd);
        g = i;
      } else if (i < 32) {
        f = (dd & bb) | (~dd & cc);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = bb ^ cc ^ dd;
        g = (3 * i + 5) & 15;
      } else {
        f = cc ^ (bb | ~dd);
        g = (7 * i) & 15;
      }
      const tmp = dd;
      dd = cc;
      cc = bb;
      bb = (bb + md5Shift((aa + f + MD5_S[i]! + m[g]!) | 0, [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21][i % 16]!)) | 0;
      aa = tmp;
    }
    a = (a + aa) | 0;
    b = (b + bb) | 0;
    c = (c + cc) | 0;
    d = (d + dd) | 0;
  }

  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setInt32(0, a, true);
  odv.setInt32(4, b, true);
  odv.setInt32(8, c, true);
  odv.setInt32(12, d, true);
  return out;
}

async function cryptoDigest(
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512',
  data: Uint8Array,
): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest(algorithm, bytesToArrayBuffer(data));
  return new Uint8Array(buf);
}

async function cryptoHmac(
  hash: 'SHA-1' | 'SHA-256' | 'SHA-512',
  key: Uint8Array,
  data: Uint8Array,
  asString: boolean,
): Promise<string | Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    bytesToArrayBuffer(key),
    { name: 'HMAC', hash },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, bytesToArrayBuffer(data));
  const bytes = new Uint8Array(sig);
  return asString ? bytesToHex(bytes) : bytes;
}

async function aesCbcDecrypt(
  value: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array | null,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    bytesToArrayBuffer(key),
    { name: 'AES-CBC' },
    false,
    ['decrypt'],
  );
  const effectiveIv = iv !== null && iv.length === 16 ? iv : new Uint8Array(16);
  const buf = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: bytesToArrayBuffer(effectiveIv) },
    cryptoKey,
    bytesToArrayBuffer(value),
  );
  return new Uint8Array(buf);
}

async function rsaDecrypt(value: Uint8Array, keyPem: string): Promise<Uint8Array> {
  const b64 = keyPem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    der[i] = binary.charCodeAt(i);
  }
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    bytesToArrayBuffer(der),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  );
  const buf = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, cryptoKey, bytesToArrayBuffer(value));
  return new Uint8Array(buf);
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

function getCookiesForUrl(url: string): string {
  const host = hostOf(url);
  const parts: string[] = [];
  let domain = host;
  while (domain.length > 0) {
    const jar = cookieJar.get(domain);
    if (jar !== undefined) {
      for (const [name, value] of jar) {
        parts.push(`${name}=${value}`);
      }
    }
    const dot = domain.indexOf('.');
    if (dot < 0) break;
    domain = domain.slice(dot + 1);
  }
  return parts.join('; ');
}

function saveCookiePairs(host: string, pairs: string[]): void {
  let jar = cookieJar.get(host);
  if (jar === undefined) {
    jar = new Map();
    cookieJar.set(host, jar);
  }
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name !== '') jar.set(name, value);
  }
}

function saveSetCookies(url: string, setCookieHeaders: string[]): void {
  const host = hostOf(url);
  for (const header of setCookieHeaders) {
    const first = header.split(';')[0] ?? '';
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (name !== '') saveCookiePairs(host, [`${name}=${value}`]);
  }
}

function decodeHttpText(bytes: Uint8Array, headers: Record<string, string>): string {
  const contentType = findHeader(headers, 'content-type') ?? '';
  const prefixBytes = bytes.subarray(0, Math.min(bytes.length, 4096));
  const prefix = new TextDecoder('iso-8859-1').decode(prefixBytes);
  const declaredGbk = /charset\s*=\s*["']?\s*(gbk|gb2312|gb18030)/i.test(contentType + '\n' + prefix);
  const utf8Text = new TextDecoder('utf-8').decode(bytes);
  if (declaredGbk || utf8Text.includes('\uFFFD')) {
    try {
      return new TextDecoder('gb18030').decode(bytes);
    } catch {
      return utf8Text;
    }
  }
  return utf8Text;
}

function flattenChapters(value: unknown): Array<{ id: string; title: string; group?: string }> {
  const entries: Array<[unknown, unknown]> =
    value instanceof Map ? Array.from(value.entries()) : Object.entries(value as Record<string, unknown>);
  const out: Array<{ id: string; title: string; group?: string }> = [];
  for (const [k, v] of entries) {
    if (v instanceof Map) {
      for (const [k2, v2] of v.entries()) {
        out.push({ id: String(k2), title: String(v2), group: String(k) });
      }
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        out.push({ id: String(k2), title: String(v2), group: String(k) });
      }
    } else {
      out.push({ id: String(k), title: String(v) });
    }
  }
  return out;
}

function normalizeResult(value: unknown): JsonValue {
  if (value instanceof Map) {
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of value.entries()) {
      out[String(key)] = normalizeResult(item);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeResult(item));
  if (value && typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(value)) {
      const v = (value as Record<string, unknown>)[key];
      if (
        key === 'chapters' &&
        v !== null &&
        v !== undefined &&
        (v instanceof Map || (typeof v === 'object' && !Array.isArray(v)))
      ) {
        out[key] = flattenChapters(v) as unknown as JsonValue;
      } else {
        out[key] = normalizeResult(v);
      }
    }
    return out;
  }
  return value as JsonValue;
}

async function handleHttp(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = typeof msg['url'] === 'string' ? (msg['url'] as string) : '';
  if (url === '') return { error: '缺少 url' };
  const httpMethod = (typeof msg['http_method'] === 'string' ? (msg['http_method'] as string) : 'GET').toUpperCase();
  const wantBytes = msg['bytes'] === true;

  const headers: Record<string, string> = {};
  let hasUa = false;
  let scriptCookie = '';
  const sourceHeaders = msg['headers'];
  if (sourceHeaders && typeof sourceHeaders === 'object' && !Array.isArray(sourceHeaders)) {
    for (const [k, v] of Object.entries(sourceHeaders as Record<string, unknown>)) {
      if (k === null || v === null || v === undefined) continue;
      const key = String(k);
      const value = String(v);
      headers[key] = value;
      if (key.toLowerCase() === 'user-agent') hasUa = true;
      if (key.toLowerCase() === 'cookie') scriptCookie = value.trim();
    }
  }
  if (!hasUa) headers['User-Agent'] = DEFAULT_UA;
  if (findHeader(headers, 'accept') === undefined) headers['Accept'] = DEFAULT_ACCEPT;
  if (findHeader(headers, 'accept-language') === undefined) {
    headers['Accept-Language'] = DEFAULT_ACCEPT_LANGUAGE;
  }

  const jarCookie = getCookiesForUrl(url).trim();
  const mergedCookie = [scriptCookie, jarCookie].filter((c) => c !== '').join('; ');
  if (mergedCookie !== '') headers['Cookie'] = mergedCookie;

  const data = msg['data'];
  let body: BodyInit | null = null;
  const isGetLike = httpMethod === 'GET' || httpMethod === 'HEAD' || httpMethod === 'DELETE';
  if (!isGetLike && data !== null && data !== undefined) {
    if (data instanceof ArrayBuffer) {
      body = data;
      if (findHeader(headers, 'content-type') === undefined) {
        headers['Content-Type'] = 'application/octet-stream';
      }
    } else if (ArrayBuffer.isView(data)) {
      body = data as unknown as BodyInit;
      if (findHeader(headers, 'content-type') === undefined) {
        headers['Content-Type'] = 'application/octet-stream';
      }
    } else if (typeof data === 'string') {
      body = data;
      if (findHeader(headers, 'content-type') === undefined) {
        headers['Content-Type'] = 'text/plain; charset=utf-8';
      }
    } else {
      body = JSON.stringify(data);
      if (findHeader(headers, 'content-type') === undefined) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
      }
    }
  }

  try {
    const response = await fetch(url, {
      method: httpMethod,
      headers,
      body,
      redirect: 'follow',
    });

    const responseHeaders: Record<string, string> = {};
    const setCookies: string[] = [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        setCookies.push(value);
        return;
      }
      if (responseHeaders[key] === undefined) responseHeaders[key] = value;
    });
    saveSetCookies(response.url || url, setCookies);

    const rawBody = await response.arrayBuffer();
    const result: Record<string, unknown> = {
      status: response.status,
      url: response.url || url,
      headers: responseHeaders,
    };
    if (wantBytes) {
      result['body'] = rawBody.byteLength > 0 ? rawBody : null;
    } else {
      const text = rawBody.byteLength > 0 ? decodeHttpText(new Uint8Array(rawBody), responseHeaders) : '';
      result['body'] = text !== '' ? text : null;
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

interface HtmlResolveResult {
  key: number | null;
}

function resolveHtmlElement(entry: HtmlStoreEntry, query: string): HtmlResolveResult {
  const node = entry.node;
  if (node === undefined) return { key: null };
  const found = node.selectFirst(query);
  if (found === null) return { key: null };
  return { key: registerElement(found as HtmlNodeImpl, entry.docKey) };
}

function resolveHtmlElements(entry: HtmlStoreEntry, query: string): number[] {
  const node = entry.node;
  if (node === undefined) return [];
  return node.select(query).map((n) => registerElement(n as HtmlNodeImpl, entry.docKey));
}

function registerElement(node: HtmlNodeImpl, docKey: number): number {
  for (const [id, entry] of htmlStore) {
    if (entry.kind === 'element' && entry.node === node) return id;
  }
  const id = nextElementId;
  nextElementId += 1;
  htmlStore.set(id, { kind: 'element', docKey, node });
  return id;
}

function registerNode(node: HtmlNodeImpl, docKey: number): number {
  for (const [id, entry] of htmlStore) {
    if (entry.kind === 'node' && entry.node === node) return id;
  }
  const id = nextElementId;
  nextElementId += 1;
  htmlStore.set(id, { kind: 'node', docKey, node });
  return id;
}

function nodeText(node: HtmlNodeImpl): string {
  if (node.kind === 'text') return node.data;
  if (node.kind === 'comment') return `<!--${node.data}-->`;
  if (node.kind === 'element') {
    const tag = node.tag;
    if (tag === 'script' || tag === 'style') {
      const text = node.text();
      if (text !== '') return text;
      const firstChild = node.childNodes[0];
      return firstChild !== undefined && firstChild.kind === 'text' ? firstChild.data.trim() : '';
    }
    const text = node.text();
    if (text !== '') return text;
    if (
      node.childNodes.length > 0 &&
      node.childNodes.every((c) => c.kind === 'text')
    ) {
      return node.childNodes.map((c) => c.data).join('').trim();
    }
    return '';
  }
  return node.data;
}

function nodeType(node: HtmlNodeImpl): string {
  switch (node.kind) {
    case 'element':
      return 'element';
    case 'text':
      return 'text';
    case 'comment':
      return 'comment';
    case 'document':
      return 'document';
    default:
      return 'unknown';
  }
}

function elementParent(node: HtmlNodeImpl): number | null {
  const parent = node.parent;
  if (parent === null || parent.kind !== 'element') return null;
  return registerElement(parent, findDocKeyForNode(parent) ?? 0);
}

function findDocKeyForNode(node: HtmlNodeImpl): number | null {
  for (const [, entry] of htmlStore) {
    if (entry.node === node) return entry.docKey;
  }
  return null;
}

function elementChildren(node: HtmlNodeImpl): number[] {
  const docKey = findDocKeyForNode(node) ?? 0;
  return node.childNodes
    .filter((c) => c.kind === 'element')
    .map((c) => registerElement(c as HtmlNodeImpl, docKey));
}

function elementNodes(node: HtmlNodeImpl): number[] {
  const docKey = findDocKeyForNode(node) ?? 0;
  return node.childNodes.map((c) => registerNode(c, docKey));
}

function elementSibling(node: HtmlNodeImpl, direction: 'prev' | 'next'): number | null {
  const parent = node.parent;
  if (parent === null) return null;
  const siblings = parent.childNodes.filter((c) => c.kind === 'element');
  const idx = siblings.indexOf(node);
  if (idx < 0) return null;
  const target = direction === 'prev' ? idx - 1 : idx + 1;
  const found = siblings[target];
  if (found === undefined) return null;
  const docKey = findDocKeyForNode(found) ?? findDocKeyForNode(node) ?? 0;
  return registerElement(found as HtmlNodeImpl, docKey);
}

function elementInnerHTML(node: HtmlNodeImpl): string {
  return node.html();
}

function elementClassNames(node: HtmlNodeImpl): string[] {
  const raw = node.attrs['class'] ?? '';
  return raw.split(/\s+/).filter((c) => c !== '');
}

function elementId(node: HtmlNodeImpl): string | null {
  const id = node.attrs['id'];
  return id !== undefined && id !== '' ? id : null;
}

function elementLocalName(node: HtmlNodeImpl): string {
  return node.tag;
}

function handleHtml(msg: Record<string, unknown>): unknown {
  const fn = typeof msg['function'] === 'string' ? (msg['function'] as string) : '';
  const docKey = typeof msg['key'] === 'number' ? (msg['key'] as number) : 0;

  if (fn === 'parse') {
    const html = typeof msg['data'] === 'string' ? (msg['data'] as string) : '';
    if (html.length > 2 * 1024 * 1024) return null;
    for (const [id, entry] of htmlStore) {
      if (entry.kind === 'doc' && entry.docKey === docKey) htmlStore.delete(id);
    }
    const root = parseHtml(html);
    const entry: HtmlStoreEntry = { kind: 'doc', docKey, node: root };
    const id = nextElementId;
    nextElementId += 1;
    htmlStore.set(id, entry);
    return docKey;
  }

  const entry = findDocEntry(docKey);
  if (entry === null) return null;

  switch (fn) {
    case 'dispose': {
      for (const [id, e] of htmlStore) {
        if (e.docKey === docKey) htmlStore.delete(id);
      }
      return null;
    }
    case 'querySelector':
      return resolveHtmlElement(entry, typeof msg['query'] === 'string' ? (msg['query'] as string) : '');
    case 'querySelectorAll':
      return resolveHtmlElements(entry, typeof msg['query'] === 'string' ? (msg['query'] as string) : '');
    case 'getElementById': {
      const id = typeof msg['id'] === 'string' ? (msg['id'] as string) : '';
      const node = entry.node?.getElementById(id) ?? null;
      if (node === null) return null;
      return registerElement(node as HtmlNodeImpl, docKey);
    }
    case 'dom_querySelector': {
      const el = findElementEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null) return null;
      return resolveHtmlElement(el, typeof msg['query'] === 'string' ? (msg['query'] as string) : '');
    }
    case 'dom_querySelectorAll': {
      const el = findElementEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null) return [];
      return resolveHtmlElements(el, typeof msg['query'] === 'string' ? (msg['query'] as string) : '');
    }
    case 'getText': {
      const el = findElementEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null || el.node === undefined) return '';
      return nodeText(el.node);
    }
    case 'getAttributes': {
      const el = findElementEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null || el.node === undefined) return {};
      return { ...el.node.attrs };
    }
    case 'getChildren': {
      const el = findElementEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null || el.node === undefined) return [];
      return elementChildren(el.node);
    }
    case 'getNodes': {
      const el = findElementEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null || el.node === undefined) return [];
      return elementNodes(el.node);
    }
    case 'getInnerHTML': {
      const el = findElementEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null || el.node === undefined) return '';
      return elementInnerHTML(el.node);
    }
    case 'getParent': {
      const el = findElementEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null || el.node === undefined) return null;
      return elementParent(el.node);
    }
    case 'getClassNames': {
      const el = findElementEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null || el.node === undefined) return [];
      return elementClassNames(el.node);
    }
    case 'getId': {
      const el = findElementEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null || el.node === undefined) return null;
      return elementId(el.node);
    }
    case 'getLocalName': {
      const el = findElementEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null || el.node === undefined) return '';
      return elementLocalName(el.node);
    }
    case 'getPreviousSibling': {
      const el = findElementEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null || el.node === undefined) return null;
      return elementSibling(el.node, 'prev');
    }
    case 'getNextSibling': {
      const el = findElementEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null || el.node === undefined) return null;
      return elementSibling(el.node, 'next');
    }
    case 'node_text': {
      const el = findNodeEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null || el.node === undefined) return '';
      return nodeText(el.node);
    }
    case 'node_type': {
      const el = findNodeEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null || el.node === undefined) return 'unknown';
      return nodeType(el.node);
    }
    case 'node_toElement': {
      const el = findNodeEntry(docKey, typeof msg['key'] === 'number' ? (msg['key'] as number) : 0);
      if (el === null || el.node === undefined || el.node.kind !== 'element') return null;
      return registerElement(el.node, docKey);
    }
    default:
      return null;
  }
}

function findDocEntry(docKey: number): HtmlStoreEntry | null {
  for (const [, entry] of htmlStore) {
    if (entry.kind === 'doc' && entry.docKey === docKey) return entry;
  }
  return null;
}

function findElementEntry(docKey: number, elemKey: number): HtmlStoreEntry | null {
  const entry = htmlStore.get(elemKey);
  if (entry === undefined || entry.kind !== 'element') return null;
  return entry;
}

function findNodeEntry(docKey: number, nodeKey: number): HtmlStoreEntry | null {
  const entry = htmlStore.get(nodeKey);
  if (entry === undefined) return null;
  return entry;
}

function handleConvert(msg: Record<string, unknown>): unknown {
  const type = typeof msg['type'] === 'string' ? (msg['type'] as string) : '';
  const value = msg['value'];
  const isEncode = msg['isEncode'] === true;
  const isString = msg['isString'] === true;

  try {
    switch (type) {
      case 'utf8': {
        if (isEncode) {
          const str = typeof value === 'string' ? value : String(value ?? '');
          return bytesToArrayBuffer(new TextEncoder().encode(str));
        }
        const bytes = valueToBytes(value);
        if (bytes === null) return null;
        return new TextDecoder('utf-8').decode(bytes);
      }
      case 'gbk': {
        if (isEncode) {
          const str = typeof value === 'string' ? value : String(value ?? '');
          return bytesToArrayBuffer(encodeGbk(str));
        }
        const bytes = valueToBytes(value);
        if (bytes === null) return null;
        try {
          return new TextDecoder('gbk').decode(bytes);
        } catch {
          return new TextDecoder('gb18030').decode(bytes);
        }
      }
      case 'base64': {
        if (isEncode) {
          const bytes = valueToBytes(value);
          if (bytes === null) return null;
          let binary = '';
          for (let i = 0; i < bytes.length; i += 1) {
            binary += String.fromCharCode(bytes[i] as number);
          }
          return btoa(binary);
        }
        const str = typeof value === 'string' ? value : '';
        const binary = atob(str);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytesToArrayBuffer(bytes);
      }
      case 'md5': {
        const bytes = valueToBytes(value);
        if (bytes === null) return null;
        return bytesToArrayBuffer(md5(bytes));
      }
      case 'sha1':
      case 'sha256':
      case 'sha512': {
        const bytes = valueToBytes(value);
        if (bytes === null) return null;
        const algorithm = type === 'sha1' ? 'SHA-1' : type === 'sha256' ? 'SHA-256' : 'SHA-512';
        const digest = await cryptoDigest(algorithm, bytes);
        return bytesToArrayBuffer(digest);
      }
      case 'hmac': {
        const key = valueToBytes(msg['key']);
        const data = valueToBytes(value);
        if (key === null || data === null) return null;
        const hashName = typeof msg['hash'] === 'string' ? (msg['hash'] as string) : 'sha256';
        const algorithm = hashName === 'sha1' ? 'SHA-1' : hashName === 'sha512' ? 'SHA-512' : 'SHA-256';
        const result = await cryptoHmac(algorithm, key, data, isString);
        if (isString) return result;
        return bytesToArrayBuffer(result as Uint8Array);
      }
      case 'aes-cbc': {
        const key = valueToBytes(msg['key']);
        const data = valueToBytes(value);
        if (key === null || data === null) return null;
        const iv = valueToBytes(msg['iv']);
        const decrypted = await aesCbcDecrypt(data, key, iv);
        return bytesToArrayBuffer(decrypted);
      }
      case 'rsa': {
        const data = valueToBytes(value);
        const keyPem = typeof msg['key'] === 'string' ? (msg['key'] as string) : '';
        if (data === null || keyPem === '') return null;
        const decrypted = await rsaDecrypt(data, keyPem);
        return bytesToArrayBuffer(decrypted);
      }
      case 'hex': {
        const bytes = valueToBytes(value);
        if (bytes === null) return null;
        return bytesToHex(bytes);
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function handleCookie(msg: Record<string, unknown>): unknown {
  const url = typeof msg['url'] === 'string' ? (msg['url'] as string) : '';
  const fn = typeof msg['function'] === 'string' ? (msg['function'] as string) : '';
  if (url === '') return null;

  if (fn === 'set') {
    const cookies = msg['cookies'];
    const host = hostOf(url);
    if (typeof cookies === 'string') {
      saveCookiePairs(
        host,
        cookies
          .split(';')
          .map((c) => c.trim())
          .filter((c) => c !== ''),
      );
    } else if (Array.isArray(cookies)) {
      const pairs: string[] = [];
      for (const item of cookies) {
        if (typeof item === 'string') {
          pairs.push(item);
        } else if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const name = typeof o['name'] === 'string' ? (o['name'] as string) : '';
          const value = typeof o['value'] === 'string' ? (o['value'] as string) : '';
          const domain = typeof o['domain'] === 'string' ? (o['domain'] as string).replace(/^\./, '') : host;
          if (name !== '') {
            let jar = cookieJar.get(domain);
            if (jar === undefined) {
              jar = new Map();
              cookieJar.set(domain, jar);
            }
            jar.set(name, value);
          }
        }
      }
      if (pairs.length > 0) saveCookiePairs(host, pairs);
    }
    return null;
  }

  if (fn === 'get') {
    const raw = getCookiesForUrl(url);
    const out: Array<{ name: string; value: string; domain: string; path: string }> = [];
    const host = hostOf(url);
    for (const part of raw.split(';')) {
      const cookie = part.trim();
      const eq = cookie.indexOf('=');
      if (eq <= 0) continue;
      out.push({
        name: cookie.slice(0, eq),
        value: cookie.slice(eq + 1),
        domain: host,
        path: '/',
      });
    }
    return out;
  }

  if (fn === 'delete') {
    const host = hostOf(url);
    cookieJar.delete(host);
    return null;
  }

  return null;
}

function handleUi(msg: Record<string, unknown>): unknown {
  const fn = typeof msg['function'] === 'string' ? (msg['function'] as string) : '';
  switch (fn) {
    case 'showMessage':
      postLog('info', 'UI', String(msg['message'] ?? ''));
      return null;
    case 'launchUrl':
      postLog('info', 'UI', `launchUrl: ${String(msg['url'] ?? '')}`);
      return null;
    case 'showLoading':
      return 0;
    case 'cancelLoading':
      return null;
    case 'showInputDialog':
      return Promise.resolve('');
    case 'showSelectDialog':
      return Promise.resolve(0);
    case 'showDialog':
      postLog('info', 'UI', `dialog: ${String(msg['title'] ?? '')}`);
      return Promise.resolve();
    default:
      return null;
  }
}

function handleRandom(msg: Record<string, unknown>): number {
  const min = typeof msg['min'] === 'number' ? (msg['min'] as number) : 0;
  const max = typeof msg['max'] === 'number' ? (msg['max'] as number) : 1;
  if (max <= min) return min;
  if (msg['type'] === 'double') return min + Math.random() * (max - min);
  return Math.floor(min + Math.random() * (max - min));
}

function handleCompute(msg: Record<string, unknown>): unknown {
  const fn = typeof msg['function'] === 'string' ? (msg['function'] as string) : '';
  const args = Array.isArray(msg['args']) ? (msg['args'] as unknown[]) : [];
  try {
    // eslint-disable-next-line no-new-func
    const compiled = new Function(`return (${fn})`)() as (...a: unknown[]) => unknown;
    const result = compiled(...args);
    return result instanceof Promise ? result : Promise.resolve(result);
  } catch (err) {
    return Promise.reject(err);
  }
}

function handleImage(msg: Record<string, unknown>): unknown {
  return null;
}

async function handleSendMessage(msg: Record<string, unknown>): Promise<unknown> {
  const method = typeof msg['method'] === 'string' ? (msg['method'] as string) : '';
  switch (method) {
    case 'delay': {
      const time = typeof msg['time'] === 'number' ? Math.min(msg['time'] as number, 45_000) : 0;
      if (time > 0) await new Promise<void>((resolve) => setTimeout(resolve, time));
      return null;
    }
    case 'convert':
      return await handleConvert(msg);
    case 'http':
      return await handleHttp(msg);
    case 'cookie':
      return handleCookie(msg);
    case 'html':
      return handleHtml(msg);
    case 'load_data': {
      const dataKey = `data_${sourceKey}_${String(msg['data_key'] ?? '')}`;
      return decodeStored(dataStorage.get(dataKey));
    }
    case 'save_data': {
      const dataKey = `data_${sourceKey}_${String(msg['data_key'] ?? '')}`;
      dataStorage.set(dataKey, encodeStored(msg['data']));
      return null;
    }
    case 'delete_data': {
      const dataKey = `data_${sourceKey}_${String(msg['data_key'] ?? '')}`;
      dataStorage.delete(dataKey);
      return null;
    }
    case 'load_setting': {
      const key = typeof msg['setting_key'] === 'string' ? (msg['setting_key'] as string) : '';
      const stored = dataStorage.get(`setting_${sourceKey}_${key}`);
      if (stored !== undefined && stored !== null && stored !== '') return stored;
      return settingDefaults.get(key) ?? null;
    }
    case 'isLogged':
      return dataStorage.get(`logged_${sourceKey}`) === true;
    case 'UI':
      return handleUi(msg);
    case 'getLocale':
      return 'zh-CN';
    case 'getPlatform':
      return 'web';
    case 'setClipboard':
      return null;
    case 'getClipboard':
      return '';
    case 'uuid':
      return crypto.randomUUID();
    case 'random':
      return handleRandom(msg);
    case 'log': {
      const level = typeof msg['level'] === 'string' ? (msg['level'] as 'info' | 'warning' | 'error') : 'info';
      postLog(level, String(msg['title'] ?? ''), String(msg['content'] ?? ''));
      return null;
    }
    case 'compute':
      return await handleCompute(msg);
    case 'image':
      return handleImage(msg);
    default:
      return null;
  }
}

function sendMessage(msg: Record<string, unknown>): unknown {
  const result = handleSendMessage(msg);
  if (result instanceof Promise) return result;
  return result;
}

const INJECT_SCRIPT = `
  const __flattenChapters = (value) => {
    const entries = value instanceof Map ? Array.from(value.entries()) : Object.entries(value);
    const out = [];
    for (const [k, v] of entries) {
      if (v instanceof Map) {
        for (const [k2, v2] of v.entries()) {
          out.push({ id: String(k2), title: String(v2), group: String(k) });
        }
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v)) {
          out.push({ id: String(k2), title: String(v2), group: String(k) });
        }
      } else {
        out.push({ id: String(k), title: String(v) });
      }
    }
    return out;
  };
  const __normalize = (value) => {
    if (value instanceof Map) {
      const out = {};
      for (const [key, item] of value.entries()) out[String(key)] = __normalize(item);
      return out;
    }
    if (Array.isArray(value)) return value.map(__normalize);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value)) {
        const v = value[key];
        if (key === 'chapters' && v &&
            (v instanceof Map || (typeof v === 'object' && !Array.isArray(v)))) {
          out[key] = __flattenChapters(v);
        } else {
          out[key] = __normalize(v);
        }
      }
      return out;
    }
    return value;
  };
  globalThis.__veneraNormalize = __normalize;
  globalThis.__veneraFlattenChapters = __flattenChapters;
`;

const PREAMBLE = `
  class Chapter {
    constructor(options = {}) {
      this.id = options.id;
      this.title = options.title;
      this.order = options.order;
      this.group = options.group;
    }
  }
  class Category {
    constructor(options = {}) {
      this.title = options.title;
      this.category = options.category;
    }
  }
`;

const INSTANTIATE_SCRIPT = `
  globalThis.__veneraSrc = new %CLASS_NAME%;
  (() => {
    const s = globalThis.__veneraSrc.search || {};
    if (typeof s.load !== 'function' && typeof s.loadNext === 'function') {
      s.load = (keyword, options, page) => {
        const list = s.optionList || [];
        const opts = list.map((item, i) => {
          if (options && options[i] !== undefined && options[i] !== null) return options[i];
          const d = item.default;
          if (Array.isArray(d)) return JSON.stringify(d);
          if (d !== undefined && d !== null) return String(d);
          return null;
        });
        return s.loadNext(keyword, opts, null);
      };
    }
  })();
  (() => {
    const s = globalThis.__veneraSrc.settings || {};
    const out = {};
    for (const k of Object.keys(s)) {
      const item = s[k];
      if (item && typeof item === 'object' && item.default !== undefined) {
        out[k] = String(item.default);
      }
    }
    globalThis.__veneraDefaults = JSON.stringify(out);
  })();
`;

const INIT_SCRIPT = `
  if (typeof globalThis.__veneraSrc.init === 'function') {
    try {
      await (async () => { await globalThis.__veneraSrc.init(); })();
    } catch (e) {
      // init failures are non-fatal
    }
  }
`;

function findSourceClassName(script: string): string {
  const match = /class\s+([A-Za-z_$][\w$]*)\s+extends\s+ComicSource/.exec(script);
  if (match !== null && match[1] !== undefined) return match[1];
  return '';
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${String(response.status)}`);
  return await response.text();
}

async function evalScript(code: string, filename: string): Promise<void> {
  try {
    (0, eval)(code);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to evaluate ${filename}: ${message}`);
  }
}

async function ensureRuntime(): Promise<void> {
  if (runtimeReady) return;
  const [veneraJs, metadataJs] = await Promise.all([
    fetchText('/venera/_venera_.js'),
    fetchText('/venera/comic_metadata.js'),
  ]);
  (globalThis as Record<string, unknown>)['appVersion'] = '1.7.0';
  await evalScript(veneraJs, '_venera_.js');
  await evalScript(metadataJs, 'comic_metadata.js');
  await evalScript(PREAMBLE, 'preamble.js');
  await evalScript(INJECT_SCRIPT, 'inject.js');
  (globalThis as Record<string, unknown>)['sendMessage'] = sendMessage;
  runtimeReady = true;
}

async function ensureSource(script: string): Promise<void> {
  await ensureRuntime();
  if (srcInstance !== null) return;

  await evalScript(script, 'source.js');

  let className = findSourceClassName(script);
  if (className === '') {
    const names = Object.getOwnPropertyNames(globalThis);
    for (const name of names) {
      try {
        const candidate = (globalThis as Record<string, unknown>)[name];
        if (
          typeof candidate === 'function' &&
          (candidate as { prototype?: Record<string, unknown> }).prototype !== undefined &&
          ComicSource.prototype instanceof Object &&
          Object.getPrototypeOf((candidate as { prototype: object }).prototype) === ComicSource.prototype
        ) {
          className = name;
          break;
        }
      } catch {
        continue;
      }
    }
  }
  if (className === '') {
    throw new Error('JS source did not define a ComicSource subclass');
  }

  await evalScript(INSTANTIATE_SCRIPT.replace('%CLASS_NAME%', className), 'instantiate.js');

  const defaultsJson = (globalThis as Record<string, unknown>)['__veneraDefaults'];
  if (typeof defaultsJson === 'string') {
    try {
      const defaults = JSON.parse(defaultsJson) as Record<string, unknown>;
      for (const [k, v] of Object.entries(defaults)) {
        settingDefaults.set(k, String(v));
      }
    } catch {
      // ignore
    }
  }

  srcInstance = (globalThis as Record<string, unknown>)['__veneraSrc'] as Record<string, unknown> | null;
  if (srcInstance === null) throw new Error('Failed to instantiate Venera source');

  await evalScript(INIT_SCRIPT, 'init.js');
}

function buildOperationExpression(
  operation: string,
  params: Record<string, unknown>,
): string {
  switch (operation) {
    case 'search': {
      const keyword = JSON.stringify(String(params['keyword'] ?? ''));
      const options = JSON.stringify(Array.isArray(params['options']) ? params['options'] : []);
      const page = Number(params['page'] ?? 1);
      return `src.search.load.call(src, ${keyword}, ${options}, ${page})`;
    }
    case 'loadInfo': {
      const id = JSON.stringify(String(params['bookId'] ?? ''));
      return `src.comic.loadInfo.call(src, ${id})`;
    }
    case 'loadEp': {
      const comicId = JSON.stringify(String(params['comicId'] ?? ''));
      const epId = JSON.stringify(String(params['epId'] ?? ''));
      return `src.comic.loadEp.call(src, ${comicId}, ${epId})`;
    }
    case 'onImageLoad': {
      const url = JSON.stringify(String(params['url'] ?? ''));
      const comicId = JSON.stringify(String(params['comicId'] ?? ''));
      const epId = JSON.stringify(String(params['epId'] ?? ''));
      const nl = params['nl'];
      const nlArg = nl !== undefined && nl !== null && nl !== '' ? `, ${JSON.stringify(String(nl))}` : '';
      return `(src.comic.onImageLoad ? src.comic.onImageLoad.call(src, ${url}, ${comicId}, ${epId}${nlArg}) : null)`;
    }
    case 'onThumbnailLoad': {
      const url = JSON.stringify(String(params['url'] ?? ''));
      return `(src.comic.onThumbnailLoad ? src.comic.onThumbnailLoad.call(src, ${url}) : null)`;
    }
    case 'isLoggedIn':
      return `src.isLogged`;
    case 'getBaseUrl':
      return `src.baseUrl`;
    case 'init':
      return `await (async () => { if (typeof src.init === 'function') await src.init(); return null; })()`;
    case 'rawCall':
      return String(params['expression'] ?? 'null');
    default:
      throw new Error(`Unknown Venera operation: ${operation}`);
  }
}

async function evaluateExpression(expression: string): Promise<unknown> {
  const wrapped = `
    await (async () => {
      const src = globalThis.__veneraSrc;
      const result = await (${expression});
      return globalThis.__veneraNormalize(result === undefined ? null : result);
    })();
  `;
  try {
    // eslint-disable-next-line no-new-func
    return await new Function(`return (async () => { ${wrapped} })()`)();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack !== undefined ? err.stack : '';
    const error = stack !== '' ? `${message}\n${stack}` : message;
    throw new Error(error);
  }
}

async function loadSourceBundle(script: string, key: string): Promise<void> {
  sourceKey = key;
  await ensureSource(script);
}

async function evaluateOperation(
  operation: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const expression = buildOperationExpression(operation, params);
  return await evaluateExpression(expression);
}

self.onmessage = (event: MessageEvent): void => {
  const data = event.data as Record<string, unknown>;
  if (data === null || typeof data !== 'object') return;
  const type = data['type'];

  if (type === 'loadSource') {
    const id = data['id'] as number;
    const script = String(data['script'] ?? '');
    const key = String(data['sourceKey'] ?? '');
    loadSourceBundle(script, key)
      .then(() => {
        (self as unknown as Worker).postMessage({ type: 'result', id, ok: true, operation: 'init', data: { value: null } });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        (self as unknown as Worker).postMessage({ type: 'result', id, ok: false, operation: 'init', error: message });
      });
    return;
  }

  if (type === 'evaluate') {
    const id = data['id'] as number;
    const script = String(data['script'] ?? '');
    const key = String(data['sourceKey'] ?? '');
    const operation = String(data['operation'] ?? '');
    const params = (data['params'] ?? {}) as Record<string, unknown>;

    ensureSource(script)
      .then(() => {
        if (key !== '' && sourceKey === '') sourceKey = key;
        return evaluateOperation(operation, params);
      })
      .then((result) => {
        (self as unknown as Worker).postMessage({
          type: 'result',
          id,
          ok: true,
          operation,
          data: result === undefined ? null : result,
        });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        (self as unknown as Worker).postMessage({
          type: 'result',
          id,
          ok: false,
          operation,
          error: message,
        });
      });
    return;
  }

  if (type === 'destroy') {
    (self as unknown as Worker).close();
    return;
  }
};
