#!/bin/sh
# Builds dist/Terre du Milieu.app (AppKit + WebKit, no Xcode project, no dependency).
#   bash macos/build.sh        (or: npm run build:mac)
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Terre du Milieu"
EXEC="TerreDuMilieu"
DIST="$ROOT/dist"
APP="$DIST/$APP_NAME.app"
BUILD="$DIST/.build"
MIN_MACOS="13.0"
ARCH="$(uname -m)"
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -n 1)"
VERSION="${VERSION:-1.0.0}"

echo "==> Nettoyage"
rm -rf "$APP" "$BUILD"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app" "$BUILD"

echo "==> Compilation Swift ($ARCH, macOS $MIN_MACOS+)"
swiftc -O -swift-version 5 \
  -target "$ARCH-apple-macos$MIN_MACOS" \
  -framework AppKit -framework WebKit -framework UserNotifications \
  "$ROOT"/macos/Sources/*.swift \
  -o "$APP/Contents/MacOS/$EXEC"

echo "==> Icône"
swiftc -O -swift-version 5 "$ROOT/macos/IconTool/main.swift" -o "$BUILD/make-icon"
"$BUILD/make-icon" "$BUILD/AppIcon.iconset" >/dev/null
iconutil -c icns "$BUILD/AppIcon.iconset" -o "$APP/Contents/Resources/AppIcon.icns"

echo "==> Info.plist"
sed -e "s/__VERSION__/$VERSION/g" -e "s/__MIN_MACOS__/$MIN_MACOS/g" -e "s/__EXEC__/$EXEC/g" \
  "$ROOT/macos/Info.plist" > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist" >/dev/null
printf 'APPL????' > "$APP/Contents/PkgInfo"

echo "==> Copie du serveur Node"
RES="$APP/Contents/Resources/app"
cp "$ROOT/server.js" "$ROOT/package.json" "$RES/"
cp -R "$ROOT/lib" "$ROOT/public" "$ROOT/hooks" "$ROOT/scripts" "$RES/"
chmod 755 "$RES/hooks/send-event.sh" "$RES/hooks/send-statusline.sh"
find "$RES" -name '.DS_Store' -delete

echo "==> Signature ad hoc"
codesign --force --deep --sign - --identifier com.lotragent.map "$APP"
codesign --verify --strict "$APP"

rm -rf "$BUILD"
echo "OK : $APP"
