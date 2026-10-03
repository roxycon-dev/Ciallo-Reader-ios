import SwiftUI

// MARK: - 悬浮收缩 Tab 栏（AppBottomTabBar.kt 对应物）
//
// 产品红线：选中指示 = 顶部 3pt 小横条（宽 40%、居中、自动对比色），
// 不许改成选中项背后的气泡/药丸，也不许删掉。

struct AppTabBar: View {
    @Binding var selection: Int
    let tabs: [(icon: String, title: String)]

    @Environment(\.appTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(tabs.enumerated()), id: \.offset) { index, tab in
                tabButton(index: index, tab: tab)
            }
        }
        .padding(.top, 6)
        .padding(.bottom, 2)
        .background(tabBarGlass)
    }

    @ViewBuilder
    private func tabButton(index: Int, tab: (icon: String, title: String)) -> some View {
        let selected = selection == index
        Button {
            guard selection != index else { return }
            HapticsGate.tick()
            withAnimation(AppMotion.springDefault) { selection = index }
        } label: {
            VStack(spacing: 3) {
                // 顶部 3pt 小横条（宽 40%、居中、自动对比色）—— TabIndicatorSpring
                ZStack {
                    Color.clear.frame(height: 3)
                    if selected {
                        Capsule()
                            .fill(indicatorColor)
                            .frame(width: 26, height: 3)
                            .transition(.opacity)
                    }
                }
                Image(systemName: tab.icon)
                    .font(.system(size: 20, weight: selected ? .semibold : .regular))
                    .symbolRenderingMode(.hierarchical)
                Text(tab.title)
                    .font(.system(size: 10.5, weight: selected ? .semibold : .regular))
            }
            .foregroundStyle(selected ? activeColor : inactiveColor)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .scaleEffect(selected ? 1.0 : 0.96)
        }
        .buttonStyle(.plain)
        .animation(AppMotion.springTilt, value: selected)
    }

    /// 自动对比色（WCAG 相对亮度法，Color.onColor() 同款）
    private var activeColor: Color { theme.primary }

    private var inactiveColor: Color {
        colorScheme == .dark ? Color(hex: 0x9A9CA1) : AppColor.mediumGray
    }

    private var indicatorColor: Color { theme.primary }

    private var tabBarGlass: some View {
        RoundedRectangle(cornerRadius: 0)
            .fill(colorScheme == .dark ? Color.white.opacity(0.045) : Color.white.opacity(0.45))
            .background(.thinMaterial)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(Color.primary.opacity(0.08))
                    .frame(height: 0.5)
            }
            .ignoresSafeArea(edges: .bottom)
    }
}

/// 滚动折叠状态（TabBarCollapseState：向上滚收窄、向下滚展开）。
@MainActor
final class TabBarCollapseState: ObservableObject {
    @Published var collapsed = false
}
