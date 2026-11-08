import { describe, expect, it } from 'vitest';
import {
  buildVerifyUrl,
  extractDocumentCookies,
  extractIframeSrc,
  extractSha1Token,
  extractSha256Challenge,
  isCaptchaBody,
  isChallengeStatus,
  peekLooksLikeDiamWall,
  shouldAbortUrlVisits,
  solveSha1TwoByte,
  solveSha256,
} from '../../src/core/source/diamWall';
import {
  BLOCKED_PREFIXES,
  DOH_PROVIDERS,
  ipv4ToInt,
  isSuspiciousIpv4,
  parseDohAnswers,
  rankCandidates,
} from '../../src/core/source/zlibraryDns';

describe('isSuspiciousIpv4', () => {
  it('flags loopback and private ranges', () => {
    expect(isSuspiciousIpv4('127.0.0.1')).toBe(true);
    expect(isSuspiciousIpv4('10.1.2.3')).toBe(true);
    expect(isSuspiciousIpv4('192.168.1.1')).toBe(true);
    expect(isSuspiciousIpv4('172.16.0.1')).toBe(true);
    expect(isSuspiciousIpv4('0.0.0.0')).toBe(true);
  });

  it('allows public addresses', () => {
    expect(isSuspiciousIpv4('8.8.8.8')).toBe(false);
    expect(isSuspiciousIpv4('1.1.1.1')).toBe(false);
    expect(isSuspiciousIpv4('223.5.5.5')).toBe(false);
  });

  it('treats unparsable input as suspicious', () => {
    expect(isSuspiciousIpv4('not-an-ip')).toBe(true);
    expect(isSuspiciousIpv4('999.1.1.1')).toBe(true);
  });
});

describe('ipv4ToInt', () => {
  it('parses dotted quads to unsigned ints', () => {
    expect(ipv4ToInt('0.0.0.0')).toBe(0);
    expect(ipv4ToInt('127.0.0.1')).toBe(0x7f000001);
    expect(ipv4ToInt('8.8.8.8')).toBe(0x08080808);
    expect(ipv4ToInt('255.255.255.255')).toBe(0xffffffff);
  });

  it('returns null for invalid input', () => {
    expect(ipv4ToInt('1.2.3')).toBeNull();
    expect(ipv4ToInt('1.2.3.4.5')).toBeNull();
    expect(ipv4ToInt('a.b.c.d')).toBeNull();
  });
});

describe('BLOCKED_PREFIXES', () => {
  it('covers private/reserved + hijack ranges', () => {
    expect(BLOCKED_PREFIXES.length).toBe(11);
    expect(BLOCKED_PREFIXES.some((p) => p.base === 0x7f000000 && p.prefixLen === 8)).toBe(true);
  });
});

describe('parseDohAnswers', () => {
  it('filters Answer entries to type 1 A records', () => {
    const json = {
      Status: 0,
      Answer: [
        { name: 'z-lib.sk', type: 1, TTL: 60, data: '104.21.11.22' },
        { name: 'z-lib.sk', type: 5, TTL: 60, data: 'alias.example.' },
        { name: 'z-lib.sk', type: 28, TTL: 60, data: '2606:4700::1111' },
      ],
    };
    expect(parseDohAnswers(json)).toEqual(['104.21.11.22']);
  });

  it('returns empty for missing/malformed payloads', () => {
    expect(parseDohAnswers(null)).toEqual([]);
    expect(parseDohAnswers({})).toEqual([]);
    expect(parseDohAnswers({ Answer: 'nope' })).toEqual([]);
  });
});

describe('DOH_PROVIDERS + rankCandidates', () => {
  it('exposes three DoH provider URL builders', () => {
    expect(DOH_PROVIDERS).toHaveLength(3);
    expect(DOH_PROVIDERS[0]?.url('example.com')).toContain('dns.alidns.com');
    expect(DOH_PROVIDERS[1]?.url('example.com')).toContain('doh.pub');
    expect(DOH_PROVIDERS[2]?.url('example.com')).toContain('dns.google');
  });

  it('ranks reachable IPs first and dedupes', () => {
    const ips = ['9.9.9.9', '1.2.3.4', '9.9.9.9', '8.8.8.8'];
    const reachable = new Set(['8.8.8.8']);
    expect(rankCandidates(ips, reachable)).toEqual(['8.8.8.8', '9.9.9.9', '1.2.3.4']);
  });

  it('keeps original order when nothing is reachable', () => {
    expect(rankCandidates(['b', 'a', 'b'], new Set())).toEqual(['b', 'a']);
  });
});

describe('DiamWall challenge detection', () => {
  it('isChallengeStatus matches known challenge codes', () => {
    expect(isChallengeStatus(517)).toBe(true);
    expect(isChallengeStatus(403)).toBe(true);
    expect(isChallengeStatus(503)).toBe(true);
    expect(isChallengeStatus(513)).toBe(true);
    expect(isChallengeStatus(200)).toBe(false);
    expect(isChallengeStatus(404)).toBe(false);
  });

  it('peekLooksLikeDiamWall sniffs challenge markers', () => {
    expect(peekLooksLikeDiamWall('<html>Checking your browser...')).toBe(true);
    expect(peekLooksLikeDiamWall('var TOKEN=abc;')).toBe(true);
    expect(peekLooksLikeDiamWall('<title>DiamWall</title>')).toBe(true);
    expect(peekLooksLikeDiamWall('<html>hello</html>')).toBe(false);
  });

  it('extracts document cookies dwid and _dwa', () => {
    const body = `document.cookie="dwid=abc123; path=/"; document.cookie="_dwa=0; path=/";`;
    expect(extractDocumentCookies(body)).toEqual([
      { name: 'dwid', value: 'abc123' },
      { name: '_dwa', value: '0' },
    ]);
  });

  it('extracts diamwall iframe src', () => {
    const body = '<iframe src="https://1lib.sk/.well-known/diamwall/load/html/xyz"></iframe>';
    expect(extractIframeSrc(body)).toBe('https://1lib.sk/.well-known/diamwall/load/html/xyz');
    expect(extractIframeSrc('<iframe src="/other"></iframe>')).toBeNull();
  });

  it('detects interactive captcha bodies', () => {
    expect(isCaptchaBody('Please solve this captcha')).toBe(true);
    expect(isCaptchaBody('<script src="cpt.lib"></script>')).toBe(true);
    expect(isCaptchaBody('var TOKEN="x"; var DIFF=2;')).toBe(false);
  });
});

describe('PoW challenge extractors', () => {
  it('extractSha256Challenge parses TOKEN and DIFF', () => {
    const body = 'var TOKEN="deadbeefcafe"; var DIFF=2; doWork();';
    expect(extractSha256Challenge(body)).toEqual({ token: 'deadbeefcafe', difficulty: 2 });
    expect(extractSha256Challenge('no challenge here')).toBeNull();
  });

  it('extractSha1Token parses TOKEN, n1 and target bytes', () => {
    const token = '0123456789abcdef0123456789abcdef01234567';
    const body = `var s='${token}'; if (s[n1]===0x41 && s[n1+0x1]===0x42) ok();`;
    const parsed = extractSha1Token(body);
    expect(parsed).not.toBeNull();
    expect(parsed?.token).toBe(token.toUpperCase());
    expect(parsed?.n1).toBe(0x0);
    expect(parsed?.t1).toBe(0x41);
    expect(parsed?.t2).toBe(0x42);
  });

  it('extractSha1Token returns null without full match', () => {
    expect(extractSha1Token('s[n1]===0x1;')).toBeNull();
  });
});

describe('PoW solvers', () => {
  it('solveSha256 finds a nonce with zero prefix nibbles', async () => {
    // 显式给足 deadline：全量并行跑时 CPU 被抢，默认预算会误报失败。
    const nonce = await solveSha256('test-token', 2, { deadlineMs: 30_000 });
    expect(nonce).not.toBeNull();
    if (nonce === null) {
      return;
    }
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`test-token:${nonce}`)),
    );
    expect(digest[0]).toBe(0);
  });

  it('solveSha256 rejects difficulty outside 0..6', async () => {
    expect(await solveSha256('token', 100)).toBeNull();
    expect(await solveSha256('token', -1)).toBeNull();
  });

  it('solveSha256 respects maxNonce bound', async () => {
    expect(await solveSha256('impossible-token-with-high-difficulty', 6, { maxNonce: 1, deadlineMs: 50 })).toBeNull();
  });

  it('solveSha1TwoByte hits the two target digest bytes', async () => {
    const token = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
    // n1=0 → first two bytes of SHA-1(token+'0') become targets; search should find them
    const first = new Uint8Array(
      await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${token}0`)),
    );
    const nonce = await solveSha1TwoByte(token, 0, first[0] ?? 0, first[1] ?? 0, {
      maxNonce: 4,
      deadlineMs: 2000,
    });
    expect(nonce).toBe(0);
  });
});

describe('verify URL + loop guard', () => {
  it('buildVerifyUrl builds /__ab/verify with t, n, r', () => {
    const url = buildVerifyUrl('https://1lib.sk/s/query', 'TOKEN', 42, '/s/query');
    expect(url).toBe(
      `https://1lib.sk/__ab/verify?t=TOKEN&n=42&r=${encodeURIComponent('/s/query')}`,
    );
  });

  it('shouldAbortUrlVisits trips after more than 3 hits', () => {
    const counts = new Map<string, number>();
    counts.set('https://1lib.sk/', 3);
    expect(shouldAbortUrlVisits(counts, 'https://1lib.sk/')).toBe(false);
    counts.set('https://1lib.sk/', 4);
    expect(shouldAbortUrlVisits(counts, 'https://1lib.sk/')).toBe(true);
    expect(shouldAbortUrlVisits(counts, 'https://other/')).toBe(false);
  });
});
