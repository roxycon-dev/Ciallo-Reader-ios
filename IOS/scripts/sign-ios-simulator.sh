#!/bin/bash
set -euo pipefail
app="${1:?Pass the built simulator App.app path}"
test -d "$app"
# The host macOS signature must not carry iOS-only entitlements. The simulator
# reads its isolated Keychain identity from the linked __TEXT,__entitlements section.
# Device/App Store signing continues to use the real provisioning profile.
if [ -d "$app/Frameworks" ]; then
  while IFS= read -r -d '' library; do codesign --force --sign - --timestamp=none "$library"; done < <(find "$app/Frameworks" -maxdepth 1 \( -name '*.framework' -o -name '*.dylib' \) -print0)
fi
codesign --force --sign - --timestamp=none "$app"
codesign --verify --deep --strict "$app"
codesign --display --entitlements - "$app"
executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Info.plist")
xcrun otool -s __TEXT __entitlements "$app/$executable"
