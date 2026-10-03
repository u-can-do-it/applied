import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // the '@/*' paths from tsconfig.json
    tsconfigPaths: true,
    alias: {
      // the real package throws outside a React Server Components bundle; in tests it's a no-op
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
