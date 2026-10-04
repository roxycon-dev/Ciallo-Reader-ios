// 对齐 download/DownloadTaskEntity.kt（30 行）+ DownloadState.kt（20 行）+ DownloadRequest.kt（11 行）+ DownloadProgressBroadcaster.kt（23 行）

import Foundation

// MARK: - DownloadTaskEntity.kt

/// 任务实体。id = sourceId + 原始资源 ID 的长度前缀复合键。
struct DownloadTaskEntity: Identifiable, Hashable {
    var id: String
    var sourceId: String
    var title: String
    var author: String
    var coverUrl: String
    var downloadUrl: String
    var format: String
    var status: String = DownloadStatus.pending.rawValue
    var downloadedBytes: Int64 = 0
    var totalBytes: Int64 = 0
    var filePath: String?
    var errorMessage: String?
    var updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)

    var state: DownloadStatus { DownloadStatus(rawValue: status) ?? .pending }
}

// MARK: - DownloadStatus（DownloadTaskEntity.kt 内枚举）

enum DownloadStatus: String {
    case pending
    case downloading
    case paused
    case success
    case error
}

// MARK: - DownloadState.kt

/// 下载状态密封类：Idle / Pending / Downloading / Paused / Success / Error。
enum DownloadState: Equatable {
    case idle
    case pending
    case downloading(progress: Double, bytesPerSecond: Int64, remainingBytes: Int64)
    case paused
    case success
    case error(String)
}

// MARK: - DownloadRequest.kt

/// 请求 DTO。
struct DownloadRequest: Hashable {
    var bookId: String
    var title: String
    var author: String
    var sourceId: String
    var downloadUrl: String
    var format: String
    var coverUrl: String
}

// MARK: - DownloadProgressBroadcaster.kt

/// 进度广播：全 App 订阅（对应 Kotlin StateFlow<Map<String, DownloadState>>）。
@MainActor
final class DownloadProgressBroadcaster: ObservableObject {
    static let shared = DownloadProgressBroadcaster()
    @Published private(set) var states: [String: DownloadState] = [:]

    private init() {}

    func update(taskId: String, _ state: DownloadState) {
        states[taskId] = state
    }

    func remove(taskId: String) {
        states.removeValue(forKey: taskId)
    }
}
