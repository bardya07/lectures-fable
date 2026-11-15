import AppKit
import WebKit

/// Support for tests/run.sh. When LECTURES_FABLE_SELFTEST names a script, the app runs it
/// inside the real page with the window parked off-screen. Panels, alerts and link opening are
/// replaced by recorded stand-ins, and the script gets a few extra `test.*` bridge calls.
@MainActor
final class SelfTest {
    unowned let app: AppDelegate
    var opened: [String] = []
    var warnings: [String] = []
    private var started = false

    init(app: AppDelegate) {
        self.app = app
    }

    func start() {
        if started { return }
        started = true
        guard Launch.dataDirectory != nil, let out = Launch.outputDirectory, let scriptURL = Launch.selfTestScript,
              let script = try? String(contentsOf: scriptURL, encoding: .utf8) else {
            FileHandle.standardError.write(Data("Self-test needs LECTURES_FABLE_DATA_DIR, LECTURES_FABLE_OUT and a readable script.\n".utf8))
            exit(2)
        }
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        app.webView.evaluateJavaScript(script + "\n;true") { [weak self] _, error in
            if let error { self?.finish(["ok": false, "error": "Script failed to start: \(error)"]) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self] in
            self?.finish(["ok": false, "error": "Timed out"])
        }
    }

    func handle(_ op: String, _ body: [String: Any], reply: @escaping @MainActor (Any?, String?) -> Void) {
        switch op {
        case "test.snapshot":
            let name = (body["name"] as? String ?? "snapshot") + ".png"
            app.webView.takeSnapshot(with: nil) { image, error in
                guard let image, let png = SelfTest.png(image), let out = Launch.outputDirectory else {
                    reply(false, nil)
                    return
                }
                try? png.write(to: out.appendingPathComponent(name))
                reply(true, nil)
            }

        case "test.resize":
            let width = body["width"] as? Double ?? 1280
            let height = body["height"] as? Double ?? 760
            app.window.setFrame(NSRect(x: -30000, y: -30000, width: width, height: height), display: true)
            reply(true, nil)

        case "test.menu":
            // Runs a menu-bar item the way a click would: validate it, then send its action.
            guard let path = body["path"] as? [String], let item = menuItem(path), let action = item.action else {
                reply(["found": false], nil)
                return
            }
            let target: Any? = item.target ?? app.webView
            let enabled: Bool
            if let validator = target as? NSMenuItemValidation {
                enabled = validator.validateMenuItem(item)
            } else if let validator = target as? NSUserInterfaceValidations {
                enabled = validator.validateUserInterfaceItem(item)
            } else {
                enabled = true
            }
            var sent = false
            if enabled, body["perform"] as? Bool ?? true {
                sent = NSApp.sendAction(action, to: target, from: item)
            }
            reply(["found": true, "enabled": enabled, "sent": sent, "title": item.title, "checked": item.state == .on], nil)

        case "test.toolbar":
            // Clicks a toolbar control. `segment` selects a view in the Timeline/Compact switch.
            guard let id = body["id"] as? String,
                  let item = app.window.toolbar?.items.first(where: { $0.itemIdentifier.rawValue == id }) else {
                reply(false, nil)
                return
            }
            if let group = item as? NSToolbarItemGroup, let segment = body["segment"] as? Int {
                group.selectedIndex = segment
                app.viewModeChanged(group)
            } else if let action = item.action {
                NSApp.sendAction(action, to: item.target, from: item)
            }
            reply(true, nil)

        case "test.focus":
            reply(app.window.makeFirstResponder(app.webView), nil)

        case "test.chrome":
            reply(describeChrome(frameName: body["frameName"] as? String ?? "window-frame.png"), nil)

        case "test.file":
            let text: Any = (try? String(contentsOf: app.store.file, encoding: .utf8)) ?? NSNull()
            reply(text, nil)

        case "test.finish":
            reply(true, nil)
            finish(body["result"] as? [String: Any] ?? ["ok": false, "error": "No result"])

        default:
            reply(nil, "Unknown test request: \(op)")
        }
    }

    private func finish(_ result: [String: Any]) {
        var result = result
        result["opened"] = opened
        result["warnings"] = warnings
        if let out = Launch.outputDirectory,
           let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: out.appendingPathComponent("result.json"))
        }
        exit(result["ok"] as? Bool == true ? 0 : 1)
    }

    private func menuItem(_ path: [String]) -> NSMenuItem? {
        var menu = NSApp.mainMenu
        var found: NSMenuItem?
        for title in path {
            // Undo and Redo carry the name of the change, so match those by prefix.
            found = menu?.items.first { $0.title == title || (["Undo", "Redo"].contains(title) && $0.title.hasPrefix(title)) }
            menu = found?.submenu
        }
        return found
    }

    private func describeChrome(frameName: String) -> [String: Any] {
        let menus: [[String: Any]] = (NSApp.mainMenu?.items ?? []).map { top in
            let items: [String] = (top.submenu?.items ?? []).map { item in
                if item.isSeparatorItem { return "-" }
                var keys = ""
                if !item.keyEquivalent.isEmpty {
                    let m = item.keyEquivalentModifierMask
                    keys = " [" + (m.contains(.control) ? "⌃" : "") + (m.contains(.option) ? "⌥" : "")
                        + (m.contains(.shift) ? "⇧" : "") + (m.contains(.command) ? "⌘" : "") + item.keyEquivalent.uppercased() + "]"
                }
                return item.title + keys + (item.submenu != nil ? " ▸ " + item.submenu!.items.map(\.title).joined(separator: ", ") : "")
            }
            return ["title": top.submenu?.title ?? top.title, "items": items]
        }
        var info: [String: Any] = [
            "menus": menus,
            "toolbar": app.window.toolbar?.items.map { $0.itemIdentifier.rawValue } ?? [],
            "selectedView": app.viewGroup?.selectedIndex ?? -1,
            "windowTitle": app.window.title,
            "appearance": NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua])?.rawValue ?? "",
            "dataFile": app.store.file.path,
            "bundleID": Bundle.main.bundleIdentifier ?? "",
        ]
        // A picture of the window frame (title bar and toolbar). The page itself is drawn by
        // another process and stays blank here; test.snapshot captures that part.
        if let frameView = app.window.contentView?.superview, let out = Launch.outputDirectory,
           let rep = frameView.bitmapImageRepForCachingDisplay(in: frameView.bounds) {
            frameView.cacheDisplay(in: frameView.bounds, to: rep)
            if let png = rep.representation(using: .png, properties: [:]) {
                try? png.write(to: out.appendingPathComponent((frameName as NSString).lastPathComponent))
                info["frameImage"] = (frameName as NSString).lastPathComponent
            }
        }
        return info
    }

    private static func png(_ image: NSImage) -> Data? {
        guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .png, properties: [:])
    }
}
