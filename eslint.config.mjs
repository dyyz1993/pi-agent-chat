import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import rpcPlugin from './eslint-plugin-rpc/index.js';
import themePlugin from './eslint-plugin-theme/index.js';
import noHardcodedPortPlugin from './eslint-plugin-no-hardcoded-port/index.js';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'node_modules/**',
      'build/**',
      'dist/**',
      '.vite/**',
      'eslint-plugin-rpc/**',
      'eslint-plugin-theme/**',
      'eslint-plugin-no-hardcoded-port/**',
      'postcss.config.js',
      'probe-compaction.mjs',
      'tailwind.config.js',
      'scripts/**',
      'preview-test/**',
      '*.html',
      '.codenomad/**',
      '.yalc/**',
      'repro/**',

      'src/electrobun-shim.d.ts',
      'eslint.config.mjs',
      'commitlint.config.js',
      'ecosystem.config.js',
      'dist-server/**',
      'e2e-*.mjs',
      'test-*.mjs',
      'test/rollback-e2e-backtest.test.ts',
      'test/rollback-leafid-persistence.test.ts',
      'test/rollback-managed-restart.test.ts',
      'test/rollback-scenarios.test.ts',
      'test/status-visibility-harness.test.ts',
      'test/streaming-status.test.ts',
      'test/agent-config.test.ts',
      'test/change-review-handler.test.ts',
      'test/getfullmessages-cache.test.ts',
      'test/process-manager-linecount.test.ts',
      'test/rollback-toUserMsgEntryId.test.ts',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      rpc: rpcPlugin,
      theme: themePlugin,
      'no-hardcoded-port': noHardcodedPortPlugin,
    },
    rules: {
      // TS 类型安全规则
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-enum-comparison': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': ['warn', { ignoreConditionalTests: true }],
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-empty-object-type': ['error', { allowObjectTypes: 'always', allowInterfaces: 'with-single-extends' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': true,
        'ts-nocheck': true,
        'ts-check': false,
        minimumDescriptionLength: 3,
      }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-globals': [
        'error',
        {
          name: 'alert',
          message: 'Use an in-app confirmation or notification UI instead of system alert().',
        },
        {
          name: 'confirm',
          message: 'Use an in-app confirmation UI instead of system confirm().',
        },
        {
          name: 'prompt',
          message: 'Use an in-app input UI instead of system prompt().',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'alert',
          message: 'Use an in-app confirmation or notification UI instead of window.alert().',
        },
        {
          object: 'window',
          property: 'confirm',
          message: 'Use an in-app confirmation UI instead of window.confirm().',
        },
        {
          object: 'window',
          property: 'prompt',
          message: 'Use an in-app input UI instead of window.prompt().',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: 'Use the in-app DropdownSelect/Listbox UI instead of native <select>.',
        },
        {
          selector:
            "CallExpression[callee.object.name='React'][callee.property.name='createElement'] > Literal[value='select']:first-child",
          message: 'Use the in-app DropdownSelect/Listbox UI instead of native select elements.',
        },
        {
          selector:
            "CallExpression[callee.name='createElement'] > Literal[value='select']:first-child",
          message: 'Use the in-app DropdownSelect/Listbox UI instead of native select elements.',
        },
      ],

      // RPC 规范规则（严格模式，全部 error）
      'rpc/no-bare-method': 'error',
      'rpc/no-direct-register': 'error',
      'rpc/schema-merge-only': 'error',
      'rpc/module-file-naming': 'error',
      'rpc/require-typed-register': 'error',
      'rpc/require-api-client': 'error',
      'rpc/no-namespace-iterate': 'error',
      'rpc/no-component-rpc-fetch': 'warn',
      'rpc/valid-channel-method': 'error',
      'rpc/compaction-entries-sync': 'error',
      'rpc/compaction-reload-pairing': 'error',
      'rpc/require-channel-timeout': 'warn',
      'rpc/require-async-onclick-guard': 'warn',

      // 主题/颜色约束规则
      'theme/color-pairing': 'error',

      // 禁止写死后端端口（应从 VITE_API_TARGET 解析）
      'no-hardcoded-port/no-hardcoded-port': 'error',
    },
  },
  {
    files: ['src/shared/lib/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  eslintConfigPrettier,
);
