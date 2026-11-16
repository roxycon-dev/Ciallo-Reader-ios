import { requireTransfer } from './transferWire';

/** Account for bridge JSON escaping without fetching large bodies first. A
 * single format-bounded row may exceed the preferred batch size; subsequent
 * rows wait for the next page. Metadata itself is limited to 128 entries. */
export function boundedTransferBatch<T extends { bytes: number }>(rows: readonly T[], expansion: 2 | 6): T[] {
  requireTransfer(rows.length <= 128, '迁移元数据批次过大'); const selected: T[] = []; let bytes = 0;
  for (const row of rows) {
    requireTransfer(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= 2 * 1024 * 1024, '本机数据行超过迁移大小限制');
    const cost = row.bytes * expansion + 512;
    if (selected.length && bytes + cost > 1024 * 1024) break;
    selected.push(row); bytes += cost;
  }
  return selected;
}
