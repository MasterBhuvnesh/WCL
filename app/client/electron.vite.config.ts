import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'

// Default renderer runtime config. Production builds set these in the environment
// (see .github/workflows/build-windows.yml) so the packaged app points at the real
// backend and its CSP allows that origin; values already present win via `??=`.
// Kept here rather than a committed `.env` because the repo .gitignore ignores all
// dotenv files. VITE_CONNECT_SRC must cover both the HTTP(S) and WS(S) origin.
process.env.VITE_API_BASE ??= 'http://localhost:4000'
process.env.VITE_CONNECT_SRC ??= 'http://localhost:4000 ws://localhost:4000'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
