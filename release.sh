#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VERSION="$(cat "$HERE/VERSION")"
ZIP="$HERE/build/Lectures-Fable-$VERSION.zip"

"$HERE/build.sh"
rm -f "$ZIP"
ditto -c -k --keepParent "$HERE/build/Lectures Fable.app" "$ZIP"
echo "$ZIP"
