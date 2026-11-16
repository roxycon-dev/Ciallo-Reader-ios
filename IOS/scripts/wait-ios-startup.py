"""Verify and export the exact same native startup snapshot with a wall-clock bound."""
import json
from pathlib import Path
import sys
import time

source, target = Path(sys.argv[1]), Path(sys.argv[2])
deadline = time.monotonic() + 240
while time.monotonic() < deadline:
    try:
        snapshot = source.read_bytes()
        state = json.loads(snapshot)
        target.write_bytes(snapshot)
        if state.get('phase') == 'ready':
            raise SystemExit(0)
        if state.get('phase') == 'error':
            print(snapshot.decode('utf-8'), file=sys.stderr)
            raise SystemExit(1)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    time.sleep(2)
print('App did not hydrate persistent data and register services within 240 seconds', file=sys.stderr)
raise SystemExit(1)
