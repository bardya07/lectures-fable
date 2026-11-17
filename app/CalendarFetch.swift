import Foundation

enum CalendarFetch {
    static let maxBytes = 20_000_000

    enum Failure: LocalizedError {
        case scheme, invalidURL, credentials, tooLong, redirect, http(Int), tooLarge, encoding

        var errorDescription: String? {
            switch self {
            case .scheme: return "Enter an HTTPS or webcal URL."
            case .invalidURL: return "Invalid calendar URL."
            case .credentials: return "Remove credentials from the URL."
            case .tooLong: return "Calendar URL is too long."
            case .redirect: return "Calendar must use HTTPS."
            case .http(401), .http(403): return "Calendar access denied."
            case .http(404), .http(410): return "Calendar not found."
            case .http(let status): return "Calendar unavailable (HTTP \(status))."
            case .tooLarge: return "Calendar file is too large."
            case .encoding: return "Calendar file isn’t UTF-8."
            }
        }
    }

    static func url(_ raw: String) throws -> URL {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.range(of: #"^(https|webcal)://"#, options: [.regularExpression, .caseInsensitive]) != nil else {
            throw Failure.scheme
        }
        guard value.range(of: #"^(https|webcal)://[^/?#]+"#, options: [.regularExpression, .caseInsensitive]) != nil,
              value.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil,
              !value.contains("\\"),
              var parts = URLComponents(string: value), let host = parts.host, !host.isEmpty,
              parts.port.map({ (0...65535).contains($0) }) != false else { throw Failure.invalidURL }
        guard (parts.user ?? "").isEmpty && (parts.password ?? "").isEmpty else { throw Failure.credentials }
        parts.user = nil
        parts.password = nil
        parts.scheme = "https"
        parts.fragment = nil
        guard let url = parts.url else { throw Failure.invalidURL }
        guard url.absoluteString.utf8.count <= 2000 else { throw Failure.tooLong }
        return url
    }

    private final class Redirects: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask,
                        willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(request.url?.scheme?.lowercased() == "https" ? request : nil)
        }
    }

    static func configuration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 20
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        return config
    }

    static func fetch(_ url: URL, configuration: URLSessionConfiguration = configuration()) async throws -> String {
        let session = URLSession(configuration: configuration)
        defer { session.finishTasksAndInvalidate() }
        var request = URLRequest(url: url)
        request.setValue("text/calendar, */*;q=0.5", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request, delegate: Redirects())
        guard let http = response as? HTTPURLResponse, http.url?.scheme?.lowercased() == "https" else {
            throw Failure.redirect
        }
        if (300...399).contains(http.statusCode), let location = http.value(forHTTPHeaderField: "Location"),
           let target = URL(string: location, relativeTo: http.url), target.scheme?.lowercased() != "https" {
            throw Failure.redirect
        }
        guard (200...299).contains(http.statusCode) else { throw Failure.http(http.statusCode) }
        return try decode(data)
    }

    static func decode(_ data: Data) throws -> String {
        guard data.count <= maxBytes else { throw Failure.tooLarge }
        guard let text = String(data: data, encoding: .utf8) else { throw Failure.encoding }
        return text
    }

    static func message(for error: Error) -> String {
        if let failure = error as? Failure { return failure.localizedDescription }
        switch (error as? URLError)?.code {
        case .timedOut: return "Calendar request timed out."
        case .notConnectedToInternet: return "No internet connection."
        case .networkConnectionLost: return "Calendar connection lost."
        case .cannotFindHost, .dnsLookupFailed, .cannotConnectToHost: return "Calendar server unreachable."
        case .secureConnectionFailed, .serverCertificateHasBadDate, .serverCertificateUntrusted,
             .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid: return "Calendar HTTPS connection failed."
        default: return "Couldn’t fetch calendar."
        }
    }
}
