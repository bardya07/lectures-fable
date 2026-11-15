import Foundation

/// Compares three-component numeric release versions, accepting an optional leading v.
enum VersionComparison {
    static func compare(_ lhs: String, _ rhs: String) -> ComparisonResult? {
        guard let left = components(lhs), let right = components(rhs) else { return nil }
        for (a, b) in zip(left, right) {
            if a.count != b.count { return a.count < b.count ? .orderedAscending : .orderedDescending }
            if a != b { return a.lexicographicallyPrecedes(b) ? .orderedAscending : .orderedDescending }
        }
        return .orderedSame
    }

    private static func components(_ version: String) -> [String]? {
        let raw = version.hasPrefix("v") ? String(version.dropFirst()) : version
        let parts = raw.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var result: [String] = []
        for part in parts {
            guard !part.isEmpty, part.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }) else { return nil }
            // Compare digit strings rather than machine integers, so large components don't overflow.
            let trimmed = part.drop(while: { $0 == "0" })
            result.append(trimmed.isEmpty ? "0" : String(trimmed))
        }
        return result
    }
}
