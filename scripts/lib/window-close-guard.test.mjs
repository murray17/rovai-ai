import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import electron from 'electron'
import ts from 'typescript'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'

test('native window close waits for Draft preparation, retries failure, and leaves the App running', {
  timeout: 30_000
}, async (t) => {
  if (!admitElectronIntegrationTest(t)) return
  const root = resolve(import.meta.dirname, '../..')
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-window-close-test-'))
  let child
  let closed
  try {
    const source = await readFile(join(root, 'apps/desktop/src/main/window-close-guard.ts'), 'utf8')
    const handlerPath = join(fixture, 'window-close-guard.cjs')
    await writeFile(handlerPath, ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText)
    const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete env.ELECTRON_RUN_AS_NODE
    child = spawn(electron, [
      join(root, 'scripts/fixtures/window-close-guard.cjs'), handlerPath,
      join(fixture, 'user-data'),
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
    ], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 25_000)
    try {
      const [code, signal] = await closed
      assert.equal(code, 0, `Native close regression failed (${signal}):\n${output}`)
      const report = JSON.parse(output.split('\n').find(line => line.startsWith('{')))
      assert.deepEqual(report, { ok: true, prepareCount: 2, quitRequests: 0 })
    } finally {
      clearTimeout(timeout)
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await closed
    }
    await rm(fixture, { recursive: true, force: true })
  }
})
