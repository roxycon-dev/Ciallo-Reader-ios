import UIKit
import Capacitor

/// 屏幕方向锁（对应 Android `Activity.requestedOrientation`）。
///
/// Android 侧落点 `MainActivity.kt:398-405`：
/// ```kotlin
/// DisposableEffect(orientationLock) {
///     requestedOrientation = when (orientationLock) {
///         1 -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
///         2 -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
///         else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
///     }
///     onDispose {}
/// }
/// ```
///
/// ⚠️ 为什么必须自写插件：iOS **没有**公开的「按值锁方向」API。
/// `Info.plist` 的 `UISupportedInterfaceOrientations` 是**静态**声明，
/// 运行时改它必须走 `UIWindowScene.requestGeometryUpdate(_:)`（iOS 16+，
/// 本工程 deployment target 正是 iOS 16，见 `CapApp-SPM/Package.swift`）。
/// `@capacitor/device` 只提供 `getInfo()`，没有方向控制能力。
///
/// 三个分支逐条对应 Kotlin：
///   mode 0 → `.all`（= `SCREEN_ORIENTATION_UNSPECIFIED`，跟随系统）
///   mode 1 → `.portrait`（**不含** upsideDown，与 Android PORTRAIT 一致）
///   mode 2 → `.landscape`（左右双向，与 Android LANDSCAPE 一致）
///
/// ⚠️ 已知平台差异：iPhone 物理上没有 landscapePrimary/iPad 才有，
/// 且 iPadOS 的多任务（Slide Over / Stage Manager）下系统会**强制**
/// 支持全部方向，方向锁可能被系统忽略 —— 这是 iOS 的平台约束，
/// 已登记在 `docs/PARITY_EXCEPTIONS.md`，不在插件层静默假装成功。
@objc(OrientationPlugin)
public class OrientationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OrientationPlugin"
    public let jsName = "Orientation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "lock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLock", returnType: CAPPluginReturnPromise)
    ]

    /// 与 Android `orientationLock` 设置项同一套刻度（0/1/2）。
    private static var currentLock: Int = 0
    static var orientationMask: UIInterfaceOrientationMask {
        switch currentLock {
        case 1: return .portrait
        case 2: return .landscape
        default: return UIDevice.current.userInterfaceIdiom == .pad ? .all : .allButUpsideDown
        }
    }

    /// 把 `UIWindowScene.GeometryPreferences.iOS(interfaceOrientations:)` 应用上去。
    /// 返回 false 表示拿不到 windowScene —— 由调用方 reject，**不假装成功**。
    private func apply(_ mask: UIInterfaceOrientationMask, call: CAPPluginCall?) -> Bool {
        guard let scene = bridge?.viewController?.view.window?.windowScene else {
            call?.reject("ORIENTATION_SCENE_UNAVAILABLE",
                         "无法获取 UIWindowScene：方向锁没有生效（Android `requestActivity` 一定有 Activity 上下文）。")
            return false
        }
        let preferences = UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: mask)
        bridge?.viewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        scene.requestGeometryUpdate(preferences) { error in
            // 异步错误只能记日志：调用早已 resolve，没有 caller 可reject 了。
            // iPad 多任务下系统拒绝方向锁正是走这条路径（见类注释「已知平台差异」）。
            NSLog("[OrientationPlugin] requestGeometryUpdate 失败: \(error.localizedDescription)")
        }
        return true
    }

    @objc func lock(_ call: CAPPluginCall) {
        let mode = call.getInt("mode") ?? 0
        guard (0...2).contains(mode) else {
            call.reject("Invalid orientation mode")
            return
        }
        DispatchQueue.main.async {
            let previous = OrientationPlugin.currentLock
            OrientationPlugin.currentLock = mode
            if self.apply(OrientationPlugin.orientationMask, call: call) {
                call.resolve()
            } else {
                OrientationPlugin.currentLock = previous
            }
        }
    }

    @objc func getLock(_ call: CAPPluginCall) {
        call.resolve(["mode": OrientationPlugin.currentLock])
    }
}
