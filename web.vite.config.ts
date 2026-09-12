import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(import.meta.dirname, 'apps/web'),
  plugins: [react()],
  resolve: { alias: { '@contracts': resolve(import.meta.dirname, 'packages/contracts/src/index.ts') } },
  build: { outDir: resolve(import.meta.dirname, 'out/web'), emptyOutDir: true }
})
