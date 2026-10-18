import SwiftUI
import UIKit
import WebKit

/// Hosts the bundled HTML game full screen. The page handles safe areas itself
/// (viewport-fit=cover + env(safe-area-inset-*)), so the web view runs edge to edge.
/// The game posts haptic cues to `window.webkit.messageHandlers.haptic`; the
/// coordinator plays them on the Taptic Engine.
struct GameView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(context.coordinator, name: "haptic")

        let web = WKWebView(frame: .zero, configuration: config)
        let bg = UIColor(red: 0.027, green: 0.071, blue: 0.110, alpha: 1)
        web.isOpaque = false
        web.backgroundColor = bg
        web.scrollView.backgroundColor = bg
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.pinchGestureRecognizer?.isEnabled = false
        web.allowsLinkPreview = false
        web.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) {
            // Lets Safari > Develop attach to the game for debugging.
            web.isInspectable = true
        }

        if let url = Bundle.main.url(forResource: "irontide", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "haptic")
    }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        private let light = UIImpactFeedbackGenerator(style: .light)
        private let medium = UIImpactFeedbackGenerator(style: .medium)
        private let heavy = UIImpactFeedbackGenerator(style: .heavy)
        private let notify = UINotificationFeedbackGenerator()
        private var last = Date.distantPast

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let kind = message.body as? String else { return }
            // Rapid-fire battles can send many cues; don't buzz continuously.
            let now = Date()
            if kind == "light" && now.timeIntervalSince(last) < 0.06 { return }
            last = now
            switch kind {
            case "light": light.impactOccurred()
            case "medium": medium.impactOccurred()
            case "heavy": heavy.impactOccurred()
            case "success": notify.notificationOccurred(.success)
            case "error": notify.notificationOccurred(.error)
            default: light.impactOccurred()
            }
        }
    }
}
