import AppKit

// Draws the app icon and writes an .icns file (argument 1).
// The picture is the app in miniature: rows of lecture pills, done, behind and still to come,
// split by the "today" line.

func draw(in size: CGFloat) {
    let s = size / 1024
    let ctx = NSGraphicsContext.current!.cgContext
    ctx.scaleBy(x: s, y: s)

    let body = NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 186, yRadius: 186)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.35)
    shadow.shadowBlurRadius = 26 * s
    shadow.shadowOffset = NSSize(width: 0, height: -12 * s)
    shadow.set()
    NSColor.black.setFill()
    body.fill()
    NSGraphicsContext.restoreGraphicsState()

    NSGradient(starting: NSColor(srgbRed: 0.15, green: 0.16, blue: 0.19, alpha: 1),
               ending: NSColor(srgbRed: 0.06, green: 0.065, blue: 0.075, alpha: 1))!.draw(in: body, angle: -90)

    let amber = NSColor(srgbRed: 0.96, green: 0.69, blue: 0.25, alpha: 1)
    let done = NSColor.white.withAlphaComponent(0.14)
    let future = NSColor.white.withAlphaComponent(0.42)
    // 0 = done, 1 = behind, 2 = still to come
    let rows: [[Int]] = [[0, 0, 1, 2, 2], [0, 1, 1, 2, 2], [0, 0, 0, 2, 2]]
    let width: CGFloat = 120, height: CGFloat = 86, gap: CGFloat = 26, left: CGFloat = 160

    for (r, row) in rows.enumerated() {
        let y = 662 - CGFloat(r) * 150 - height / 2
        for (i, state) in row.enumerated() {
            var x = left + CGFloat(i) * (width + gap)
            if i >= 3 { x += 14 } else { x -= 14 }
            let pill = NSBezierPath(roundedRect: NSRect(x: x, y: y, width: width, height: height), xRadius: height / 2, yRadius: height / 2)
            switch state {
            case 0: done.setFill(); pill.fill()
            case 1: amber.setFill(); pill.fill()
            default:
                let inset = NSBezierPath(roundedRect: NSRect(x: x + 4, y: y + 4, width: width - 8, height: height - 8),
                                         xRadius: height / 2 - 4, yRadius: height / 2 - 4)
                inset.lineWidth = 8
                inset.setLineDash([20, 15], count: 2, phase: 0)
                future.setStroke()
                inset.stroke()
            }
        }
    }

    let lineX = left + 3 * (width + gap) - gap / 2
    NSColor.white.withAlphaComponent(0.75).setFill()
    NSBezierPath(roundedRect: NSRect(x: lineX - 4, y: 232, width: 8, height: 560), xRadius: 4, yRadius: 4).fill()
}

func png(_ pixels: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    draw(in: CGFloat(pixels))
    NSGraphicsContext.current?.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

// Modern icns entries contain PNG data, prefixed by their type and big-endian length.
func length(_ value: Int) -> Data {
    var n = UInt32(value).bigEndian
    return Data(bytes: &n, count: 4)
}
let sizes = [("icp4", 16), ("icp5", 32), ("icp6", 64), ("ic07", 128),
             ("ic08", 256), ("ic09", 512), ("ic10", 1024), ("ic11", 32),
             ("ic12", 64), ("ic13", 256), ("ic14", 512)]
var entries = Data()
for (type, pixels) in sizes {
    let image = png(pixels)
    entries.append(Data(type.utf8))
    entries.append(length(image.count + 8))
    entries.append(image)
}
var icon = Data("icns".utf8)
icon.append(length(entries.count + 8))
icon.append(entries)
try icon.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
