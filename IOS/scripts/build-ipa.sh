#!/bin/bash
#
# build-ipa.sh —— 在 macOS 上一条命令产出可安装的 Ciallo Reader .ipa
#
# 为什么需要 macOS：IPA 里是 arm64 Mach-O 二进制 + Swift + onnxruntime framework，
# 只有 Xcode 的 iOS SDK（clang / swiftc / actool / ibtool / codesign）能生成。
# Windows 与 Linux 上没有这条工具链，只能做「web 产物 + 工程同步」这一步（见
# scripts/pack-ios-bundle.mjs），真正的编译必须回到 macOS。
#
# 用法（在 IOS/ 目录下）：
#   ./scripts/build-ipa.sh                    # 未签名 IPA（默认），给 Sideloadly / AltStore 重签用
#   ./scripts/build-ipa.sh --device           # 本机 Xcode 已登录 Apple ID，自动签名，能直接装到自己设备
#   ./scripts/build-ipa.sh --manual           # 手动签名（CI 用）：需 CIALLO_TEAM_ID + CIALLO_PROFILE_UUID
#   ./scripts/build-ipa.sh --debug            # Debug 配置（带 Web 调试、体积更大）
#
# 手动签名需要的环境变量：
#   CIALLO_TEAM_ID         10 位 Apple Team ID
#   CIALLO_PROFILE_UUID    provisioning profile 的 UUID（security cms -D -i xx.mobileprovision 里的 UUID）
#   CIALLO_SIGNING_IDENTITY  可选，默认 "Apple Development"
#
# 产物：
#   build/ipa/CialloReader-<版本>-<构建号>-<签名方式>.ipa
#
set -euo pipefail

MODE="unsigned"
CONFIG="Release"
for arg in "$@"; do
  case "$arg" in
    --unsigned) MODE="unsigned" ;;
    --device)   MODE="device" ;;
    --manual)   MODE="manual" ;;
    --debug)    CONFIG="Debug" ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "未知参数：$arg（用 --help 看用法）" >&2
      exit 2
      ;;
  esac
done

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PROJECT="$ROOT/ios/App/App.xcodeproj"
BUILD_DIR="$ROOT/build"
DERIVED="$BUILD_DIR/DerivedData"
ARCHIVE="$BUILD_DIR/App.xcarchive"
IPA_DIR="$BUILD_DIR/ipa"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m失败：%s\033[0m\n' "$*" >&2; exit 1; }

# ── 0. 前置检查 ────────────────────────────────────────────────────────────
step "检查工具链"
[ "$(uname -s)" = "Darwin" ] || fail "本脚本必须在 macOS 上跑（IPA 需要 Xcode 的 iOS SDK）。当前系统：$(uname -s)"
command -v xcodebuild >/dev/null 2>&1 || fail "找不到 xcodebuild：请安装 Xcode 并执行 sudo xcode-select -s /Applications/Xcode.app"
command -v node >/dev/null 2>&1 || fail "找不到 node：请安装 Node 22+（package.json 的 engines 要求 >=22）"
[ -d "$PROJECT" ] || fail "找不到 $PROJECT"

# `xcodebuild -version | head -n1` 在 `set -o pipefail` 下有 SIGPIPE 风险：
# head 读完第一行就关管道，xcodebuild 拿到 141，整条命令替换返回 141 → set -e 退出。
# 用 sed 读完整流就没有这个问题。
XCODE_VERSION="$(xcodebuild -version 2>/dev/null | sed -n '1p' || true)"
echo "  $XCODE_VERSION"
echo "  node $(node -v) / npm $(npm -v)"
case "$XCODE_VERSION" in
  *"Xcode 26."*) : ;;
  *"Xcode 2"[7-9]"."*) : ;;
  *) fail "Capacitor 8 需要 Xcode 26 或更新版本，当前 $XCODE_VERSION" ;;
esac

# 版本号从工程读，保证 IPA 里的 CFBundleShortVersionString / CFBundleVersion
# 与 Android 1.6.4 (264) 对齐；改 pbxproj 就够，不用同步第二份常量。
# `|| true`：`set -o pipefail` 下 grep 无匹配会让整条命令替换返回非 0，
# 那样下面自己的 `|| fail` 就永远走不到，用户只会看到脚本无声退出。
MARKETING_VERSION="$(grep -m1 'MARKETING_VERSION = ' "$PROJECT/project.pbxproj" | tr -dc '0-9.' || true)"
BUILD_NUMBER="$(grep -m1 'CURRENT_PROJECT_VERSION = ' "$PROJECT/project.pbxproj" | tr -dc '0-9' || true)"
[ -n "$MARKETING_VERSION" ] || fail "读不到 MARKETING_VERSION"
[ -n "$BUILD_NUMBER" ] || fail "读不到 CURRENT_PROJECT_VERSION"
echo "  版本：$MARKETING_VERSION ($BUILD_NUMBER)，配置：$CONFIG，模式：$MODE"

# ── 1. Web 产物 + Capacitor 同步 ───────────────────────────────────────────
step "构建 web 产物"
if [ ! -d node_modules ]; then
  echo "  node_modules 缺失，先 npm ci"
  npm ci
fi
npm run build:web

step "同步到 iOS 工程（dist → ios/App/App/public + Package.swift）"
npx cap sync ios

# 同步后确认 public/index.html 指向的入口脚本真的存在（cap sync 静默失败时
# 真机是白屏，很难查）。
ENTRY="$(grep -o 'src="/assets/[^"]*\.js"' ios/App/App/public/index.html | head -n1 | sed 's/.*"\(.*\)"/\1/' || true)"
[ -n "$ENTRY" ] || fail "index.html 里找不到入口脚本"
[ -f "ios/App/App/public$ENTRY" ] || fail "index.html 指向的 $ENTRY 不在 public/ 里"

# ── 2. 解析 SPM 依赖 ──────────────────────────────────────────────────────
step "解析 Swift Package 依赖"
# capacitor-swift-pm 从 GitHub 拉，onnxruntime-swift-package-manager 是 ~90 MB 的
# 二进制包。第一次要几分钟，之后走 DerivedData 缓存。
xcodebuild -resolvePackageDependencies \
  -project "$PROJECT" \
  -scheme App \
  -clonedSourcePackagesDirPath "$BUILD_DIR/SourcePackages" \
  | tail -n 20

mkdir -p "$IPA_DIR"

# ── 3. 归档 ────────────────────────────────────────────────────────────────
step "归档（xcodebuild archive）"
rm -rf "$ARCHIVE"

case "$MODE" in
  unsigned)
    # 不签名归档：Xcode 仍然完整编译、嵌入 framework，只是跳过 codesign。
    # CODE_SIGN_STYLE=Manual 是为了绕开 pbxproj 里
    #   CODE_SIGN_STYLE = "$(CIALLO_CODE_SIGN_STYLE)"
    # 在 release.xcconfig 未定义该变量时展开成空串的告警。
    xcodebuild archive \
      -project "$PROJECT" \
      -scheme App \
      -configuration "$CONFIG" \
      -sdk iphoneos \
      -destination 'generic/platform=iOS' \
      -derivedDataPath "$DERIVED" \
      -archivePath "$ARCHIVE" \
      -clonedSourcePackagesDirPath "$BUILD_DIR/SourcePackages" \
      CODE_SIGNING_ALLOWED=NO \
      CODE_SIGNING_REQUIRED=NO \
      CODE_SIGN_IDENTITY="" \
      EXPANDED_CODE_SIGN_IDENTITY="" \
      CODE_SIGN_STYLE=Manual \
      DEVELOPMENT_TEAM="" \
      PROVISIONING_PROFILE_SPECIFIER="" \
      | tail -n 40
    ;;
  device)
    TEAM="${CIALLO_TEAM_ID:-}"
    [ -n "$TEAM" ] || fail "--device 需要 CIALLO_TEAM_ID（Team ID 在 developer.apple.com → Membership 里）"
    xcodebuild archive \
      -project "$PROJECT" \
      -scheme App \
      -configuration "$CONFIG" \
      -sdk iphoneos \
      -destination 'generic/platform=iOS' \
      -derivedDataPath "$DERIVED" \
      -archivePath "$ARCHIVE" \
      -clonedSourcePackagesDirPath "$BUILD_DIR/SourcePackages" \
      -allowProvisioningUpdates \
      CODE_SIGN_STYLE=Automatic \
      DEVELOPMENT_TEAM="$TEAM" \
      | tail -n 40
    ;;
  manual)
    TEAM="${CIALLO_TEAM_ID:-}"
    UUID="${CIALLO_PROFILE_UUID:-}"
    IDENTITY="${CIALLO_SIGNING_IDENTITY:-Apple Development}"
    [ -n "$TEAM" ] || fail "--manual 需要 CIALLO_TEAM_ID"
    [ -n "$UUID" ] || fail "--manual 需要 CIALLO_PROFILE_UUID"
    xcodebuild archive \
      -project "$PROJECT" \
      -scheme App \
      -configuration "$CONFIG" \
      -sdk iphoneos \
      -destination 'generic/platform=iOS' \
      -derivedDataPath "$DERIVED" \
      -archivePath "$ARCHIVE" \
      -clonedSourcePackagesDirPath "$BUILD_DIR/SourcePackages" \
      CODE_SIGN_STYLE=Manual \
      DEVELOPMENT_TEAM="$TEAM" \
      CODE_SIGN_IDENTITY="$IDENTITY" \
      PROVISIONING_PROFILE_SPECIFIER="" \
      | tail -n 40
    ;;
esac

APP_PATH="$ARCHIVE/Products/Applications/App.app"
[ -d "$APP_PATH" ] || fail "归档里没有 App.app：$APP_PATH"

# ── 4. 打包 IPA ────────────────────────────────────────────────────────────
step "打包 IPA"
STAGE="$BUILD_DIR/ipa-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/Payload"
# ditto 而不是 cp -R：framework 里有 symlink（Versions/Current），cp -R 会把它们
# 展开成实体文件，IPA 体积翻倍且签名后校验不过。
ditto "$APP_PATH" "$STAGE/Payload/App.app"

# 未签名分支把 Info.plist 里的证书占位清掉，避免装到设备上被
# "The executable was signed with invalid entitlements" 拒绝后难以定位。
if [ "$MODE" = "unsigned" ]; then
  /usr/libexec/PlistBuddy -c "Delete :CFBundleSignature" "$STAGE/Payload/App.app/Info.plist" 2>/dev/null || true
fi

OUT="$IPA_DIR/CialloReader-${MARKETING_VERSION}-${BUILD_NUMBER}-${MODE}.ipa"
rm -f "$OUT"
(
  cd "$STAGE"
  # -y 保留符号链接；-X 不带 macOS 扩展属性（否则 IPA 里混进 __MACOSX）；
  # -r 递归；-q 安静
  zip -qryX "$OUT" Payload
)

# ── 5. 已签名分支额外导出一次（拿到正式 IPA 结构 + 可选的 thinned 版本）──────
if [ "$MODE" != "unsigned" ]; then
  step "导出已签名 IPA（xcodebuild -exportArchive）"
  EXPORT_DIR="$BUILD_DIR/ipa-export"
  OPTS="$BUILD_DIR/export-options.plist"
  rm -rf "$EXPORT_DIR"
  mkdir -p "$EXPORT_DIR"
  # `set -e` 下不能写 `[ cond ] && X=…`：条件为假时整行返回 1 会直接中止脚本。
  if [ "$MODE" = "manual" ]; then METHOD="debugging"; else METHOD="development"; fi
  cat > "$OPTS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>${METHOD}</string>
  <key>signingStyle</key><string>$([ "$MODE" = "manual" ] && echo manual || echo automatic)</string>
  <key>teamID</key><string>${CIALLO_TEAM_ID:-}</string>
  <key>signingCertificate</key><string>${CIALLO_SIGNING_IDENTITY:-Apple Development}</string>
  <key>stripSwiftSymbols</key><true/>
  <key>compileBitcode</key><false/>
  <key>destination</key><string>export</string>
</dict>
</plist>
PLIST
  if [ "$MODE" = "manual" ]; then
    /usr/libexec/PlistBuddy -c "Add :provisioningProfiles dict" "$OPTS" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :provisioningProfiles:com.aistudio.ciallo.reader string ${CIALLO_PROFILE_UUID}" "$OPTS"  fi
  xcodebuild -exportArchive \
    -archivePath "$ARCHIVE" \
    -exportOptionsPlist "$OPTS" \
    -exportPath "$EXPORT_DIR" \
    -allowProvisioningUpdates \
    | tail -n 30
  if [ -f "$EXPORT_DIR/App.ipa" ]; then
    mv "$EXPORT_DIR/App.ipa" "$IPA_DIR/CialloReader-${MARKETING_VERSION}-${BUILD_NUMBER}-signed.ipa"
  fi
fi

# ── 6. 结果 ────────────────────────────────────────────────────────────────
step "完成"
ls -lh "$IPA_DIR"
echo
for f in "$IPA_DIR"/*.ipa; do
  [ -f "$f" ] || continue
  printf '  %s\n    sha256 %s\n' "$(basename "$f")" "$(shasum -a 256 "$f" | cut -d' ' -f1)"
done

cat <<'NOTE'

安装方式：
  · unsigned.ipa —— 未签名，先重签再装：
      Sideloadly      把 ipa 拖进去，填 Apple ID，直接装到自己设备（免费账号 7 天有效）
      AltStore / SideStore  同上，可自动续签
      TrollStore      仅限支持的系统版本，可永久安装
  · signed.ipa —— 已用你的开发证书签名，用 `xcrun devicectl device install app`
      或 Xcode → Window → Devices and Simulators 拖进去即可
NOTE
