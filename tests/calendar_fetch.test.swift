import Foundation

private final class FixtureProtocol: URLProtocol {
    static var calendar = Data()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url, url.host == "calendar.example.test",
              request.value(forHTTPHeaderField: "Accept")?.contains("text/calendar") == true else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        var status = 200
        var headers = ["Content-Type": "text/calendar; charset=utf-8"]
        var data = Self.calendar
        switch url.path {
        case "/denied": status = 403
        case "/missing": status = 404
        case "/unavailable": status = 503
        case "/redirect":
            status = 302
            headers["Location"] = "http://calendar.example.test/fixture"
        case "/invalid": data = Data([0xFF])
        case "/timeout":
            client?.urlProtocol(self, didFailWithError: URLError(.timedOut))
            return
        case "/offline":
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        case "/fixture": break
        default: status = 400
        }
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@main
struct CalendarFetchTests {
    static func main() async throws {
        let fixture = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        FixtureProtocol.calendar = fixture
        let config = CalendarFetch.configuration()
        config.protocolClasses = [FixtureProtocol.self]
        let url = try CalendarFetch.url(" \tWeBcAl://calendar.example.test/fixture?token=abc%2B123#discard\n")
        precondition(url.absoluteString == "https://calendar.example.test/fixture?token=abc%2B123")
        let text = try await CalendarFetch.fetch(url, configuration: config)
        precondition(Data(text.utf8) == fixture)

        for (input, expected) in [
            ("http://calendar.example.test/fixture", "Enter an HTTPS or webcal URL."),
            ("https:///calendar.example.test", "Invalid calendar URL."),
            ("https://calendar.example.test/has space", "Invalid calendar URL."),
            ("https://name:pass@calendar.example.test", "Remove credentials from the URL."),
            ("https://calendar.example.test:65536", "Invalid calendar URL."),
        ] {
            do {
                _ = try CalendarFetch.url(input)
                preconditionFailure("Accepted malformed URL")
            } catch {
                precondition(CalendarFetch.message(for: error) == expected)
            }
        }

        for (path, expected) in [
            ("/denied", "Calendar access denied."),
            ("/missing", "Calendar not found."),
            ("/unavailable", "Calendar unavailable (HTTP 503)."),
            ("/redirect", "Calendar must use HTTPS."),
            ("/invalid", "Calendar file isn’t UTF-8."),
            ("/timeout", "Calendar request timed out."),
            ("/offline", "No internet connection."),
        ] {
            let url = try CalendarFetch.url("https://calendar.example.test" + path)
            do {
                _ = try await CalendarFetch.fetch(url, configuration: config)
                preconditionFailure("Expected fetch failure for \(path)")
            } catch {
                let actual = CalendarFetch.message(for: error)
                precondition(actual == expected, "\(path): \(actual)")
            }
        }
        do {
            _ = try CalendarFetch.decode(Data(count: CalendarFetch.maxBytes + 1))
            preconditionFailure("Accepted oversized file")
        } catch {
            precondition(CalendarFetch.message(for: error) == "Calendar file is too large.")
        }
        print("calendar fetch: fixture, URL validation and transport errors passed")
    }
}
