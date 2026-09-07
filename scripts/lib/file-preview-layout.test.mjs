import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import react from '@vitejs/plugin-react'
import electron from 'electron'
import { build } from 'vite'
import ts from 'typescript'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'

const root = resolve(import.meta.dirname, '../..')
const fixtureSource = join(root, 'scripts/fixtures/file-preview-layout')

test('production file preview keeps split geometry, reading state and stable preferences through native input', { timeout: 90_000 }, async (t) => {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-file-preview-layout-test-'))
  let child
  let closed
  try {
    const shortcutSource = await readFile(join(root, 'apps/desktop/src/shared/close-tab-shortcut.ts'), 'utf8')
    const shortcutCode = ts.transpileModule(shortcutSource, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText
    const shortcutModule = join(fixture, 'close-tab-shortcut.cjs')
    const shortcutPreload = join(fixture, 'close-tab-preload.cjs')
    await writeFile(shortcutModule, shortcutCode)
    await writeFile(shortcutPreload, `${shortcutCode}\nconst { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('previewWindowControls', {
  onCloseTabRequested: exports.createCloseTabShortcutHandler(ipcRenderer)
})`)
    await build({
      configFile: false, root: fixtureSource, base: './', logLevel: 'error', plugins: [react()],
      resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      build: { outDir: join(fixture, 'renderer'), minify: false }
    })
    const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete environment.ELECTRON_RUN_AS_NODE
    process.stdout.write(`Isolated file preview userData: ${join(fixture, 'user-data')} (no Core/Runtime)\n`)
    child = spawn(electron, [
      join(fixtureSource, 'main.cjs'), join(fixture, 'renderer/index.html'), join(fixture, 'user-data'),
      shortcutModule, shortcutPreload,
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
    ], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 75_000)
    let code
    try { [code] = await closed } finally { clearTimeout(timeout) }
    assert.equal(code, 0, `File preview interaction regression failed:\n${output}`)
    const report = JSON.parse(output.split('\n').find(line => line.startsWith('{')))
    assert.equal(report.ok, true)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await closed
    }
    if (process.env.ROVAI_KEEP_FILE_PREVIEW_FIXTURE === '1') {
      process.stdout.write(`File preview fixture: ${fixture}\n`)
    } else {
      await rm(fixture, { recursive: true, force: true })
    }
  }
})
