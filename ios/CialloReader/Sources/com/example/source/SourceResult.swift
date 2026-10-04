// 对齐 novel-reader/app/src/main/java/com/example/source/SourceResult.kt（18 行）

import Foundation

enum SourceResult<T> {
    case success(T)
    case error(SourceException)

    func map<R>(_ transform: (T) -> R) -> SourceResult<R> {
        switch self {
        case .success(let d): return .success(transform(d))
        case .error(let e): return .error(e)
        }
    }

    func getOrNull() -> T? {
        if case .success(let d) = self { return d }
        return nil
    }

    /// iOS 侧补充（skeleton 沿用）：异常透出（对应 Kotlin 直接 throw 的场景）
    func getOrThrow() throws -> T {
        switch self {
        case .success(let d): return d
        case .error(let e): throw e
        }
    }
}
