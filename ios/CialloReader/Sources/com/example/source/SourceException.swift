// 对齐 novel-reader/app/src/main/java/com/example/source/SourceException.kt（9 行）

import Foundation

/// Kotlin 密封类 → Swift enum。
/// 注：Kotlin 的 NetworkError/Unknown 携带 `throwable: Throwable?`（仅用于 Android 日志），
/// Swift 枚举关联值无默认参数且 zlibrary/js 等外部引用按单参构造，故省略 throwable。
enum SourceException: Error, LocalizedError {
    case loginRequired
    case networkError(String)
    case parseError(String)
    case bookNotFound
    case unknown(String)
    /// iOS 侧补充（skeleton 沿用）：协程取消（Kotlin 由 CancellationException 直接重抛表达）
    case cancelled

    var errorDescription: String? {
        switch self {
        case .loginRequired: return "需要登录后继续操作"
        case .networkError(let m): return m
        case .parseError(let m): return m
        case .bookNotFound: return "未能找到对应图书"
        case .unknown(let m): return m
        case .cancelled: return "已取消"
        }
    }
}
