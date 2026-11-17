import Foundation

/// Environment switches. None of them are needed for normal use.
enum Launch {
    private static let env = ProcessInfo.processInfo.environment

    private static func path(_ key: String, directory: Bool = false) -> URL? {
        guard let value = env[key], !value.isEmpty else { return nil }
        return URL(fileURLWithPath: value, isDirectory: directory)
    }

    /// Use this folder instead of ~/Library/Application Support/Grod.
    static let dataDirectory = path("LECTURES_FABLE_DATA_DIR", directory: true)

    /// Automated checks (tests/run.sh): a script to run inside the page, where to write
    /// its results, and a file that stands in for the Import panel.
    static let selfTestScript = path("LECTURES_FABLE_SELFTEST")
    static let outputDirectory = path("LECTURES_FABLE_OUT", directory: true)
    static let importFile = path("LECTURES_FABLE_IMPORT")
    static let calendarFixture = path("LECTURES_FABLE_CALENDAR_FIXTURE")

    static var isSelfTest: Bool { selfTestScript != nil }
}
