import Foundation

@main
struct VersionComparisonTests {
    static func main() {
        let cases: [(String, String, ComparisonResult?)] = [
            ("1.0.0", "1.0.1", .orderedAscending),
            ("1.0.1", "1.0.0", .orderedDescending),
            ("1.10.0", "1.9.9", .orderedDescending),
            ("v1.0.1", "1.0.0", .orderedDescending),
            ("1.0.0", "v1.0.0", .orderedSame),
            ("1.0.0", "1.0.0", .orderedSame),
            ("1.0", "1.0.0", nil),
            ("1.0.0.1", "1.0.0", nil),
            ("1..0", "1.0.0", nil),
            ("1.0.x", "1.0.0", nil),
            ("1.0.0-beta", "1.0.0", nil),
            ("1.0.0", "v", nil),
            ("999999999999999999999.0.0", "9.0.0", .orderedDescending),
        ]
        for (lhs, rhs, expected) in cases {
            let actual = VersionComparison.compare(lhs, rhs)
            guard actual == expected else {
                fputs("FAIL: compare(\(lhs), \(rhs)) returned \(String(describing: actual)), expected \(String(describing: expected))\n", stderr)
                exit(1)
            }
        }
        print("Version comparison tests passed (\(cases.count) cases).")
    }
}
