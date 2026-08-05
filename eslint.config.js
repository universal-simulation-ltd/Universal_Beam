import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// Same shape as the other suite frontends (Universal_Exports, UNISIM_Compare):
// flat config, js.recommended + typescript-eslint recommended, plus the two
// React plugins. No type-aware rules — they need a project service and buy
// little here, and `tsc -b` in `npm run build` is the type gate.
export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'playwright-report', 'test-results'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Playwright specs and Vite/ESLint config files run in Node, not a tab.
    files: ['e2e/**/*.ts', '*.config.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)
