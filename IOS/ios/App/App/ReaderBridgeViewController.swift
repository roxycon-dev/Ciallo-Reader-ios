import UIKit
import Capacitor

@objc(ReaderBridgeViewController)
class ReaderBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(TtsPlugin())
        bridge?.registerPluginInstance(OrientationPlugin())
        bridge?.registerPluginInstance(ReaderKeychainPlugin())
        bridge?.registerPluginInstance(ReaderDevicePlugin())
        bridge?.registerPluginInstance(ReaderDocumentsPlugin())
        bridge?.registerPluginInstance(ReaderWebsitePlugin())
        bridge?.registerPluginInstance(ReaderTransferPlugin())
        bridge?.registerPluginInstance(ReaderTransferArchivePlugin())
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        OrientationPlugin.orientationMask
    }
}
