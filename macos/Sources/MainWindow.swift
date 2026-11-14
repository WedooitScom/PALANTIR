import AppKit
import WebKit

/// The map window: a WKWebView on http://127.0.0.1:<port>, with a parchment waiting screen
/// (and a retry loop) until the server answers. Closing it only hides it.
final class MainWindowController: NSWindowController, WKNavigationDelegate, NSWindowDelegate {
    private let webView: WKWebView
    private var retryTimer: Timer?
    private var showingMap = false
    /// Called at each retry so the server manager can (re)start the server if needed.
    var onRetry: (() -> Void)?
    /// Text shown under the waiting title (error, missing Node…).
    var statusText: () -> String? = { nil }

    init() {
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = [] // let the map play its sounds
        config.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsMagnification = true
        webView.setValue(false, forKey: "drawsBackground")

        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1400, height: 900),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "Terre du Milieu"
        window.minSize = NSSize(width: 700, height: 480)
        window.isReleasedWhenClosed = false
        window.backgroundColor = NSColor(red: 0.13, green: 0.10, blue: 0.07, alpha: 1)
        window.collectionBehavior = [.fullScreenPrimary]
        window.contentView = webView
        window.center()
        // Remembers position and size between launches (default 1400x900, centred).
        window.setFrameAutosaveName("TerreDuMilieuMainWindow")
        super.init(window: window)
        window.delegate = self
        webView.navigationDelegate = self
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show() {
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if !showingMap && retryTimer == nil { startWaiting() }
    }

    // MARK: - waiting screen / retry

    func startWaiting() {
        showingMap = false
        renderWaiting()
        retryTimer?.invalidate()
        retryTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in self?.tick() }
        tick()
    }

    private func tick() {
        onRetry?()
        ServerManager.ping { [weak self] ok in
            guard let self, !self.showingMap else { return }
            if ok {
                self.retryTimer?.invalidate()
                self.retryTimer = nil
                self.showingMap = true
                self.webView.load(URLRequest(url: AppPaths.baseURL))
            } else {
                self.renderWaiting()
            }
        }
    }

    private var lastWaitingHTML = ""

    private func renderWaiting() {
        let detail = statusText() ?? "Le serveur de la carte démarre sur le port \(AppPaths.port)…"
        let html = """
        <!doctype html><html lang="fr"><meta charset="utf-8"><style>
        html,body{margin:0;height:100%;background:#211a12;color:#3b2a17;font:16px/1.5 Georgia,serif}
        .wrap{height:100%;display:flex;align-items:center;justify-content:center}
        .card{background:#ebd7a7;border:4px solid #7a5328;box-shadow:0 0 0 4px #211a12,0 0 0 8px #a67c45;
          padding:28px 36px;max-width:520px;text-align:center;image-rendering:pixelated}
        h1{margin:0 0 8px;font-size:24px;letter-spacing:.5px}
        p{margin:6px 0}
        .fire{font-size:30px;animation:f 1s steps(2) infinite}
        @keyframes f{50%{opacity:.4}}
        </style><body><div class="wrap"><div class="card">
        <div class="fire">🔥</div><h1>La carte se déploie…</h1>
        <p>\(escape(detail))</p><p style="opacity:.7;font-size:13px">Nouvelle tentative chaque seconde.</p>
        </div></div></body></html>
        """
        guard html != lastWaitingHTML else { return }
        lastWaitingHTML = html
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if showingMap { lastWaitingHTML = ""; startWaiting() }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if showingMap { lastWaitingHTML = ""; startWaiting() }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        lastWaitingHTML = ""
        startWaiting()
    }

    /// Links leaving the local map open in the default browser.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, let host = url.host,
           url.scheme?.hasPrefix("http") == true, host != "127.0.0.1", host != "localhost" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}
