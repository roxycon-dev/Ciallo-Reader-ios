import { BLOCK_TAGS, type HtmlNodeImpl, parseHtml } from './legadoRule';

export function extractCleanTextFromHtml(html: string): string {
  if (html.trim() === '') return '';
  const document = parseHtml(html) as HtmlNodeImpl;
  removeNodes(document, new Set(['script', 'style', 'head', 'rt', 'rp']));
  const body = findBody(document);
  const parts: string[] = [];
  walkClean(body, parts, true);
  return parts
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n\n');
}

function findBody(root: HtmlNodeImpl): HtmlNodeImpl {
  for (const el of root.getAllElements() as HtmlNodeImpl[]) {
    if (el.tag === 'body') return el;
  }
  return root;
}

function removeNodes(root: HtmlNodeImpl, tags: Set<string>): void {
  const walk = (node: HtmlNodeImpl) => {
    const children = node.childNodes.slice();
    for (const child of children) {
      if (child.kind === 'element' && tags.has(child.tag)) {
        node.removeChild(child);
      } else {
        walk(child);
      }
    }
  };
  walk(root);
}

function walkClean(node: HtmlNodeImpl, parts: string[], isRoot: boolean): void {
  if (node.kind === 'text') {
    parts.push(node.data);
    return;
  }
  if (node.kind !== 'element' && node.kind !== 'document') return;
  const isBlock = node.kind === 'element' && BLOCK_TAGS.has(node.tag);
  const isBr = node.kind === 'element' && node.tag === 'br';
  if (!isRoot && (isBlock || isBr)) parts.push('\n');
  for (const child of node.childNodes) walkClean(child, parts, false);
  if (!isRoot && isBlock) parts.push('\n');
}
