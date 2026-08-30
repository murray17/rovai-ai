import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import electron from 'electron'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')

test('the production preload preserves structured rejections through a real contextBridge', {
  timeout: 30_000
}, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-context-bridge-test-'))
  const preload = join(fixture, 'preload.cjs')
  let child
  let closed
  try {
    const source = await readFile(join(root, 'apps/desktop/src/preload/index.ts'), 'utf8')
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    })
    await writeFile(preload, compiled.outputText)
    const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete environment.ELECTRON_RUN_AS_NODE
    child = spawn(electron, [
      join(root, 'scripts/fixtures/rovai-request-context-bridge.cjs'),
      preload,
      join(fixture, 'user-data'),
      // Headless Linux CI may not allow Chromium user namespaces. This fixture
      // has no network content or Core and exposes only the test IPC handler.
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
    ], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 25_000)
    let code
    let signal
    try {
      [code, signal] = await closed
    } finally {
      clearTimeout(timeout)
    }
    assert.equal(code, 0, `Electron bridge regression failed (${signal}):\n${stdout}\n${stderr}`)
    const report = JSON.parse(stdout.split('\n').find(line => line.startsWith('{')))
    assert.equal(report.ok, true)
    assert.equal(report.contextIsolation, true)
    assert.equal(report.failureKinds, 4)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await closed
    }
    await rm(fixture, { recursive: true, force: true })
  }
})
