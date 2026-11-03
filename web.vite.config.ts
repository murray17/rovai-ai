import { resolve } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { defineConfig, type Plugin } from 'vite'
import { createHash } from 'node:crypto'
import react from '@vitejs/plugin-react'

// Only emitted, content-addressed build outputs enter the cache inventory.
// Public/copied files and page entries do not gain caching from their directory.
function assetCacheManifest(): Plugin {
  return { name: 'rovai-asset-cache-manifest', apply: 'build', enforce: 'post', writeBundle: {
    order: 'post', async handler(options, bundle) {
      if (!options.dir) throw new Error('Web build requires an output directory')
      const files: Record<string, string> = {}
      for (const output of Object.values(bundle)) {
        if (!/^assets\/[^/]+-[\w-]{8}\.[\w.]+$/.test(output.fileName)) continue
        // Vite finalizes preload references during generateBundle. Hash the
        // written bytes after that phase, not an earlier chunk representation.
        files[output.fileName] = createHash('sha256').update(await readFile(resolve(options.dir, output.fileName))).digest('hex')
      }
      await writeFile(resolve(options.dir, 'asset-cache.json'), JSON.stringify(files))
    }
  } }
}

// Build both browser entry points together. Rollup shares their common modules
// and offline assets; Electron Main supplies its preload only to desktop.html.
function rendererEntries(): Plugin {
  return {
    name: 'rovai-renderer-entries',
    transformIndexHtml: { order: 'pre', handler(html, context) {
      const entry = context.filename.endsWith('/web/index.html')
        ? '/web/src/main.tsx' : '/desktop/src/renderer/src/main.tsx'
      return html.replace('src="/src/main.tsx"', `src="${entry}"`)
    } },
    generateBundle: { order: 'post', handler(_options, bundle) {
      for (const [path, name] of [['web/index.html', 'index.html'], ['desktop/src/renderer/index.html', 'desktop.html']]) {
        const output = bundle[path]
        if (!output || output.type !== 'asset') throw new Error(`Missing renderer entry: ${path}`)
        delete bundle[path]
        output.fileName = name
        output.source = String(output.source).replace(/(?:\.\.\/)+assets\//gu, './assets/')
        bundle[name] = output
      }
    } }
  }
}

export default defineConfig(({ command }) => ({
  root: resolve(import.meta.dirname, command === 'build' ? 'apps' : 'apps/web'),
  publicDir: resolve(import.meta.dirname, 'apps/web/public'),
  base: './',
  plugins: [react(), ...(command === 'build' ? [rendererEntries(), assetCacheManifest()] : [])],
  resolve: { alias: { '@contracts': resolve(import.meta.dirname, 'packages/contracts/src/index.ts') } },
  build: { outDir: resolve(import.meta.dirname, 'out/web'), emptyOutDir: true,
    rollupOptions: { input: {
      web: resolve(import.meta.dirname, 'apps/web/index.html'),
      desktop: resolve(import.meta.dirname, 'apps/desktop/src/renderer/index.html')
    } }
  }
}))
