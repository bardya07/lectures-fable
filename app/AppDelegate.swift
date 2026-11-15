import AppKit
import WebKit

extension NSToolbarItem.Identifier {
    static let viewMode = NSToolbarItem.Identifier("viewMode")
    static let today = NSToolbarItem.Identifier("today")
    static let calendars = NSToolbarItem.Identifier("calendars")
    static let add = NSToolbarItem.Identifier("add")
    static let update = NSToolbarItem.Identifier("update")
}

/// Matches --bg in web/style.css so the title bar and the page read as one surface.
let windowBackground = NSColor(name: nil) { appearance in
    appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        ? NSColor(srgbRed: 0x0f / 255.0, green: 0x10 / 255.0, blue: 0x12 / 255.0, alpha: 1)
        : NSColor(srgbRed: 0xfb / 255.0, green: 0xfb / 255.0, blue: 0xfc / 255.0, alpha: 1)
}

/// What the page last reported about itself. Drives menu and toolbar state.
struct PageState {
    var view = "timeline"
    var canUndo = false
    var canRedo = false
    var undoLabel = ""
    var redoLabel = ""
    var textFocused = false
    var modal = false
}

final class MainWindow: NSWindow {
    /// The automated checks keep the window off-screen so it never appears in front of the user.
    var staysOffscreen = false
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        staysOffscreen ? frameRect : super.constrainFrameRect(frameRect, to: screen)
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let store = Store()
    var window: MainWindow!
    var webView: WKWebView!
    var page = PageState()
    var theme = "system"
    var pageReady = false
    var pageURL: URL?
    var viewGroup: NSToolbarItemGroup?
    var selfTest: SelfTest?
    private var updateChecker: UpdateChecker!
    private var saveFailureShown = false

    // MARK: Launch

    func applicationDidFinishLaunching(_ notification: Notification) {
        theme = store.savedTheme()
        applyTheme()
        NSApp.mainMenu = makeMenu()
        makeWindow()
        if Launch.isSelfTest {
            selfTest = SelfTest(app: self)
            window.staysOffscreen = true
            window.setFrame(NSRect(x: -30000, y: -30000, width: 1280, height: 760), display: false)
            window.orderFrontRegardless()
        } else {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
        loadPage()
        updateChecker = UpdateChecker(delegate: self)
        updateChecker.start()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    private func makeWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "app")
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 720), configuration: configuration)
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground") // show the window colour until the page paints
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsMagnification = false

        window = MainWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 760),
                            styleMask: [.titled, .closable, .miniaturizable, .resizable],
                            backing: .buffered, defer: false)
        window.title = "Lectures Fable"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = windowBackground
        window.minSize = NSSize(width: 760, height: 420)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.contentView = webView

        let toolbar = NSToolbar(identifier: "main")
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        toolbar.centeredItemIdentifiers = [.viewMode]
        window.toolbar = toolbar
        window.toolbarStyle = .unified

        window.center()
        if !Launch.isSelfTest { window.setFrameAutosaveName("Main") }
    }

    private func loadPage() {
        guard let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") else {
            warn("The app is incomplete.", "Its bundled page is missing. Build it again with build.sh.")
            return
        }
        pageURL = url
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    // MARK: Talking to the page

    func command(_ name: String, _ argument: String? = nil) {
        guard pageReady else { return }
        let arguments = [name, argument].compactMap { $0 }
        guard let data = try? JSONSerialization.data(withJSONObject: arguments),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.App ? !!App.command.apply(null, \(json)) : false", completionHandler: nil)
    }

    func pageStateChanged() {
        viewGroup?.selectedIndex = page.view == "compact" ? 1 : 0
        window.toolbar?.validateVisibleItems()
    }

    func applyTheme() {
        switch theme {
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        default: NSApp.appearance = nil
        }
    }

    // MARK: Alerts

    func warn(_ title: String, _ detail: String = "") {
        if let selfTest {
            selfTest.warnings.append(title + (detail.isEmpty ? "" : " " + detail))
            return
        }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = detail
        if window.isVisible { alert.beginSheetModal(for: window) } else { alert.runModal() }
    }

    func saveFailed(_ error: Error) {
        if saveFailureShown { return }
        saveFailureShown = true
        warn("Your changes couldn’t be saved.", error.localizedDescription)
    }

    func saveSucceeded() { saveFailureShown = false }

    // MARK: Actions

    @objc func checkForUpdates(_ sender: Any?) { updateChecker.check(manual: true) }
    @objc func openUpdate(_ sender: Any?) {
        if let url = updateChecker.available?.url { NSWorkspace.shared.open(url) }
    }

    func updateToolbar() {
        guard let toolbar = window.toolbar else { return }
        let index = toolbar.items.firstIndex { $0.itemIdentifier == .update }
        if updateChecker.available != nil && index == nil {
            let insertionIndex = toolbar.items.firstIndex { $0.itemIdentifier == .calendars } ?? toolbar.items.count
            toolbar.insertItem(withItemIdentifier: .update, at: insertionIndex)
        } else if updateChecker.available == nil, let index {
            toolbar.removeItem(at: index)
        }
    }

    @objc func newItem(_ sender: Any?) { command("new-item") }
    @objc func newClass(_ sender: Any?) { command("new-class") }
    @objc func importData(_ sender: Any?) { command("import") }
    @objc func showCalendars(_ sender: Any?) { command("calendars") }
    @objc func exportData(_ sender: Any?) { command("export") }
    @objc func showTimeline(_ sender: Any?) { command("view", "timeline") }
    @objc func showCompact(_ sender: Any?) { command("view", "compact") }
    @objc func goToToday(_ sender: Any?) { command("today") }
    @objc func undoChange(_ sender: Any?) { command("undo") }
    @objc func redoChange(_ sender: Any?) { command("redo") }

    @objc func viewModeChanged(_ sender: NSToolbarItemGroup) {
        command("view", sender.selectedIndex == 1 ? "compact" : "timeline")
    }

    @objc func chooseTheme(_ sender: NSMenuItem) {
        guard let choice = sender.representedObject as? String else { return }
        theme = choice
        applyTheme()
        command("theme", choice)
    }

    @objc func showDataInFinder(_ sender: Any?) {
        if FileManager.default.fileExists(atPath: store.file.path) {
            NSWorkspace.shared.activateFileViewerSelecting([store.file])
        } else {
            try? FileManager.default.createDirectory(at: store.directory, withIntermediateDirectories: true)
            NSWorkspace.shared.open(store.directory)
        }
    }

    // MARK: Menu bar

    private func makeMenu() -> NSMenu {
        let name = "Lectures Fable"
        let main = NSMenu()

        func submenu(_ title: String, _ build: (NSMenu) -> Void) -> NSMenu {
            let menu = NSMenu(title: title)
            build(menu)
            let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            holder.submenu = menu
            main.addItem(holder)
            return menu
        }
        @discardableResult
        func add(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String = "",
                 _ modifiers: NSEvent.ModifierFlags = .command, mine: Bool = false) -> NSMenuItem {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            item.keyEquivalentModifierMask = modifiers
            if mine { item.target = self }
            menu.addItem(item)
            return item
        }

        _ = submenu(name) { m in
            add(m, "About \(name)", #selector(NSApplication.orderFrontStandardAboutPanel(_:)))
            add(m, "Check for Updates…", #selector(checkForUpdates(_:)), mine: true)
            m.addItem(.separator())
            add(m, "Hide \(name)", #selector(NSApplication.hide(_:)), "h")
            add(m, "Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option])
            add(m, "Show All", #selector(NSApplication.unhideAllApplications(_:)))
            m.addItem(.separator())
            add(m, "Quit \(name)", #selector(NSApplication.terminate(_:)), "q")
        }

        _ = submenu("File") { m in
            add(m, "New Item…", #selector(newItem(_:)), "n", mine: true)
            add(m, "New Class", #selector(newClass(_:)), "n", [.command, .shift], mine: true)
            m.addItem(.separator())
            add(m, "Calendars…", #selector(showCalendars(_:)), mine: true)
            add(m, "Import…", #selector(importData(_:)), "i", [.command, .shift], mine: true)
            add(m, "Export…", #selector(exportData(_:)), "e", [.command, .shift], mine: true)
            m.addItem(.separator())
            add(m, "Show Data in Finder", #selector(showDataInFinder(_:)), mine: true)
            m.addItem(.separator())
            add(m, "Close Window", #selector(NSWindow.performClose(_:)), "w")
        }

        _ = submenu("Edit") { m in
            add(m, "Undo", #selector(undoChange(_:)), "z", mine: true)
            add(m, "Redo", #selector(redoChange(_:)), "z", [.command, .shift], mine: true)
            m.addItem(.separator())
            add(m, "Cut", #selector(NSText.cut(_:)), "x")
            add(m, "Copy", #selector(NSText.copy(_:)), "c")
            add(m, "Paste", #selector(NSText.paste(_:)), "v")
            add(m, "Delete", #selector(NSText.delete(_:)))
            add(m, "Select All", #selector(NSText.selectAll(_:)), "a")
        }

        _ = submenu("View") { m in
            add(m, "Timeline", #selector(showTimeline(_:)), "1", mine: true)
            add(m, "Compact", #selector(showCompact(_:)), "2", mine: true)
            m.addItem(.separator())
            add(m, "Go to Today", #selector(goToToday(_:)), "t", mine: true)
            m.addItem(.separator())
            let appearance = NSMenu(title: "Appearance")
            for (title, id) in [("Match System", "system"), ("Dark", "dark"), ("Light", "light")] {
                add(appearance, title, #selector(chooseTheme(_:)), mine: true).representedObject = id
            }
            let holder = NSMenuItem(title: "Appearance", action: nil, keyEquivalent: "")
            holder.submenu = appearance
            m.addItem(holder)
            m.addItem(.separator())
            add(m, "Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])
        }

        NSApp.windowsMenu = submenu("Window") { m in
            add(m, "Minimize", #selector(NSWindow.performMiniaturize(_:)), "m")
            add(m, "Zoom", #selector(NSWindow.performZoom(_:)))
            m.addItem(.separator())
            add(m, "Bring All to Front", #selector(NSApplication.arrangeInFront(_:)))
        }
        return main
    }
}

// MARK: - Menu and toolbar state

extension AppDelegate: NSMenuItemValidation, NSToolbarItemValidation {
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(undoChange(_:)):
            item.title = page.textFocused || page.undoLabel.isEmpty ? "Undo" : "Undo \(page.undoLabel)"
            return pageReady && (page.textFocused || (page.canUndo && !page.modal))
        case #selector(redoChange(_:)):
            item.title = page.textFocused || page.redoLabel.isEmpty ? "Redo" : "Redo \(page.redoLabel)"
            return pageReady && (page.textFocused || (page.canRedo && !page.modal))
        case #selector(showTimeline(_:)):
            item.state = page.view == "timeline" ? .on : .off
            return pageReady && !page.modal
        case #selector(showCompact(_:)):
            item.state = page.view == "compact" ? .on : .off
            return pageReady && !page.modal
        case #selector(chooseTheme(_:)):
            item.state = (item.representedObject as? String) == theme ? .on : .off
            return true
        case #selector(newItem(_:)), #selector(newClass(_:)), #selector(showCalendars(_:)), #selector(importData(_:)),
             #selector(exportData(_:)), #selector(goToToday(_:)):
            return pageReady && !page.modal && window.isVisible
        default:
            return true
        }
    }

    func validateToolbarItem(_ item: NSToolbarItem) -> Bool {
        item.itemIdentifier == .update ? updateChecker.available != nil : pageReady && !page.modal
    }
}

// MARK: - Toolbar

extension AppDelegate: NSToolbarDelegate {
    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.flexibleSpace, .viewMode, .flexibleSpace, .calendars, .today, .add]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar) + [.update]
    }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier,
                 willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        switch identifier {
        case .viewMode:
            let group = NSToolbarItemGroup(itemIdentifier: identifier, titles: ["Timeline", "Compact"],
                                           selectionMode: .selectOne, labels: ["Timeline", "Compact"],
                                           target: self, action: #selector(viewModeChanged(_:)))
            group.controlRepresentation = .expanded
            group.selectedIndex = page.view == "compact" ? 1 : 0
            group.label = "View"
            viewGroup = group
            return group
        case .update:
            let item = NSToolbarItem(itemIdentifier: identifier)
            item.title = "Update"
            item.label = "Update"
            item.toolTip = "Download update"
            item.isBordered = true
            item.target = self
            item.action = #selector(openUpdate(_:))
            return item
        case .calendars:
            let item = NSToolbarItem(itemIdentifier: identifier)
            item.image = NSImage(systemSymbolName: "calendar", accessibilityDescription: "Calendars")
            item.label = "Calendars"
            item.toolTip = "Calendars"
            item.isBordered = true
            item.target = self
            item.action = #selector(showCalendars(_:))
            return item
        case .today:
            let item = NSToolbarItem(itemIdentifier: identifier)
            item.title = "Today"
            item.label = "Today"
            item.toolTip = "Go to today (⌘T)"
            item.isBordered = true
            item.target = self
            item.action = #selector(goToToday(_:))
            return item
        case .add:
            let item = NSToolbarItem(itemIdentifier: identifier)
            item.image = NSImage(systemSymbolName: "plus", accessibilityDescription: "New Item")
            item.label = "New Item"
            item.toolTip = "New item (⌘N)"
            item.isBordered = true
            item.target = self
            item.action = #selector(newItem(_:))
            return item
        default:
            return nil
        }
    }
}

// MARK: - Navigation

extension AppDelegate: WKNavigationDelegate {
    /// The window only ever shows the bundled page. Links open through the "open" bridge call.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        let target = navigationAction.request.url?.standardizedFileURL
        decisionHandler(target != nil && target == pageURL?.standardizedFileURL ? .allow : .cancel)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        pageReady = false
        webView.reload()
    }
}
