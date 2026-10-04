import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import test from 'node:test'
import react from '@vitejs/plugin-react'
import electron from 'electron'
import { build } from 'vite'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'

const root = resolve(import.meta.dirname, '../..')
test('production Camp user anchors preserve navigation, native hover and reading state', { timeout: 120_000 }, async t => {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-message-anchors-ui-'))
  const evidence = process.env.ROVAI_ANCHOR_EVIDENCE_DIR
  if (evidence) assert.ok(isAbsolute(evidence), 'Evidence directory must be absolute')
  let child, closed
  try {
    await build({ configFile: false, root: join(root, 'scripts/fixtures/message-anchors'), base: './', logLevel: 'error',
      plugins: [react()], resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      build: { outDir: join(fixture, 'renderer'), minify: false } })
    const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete env.ELECTRON_RUN_AS_NODE
    child = spawn(electron, [join(root, 'scripts/fixtures/message-anchors/main.cjs'), join(fixture, 'renderer/index.html'),
      join(fixture, 'user-data'), join(fixture, 'evidence'), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    { env, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 90_000)
    let code
    try { [code] = await closed } finally { clearTimeout(timeout) }
    assert.equal(code, 0, output)
    assert.equal(JSON.parse(output.split('\n').find(line => line.startsWith('{'))).ok, true)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed }
    if (evidence) { await mkdir(evidence, { recursive: true }); await cp(join(fixture, 'evidence'), evidence, { recursive: true }) }
    await rm(fixture, { recursive: true, force: true })
  }
})
