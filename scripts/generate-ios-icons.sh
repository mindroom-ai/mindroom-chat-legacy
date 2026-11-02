#!/usr/bin/env bash
set -euo pipefail

ICON_DIR="ios/App/App/Assets.xcassets/AppIcon.appiconset"
SRC="$ICON_DIR/AppIcon-512@2x.png"

if [[ ! -f "$SRC" ]]; then
  echo "Missing source icon: $SRC" >&2
  exit 1
fi

if command -v magick >/dev/null 2>&1; then
  CONVERT=(magick)
elif command -v convert >/dev/null 2>&1; then
  CONVERT=(convert)
else
  echo "ImageMagick is required (magick/convert not found)." >&2
  exit 1
fi

resize() {
  local size="$1"
  local out="$2"
  "${CONVERT[@]}" "$SRC" -resize "${size}x${size}" "$ICON_DIR/$out"
}

resize 1024 "AppIcon-1024.png"

# iPhone
resize 40 "Icon-App-20x20@2x.png"
resize 60 "Icon-App-20x20@3x.png"
resize 58 "Icon-App-29x29@2x.png"
resize 87 "Icon-App-29x29@3x.png"
resize 80 "Icon-App-40x40@2x.png"
resize 120 "Icon-App-40x40@3x.png"
resize 120 "Icon-App-60x60@2x.png"
resize 180 "Icon-App-60x60@3x.png"

# iPad
resize 20 "Icon-App-20x20@1x~ipad.png"
resize 40 "Icon-App-20x20@2x~ipad.png"
resize 29 "Icon-App-29x29@1x~ipad.png"
resize 58 "Icon-App-29x29@2x~ipad.png"
resize 40 "Icon-App-40x40@1x~ipad.png"
resize 80 "Icon-App-40x40@2x~ipad.png"
resize 76 "Icon-App-76x76@1x~ipad.png"
resize 152 "Icon-App-76x76@2x~ipad.png"
resize 167 "Icon-App-83.5x83.5@2x~ipad.png"

# Mac Catalyst. macOS draws app icons unmasked, so follow its icon grid:
# an 824-pixel rounded square centered on a transparent 1024-pixel canvas.
MAC_DIR="$(mktemp -d)"
trap 'rm -rf "$MAC_DIR"' EXIT
MAC_SRC="$MAC_DIR/AppIcon-mac.png"
"${CONVERT[@]}" "$SRC" -resize 824x824 -alpha set \
  \( -size 824x824 xc:none -fill white -draw 'roundrectangle 0,0 823,823 185,185' \) \
  -compose DstIn -composite \
  -compose Over -background none -gravity center -extent 1024x1024 "$MAC_SRC"
for size in 16 32 128 256 512; do
  for scale in 1 2; do
    pixels=$((size * scale))
    # PNG32 keeps the alpha channel ImageMagick would otherwise palette-encode.
    "${CONVERT[@]}" "$MAC_SRC" -resize "${pixels}x${pixels}" \
      "PNG32:$ICON_DIR/Icon-Mac-${size}x${size}@${scale}x.png"
  done
done

echo "Generated iOS and Mac AppIcon assets in $ICON_DIR"
