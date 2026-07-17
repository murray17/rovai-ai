import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@contracts': resolve(import.meta.dirname, 'packages/contracts/src/index.ts')
    }
  },
  test: {
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts']
  }
})
