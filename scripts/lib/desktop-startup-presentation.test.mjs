import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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
    const skillLibraryRoot = join(fixture, 'user-data', 'managed-skill-library')
    await mkdir(skillLibraryRoot, { recursive: true })
    process.stdout.write(`Automatic acceptance userData: ${join(fixture, 'user-data')}; Skill Library: ${skillLibraryRoot}; no Core/SQLite/Runtime\n`)
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
    for (const required of [
      'Empty directories survive switching and restart; completed migration performs no reads or writes during navigation refresh',
      'An empty completed list stays empty until an explicit add',
      'Failed import keeps legacy projects; failed adds remain absent until a successful add',
      'First preference read failure preserves ordinary navigation',
      'Optimistic folder move, immediate rollback and late-reply handling in the production sidebar',
      'Maximum-length project paths remain usable during sidebar reorder'
    ]) assert.ok(report.cases.includes(required), required)
    if (process.env.ROVAI_PROJECT_DIRECTORIES_ONLY === '1') return
    assert.ok(report.cases.includes('Reordering folders in another window lets an in-flight Thread open clear its manual unread reminder'))
    assert.ok(report.cases.includes('Desktop cold restore locates the unpinned off-screen active row once and preserves it through pagination'))
    assert.ok(report.cases.includes('Cached and off-page Thread selection respects current-page ownership, manual scrolling and folding'))
    assert.ok(report.cases.includes('Ordinary Camp switching reads only the target row without unrelated queries'))
    assert.ok(report.cases.includes('Navigation search applies a one-shot body hit anchor to an already active Thread'))
    assert.ok(report.cases.includes('Navigation search fits five themes at compact and large desktop sizes'))
    assert.ok(report.cases.includes('Navigation search continuation supports native keyboard focus and activation'))
    assert.ok(report.cases.includes('Navigation search status layout distinguishes empty, retry and scroll-to-continue'))
    assert.ok(report.cases.includes('Navigation search reveals a loaded hit behind file preview or reply details'))
    assert.ok(report.cases.includes('Cached Thread revisits show messages before authority returns without redundant reads, with Tasks off and on'))
    assert.ok(report.cases.includes('Actual Task disable clears incompatible caches and panels while rejecting late enabled UI'))
    assert.ok(report.cases.includes('Task capability changes during enter cannot commit the previous capability projection'))
    assert.ok(report.cases.includes('User stops do not create a Thread unread reminder, including lost receipts and navigation races'))
    assert.ok(report.cases.includes('Accepted deletion discards in-flight Web refresh failures and queued reads'))
    assert.ok(report.cases.includes('Web refresh confirms external deletion before removing the current Thread'))
    assert.ok(report.cases.includes('Web refresh backs off and reports persistent failures once in place'))
    assert.ok(report.cases.includes('Web refresh retries retain updates that arrive before the response'))
    assert.ok(report.cases.includes('The Skill picker loads its catalog on demand'))
    assert.ok(report.cases.includes('Desktop Memory polling recovery refreshes content and pending count once without replaying old notices'))
    assert.ok(report.cases.includes('Desktop global Memory changes refresh across Threads and user management without duplicate polling reads'))
    assert.ok(report.cases.includes('Pending pushes never enter history and memory normalization cannot supersede newer navigation'))
    assert.ok(report.cases.includes('One-click creation success and failure respect newer navigation intent'))
    assert.ok(report.cases.includes('Member history replay selects the requested editor while retaining new-member drafts'))
    assert.ok(report.cases.includes('Runtime availability refreshes health and installations without reloading members'))
    assert.ok(report.cases.includes('Runtime discovery coalesces same-tick events without reloading members'))
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
