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

const root = resolve(import.meta.dirname, '../..')
const source = join(root, 'scripts/fixtures/execution-avatar-rail')

test('production execution popover preserves dismissal, selection, scrolling and navigation through native input', { timeout: 120_000 }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-execution-avatar-rail-'))
  let child
  let closed
  let passed = false
  try {
    await build({
      configFile: false, root: source, base: './', logLevel: 'error', plugins: [react()],
      resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      build: { outDir: join(fixture, 'renderer'), minify: false }
    })
    const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete environment.ELECTRON_RUN_AS_NODE
    const userData = assertUserDataIsIsolated(join(fixture, 'user-data'))
    process.stdout.write(`Isolated execution rail fixture: ${fixture}\n`)
    const dismissalOnly = process.env.ROVAI_EXECUTION_POPOVER_DISMISSAL_ONLY === '1'
    child = spawn(electron, [join(source, 'main.cjs'), join(fixture, 'renderer/index.html'), userData,
      ...(dismissalOnly ? ['--dismissal-only'] : []),
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], {
      env: environment, stdio: ['ignore', 'pipe', 'pipe']
    })
    closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 90_000)
    let code
    try { [code] = await closed } finally { clearTimeout(timeout) }
    assert.equal(code, 0, `Execution avatar rail regression failed:\n${output}`)
    const report = JSON.parse(output.split('\n').find(line => line.startsWith('{')))
    assert.equal(report.ok, true)
    process.stdout.write(`${JSON.stringify(report)}\n`)
    passed = true
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await closed
    }
    if (!passed || process.env.ROVAI_KEEP_EXECUTION_AVATAR_FIXTURE === '1') {
      process.stdout.write(`Preserved execution rail fixture: ${fixture}\n`)
    } else {
      await rm(fixture, { recursive: true, force: true })
    }
  }
})
