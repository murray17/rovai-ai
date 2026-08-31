import { build } from 'vite'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const directory = dirname(fileURLToPath(import.meta.url))
const repo = resolve(directory, '../../..')
const productionWorkspace = join(repo, 'apps/desktop/src/renderer/src/CampWorkspace.tsx')
const component = join(directory, 'src/RecipientAvatars.tsx')
const avatarRoot = '/Users/murray.xue/Library/Application Support/Rovai-ai/member-avatars'
const avatarIds = ['bca81c54-087f-4fa5-937f-bcfd76ab6f49', '3465d69b-78ed-471b-b52b-2e0c825e6ad0', 'c586920f-f037-432a-8e39-12d452eb4292']
const avatarData = Object.fromEntries(await Promise.all(avatarIds.map(async id => [
  `rovai://member-avatar/managed/${id}`, (await readFile(join(avatarRoot, id, 'icon-192.png'))).toString('base64')
])))

const result = await build({
  configFile: false,
  root: join(directory, 'src'),
  base: './',
  logLevel: 'warn',
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@contracts': join(repo, 'packages/contracts/src/index.ts') } },
  plugins: [{
    name: 'isolated-recipient-design',
    enforce: 'pre',
    resolveId(id) { if (id === 'virtual:recipient-preview-avatars') return '\0recipient-preview-avatars' },
    load(id) { if (id === '\0recipient-preview-avatars') return `export default ${JSON.stringify(avatarData)}` },
    transform(source, id) {
      if (id.split('?')[0] !== productionWorkspace) return undefined
      const invocation = '<AgentRunDeliveryRecipients deliveries={runDeliveries} memberById={memberById} />'
      const attribution = /const runDeliveries = deliveries\.filter\(\(delivery\) =>\s*delivery\.targetAgentRunId === run\.id\s*\|\| \(delivery\.targetAgentRunId === null && delivery\.campTurnId === run\.campTurnId\)\s*\)/
      if (!source.includes(invocation) || !attribution.test(source)) throw new Error('Production recipient seam changed; inspect before rebuilding the design.')
      return `import { RecipientAvatars, prototypeDeliveriesForRun } from ${JSON.stringify(component)};\n` + source
        .replace(invocation, '<RecipientAvatars deliveries={runDeliveries} memberById={memberById} />')
        .replace(attribution, 'const runDeliveries = prototypeDeliveriesForRun(deliveries, run)')
    }
  }],
  build: {
    write: false,
    assetsInlineLimit: 10_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return
        warn(warning)
      }
    },
    chunkSizeWarningLimit: 5000
  }
})
const outputs = Array.isArray(result) ? result.flatMap(item => item.output) : result.output
const html = outputs.find(item => item.type === 'asset' && item.fileName === 'index.html')
const js = outputs.find(item => item.type === 'chunk' && item.isEntry)
const css = outputs.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => String(item.source)).join('\n')
if (!html || !js) throw new Error('Design build did not produce an HTML entry and script.')
const standalone = String(html.source)
  .replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/g, '')
  .replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, '')
  .replace('</head>', () => `<style>${css}</style></head>`)
  .replace('</body>', () => `<script type="module">${js.code.replace(/<\/script/gi, '<\\/script')}</script></body>`)
await writeFile(join(directory, 'index.html'), standalone)
process.stdout.write(`Built standalone preview: ${join(directory, 'index.html')}\n`)
process.stdout.write('Only preview code and copied avatar renditions are bundled; no production files or daily data are modified.\n')
