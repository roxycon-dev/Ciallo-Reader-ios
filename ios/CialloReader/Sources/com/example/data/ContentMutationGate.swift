import Foundation

// 对齐 novel-reader/app/src/main/java/com/example/data/ContentMutationGate.kt（9 行）
// Lock order: download controls -> worker task lock -> content gate -> Room transaction.

final class ContentMutationGate {
    /// 单例镜像 Kotlin `internal object`（Swift 侧全局访问点）。
    static let shared = ContentMutationGate()

    /// Kotlin 为协程 Mutex；Swift 用串行队列模拟 lock/unlock 语义。
    private let queue = DispatchQueue(label: "com.example.data.ContentMutationGate")
    /// 队列上的互斥信号：0 = 未锁，1 = 已锁。
    private let semaphore = DispatchSemaphore(value: 1)

    /// @Volatile var epoch（private set）
    private let _epochLock = NSLock()
    private var _epoch: Int64 = 0
    var epoch: Int64 {
        _epochLock.lock(); defer { _epochLock.unlock() }
        return _epoch
    }

    func lock() { semaphore.wait() }
    func unlock() { semaphore.signal() }

    /// 同步在互斥区内执行（等价 `mutex.withLock { }`）。
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock(); defer { unlock() }
        return try body()
    }

    func invalidatePendingWrites() { epoch += 1 } // Caller holds mutex.
}
