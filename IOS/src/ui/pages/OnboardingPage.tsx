import { useState, type CSSProperties } from 'react';
import { AppButton } from '@ui/components/AppButton';
import { MascotSpriteSheet, mascotAssetUrl } from '@core/mascot/index';
import { useAppStore } from '@ui/state/appStore';
import '../../styles/onboarding.css';

/**
 * Ported line-by-line from Android OnboardingScreen.kt.
 *
 * Reference:
 *  - 4 pages (title/description/badgeText exact copy, OnboardingScreen.kt L49-73)
 *  - Skip TextButton TopEnd padding(16.dp): "跳过" 14sp Medium, onSurfaceVariant
 *  - Root bg: Brush.verticalGradient(surfaceVariant 0.3f → background)
 *  - Badge: clip(RoundedCornerShape(50)), background MintPrimary 0.15f, padding(h 14, v 6), text 12sp Bold MintPrimary
 *  - Spacer 24dp
 *  - Illustration Card: size 200dp, shape 24dp, surface, elevation 0 + shadow 4dp; image size 140dp padding 8dp
 *  - Spacer 32dp
 *  - Title 24sp Bold onBackground center, padding(h 8)
 *  - Spacer 16dp
 *  - Description 14sp onSurfaceVariant center, lineHeight 22sp, padding(h 16)
 *  - Bottom Column padding(24): dots Row padding(bottom 24), dot size(if selected 18x8 else 8x8) CircleShape,
 *    selected MintPrimary else onSurfaceVariant 0.3f, horizontal padding 4dp
 *  - Action button: last page "立即开启阅读之旅" else "下一步", Primary, Large, fullWidth, arrow icon when not last
 *
 * REVIEW 2026-10-06
 *  F3 the four illustrations were invented emoji (📖 📚 🌙 🎀). Kotlin L52/58/64/70
 *     pass `MascotSpriteSheet.idleDrawable / moveDrawable / readingDrawable /
 *     happyDrawable` to `painterResource(...)`; the Roxy art is now used.
 *  F7 `AppActionButton(buttonSize = AppButtonSize.Large)` (AppButton.kt L85 →
 *     height 52.dp) was dropped on the floor: `<AppButton>` defaults to `size="md"`
 *     (44px). Now `size="lg"`.
 */

interface OnboardingPageDef {
  title: string;
  description: string;
  /** `MascotSpriteSheet` drawable for this page → `painterResource(id)`. */
  image: string;
  badgeText: string;
}

const PAGES: readonly OnboardingPageDef[] = [
  {
    title: '欢迎来到 Ciallo Reader',
    description:
      '这是一款专为阅读爱好者打造的沉浸式小说与网络文学阅读器。高颜值、极速、无广告，带给您最纯粹的阅读享受。',
    image: mascotAssetUrl(MascotSpriteSheet.idleDrawable),
    badgeText: '全新体验',
  },
  {
    title: '海量书库，源于自由',
    description:
      '支持自定义书源导入、网络书源搜索、JSON标准格式配置，更无缝集成 Z-Library 等云端书库，让好书无处遁形。',
    image: mascotAssetUrl(MascotSpriteSheet.moveDrawable),
    badgeText: '强大书源',
  },
  {
    title: '极致交互，沉浸阅读',
    description:
      '搭载 3D 仿真翻页 (PageCurl)、平滑覆盖滚动等多种翻页效果，支持防蓝光护眼模式与自动夜间主题，守护您的双眼。',
    image: mascotAssetUrl(MascotSpriteSheet.readingDrawable),
    badgeText: '个性定制',
  },
  {
    title: 'Roxy 灵动吉祥物',
    description:
      'Roxy 将在您的阅读旅程中时刻陪伴！当您添加书签、归档或删除书籍时，Roxy 都会用俏皮的肢体动画给您最生动的反馈。',
    image: mascotAssetUrl(MascotSpriteSheet.happyDrawable),
    badgeText: '趣味交互',
  },
];

/** `Image(Modifier.size(140.dp).padding(8.dp), contentScale = Fit)` (L166-169). */
const ILLUSTRATION_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  width: 140,
  height: 140,
  padding: 8,
};

const ILLUSTRATION_IMG_STYLE: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'contain',
};

function ArrowForwardIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function OnboardingPage() {
  // var currentPage by remember { mutableIntStateOf(0) }
  const [currentPage, setCurrentPage] = useState(0);
  const setRoute = useAppStore((s) => s.setRoute);
  const setHasSeenOnboarding = useAppStore((s) => s.setHasSeenOnboarding);

  const lastIndex = PAGES.length - 1;
  const page = PAGES[currentPage] ?? (PAGES[0] as OnboardingPageDef);

  const finish = () => {
    setHasSeenOnboarding(true);
    setRoute('main');
  };

  const handleAction = () => {
    if (currentPage < lastIndex) {
      setCurrentPage(currentPage + 1);
    } else {
      finish();
    }
  };

  return (
    <div className="onboarding-page" data-testid="onboarding_screen">
      {/* "Skip" button on top-right: padding(16.dp), 14sp Medium */}
      <button
        type="button"
        className="onboarding-skip"
        data-testid="onboarding_skip_button"
        onClick={finish}
      >
        跳过
      </button>

      {/* Main content: padding(horizontal 24), slide transitions (tween 300ms) */}
      <div className="onboarding-content" data-testid="onboarding_content_container">
        <div key={currentPage} className="onboarding-slide onboarding-slide--enter">
          {/* Badge: RoundedCornerShape(50), MintPrimary 0.15, padding(h14 v6), 12sp Bold */}
          <span className="onboarding-badge">{page.badgeText}</span>

          <div className="onboarding-spacer-24" />

          {/* Illustration Card: 200x200, radius 24, surface, shadow 4dp */}
          <div
            className="onboarding-card"
            data-testid={`onboarding_illustration_card_${currentPage}`}
          >
            <span
              className="onboarding-mascot"
              role="img"
              aria-label="Onboarding illustration"
              style={ILLUSTRATION_STYLE}
            >
              <img src={page.image} alt="" style={ILLUSTRATION_IMG_STYLE} />
            </span>
          </div>

          <div className="onboarding-spacer-32" />

          {/* Title 24sp Bold center padding(h8) */}
          <h2 className="onboarding-title">{page.title}</h2>

          <div className="onboarding-spacer-16" />

          {/* Description 14sp center, lineHeight 22sp, padding(h16) */}
          <p className="onboarding-desc">{page.description}</p>
        </div>
      </div>

      {/* Bottom controls: Column padding(24) BottomCenter */}
      <div className="onboarding-bottom">
        {/* Page Indicator Dots: Row padding(bottom 24) */}
        <div className="onboarding-dots" aria-label="引导进度">
          {PAGES.map((item, index) => {
            const isSelected = index === currentPage;
            return (
              <span
                key={item.badgeText}
                className={`onboarding-dot${isSelected ? ' onboarding-dot--selected' : ''}`}
              />
            );
          })}
        </div>

        {/* Action Button: Primary, Large, fullWidth; arrow icon when not last */}
        <AppButton
          variant="primary"
          size="lg"
          fullWidth
          data-testid="onboarding_action_button"
          onClick={handleAction}
          icon={currentPage < lastIndex ? <ArrowForwardIcon /> : undefined}
        >
          {currentPage === lastIndex ? '立即开启阅读之旅' : '下一步'}
        </AppButton>
      </div>
    </div>
  );
}
