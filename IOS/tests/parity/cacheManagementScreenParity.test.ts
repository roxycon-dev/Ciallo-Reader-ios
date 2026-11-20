/**
 * cacheManagementScreenParity.test.ts —— 缓存管理页（`ui/CacheManagementScreen.kt`，855 行）。
 *
 * 可判定部分三块：
 *   · **数据模型**：四类封面目录、受管子目录、一键清理键、zone 划分；
 *   · **格式化**：`formatSize`（GB/MB 一位、KB **零位**）、`formatCacheSize`（另一套单位写法）；
 *   · **四段动画**：Shimmer 骨架、文件飞入、打勾、成功徽标。
 *
 * 本轮修掉的一处：**成功徽标的底色与阴影** —— 底色写死成白（深色主题也是白面板）；
 * 阴影用了未折损的 `.12/.16`，还把 elevation 当成 12/24px 的下偏移。
 * `ShadowGlow.kt` 的有效 alpha 要 × `SHADOW_*_ALPHA_GAIN(.10)`、`σ = e × .22`、
 * spot 下移 `e × .28` → 12dp 的正确值是
 * `0px 0px 3.05px rgba(0,0,0,.012), 0px 3.36px 3.05px rgba(0,0,0,.016)`。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  CACHE_MANAGED_SUBDIRS,
  COVER_DIRS,
  DETAIL_FIRST_KEYS,
  ONE_TAP_CACHE_KEYS,
  ZONE_META,
  formatCacheSize,
  formatSize,
  segmentedSegments,
  zoneTotal,
} from '@core/cache/cacheManagement';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/ui/CacheManagementScreen.kt'),
  'utf8',
);
const PAGE = readFileSync('src/ui/pages/CacheManagementPage.tsx', 'utf8');
const CSS = readFileSync('src/styles/statistics.css', 'utf8');

describe('CacheManagementScreen.kt：目录与分区模型', () => {
  it('四类封面目录逐字（漫画 / EPUB / FB2 / MOBI）', () => {
    expect(KT).toContain('private val COVER_DIRS = listOf("comic_covers", "epub_covers", "fb2_covers", "mobi_covers")');
    expect([...COVER_DIRS]).toEqual(['comic_covers', 'epub_covers', 'fb2_covers', 'mobi_covers']);
    expect(COVER_DIRS).toHaveLength(4);
  });

  it('受管子目录：ehimg / image_cache / comic_image_cache / comic_processed_v1 / manga_translate_v1', () => {
    expect([...CACHE_MANAGED_SUBDIRS]).toEqual([
      'ehimg',
      'image_cache',
      'comic_image_cache',
      'comic_processed_v1',
      'manga_translate_v1',
    ]);
    // 受管目录不得出现在一键清理键里之外的地方；两集合的交集就是前三个
    expect([...CACHE_MANAGED_SUBDIRS].filter((dir) => ONE_TAP_CACHE_KEYS.includes(dir))).toEqual([
      'ehimg',
      'image_cache',
      'comic_image_cache',
    ]);
  });

  it('一键清理只碰可再生缓存：不包含译文 / 模型 / 离线内容', () => {
    expect([...ONE_TAP_CACHE_KEYS]).toEqual([
      'ehimg',
      'image_cache',
      'comic_image_cache',
      'comic_processed',
      'external_cache',
      'temp',
    ]);
    for (const forbidden of ['downloads', 'imports', 'comics', 'covers', 'translation', 'models']) {
      expect(ONE_TAP_CACHE_KEYS).not.toContain(forbidden);
    }
  });

  it('zone 标题与顺序（0 缓存 / 1 用户数据 / 2 应用数据）', () => {
    expect(KT).toContain('val zoneMeta = listOf(0 to tr("可清理缓存"), 1 to tr("离线内容与个人文件"), 2 to tr("应用与设置"))');
    expect(ZONE_META.map(([zone]) => zone)).toEqual([0, 1, 2]);
    expect(ZONE_META.map(([, title]) => title)).toEqual(['可清理缓存', '离线内容与个人文件', '应用与设置']);
  });

  it('详情优先的四类 key（下载 / 导入 / 漫画 / 封面）', () => {
    expect(KT).toContain('row.key in setOf("downloads", "imports", "comics", "covers")');
    expect([...DETAIL_FIRST_KEYS]).toEqual(['downloads', 'imports', 'comics', 'covers']);
  });

  it('zoneTotal 只累加该分区的行', () => {
    const rows = [
      { key: 'a', size: 10, zone: 0 },
      { key: 'b', size: 20, zone: 0 },
      { key: 'c', size: 5, zone: 1 },
    ] as never[];
    expect(zoneTotal(rows, 0)).toBe(30);
    expect(zoneTotal(rows, 1)).toBe(5);
    expect(zoneTotal(rows, 2)).toBe(0);
  });
});

describe('CacheManagementScreen.kt：formatSize 的四档', () => {
  it('GB / MB 一位小数，KB **零位**，B 原样', () => {
    expect(KT).toContain('bytes >= 1_073_741_824 -> String.format(Locale.getDefault(), "%.1f GB"');
    expect(KT).toContain('bytes >= 1_048_576 -> String.format(Locale.getDefault(), "%.1f MB"');
    expect(KT).toContain('bytes >= 1_024 -> String.format(Locale.getDefault(), "%.0f KB"');
    expect(KT).toContain('else -> "$bytes B"');

    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1024)).toBe('1 KB');
    expect(formatSize(1536)).toBe('2 KB'); // %.0f 四舍五入
    expect(formatSize(1023)).toBe('1023 B');
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatSize(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
  });

  it('formatCacheSize 是另一套写法（无空格、KB 截断、按 1<<20 分档）', () => {
    expect(formatCacheSize(1024)).toBe('1KB');
    expect(formatCacheSize(1536)).toBe('1KB');
    expect(formatCacheSize(1 << 20)).toBe('1.0MB');
    expect(formatCacheSize(512)).toBe('512B');
  });

  it('档位边界：1023 B → B、1024 → KB、1 MiB → MB、1 GiB → GB', () => {
    expect(formatSize(1023)).toContain('B');
    expect(formatSize(1024)).toContain('KB');
    expect(formatSize(1_048_575)).toContain('KB');
    expect(formatSize(1_048_576)).toContain('MB');
    expect(formatSize(1_073_741_823)).toContain('MB');
    expect(formatSize(1_073_741_824)).toContain('GB');
  });
});

describe('CacheManagementScreen.kt：动效参数', () => {
  it('骨架：128×38 r10 / 76×16 r8 / 8dp 条 r4 / 三行 14dp r7；间距 8·18·14·8', () => {
    expect(KT).toContain('ShimmerBox(modifier = Modifier.size(width = 128.dp, height = 38.dp), cornerRadius = 10)');
    expect(KT).toContain('ShimmerBox(modifier = Modifier.size(width = 76.dp, height = 16.dp), cornerRadius = 8)');
    expect(KT).toContain('ShimmerBox(modifier = Modifier.fillMaxWidth().height(8.dp), cornerRadius = 4)');
    expect(KT).toContain('ShimmerBox(modifier = Modifier.fillMaxWidth().height(14.dp), cornerRadius = 7)');
    expect(KT).toContain('repeat(3) {');
    expect(PAGE).toContain('width: 128, height: 38, borderRadius: 10');
    expect(PAGE).toContain('width: 76, height: 16, borderRadius: 8');
    expect(PAGE).toContain("height: 8, borderRadius: 4");
    expect(PAGE).toContain("height: 14, borderRadius: 7");
    // Shimmer 周期 1100ms 线性（WenkuMotion/SkeletonProgress 同款）
    expect(CSS).toContain('animation: cache-shimmer 1100ms linear infinite;');
  });

  it('文件飞入：22dp / 1250ms / 3 个方块 / 抛物线 y = (phase²) / 边长 .26w·(1−.55p) / 桶口 .22→.78', () => {
    expect(KT).toContain('Canvas(modifier = modifier.size(22.dp))');
    expect(KT).toContain('tween(1250, easing = LinearEasing)');
    expect(KT).toContain('for (i in 0..2)');
    expect(KT).toContain('val phase = (t + i / 3f) % 1f');
    expect(KT).toContain('(cy - size.height * 0.02f) * (phase * phase)');
    expect(KT).toContain('val side = size.width * 0.26f * (1f - phase * 0.55f)');
    expect(KT).toContain('start = Offset(size.width * 0.22f, size.height * 0.88f)');
    expect(KT).toContain('end = Offset(size.width * 0.78f, size.height * 0.88f)');

    expect(PAGE).toContain('const box = 22;');
    expect(PAGE).toContain('const duration = 1250;');
    expect(PAGE).toContain('const phase = (t + i / 3) % 1;');
    expect(PAGE).toContain('(cy - box * 0.02) * (phase * phase)');
    expect(PAGE).toContain('const side = box * 0.26 * (1 - phase * 0.55);');
  });

  it('打勾：28dp / 3.5dp / 420ms / 45% 分段，短边先画', () => {
    expect(KT).toContain('Canvas(Modifier.size(28.dp))');
    expect(KT).toContain('val stroke = 3.5.dp.toPx()');
    expect(KT).toContain('val p1 = (progress / 0.45f).coerceIn(0f, 1f)');
    expect(KT).toContain('val p2 = ((progress - 0.45f) / 0.55f).coerceIn(0f, 1f)');
    expect(KT).toContain('tween(420, easing = FastOutSlowInEasing)');
    expect(PAGE).toContain('const size = 28;');
    expect(PAGE).toContain('strokeWidth={3.5}');
    expect(PAGE).toContain('animation: \'cache-check 420ms cubic-bezier(0.4,0,0.2,1) 0ms forwards\'');
    // 第二笔的延迟 = 420 × 0.45 = 189ms
    expect(PAGE).toContain('189ms forwards');
    expect(Math.round(420 * 0.45)).toBe(189);
  });

  it('成功徽标：r24 / 内边距 30×22 / 56dp 圆 #00B894 / 标题 15sp / 副文案 13sp', () => {
    expect(KT).toContain('shape = RoundedCornerShape(24.dp)');
    expect(KT).toContain('.padding(horizontal = 30.dp, vertical = 22.dp)');
    expect(KT).toContain('.size(56.dp)');
    expect(KT).toContain('Color(0xFF00B894)');
    expect(KT).toContain('Text(tr("清理完成"), fontSize = 15.sp, fontWeight = FontWeight.SemiBold)');
    expect(KT).toContain('"已释放 $freedText"');
    expect(CSS).toContain('padding: 22px 30px;');
    expect(CSS).toContain('border-radius: 24px;');
    expect(CSS).toContain('width: 56px; height: 56px;');
    expect(CSS).toContain('background: #00B894;');
    expect(CSS).toContain('font-size: 15px; font-weight: 600;');
    expect(CSS).toContain('font-size: 13px;');
    expect(PAGE).toContain('已释放 {props.freedText}');
  });

  it('徽标底色 = surface@.96（不是写死白），阴影按 ShadowGlow 的 0.10 增益折损', () => {
    expect(KT).toContain('color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f)');
    expect(KT).toContain('elevation = 12.dp');
    expect(KT).toContain('ambientColor = Color.Black.copy(alpha = 0.12f)');
    expect(KT).toContain('spotColor = Color.Black.copy(alpha = 0.16f)');

    const badge = CSS.slice(CSS.indexOf('.cache-badge {'), CSS.indexOf('.cache-badge__circle {'));
    expect(badge).toContain('color-mix(in srgb, var(--cache-surface, #FFFFFF) 96%, transparent)');
    expect(badge).not.toContain('rgba(255, 255, 255, 0.96)');
    // 有效 alpha：.12 × .10 = .012、.16 × .10 = .016
    expect(badge).toContain('rgba(0, 0, 0, 0.012)');
    expect(badge).toContain('rgba(0, 0, 0, 0.016)');
    expect(badge).not.toContain('rgba(0, 0, 0, 0.12)');
    // spot 下移 12 × .28 = 3.36px
    expect(badge).toContain('3.36px');
    // 深色主题有独立的 surface
    expect(CSS).toContain("[data-theme='dark'] .cache-badge {");
    expect(CSS).toContain('--cache-surface: #242424;');
  });

  it('占比条：weight 下限 .005，逐段延迟 90ms', () => {
    expect(KT).toContain('coerceAtLeast(0.005f)');
    const segments = segmentedSegments(100, 50, 25, 0, 1000);
    expect(segments.map((s) => s.id)).toEqual(['cache', 'user', 'appdata']);
    expect(segments.map((s) => s.growDelayMs)).toEqual([0, 90, 180]);
    expect(segments[0]?.weight).toBeCloseTo(0.1, 9);
    // 极小的段落被抬到 .005（否则看不见）
    const tiny = segmentedSegments(1, 0, 0, 0, 1_000_000);
    expect(tiny[0]?.weight).toBeCloseTo(0.005, 9);
    // 「其他」段只在 > 0 时出现
    expect(segmentedSegments(1, 0, 0, 5, 100).map((s) => s.id)).toEqual([
      'cache',
      'user',
      'appdata',
      'other',
    ]);
  });

  it('清理成功的停留时长 2400ms；总占用数字滚动 650ms FastOutSlowIn', () => {
    expect(KT).toContain('delay(2400)');
    expect(KT).toContain('tween(650, easing = FastOutSlowInEasing)');
  });
});
