import WebKit

// Run the bundled HTML, CSS and JavaScript in an off-screen, in-process WebKit view.
// The full app suite additionally checks WKWebView, native menus, panels and the toolbar.
@main
struct WebTests {
    @MainActor
    static func main() throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        func read(_ path: String) throws -> String {
            try String(contentsOf: root.appendingPathComponent(path), encoding: .utf8)
        }
        var html = try read("web/index.html")
        html = try html.replacingOccurrences(of: #"<link rel="stylesheet" href="style.css">"#, with: "<style>" + read("web/style.css") + "</style>")
        for script in ["core", "calendar", "app"] {
            html = try html.replacingOccurrences(of: "<script src=\"\(script).js\"></script>", with: "<script>" + read("web/\(script).js") + "</script>")
        }
        let tests = try read("tests/web.test.js")
        var checks = 0
        for scenario in ["ui", "corrupt", "unreadable", "partial"] {
            let setup = """
            <script>
            const scenario = '\(scenario)';
            const writes = [], warnings = [], copies = [];
            const partial = '{"classes":[{"id":"c","name":"Course"},null],"items":[]}';
            window.__testBridge = {
              load() {
                if (scenario === 'unreadable') throw new Error('Unreadable');
                return { data: scenario === 'ui' ? null : scenario === 'corrupt' ? '{' : partial };
              },
              save({ json }) { writes.push(JSON.parse(json)); },
              backUpBeforeImport() { copies.push(partial); },
              alert({ message }) { warnings.push(message); },
              ui() {},
              ready() { setTimeout(async () => {
                try {
                  const n = scenario === 'ui' ? await testWebRegressions() + await testBrowserFallback() : testLoadFailure(scenario, writes, copies, warnings);
                  window.testResult = String(n);
                } catch (error) { window.testResult = error.message + '\\n' + error.stack; }
              }, 0); },
            };
            </script>
            """
            let page = html.replacingOccurrences(of: "<head>", with: "<head>" + setup + "<script>" + tests + "</script>")
            let view = WebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 760), frameName: nil, groupName: nil)!
            let preferences = WebPreferences(identifier: "GrodTests")!
            preferences.autosaves = false
            preferences.privateBrowsingEnabled = true
            view.preferences = preferences
            view.mainFrame.loadHTMLString(page, baseURL: nil)
            let deadline = Date().addingTimeInterval(45)
            var result = ""
            repeat {
                RunLoop.current.run(until: Date().addingTimeInterval(0.02))
                result = view.stringByEvaluatingJavaScript(from: "window.testResult || ''") ?? ""
            } while result.isEmpty && Date() < deadline
            guard let count = Int(result), count > 0 else {
                fputs("FAIL \(scenario): \(result.isEmpty ? "WebKit timed out" : result)\n", stderr)
                exit(1)
            }
            view.close()
            checks += count
        }
        print("WebKit: \(checks) UI and persistence regression checks passed.")
    }
}
