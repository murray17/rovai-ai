import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const root = resolve(import.meta.dirname)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(root, 'apps/desktop/src/main/index.ts')
      }
    },
    resolve: {
      alias: {
        '@contracts': resolve(root, 'packages/contracts/src/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(root, 'apps/desktop/src/preload/index.ts'),
        output: {
          format: 'cjs',
          entryFileNames: 'index.js'
        }
      }
    },
    resolve: {
      alias: {
        '@contracts': resolve(root, 'packages/contracts/src/index.ts')
      }
    }
  },
  renderer: {
    root: resolve(root, 'apps/desktop/src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(root, 'apps/desktop/src/renderer/index.html')
      }
    },
    resolve: {
      alias: {
        '@contracts': resolve(root, 'packages/contracts/src/index.ts')
      }
    }
  }
})
