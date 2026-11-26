import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '../../..')
export async function serveAutomationFixture(port = 4178) {
  const server = await createServer({
    root, configFile: false, plugins: [react()],
    optimizeDeps: { entries: ['scripts/fixtures/automation-workspace/index.html'] },
    resolve: { alias: { '@contracts': resolve(root, 'packages/contracts/src/index.ts') } },
    server: { host: '127.0.0.1', port, strictPort: port !== 0, ...(port === 0 ? { hmr: false, watch: null } : {}) }
  })
  try {
    await server.listen()
    return server
  } catch (error) {
    await server.close()
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await serveAutomationFixture()
  console.log('Renderer fixture: http://127.0.0.1:4178/scripts/fixtures/automation-workspace/')
}
