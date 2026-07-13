import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  root:    resolve(__dirname, 'player'),
  base:    './',
  build: {
    outDir:      resolve(__dirname, 'dist', 'player'),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      '/api':       { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
})
