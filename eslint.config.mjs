import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import prettier from 'eslint-config-prettier/flat'

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '.temp/**',
    '.venv/**',
    'api/webui/**',
    'docs/.vitepress/**',
    'libs/**',
  ]),
  {
    files: [
      'desktop/**/*.{mjs,cjs}',
      'scripts/*.mjs',
      '*.{mjs,cjs}',
      'webui/*.js',
    ],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['webui/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['webui/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['webui/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    // 使用 React 18 的 Hooks 检查，不启用尚未接入的 React Compiler 规则
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  prettier,
])
