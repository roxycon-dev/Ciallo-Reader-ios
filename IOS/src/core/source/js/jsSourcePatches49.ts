import payload from './jsSourcePatchLiterals49.json';

// Literal coordinates refer to the standalone Android function excerpt produced
// by scripts/sync-js-source-patches.py. Keep payloads byte-exact; never interpolate
// their JavaScript template strings in TypeScript strings.
const D = payload.literals;
export const JS_SOURCE_PATCH_VERSION = payload.androidPatchVersion;
type Pair = readonly [string, string];
const literal = (s: string, from: string, to: string): string => s.split(from).join(to);
const pairs = (s: string, changes: readonly Pair[]): string => changes.reduce((text, [from, to]) => literal(text, from, to), s);
const cut = (s: string, start: number, end: number, value: string): string => s.slice(0, start) + value + s.slice(end);
function trim(s: string): string {
  let lines = s.split('\n');
  if (!lines[0]?.trim()) lines = lines.slice(1);
  if (!lines.at(-1)?.trim()) lines = lines.slice(0, -1);
  const nonblank = lines.filter((line) => line.trim());
  const indent = nonblank.length ? Math.min(...nonblank.map((line) => line.length - line.trimStart().length)) : 0;
  return lines.map((line) => line.slice(Math.min(indent, line.length))).join('\n');
}
function regex(pattern: string, flags = ''): RegExp {
  const inline = /^\(\?([ims]+)\)/.exec(pattern);
  if (inline) { flags += inline[1]; pattern = pattern.slice(inline[0].length); }
  // Java accepts an unescaped ] directly after class negation; JavaScript reads
  // [^] as its own any-character class. Preserve the JVM character-class meaning.
  pattern = literal(pattern, '[^]]', '[^\\]]');
  return new RegExp(pattern, [...new Set(`g${flags}`)].join(''));
}
// Callback replacement preserves '$' inside generated JS instead of treating it
// as a replacement-group expression. Regex matching remains global, as in Kotlin.
const replaceRegex = (s: string, pattern: string, value: string, flags = ''): string => s.replace(regex(pattern, flags), () => value);

export function patchWnacgSearch(script: string): string {
  const start = script.indexOf(D.L4), end = script.indexOf(D.L5, Math.max(start, 0));
  return start < 0 || end <= start ? script : cut(script, start, end, trim(D.L7) + D.L45);
}
export function patchMxsReader(script: string): string { return replaceRegex(script, D.L49, trim(D.L51) + D.L76); }
export function patchJm(script: string): string {
  let fixed = pairs(script, [[D.L89, D.L89_1], [D.L90, D.L91]]);
  fixed = fixed.replace(regex(D.L95), (_match, group: string) => literal(D.L96, '${match.groupValues[1]}', group));
  fixed = pairs(fixed, [[D.L98, D.L101], [D.L109, D.L111]]);
  if (!fixed.includes(D.L115)) fixed = literal(fixed, D.L116, trim(D.L117));
  return pairs(fixed, [[D.L124, D.L126], [D.L131, D.L133], [D.L152, D.L152_1]]);
}
function patchWnacgDiscovery(script: string): string {
  const fixed = pairs(script, [[D.L156, D.L156_1], [D.L157, D.L157_1], [D.L158, D.L158_1], [D.L159, D.L159_1]]);
  if (fixed.includes(D.L160)) return fixed;
  const start = fixed.indexOf(D.L161), end = fixed.indexOf(D.L162, start);
  return start < 0 || end < start ? fixed : cut(fixed, start, end, trim(D.L164) + D.L202);
}
function patchDiscoverSource(key: string, script: string): string {
  switch (key) {
    case 'comick': {
      if (script.includes(D.L210)) return script;
      let fixed = pairs(script, [[D.L211, D.L211_1], [D.L212, D.L212_1], [D.L213, D.L213_1], [D.L214, D.L214_1]]);
      const start = fixed.indexOf(D.L215), end = start >= 0 ? fixed.indexOf(D.L216, start) : -1;
      if (end > start) fixed = cut(fixed, start, end, replaceRegex(fixed.slice(start, end), D.L219, D.L219_1));
      fixed = pairs(fixed, [[D.L222, D.L222_1], [D.L223, D.L223_1], [D.L224, D.L224_1], [D.L225, D.L225_1], [D.L226, D.L226_1], [D.L227, D.L227_1]]);
      const imageStart = fixed.indexOf(D.L228), imageEnd = imageStart >= 0 ? fixed.indexOf(D.L229, imageStart) : -1;
      if (imageEnd > imageStart) fixed = cut(fixed, imageStart, imageEnd, literal(fixed.slice(imageStart, imageEnd), D.L231, D.L231_1));
      const categoryStart = fixed.indexOf(D.L232), categoryEnd = categoryStart >= 0 ? fixed.indexOf(D.L233, categoryStart) : -1;
      if (categoryEnd > categoryStart) fixed = cut(fixed, categoryStart, categoryEnd, pairs(fixed.slice(categoryStart, categoryEnd), [[D.L236, D.L236_1], [D.L237, trim(D.L237_1)], [D.L246, trim(D.L246_1)], [D.L249, trim(D.L249_1)]]));
      return fixed + D.L255 + trim(D.L255_1);
    }
    case 'jm': {
      const start = regex(D.L303).exec(script)?.index ?? -1, end = script.indexOf(D.L304, start);
      return start < 0 || end < start || script.includes(D.L305) ? script : cut(script, start, end, trim(D.L306) + D.L348);
    }
    case 'manwaba': {
      const fixed = pairs(script, [[D.L353, D.L354], [D.L356, D.L357]]);
      return fixed.includes(D.L358) ? fixed : literal(fixed, D.L359, D.L359_1);
    }
    case 'picacg': return script.includes(D.L360_1) ? script : literal(script, D.L361, D.L361_1);
    case 'wnacg': return patchWnacgDiscovery(script);
    case 'hcomic': {
      if (!script.includes(D.L363_1)) return script;
      const fixed = pairs(script, [[D.L364, D.L364_1], [D.L365, D.L365_1]]);
      return fixed.includes(D.L366) ? fixed : literal(fixed, D.L367, D.L367_1);
    }
    case 'mycomic': {
      let fixed = literal(script, D.L370, D.L371);
      const start = fixed.indexOf(D.L375);
      if (start >= 0) fixed = fixed.slice(0, start) + literal(fixed.slice(start), D.L377, D.L377_1);
      fixed = literal(fixed, D.L379, D.L380);
      return fixed.includes(D.L382) ? fixed : trim(D.L382_1) + D.L412 + fixed;
    }
    default: return script;
  }
}
function patchCopyInit(script: string): string {
  const start = script.indexOf(D.L418); if (start < 0) return script;
  const matcher = regex(D.L420); matcher.lastIndex = start;
  const match = matcher.exec(script); if (!match) return script;
  const end = match.index + match[0].length;
  return cut(script, start, end, replaceRegex(script.slice(start, end), D.L425, D.L425_1));
}
function patchBase(key: string, script: string): string {
  switch (key) {
    case 'manwaba': return literal(script, D.L431_1, D.L431_2);
    case 'ehentai': {
      let fixed = replaceRegex(script, D.L435, trim(D.L438), 's');
      fixed = pairs(fixed, [[D.L455, D.L457], [D.L470, D.L473], [D.L481, D.L486]]);
      fixed = replaceRegex(fixed, D.L497, D.L500, 's');
      return pairs(fixed, [[D.L546, D.L552], [D.L582, D.L583], [D.L628, D.L631], [D.L637, D.L640]]);
    }
    case 'wnacg': {
      const detailRegex = [D.L649, D.L650, D.L651, D.L652, D.L653, D.L654, D.L655, D.L656, D.L657, D.L658, D.L659, D.L660, D.L661, D.L662, D.L663, D.L664].join('');
      let fixed = replaceRegex(script, detailRegex, trim(D.L667), 's');
      fixed = literal(fixed, D.L696, D.L697);
      if (!fixed.includes(D.L698)) fixed = literal(fixed, D.L699, D.L702);
      if (!fixed.includes(D.L703)) fixed = literal(fixed, D.L704, D.L705);
      return patchWnacgSearch(literal(fixed, D.L714, D.L715));
    }
    case 'hitomi': {
      let fixed = replaceRegex(script, D.L723, trim(D.L726), 's');
      if (!fixed.includes(D.L747)) fixed = pairs(fixed, [[D.L748, D.L748_1], [D.L749, D.L749_1], [D.L750, D.L750_1], [D.L751, D.L751_1], [D.L752, D.L752_1], [D.L753, D.L753_1], [D.L754, trim(D.L754_1)]]);
      return replaceRegex(fixed, D.L764, D.L765);
    }
    case 'mxs': return patchMxsReader(script);
    case 'manhuaren': return replaceRegex(script, D.L771, trim(D.L772));
    case 'comick': {
      let fixed = replaceRegex(script, D.L781, D.L782);
      const catalogStart = fixed.indexOf(D.L786), catalogEnd = catalogStart >= 0 ? fixed.indexOf(D.L788, catalogStart) : -1;
      if (catalogEnd > catalogStart) fixed = cut(fixed, catalogStart, catalogEnd, trim(D.L790).split('\n').map((line) => D.L814 + line).join('\n') + D.L814_1);
      fixed = literal(fixed, D.L817, D.L820);
      fixed = replaceRegex(fixed, D.L826, trim(D.L829), 's');
      const start = fixed.indexOf(D.L873), end = start >= 0 ? fixed.indexOf(D.L874, start) : -1;
      if (end >= 0) {
        let search = fixed.slice(start, end);
        const urlStart = search.indexOf(D.L877), urlEnd = urlStart >= 0 ? search.indexOf(D.L878, urlStart) : -1;
        if (urlEnd >= 0) search = cut(search, urlStart, urlEnd + 1, trim(D.L881));
        fixed = cut(fixed, start, end, literal(search, D.L891, trim(D.L892)));
      }
      return fixed;
    }
    case 'picacg': return [[D.L906, D.L907], [D.L911, D.L912], [D.L915, D.L916], [D.L919, D.L920]].reduce((s, [from, to]) => replaceRegex(s, from!, to!), script);
    case 'copy_manga': case 'copy_manga_multi_accounts': {
      let fixed = patchCopyInit(script);
      const start = fixed.indexOf(D.L931);
      if (start >= 0) {
        const apiReturn = fixed.indexOf(D.L935, start), close = apiReturn >= 0 ? fixed.indexOf(D.L937, fixed.indexOf(D.L937_1, apiReturn)) : fixed.indexOf(D.L939, start);
        if (close > start) fixed = cut(fixed, start, close + 1, trim(D.L943));
      }
      const refreshStart = fixed.indexOf(D.L954);
      if (refreshStart >= 0) {
        const marker = fixed.indexOf(D.L956, refreshStart);
        if (marker >= 0) {
          const ifClose = fixed.indexOf(D.L959, marker), close = fixed.indexOf(D.L960, ifClose + 1);
          if (close > marker) fixed = cut(fixed, refreshStart, close + 1, trim(D.L963));
        }
      }
      return fixed;
    }
    case 'jm': return patchJm(script);
    case 'nhentai': return literal(script, D.L998, trim(D.L999));
    case 'ikmmh': {
      let fixed = pairs(script, [[D.L1009, D.L1009_1], [D.L1011, D.L1012 + D.L1013], [D.L1015, D.L1016]]);
      const start = fixed.indexOf(D.L1018), end = start >= 0 ? fixed.indexOf(D.L1019, start) : -1;
      if (end >= 0 && fixed.slice(start, end).includes(D.L1020)) fixed = cut(fixed, start, end, pairs(fixed.slice(start, end), [[D.L1022, D.L1023], [D.L1024, D.L1024_1], [D.L1026, D.L1027], [D.L1029, D.L1029_1], [D.L1031, D.L1032], [D.L1035, D.L1036], [D.L1039, D.L1040], [D.L1043, D.L1044]]));
      const detailStart = fixed.indexOf(D.L1048), detailEnd = detailStart >= 0 ? fixed.indexOf(D.L1049, detailStart) : -1;
      if (detailEnd >= 0) fixed = cut(fixed, detailStart, detailEnd + D.L1049.length, trim(D.L1055));
      return literal(fixed, D.L1072, trim(D.L1072_1));
    }
    default: return script;
  }
}
export function patchScript(key: string, script: string): string { return patchDiscoverSource(key, patchBase(key, script)); }
export function patchCachedScript(key: string, script: string): string {
  if (key === 'copy_manga' || key === 'copy_manga_multi_accounts') return patchDiscoverSource(key, patchCopyInit(script));
  return ['wnacg', 'mxs', 'jm'].includes(key) ? patchScript(key, script) : patchDiscoverSource(key, script);
}
