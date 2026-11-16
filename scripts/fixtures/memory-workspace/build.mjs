import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '../../..')
const out = process.argv[2] ?? import.meta.dirname
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const result = await build({ configFile: false, root: import.meta.dirname, base: './', logLevel: 'warn',
  plugins: [react()],
  resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
  define: { __SOURCE_COMMIT__: JSON.stringify(sourceCommit), 'process.env.NODE_ENV': JSON.stringify('development') },
  build: { write: false, assetsInlineLimit: Number.MAX_SAFE_INTEGER, cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } } }
})
const bundle = (Array.isArray(result) ? result[0] : result).output
const js = bundle.filter(x => x.type === 'chunk').map(x => x.code).join('\n')
const css = bundle.filter(x => x.type === 'asset' && x.fileName.endsWith('.css')).map(x => x.source).join('\n')
const html = `<!doctype html><html lang="zh-CN" data-theme="day"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Rovai · Memory acceptance</title><meta name="description" content="直接复用当前 Rovai 生产组件的离线交互稿。固定演示数据。"><!-- Production source ${sourceCommit}. Prototype only; no Host or Runtime connection. --><style>${css}</style></head><body><div id="root"></div><script type="module">${js.replaceAll('</script', '<\\/script')}</script></body></html>`
await mkdir(out, { recursive: true })
const output = join(out, 'memory-workspace.html')
await writeFile(output, html)
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(html), sourceCommit }))
