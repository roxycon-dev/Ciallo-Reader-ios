import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'ios/**',
      'node_modules/**',
      'parity/android-export/**',
      'parity/fixtures/**',
      'coverage/**',
      '**/*.d.ts',
      'public/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message: 'src/core must stay pure TypeScript — no React/DOM/Capacitor.',
            },
            {
              name: '@capacitor/core',
              message: 'src/core must stay pure TypeScript — use platform interfaces.',
            },
          ],
          patterns: [
            {
              group: ['react/*', 'react-dom*', '@capacitor/*'],
              message: 'src/core must stay pure TypeScript — use platform interfaces.',
            },
          ],
        },
      ],

      // E61：`no-restricted-imports` 只禁 import，**不禁 DOM 全局引用**，
      // 所以此前 `src/core/**` 里的 `window.matchMedia` / `new Audio()` /
      // `document.createElement` 全部逃过门禁。补上全局层面的禁止。
      //
      // 目标：src/core 必须能在**非浏览器宿主**（Node worker / 小程序壳）里跑。
      // 平台能力一律走 `src/platform/interfaces.ts` 的端口注入。
      //
      // 豁免：
      //   - `typeof window === 'undefined'` 这类**存在性探测**允许（是防御式
      //     守卫，不是依赖），但一旦要**取值**（`window.innerWidth`）就违规。
      //     下方用 `allow: []` + `object` 双规则区分：`typeof` 读的是标识符本身，
      //     交给 `no-undef` 无关，这里用 reportUsedIgnorePattern 思路改为
      //     分两条规则：禁 `window.*` 属性访问（对象成员），
      //     而 `typeof window` 因为不是成员访问，天然不命中成员规则。
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message:
            'src/core 不得直接访问 DOM 全局。请通过 @platform/interfaces 的端口注入（如 MediaQueryPort / ViewportPort）。详见 docs/PARITY_EXCEPTIONS.md E61。',
        },
        {
          name: 'document',
          message:
            'src/core 不得直接访问 DOM 全局。请通过 @platform/interfaces 的端口注入（如 CanvasPort）。详见 docs/PARITY_EXCEPTIONS.md E61。',
        },
        {
          name: 'localStorage',
          message:
            'src/core 不得直接访问 localStorage。请通过 @platform/interfaces 的端口注入（如 KeyValueStore）。详见 docs/PARITY_EXCEPTIONS.md E61。',
        },
        {
          name: 'sessionStorage',
          message:
            'src/core 不得直接访问 sessionStorage。请通过 @platform/interfaces 的端口注入。详见 docs/PARITY_EXCEPTIONS.md E61。',
        },
        {
          name: 'navigator',
          message:
            'src/core 不得直接访问 navigator。请通过 @platform/interfaces 的端口注入（如 DevicePort）。详见 docs/PARITY_EXCEPTIONS.md E61。',
        },
      ],
      // DOM 类型标注同样属于「依赖 DOM 全局」。
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSTypeReference > TSTypeReference > Identifier[name="HTMLAudioElement"]',
          message: 'src/core 不得引用 DOM 类型（HTMLAudioElement）。请用端口的抽象类型。详见 E61。',
        },
        {
          selector: 'TSTypeReference > Identifier[name="HTMLAudioElement"]',
          message: 'src/core 不得引用 DOM 类型（HTMLAudioElement）。请用端口的抽象类型。详见 E61。',
        },
        {
          selector: 'TSTypeReference > Identifier[name="HTMLElement"]',
          message: 'src/core 不得引用 DOM 类型（HTMLElement）。请用端口的抽象类型。详见 E61。',
        },
      ],
    },
    languageOptions: {
      globals: {
        // core 层不给 browser globals。仍保留 `window`/`document` 等标识符的
        // **存在性**探测能力（`typeof window === 'undefined'`），但任何成员访问
        // 都会被上面的 no-restricted-globals 拦下。
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
      },
    },
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx', 'scripts/**/*.{ts,mjs,js}', '*.config.{js,ts,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
