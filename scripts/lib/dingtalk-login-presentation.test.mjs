import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import react from '@vitejs/plugin-react'
import electron from 'electron'
import ts from 'typescript'
import { build } from 'vite'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'

const root = resolve(import.meta.dirname, '../..')
const source = join(root, 'scripts/fixtures/dingtalk-login-presentation')
const require = createRequire(import.meta.url)
const esbuild = createRequire(require.resolve('vite'))('esbuild')

test('DingTalk login uses the production Rovai dialog and a separate sandboxed native view', { timeout: 60_000 }, async (t) => {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-dingtalk-login-presentation-'))
  let child
  let closed
  try {
    for (const directory of ['user-data', 'session-data', 'managed-skill-library']) {
      await mkdir(join(fixture, directory), { mode: 0o700 })
    }
    await build({ configFile: false, root: source, base: './', logLevel: 'error', plugins: [react()],
      resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      build: { outDir: join(fixture, 'renderer'), minify: false } })
    await esbuild.build({ entryPoints: [join(root, 'apps/desktop/src/main/dingtalk-login-view.ts')],
      outfile: join(fixture, 'login-view.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
    const preload = ts.transpileModule(await readFile(join(root, 'apps/desktop/src/preload/index.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText
    await writeFile(join(fixture, 'preload.cjs'), preload + '\n' +
      'require("electron").contextBridge.exposeInMainWorld("loginFixture", {' +
      'stage: value => require("electron").ipcRenderer.invoke("fixture:stage", value),' +
      'facts: () => require("electron").ipcRenderer.invoke("fixture:facts") });\n')
    const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete environment.ELECTRON_RUN_AS_NODE
    child = spawn(electron, [join(source, 'main.cjs'), fixture,
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
    ], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 45_000)
    let code
    try { [code] = await closed } finally { clearTimeout(timeout) }
    assert.equal(code, 0, `DingTalk login presentation failed:\n${stdout}\n${stderr}`)
    const report = JSON.parse(stdout.split('\n').find(line => line.startsWith('{')))
    assert.equal(report.ok, true)
    assert.ok(report.cases.includes('QR is readable before slow page resources finish'))
    assert.ok(report.cases.includes('native page has no Rovai bridge or Node'))
    assert.ok(report.cases.includes('200% zoom clips the native view inside the dialog'))
    assert.ok(report.cases.length >= 10)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await closed
    }
    if (process.env.ROVAI_KEEP_DINGTALK_LOGIN_FIXTURE === '1') {
      process.stdout.write(`DingTalk login fixture: ${fixture}\n`)
    } else {
      await rm(fixture, { recursive: true, force: true })
    }
  }
})
