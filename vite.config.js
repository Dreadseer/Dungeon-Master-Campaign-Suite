import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  // strictPort: fail loudly rather than sliding to the next free port.
  //
  // `npm run dev` waits on http://localhost:5173 before launching Electron. If
  // Vite quietly fell back to 5174, wait-on would watch a port nothing was ever
  // going to serve and Electron would silently never launch — the terminal just
  // looks like it is still starting. That cost real time in Phase 4.5.
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'dist/renderer',
  },
  // Vitest reuses this config. Suites live beside the code they cover, in
  // src/**/__tests__/. Everything under test so far is a pure ES module with no
  // DOM dependency, so the default 'node' environment is enough — no jsdom.
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.js', 'electron/**/__tests__/**/*.test.js'],
    globals: false,
  },
})
