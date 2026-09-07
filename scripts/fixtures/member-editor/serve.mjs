import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '../../..')
const server = await createServer({
  configFile: false,
  root: import.meta.dirname,
  plugins: [react()],
  resolve: {
    alias: { '@contracts': resolve(root, 'packages/contracts/src/index.ts') }
  },
  server: {
    host: '127.0.0.1',
    port: 57232,
    strictPort: true,
    fs: { allow: [root] }
  }
})
await server.listen()
server.printUrls()
