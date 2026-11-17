# Grod

Grod is a macOS app for organizing lectures, assignments, and exams by class.

## Install

Download the zip from [Releases](https://github.com/bardya07/lectures-fable/releases), unzip it, and move Grod.app to Applications. The app is not notarized, so the first time you open it, right-click the app and choose Open, or use System Settings → Privacy & Security → Open Anyway.

## Build from source

Run `./build.sh` on macOS to create `build/Grod.app`.

## Data

Data is stored in `~/Library/Application Support/Grod/`. If Grod has no data file when it opens, it copies any existing data and backups from the previous app’s folder. Use Export and Import to back up and restore your data.
