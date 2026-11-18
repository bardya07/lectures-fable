#!/bin/bash
# Run the logic checks and the native WebKit checks with isolated, temporary data.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HERE/build/Grod.app/Contents/MacOS/Grod"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/lectures-fable-test.XXXXXX")"
if [[ ${LECTURES_FABLE_KEEP_TEST_OUTPUT:-0} == 1 ]]; then
  echo "Test artifacts: $WORK"
else
  trap 'rm -rf "$WORK"' EXIT
fi

# A failed rebuild or archive must preserve the previous distributable.
mkdir -p "$WORK/package/build/Grod.app" "$WORK/package/bin"
cp "$HERE/build.sh" "$HERE/release.sh" "$HERE/VERSION" "$WORK/package/"
touch "$WORK/package/build/Grod.app/previous"
printf '#!/bin/sh\nexit 1\n' > "$WORK/package/bin/swiftc"
chmod +x "$WORK/package/bin/swiftc"
if PATH="$WORK/package/bin:$PATH" "$WORK/package/build.sh"; then exit 1; fi
test -f "$WORK/package/build/Grod.app/previous"
printf '#!/bin/sh\nexit 0\n' > "$WORK/package/build.sh"
cp "$WORK/package/bin/swiftc" "$WORK/package/bin/ditto"
archive="$WORK/package/build/Grod-$(cat "$HERE/VERSION").zip"
echo previous > "$archive"
if PATH="$WORK/package/bin:$PATH" "$WORK/package/release.sh"; then exit 1; fi
test "$(cat "$archive")" = previous
echo "Build and release failure recovery passed."

swiftc -swift-version 5 -module-cache-path "$WORK/module-cache" "$HERE/app/VersionComparison.swift" "$HERE/tests/version_comparison.test.swift" -o "$WORK/version-comparison-tests"
"$WORK/version-comparison-tests"
swiftc -swift-version 5 -module-cache-path "$WORK/module-cache" "$HERE/app/Launch.swift" "$HERE/app/Store.swift" "$HERE/tests/store_migration.test.swift" -o "$WORK/store-migration-tests"
"$WORK/store-migration-tests" "$WORK/application-support"
cp "$HERE/tests/fixtures/canvas.ics" "$WORK/calendar.ics"
swiftc -swift-version 5 -module-cache-path "$WORK/module-cache" "$HERE/app/CalendarFetch.swift" "$HERE/tests/calendar_fetch.test.swift" -o "$WORK/calendar-fetch-tests"
"$WORK/calendar-fetch-tests" "$WORK/calendar.ics"
node "$HERE/tests/core.test.js"
node "$HERE/tests/calendar.test.js"
swiftc -swift-version 5 -module-cache-path "$WORK/module-cache" "$HERE/tests/webkit.test.swift" -parse-as-library -o "$WORK/web-tests"
"$WORK/web-tests" "$HERE"
if [[ ! -x "$APP" ]]; then
  echo "Build the app first with fable/build.sh" >&2
  exit 1
fi
mkdir -p "$WORK/data" "$WORK/out"
python3 - "$WORK/import.json" <<'PY'
import datetime, json, sys
names = ['MBB 438 — Advanced Molecular Biology and Cellular Mechanisms', 'CPSC 320 — Intermediate Algorithm Design', 'BIOL 200', 'MATH 200', 'CHEM 233']
classes = [{'id': 'class' + str(i), 'name': name, 'color': i} for i, name in enumerate(names)]
items = []
start = datetime.date(2026, 9, 1)
for i in range(5):
    for j in range(36):
        date = start + datetime.timedelta(days=j * 2)
        # Include a crowded week and long titles in the imported data.
        if i == 0 and j < 10:
            date = datetime.date(2026, 11, 9) + datetime.timedelta(days=j % 7)
        items.append({'id': f'item-{i}-{j}', 'classId': f'class{i}', 'type': 'assignment' if i == 0 and j == 1 else 'lecture',
                      'title': 'Molecular mechanisms of gene expression and cellular regulation ' + str(j),
                      'date': date.isoformat(), 'done': j % 4 == 0, 'link': ''})
for id, date in [('before-range', '2019-12-15'), ('after-range', '2036-01-15')]:
    items.append({'id': id, 'classId': 'class4', 'type': 'lecture', 'title': 'Imported',
                  'date': date, 'done': False, 'link': ''})
with open(sys.argv[1], 'w') as f:
    json.dump({'classes': classes, 'items': items}, f)
PY
LECTURES_FABLE_DATA_DIR="$WORK/data" LECTURES_FABLE_OUT="$WORK/out" \
LECTURES_FABLE_IMPORT="$WORK/import.json" LECTURES_FABLE_CALENDAR_FIXTURE="$WORK/calendar.ics" \
LECTURES_FABLE_SELFTEST="$HERE/tests/ui.test.js" \
  "$APP" || { cat "$WORK/out/result.json" 2>/dev/null || true; exit 1; }
cat "$WORK/out/result.json"
