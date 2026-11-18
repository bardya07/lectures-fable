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
        try testWriters(in: base.appendingPathComponent("writers"), original: original, updated: updated)
        try testBackups(in: base.appendingPathComponent("snapshots"), original: original)
        let encoded = Store(applicationSupportDirectory: base.appendingPathComponent("encoded"))
        try fm.createDirectory(at: encoded.directory, withIntermediateDirectories: true)
        for (prefix, encoding): ([UInt8], String.Encoding) in [([0xef, 0xbb, 0xbf], .utf8), ([0xff, 0xfe], .utf16LittleEndian)] {
            let data = Data(prefix) + original.data(using: encoding)!
            try data.write(to: encoded.file)
            precondition(encoded.load() == original)
            let imported = try Store.readBackup(at: encoded.file)
            precondition(imported == original)
        }
        let large = "{\"app\":\"lectures-fable\",\"classes\":[],\"items\":[],\"padding\":\"" + String(repeating: "a", count: 20_000_000) + "\"}"
        try encoded.save(large)
        let imported = try Store.readBackup(at: encoded.file)
        precondition(imported == large, "Exported backups must remain readable at their original size")
        try Data([0xff]).write(to: encoded.file)
        do { _ = try Store.readBackup(at: encoded.file); preconditionFailure("Silently replaced malformed text") }
        catch CocoaError.fileReadInapplicableStringEncoding { }

        let backupsOnly = base.appendingPathComponent("backups-only")
        let old = backupsOnly.appendingPathComponent("Lectures Fable/Backups")
        try fm.createDirectory(at: old, withIntermediateDirectories: true)
        try backupData.write(to: old.appendingPathComponent("old.json"))
        let migrated = Store(applicationSupportDirectory: backupsOnly)
        try expectContents(backupData, at: migrated.backups.appendingPathComponent("old.json"))
        precondition(migrated.load() == nil)
        print("Store migration, competing writers, quarantine and backup retention tests passed.")
    }

    private static func testWriters(in base: URL, original: String, updated: String) throws {
        let stores = [Store(applicationSupportDirectory: base), Store(applicationSupportDirectory: base)]
        precondition(stores.allSatisfy { $0.load() == nil })
        let lock = NSLock()
        var successes = 0
        DispatchQueue.concurrentPerform(iterations: 2) { i in
            do {
                try stores[i].save(i == 0 ? original : updated)
                lock.lock()
                successes += 1
                lock.unlock()
            } catch Store.Failure.changed { }
            catch { preconditionFailure("Unexpected save error: \(error)") }
        }
        precondition(successes == 1, "Only the first writer may replace the observed file")
        let reader = Store(applicationSupportDirectory: base)
        precondition(reader.load() != nil)
        try FileManager.default.removeItem(at: reader.file)
        do { try reader.save(updated); preconditionFailure("Replaced an externally removed file") }
        catch Store.Failure.changed { }
    }

    private static func testBackups(in base: URL, original: String) throws {
        let store = Store(applicationSupportDirectory: base)
        let fm = FileManager.default
        try fm.createDirectory(at: store.backups, withIntermediateDirectories: true)
        let personal = store.backups.appendingPathComponent("before-import-000-personal.json")
        try Data(original.utf8).write(to: personal)
        let folder = store.backups.appendingPathComponent("before-import-2000-01-01-000000.json")
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        var revisions = [String]()
        for i in 0..<7 {
            let text = "{\"classes\":[],\"items\":[],\"revision\":\(i)}"
            try store.save(text)
            try store.backUpBeforeImport()
            revisions.append(text)
        }
        let copies = try fm.contentsOfDirectory(at: store.backups, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent != personal.lastPathComponent && $0.lastPathComponent != folder.lastPathComponent }
        let contents = try copies.map { try String(contentsOf: $0, encoding: .utf8) }
        precondition(Set(contents) == Set(revisions.suffix(5)))
        try expectContents(Data(original.utf8), at: personal)
        precondition(fm.fileExists(atPath: folder.path))
        for _ in 0..<2 {
            try Data("broken".utf8).write(to: store.file)
            precondition(store.load() == nil && store.notice != nil)
        }
        let aside = try fm.contentsOfDirectory(atPath: store.directory.path).filter { $0.hasPrefix("data.unreadable-") }
        precondition(aside.count == 2 && !fm.fileExists(atPath: store.file.path))
        try store.save(original)
    }

    private static func expectContents(_ expected: Data, at url: URL) throws {
        let contents = try Data(contentsOf: url)
        precondition(contents == expected, "Unexpected contents at \(url.path)")
    }
}
