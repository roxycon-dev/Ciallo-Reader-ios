// 对齐 god/GodMomentSettingsStore.kt（71 行）+ GodMomentViewModel.kt（60 行）
// 设置项（排行榜风格 / 末页提示胶囊 / 陀螺仪视差）与 ViewModel。
// DataStore → UserDefaults（同键名）；Flow → @Published（统一兜底：读失败返回默认值）。

import Foundation
import SwiftUI

// MARK: - GodMomentSettingsStore

@MainActor
final class GodMomentSettingsStore: ObservableObject {
    /// 神回专属偏好域（与既有 SharedPreferences 体系并存，互不干扰）。
    /// DataStore 名 god_moment_prefs → UserDefaults 前缀 god_moment_prefs.
    private static let domain = "god_moment_prefs."
    private enum Keys {
        static let rankingStyle = GodMomentSettingsStore.domain + "ranking_style"
        static let hintCapsule = GodMomentSettingsStore.domain + "last_page_hint"
        static let gyroParallax = GodMomentSettingsStore.domain + "gyro_parallax"
    }

    private let d = UserDefaults.standard

    /// 统一兜底：读失败返回默认值，不允许把 App 带崩——神回只是附加功能。
    @Published var rankingStyle: GodRankingStyle = .podium
    @Published var hintCapsuleEnabled: Bool = true
    @Published var gyroParallaxEnabled: Bool = true

    init() {
        rankingStyle = GodRankingStyle.of(d.string(forKey: Keys.rankingStyle))
        hintCapsuleEnabled = d.object(forKey: Keys.hintCapsule) as? Bool ?? true
        gyroParallaxEnabled = d.object(forKey: Keys.gyroParallax) as? Bool ?? true
    }

    func rankingStyleOnce() -> GodRankingStyle { rankingStyle }

    func setRankingStyle(_ style: GodRankingStyle) {
        rankingStyle = style
        d.set(style.rawValue, forKey: Keys.rankingStyle)
    }

    func setHintCapsuleEnabled(_ enabled: Bool) {
        hintCapsuleEnabled = enabled
        d.set(enabled, forKey: Keys.hintCapsule)
    }

    func setGyroParallaxEnabled(_ enabled: Bool) {
        gyroParallaxEnabled = enabled
        d.set(enabled, forKey: Keys.gyroParallax)
    }
}

// MARK: - GodMomentViewModel
//
// 排行榜（统计页/全屏页）与编辑窗口监听同一个 all：增删改后两处自动刷新，
// 不存在"改了排行榜不更新"的窗口。

@MainActor
final class GodMomentViewModel: ObservableObject {
    let repository = GodMomentRepository.shared
    let settings = GodMomentSettingsStore()

    /// 全量神回（多处共享）
    @Published private(set) var all: [GodMomentEntity] = []

    private var observer: NSObjectProtocol?

    init() {
        all = repository.moments
        observer = NotificationCenter.default.addObserver(forName: dbChangedNotification, object: nil, queue: .main) { [weak self] _ in
            self?.all = self?.repository.moments ?? []
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    /// 某本书的神回（chapterId → 实体），书籍详情页用
    func chapterMap(bookId: String) -> [String: GodMomentEntity] {
        guard !bookId.isEmpty else { return [:] }
        let list = (try? repository.dao.forBookSync(bookId: bookId)) ?? []
        return Dictionary(uniqueKeysWithValues: list.map { ($0.chapterId, $0) })
    }

    func save(_ entity: GodMomentEntity, onDone: @escaping (Int64) -> Void = { _ in }) {
        let id = repository.save(entity)
        onDone(id)
    }

    func delete(id: Int64) {
        repository.delete(id: id)
    }

    func deleteForBook(bookId: String) {
        repository.deleteForBook(bookId: bookId)
    }

    func deleteForChapter(bookId: String, chapterId: String) {
        repository.deleteForChapter(bookId: bookId, chapterId: chapterId)
    }
}
