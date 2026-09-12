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
const source = join(root, 'scripts/fixtures/settings-workspace')
test('settings preserve channel actions, large-roster selection, sparse usage and failure recovery across themes and zoom', { timeout: 120_000 }, async t => {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-settings-workspace-test-'))
  let child, closed
  try {
    await build({ configFile: false, root: source, base: './', logLevel: 'error', plugins: [react()],
      resolve: { alias: {
        '@contracts': join(root, 'packages/contracts/src/index.ts'),
        '@renderer': join(root, 'apps/desktop/src/renderer/src'),
        '@shared': join(root, 'apps/desktop/src/shared')
      } }, build: { outDir: join(fixture, 'renderer'), minify: false } })
    const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete env.ELECTRON_RUN_AS_NODE
    process.stdout.write(`Isolated settings fixture: ${fixture}; userData: ${join(fixture, 'user-data')}; Skill Library: ${join(fixture, 'user-data/managed-skill-library')} (no Core/Runtime)\n`)
    child = spawn(electron, [join(source, 'main.cjs'), join(fixture, 'renderer/index.html'), join(fixture, 'user-data'),
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk) })
    child.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk) })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 90_000)
    let code
    try { [code] = await closed } finally { clearTimeout(timeout) }
    assert.equal(code, 0, output)
    assert.equal(JSON.parse(output.split('\n').find(line => line.startsWith('{'))).ok, true)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed }
    if (process.env.ROVAI_KEEP_SETTINGS_FIXTURE === '1') process.stdout.write(`Settings screenshots: ${fixture}\n`)
    else await rm(fixture, { recursive: true, force: true })
  }
})
