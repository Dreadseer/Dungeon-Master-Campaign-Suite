import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/renderer',
  },
  // Vitest reuses this config. Suites live beside the code they cover, in
  // src/**/__tests__/. Everything under test so far is a pure ES module with no
  // DOM dependency, so the default 'node' environment is enough — no jsdom.
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.js'],
    globals: false,
  },
})
