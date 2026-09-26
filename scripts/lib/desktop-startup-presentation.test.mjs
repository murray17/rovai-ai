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
const fixtureSource = join(root, 'scripts/fixtures/desktop-startup-presentation')

test('the production App presents the full-window brand loader without weakening Core admission', { timeout: 60_000 }, async (t) => {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-startup-presentation-test-'))
  let child
  let closed
  try {
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
    process.stdout.write(`Automatic acceptance userData: ${join(fixture, 'user-data')}; no Core/SQLite/Skill Library/Runtime\n`)
    child = spawn(electron, [
      join(fixtureSource, 'main.cjs'),
      join(fixture, 'renderer/index.html'),
      join(fixture, 'user-data'),
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
    ], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 40_000)
    let code
    try {
      [code] = await closed
    } finally {
      clearTimeout(timeout)
    }
    assert.equal(code, 0, `Desktop startup regression failed:\n${stdout}\n${stderr}`)
    const report = JSON.parse(stdout.split('\n').find(line => line.startsWith('{')))
    assert.equal(report.ok, true)
    assert.ok(report.cases.length >= 8)
    assert.ok(report.cases.includes('Ordinary Camp switching reads only the target row without unrelated queries'))
    assert.ok(report.cases.includes('The Skill picker loads its catalog on demand'))
    assert.ok(report.cases.includes('Pending pushes never enter history and memory normalization cannot supersede newer navigation'))
    assert.ok(report.cases.includes('One-click creation success and failure respect newer navigation intent'))
    assert.ok(report.cases.includes('Member history replay selects the requested editor while retaining new-member drafts'))
    assert.ok(report.cases.includes('Runtime availability refreshes health and installations without reloading members'))
    assert.ok(report.cases.includes('Runtime discovery retains full refresh across mixed debounce events'))
    assert.ok(report.cases.includes('New Conversation preserves edited drafts across candidate refresh and creation failure'))
    assert.ok(report.cases.includes('New Conversation gates selection, Lead and submit by saved usable runtimes and keeps help independent'))
    assert.ok(report.cases.includes('New Conversation handles an all-unconfigured roster'))
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await closed
    }
    if (process.env.ROVAI_KEEP_STARTUP_PRESENTATION_FIXTURE === '1') {
      process.stdout.write(`Startup presentation fixture: ${fixture}\n`)
    } else {
      await rm(fixture, { recursive: true, force: true })
    }
  }
})
