#!/bin/bash
# Builds build/Grod.app using only the command-line Swift compiler.
# No Xcode project, no packages, no downloads.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="Grod"
BUNDLE_ID="com.local.lectures-fable"
VERSION="$(cat "$HERE/VERSION")"
BUILD="$HERE/build"
CACHE="$BUILD/.cache"
mkdir -p "$CACHE"
WORK="$(mktemp -d "$BUILD/.grod-build.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
APP="$WORK/$NAME.app"

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "Compiling…"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  -module-cache-path "$CACHE" \
  "$HERE"/app/*.swift -o "$APP/Contents/MacOS/$NAME"

cp -R "$HERE/web" "$APP/Contents/Resources/web"

echo "Drawing the icon…"
swiftc -swift-version 5 -module-cache-path "$CACHE" "$HERE/tools/icon.swift" -o "$WORK/make-icon"
"$WORK/make-icon" "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
  <key>CFBundleExecutable</key><string>$NAME</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.education</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
</dict>
</plist>
PLIST

codesign --force --sign - "$APP" >/dev/null 2>&1
codesign --verify --strict "$APP"
# Publish only a verified bundle. Swapping directories also keeps a running build
# available if compilation, icon generation or signing fails.
swift -module-cache-path "$CACHE" - "$APP" "$BUILD/$NAME.app" <<'SWIFT'
import Darwin
let source = CommandLine.arguments[1], target = CommandLine.arguments[2]
if rename(source, target) != 0 {
    guard (errno == ENOTEMPTY || errno == EEXIST), renamex_np(source, target, UInt32(RENAME_SWAP)) == 0 else {
        perror("Publishing Grod.app")
        exit(1)
    }
}
SWIFT
echo "Built $BUILD/$NAME.app"
