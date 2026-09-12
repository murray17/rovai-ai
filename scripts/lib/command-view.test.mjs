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
import { assertUserDataIsIsolated } from './dev-desktop.mjs'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'

test('deduplicated Built-in Command View loads only its Shell evidence and preserves full content', { timeout: 120_000 }, async t => {
  if (!admitElectronIntegrationTest(t)) return
  const root = resolve(import.meta.dirname, '../..')
  const source = join(root, 'scripts/fixtures/command-view')
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-command-view-'))
  let child, closed, passed = false
  try {
    await build({ configFile: false, root: source, base: './', logLevel: 'error', plugins: [react()],
      resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      build: { outDir: join(fixture, 'renderer'), minify: false } })
    const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete environment.ELECTRON_RUN_AS_NODE
    const userData = assertUserDataIsIsolated(join(fixture, 'user-data'))
    process.stdout.write(`Isolated Command View userData: ${userData}; Skill Library: ${join(userData, 'managed-skill-library')}\n`)
    child = spawn(electron, [join(source, 'main.cjs'), join(fixture, 'renderer/index.html'), userData,
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 90_000)
    let code
    try { [code] = await closed } finally { clearTimeout(timeout) }
    assert.equal(code, 0, output)
    const report = JSON.parse(output.split('\n').find(line => line.startsWith('{')))
    assert.equal(report.ok, true)
    process.stdout.write(`${JSON.stringify(report)}\n`)
    passed = true
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed }
    if (passed && process.env.ROVAI_KEEP_COMMAND_VIEW_FIXTURE !== '1') await rm(fixture, { recursive: true, force: true })
    else process.stdout.write(`Preserved Command View fixture: ${fixture}\n`)
  }
})
