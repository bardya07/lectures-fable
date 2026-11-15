import AppKit

// Lectures Fable: a native window around a bundled web view (see web/).
// AppKit owns the window, toolbar, menus, file panels and the data file.

MainActor.assumeIsolated {
    // Fail before constructing Store: self-tests must never read or back up real data.
    if Launch.isSelfTest && Launch.dataDirectory == nil {
        FileHandle.standardError.write(Data("Self-test needs LECTURES_FABLE_DATA_DIR.\n".utf8))
        exit(2)
    }
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(Launch.isSelfTest ? .accessory : .regular)
    app.run()
}
