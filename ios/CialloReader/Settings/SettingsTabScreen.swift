import SwiftUI
import UniformTypeIdentifiers

// MARK: - 设置页（ui/SettingsTabScreen.kt 对应物）
// 主题色 / 明暗 / 护眼 / 触觉 / 画质 / 隐私 PIN / 存储 / 书源 / 备份 / 关于。

struct SettingsTabScreen: View {
    @ObservedObject private var theme = AppTheme.shared
    @StateObject private var privacy = PrivacyManager.shared

    @State private var showSources = false
    @State private var showCache = false
    @State private var showPrivacy = false
    @State private var showBackup = false
    @State private var backupUrl: URL?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("设置")
                        .font(.system(size: 26, weight: .bold))
                        .padding(.top, DT.spLG)

                    settingsCard(title: "外观") {
                        colorRow
                        darkModeRow
                        eyeRow
                        qualityRow
                    }
                    settingsCard(title: "交互") {
                        hapticRow
                        if privacy.isEnabled {
                            row(icon: "lock.fill", tint: .orange, title: "关闭隐私锁") { privacy.disable() }
                        } else {
                            row(icon: "lock", tint: .secondary, title: "隐私锁（PIN）") { showPrivacy = true }
                        }
                    }
                    settingsCard(title: "书源与数据") {
                        row(icon: "square.grid.2x2", tint: theme.primary, title: "书源管理") { showSources = true }
                        row(icon: "internaldrive", tint: theme.primary, title: "缓存管理") { showCache = true }
                        row(icon: "arrow.up.doc", tint: theme.primary, title: "导出备份") { Task { await exportBackup() } }
                        row(icon: "arrow.down.doc", tint: theme.primary, title: "导入备份") { showBackup = true }
                    }
                    settingsCard(title: "关于") {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Image("AppLogo").resizable().scaledToFit().frame(width: 40, height: 34)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Ciallo阅读 · EASYREADER")
                                        .font(.system(size: 15, weight: .semibold))
                                    Text("iOS 版 1.2.0 (201) · 与 Android 版同源同构")
                                        .font(.system(size: 11)).foregroundStyle(.secondary)
                                }
                            }
                            Text("本地优先 · 多源聚合 · 神回标记")
                                .font(.system(size: 11)).foregroundStyle(.tertiary)
                        }
                    }
                }
                .padding(.horizontal, DT.spPage)
                .padding(.bottom, 130)
            }
            .background(Color(.systemBackground))
        }
        .sheet(isPresented: $showSources) { SourceManagementScreen() }
        .sheet(isPresented: $showCache) { CacheManagementScreen() }
        .sheet(isPresented: $showPrivacy) { PrivacySetupSheet() }
        .fileImporter(isPresented: $showBackup, allowedContentTypes: [.zip, .data]) { result in
            if case .success(let urls) = result, let url = urls.first {
                Task {
                    do {
                        try await BackupManager.importBackup(from: url)
                        AppToastCenter.shared.show("备份已恢复", kind: .success)
                    } catch {
                        AppToastCenter.shared.showError("恢复失败：\(error.localizedDescription)")
                    }
                }
            }
        }
    }

    private func settingsCard<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary)
                .padding(.bottom, 6)
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: DT.rLG).fill(Color.primary.opacity(0.045)))
    }

    private var colorRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("主题色").font(.system(size: 14))
            HStack(spacing: 10) {
                ForEach(0..<5, id: \.self) { i in
                    Circle()
                        .fill(basePrimaryColors[i])
                        .frame(width: 30, height: 30)
                        .overlay(Circle().strokeBorder(theme.colorPrimaryIndex == i ? Color.primary : .clear, lineWidth: 2))
                        .onTapGesture {
                            HapticsGate.tick()
                            withAnimation(AppMotion.easeOutTheme) {
                                theme.colorPrimaryIndex = i
                                theme.colorSecondaryIndex = i
                            }
                        }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var darkModeRow: some View {
        HStack {
            Text("深色模式").font(.system(size: 14))
            Spacer()
            Picker("", selection: Binding(
                get: { theme.darkMode ?? false },
                set: { theme.darkMode = $0 }
            )) {
                Text("浅色").tag(false)
                Text("深色").tag(true)
            }
            .pickerStyle(.segmented)
            .frame(width: 160)
        }
    }

    private var eyeRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("护眼模式", isOn: Binding(get: { theme.eyeProtection }, set: { theme.eyeProtection = $0 }))
                .font(.system(size: 14))
            if theme.eyeProtection {
                HStack {
                    Text("暖色强度").font(.system(size: 12)).foregroundStyle(.secondary)
                    Slider(value: $theme.eyeWarmth, in: 0...1).tint(theme.primary)
                }
            }
        }
    }

    private var qualityRow: some View {
        HStack {
            Text("渲染画质").font(.system(size: 14))
            Spacer()
            SegmentedPillSelector(options: RenderQuality.allCases, label: { $0.rawValue },
                                  selection: $theme.renderQuality)
        }
    }

    private var hapticRow: some View {
        Toggle("触觉反馈", isOn: Binding(get: { theme.hapticsEnabled }, set: { theme.hapticsEnabled = $0 }))
            .font(.system(size: 14))
    }

    private func row(icon: String, tint: Color, title: String, action: @escaping () -> Void) -> some View {
        Button {
            HapticsGate.light()
            action()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 15)).foregroundStyle(tint)
                Text(title).font(.system(size: 14)).foregroundStyle(.primary)
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(.tertiary)
            }
            .padding(.vertical, 10)
        }
    }

    private func exportBackup() async {
        do {
            let url = try await BackupManager.exportBackup()
            AppToastCenter.shared.show("备份已导出：\(url.lastPathComponent)", kind: .success)
        } catch {
            AppToastCenter.shared.showError("导出失败：\(error.localizedDescription)")
        }
    }
}

// MARK: - 隐私锁设置（PrivacyWindows：PIN 圆点 + 错误抖动）

struct PrivacySetupSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var pin = ""
    @State private var confirm = ""
    @State private var stage = 0
    @State private var shake: CGFloat = 0

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Text(stage == 0 ? "设置 PIN（4-8 位数字）" : "再输一次确认")
                    .font(.system(size: 15, weight: .semibold))
                PinDots(count: pin.count, shakeOffset: shake)
                NumericKeypad { key in
                    input(key)
                }
                Spacer()
            }
            .padding(.top, 40)
            .navigationTitle("隐私锁")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }

    private func input(_ key: String) {
        HapticsGate.tick()
        if key == "delete" {
            if stage == 0 { pin = String(pin.dropLast()) } else { confirm = String(confirm.dropLast()) }
            return
        }
        if stage == 0 {
            guard pin.count < 8 else { return }
            pin += key
            if pin.count >= 4 { stage = 1 }
        } else {
            guard confirm.count < 8 else { return }
            confirm += key
            if confirm.count == pin.count {
                Task { await verify() }
            }
        }
    }

    private func verify() async {
        if pin == confirm {
            try? PrivacyManager.shared.enable(pin: pin)
            HapticsGate.success()
            AppToastCenter.shared.show("隐私锁已开启", kind: .success)
            dismiss()
        } else {
            // 三次递减摆动后归零（PinDots 错误动画语义）
            withAnimation(.easeInOut(duration: 0.4)) { shake = 8 }
            try? await Task.sleep(nanoseconds: 400_000_000)
            withAnimation(.easeInOut(duration: 0.3)) { shake = -5 }
            try? await Task.sleep(nanoseconds: 300_000_000)
            withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) { shake = 0 }
            HapticsGate.error()
            confirm = ""
        }
    }
}

struct PinDots: View {
    let count: Int
    let shakeOffset: CGFloat

    var body: some View {
        HStack(spacing: 14) {
            ForEach(0..<8, id: \.self) { i in
                Circle()
                    .fill(i < count ? AppTheme.shared.primary : Color.primary.opacity(0.15))
                    .frame(width: 12, height: 12)
            }
        }
        .offset(x: shakeOffset)
    }
}

struct NumericKeypad: View {
    var onKey: (String) -> Void
    private let keys = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["", "0", "delete"]]

    var body: some View {
        VStack(spacing: 10) {
            ForEach(keys, id: \.self) { rowKeys in
                HStack(spacing: 10) {
                    ForEach(rowKeys, id: \.self) { key in
                        if key.isEmpty {
                            Color.clear.frame(width: 72, height: 52)
                        } else {
                            Button {
                                onKey(key)
                            } label: {
                                if key == "delete" {
                                    Image(systemName: "delete.left").font(.system(size: 20))
                                        .frame(width: 72, height: 52)
                                } else {
                                    Text(key).font(.system(size: 22, weight: .medium))
                                        .frame(width: 72, height: 52)
                                }
                            }
                            .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.06)))
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 32)
    }
}

// MARK: - PIN 解锁浮层

struct PrivacyPinOverlay: View {
    @StateObject private var privacy = PrivacyManager.shared
    @State private var pin = ""
    @State private var shake: CGFloat = 0

    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()
            VStack(spacing: 22) {
                Image("AppLogo").resizable().scaledToFit().frame(width: 90, height: 74)
                Text("输入 PIN 解锁").font(.system(size: 15, weight: .semibold))
                PinDots(count: pin.count, shakeOffset: shake)
                NumericKeypad { key in
                    if key == "delete" {
                        pin = String(pin.dropLast())
                    } else if pin.count < 8 {
                        HapticsGate.tick()
                        pin += key
                        if pin.count >= 4 { verify() }
                    }
                }
            }
        }
    }

    private func verify() {
        Task {
            let ok = await PrivacyManager.shared.verify(pin: pin)
            if !ok {
                withAnimation(.easeInOut(duration: 0.4)) { shake = 8 }
                try? await Task.sleep(nanoseconds: 400_000_000)
                withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) { shake = 0 }
                HapticsGate.error()
                pin = ""
            }
        }
    }
}

// MARK: - 缓存管理（CacheManagementScreen 对应物：总量优先 + 分类统计与清理同源）

struct CacheManagementScreen: View {
    @Environment(\.dismiss) private var dismiss
    @State private var items: [(name: String, bytes: Int64)] = []
    @State private var total: Int64 = 0
    @State private var scanning = true

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(BookRepository.formatSize(total))
                                .font(.system(size: 26, weight: .heavy))
                            Text("占用总量").font(.system(size: 12)).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if scanning { ProgressView() }
                    }
                }
                Section("明细") {
                    ForEach(items, id: \.name) { item in
                        HStack {
                            Text(item.name).font(.system(size: 14))
                            Spacer()
                            Text(BookRepository.formatSize(item.bytes))
                                .font(.system(size: 13)).monospacedDigit().foregroundStyle(.secondary)
                        }
                    }
                }
                Section {
                    Button(role: .destructive) {
                        clearCaches()
                    } label: {
                        Text("清理临时缓存（不含书籍与下载）")
                    }
                }
            }
            .navigationTitle("缓存管理")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
            .task { scan() }
        }
        .presentationDetents([.medium, .large])
    }

    private func scan() {
        scanning = true
        let fm = FileManager.default
        var out: [(String, Int64)] = []
        var sum: Int64 = 0
        // 书库（书籍+封面+内嵌图+下载）
        let books = BookRepository.totalLibraryBytes()
        out.append(("书籍与封面", books))
        sum += books
        // 缓存目录
        let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let cacheBytes = BookRepository.diskUsage(of: caches.path)
        out.append(("临时缓存", cacheBytes))
        sum += cacheBytes
        // 神回封面
        let god = fm.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("god_covers")
        let godBytes = BookRepository.diskUsage(of: god.path)
        out.append(("神回封面", godBytes))
        sum += godBytes
        items = out
        total = sum
        scanning = false
    }

    private func clearCaches() {
        let fm = FileManager.default
        let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        if let children = try? fm.contentsOfDirectory(at: caches, includingPropertiesForKeys: nil) {
            for child in children { try? fm.removeItem(at: child) }
        }
        scan()
        AppToastCenter.shared.show("临时缓存已清理", kind: .success)
    }
}
