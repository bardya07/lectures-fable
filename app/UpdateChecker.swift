import AppKit

/// Checks GitHub releases without downloading or installing anything.
@MainActor
final class UpdateChecker {
    struct Release: Decodable {
        let tag_name: String
        let html_url: String
    }

    struct AvailableUpdate {
        let version: String
        let url: URL
    }

    weak var delegate: AppDelegate?
    private var timer: Timer?
    private var task: URLSessionDataTask?
    private var manualPending = false
    private(set) var available: AvailableUpdate?

    init(delegate: AppDelegate) {
        self.delegate = delegate
    }

    func start() {
        // The UI self-tests must never make network requests.
        guard !Launch.isSelfTest else { return }
        automaticCheck()
    }

    private func automaticCheck() {
        check(manual: false)
        // Schedule from the actual check time, including after the computer wakes.
        timer = Timer.scheduledTimer(withTimeInterval: 24 * 60 * 60, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.automaticCheck() }
        }
    }

    func check(manual: Bool) {
        if Launch.isSelfTest {
            if manual { delegate?.warn("Couldn't check for updates.") }
            return
        }
        if manual { manualPending = true }
        // A manual request can share an automatic request already in flight.
        guard task == nil else { return }
        var request = URLRequest(url: URL(string: "https://api.github.com/repos/bardya07/lectures-fable/releases/latest")!)
        request.timeoutInterval = 10
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("LecturesFable", forHTTPHeaderField: "User-Agent")
        task = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            let result: (Release, URL)?
            if error == nil, let response = response as? HTTPURLResponse, response.statusCode == 200,
               let data, let release = try? JSONDecoder().decode(Release.self, from: data),
               let url = URL(string: release.html_url), url.scheme == "https", url.host == "github.com" {
                result = (release, url)
            } else {
                result = nil
            }
            DispatchQueue.main.async { [weak self] in
                self?.finish(result)
            }
        }
        task?.resume()
    }

    private func finish(_ result: (Release, URL)?) {
        task = nil
        var succeeded = false
        if let (release, url) = result,
           let current = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
           let comparison = VersionComparison.compare(release.tag_name, current) {
            succeeded = true
            let version = release.tag_name.hasPrefix("v") ? String(release.tag_name.dropFirst()) : release.tag_name
            available = comparison == .orderedDescending ? AvailableUpdate(version: version, url: url) : nil
            delegate?.updateToolbar()
        }
        if manualPending {
            manualPending = false
            showResult(succeeded ? .some(available) : nil)
        }
    }

    // Outer optional distinguishes a failed check from a successful check with no update.
    private func showResult(_ result: AvailableUpdate??) {
        let alert = NSAlert()
        if let result {
            if let update = result {
                alert.messageText = "Version \(update.version) is available."
                alert.addButton(withTitle: "Download")
                alert.addButton(withTitle: "Later")
                present(alert) { response in
                    if response == .alertFirstButtonReturn { NSWorkspace.shared.open(update.url) }
                }
            } else {
                alert.messageText = "You're up to date."
                present(alert)
            }
        } else {
            alert.messageText = "Couldn't check for updates."
            present(alert)
        }
    }

    private func present(_ alert: NSAlert, completion: ((NSApplication.ModalResponse) -> Void)? = nil) {
        if let window = delegate?.window, window.isVisible {
            alert.beginSheetModal(for: window) { response in completion?(response) }
        } else {
            let response = alert.runModal()
            completion?(response)
        }
    }
}
