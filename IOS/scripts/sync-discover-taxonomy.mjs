import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = resolve(root, process.argv[2] ?? '../novel-reader/app/src/main/java/com/example/discover/DiscoverTaxonomy.kt');
const source = readFileSync(origin, 'utf8');
const input = source.slice(source.indexOf('val roots =') + 'val roots ='.length);
let offset = 0;
function whitespace() {
  for (;;) {
    const before = offset;
    while (/\s/.test(input[offset] ?? '') && offset < input.length) offset++;
    if (input.startsWith('//', offset)) offset = input.indexOf('\n', offset);
    if (offset === before) break;
  }
}
function token(pattern) { whitespace(); const match = pattern.exec(input.slice(offset)); if (!match) throw new Error(`Unexpected Kotlin token at ${offset}`); offset += match[0].length; return match[0]; }
function value() {
  whitespace();
  if (input[offset] === '"') return JSON.parse(token(/^"(?:\\.|[^"\\])*"/));
  const id = token(/^[A-Za-z_]+/);
  if (id === 'true' || id === 'false') return id === 'true';
  token(/^\(/); const args = []; const named = {};
  while (true) {
    whitespace(); if (input[offset] === ')') { offset++; break; }
    const key = /^([A-Za-z_]+)\s*=/.exec(input.slice(offset));
    if (key) { offset += key[0].length; named[key[1]] = value(); } else args.push(value());
    whitespace(); if (input[offset] === ',') offset++; else if (input[offset] !== ')') throw new Error('Expected comma');
  }
  if (id === 'listOf') return args;
  const [key, label, ...rest] = args;
  if (id === 'leaf') return { id: key, label, children: [], aliases: [...new Set([label, ...rest])], adult: false };
  if (id === 'branch') return { id: key, label, children: rest, aliases: [...new Set([label, ...({ action: ['action', '热血', '动作', '動作'], fantasy: ['fantasy', '奇幻', '魔幻'], mystery: ['mystery'] }[key] ?? [])])], adult: false };
  if (id === 'DiscoverCategory') return { id: key, label, children: rest[0] ?? [], aliases: [], adult: named.adult ?? false };
  throw new Error(`Unsupported Kotlin data constructor ${id}`);
}
const roots = value();
const strings = (text) => [...text.matchAll(/"(?:\\.|[^"\\])*"/g)].map((match) => JSON.parse(match[0]));
const extraAliases = {};
for (const match of source.slice(source.indexOf('private val extraAliases'), source.indexOf('private val aliasIndex')).matchAll(/"([^"]+)"\s+to\s+listOf\(([^)]*)\)/g))
  extraAliases[match[1]] = [...(extraAliases[match[1]] ?? []), ...strings(match[2])];
const metadata = /private val metadataNamespaces = setOf\(([\s\S]*?)\)/.exec(source)?.[1];
if (!Array.isArray(roots) || roots.length < 3 || !metadata) throw new Error('Incomplete Android taxonomy');
const output = { androidSha256: createHash('sha256').update(source).digest('hex'), roots, extraAliases, metadataNamespaces: strings(metadata) };
writeFileSync(resolve(root, 'src/core/discover/taxonomyData.json'), JSON.stringify(output, null, 2) + '\n');
console.log(`Synced ${roots.length} taxonomy facets and ${Object.keys(extraAliases).length} alias groups.`);
