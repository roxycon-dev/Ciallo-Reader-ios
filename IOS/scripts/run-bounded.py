"""Bound simulator commands which may otherwise hang beyond application deadlines."""
import subprocess
import sys

try:
    result = subprocess.run(sys.argv[2:], timeout=float(sys.argv[1]), check=False)
    raise SystemExit(result.returncode)
except subprocess.TimeoutExpired:
    print(f'Command exceeded {sys.argv[1]} seconds: {sys.argv[2]}', file=sys.stderr)
    raise SystemExit(124)
