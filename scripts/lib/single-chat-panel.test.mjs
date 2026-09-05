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
const fixtureSource = join(root, 'scripts/fixtures/single-chat-panel')

test('production Single Chat panel preserves private conversation layout and terminal disclosure', { timeout: 90_000 }, async (t) => {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-single-chat-panel-test-'))
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
    child = spawn(electron, [
      join(fixtureSource, 'main.cjs'),
      join(fixture, 'renderer/index.html'),
      join(fixture, 'user-data'),
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
    ], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk.toString() })
    child.stderr.on('data', (chunk) => { output += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 75_000)
    let code
    try {
      [code] = await closed
    } finally {
      clearTimeout(timeout)
    }
    assert.equal(code, 0, `Single Chat native UI regression failed:\n${output}`)
    const reportLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('"verified"'))
    assert.ok(reportLine, `Single Chat native UI report was missing:\n${output}`)
    const report = JSON.parse(reportLine)
    assert.equal(report.ok, true)
    assert.deepEqual(report.verified, {
      selectorTriggerAndOptionAvatars: true,
      transcriptAvatarFree: true,
      rightUserLeftAgentLayout: true,
      chineseTerminalDuration: true,
      terminalExecutionAutoCollapse: true,
      groupedCommands: 3,
      finalMessageExpanded: true,
      directEndConfirmation: true,
      campComposerParity: true,
      composerKeyboardSemantics: true,
      privateAttachments: true,
      agentMessagesWithoutFill: true,
      runningStopAndQueueComposer: true,
      dayAndNight: true,
      compactNoOverflow: true
    })
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await closed
    }
    if (process.env.ROVAI_KEEP_SINGLE_CHAT_FIXTURE === '1') {
      process.stdout.write(`Single Chat fixture: ${fixture}\n`)
    } else {
      await rm(fixture, { recursive: true, force: true })
    }
  }
})
