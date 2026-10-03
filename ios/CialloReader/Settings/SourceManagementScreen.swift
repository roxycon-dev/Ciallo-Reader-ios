import SwiftUI
import UniformTypeIdentifiers

// MARK: - 书源管理（ui/source/SourceManagementScreen.kt 对应物）
// 一张玻璃卡内三等分快捷入口（刷新 JS 源 / 导入 Legado / 自建源）+ 分组列表 + 启停开关 + 成人源开关。

struct SourceManagementScreen: View {
    @ObservedObject private var manager = SourceManager.shared
    @Environment(\.dismiss) private var dismiss
    @Environment(\.appTheme) private var appTheme

    @State private var refreshing = false
    @State private var refreshResult: String?
    @State private var importText = ""
    @State private var showImport = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // 三等分快捷入口卡
                    GlassCard(cornerRadius: DT.rLG, padding: 10) {
                        HStack(spacing: 0) {
                            tile(icon: "arrow.triangle.2.circlepath", title: refreshing ? "刷新中" : "刷新源仓库") {
                                Task { await refreshRepo() }
                            }
                            Divider().frame(height: 44)
                            tile(icon: "square.and.arrow.down", title: "导入书源") { showImport = true }
                            Divider().frame(height: 44)
                            tile(icon: "heart.slash", title: manager.adultSourcesEnabled ? "成人源：开" : "成人源：关") {
                                manager.adultSourcesEnabled.toggle()
                                AppToastCenter.shared.show(manager.adultSourcesEnabled ? "已显示成人源" : "已隐藏成人源")
                            }
                        }
                    }
                    if let refreshResult {
                        Text(refreshResult).font(.system(size: 12)).foregroundStyle(.secondary)
                    }

                    // JS 漫画源分组
                    sourceGroup(title: "Venera JS 漫画源", ids: jsSourceIds)
                    // 内置源分组
                    sourceGroup(title: "内置源", ids: manager.allSources.filter { !($0 is JsComicSource) && $0.id != "js_sources" }.map { $0.id })
                }
                .padding(.horizontal, DT.spPage)
                .padding(.bottom, 40)
            }
            .navigationTitle("书源管理")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
            .task { await manager.initialize() }
        }
        .sheet(isPresented: $showImport) { SourceImportSheet(manager: manager) }
    }

    private var jsSourceIds: [String] {
        let repo = JsSourceRepo.shared
        var ids = repo.allKeys().map { "js_\($0)" }
        ids = ids.filter { manager.source(byId: $0) != nil || true }
        // 已加载的 JS 源
        return Array(Set(repo.loadedSources.values.map { $0.id })).sorted()
    }

    private func tile(icon: String, title: String, action: @escaping () -> Void) -> some View {
        Button {
            HapticsGate.light()
            action()
        } label: {
            VStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 18)).foregroundStyle(appTheme.primary)
                Text(title).font(.system(size: 11, weight: .medium)).foregroundStyle(.primary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
        }
    }

    @ViewBuilder
    private func sourceGroup(title: String, ids: [String]) -> some View {
        if !ids.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(.system(size: 14, weight: .bold))
                VStack(spacing: 0) {
                    ForEach(Array(ids.enumerated()), id: \.offset) { index, id in
                        if let source = manager.source(byId: id) {
                            SourceRow(source: source, showDivider: index < ids.count - 1)
                        }
                    }
                }
                .background(RoundedRectangle(cornerRadius: DT.rMD).fill(Color.primary.opacity(0.04)))
            }
        }
    }

    private func refreshRepo() async {
        refreshing = true
        let result = await JsSourceRepo.shared.refreshJsSources()
        refreshing = false
        switch result {
        case .success(let count):
            refreshResult = "已获取 \(count) 个 JS 源，搜索时按需加载"
            AppToastCenter.shared.show("源仓库已更新（\(count) 源）", kind: .success)
        case .error(let e):
            refreshResult = "刷新失败：\(e.errorDescription ?? "")"
        }
    }
}

struct SourceRow: View {
    let source: BookSource
    let showDivider: Bool
    @ObservedObject private var manager = SourceManager.shared
    @Environment(\.appTheme) private var appTheme
    @State private var loggedIn = false

    var body: some View {
        HStack(spacing: 10) {
            SourceAvatar(name: source.name, size: 34)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(source.name).font(.system(size: 14, weight: .medium))
                    if source.capabilities.isComicSource { TagChip(text: "漫画") }
                    if source.capabilities.supportEbook { TagChip(text: "电子书") }
                    if source.capabilities.supportOnlineText { TagChip(text: "网文") }
                    if JsSourceRepo.isAdult(sourceId: source.id) { TagChip(text: "R18") }
                }
                if source.capabilities.downloadRequiresLogin {
                    Text(loggedIn ? "已登录" : "需要登录")
                        .font(.system(size: 11))
                        .foregroundStyle(loggedIn ? Color.green : .secondary)
                }
            }
            Spacer()
            Toggle("", isOn: Binding(
                get: { manager.isEnabled(source.id) },
                set: { manager.setEnabled(source.id, $0) }
            ))
            .labelsHidden()
            .tint(appTheme.primary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .task {
            loggedIn = await source.isLoggedIn()
        }
        .overlay(alignment: .bottom) {
            if showDivider {
                Rectangle().fill(Color.primary.opacity(0.06)).frame(height: 0.5)
            }
        }
    }
}

// MARK: - 书源导入

struct SourceImportSheet: View {
    @ObservedObject var manager: SourceManager
    @Environment(\.dismiss) private var dismiss
    @State private var json = ""
    @State private var url = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("从 URL 导入（社区源）") {
                    TextField("https://…/sources.json", text: $url)
                        .textInputAutocapitalization(.never)
                    Button("下载并导入") { Task { await importFromUrl() } }
                }
                Section("粘贴 JSON（Legado / 原生格式）") {
                    TextEditor(text: $json)
                        .font(.system(size: 12, design: .monospaced))
                        .frame(minHeight: 140)
                    Button("导入") {
                        Task {
                            let result = await manager.addCustomSource(json: json)
                            if case .success(let src) = result {
                                AppToastCenter.shared.show("书源「\(src.name)」导入成功", kind: .success)
                                dismiss()
                            } else if case .error(let e) = result {
                                AppToastCenter.shared.showError(e.errorDescription ?? "导入失败")
                            }
                        }
                    }
                }
            }
            .navigationTitle("导入书源")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func importFromUrl() async {
        guard !url.isEmpty else { return }
        do {
            let resp = try await Http.get(url)
            let result = await manager.addCustomSource(json: resp.text)
            if case .success(let src) = result {
                AppToastCenter.shared.show("书源「\(src.name)」导入成功", kind: .success)
                dismiss()
            }
        } catch {
            AppToastCenter.shared.showError("下载失败：\(Http.describe(error))")
        }
    }
}

// MARK: - Z-Library 节点管理（ZLibraryNodeManagementScreen 对应物）

struct ZLibraryNodeScreen: View {
    @State private var nodes: [(domain: String, healthy: Bool)] = []
    @State private var selected: String = Preferences.shared.string(for: "zlib_selected_node") ?? ZLEndpointProvider.defaultDomain
    @State private var testing = true

    var body: some View {
        List {
            Section {
                if testing { HStack { ProgressView(); Text("测速中…") } }
                ForEach(nodes, id: \.domain) { node in
                    Button {
                        selected = node.domain
                        Preferences.shared.setString(node.domain, for: "zlib_selected_node")
                        ZLEndpointProvider.shared.customEndpoint = nil
                    } label: {
                        HStack {
                            Circle().fill(node.healthy ? .green : .red).frame(width: 8, height: 8)
                            Text(node.domain).font(.system(size: 14, design: .monospaced))
                            Spacer()
                            if selected == node.domain {
                                Image(systemName: "checkmark").foregroundStyle(AppTheme.shared.primary)
                            }
                        }
                    }
                }
            } footer: {
                Text("节点测速 = 首页可达 + 结构标记校验。与安卓一致：六活节点优先（1lib.sk 为唯一正确官网）。")
            }
        }
        .navigationTitle("Z-Library 节点")
        .task {
            nodes = await ZLEndpointProvider.shared.diagnoseAllEndpoints()
            testing = false
        }
    }
}
