import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

await build({ configFile: false, root: import.meta.dirname, base: './', plugins: [react()],
  resolve: { alias: { '@contracts': resolve(import.meta.dirname, '../../../packages/contracts/src/index.ts') } },
  build: { outDir: process.argv[2], emptyOutDir: true }, logLevel: 'warn' })
