import { defineConfig } from 'vitest/config';

// =============================================================================
// kuroko-sisters-bridge vitest config
// =============================================================================
// root の vitest.config が apps/worker のみ include しているため、
// bridge 専用の include パターンを定義 (apps/bridge/test/ 配下を捕捉)
// =============================================================================

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globals: false,
  },
});
