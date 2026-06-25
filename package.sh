#!/usr/bin/env bash
# Build a clean, store-ready ZIP of the extension.
# Produces dist/extension.zip containing only the files the browser needs.
# Used both locally and by CI (.github/workflows/release.yml) so builds are identical.
set -euo pipefail

cd "$(dirname "$0")"
OUT_DIR="dist"
OUT="$OUT_DIR/extension.zip"

mkdir -p "$OUT_DIR"
rm -f "$OUT"

zip -r "$OUT" . \
  -x ".git/*" \
  -x ".github/*" \
  -x ".cursor/*" \
  -x "_metadata/*" \
  -x "mockups/*" \
  -x "store-assets/*" \
  -x "dist/*" \
  -x ".gitignore" \
  -x "*.DS_Store" -x ".DS_Store" \
  -x "*.md" \
  -x "package.sh" \
  -x "icons/icon.svg" >/dev/null

echo "Built $OUT"
unzip -l "$OUT"
