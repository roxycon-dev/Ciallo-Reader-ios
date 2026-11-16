"""Extract literal payloads without JS template-string escaping changing Android's repairs.

Usage: python scripts/sync-js-source-patches.py [path/to/JsSourceRepo.kt]
The control flow lives in jsSourcePatches49.ts; this copies strings, not executable Kotlin.
"""
from pathlib import Path
import hashlib
import json
import re
import sys

root = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / 'novel-reader/app/src/main/java/com/example/source/js/JsSourceRepo.kt'
original = source.read_text(encoding='utf-8')
version = re.search(r'PATCH_VERSION\s*=\s*(\d+)', original)
assert version and version[1] == '49', 'Review the control-flow port before updating a different patch version'
start = original.index('    private fun patchWnacgSearch(')
end = original.index('    private fun fetch(context:', start)
body = original[start:end]
# Two prefix lines keep coordinates stable with the standalone JVM oracle exporter.
text = 'import java.io.File\nobject Patch49 {\n' + body
pattern = re.compile(r'//[^\n]*|/\*[\s\S]*?\*/|"""[\s\S]*?"""(?!")|"(?:\\.|[^"\\])*"|\x27(?:\\.|[^\x27\\])*\x27')
values = {}
counts = {}
escapes = {'n': '\n', 'r': '\r', 't': '\t', 'b': '\b', '"': '"', "'": "'", '$': '$', '\\': '\\'}
for match in pattern.finditer(text):
    token = match[0]
    if token.startswith('//') or token.startswith('/*'):
        continue
    line = text.count('\n', 0, match.start()) + 1
    ordinal = counts.get(line, 0)
    counts[line] = ordinal + 1
    key = f'L{line}' + (f'_{ordinal}' if ordinal else '')
    if token.startswith('"""'):
        value = token[3:-3]
    else:
        value = re.sub(r'\\(u[0-9a-fA-F]{4}|.)', lambda part: chr(int(part[1][1:], 16)) if part[1].startswith('u') else escapes[part[1]], token[1:-1])
    values[key] = value.replace("${'$'}", '$')
output = {'androidPatchVersion': 49, 'androidFunctionSha256': hashlib.sha256(body.encode()).hexdigest(), 'sourceFirstLine': original.count('\n', 0, start) + 1, 'literals': values}
target = root / 'src/core/source/js/jsSourcePatchLiterals49.json'
target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Extracted {len(values)} literals from Android patch 49')
