import UIKit
import Capacitor

@objc(ReaderDevicePlugin)
public class ReaderDevicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ReaderDevicePlugin"
    public let jsName = "ReaderDevice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setScreenAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeClipboard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "volumeStats", returnType: CAPPluginReturnPromise)
    ]

    @objc func setScreenAwake(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else {
            call.reject("enabled is required")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = enabled
            call.resolve()
        }
    }

    @objc func writeClipboard(_ call: CAPPluginCall) {
        guard let text = call.getString("text") else {
            call.reject("text is required")
            return
        }
        DispatchQueue.main.async {
            UIPasteboard.general.string = text
            call.resolve()
        }
    }

    @objc func shareText(_ call: CAPPluginCall) {
        guard let text = call.getString("text") else {
            call.reject("text is required")
            return
        }
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController, host.presentedViewController == nil else {
                call.reject("当前无法打开系统分享", "SHARE_UNAVAILABLE")
                return
            }
            let activity = UIActivityViewController(activityItems: [text], applicationActivities: nil)
            activity.title = call.getString("title")
            if let popover = activity.popoverPresentationController {
                popover.sourceView = host.view
                popover.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 1, height: 1)
                popover.permittedArrowDirections = []
            }
            activity.completionWithItemsHandler = { _, _, _, error in
                if let error = error { call.reject(error.localizedDescription) }
                else { call.resolve() }
            }
            host.present(activity, animated: true)
        }
    }

    @objc func volumeStats(_ call: CAPPluginCall) {
        do {
            let url = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask,
                                                  appropriateFor: nil, create: true)
            let values = try url.resourceValues(forKeys: [.volumeAvailableCapacityKey, .volumeTotalCapacityKey])
            guard let free = values.volumeAvailableCapacity, let total = values.volumeTotalCapacity else {
                call.reject("无法读取设备存储空间", "STORAGE_STATS_UNAVAILABLE")
                return
            }
            call.resolve(["freeBytes": free, "totalBytes": total])
        } catch { call.reject(error.localizedDescription, "STORAGE_STATS_UNAVAILABLE") }
    }
}
