/**
 * i18nComponents.test.tsx — `src/ui/components/**` 第二批界面语言包装的回归测试。
 *
 * 权威源：`novel-reader/app/src/main/java/com/example/i18n/Strings.kt` 的 `private val EN`
 * 词表 —— 也就是 `IOS/src/core/i18n/strings.ts` 的 `EN_PAIRS`（2535 组 / 2307 个唯一 key），
 * 以及 `com/example/ui/components/**` 里本来就是用户可见文案的那些中文字面量。
 *
 * 本批改动只做一件事：把**整串等于某个词表 key** 的中文字面量包成 `tr('…')`
 * （JSX 文本 → `{tr('…')}`，属性 → `attr={tr('…')}`），模块级常量表**不改常量本身**，
 * 只在渲染点补 `tr(X)`。所以中文态必须逐字不变，英文态必须变成词表值。
 *
 * 覆盖任务书要求的五条：
 *   (a) 取三个改过的组件（AppErrorSnackbar / JsonSourceGuideCard / PresetNameDialog）在中文态
 *       渲染，断言原文（`操作出错` / `{}` 里的问候语 / `预设名称` / `取消` / `确定` …）；
 *   (b) `setAppLanguage(AppLanguage.EN)` + `useAppStore.getState().setAppLanguagePreference(EN)`
 *       之后重新渲染，断言出现对应英文（`Something went wrong` / `Copy log` / `Preset name` /
 *       `What is a JSON source?` / `Field name` …）；
 *   (c) `tr()` 的 key→EN 映射直接断言（不依赖挂载）；
 *   (d) 切回中文恢复原文、英文消失；
 *   (e) 词表命中的中文 key 不再出现在英文渲染结果里（四个组件抽样）。
 *
 * 另外单测一条**模块级常量表**的改法：`JSON_SOURCE_FIELDS`（`JsonSourceGuideCard` 里的
 * 字段说明表）与 `COPY_LOG_MESSAGE` / `COPY_TEMPLATE_MESSAGE` 这些 `export const X = '中文'`
 * 在 import 期求值、不能包 `tr()`，本批只在渲染点写成 `tr(X)`，所以这里断言的是**渲染结果**
 * 随语言切换，而不是常量本身被改写（常量仍是中文原文）。
 *
 * 仓库没有 `@testing-library/react`，沿用 tests/unit 既有写法：`react-dom/client` + `act`。
 * 全程 jsdom，不联网（这四个组件都不发请求）。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AppLanguage, getAppLanguage, setAppLanguage, tr } from '@core/i18n';
import { useAppStore } from '@ui/state/appStore';
import {
  AppErrorSnackbar,
  COPY_LOG_MESSAGE,
  friendlyMessage,
} from '@ui/components/AppErrorSnackbar';
import { PresetNameDialog } from '@ui/components/comic/sheets/PresetNameDialog';
import { JsonSourceGuideCard } from '@ui/components/help/JsonSourceGuideCard';
import { LibraryHelpBottomSheet } from '@ui/components/help/LibraryHelpBottomSheet';
import { Toast } from '@ui/components/Toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

/**
 * 等价于 `App.tsx` 的「订阅 `appLanguage` 让整树重渲染」：换一次语言就把子树整体重挂载一次，
 * 组件里的 `tr()` 因此在每次切换后都会重新取值。
 */
function LanguageBoundary({ children }: { children: ReactNode }) {
  const appLanguage = useAppStore((state) => state.appLanguage);
  useEffect(() => {
    setAppLanguage(appLanguage);
  }, [appLanguage]);
  return <div key={appLanguage}>{children}</div>;
}

interface Mounted {
  readonly host: HTMLDivElement;
  readonly root: Root;
}

const mounted: Mounted[] = [];

async function mount(node: ReactNode): Promise<Mounted> {
  const host = document.createElement('div');
  document.body.append(host);
  const root: Root = createRoot(host);
  const entry: Mounted = { host, root };
  mounted.push(entry);
  await act(async () => {
    root.render(<LanguageBoundary>{node}</LanguageBoundary>);
  });
  return entry;
}

/** 冲掉 effect / promise 回调里的 setState，避免 `not wrapped in act(...)` 噪声。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function click(element: Element | null): void {
  if (element === null) throw new Error('click 目标不存在');
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/**
 * 换语言照 `App.tsx` / `SettingsPage` 的真实路径：先写 core 单例（`tr()` 读它），
 * 再走 store 的 `setAppLanguagePreference()`（它自己会 `set({ appLanguage })` 并落库）。
 */
async function switchLanguage(language: AppLanguage): Promise<void> {
  await act(async () => {
    setAppLanguage(language);
    await useAppStore.getState().setAppLanguagePreference(language);
  });
  await flush();
}

/** 中文态 + 英文态都用到的一份最小可渲染 props。 */
function errorSnackbar(copied: string[]): ReactNode {
  return (
    <>
      <AppErrorSnackbar
        message="NETWORK TIMEOUT"
        onDismissClick={() => undefined}
        copyToClipboard={(text) => {
          copied.push(text);
        }}
      />
      <Toast />
    </>
  );
}

beforeEach(() => {
  setAppLanguage(AppLanguage.ZH);
  useAppStore.setState({ appLanguage: AppLanguage.ZH });
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.host.remove();
  }
  setAppLanguage(AppLanguage.ZH);
  useAppStore.setState({ appLanguage: AppLanguage.ZH });
});

describe('组件层界面语言包装 — AppErrorSnackbar / JsonSourceGuideCard / PresetNameDialog', () => {
  it('AppErrorSnackbar：中文原文 → EN 词表值 → 切回恢复（含渲染点 tr(COPY_LOG_MESSAGE)）', async () => {
    const copied: string[] = [];
    const { host } = await mount(errorSnackbar(copied));

    // (a) 中文态：标题、`friendlyMessage` 的兜底文案、复制按钮、关闭 aria-label 全是原文
    expect(host.querySelector('.app-error-snackbar__title')?.textContent).toBe('操作出错');
    expect(host.querySelector('.app-error-snackbar__body')?.textContent).toBe(
      '网络连接超时，请检查网络设置',
    );
    expect(host.querySelector('.app-error-snackbar__copy')?.textContent).toBe('复制日志');
    expect(host.querySelector('.app-error-snackbar__close')?.getAttribute('aria-label')).toBe(
      '关闭',
    );

    // 模块级常量 `COPY_LOG_MESSAGE` 不翻译自己，只在渲染点过 tr()：中文态仍是原文
    click(host.querySelector('.app-error-snackbar__copy'));
    await flush();
    expect(host.querySelector('.app-error-snackbar .sr-only')?.textContent).toBe(
      '错误日志已复制到剪贴板',
    );
    expect(copied).toEqual(['NETWORK TIMEOUT']);

    // (b) 切 EN：三条文案都换成词表值
    await switchLanguage(AppLanguage.EN);
    expect(getAppLanguage()).toBe(AppLanguage.EN);
    expect(host.querySelector('.app-error-snackbar__title')?.textContent).toBe(
      'Something went wrong',
    );
    expect(host.querySelector('.app-error-snackbar__body')?.textContent).toBe(
      'Network timed out — check your settings',
    );
    expect(host.querySelector('.app-error-snackbar__copy')?.textContent).toBe('Copy log');
    expect(host.querySelector('.app-error-snackbar__close')?.getAttribute('aria-label')).toBe(
      'Close',
    );

    // 渲染点 tr(COPY_LOG_MESSAGE)：常量仍是中文，界面跟着语言走
    expect(COPY_LOG_MESSAGE).toBe('错误日志已复制到剪贴板');
    click(host.querySelector('.app-error-snackbar__copy'));
    await flush();
    expect(host.querySelector('.app-error-snackbar .sr-only')?.textContent).toBe('Error log copied');

    // (d) 切回中文恢复
    await switchLanguage(AppLanguage.ZH);
    expect(getAppLanguage()).toBe(AppLanguage.ZH);
    expect(host.querySelector('.app-error-snackbar__title')?.textContent).toBe('操作出错');
    expect(host.textContent).not.toContain('Something went wrong');
    expect(host.textContent).not.toContain('Copy log');
  });

  it('JsonSourceGuideCard：模块级 JSON_SOURCE_FIELDS 在渲染点过 tr()，表头/标题同步', async () => {
    const { host } = await mount(<JsonSourceGuideCard />);

    // (a) 中文态：标题、表头、字段说明（`JSON_SOURCE_FIELDS` 里的原文）
    expect(host.querySelector('.json-source-guide__title')?.textContent).toBe('什么是 JSON 书源？');
    const headsZh = [...host.querySelectorAll('.json-source-guide__th')].map(
      (node) => node.textContent,
    );
    expect(headsZh).toEqual(['字段名称', '对应描述与作用说明']);
    const descsZh = [...host.querySelectorAll('.json-source-guide__td--desc')].map(
      (node) => node.textContent,
    );
    expect(descsZh[0]).toBe('唯一英文字符标识，保证书源独立性');
    expect(descsZh[1]).toBe('在书源列表中显示的友好名称');

    // (b) 切 EN：标题/表头/字段说明都取词表值
    await switchLanguage(AppLanguage.EN);
    expect(host.querySelector('.json-source-guide__title')?.textContent).toBe(
      'What is a JSON source?',
    );
    const headsEn = [...host.querySelectorAll('.json-source-guide__th')].map(
      (node) => node.textContent,
    );
    expect(headsEn).toEqual(['Field name', 'Description and what it does']);
    const descsEn = [...host.querySelectorAll('.json-source-guide__td--desc')].map(
      (node) => node.textContent,
    );
    expect(descsEn[0]).toBe('A unique ASCII id that keeps the source distinct');
    expect(descsEn[1]).toBe('The friendly name shown in the source list');

    // (d) 切回中文恢复
    await switchLanguage(AppLanguage.ZH);
    expect(host.querySelector('.json-source-guide__title')?.textContent).toBe('什么是 JSON 书源？');
    expect(host.textContent).not.toContain('What is a JSON source?');
  });

  it('PresetNameDialog：placeholder / aria-label / 按钮文案三处都随语言切换', async () => {
    const { host } = await mount(
      <PresetNameDialog
        title="TEST PRESET"
        initial=""
        onConfirm={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    // (a) 中文态：`预设名称` 同时是 placeholder 与 aria-label；按钮是 `取消` / `确定`
    const field = host.querySelector<HTMLInputElement>('.cmcs-dialog__field');
    expect(field?.getAttribute('placeholder')).toBe('预设名称');
    expect(field?.getAttribute('aria-label')).toBe('预设名称');
    const buttonsZh = [...host.querySelectorAll('.cmcs-dialog__btn')].map(
      (node) => node.textContent,
    );
    expect(buttonsZh).toEqual(['取消', '确定']);

    // (b) 切 EN：词表值 `Preset name` / `Cancel` / `OK`
    await switchLanguage(AppLanguage.EN);
    expect(host.querySelector<HTMLInputElement>('.cmcs-dialog__field')?.getAttribute('placeholder')).toBe(
      'Preset name',
    );
    expect(host.querySelector<HTMLInputElement>('.cmcs-dialog__field')?.getAttribute('aria-label')).toBe(
      'Preset name',
    );
    const buttonsEn = [...host.querySelectorAll('.cmcs-dialog__btn')].map(
      (node) => node.textContent,
    );
    expect(buttonsEn).toEqual(['Cancel', 'OK']);

    // (d) 切回中文恢复
    await switchLanguage(AppLanguage.ZH);
    expect(host.querySelector<HTMLInputElement>('.cmcs-dialog__field')?.getAttribute('placeholder')).toBe(
      '预设名称',
    );
    expect(host.textContent).not.toContain('Cancel');
  });

  it('LibraryHelpBottomSheet：面板 aria-label / 快捷操作 / 复制模板 toast 都过 tr()', async () => {
    const { host } = await mount(
      <>
        <LibraryHelpBottomSheet
          onDismissRequest={() => undefined}
          onOpenSourceManager={() => undefined}
          deleteStaleDownloadTemps={async () => 0}
        />
        <Toast />
      </>,
    );

    // (a) 中文态
    expect(host.querySelector('.library-help-sheet')?.getAttribute('aria-label')).toBe(
      '书库使用手册',
    );
    expect(host.querySelector('.library-help-sheet__quick-title')?.textContent).toBe('快捷操作');
    const copyShortcut = host.querySelector('[data-testid="shortcut_copy_template"]');
    expect(copyShortcut?.textContent).toBe('查看JSON模板');

    // `COPY_TEMPLATE_MESSAGE` 是模块级常量，只能断言渲染点：toast 文案跟语言走
    click(copyShortcut);
    await flush();
    expect(host.querySelector('.toast')?.textContent).toBe('已复制 JSON 示例模板到剪贴板');

    // 清空临时文件的另一条 toast 分支（三元里只有 else 分支是词表 key）
    click(host.querySelector('[data-testid="shortcut_clear_cache"]'));
    await flush();
    expect(host.querySelector('.toast')?.textContent).toBe('没有可清理的下载临时文件');

    // (b) 切 EN
    await switchLanguage(AppLanguage.EN);
    expect(host.querySelector('.library-help-sheet')?.getAttribute('aria-label')).toBe(
      'Library handbook',
    );
    expect(host.querySelector('.library-help-sheet__quick-title')?.textContent).toBe('Quick actions');
    const copyShortcutEn = host.querySelector('[data-testid="shortcut_copy_template"]');
    expect(copyShortcutEn?.textContent).toBe('View JSON template');

    click(copyShortcutEn);
    await flush();
    expect(host.querySelector('.toast')?.textContent).toBe('Sample JSON template copied');

    click(host.querySelector('[data-testid="shortcut_clear_cache"]'));
    await flush();
    expect(host.querySelector('.toast')?.textContent).toBe(
      'No download temp files to clear',
    );

    // (d) 切回中文恢复
    await switchLanguage(AppLanguage.ZH);
    expect(host.querySelector('.library-help-sheet')?.getAttribute('aria-label')).toBe(
      '书库使用手册',
    );
    expect(host.textContent).not.toContain('View JSON template');
  });
});

describe('词表映射与「EN 渲染不再出现中文 key」', () => {
  it('tr() 直接映射：组件里包过的 key 都能查到词表值', async () => {
    // `tr()` 读的是 core 单例的当前语言，所以先切到 EN 再断言映射
    await act(async () => {
      setAppLanguage(AppLanguage.EN);
    });
    expect(getAppLanguage()).toBe(AppLanguage.EN);
    expect(tr('操作出错')).toBe('Something went wrong');
    expect(tr('复制日志')).toBe('Copy log');
    expect(tr('关闭')).toBe('Close');
    expect(tr('预设名称')).toBe('Preset name');
    expect(tr('取消')).toBe('Cancel');
    expect(tr('确定')).toBe('OK');
    expect(tr('什么是 JSON 书源？')).toBe('What is a JSON source?');
    expect(tr('字段名称')).toBe('Field name');
    expect(tr('书库使用手册')).toBe('Library handbook');
    expect(tr('快捷操作')).toBe('Quick actions');
    // 组件模块里的函数级文案同样走词表（`friendlyMessage` 的 timeout 分支）
    expect(friendlyMessage('timeout')).toBe('Network timed out — check your settings');
    expect(tr('网络连接超时，请检查网络设置')).toBe('Network timed out — check your settings');
  });

  it('英文态下这四个组件的渲染结果里不再出现被包过的中文 key（抽样）', async () => {
    const { host } = await mount(
      <>
        <AppErrorSnackbar message="NETWORK TIMEOUT" copyToClipboard={() => undefined} />
        <JsonSourceGuideCard />
        <PresetNameDialog
          title="TEST PRESET"
          initial=""
          onConfirm={() => undefined}
          onDismiss={() => undefined}
        />
        <LibraryHelpBottomSheet
          onDismissRequest={() => undefined}
          onOpenSourceManager={() => undefined}
        />
      </>,
    );

    // 中文态先确认这些 key 真的在页面上（否则「英文态不出现」没有意义）
    const sampled = [
      '操作出错',
      '复制日志',
      '什么是 JSON 书源？',
      '字段名称',
      '对应描述与作用说明',
      '取消',
      '确定',
      '快捷操作',
      '查看JSON模板',
      '书库使用手册',
    ];
    const zhText = host.textContent ?? '';
    expect(sampled.filter((key) => zhText.includes(key))).toEqual(sampled);

    await switchLanguage(AppLanguage.EN);

    const enText = host.textContent ?? '';
    expect(enText).toContain('Something went wrong');
    expect(enText).toContain('What is a JSON source?');
    expect(enText).toContain('OK');
    expect(enText).toContain('Quick actions');
    for (const key of sampled) {
      expect(enText).not.toContain(key);
    }
  });
});
