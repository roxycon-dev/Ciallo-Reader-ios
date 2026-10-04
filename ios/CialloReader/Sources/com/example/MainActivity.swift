import SwiftUI

// MARK: - 应用入口（MainActivity.kt 对应物）
//
// 单入口 + 四 Tab：书库(0)/书架(1)/统计(2)/设置(3)。
// 开屏 → 首启动引导 → 隐私 PIN → 主界面。

@main
struct CialloReaderApp: App {
    @StateObject private var theme = AppTheme.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.appTheme, theme)
                .environmentObject(theme)
                .tint(theme.primary)
                .preferredColorScheme(theme.preferredColorScheme)
                .overlay(EyeProtectionOverlay())
        }
    }
}

/// 护眼滤光层（全局覆盖，不拦截触摸）。
struct EyeProtectionOverlay: View {
    @Environment(\.appTheme) private var theme

    var body: some View {
        Group {
            if theme.eyeProtection {
                Rectangle()
                    .fill(Color(hex: 0xFFB25C).opacity(0.16 + theme.eyeWarmth * 0.24))
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            }
        }
    }
}

// MARK: - 根视图

struct RootView: View {
    enum Phase { case splash, onboarding, main }

    @AppStorage("onboarding_completed") private var onboardingCompleted = false
    @State private var phase: Phase = .splash
    @StateObject private var privacy = PrivacyManager.shared

    var body: some View {
        ZStack {
            switch phase {
            case .splash:
                SplashScreen { 
                    phase = onboardingCompleted ? .main : .onboarding
                }
            case .onboarding:
                OnboardingScreen {
                    onboardingCompleted = true
                    phase = .main
                }
            case .main:
                MainTabView()
                    .overlay {
                        if privacy.lockRequired {
                            PrivacyPinOverlay()
                        }
                    }
            }
        }
        .overlay(AppSnackbarHost())
    }
}

// MARK: - 四 Tab 主界面

struct MainTabView: View {
    @State private var selection = 0
    @StateObject private var libraryVM = LibraryViewModel()
    @StateObject private var homeVM = HomeViewModel()

    private let tabs: [(icon: String, title: String)] = [
        ("book.closed", "书库"),
        ("books.vertical", "书架"),
        ("chart.bar", "统计"),
        ("gearshape", "设置"),
    ]

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                switch selection {
                case 0: LibraryScreen(viewModel: libraryVM)
                case 1: HomeScreen(viewModel: homeVM)
                case 2: StatisticsScreen()
                default: SettingsTabScreen()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            AppTabBar(selection: $selection, tabs: tabs)
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
    }
}

// MARK: - 开屏（SplashScreen.kt：随机名言 + 海报，最长 900ms）

struct SplashScreen: View {
    let onComplete: () -> Void
    @State private var quoteVisible = false

    private static let quotes = [
        "读书破万卷，下笔如有神。",
        "腹有诗书气自华。",
        "书山有路勤为径，学海无涯苦作舟。",
        "旧书不厌百回读，熟读深思子自知。",
        "问渠那得清如许，为有源头活水来。",
        "立身以立学为先，立学以读书为本。",
    ]

    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()
            VStack(spacing: 18) {
                Image("AppLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 160)
                    .consistentShadow(radius: 18, y: 8, opacity: 0.18)
                Text(Self.quotes.randomElement() ?? "")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
                    .opacity(quoteVisible ? 1 : 0)
            }
        }
        .onAppear {
            withAnimation(.easeIn(duration: 0.35).delay(0.15)) { quoteVisible = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { onComplete() }
        }
    }
}

// MARK: - 首启动引导（OnboardingScreen.kt：分页 + 徽章）

struct OnboardingScreen: View {
    let onComplete: () -> Void
    @State private var page = 0

    private let slides: [(icon: String, title: String, detail: String)] = [
        ("books.vertical", "你的书架", "导入 TXT / EPUB / MOBI / CBZ，打造随身书架"),
        ("magnifyingglass", "多源聚合搜索", "Z-Library / MangaDex / Legado 书源，一站搜全网"),
        ("icloud.and.arrow.down", "离线下载", "断点续传下载整本，无网也能读"),
        ("heart", "神回标记", "读到神回那一话？画个心，永远记住它"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            TabView(selection: $page) {
                ForEach(Array(slides.enumerated()), id: \.offset) { index, slide in
                    VStack(spacing: 20) {
                        Image(systemName: slide.icon)
                            .font(.system(size: 56, weight: .light))
                            .foregroundStyle(AppTheme.shared.primary)
                            .frame(height: 90)
                        Text(slide.title).font(.system(size: 24, weight: .bold))
                        Text(slide.detail)
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                    }
                    .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .always))
            Spacer()
            Button(page == slides.count - 1 ? "开始阅读" : "跳过") { onComplete() }
                .font(.system(size: 15, weight: .semibold))
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(Capsule().fill(AppTheme.shared.primary))
                .foregroundStyle(AppTheme.shared.primary.onColor())
                .padding(.horizontal, 32)
                .padding(.bottom, 40)
        }
    }
}
