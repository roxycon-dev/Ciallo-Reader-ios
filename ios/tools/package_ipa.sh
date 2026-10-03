#!/bin/bash
# 在 Mac 上一键构建未签名 ipa（供 AltStore / Sideloadly / 爱思助手自签安装）
#
# 用法：
#   cd ios && bash tools/package_ipa.sh
#
# 前置：Xcode 16+；首次构建需联网拉取 SwiftSoup / ZIPFoundation。
# 产物：ios/build/CialloReader-unsigned.ipa
#
# 有付费开发者账号想直接签正式包：不要用本脚本，在 Xcode 里
# Signing & Capabilities 勾选 Automatically manage signing → Product → Archive。

set -e
cd "$(dirname "$0")/.."

echo "== 1/4 同步 Venera JS 资产 =="
bash tools/sync_js_assets.sh

echo "== 2/4 解析 SPM 依赖 =="
xcodebuild -resolvePackageDependencies -project CialloReader.xcodeproj -scheme CialloReader

echo "== 3/4 构建（iOS 真机 arm64，未签名）=="
rm -rf build/CialloReader.xcarchive
xcodebuild archive \
  -project CialloReader.xcodeproj \
  -scheme CialloReader \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/CialloReader.xcarchive \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""

echo "== 4/4 打包 ipa =="
rm -rf build/Payload build/CialloReader-unsigned.ipa
mkdir -p build/Payload
cp -R build/CialloReader.xcarchive/Products/Applications/CialloReader.app build/Payload/
cd build
zip -qry CialloReader-unsigned.ipa Payload
cd ..

echo
echo "完成：ios/build/CialloReader-unsigned.ipa"
echo "安装：Windows/Mac 上用 Sideloadly 或 AltStore 选该 ipa + 你的 Apple ID 自签（免费账号 7 天有效期）。"
