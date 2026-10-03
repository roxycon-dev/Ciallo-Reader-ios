#!/bin/bash
# 在 Mac 上执行：把安卓工程里的 Venera 运行时与三个本地 JS 漫画源同步进 iOS 资源包
# （Windows 开发机上受安全钩子限制无法直接复制 .js，故在 Mac 构建前跑一次本脚本）
#
# 用法：  cd ios && bash tools/sync_js_assets.sh

set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"     # novel-reader (1)/
SRC="$ROOT/novel-reader/app/src/main/assets"
DST="$ROOT/ios/CialloReader/Resources/JS"

mkdir -p "$DST"
cp "$SRC/venera/_venera_.js"        "$DST/venera_runtime.js"
cp "$SRC/venera/comic_metadata.js"  "$DST/comic_metadata.js"
cp "$SRC/js_extra/bilimanga.js"     "$DST/bilimanga.js"
cp "$SRC/js_extra/pufei.js"         "$DST/pufei.js"
cp "$SRC/js_extra/vomic.js"         "$DST/vomic.js"

echo "JS 资源同步完成："
ls -la "$DST"
echo
echo "注意：venera_runtime.js 存在时，JsSourceEngine 会加载它替代内置精简运行时桥，"
echo "与安卓 QuickJS 侧行为对齐（脚本内置运行时同样会被注入，二者共存无害）。"
