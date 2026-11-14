import Foundation

// Test helper (test/conlang.test.js): reads "lang<TAB>text" lines on stdin and prints
// Conlang.translate(lang, text) for each, to compare the Swift port with public/js/conlang.js.
//   swiftc macos/Sources/Conlang.swift macos/ConlangTool/main.swift -o conlang-tool
guard Conlang.available else {
    FileHandle.standardError.write("conlang data not found: \(Conlang.dataURL.path)\n".data(using: .utf8)!)
    exit(1)
}
var out = ""
while let line = readLine(strippingNewline: true) {
    let parts = line.split(separator: "\t", maxSplits: 1, omittingEmptySubsequences: false)
    let lang = parts.count > 0 ? String(parts[0]) : ""
    let text = parts.count > 1 ? String(parts[1]) : ""
    out += Conlang.translate(lang, text) + "\n"
}
FileHandle.standardOutput.write(out.data(using: .utf8)!)
