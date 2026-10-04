// 对齐 novel-reader/app/src/main/java/com/example/source/AuthenticationState.kt（8 行）

import Foundation

enum AuthenticationState: Equatable {
    case notRequired
    case required
    case authenticated
    case expired
}
