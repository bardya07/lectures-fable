#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(cat "$HERE/VERSION")"
ZIP="$HERE/build/Grod-$VERSION.zip"

"$HERE/build.sh"
WORK="$(mktemp -d "$HERE/build/.grod-release.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
ditto -c -k --keepParent "$HERE/build/Grod.app" "$WORK/release.zip"
mv -f "$WORK/release.zip" "$ZIP"
echo "$ZIP"
