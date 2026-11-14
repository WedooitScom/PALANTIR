import AppKit
import UniformTypeIdentifiers

/// "Ta musique": the location of a local audio file chosen by the user. Only the location is kept
/// (UserDefaults: path + bookmark, so a renamed or moved file is still found); the file itself is
/// never copied. The embedded server reads it for the page (GET /user-music).
final class UserMusic {
    private let defaults = UserDefaults.standard
    private let pathKey = "userMusicPath"
    private let bookmarkKey = "userMusicBookmark"

    /// Current path, refreshed from the bookmark when the file moved. nil when none or gone.
    var path: String? {
        if let data = defaults.data(forKey: bookmarkKey) {
            var stale = false
            if let url = try? URL(resolvingBookmarkData: data, options: [.withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale),
               FileManager.default.isReadableFile(atPath: url.path) {
                if stale || url.path != defaults.string(forKey: pathKey) { remember(url) }
                return url.path
            }
        }
        if let p = defaults.string(forKey: pathKey), FileManager.default.isReadableFile(atPath: p) { return p }
        return nil
    }

    var name: String? { path.map { URL(fileURLWithPath: $0).lastPathComponent } }

    /// NSOpenPanel limited to the formats WebKit plays. Completion with the chosen URL (not yet remembered).
    func choose(completion: @escaping (URL?) -> Void) {
        let panel = NSOpenPanel()
        panel.title = "Choisir ta musique"
        panel.message = "Le fichier reste à sa place : la carte ne mémorise que son emplacement."
        panel.prompt = "Choisir"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        var types: [UTType] = [.mp3, .mpeg4Audio, .wav, .aiff]
        if let aac = UTType(filenameExtension: "aac") { types.append(aac) }
        panel.allowedContentTypes = types
        NSApp.activate(ignoringOtherApps: true)
        panel.begin { response in
            completion(response == .OK ? panel.url : nil)
        }
    }

    func remember(_ url: URL) {
        defaults.set(url.path, forKey: pathKey)
        if let data = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
            defaults.set(data, forKey: bookmarkKey)
        }
    }

    func clear() {
        defaults.removeObject(forKey: pathKey)
        defaults.removeObject(forKey: bookmarkKey)
    }
}
