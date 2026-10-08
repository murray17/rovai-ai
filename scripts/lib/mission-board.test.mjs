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
const fixtureSource = join(root, 'scripts/fixtures/mission-board')

async function runFixture(t, expectedCases, mode = 'standard') {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-mission-board-test-'))
  let child
  let closed
  try {
    await build({
      configFile: false, root: fixtureSource, base: './', logLevel: 'error', plugins: [react()],
      resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      build: { outDir: join(fixture, 'renderer'), minify: false }
    })
    const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete environment.ELECTRON_RUN_AS_NODE
    process.stdout.write(`Automatic acceptance userData: ${join(fixture, 'user-data')}; no Core/SQLite/Skill Library/Runtime\n`)
    child = spawn(electron, [
      join(fixtureSource, 'main.cjs'), join(fixture, 'renderer/index.html'), join(fixture, 'user-data'), mode,
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
    ], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 75_000)
    let code
    try { [code] = await closed } finally { clearTimeout(timeout) }
    assert.equal(code, 0, `Mission board integration failed:\n${stdout}\n${stderr}`)
    const report = JSON.parse(stdout.split('\n').find(line => line.startsWith('{')))
    assert.equal(report.ok, true)
    assert.equal(report.cases.length, expectedCases)
    if (report.layouts) process.stdout.write(`${JSON.stringify(report.layouts)}\n`)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await closed
    }
    if (process.env.ROVAI_KEEP_MISSION_BOARD_FIXTURE === '1') {
      process.stdout.write(`Preserved Mission board fixture: ${fixture}\n`)
    } else {
      await rm(fixture, { recursive: true, force: true })
    }
  }
}

test('Mission card, drawer, delivery and retained preview share one Camp workspace', { timeout: 150_000 }, t => runFixture(t, 13))
test('Mission deletion carries the required Camp open trace ID', { timeout: 100_000 }, t => runFixture(t, 1, 'delete-trace'))
test('Mission file trees virtualize a large cumulative Git diff', { timeout: 100_000 }, t => runFixture(t, 1, 'large-diff'))
test('Mission activity follows the actual checkout and drops stale views', { timeout: 100_000 }, t => runFixture(t, 1, 'checkout-view'))
test('Mission drawer expands directly from a wide saved width', { timeout: 100_000 }, t => runFixture(t, 0, 'wide-direct-expand'))
test('Mission editor popovers accept pointer clicks and wheel scrolling', { timeout: 100_000 }, t => runFixture(t, 1, 'editor-pointer'))

test('Mission member references survive save failure and invite only on commit', { timeout: 100_000 }, t => runFixture(t, 1, 'mentions'))
