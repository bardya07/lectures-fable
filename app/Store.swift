import Foundation

/// The data file: ~/Library/Application Support/Grod/data.json, plus dated copies in Backups/.
final class Store {
    enum Failure: LocalizedError {
        case locked, invalid, changed
        var errorDescription: String? {
            switch self {
            case .locked: return "The data file could not be read at launch, so it is being left untouched."
            case .invalid: return "The app produced data it could not verify."
            case .changed: return "The data file changed on disk. Export your changes and reopen Grod before saving again."
            }
        }
    }

    let directory: URL
    var file: URL { directory.appendingPathComponent("data.json") }
    var backups: URL { directory.appendingPathComponent("Backups", isDirectory: true) }

    /// Something the user should be told once after launch (a file that was set aside, for example).
    private(set) var notice: String?
    private var locked = false
    private var observedFile = false
    private var lastData: Data?
    private let fm = FileManager.default

    convenience init() {
        if let override = Launch.dataDirectory {
            self.init(directory: override)
        } else {
            let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            self.init(applicationSupportDirectory: base)
        }
    }

    private init(directory: URL) {
        self.directory = directory
    }

    convenience init(applicationSupportDirectory base: URL) {
        self.init(directory: base.appendingPathComponent("Grod", isDirectory: true))
        let legacyDirectory = base.appendingPathComponent("Lectures Fable", isDirectory: true)
        let legacyFile = legacyDirectory.appendingPathComponent(file.lastPathComponent)
        let legacyBackups = legacyDirectory.appendingPathComponent(backups.lastPathComponent, isDirectory: true)
        guard !fm.fileExists(atPath: file.path),
              fm.fileExists(atPath: legacyFile.path) || fm.fileExists(atPath: legacyBackups.path) else { return }

        do {
            try fm.createDirectory(at: directory, withIntermediateDirectories: true)
            if fm.fileExists(atPath: legacyBackups.path) {
                try fm.createDirectory(at: backups, withIntermediateDirectories: true)
                for source in try fm.contentsOfDirectory(at: legacyBackups, includingPropertiesForKeys: nil) {
                    try copyIfMissing(source, to: backups.appendingPathComponent(source.lastPathComponent))
                }
            }
            // Publish data.json last so an interrupted migration can retry the backups.
            if fm.fileExists(atPath: legacyFile.path) { try copyIfMissing(legacyFile, to: file) }
        } catch {
            locked = true
            notice = "Your previous data couldn’t be copied to Grod, so changes won’t be saved this time.\n\n\(error.localizedDescription)"
        }
    }

    private func copyIfMissing(_ source: URL, to target: URL) throws {
        guard !fm.fileExists(atPath: target.path) else { return }
        let staged = target.deletingLastPathComponent().appendingPathComponent(".migration-\(UUID())")
        defer { try? fm.removeItem(at: staged) }
        try fm.copyItem(at: source, to: staged)
        do {
            try fm.moveItem(at: staged, to: target)
        } catch CocoaError.fileWriteFileExists {
            // Another launch already put a file there.
        }
    }

    private func currentData() throws -> Data? {
        do { return try Data(contentsOf: file) }
        catch CocoaError.fileReadNoSuchFile { return nil }
    }

    // Atomic writes prevent torn JSON. The directory lock also serializes the comparison
    // and replacement when two copies of Grod have opened the same data file.
    private func withDirectoryLock<T>(_ body: () throws -> T) throws -> T {
        let fd = open(directory.path, O_RDONLY)
        guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        defer { close(fd) }
        while flock(fd, LOCK_EX) != 0 {
            if errno != EINTR { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        }
        return try body()
    }

    private func uniqueFile(in folder: URL, prefix: String) throws -> URL {
        let base = prefix + Store.stamp(day: false) + "-"
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        let indices = try fm.contentsOfDirectory(atPath: folder.path).compactMap { name -> Int? in
            guard name.hasPrefix(base), name.hasSuffix(".json"), name.count == base.count + 11 else { return nil }
            return Int(name.dropFirst(base.count).dropLast(5))
        }
        return folder.appendingPathComponent(base + String(format: "%06d.json", (indices.max() ?? -1) + 1))
    }

    /// The saved JSON text, or nil when there is nothing usable yet.
    func load() -> String? {
        guard !locked else { return nil }
        observedFile = true
        lastData = nil
        guard fm.fileExists(atPath: directory.path) else { return nil }
        do {
            return try withDirectoryLock {
                guard let data = try currentData() else { return nil }
                if Store.isUsable(data), let text = Store.jsonText(data) {
                    lastData = data
                    let target = backups.appendingPathComponent("data-\(Store.stamp(day: true)).json")
                    if !fm.fileExists(atPath: target.path) {
                        do { try backUp(data, to: target, keeping: 14, prefix: "data-") }
                        catch { notice = "Your data was loaded, but the daily backup couldn’t be saved.\n\n\(error.localizedDescription)" }
                    }
                    return text
                }
                let aside = try uniqueFile(in: directory, prefix: "data.unreadable-")
                try fm.moveItem(at: file, to: aside)
                notice = "The data file couldn’t be understood, so the app started empty. The file was kept as “\(aside.lastPathComponent)”."
                return nil
            }
        } catch {
            locked = true
            notice = "Your data file couldn’t be read, so changes won’t be saved this time.\n\n\(error.localizedDescription)"
            return nil
        }
    }

    func save(_ json: String) throws {
        if locked { throw Failure.locked }
        let data = Data(json.utf8)
        guard Store.isUsable(data) else { throw Failure.invalid }
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        try withDirectoryLock {
            if observedFile, try currentData() != lastData { throw Failure.changed }
            try data.write(to: file, options: .atomic)
            lastData = data
            observedFile = true
        }
    }

    /// A copy of the current file, taken just before an import replaces everything.
    func backUpBeforeImport() throws {
        guard !locked else { throw Failure.locked }
        guard fm.fileExists(atPath: directory.path) || lastData != nil else { return }
        try withDirectoryLock {
            let data = try currentData()
            if observedFile, data != lastData { throw Failure.changed }
            if let data {
                try backUp(data, to: uniqueFile(in: backups, prefix: "before-import-"), keeping: 5, prefix: "before-import-")
            }
        }
    }

    /// The appearance saved in the file, so the window can open in the right one.
    func savedTheme() -> String {
        guard let data = try? Data(contentsOf: file),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let settings = object["settings"] as? [String: Any],
              let theme = settings["theme"] as? String, ["system", "dark", "light"].contains(theme) else { return "system" }
        return theme
    }

    private func backUp(_ data: Data, to target: URL, keeping limit: Int, prefix: String) throws {
        try fm.createDirectory(at: backups, withIntermediateDirectories: true)
        try data.write(to: target, options: .atomic)
        let suffix = prefix == "data-" ? #"[0-9]{4}-[0-9]{2}-[0-9]{2}"# : #"[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}(-[0-9]{6})?"#
        let pattern = "^" + prefix + suffix + #"\.json$"#
        let files = try fm.contentsOfDirectory(at: backups, includingPropertiesForKeys: [.isRegularFileKey])
        let names = try files.filter { url in
            guard url.lastPathComponent.range(of: pattern, options: .regularExpression) != nil else { return false }
            return try url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true
        }.map(\.lastPathComponent).sorted()
        for old in names.dropLast(limit) { try fm.removeItem(at: backups.appendingPathComponent(old)) }
    }

    static func readBackup(at url: URL) throws -> String {
        // Grod can export a backup larger than an individual calendar feed.
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        guard let text = jsonText(data) else { throw CocoaError(.fileReadInapplicableStringEncoding) }
        return text
    }

    private static func jsonText(_ data: Data) -> String? {
        for (mark, encoding): ([UInt8], String.Encoding) in [
            ([0x00, 0x00, 0xfe, 0xff], .utf32BigEndian), ([0xff, 0xfe, 0x00, 0x00], .utf32LittleEndian),
            ([0xfe, 0xff], .utf16BigEndian), ([0xff, 0xfe], .utf16LittleEndian), ([0xef, 0xbb, 0xbf], .utf8)
        ] where data.starts(with: mark) {
            return String(data: data.dropFirst(mark.count), encoding: encoding)
        }
        return String(data: data, encoding: .utf8)
    }

    /// True for this app's format and for the original Lectures app's files, which can be imported.
    static func isUsable(_ data: Data) -> Bool {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        if let state = object["state"] as? [String: Any], state["classes"] is [Any], state["items"] is [Any] { return true }
        return object["classes"] is [Any] && object["items"] is [Any]
    }

    private static func stamp(day: Bool) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = day ? "yyyy-MM-dd" : "yyyy-MM-dd-HHmmss"
        return formatter.string(from: Date())
    }
}
