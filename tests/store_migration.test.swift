import Foundation

@main
struct StoreMigrationTests {
    static func main() throws {
        let fm = FileManager.default
        let base = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let legacy = base.appendingPathComponent("Lectures Fable", isDirectory: true)
        let legacyBackups = legacy.appendingPathComponent("Backups", isDirectory: true)
        let legacyFile = legacy.appendingPathComponent("data.json")
        let backup = legacyBackups.appendingPathComponent("data-2026-11-01.json")
        let original = #"{"classes":[],"items":[],"settings":{"theme":"dark"}}"#
        let backupData = Data(#"{"classes":[],"items":[]}"#.utf8)
        try fm.createDirectory(at: legacyBackups, withIntermediateDirectories: true)
        try Data(original.utf8).write(to: legacyFile)
        try backupData.write(to: backup)

        let store = Store(applicationSupportDirectory: base)
        let grod = base.appendingPathComponent("Grod", isDirectory: true)
        precondition(store.directory == grod, "Store should use the Grod directory")
        precondition(store.notice == nil, "Migration should succeed")
        try expectContents(Data(original.utf8), at: store.file)
        try expectContents(backupData, at: store.backups.appendingPathComponent(backup.lastPathComponent))
        precondition(store.savedTheme() == "dark", "Launch should read the migrated theme")

        let updated = #"{"classes":[],"items":[],"settings":{"theme":"light"}}"#
        try store.save(updated)
        let laterBackup = "data-2026-11-02.json"
        try backupData.write(to: legacyBackups.appendingPathComponent(laterBackup))

        let reopened = Store(applicationSupportDirectory: base)
        try expectContents(Data(updated.utf8), at: reopened.file)
        precondition(!fm.fileExists(atPath: reopened.backups.appendingPathComponent(laterBackup).path),
                     "Migration should skip the legacy backups when Grod has a data file")
        try expectContents(Data(original.utf8), at: legacyFile)
        try expectContents(backupData, at: backup)
        print("Store migration tests passed.")
    }

    private static func expectContents(_ expected: Data, at url: URL) throws {
        let contents = try Data(contentsOf: url)
        precondition(contents == expected, "Unexpected contents at \(url.path)")
    }
}
