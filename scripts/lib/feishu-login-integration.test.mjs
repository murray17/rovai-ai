import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import react from '@vitejs/plugin-react'
import electron from 'electron'
import { build } from 'vite'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'

const root = resolve(import.meta.dirname, '../..')
const source = join(root, 'scripts/fixtures/feishu-login')
const require = createRequire(import.meta.url)
const esbuild = createRequire(require.resolve('vite'))('esbuild')

test('Feishu uses Session HTTP, passive bootstrap and the production login Dialog', { timeout: 90_000 }, async t => {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-feishu-login-'))
  let child
  let closed
  try {
    for (const directory of ['user-data', 'session-data', 'managed-skill-library']) {
      await mkdir(join(fixture, directory), { mode: 0o700 })
    }
    await build({ configFile: false, root: source, base: './', logLevel: 'error', plugins: [react()],
      resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      build: { outDir: join(fixture, 'renderer'), minify: false } })
    await esbuild.build({ stdin: {
      contents: "export { ElectronFeishuDeveloperSessionService } from './apps/desktop/src/main/feishu-developer-session'; export { FeishuLoginProtocol } from './apps/desktop/src/main/feishu-login-protocol'; export { FeishuSessionHttp } from './apps/desktop/src/main/feishu-session-http'; export { requestInFeishuSession } from './apps/desktop/src/main/feishu-electron-transport'",
      resolveDir: root, loader: 'ts'
    }, outfile: join(fixture, 'service.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
    const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete environment.ELECTRON_RUN_AS_NODE
    child = spawn(electron, [join(source, 'main.cjs'), fixture, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
      { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 75_000)
    let code
    try { [code] = await closed } finally { clearTimeout(timeout) }
    assert.equal(code, 0, `Feishu login integration failed:\n${stdout}\n${stderr}`)
    const report = JSON.parse(stdout.split('\n').find(line => line.startsWith('{')))
    assert.equal(report.ok, true)
    assert.ok(report.cases.length >= 6)
    if (environment.ROVAI_FEISHU_LIVE_PROBE === '1') {
      assert.deepEqual(report.liveProbe, { init: 'valid', polling: 'waiting', serverExpiry: null })
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await closed
    }
    if (process.env.ROVAI_KEEP_FEISHU_LOGIN_FIXTURE === '1') process.stdout.write(`Feishu login fixture: ${fixture}\n`)
    else await rm(fixture, { recursive: true, force: true })
  }
})
