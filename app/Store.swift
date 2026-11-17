import Foundation

/// The data file: ~/Library/Application Support/Grod/data.json, plus dated copies in Backups/.
final class Store {
    enum Failure: LocalizedError {
        case locked, invalid
        var errorDescription: String? {
            switch self {
            case .locked: return "The data file could not be read at launch, so it is being left untouched."
            case .invalid: return "The app produced data it could not verify."
            }
        }
    }

    let directory: URL
    var file: URL { directory.appendingPathComponent("data.json") }
    var backups: URL { directory.appendingPathComponent("Backups", isDirectory: true) }

    /// Something the user should be told once after launch (a file that was set aside, for example).
    private(set) var notice: String?
    private var locked = false
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
        guard !fm.fileExists(atPath: file.path), fm.fileExists(atPath: legacyFile.path) else { return }

        do {
            try fm.createDirectory(at: directory, withIntermediateDirectories: true)
            let legacyBackups = legacyDirectory.appendingPathComponent(backups.lastPathComponent, isDirectory: true)
            if fm.fileExists(atPath: legacyBackups.path) {
                try fm.createDirectory(at: backups, withIntermediateDirectories: true)
                for source in try fm.contentsOfDirectory(at: legacyBackups, includingPropertiesForKeys: nil) {
                    try copyIfMissing(source, to: backups.appendingPathComponent(source.lastPathComponent))
                }
            }
            // Publish data.json last so an interrupted migration can retry the backups.
            try copyIfMissing(legacyFile, to: file)
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

    /// The saved JSON text, or nil when there is nothing usable yet.
    func load() -> String? {
        guard fm.fileExists(atPath: file.path) else { return nil }
        let data: Data
        do {
            data = try Data(contentsOf: file)
        } catch {
            locked = true
            notice = "Your data file couldn’t be read, so changes won’t be saved this time.\n\n\(error.localizedDescription)"
            return nil
        }
        if Store.isUsable(data), let text = String(data: data, encoding: .utf8) {
            backUp(data, as: "data-\(Store.stamp(day: true)).json", keeping: 14, prefix: "data-", replace: false)
            return text
        }
        // Not something this app wrote. Keep it under another name instead of saving over it.
        let aside = directory.appendingPathComponent("data.unreadable-\(Store.stamp(day: false)).json")
        do {
            try fm.moveItem(at: file, to: aside)
            notice = "The data file couldn’t be understood, so the app started empty. The file was kept as “\(aside.lastPathComponent)”."
        } catch {
            locked = true
            notice = "The data file couldn’t be understood, and changes won’t be saved this time.\n\n\(error.localizedDescription)"
        }
        return nil
    }

    func save(_ json: String) throws {
        if locked { throw Failure.locked }
        let data = Data(json.utf8)
        guard Store.isUsable(data) else { throw Failure.invalid }
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: file, options: .atomic)
    }

    /// A copy of the current file, taken just before an import replaces everything.
    func backUpBeforeImport() {
        guard let data = try? Data(contentsOf: file) else { return }
        backUp(data, as: "before-import-\(Store.stamp(day: false)).json", keeping: 5, prefix: "before-import-", replace: true)
    }

    /// The appearance saved in the file, so the window can open in the right one.
    func savedTheme() -> String {
        guard let data = try? Data(contentsOf: file),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let settings = object["settings"] as? [String: Any],
              let theme = settings["theme"] as? String, ["system", "dark", "light"].contains(theme) else { return "system" }
        return theme
    }

    private func backUp(_ data: Data, as name: String, keeping limit: Int, prefix: String, replace: Bool) {
        let target = backups.appendingPathComponent(name)
        if !replace && fm.fileExists(atPath: target.path) { return }
        do {
            try fm.createDirectory(at: backups, withIntermediateDirectories: true)
            try data.write(to: target, options: .atomic)
            let names = try fm.contentsOfDirectory(atPath: backups.path).filter { $0.hasPrefix(prefix) && $0.hasSuffix(".json") }.sorted()
            for old in names.dropLast(limit) { try? fm.removeItem(at: backups.appendingPathComponent(old)) }
        } catch {
            // A missing backup must never stop the app from opening.
        }
    }

    /// True for this app's format and for the original Lectures app's files, which can be imported.
    static func isUsable(_ data: Data) -> Bool {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        let root = (object["state"] as? [String: Any]) ?? object
        return root["classes"] is [Any] && root["items"] is [Any]
    }

    private static func stamp(day: Bool) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = day ? "yyyy-MM-dd" : "yyyy-MM-dd-HHmmss"
        return formatter.string(from: Date())
    }
}
