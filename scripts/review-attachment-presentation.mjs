import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import electron from 'electron'
import { build } from 'vite'

const root = resolve(import.meta.dirname, '..')
const fixtureSource = join(root, 'scripts/fixtures/camp-open-projection')
const fixture = await mkdtemp(join(tmpdir(), 'rovai-attachment-review-'))

await build({
  configFile: false,
  root: fixtureSource,
  base: './',
  logLevel: 'error',
  plugins: [react()],
  resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
  build: { outDir: join(fixture, 'renderer'), minify: false }
})

const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
delete environment.ELECTRON_RUN_AS_NODE

process.stdout.write(`Attachment review fixture: ${fixture}; no Core/SQLite/Skill Library/Runtime/LLM\n`)
const child = spawn(electron, [
  join(fixtureSource, 'main.cjs'),
  join(fixture, 'renderer/index.html'),
  join(fixture, 'user-data'),
  '--attachment-review',
  '--no-sandbox'
], { env: environment, stdio: 'inherit' })

const stop = (signal) => {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal)
}
process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))

const [code, signal] = await once(child, 'close')
if (signal) process.kill(process.pid, signal)
process.exitCode = code ?? 1
