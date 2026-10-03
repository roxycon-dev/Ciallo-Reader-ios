import os, sys

BACKSLASH = chr(92)

def check(path):
    src = open(path, encoding='utf-8').read()
    stack = []
    line = 1
    i = 0
    n = len(src)
    state = 'code'
    while i < n:
        c = src[i]
        nxt = src[i+1] if i+1 < n else ''
        if c == '\n':
            line += 1
        if state == 'code':
            if c == '/' and nxt == '/':
                state = 'line_comment'; i += 2; continue
            if c == '/' and nxt == '*':
                state = 'block_comment'; i += 2; continue
            if c == '"':
                if src[i:i+3] == '"""':
                    state = 'mstring'; i += 3; continue
                state = 'string'; i += 1; continue
            if c in '([{':
                stack.append((c, line))
            elif c in ')]}':
                if not stack:
                    return f"{path}: extra {c} @ line {line}"
                opener, ln = stack.pop()
                if '([{'.index(opener) != ')]}'.index(c):
                    return f"{path}: mismatch {opener}(line {ln}) vs {c}(line {line})"
        elif state == 'line_comment':
            if c == '\n':
                state = 'code'
        elif state == 'block_comment':
            if c == '*' and nxt == '/':
                state = 'code'; i += 2; continue
        elif state == 'string':
            if c == BACKSLASH:
                i += 2; continue
            if c == '"':
                state = 'code'
        elif state == 'mstring':
            if src[i:i+3] == '"""':
                state = 'code'; i += 3; continue
        i += 1
    if stack:
        return f"{path}: unclosed {stack[-5:]}"
    return None

errors = []
count = 0
for root, dirs, files in os.walk('.'):
    for f in files:
        if f.endswith('.swift'):
            count += 1
            p = os.path.join(root, f)
            r = check(p)
            if r:
                errors.append(r)
print(f"checked {count} swift files")
if errors:
    print("ISSUES:")
    for e in errors:
        print(" ", e)
    sys.exit(1)
print("balance: ALL PASS")
