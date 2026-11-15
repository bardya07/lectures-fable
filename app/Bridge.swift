import AppKit
import WebKit
import UniformTypeIdentifiers

/// Collects the choice from a context menu.
private final class MenuPick: NSObject {
    var id: String?
    @objc func pick(_ sender: NSMenuItem) { id = sender.representedObject as? String }
}

/// Requests from the page. Each one is `{op, ...}` and gets a reply that resolves a JS promise.
extension AppDelegate: WKScriptMessageHandlerWithReply {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(nil, "Malformed message")
            return
        }
        let text: (String) -> String = { body[$0] as? String ?? "" }

        switch op {
        case "load":
            let data: Any = store.load() ?? NSNull()
            replyHandler(["data": data], nil)

        case "ready":
            pageReady = true
            pageStateChanged()
            replyHandler(true, nil)
            if let notice = store.notice { warn("Lectures Fable started without your data.", notice) }
            selfTest?.start()

        case "save":
            do {
                try store.save(text("json"))
                saveSucceeded()
                replyHandler(true, nil)
            } catch {
                saveFailed(error)
                replyHandler(nil, error.localizedDescription)
            }

        case "ui":
            page.view = text("view") == "compact" ? "compact" : "timeline"
            page.canUndo = body["canUndo"] as? Bool ?? false
            page.canRedo = body["canRedo"] as? Bool ?? false
            page.undoLabel = text("undoLabel")
            page.redoLabel = text("redoLabel")
            page.textFocused = body["text"] as? Bool ?? false
            page.modal = body["modal"] as? Bool ?? false
            pageStateChanged()
            replyHandler(true, nil)

        case "open":
            guard let url = AppDelegate.linkURL(text("url")) else { replyHandler(false, nil); return }
            if let selfTest { selfTest.opened.append(url.absoluteString); replyHandler(true, nil); return }
            replyHandler(NSWorkspace.shared.open(url), nil)

        case "menu":
            showMenu(body["items"] as? [[String: Any]] ?? [], reply: replyHandler)

        case "confirm":
            if selfTest != nil { replyHandler(true, nil); return }
            let alert = NSAlert()
            alert.messageText = text("title")
            alert.informativeText = text("message")
            let button = alert.addButton(withTitle: text("confirm").isEmpty ? "OK" : text("confirm"))
            button.hasDestructiveAction = body["destructive"] as? Bool ?? false
            alert.addButton(withTitle: "Cancel")
            alert.beginSheetModal(for: window) { response in replyHandler(response == .alertFirstButtonReturn, nil) }

        case "alert":
            if let selfTest { selfTest.warnings.append(text("title")); replyHandler(true, nil); return }
            let alert = NSAlert()
            alert.messageText = text("title")
            alert.informativeText = text("message")
            alert.beginSheetModal(for: window) { _ in replyHandler(true, nil) }

        case "export":
            exportFile(json: text("json"), suggestedName: text("filename"), reply: replyHandler)

        case "import":
            importFile(reply: replyHandler)

        case "calendarFetch":
            fetchCalendar(text("url"), reply: replyHandler)

        case "calendarImport":
            importCalendar(reply: replyHandler)

        default:
            if let selfTest, op.hasPrefix("test.") {
                selfTest.handle(op, body, reply: replyHandler)
            } else {
                replyHandler(nil, "Unknown request: \(op)")
            }
        }
    }

    // MARK: Context menus

    private func showMenu(_ specs: [[String: Any]], reply: @escaping @MainActor (Any?, String?) -> Void) {
        if selfTest != nil { reply(NSNull(), nil); return }
        let pick = MenuPick()
        let menu = NSMenu()
        menu.autoenablesItems = false
        for spec in specs {
            if spec["separator"] as? Bool == true { menu.addItem(.separator()); continue }
            let item = NSMenuItem(title: spec["title"] as? String ?? "", action: #selector(MenuPick.pick(_:)), keyEquivalent: "")
            item.target = pick
            item.representedObject = spec["id"] as? String
            item.isEnabled = !(spec["disabled"] as? Bool ?? false)
            menu.addItem(item)
        }
        // Menu tracking blocks until it closes, so let this message handler return first.
        DispatchQueue.main.async { [self] in
            let point = webView.convert(window.mouseLocationOutsideOfEventStream, from: nil)
            menu.popUp(positioning: nil, at: point, in: webView)
            DispatchQueue.main.async { reply(pick.id.map { $0 as Any } ?? NSNull(), nil) }
        }
    }

    // MARK: Links

    /// Turns what the user typed in the Link field into something macOS can open.
    static func linkURL(_ raw: String) -> URL? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        if text.hasPrefix("/") || text.hasPrefix("~") {
            return URL(fileURLWithPath: (text as NSString).expandingTildeInPath)
        }
        guard let url = URL(string: text) ?? text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed).flatMap(URL.init(string:)),
              let scheme = url.scheme?.lowercased(),
              !["javascript", "data", "vbscript", "blob", "about"].contains(scheme) else { return nil }
        return url
    }

    // MARK: Export and import

    private func exportFile(json: String, suggestedName: String, reply: @escaping @MainActor (Any?, String?) -> Void) {
        let data = Data(json.utf8)
        guard Store.isUsable(data) else { reply(false, nil); return }
        let name = suggestedName.isEmpty ? "Lectures.json" : (suggestedName as NSString).lastPathComponent

        if selfTest != nil, let out = Launch.outputDirectory {
            let ok = (try? data.write(to: out.appendingPathComponent(name), options: .atomic)) != nil
            reply(ok, nil)
            return
        }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.json]
        panel.nameFieldStringValue = name
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { [self] response in
            guard response == .OK, let url = panel.url else { reply(false, nil); return }
            do {
                try data.write(to: url, options: .atomic)
                reply(true, nil)
            } catch {
                warn("The backup couldn’t be saved.", error.localizedDescription)
                reply(false, nil)
            }
        }
    }

    private func importFile(reply: @escaping @MainActor (Any?, String?) -> Void) {
        let read: (URL) -> Void = { [self] url in
            do {
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= 20_000_000 else { throw CocoaError(.fileReadTooLarge) }
                let data = try Data(contentsOf: url)
                store.backUpBeforeImport()
                reply(["name": url.lastPathComponent, "text": String(decoding: data, as: UTF8.self)], nil)
            } catch {
                warn("“\(url.lastPathComponent)” couldn’t be opened.", error.localizedDescription)
                reply(NSNull(), nil)
            }
        }
        if selfTest != nil {
            if let url = Launch.importFile { read(url) } else { reply(NSNull(), nil) }
            return
        }
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else { reply(NSNull(), nil); return }
            read(url)
        }
    }

    // MARK: Calendars

    private func fetchCalendar(_ raw: String, reply: @escaping @MainActor (Any?, String?) -> Void) {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: value),
              let scheme = parts.scheme?.lowercased(), ["https", "webcal"].contains(scheme),
              let host = parts.host, !host.isEmpty else {
            reply(nil, "Enter an HTTPS or webcal URL.")
            return
        }
        parts.scheme = "https"
        guard let url = parts.url else { reply(nil, "Invalid calendar URL."); return }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 20
        let session = URLSession(configuration: configuration)
        Task { @MainActor in
            defer { session.finishTasksAndInvalidate() }
            do {
                let (data, response) = try await session.data(from: url)
                guard let http = response as? HTTPURLResponse,
                      http.url?.scheme?.lowercased() == "https" else {
                    reply(nil, "Calendar connection failed.")
                    return
                }
                guard (200...299).contains(http.statusCode) else {
                    reply(nil, "Calendar unavailable (HTTP \(http.statusCode)).")
                    return
                }
                guard data.count <= 20_000_000, let text = String(data: data, encoding: .utf8) else {
                    reply(nil, "Calendar file is invalid or too large.")
                    return
                }
                reply(["text": text], nil)
            } catch {
                let message = (error as? URLError)?.code == .timedOut ? "Calendar request timed out." : "Couldn’t fetch calendar."
                reply(nil, message)
            }
        }
    }

    private func importCalendar(reply: @escaping @MainActor (Any?, String?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "ics") ?? .data]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else { reply(NSNull(), nil); return }
            do {
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= 20_000_000 else { throw CocoaError(.fileReadTooLarge) }
                let data = try Data(contentsOf: url)
                guard let text = String(data: data, encoding: .utf8) else { throw CocoaError(.fileReadInapplicableStringEncoding) }
                reply(["name": url.lastPathComponent, "text": text], nil)
            } catch {
                reply(nil, "Couldn’t open calendar file.")
            }
        }
    }

}
