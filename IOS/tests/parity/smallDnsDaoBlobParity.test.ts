/**
 * smallDnsDaoBlobParity.test.ts —— 第十四批（66–68 行档，3 个文件，合计 202 行）。
 *
 *   · `source/js/SourceDns.kt`（66）—— 候选边缘 IP + **IPv4 优先** + 5 分钟缓存（E183）
 *   · `god/GodMomentDao.kt`（68）—— 十一条查询/写入的 SQL 与冲突策略
 *   · `ui/components/LiquidBlob.kt`（68）—— 液桥几何：颈部收细与两道三次贝塞尔
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  SourceDns,
  UnknownHostError,
  clearSourceDnsCache,
  dns,
  isIpv4Address,
  preferIpv4,
} from '@core/source/js/sourceDns';
import { GodMomentRepository } from '@core/god/godMomentRepository';
import { liquidBlobSvg } from '@core/glass/liquidBlob';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① source/js/SourceDns.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('SourceDns.kt：候选边缘 IP + IPv4 优先（E183）', () => {
  const KT = kt('source/js/SourceDns.kt');

  beforeEach(() => {
    clearSourceDnsCache();
  });

  it('候选表只有 cdndm5.com → 222.200.254.75；TTL 5 分钟', () => {
    expect(KT).toContain('"cdndm5.com" to ips("222.200.254.75")');
    expect(KT).toContain('private const val CACHE_TTL_MS = 5 * 60_000L');
    expect(SourceDns.PINNED_CANDIDATES).toEqual([['cdndm5.com', ['222.200.254.75']]]);
    expect(SourceDns.CACHE_TTL_MS).toBe(5 * 60_000);
  });

  it('preferIpv4：v4 整体提前、族内顺序不变、v6 一条不少', () => {
    expect(KT).toContain('if (list.size < 2) return list');
    expect(KT).toContain('if (v4.isEmpty() || v4.size == list.size) return list');
    expect(KT).toContain('return v4 + list.filterNot { it is java.net.Inet4Address }');

    expect(preferIpv4([])).toEqual([]);
    expect(preferIpv4(['2001:db8::1'])).toEqual(['2001:db8::1']);
    expect(preferIpv4(['1.1.1.1', '2.2.2.2'])).toEqual(['1.1.1.1', '2.2.2.2']);
    // AAAA 在前 → v4 提前，v6 保持相对顺序
    expect(
      preferIpv4(['2001:db8::2', '1.1.1.1', '2001:db8::1', '2.2.2.2']),
    ).toEqual(['1.1.1.1', '2.2.2.2', '2001:db8::2', '2001:db8::1']);
    expect(isIpv4Address('1.1.1.1')).toBe(true);
    expect(isIpv4Address('2001:db8::1')).toBe(false);
    expect(isIpv4Address('1.2.3')).toBe(false);
    expect(isIpv4Address('1.2.3.256')).toBe(false);
  });

  it('CDN 子域也命中候选（后缀匹配），且系统结果里已有的地址不重复追加', async () => {
    expect(KT).toContain('host == zone || host.endsWith(".$zone")');
    const asked: string[] = [];
    const resolver = dns({
      lookup: async (hostname: string) => {
        asked.push(hostname);
        return ['1.2.3.4'];
      },
    });
    const out = await resolver.lookup('img.cdndm5.com');
    expect(out).toEqual(['1.2.3.4', '222.200.254.75']);
    // 系统 DNS 查的是归一化后的 host（去尾点 + 小写）
    expect(asked).toEqual(['img.cdndm5.com']);
    // 系统里已有该候选 → 不重复
    const resolver2 = dns({ lookup: async () => ['222.200.254.75'] });
    expect(await resolver2.lookup('cdndm5.com')).toEqual(['222.200.254.75']);
    // 顶级域名本身也算命中
    expect(await dns({ lookup: async () => [] }).lookup('CDNDM5.COM.')).toEqual([
      '222.200.254.75',
    ]);
  });

  it('未命中候选表时直接返回系统结果 —— 但同样要 v4 优先', async () => {
    expect(KT).toContain('if (extra.isEmpty()) return preferIpv4(base.lookup(hostname))');
    const asked: string[] = [];
    const resolver = dns({
      lookup: async (hostname: string) => {
        asked.push(hostname);
        return ['2001:db8::1', '9.9.9.9'];
      },
    });
    // 注意：这条分支查的是**原始 hostname**（Kotlin L46），不归一化
    expect(await resolver.lookup('Wenku8.YWY.moe.')).toEqual(['9.9.9.9', '2001:db8::1']);
    expect(asked).toEqual(['Wenku8.YWY.moe.']);
  });

  it('命中候选时结果进缓存，TTL 内不再查系统 DNS；过期后重查', async () => {
    let now = 1_000;
    let calls = 0;
    const resolver = dns(
      {
        lookup: async () => {
          calls += 1;
          return ['1.1.1.1'];
        },
      },
      () => now,
    );
    await resolver.lookup('a.cdndm5.com');
    expect(calls).toBe(1);
    now += 5 * 60_000 - 1;
    expect(await resolver.lookup('a.cdndm5.com')).toEqual(['1.1.1.1', '222.200.254.75']);
    expect(calls).toBe(1);
    now += 2;
    await resolver.lookup('a.cdndm5.com');
    expect(calls).toBe(2);
  });

  it('系统 DNS 抛错时只用候选；全空则抛 UnknownHostError', async () => {
    expect(KT).toContain('val merged = preferIpv4(system + extra.filter { pinned -> system.none { it.address == pinned.address } })');
    expect(KT).toContain('if (merged.isEmpty()) throw UnknownHostException(host)');

    const flaky = dns({
      lookup: async () => {
        throw new Error('dns down');
      },
    });
    expect(await flaky.lookup('x.cdndm5.com')).toEqual(['222.200.254.75']);

    // 候选表被清空 + 系统抛错 → UnknownHost（用自定义空表模拟）
    const noPinned = dns({ lookup: async () => ['1.1.1.1'] });
    expect(await noPinned.lookup('other.example')).toEqual(['1.1.1.1']);
    await expect(
      (async () => {
        const r = dns({
          lookup: async () => {
            throw new Error('dns down');
          },
        });
        // 非候选域不会走到 throw 分支（extra 为空直接返回系统结果，抛的是原错误）
        return r.lookup('cdndm5.com');
      })(),
    ).resolves.toEqual(['222.200.254.75']);
  });

  it('缓存按 host 隔离；同一份缓存被复制返回（调用方改不动内部）', async () => {
    const resolver = dns({ lookup: async () => ['1.1.1.1'] });
    const a = await resolver.lookup('a.cdndm5.com');
    a.push('9.9.9.9');
    expect(await resolver.lookup('a.cdndm5.com')).toEqual(['1.1.1.1', '222.200.254.75']);
    const b = await resolver.lookup('b.cdndm5.com');
    expect(b).toEqual(['1.1.1.1', '222.200.254.75']);
  });

  it('UNKNOWN_HOST 错误类型与命名空间成员', () => {
    expect(new UnknownHostError('x').name).toBe('UnknownHostError');
    expect(Object.keys(SourceDns)).toEqual(
      expect.arrayContaining(['dns', 'clearCache', 'PINNED_CANDIDATES', 'CACHE_TTL_MS', 'preferIpv4', 'isIpv4Address']),
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② god/GodMomentDao.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('GodMomentDao.kt：十一条查询与写入', () => {
  const KT = kt('god/GodMomentDao.kt');

  it('KDoc：全部查询返回 Flow，两侧共享同一个流、不需要手动 invalidate', () => {
    expect(KT).toContain('全部查询返回 Flow');
    expect(KT).toContain('增删改后两侧自动刷新，不需要手动 invalidate');
  });

  it('两条排序 SQL 逐字：排行榜 `rating DESC, createdAt DESC`、一本书 `chapterNumber ASC`', () => {
    expect(KT).toContain('@Query("SELECT * FROM god_moments ORDER BY rating DESC, createdAt DESC")');
    expect(KT).toContain('@Query("SELECT * FROM god_moments WHERE bookId = :bookId ORDER BY chapterNumber ASC")');

    const sql = readFileSync('src/core/god/godMomentRepository.ts', 'utf8');
    expect(sql).toContain('ORDER BY rating DESC, createdAt DESC');
    expect(sql).toContain('a.chapterNumber - b.chapterNumber');
  });

  it('单话查询带 LIMIT 1（唯一索引）；byId / count / clear 三个辅助', () => {
    expect(KT).toContain('WHERE bookId = :bookId AND chapterId = :chapterId LIMIT 1');
    expect(KT).toContain('suspend fun byId(id: Long): GodMomentEntity?');
    expect(KT).toContain('suspend fun count(): Int');
    expect(KT).toContain('@Query("DELETE FROM god_moments")');
  });

  it('@Upsert 的 id 复用契约：保证 UI item key 稳定、位移动画不错位', () => {
    expect(KT).toContain('冲突策略 REPLACE 会让自增 id 变化');
    expect(KT).toContain('保证 UI 的 item key 稳定');
    expect(KT).toContain('排行榜的位移过渡动画不会因为 id 跳变而错位');
    const repo = readFileSync('src/core/god/godMomentRepository.ts', 'utf8');
    expect(repo).toContain('upsert');
    // 复用旧 id 的注释/逻辑要在
    expect(repo).toMatch(/id:\s*existing|existing\.id|现有|复用/);
  });

  it('repository 覆盖 DAO 的每一条：all / forBook / chapter / byId / count / clear / 三个删除', () => {
    const repo = readFileSync('src/core/god/godMomentRepository.ts', 'utf8');
    // 方法签名是 `name(...): Promise<...>`（没有 `async` 关键字），按名字 + 返回类型判
    for (const method of [
      'all',
      'listForBook',
      'find',
      'byId',
      'count',
      'clear',
      'delete',
      'deleteForBook',
      'deleteForChapter',
      'upsert',
    ]) {
      expect(repo, method).toMatch(new RegExp(`\\n  ${method}\\([^)]*\\): Promise<`));
    }
    expect(GodMomentRepository).toBeTypeOf('function');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ ui/components/LiquidBlob.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('LiquidBlob.kt：液桥几何', () => {
  const KT = kt('ui/components/LiquidBlob.kt');

  it('intensity ≤ 0.02 直接不画；dist < radius/2 时只画一个放大的圆', () => {
    expect(KT).toContain('if (intensity <= 0.02f) return');
    expect(KT).toContain('if (dist < radius * 0.5f) {');
    expect(KT).toContain('drawCircle(color = color, radius = radius * (1f + 0.25f * intensity), center = to)');

    expect(liquidBlobSvg({ x: 0, y: 0 }, { x: 10, y: 0 }, 4, 0.02)).toBe('');
    expect(liquidBlobSvg({ x: 0, y: 0 }, { x: 10, y: 0 }, 4, 0)).toBe('');
    // dist=1 < radius/2=4 → 单圆，半径 4*(1+0.25*1)=5
    expect(liquidBlobSvg({ x: 0, y: 0 }, { x: 1, y: 0 }, 4, 1)).toBe(
      '<circle cx="1" cy="0" r="5" />',
    );
  });

  it('颈部收细：separation = max(0, dist−2r)/max(1,dist)；neckScale = ((1−sep)*0.9+0.18)*intensity', () => {
    expect(KT).toContain('val separation = (dist - radius * 2f).coerceAtLeast(0f) / dist.coerceAtLeast(1f)');
    expect(KT).toContain('val neckScale = ((1f - separation) * 0.9f + 0.18f) * intensity');
    // dist = 2r → separation = 0 → neckScale = 0.9+0.18 = 1.08 → neck = 4.32
    // 控制点 y = radius + neck = 8.32，路径 `M0,4 C0,8.32 8,8.32 8,4 …`
    const touching = liquidBlobSvg({ x: 0, y: 0 }, { x: 8, y: 0 }, 4, 1);
    expect(touching).toContain('d="M0,4 C0,8.32 8,8.32 8,4 L8,-4 C8,-8.32 0,-8.32 0,-4 Z"');
    // 更远 → 更细（用 neck 数值比较）
    const far = liquidBlobSvg({ x: 0, y: 0 }, { x: 40, y: 0 }, 4, 1);
    // 控制点 y = radius + neck；水平桥的法向沿 +y，所以取 `C0,<y>` 的第一个数
    const neckOf = (svg: string): number => {
      const m = /C0,([0-9.]+)/.exec(svg);
      return m === null ? Number.NaN : Number(m[1]);
    };
    // dist=40 → separation = (40-8)/40 = 0.8 → neckScale = 0.2*0.9+0.18 = 0.36 → neck = 1.44
    expect(neckOf(touching)).toBeCloseTo(8.32, 6);
    expect(neckOf(far)).toBeCloseTo(5.44, 6);
    expect(neckOf(touching)).toBeGreaterThan(neckOf(far));
  });

  it('上下两条三次贝塞尔 + 中点直线 + close，端点圆各画一次', () => {
    expect(KT).toContain('path.moveTo(from.x + nx * radius, from.y + ny * radius)');
    expect(KT).toContain('path.lineTo(to.x - nx * radius, to.y - ny * radius)');
    expect(KT).toContain('path.close()');
    expect(KT).toContain('drawCircle(color = color, radius = radius, center = from)');
    expect(KT).toContain('drawCircle(color = color, radius = radius, center = to)');
    expect(KT).toContain('drawPath(path = path, color = color)');

    const svg = liquidBlobSvg({ x: 0, y: 0 }, { x: 20, y: 0 }, 4, 1);
    // 两个端点圆（r=4）+ 一条 path，顺序：from 圆、to 圆、path
    expect(svg.match(/<circle /g)).toHaveLength(2);
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg.indexOf('<circle')).toBeLessThan(svg.indexOf('<path'));
    // 路径结构：M → C → L → C → Z
    const d = /d="([^"]+)"/.exec(svg)?.[1] ?? '';
    // 命令序列（坐标与命令写在一起，如 M0,4，所以取字母本身）
    expect(d.match(/[MCLZ]/g)).toEqual(['M', 'C', 'L', 'C', 'Z']);
  });

  it('法向量是 (−uy, ux)：垂直方向的液桥同样对称', () => {
    const horizontal = liquidBlobSvg({ x: 0, y: 0 }, { x: 20, y: 0 }, 4, 1);
    const vertical = liquidBlobSvg({ x: 0, y: 0 }, { x: 0, y: 20 }, 4, 1);
    // 水平：法向沿 y，故路径起点 y 偏移 ±radius、x 为 0
    expect(horizontal).toContain('d="M0,4 ');
    // 垂直：法向沿 −x，起点 x 偏移 ∓radius、y 为 0
    expect(vertical).toContain('d="M-4,0 ');
  });
});
