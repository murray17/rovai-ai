import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const server = await createServer({
  root, configFile: false, plugins: [react()],
  optimizeDeps: { entries: ['scripts/fixtures/automation-workspace/index.html'] },
  resolve: { alias: { '@contracts': resolve(root, 'packages/contracts/src/index.ts') } },
  server: { host: '127.0.0.1', port: 4178, strictPort: true }
})
await server.listen()
console.log('Renderer fixture: http://127.0.0.1:4178/scripts/fixtures/automation-workspace/')
