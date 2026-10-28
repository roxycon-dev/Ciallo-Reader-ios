#!/bin/bash
set -euo pipefail
app="${1:?Pass the built simulator App.app path}"
test -d "$app"
bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")
entitlements=$(mktemp -t ciallo-simulator-entitlements)
trap 'rm -f "$entitlements"' EXIT
# These identities are simulator-only. Device/App Store signing uses the real provisioning profile.
cat > "$entitlements" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>application-identifier</key><string>CIALLOCI01.$bundle_id</string>
<key>com.apple.developer.team-identifier</key><string>CIALLOCI01</string>
<key>keychain-access-groups</key><array><string>CIALLOCI01.$bundle_id</string></array>
<key>get-task-allow</key><true/>
</dict></plist>
EOF
if [ -d "$app/Frameworks" ]; then
  while IFS= read -r -d '' library; do codesign --force --sign - --timestamp=none "$library"; done < <(find "$app/Frameworks" -maxdepth 1 \( -name '*.framework' -o -name '*.dylib' \) -print0)
fi
codesign --force --sign - --timestamp=none --entitlements "$entitlements" "$app"
codesign --verify --deep --strict "$app"
codesign --display --entitlements - "$app"
