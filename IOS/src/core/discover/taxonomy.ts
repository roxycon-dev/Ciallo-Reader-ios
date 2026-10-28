import data from './taxonomyData.json';
import { foldChar } from '@core/data/cjkFoldMap';
import { normalizeIdentity, type DiscoverCatalog } from './models';

export interface DiscoverCategory { id: string; label: string; children: DiscoverCategory[]; aliases: string[]; adult: boolean }
export const DISCOVER_CATEGORIES: DiscoverCategory[] = data.roots;
export const DISCOVER_ALL_CATEGORIES: DiscoverCategory[] = [];
const ancestors = new Map<string, Set<string>>();
const leaves = new Map<string, Set<string>>();
function visit(node: DiscoverCategory, parents: string[]): void {
  DISCOVER_ALL_CATEGORIES.push(node); ancestors.set(node.id, new Set([...parents, node.id]));
  const children = new Set([node.id]);
  for (const child of node.children) { visit(child, [...parents, node.id]); for (const id of leaves.get(child.id)!) children.add(id); }
  leaves.set(node.id, children);
}
for (const root of DISCOVER_CATEGORIES) visit(root, []);
const tagKey = (value: string): string => normalizeIdentity([...value].map(foldChar).join(''));
const index = new Map<string, Set<string>>();
for (const category of DISCOVER_ALL_CATEGORIES) for (const alias of [...category.aliases, ...((data.extraAliases as Record<string, string[]>)[category.id] ?? [])]) {
  const key = tagKey(alias); if (!index.has(key)) index.set(key, new Set()); index.get(key)!.add(category.id);
}
const namespaces = new Set(data.metadataNamespaces);
export function isStoryTag(raw: string): boolean { return !/[：:]/.test(raw) || !namespaces.has(raw.split(/[：:]/)[0]!.trim().toLowerCase()); }
export function classifyTags(tags: readonly string[]): Set<string> {
  const result = new Set<string>();
  for (const raw of tags) {
    if (!isStoryTag(raw)) continue;
    const tail = raw.slice(Math.max(raw.indexOf('：'), raw.indexOf(':')) + 1);
    const tokens = [raw, ...tail.split(/[,，/、;；|]/).flatMap((tag) => /[\u3400-\u9fff]/.test(tag) ? [tag, ...tag.split(/\s+/)] : [tag])];
    for (const token of tokens) for (const id of index.get(tagKey(token)) ?? []) for (const ancestor of ancestors.get(id) ?? []) result.add(ancestor);
  }
  return result;
}
export function matchesCategories(tags: string[], selected: Set<string>): boolean {
  const classified = classifyTags(tags);
  return DISCOVER_CATEGORIES.every((root) => { const picks = [...selected].filter((id) => leaves.get(root.id)!.has(id)); return !picks.length || picks.some((id) => classified.has(id)); });
}
export function isAdultTags(tags: string[]): boolean { const adult = leaves.get('adult')!; return [...classifyTags(tags)].some((id) => adult.has(id)); }
export function classifyNativeCategory(label: string, group: string): Set<string> {
  const direct = classifyTags([label]); if (direct.size) return direct;
  const id = group.includes('语言') || /^language$/i.test(group) || ['Chinese', 'English', 'Japanese', '汉语', '英语', '日语', '英語 ENG'].includes(label) ? 'language'
    : group.includes('年份') || /^(?:\d{4}|\d{2}年代|\d{2}後)$/.test(label) ? 'year'
    : group.includes('角色') || group.includes('作品系列') || /fate|東方|东方|原神|Love ?Live|SAO|碧藍/i.test(label) ? 'franchise' : 'native_other';
  return ancestors.get(id) ?? new Set();
}
export function categoryLabels(tags: string[]): string[] {
  const ids = classifyTags(tags);
  const labels = DISCOVER_ALL_CATEGORIES.filter((category) => ids.has(category.id) && !DISCOVER_CATEGORIES.includes(category) && (!category.children.length || !category.children.some((child) => ids.has(child.id)))).map((category) => category.label);
  return [...new Set(labels.length ? labels : tags.filter(isStoryTag).map((tag) => tag.split(/[：:]/).at(-1)!))];
}
export function categoryRoutes(catalog: DiscoverCatalog, selected: Set<string>): string[] {
  return DISCOVER_CATEGORIES.map((root) => {
    const picks = [...selected].filter((id) => leaves.get(root.id)!.has(id));
    return picks.length ? [...new Set(catalog.categories.filter((category) => !['全部', 'All'].includes(category.label) && picks.some((id) => classifyNativeCategory(category.label, category.group).has(id))).map((category) => category.id))] : [];
  }).filter((routes) => routes.length).sort((a, b) => a.length - b.length)[0] ?? [];
}
