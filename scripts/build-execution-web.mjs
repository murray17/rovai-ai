import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { build } from 'vite'

const root = resolve(import.meta.dirname, '../apps/desktop/src/execution-web')
const outDir = resolve(import.meta.dirname, '../out/execution-web')

await build({
  configFile: false,
  root,
  base: '/',
  plugins: [react()],
  resolve: {
    alias: { '@contracts': resolve(import.meta.dirname, '../packages/contracts/src/index.ts') }
  },
  build: {
    outDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      input: resolve(root, 'index.html'),
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'assets/execution.js',
        assetFileNames: (asset) => {
          if (asset.name?.endsWith('.css')) return 'assets/execution.css'
          throw new Error(`Unexpected execution web asset: ${asset.name}`)
        }
      }
    }
  }
})

for (const file of ['execution.js', 'execution.css']) {
  const output = resolve(outDir, 'assets', file)
  if (!(await stat(output)).size) throw new Error(`Empty execution web asset: ${output}`)
}
