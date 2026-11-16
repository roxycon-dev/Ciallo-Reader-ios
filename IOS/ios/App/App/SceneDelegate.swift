import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var privacyShield: UIView?

    // Install synchronously before UIKit captures the app-switcher snapshot.
    // This does not depend on a suspended WebView receiving a JS lifecycle event.
    func sceneWillResignActive(_ scene: UIScene) {
        guard let window = window, privacyShield == nil else { return }
        let shield = UIView(frame: window.bounds)
        shield.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        shield.backgroundColor = .systemBackground
        let label = UILabel()
        label.text = "Ciallo 阅读"
        label.textColor = .secondaryLabel
        label.translatesAutoresizingMaskIntoConstraints = false
        shield.addSubview(label)
        NSLayoutConstraint.activate([label.centerXAnchor.constraint(equalTo: shield.centerXAnchor), label.centerYAnchor.constraint(equalTo: shield.centerYAnchor)])
        window.addSubview(shield)
        privacyShield = shield
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        privacyShield?.removeFromSuperview()
        privacyShield = nil
    }

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // UIKit normally created the storyboard window already. Keep it so a
        // second bridge does not open the same database or register listeners twice.
        if window == nil {
            window = UIWindow(windowScene: windowScene)
            window?.rootViewController = ReaderBridgeViewController()
            window?.makeKeyAndVisible()
        }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        for context in connectionOptions.urlContexts { ReaderTransferOpenInbox.accept(context.url) }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts { ReaderTransferOpenInbox.accept(context.url) }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
