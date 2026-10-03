import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

export default defineConfig([
  ...nextVitals,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // `onClick={() => setOpen(false)}` is the idiom for event handlers, not a confusing void
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // numbers print predictably in a template; objects, null and undefined still have to be handled explicitly
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // `const { typed: _, ...rest } = d` is how a key is left out of a copy
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // Short names only where the scope is one line and the meaning is conventional (CONTRIBUTING.md → Naming):
      // a loop counter, a comparator's two sides, a left-out key (errors are `error`, events `event`)
      'id-length': ['error', { min: 2, exceptions: ['i', 'j', 'a', 'b', '_'], properties: 'never' }],
    },
  },
  {
    // plain JS config files are not part of the TypeScript project
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // last, so it switches off every stylistic rule that Prettier owns
  prettier,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'test/fixtures/**', '*.tsbuildinfo']),
]);
