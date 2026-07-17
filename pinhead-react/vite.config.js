import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { qaSupabaseBridge } from './scripts/qa-supabase-bridge.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ...(process.env.QA_SB_BRIDGE ? [qaSupabaseBridge()] : [])],
  base: '/',
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    globals: true,
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
