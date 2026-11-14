// Draws the app icon (pixel art: a golden ring above a fire mountain, on parchment) and writes
// an .iconset folder. Usage: make-icon <output.iconset>  (then: iconutil -c icns <output.iconset>)
import AppKit

struct RGBA: Equatable { var r: UInt8, g: UInt8, b: UInt8, a: UInt8 = 255 }

func hex(_ v: UInt32) -> RGBA { RGBA(r: UInt8(v >> 16 & 0xff), g: UInt8(v >> 8 & 0xff), b: UInt8(v & 0xff)) }

let N = 32
var px = [[RGBA?]](repeating: [RGBA?](repeating: nil, count: N), count: N)

let parchment = hex(0xEBD7A7), parchShade = hex(0xDDC28A), border = hex(0x7A5328), borderLight = hex(0xA67C45)
let rockDark = hex(0x2E1B12), rockMid = hex(0x4E3020), rockLight = hex(0x6B4430)
let red = hex(0xC8341E), orange = hex(0xF08A24), yellow = hex(0xFFD23F)
let gold = hex(0xF2C14E), goldDark = hex(0xA8741E), goldLight = hex(0xFFF2B0)
let smoke = hex(0xA8957A)

func set(_ x: Int, _ y: Int, _ c: RGBA) { if x >= 0, x < N, y >= 0, y < N { px[y][x] = c } }

// 1. Rounded parchment tile (cols/rows 1...30, corner radius 5) with a dark border.
func inTile(_ x: Int, _ y: Int) -> Bool {
    let lo = 1, hi = 30, r = 5
    guard x >= lo, x <= hi, y >= lo, y <= hi else { return false }
    let cx = x < lo + r ? lo + r : (x > hi - r ? hi - r : x)
    let cy = y < lo + r ? lo + r : (y > hi - r ? hi - r : y)
    let dx = Double(x - cx), dy = Double(y - cy)
    return dx * dx + dy * dy <= Double(r * r) + 1.5
}
var seed: UInt32 = 7
func rnd() -> UInt32 { seed = seed &* 1103515245 &+ 12345; return (seed >> 16) & 0x7fff }
for y in 0..<N { for x in 0..<N where inTile(x, y) {
    let edge = !inTile(x - 1, y) || !inTile(x + 1, y) || !inTile(x, y - 1) || !inTile(x, y + 1)
    if edge { set(x, y, border); continue }
    let inner = !inTile(x - 2, y) || !inTile(x + 2, y) || !inTile(x, y - 2) || !inTile(x, y + 2)
    set(x, y, inner ? borderLight : (rnd() % 9 == 0 ? parchShade : parchment))
} }

// 2. The fire mountain: crater at row 15, base on the bottom border.
let cx = 15.5
for y in 15...28 {
    let half = 2.6 + Double(y - 15) * 0.95
    for x in 2...29 {
        let d = Double(x) - cx
        guard abs(d) <= half, inTile(x, y), px[y][x] != border else { continue }
        // Light from the upper left: left flank lighter, right flank darker.
        let c: RGBA = d < -half * 0.35 ? rockLight : (d > half * 0.3 ? rockDark : rockMid)
        set(x, y, c)
    }
}
// Crater glow and lava rivers.
for x in 14...17 { set(x, 15, orange) }
set(13, 15, red); set(18, 15, red)
for x in 14...17 { set(x, 14, yellow) }
set(15, 13, yellow); set(16, 13, orange); set(14, 13, red); set(17, 12, red); set(15, 12, orange); set(13, 11, red)
let lava: [(Int, Int, RGBA)] = [
    (14, 16, orange), (14, 17, red), (13, 18, orange), (13, 19, red), (12, 20, red), (12, 21, red), (11, 22, red),
    (17, 16, orange), (18, 17, orange), (18, 18, red), (19, 19, red), (19, 20, red), (20, 21, red),
    (16, 16, red), (16, 17, red),
]
for (x, y, c) in lava { set(x, y, c) }
// A few smoke puffs.
for (x, y) in [(18, 11), (19, 10), (19, 9), (12, 10)] { set(x, y, smoke) }

// 3. The ring, floating above: ellipse outline, light on top, shadow below.
let rcx = 15.5, rcy = 7.0, rx = 6.6, ry = 3.6
for y in 2...11 { for x in 6...25 {
    let nx = (Double(x) - rcx) / rx, ny = (Double(y) - rcy) / ry
    let d = (nx * nx + ny * ny).squareRoot()
    guard d >= 0.7, d <= 1.12 else { continue }
    let c: RGBA = ny < -0.45 ? (abs(nx) < 0.5 ? goldLight : gold) : (ny > 0.45 ? goldDark : gold)
    set(x, y, c)
} }

// MARK: - export

func render(_ size: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: size * 4, bitsPerPixel: 32)!
    let data = rep.bitmapData!
    for y in 0..<size { for x in 0..<size {
        let c = px[y * N / size][x * N / size] // nearest neighbour: crisp pixels at every size
        let o = (y * size + x) * 4
        // premultiplied alpha (opaque or fully transparent only)
        if let c { data[o] = c.r; data[o + 1] = c.g; data[o + 2] = c.b; data[o + 3] = c.a }
        else { data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 0 }
    } }
    return rep.representation(using: .png, properties: [:])!
}

let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset")
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
    try! render(base).write(to: out.appendingPathComponent("icon_\(base)x\(base).png"))
    try! render(base * 2).write(to: out.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}
print("iconset écrit : \(out.path)")
