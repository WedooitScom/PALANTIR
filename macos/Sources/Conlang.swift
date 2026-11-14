import Foundation

/// Invented languages (elf, dwarf, ent): French text -> invented words, deterministic.
/// Exact port of public/js/conlang.js, reading the same data (the JSON between the markers of
/// public/js/conlang-data.js, embedded in the app bundle under Resources/app). Keep both in sync:
/// test/conlang.test.js compares them on the whole French dictionary when swiftc is available.
/// No data file (unexpected): texts stay in French.
enum Conlang {
    struct Gen {
        let onsetFirst: [String], onset: [String], nucleus: [String], coda: [String], codaEnd: [String]
        let add: Int, div: Int, min: Int, max: Int, redouble: Bool
    }
    struct LangData {
        let name: String
        let gen: Gen
        let lex: [String: String]
    }

    /// `LOTR_CONLANG_DATA=<path>` (tests) reads another copy of the data file.
    static var dataURL: URL {
        if let p = ProcessInfo.processInfo.environment["LOTR_CONLANG_DATA"], !p.isEmpty { return URL(fileURLWithPath: p) }
        let res = Bundle.main.resourceURL ?? URL(fileURLWithPath: ".")
        return res.appendingPathComponent("app/public/js/conlang-data.js")
    }

    private static let data: (langs: [String: LangData], keep: [[Unicode.Scalar]], words: Set<String>, long: [String], suffixes: [String], contains: [String])? = load()

    private static func load() -> (langs: [String: LangData], keep: [[Unicode.Scalar]], words: Set<String>, long: [String], suffixes: [String], contains: [String])? {
        guard let text = try? String(contentsOf: dataURL, encoding: .utf8),
              let a = text.range(of: "/*CONLANG-JSON-BEGIN*/"), let b = text.range(of: "/*CONLANG-JSON-END*/"),
              a.upperBound <= b.lowerBound,
              let json = try? JSONSerialization.jsonObject(with: Data(text[a.upperBound..<b.lowerBound].utf8)) as? [String: Any],
              let langs = json["langs"] as? [String: Any] else { return nil }
        var out: [String: LangData] = [:]
        for (code, v) in langs {
            guard let d = v as? [String: Any], let g = d["gen"] as? [String: Any] else { continue }
            let arr = { (k: String) in g[k] as? [String] ?? [""] }
            let num = { (k: String) in (g[k] as? NSNumber)?.intValue ?? 1 }
            let gen = Gen(onsetFirst: arr("onsetFirst"), onset: arr("onset"), nucleus: arr("nucleus"), coda: arr("coda"), codaEnd: arr("codaEnd"),
                          add: num("add"), div: max(1, num("div")), min: num("min"), max: num("max"), redouble: (g["redouble"] as? Bool) ?? false)
            var lex: [String: String] = [:]
            for (k, w) in d["lex"] as? [String: String] ?? [:] { for fr in k.split(separator: "|") { lex[String(fr)] = w } }
            out[code] = LangData(name: d["name"] as? String ?? "", gen: gen, lex: lex)
        }
        let keep = (json["keep"] as? [String] ?? []).map { Array($0.unicodeScalars) }.sorted { $0.count > $1.count }
        let bl = json["blacklist"] as? [String: Any] ?? [:]
        let words = bl["words"] as? [String] ?? []
        return (out, keep, Set(words), words.filter { $0.count >= 4 }, bl["suffixes"] as? [String] ?? [], bl["contains"] as? [String] ?? [])
    }

    static var available: Bool { data != nil }
    static func name(_ lang: String) -> String { data?.langs[lang]?.name ?? "" }
    static func has(_ lang: String) -> Bool { data?.langs[lang] != nil }
    /// Protected terms (product names, commands), longest first.
    static var keepTerms: [String] { (data?.keep ?? []).map { String(String.UnicodeScalarView($0)) } }

    // MARK: - character classes (same as \p{L}, \p{Lu}, \p{Ll}, \p{N}, \p{M} in JS)

    private static func isL(_ c: Unicode.Scalar) -> Bool {
        switch c.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter: return true
        default: return false
        }
    }
    private static func isLu(_ c: Unicode.Scalar) -> Bool { c.properties.generalCategory == .uppercaseLetter }
    private static func isLl(_ c: Unicode.Scalar) -> Bool { c.properties.generalCategory == .lowercaseLetter }
    private static func isN(_ c: Unicode.Scalar) -> Bool {
        switch c.properties.generalCategory {
        case .decimalNumber, .letterNumber, .otherNumber: return true
        default: return false
        }
    }
    private static func isM(_ c: Unicode.Scalar) -> Bool {
        switch c.properties.generalCategory {
        case .nonspacingMark, .spacingMark, .enclosingMark: return true
        default: return false
        }
    }
    private static func isWord(_ c: Unicode.Scalar) -> Bool { isL(c) || isM(c) || isN(c) }
    private static func isAsciiWord(_ c: Unicode.Scalar) -> Bool {
        (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c == "_"
    }
    private static let spaces: Set<Unicode.Scalar> = [" ", "\t", "\n", "\r", "\u{00A0}", "\u{202F}", "\u{2009}"]
    private static let techMarks: Set<Unicode.Scalar> = [".", "_", "@", "~"]
    private static let apostrophes: Set<Unicode.Scalar> = ["'", "\u{2019}"]

    private static func str(_ s: ArraySlice<Unicode.Scalar>) -> String { String(String.UnicodeScalarView(s)) }

    // MARK: - words

    private static func fnv(_ s: String) -> UInt32 {
        var h: UInt32 = 2166136261
        for u in s.utf16 {
            h ^= UInt32(u)
            h = h &* 16777619
        }
        return h
    }

    /// Lowercase ASCII letters only: accents removed, œ -> oe, æ -> ae, ø -> o.
    static func norm(_ s: String) -> String {
        var out = ""
        for c in s.lowercased().decomposedStringWithCanonicalMapping.unicodeScalars {
            if c.value >= 0x300 && c.value <= 0x36F { continue }
            switch c {
            case "œ": out += "oe"
            case "æ": out += "ae"
            case "ø": out += "o"
            default: if c >= "a" && c <= "z" { out.unicodeScalars.append(c) }
            }
        }
        return out
    }

    static func isBanned(_ w: String) -> Bool {
        guard let d = data else { return false }
        let b = norm(w)
        if b.isEmpty { return false }
        if d.words.contains(b) { return true }
        for x in d.long where b.contains(x) { return true }
        for x in d.suffixes where b.hasSuffix(x) { return true }
        for x in d.contains where b.contains(x) { return true }
        return false
    }

    private static var genCache: [String: [String: String]] = [:]
    private static let lock = NSLock()

    static func gen(_ lang: String, _ lw: String) -> String {
        lock.lock()
        defer { lock.unlock() }
        if let hit = genCache[lang]?[lw] { return hit }
        let n = norm(lw)
        guard !n.isEmpty, let cfg = data?.langs[lang]?.gen else { return lw }
        let syl = Swift.min(cfg.max, Swift.max(cfg.min, (n.unicodeScalars.count + cfg.add) / cfg.div))
        var word = lw
        for attempt in 0..<10 {
            var s = fnv("\(lang)|\(attempt)|\(n)")
            func rnd(_ k: Int) -> Int {
                s = s &* 1664525 &+ 1013904223
                return Int((s >> 8) % UInt32(k))
            }
            var parts: [String] = []
            for i in 0..<syl {
                let on = i == 0 ? cfg.onsetFirst : cfg.onset
                let onset = on[rnd(on.count)]
                let nucleus = cfg.nucleus[rnd(cfg.nucleus.count)]
                let co = i == syl - 1 ? cfg.codaEnd : cfg.coda
                parts.append(onset + nucleus + co[rnd(co.count)])
            }
            if cfg.redouble && syl >= 3 {
                let j = rnd(syl - 1)
                parts.insert(parts[j], at: j + 1)
            }
            word = parts.joined()
            if !isBanned(word) { break }
        }
        genCache[lang, default: [:]][lw] = word
        return word
    }

    private static func isUpper(_ w: String) -> Bool { w == w.uppercased() && w != w.lowercased() }
    private static func capFirst(_ s: String) -> String {
        let cs = Array(s.unicodeScalars)
        guard let f = cs.first else { return s }
        return String(f).uppercased() + str(cs[1...])
    }
    private static func applyCase(_ src: String, _ base: String) -> String {
        if isUpper(src) && src.unicodeScalars.count > 1 { return base.uppercased() }
        if let f = src.unicodeScalars.first, isLu(f) { return capFirst(base) }
        return base
    }

    private static func word(_ lang: String, _ w: String, _ hasLower: Bool, _ lex: [String: String]) -> String {
        let cs = Array(w.unicodeScalars)
        if cs.contains(where: isN) { return w }
        let lw = w.lowercased()
        let len = cs.count
        if hasLower && len >= 2 && len <= 4 && isUpper(w) { return w }
        if let v = lex[lw] { return applyCase(w, v) }
        if len == 1 { return w }
        if !isUpper(w) && cs.dropFirst().contains(where: isLu) { return w }
        return applyCase(w, gen(lang, lw))
    }

    private static func chunkWords(_ lang: String, _ cs: [Unicode.Scalar], _ hasLower: Bool, _ lex: [String: String]) -> String {
        var out = ""
        var i = 0
        while i < cs.count {
            if !isL(cs[i]) {
                out.unicodeScalars.append(cs[i])
                i += 1
                continue
            }
            var j = i
            while j < cs.count && isWord(cs[j]) { j += 1 }
            let w = str(cs[i..<j])
            if j < cs.count && apostrophes.contains(cs[j]) {
                if j + 1 < cs.count && isL(cs[j + 1]) {
                    var k = j + 1
                    while k < cs.count && isWord(cs[k]) { k += 1 }
                    let key = w.lowercased() + "'" + str(cs[(j + 1)..<k]).lowercased()
                    if let v = lex[key] {
                        out += applyCase(w, v)
                        i = k
                        continue
                    }
                }
                if let v = lex[w.lowercased() + "'"] {
                    out += applyCase(w, v) + " "
                    i = j + 1
                    continue
                }
            }
            out += word(lang, w, hasLower, lex)
            i = j
        }
        return out
    }

    private static func isTech(_ cs: [Unicode.Scalar]) -> Bool {
        if cs.count >= 3 {
            for i in 1..<(cs.count - 1) where techMarks.contains(cs[i]) {
                if (isL(cs[i - 1]) || isN(cs[i - 1])) && (isL(cs[i + 1]) || isN(cs[i + 1])) { return true }
            }
        }
        return str(cs[...]).contains("://")
    }

    private static func plain(_ lang: String, _ cs: [Unicode.Scalar], _ hasLower: Bool, _ lex: [String: String]) -> String {
        var out = ""
        var i = 0
        while i < cs.count {
            var j = i
            let space = spaces.contains(cs[i])
            while j < cs.count && spaces.contains(cs[j]) == space { j += 1 }
            let part = Array(cs[i..<j])
            if space || isTech(part) { out += str(part[...]) } else { out += chunkWords(lang, part, hasLower, lex) }
            i = j
        }
        return out
    }

    /// French text -> invented language. Placeholders {x} and sentinels \u{1}n\u{2} are kept.
    static func translate(_ lang: String, _ text: String) -> String {
        guard let d = data, let ld = d.langs[lang] else { return text }
        let cs = Array(text.unicodeScalars)
        // hasLower: lowercase letters outside the placeholders.
        var hasLower = false
        var p = 0
        while p < cs.count {
            if cs[p] == "{", let end = placeholderEnd(cs, p) { p = end; continue }
            if isLl(cs[p]) { hasLower = true; break }
            p += 1
        }
        var out = ""
        var buf: [Unicode.Scalar] = []
        func flush() {
            if !buf.isEmpty { out += plain(lang, buf, hasLower, ld.lex) }
            buf = []
        }
        var i = 0
        outer: while i < cs.count {
            let c = cs[i]
            if c == "{", let end = placeholderEnd(cs, i) {
                flush()
                out += str(cs[i..<end])
                i = end
                continue
            }
            if c == "\u{1}", let end = cs[(i + 1)...].firstIndex(of: "\u{2}") {
                flush()
                out += str(cs[i...end])
                i = end + 1
                continue
            }
            if i == 0 || !isWord(cs[i - 1]) {
                for k in d.keep where i + k.count <= cs.count && Array(cs[i..<(i + k.count)]) == k {
                    if i + k.count < cs.count && isWord(cs[i + k.count]) { continue }
                    flush()
                    out += str(k[...])
                    i += k.count
                    continue outer
                }
            }
            buf.append(c)
            i += 1
        }
        flush()
        return out
    }

    /// End index (exclusive) of a {placeholder} starting at i (ASCII word characters), else nil.
    private static func placeholderEnd(_ cs: [Unicode.Scalar], _ i: Int) -> Int? {
        var j = i + 1
        while j < cs.count && isAsciiWord(cs[j]) { j += 1 }
        return j > i + 1 && j < cs.count && cs[j] == "}" ? j + 1 : nil
    }
}
