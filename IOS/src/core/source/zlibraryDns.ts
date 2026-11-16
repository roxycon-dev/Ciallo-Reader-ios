/**
 * Z-Library anti-poisoning DNS — pure ports of `ZLibraryDns` network algorithms.
 *
 * Android source: `source/zlibrary/network/ZLibraryDns.kt`
 * Network I/O (DoH fetch, TCP probe) stays in the platform layer; this module
 * exports the CIDR blacklist, DoH answer parsing, and candidate ranking.
 */

/** Private/reserved + common DNS-hijack (Meta/Facebook) IPv4 prefixes. */
export const BLOCKED_PREFIXES: Array<{ base: number; prefixLen: number }> = [
  { base: 0x00000000, prefixLen: 8 },
  { base: 0x0a000000, prefixLen: 8 },
  { base: 0x64400000, prefixLen: 10 },
  { base: 0x7f000000, prefixLen: 8 },
  { base: 0xa9fe0000, prefixLen: 16 },
  { base: 0xac100000, prefixLen: 12 },
  { base: 0xc0000000, prefixLen: 24 },
  { base: 0xc0a80000, prefixLen: 16 },
  { base: 0xc6120000, prefixLen: 15 },
  { base: 0xe0000000, prefixLen: 4 },
  { base: 0xf0000000, prefixLen: 4 },
];

/** Parse dotted IPv4 into an unsigned 32-bit integer, or null if invalid. */
export function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      return null;
    }
    value = value * 256 + n;
  }
  return value;
}

/** True when the IPv4 falls in a blocked private/reserved/hijack prefix. */
export function isSuspiciousIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) {
    return true;
  }
  for (const { base, prefixLen } of BLOCKED_PREFIXES) {
    if (prefixLen <= 0) {
      return true;
    }
    if (prefixLen >= 32) {
      if (value === base) {
        return true;
      }
      continue;
    }
    const shift = 32 - prefixLen;
    const divisor = 2 ** shift;
    if (Math.floor(value / divisor) === Math.floor(base / divisor)) {
      return true;
    }
  }
  return false;
}

/** Extract A-record (type 1) `data` strings from a DNS-over-HTTPS JSON body. */
export function parseDohAnswers(json: unknown): string[] {
  if (typeof json !== 'object' || json === null) {
    return [];
  }
  const answer = (json as { Answer?: unknown }).Answer;
  if (!Array.isArray(answer)) {
    return [];
  }
  const out: string[] = [];
  for (const item of answer) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const { type, data } = item as { type?: unknown; data?: unknown };
    if (type === 1 && typeof data === 'string') {
      out.push(data);
    }
  }
  return out;
}

export const DOH_PROVIDERS = [
  {
    url: (h: string) => `https://dns.alidns.com/resolve?name=${h}&type=1`,
    accept: 'application/dns-json',
  },
  {
    url: (h: string) => `https://doh.pub/dns-query?name=${h}&type=A`,
    accept: 'application/dns-json',
  },
  {
    url: (h: string) => `https://dns.google/resolve?name=${h}&type=A`,
    accept: 'application/dns-json',
  },
] as const;

/** Reachable IPs first, then the rest; duplicates removed (first occurrence wins). */
export function rankCandidates(ips: string[], reachable: Set<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ip of ips) {
    if (seen.has(ip) || !reachable.has(ip)) {
      continue;
    }
    seen.add(ip);
    out.push(ip);
  }
  for (const ip of ips) {
    if (seen.has(ip)) {
      continue;
    }
    seen.add(ip);
    out.push(ip);
  }
  return out;
}
