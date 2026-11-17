#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(cat "$HERE/VERSION")"
ZIP="$HERE/build/Grod-$VERSION.zip"

"$HERE/build.sh"
rm -f "$ZIP"
ditto -c -k --keepParent "$HERE/build/Grod.app" "$ZIP"
echo "$ZIP"
