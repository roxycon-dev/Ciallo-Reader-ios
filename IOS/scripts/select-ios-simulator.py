"""Choose an available iPhone, preferring a modest display for cold CI hosts."""
import json
import sys

devices = json.load(sys.stdin)["devices"]
preferred = ["iPhone 16e", "iPhone SE (3rd generation)", "iPhone 17", "iPhone 16"]
candidates = [device for runtime, group in devices.items() if "iOS" in runtime
              for device in group if "iPhone" in device["name"] and device.get("isAvailable", True)]
if not candidates:
    raise SystemExit("No available iPhone simulator")
candidates.sort(key=lambda device: (preferred.index(device["name"]) if device["name"] in preferred else len(preferred), device["name"]))
print(candidates[0]["udid"])
