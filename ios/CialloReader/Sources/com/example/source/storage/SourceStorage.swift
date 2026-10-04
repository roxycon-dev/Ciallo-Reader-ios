// 对齐 novel-reader/app/src/main/java/com/example/source/storage/SourceStorage.kt（11 行）

import Foundation

protocol SourceStorage: AnyObject {
    func saveSourceState(sourceId: String, enabled: Bool) async
    func getSourceStates() async -> [String: Bool]
    func saveActiveSourceId(sourceId: String) async
    func getActiveSourceId() async -> String?
    func saveCustomSourceJson(sourceId: String, jsonContent: String) async throws
    func getCustomSourceJsons() async throws -> [String: String]
    func removeCustomSourceJson(sourceId: String) async
}
