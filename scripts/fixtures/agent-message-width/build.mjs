import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const out = process.argv[2]
if (!out) throw Error('An explicit output directory is required')
const result = await build({ configFile: false, root: import.meta.dirname, base: './', logLevel: 'warn',
  plugins: [react()], resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
  build: { write: false, assetsInlineLimit: Number.MAX_SAFE_INTEGER, cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } } }
})
const bundle = (Array.isArray(result) ? result[0] : result).output
const js = bundle.filter(x => x.type === 'chunk').map(x => x.code).join('\n')
const css = bundle.filter(x => x.type === 'asset' && x.fileName.endsWith('.css')).map(x => x.source).join('\n')
await mkdir(out, { recursive: true })
await writeFile(join(out, 'index.html'), `<!doctype html><html lang="zh-CN" data-theme="day"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div><script type="module">${js.replaceAll('</script', '<\\/script')}</script></body></html>`)
