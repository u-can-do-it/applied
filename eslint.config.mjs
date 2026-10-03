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
      // Short names only where the scope is one line and the meaning is conventional (see docs/code-review.md).
      // A warning until the existing single-letter names are renamed; then an error.
      'id-length': ['warn', { min: 2, exceptions: ['i', 'j', 'a', 'b', '_', 'e'], properties: 'never' }],
    },
  },
  {
    // A server action's arguments come from the browser, whatever their TypeScript types say: the
    // String() / Number() / Boolean() / `?.` / `!== false` there are runtime checks, not redundant code.
    // Remove this once the actions parse their input with Zod (docs/code-review.md, Phase 0).
    files: ['app/**/actions.ts'],
    rules: {
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
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
