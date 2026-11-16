/**
 * E69 —— `HttpUrl.topPrivateDomain()` / `PublicSuffixDatabase.getEffectiveTldPlusOne`。
 *
 * 之前 iOS 侧内联了一张 **70 条**的后缀表，Android 侧 OkHttp 用的是 jar 里完整的
 * `publicsuffixes.gz`（约 9 000 条规则 + 例外表）。后果：落在未收录的多标签后缀下的
 * 站点（`github.io`、`s3.amazonaws.com`、`*.compute.amazonaws.com`、`uk.co`、`bar.com` …）
 * eTLD+1 会算高一标签 → `cookieHeader()` 的父域回溯少走一层 → **父域 Cookie 不下发**。
 *
 * 本轮改用 `psl`（Mozilla 官方 PSL 的 npm 形态），通配符规则（`*.ck`）与例外规则
 * （`uk.co`、`city.kobe.jp`）都与 OkHttp 一致。
 *
 * 用例里的期望值按 PSL 规则手推，不是抄 `psl` 的输出：
 *   - 例外规则 `!uk.co` 让 `shop.uk.co` 的后缀**短一标签** → eTLD+1 = `uk.co`
 *   - 例外规则 `!city.kobe.jp` 同理 → `www.city.kobe.jp` 的 eTLD+1 = `city.kobe.jp`
 *   - 通配符 `*.ck` → `foo.bar.ck` 的后缀是 `bar.ck`（2 标签）→ eTLD+1 = `foo.bar.ck`
 *   - `*.compute.amazonaws.com` → `y.compute.amazonaws.com` **本身**就是后缀 → null
 *   - host 本身就是后缀（`co.uk`、`com`）→ 无可注册域 → null
 */

import { describe, expect, it } from 'vitest';
import { topPrivateDomain } from '@core/source/js/jsCookieJar';

describe('topPrivateDomain — 完整 Public Suffix List (E69)', () => {
  it('普通两级域名：eTLD+1 = 后一标签对', () => {
    expect(topPrivateDomain('www.google.com')).toBe('google.com');
    expect(topPrivateDomain('manhuaren.com')).toBe('manhuaren.com');
    expect(topPrivateDomain('www.manhuaren.com')).toBe('manhuaren.com');
    expect(topPrivateDomain('z-library.sk')).toBe('z-library.sk');
  });

  it('两级后缀（co.uk）：eTLD+1 = 后三标签', () => {
    expect(topPrivateDomain('sub.domain.co.uk')).toBe('domain.co.uk');
  });

  it('E69 点名的未收录多标签后缀现在都正确了', () => {
    // 这些在旧的 70 条表里全部缺失 → 以前都会算高一标签。
    expect(topPrivateDomain('a.b.github.io')).toBe('b.github.io');
    expect(topPrivateDomain('x.s3.amazonaws.com')).toBe('x.s3.amazonaws.com');
    expect(topPrivateDomain('a.bar.com')).toBe('bar.com');
  });

  it('通配符规则 *.ck：后缀是两标签', () => {
    // *.ck 存在 → `bar.ck` 是后缀 → eTLD+1 = `foo.bar.ck`。
    // 旧实现把 `foo.bar.ck` 算成 `bar.ck`（少一标签）。
    expect(topPrivateDomain('foo.bar.ck')).toBe('foo.bar.ck');
  });

  it('通配符规则覆盖整域时 host 本身即后缀 → null', () => {
    // *.compute.amazonaws.com 存在 → `y.compute.amazonaws.com` 整体是后缀。
    expect(topPrivateDomain('y.compute.amazonaws.com')).toBeNull();
  });

  it('例外规则让后缀短一标签（uk.co / city.kobe.jp）', () => {
    // PSL 的 `!uk.co`：uk.co 不是后缀，co 才是 → eTLD+1 = `uk.co`。
    expect(topPrivateDomain('shop.uk.co')).toBe('uk.co');
    // PSL 的 `!city.kobe.jp`：同理。
    expect(topPrivateDomain('www.city.kobe.jp')).toBe('city.kobe.jp');
  });

  it('host 本身就是公共后缀 → 无可注册域 → null', () => {
    expect(topPrivateDomain('co.uk')).toBeNull();
    expect(topPrivateDomain('com')).toBeNull();
    expect(topPrivateDomain('ck')).toBeNull();
    expect(topPrivateDomain('foo.ck')).toBeNull();
  });

  it('IP 字面量 → null（Kotlin `canParseAsIpAddress` 分支）', () => {
    // `canParseAsIpAddress` 是文件内私有函数，这里只验证它的**可观察结果**：
    // Kotlin `topPrivateDomain()` 对 IP 字面量返回 null（PSL 里没有对应规则，
    // 若不短路，`1.2.3.4` 会被当成普通域名算出 `3.4`）。
    expect(topPrivateDomain('1.2.3.4')).toBeNull();
    expect(topPrivateDomain('192.168.1.1')).toBeNull();
    expect(topPrivateDomain('[::1]')).toBeNull();
  });

  it('空 / 畸形输入不抛错', () => {
    expect(topPrivateDomain('')).toBeNull();
    expect(topPrivateDomain('localhost')).toBeNull();
    expect(topPrivateDomain('...')).toBeNull();
  });

  it('大小写不敏感（Kotlin 走小写化的 host）', () => {
    expect(topPrivateDomain('WWW.MANHUAREN.COM')).toBe('manhuaren.com');
    expect(topPrivateDomain('A.B.GITHUB.IO')).toBe('b.github.io');
  });

  it('书源域名（回归：旧表覆盖的那些不能被改坏）', () => {
    expect(topPrivateDomain('tu.mhttu.cc')).toBe('mhttu.cc');
    expect(topPrivateDomain('nhentai.net')).toBe('nhentai.net');
    expect(topPrivateDomain('e-hentai.org')).toBe('e-hentai.org');
    expect(topPrivateDomain('hitomi.la')).toBe('hitomi.la');
  });
});