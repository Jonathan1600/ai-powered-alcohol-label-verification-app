// `defineConfig` comes from vitest rather than vite so the `test` block below
// type-checks. It is the same function with the test options layered on.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The single .env / .env.example at the repo root serves both halves.
  envDir: '..',
  test: {
    // jsdom, not node: the downscale helper reaches for canvas and File, which
    // only exist in a document. The image codecs themselves are still stubbed;
    // see src/lib/downscale.test.ts for what that does and does not cover.
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
