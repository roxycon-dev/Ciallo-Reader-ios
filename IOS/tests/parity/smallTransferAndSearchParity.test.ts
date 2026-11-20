/**
 * smallTransferAndSearchParity.test.ts —— 第十批（49–51 行档，3 个文件，合计 145 行）。
 *
 *   · `transfer/TransferService.kt`（51）—— 互传前台服务的**可判定部分**（E175 三层补齐）
 *   · `library/SourceSearchCoordinator.kt`（50）—— 1100ms 间距 + 60s 缓存 + 最多 8 条
 *   · `library/ReadingRecordMetadata.kt`（50）—— 阅读记录 → 原始书源的键值快照
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  TRANSFER_CANCEL_ACTION,
  TRANSFER_CHANNEL_ID,
  TRANSFER_CHANNEL_IMPORTANCE_LOW,
  TRANSFER_CHANNEL_NAME_RAW,
  TRANSFER_NOTIFICATION_ID,
  TRANSFER_TERMINAL_PHASES,
  shouldStopForeground,
  transferBusy,
  transferNotificationContent,
  transferProgressIndeterminate,
  transferProgressPercent,
  transferShowsCancelAction,
} from '@core/transfer/transferNotification';
import type { TransferPhase, TransferSessionState } from '@core/transfer/transferModels';
import { transferPhaseLabel } from '@core/transfer/transferModels';
import {
  createWebTransferNotificationPort,
  currentWebTransferNotification,
  subscribeWebTransferNotification,
  triggerWebTransferCancel,
} from '@platform/web/transferNotification';
import { createNativeTransferNotificationPort } from '@platform/ios-native/transferNotification';
import { SourceSearchCoordinator } from '@core/library/librarySearchCoordinator';
import {
  ReadingRecordMetadata,
} from '@core/library/libraryReadingRecords';
import type { ReadingRecordMetadataPrefs } from '@core/library/libraryReadingRecords';
import { createSearchBook, type SearchBook } from '@core/source/searchBook';
import { sourceError, sourceSuccess } from '@core/source/sourceResult';
import { NetworkError } from '@core/source/sourceException';
import type { BookSource } from '@core/source/bookSource';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

describe('TransferService.kt：通知内容与终态判定（E175）', () => {
  const KT = kt('transfer/TransferService.kt');

  function state(phase: TransferPhase, options: {
    message?: string;
    completed?: number;
    total?: number;
  } = {}): TransferSessionState {
    return {
      phase,
      peer: null,
      progress: {
        phase,
        completedBytes: options.completed ?? 0,
        totalBytes: options.total ?? 0,
        bytesPerSecond: 0,
        message: '',
      },
      verificationCode: null,
      incoming: false,
      preview: null,
      result: null,
      error: null,
      message: options.message ?? '',
      peerReceived: false,
      peerImported: false,
    };
  }

  it('通知 id 7301；渠道 device_transfer / 设备互传 / IMPORTANCE_LOW', () => {
    expect(KT).toContain('private val notificationId=7301');
    expect(KT).toContain('NotificationChannel("device_transfer","设备互传",NotificationManager.IMPORTANCE_LOW)');
    expect(TRANSFER_NOTIFICATION_ID).toBe(7301);
    expect(TRANSFER_CHANNEL_ID).toBe('device_transfer');
    expect(TRANSFER_CHANNEL_NAME_RAW).toBe('设备互传');
    expect(TRANSFER_CHANNEL_IMPORTANCE_LOW).toBe(2);
  });

  it('标题 = phase.label；正文 = message，空则「数据正在设备之间安全传输」', () => {
    expect(KT).toContain('.setContentTitle(state.phase.label)');
    expect(KT).toContain('state.message.ifBlank { com.example.i18n.tr("数据正在设备之间安全传输") }');

    const withMessage = transferNotificationContent(state('TRANSFERRING', { message: '3.2 MB/s' }));
    expect(withMessage.title).toBe(transferPhaseLabel('TRANSFERRING'));
    expect(withMessage.text).toBe('3.2 MB/s');

    const blank = transferNotificationContent(state('CONNECTING', { message: '   ' }));
    expect(blank.text).toBe('数据正在设备之间安全传输');
  });

  it('onlyAlertOnce 恒 true；ongoing = busy（6 个进行中阶段）', () => {
    expect(KT).toContain('.setOnlyAlertOnce(true).setOngoing(state.busy)');
    expect(transferNotificationContent(state('TRANSFERRING')).alertOnce).toBe(true);
    for (const phase of ['PREPARING', 'CONNECTING', 'AWAITING_CONFIRMATION', 'TRANSFERRING', 'VERIFYING', 'IMPORTING'] as TransferPhase[]) {
      expect(transferBusy(phase), phase).toBe(true);
    }
    for (const phase of ['IDLE', 'COMPLETED', 'CANCELLED', 'FAILED', 'WAITING_TO_RESUME', 'RECEIVED'] as TransferPhase[]) {
      expect(transferBusy(phase), phase).toBe(false);
    }
    expect(transferNotificationContent(state('COMPLETED')).ongoing).toBe(false);
  });

  it('进度：max 100、值 = trunc(fraction*100)、totalBytes==0 时不确定', () => {
    expect(KT).toContain('.setProgress(100,(state.progress.fraction*100).toInt(),state.progress.totalBytes==0L)');
    const half = transferNotificationContent(state('TRANSFERRING', { completed: 50, total: 100 }));
    expect(half.progressMax).toBe(100);
    expect(half.progressValue).toBe(50);
    expect(half.indeterminate).toBe(false);
    // 截断而非四舍五入：33.9% → 33
    expect(transferProgressPercent(state('TRANSFERRING', { completed: 339, total: 1000 }))).toBe(33);
    expect(transferProgressIndeterminate(state('TRANSFERRING', { completed: 5, total: 0 }))).toBe(true);
  });

  it('取消按钮：IMPORTING 阶段不给（导入一旦开始就不能半途取消）', () => {
    expect(KT).toContain('if(state.phase!=TransferPhase.IMPORTING)addAction(android.R.drawable.ic_menu_close_clear_cancel,"取消",cancel)');
    expect(transferShowsCancelAction('TRANSFERRING')).toBe(true);
    expect(transferShowsCancelAction('IMPORTING')).toBe(false);
  });

  it('四个终态撤下前台通知；onStartCommand / onTimeout 都取消', () => {
    expect(KT).toContain('if(state.phase in setOf(TransferPhase.COMPLETED,TransferPhase.CANCELLED,TransferPhase.FAILED,TransferPhase.WAITING_TO_RESUME)) { stopF');
    expect(TRANSFER_TERMINAL_PHASES).toEqual(['COMPLETED', 'CANCELLED', 'FAILED', 'WAITING_TO_RESUME']);
    expect(shouldStopForeground('COMPLETED')).toBe(true);
    expect(shouldStopForeground('WAITING_TO_RESUME')).toBe(true);
    expect(shouldStopForeground('TRANSFERRING')).toBe(false);

    expect(KT).toContain('if(intent?.action=="cancel") { TransferManager.get(this).cancel(); stopSelf() }');
    expect(KT).toContain('override fun onTimeout(startId:Int,fgsType:Int) { TransferManager.get(this).cancel(); stopSelf() }');
    expect(TRANSFER_CANCEL_ACTION).toBe('cancel');
  });

  it('三层端口：web 真的挂上横幅并可撤下；ios-native 在非原生环境返回 false', async () => {
    const web = createWebTransferNotificationPort();
    const payload = transferNotificationContent(state('TRANSFERRING', { completed: 1, total: 4 }));
    const seen: Array<number | null> = [];
    const off = subscribeWebTransferNotification((value) => seen.push(value?.progressValue ?? null));
    await expect(web.publish(payload)).resolves.toBe(true);
    expect(currentWebTransferNotification()?.progressValue).toBe(25);
    await web.clear(TRANSFER_NOTIFICATION_ID);
    expect(currentWebTransferNotification()).toBeNull();
    expect(seen).toEqual([25, null]);
    off();

    let cancelled = 0;
    const offCancel = web.onCancel(() => (cancelled += 1));
    triggerWebTransferCancel();
    expect(cancelled).toBe(1);
    offCancel();

    const native = createNativeTransferNotificationPort();
    // 测试环境不是原生平台 → 「没能挂上」，调用方据此退到应用内横幅（不假装成功）
    await expect(native.publish(payload)).resolves.toBe(false);
    await expect(native.clear(TRANSFER_NOTIFICATION_ID)).resolves.toBeUndefined();
  });
});

describe('SourceSearchCoordinator.kt：站点级间距与缓存', () => {
  const KT = kt('library/SourceSearchCoordinator.kt');

  function sourceOf(id: string): BookSource {
    return { id, name: id, type: 'novel' } as unknown as BookSource;
  }

  it('默认 1100ms 间距 / 60s 缓存；关键字 trim', () => {
    expect(KT).toContain('private val spacingMs: Long = 1_100');
    expect(KT).toContain('private val cacheMs: Long = 60_000');
    expect(KT).toContain('val query = keyword.trim()');
    const coordinator = new SourceSearchCoordinator(0, 60_000, () => 0);
    expect(coordinator).toBeInstanceOf(SourceSearchCoordinator);
  });

  it('命中缓存不再请求；缓存按站点 + 查询串隔离', async () => {
    expect(KT).toContain('site.cache[query]?.takeIf {');
    let now = 0;
    let calls = 0;
    const coordinator = new SourceSearchCoordinator(0, 60_000, () => now);
    const source = sourceOf('a');
    const request = async () => {
      calls += 1;
      return sourceSuccess([createSearchBook({ id: '1', sourceId: 'a', title: 'T', author: 'A' })]);
    };
    await coordinator.search(source, ' 无职 ', request);
    expect(calls).toBe(1);
    // 同一个 keyword（trim 后相同）→ 命中缓存
    await coordinator.search(source, '无职', request);
    expect(calls).toBe(1);
    // 别的站点 / 别的关键词 → 重新请求
    await coordinator.search(sourceOf('b'), '无职', request);
    await coordinator.search(source, '别的', request);
    expect(calls).toBe(3);
    // 缓存过期（> 60s）→ 重新请求
    now = 60_000;
    await coordinator.search(source, '无职', request);
    expect(calls).toBe(4);
  });

  it('空结果与失败都不进缓存（可能是临时限流）', async () => {
    expect(KT).toContain('if (result is SourceResult.Success && result.data.isNotEmpty())');
    let calls = 0;
    const coordinator = new SourceSearchCoordinator(0, 60_000, () => 0);
    const source = sourceOf('c');
    await coordinator.search(source, 'q', async () => {
      calls += 1;
      return sourceSuccess([]);
    });
    await coordinator.search(source, 'q', async () => {
      calls += 1;
      return sourceSuccess([]);
    });
    expect(calls).toBe(2);

    let failures = 0;
    await coordinator.search(source, 'q2', async () => {
      failures += 1;
      return sourceError(new NetworkError('500'));
    });
    await coordinator.search(source, 'q2', async () => {
      failures += 1;
      return sourceError(new NetworkError('500'));
    });
    expect(failures).toBe(2);
  });

  it('同站点第二次请求要等够 spacingMs（从上次 finishedAt 起算）', async () => {
    expect(KT).toContain('site.finishedAt?.let { delay((spacingMs - (now() - it)).coerceAtLeast(0)) }');
    let now = 0;
    const waits: number[] = [];
    const coordinator = new SourceSearchCoordinator(1_100, 60_000, () => now);
    const source = sourceOf('d');
    const request = async () => {
      waits.push(now);
      return sourceSuccess([createSearchBook({ id: 'x', sourceId: 'd', title: 'T', author: 'A' })]);
    };
    await coordinator.search(source, 'k1', request);
    // 立刻再搜另一个词：必须等到 now >= 1100
    now = 300;
    const pending = coordinator.search(source, 'k2', request);
    await Promise.resolve();
    expect(waits).toHaveLength(1);
    now = 1_100;
    await pending;
    expect(waits).toHaveLength(2);
  });

  it('缓存最多 8 条，按时间降序保留最新的', async () => {
    expect(KT).toContain('.entries.sortedByDescending { it.value.at }.take(8)');
    let now = 0;
    const coordinator = new SourceSearchCoordinator(0, 60_000, () => now);
    const source = sourceOf('e');
    for (let i = 0; i < 10; i += 1) {
      now = i * 100;
      await coordinator.search(source, `k${String(i)}`, async () =>
        sourceSuccess([createSearchBook({ id: String(i), sourceId: 'e', title: 'T', author: 'A' })]),
      );
    }
    // 最早的 k0 / k1 已被挤出：重新搜它们会再次发请求
    now = 1_000;
    let calls = 0;
    await coordinator.search(source, 'k0', async () => {
      calls += 1;
      return sourceSuccess([createSearchBook({ id: 'new', sourceId: 'e', title: 'T', author: 'A' })]);
    });
    expect(calls).toBe(1);
    // 最新的 k9 仍在缓存里
    await coordinator.search(source, 'k9', async () => {
      calls += 1;
      return sourceSuccess([]);
    });
    expect(calls).toBe(1);
  });
});

describe('ReadingRecordMetadata.kt：记录 → 原始书源快照', () => {
  const KT = kt('library/ReadingRecordMetadata.kt');

  function prefsStore(): ReadingRecordMetadataPrefs & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getString: async (key: string) => data.get(key) ?? null,
      putString: async (key: string, value: string) => {
        data.set(key, value);
      },
    };
  }

  function book(overrides: Partial<SearchBook> = {}): SearchBook {
    return createSearchBook({
      id: 'book-1',
      sourceId: 'ixdzs8',
      title: '无职转生',
      author: '理不尽',
      ...overrides,
    });
  }

  it('prefs 名 reading_record_metadata；key = book:<id> 或 title:<书名>', () => {
    expect(KT).toContain('context.getSharedPreferences("reading_record_metadata", Context.MODE_PRIVATE)');
    expect(KT).toContain('private fun key(bookId: Int?, title: String) = bookId?.let { "book:$it" } ?: "title:$title"');
    expect(ReadingRecordMetadata.key(7, 'x')).toBe('book:7');
    expect(ReadingRecordMetadata.key(null, '无职转生')).toBe('title:无职转生');
  });

  it('remember：空标题直接跳过；comicId 空则退到 book.id；同时写 record:<id>', async () => {
    expect(KT).toContain('if (book.title.isBlank()) return');
    expect(KT).toContain('put("comicId", book.comicId?.takeIf { it.isNotBlank() } ?: book.id)');
    const prefs = prefsStore();
    const metadata = new ReadingRecordMetadata(prefs);
    await metadata.remember(book({ title: '   ' }), 1, 2);
    expect(prefs.data.size).toBe(0);

    await metadata.remember(book(), 7, 99);
    expect(prefs.data.has('book:7')).toBe(true);
    expect(prefs.data.has('record:99')).toBe(true);
    const stored = JSON.parse(prefs.data.get('book:7') ?? '{}') as Record<string, string>;
    expect(stored).toMatchObject({ title: '无职转生', sourceId: 'ixdzs8', comicId: 'book-1', author: '理不尽' });
  });

  it('find：先按 record:<id>，再按 book/title 键；标题不符即作废', async () => {
    expect(KT).toContain('decode(prefs.getString("record:${record.id}", null), record.bookTitle)');
    const prefs = prefsStore();
    const metadata = new ReadingRecordMetadata(prefs);
    await metadata.remember(book(), 7, 99);
    const found = await metadata.find({
      id: 99,
      bookId: 7,
      bookTitle: '无职转生',
    } as never);
    expect(found?.id).toBe('book-1');
    expect(found?.sourceId).toBe('ixdzs8');

    // 标题对不上 → 两个键都解不出来
    const mismatch = await metadata.find({ id: 99, bookId: 7, bookTitle: '别的书' } as never);
    expect(mismatch).toBeNull();
  });

  it('decode：空 JSON / 标题不符 / 空 id / `record_` 前缀 / 坏 JSON 都是 null', () => {
    expect(KT).toContain('if (obj.optString("title") != title) return null');
    expect(KT).toContain('if (id.isBlank() || id.startsWith("record_")) return null');
    expect(ReadingRecordMetadata.decode(null, 't')).toBeNull();
    expect(ReadingRecordMetadata.decode('not json', 't')).toBeNull();
    expect(ReadingRecordMetadata.decode(JSON.stringify({ title: 'x', comicId: 'c' }), 't')).toBeNull();
    expect(ReadingRecordMetadata.decode(JSON.stringify({ title: 't', comicId: '' }), 't')).toBeNull();
    expect(ReadingRecordMetadata.decode(JSON.stringify({ title: 't', comicId: 'record_5' }), 't')).toBeNull();
    const ok = ReadingRecordMetadata.decode(
      JSON.stringify({ title: 't', comicId: 'c1', sourceId: 's', author: 'a', cover: '' }),
      't',
    );
    expect(ok).toMatchObject({ id: 'c1', sourceId: 's', title: 't', author: 'a' });
    // cover 空串 → null（不是 ''）
    expect(ok?.cover).toBeNull();
  });

  it('rememberLocal：本地书用 comicId 或 `local:<id>` 作 id', async () => {
    expect(KT).toContain('id = book.comicId ?: "local:${book.id}"');
    const prefs = prefsStore();
    const metadata = new ReadingRecordMetadata(prefs);
    await metadata.rememberLocal(
      {
        id: 5,
        comicId: null,
        sourceId: 'mangadex',
        title: '本地漫画',
        author: '作者',
        coverUri: 'file:///c.jpg',
        filePath: null,
      },
      11,
    );
    const stored = JSON.parse(prefs.data.get('book:5') ?? '{}') as Record<string, string>;
    expect(stored.comicId).toBe('local:5');
    expect(stored.cover).toBe('file:///c.jpg');
  });
});
