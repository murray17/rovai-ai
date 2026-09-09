import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import react from '@vitejs/plugin-react'
import electron from 'electron'
import { build } from 'vite'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'

const root = resolve(import.meta.dirname, '../..')
test('message quotes preserve native selection, compact interaction and copy boundaries', { timeout: 90_000 }, async t => {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-message-quotes-ui-'))
  let child, closed
  try {
    await build({ configFile: false, root: join(root, 'scripts/fixtures/message-quotes'), base: './', logLevel: 'error',
      plugins: [react()], resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      build: { outDir: join(fixture, 'renderer'), minify: false } })
    const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete env.ELECTRON_RUN_AS_NODE
    child = spawn(electron, [join(root, 'scripts/fixtures/message-quotes/main.cjs'), join(fixture, 'renderer/index.html'), join(fixture, 'user-data'),
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 60_000)
    let code
    try { [code] = await closed } finally { clearTimeout(timeout) }
    assert.equal(code, 0, output)
    const report = JSON.parse(output.split('\n').find(line => line.startsWith('{')))
    assert.equal(report.ok, true)
    if (process.env.ROVAI_KEEP_QUOTE_FIXTURE === '1') console.log(`Quote UI evidence: ${fixture}`)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed }
    if (process.env.ROVAI_KEEP_QUOTE_FIXTURE !== '1') await rm(fixture, { recursive: true, force: true })
  }
})
