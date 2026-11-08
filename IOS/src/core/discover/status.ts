import type { DiscoverCatalog, DiscoverDimension, DiscoverWork } from './models';

export function serialLabel(status: string | null | undefined): string {
  const value = status?.trim().toLowerCase() ?? '';
  if (['ongoing', 'publishing', 'serial', '连载', '連載', '连载中', '連載中', '1'].includes(value)) return '连载';
  if (['completed', 'complete', 'finished', 'ended', '完结', '完結', '已完结', '已完結', '2'].includes(value)) return '完结';
  if (['hiatus', 'cancelled', '停更', '休刊', '暂停更新', '3', '4'].includes(value)) return '停更';
  return '状态未知';
}
export function filterWorkStatus(works: DiscoverWork[], status: string): DiscoverWork[] {
  if (status === '全部') return works;
  return works.flatMap((work) => { const variants = work.variants.filter((entry) => serialLabel(entry.book.novelInfo?.status ?? entry.book.comicInfo?.status) === status); return variants.length ? [{ ...work, variants }] : []; });
}
export function discoverStatusScope(dimension: DiscoverDimension, range: string, feedId: string | null, categoryId: string | null, catalog?: DiscoverCatalog): { completedOnly: boolean; newWorks: boolean; hint: string | null; effectiveStatus(selection: string): string } {
  const label = categoryId !== null ? catalog?.categories.find((category) => category.id === categoryId)?.label ?? ''
    : feedId === 'native' ? catalog?.feeds[0]?.label ?? '' : feedId !== null ? catalog?.feeds.find((feed) => feed.id === feedId)?.label ?? '' : dimension === 'RANKING' ? range : '';
  const completedOnly = !/未完[结結]|未[结結]束|不完[结結]|未完成|not\s+(?:yet\s+)?(?:completed|finished)|uncompleted|incomplete|unfinished|ongoing|连载|連載/i.test(label) && /完[结結]|已完成|(?<![a-z])(?:completed|finished|ended)(?![a-z])/i.test(label);
  const newWorks = !completedOnly && /新作|新[书書]|上架|(?<![a-z])new(?:\s+(?:releases|works))?(?![a-z])|recently\s+added/i.test(label);
  return { completedOnly, newWorks, hint: completedOnly ? '仅显示已确认完结的作品' : newWorks ? '按原站新上架排序，作品可能仍在连载' : null,
    effectiveStatus: (selection) => completedOnly ? '完结' : newWorks ? '全部' : selection };
}
