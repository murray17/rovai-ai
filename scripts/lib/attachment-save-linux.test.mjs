import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electron from 'electron'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'

test('Linux native Electron asks before replacing an edited attachment download', {
  timeout: 120_000, skip: process.platform !== 'linux' && 'Linux GTK dialog acceptance requires a private Xvfb/DBus session'
}, async t => {
  if (!admitElectronIntegrationTest(t)) return
  const root = resolve(import.meta.dirname, '../..')
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-attachment-save-linux-'))
  const userData = join(fixture, 'user-data')
  const evidence = join(fixture, 'evidence')
  const require = createRequire(import.meta.url)
  const esbuild = createRequire(require.resolve('vite'))('esbuild')
  const children = []
  let log = '', passed = false
  const start = (executable, args, env) => {
    const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    const closed = once(child, 'close')
    child.stdout.on('data', chunk => { log = (log + chunk).slice(-64_000) })
    child.stderr.on('data', chunk => { log = (log + chunk).slice(-64_000) })
    children.push({ child, closed })
    return closed
  }
  let timer
  try {
    await mkdir(join(userData, 'managed-skill-library'), { recursive: true })
    await mkdir(evidence)
    const bundle = join(fixture, 'attachment-save.cjs')
    await esbuild.build({ entryPoints: [join(root, 'apps/desktop/src/main/attachment-save.ts')], outfile: bundle,
      bundle: true, platform: 'node', format: 'cjs' })
    const env = { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', ACCESSIBILITY_ENABLED: '1', GNOME_ACCESSIBILITY: '1', NO_AT_BRIDGE: '0', GTK_MODULES: 'atk-bridge', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete env.ELECTRON_RUN_AS_NODE
    console.log(`Linux automatic acceptance userData: ${userData}; unused Skill Library: ${join(userData, 'managed-skill-library')}; no Core/Runtime`)
    start('openbox', ['--sm-disable'], env)
    const app = start(electron, [join(root, 'scripts/fixtures/attachment-download/native-save.cjs'), bundle, userData, evidence, '--no-sandbox'], env)
    const driver = start('/usr/bin/python3', [join(root, 'scripts/fixtures/attachment-download/native-save-driver.py'), evidence], env)
    timer = setTimeout(() => { for (const { child } of children) child.kill('SIGKILL') }, 90_000)
    await Promise.all([app, driver].map(async completed => {
      const [code] = await completed
      assert.equal(code, 0, log)
    }))
    const native = JSON.parse(await readFile(join(evidence, 'native-report.json'), 'utf8'))
    const dialogs = JSON.parse(await readFile(join(evidence, 'native-dialog-report.json'), 'utf8'))
    assert.deepEqual(native.cases.map(item => item.result.saved), [false, true])
    assert.equal(dialogs.overwriteDialogs.length, 2)
    assert.ok(dialogs.overwriteDialogs.every(item => item.destinationPreservedBeforeConfirmation))
    console.log(JSON.stringify({ native, dialogs }))
    passed = true
  } finally {
    clearTimeout(timer)
    for (const { child, closed } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill(passed ? 'SIGTERM' : 'SIGKILL')
      await closed.catch(() => undefined)
    }
    await writeFile(join(evidence, 'electron.log'), log).catch(() => undefined)
    if (process.env.ROVAI_ATTACHMENT_DOWNLOAD_ARTIFACTS) {
      const out = join(resolve(process.env.ROVAI_ATTACHMENT_DOWNLOAD_ARTIFACTS), 'linux-native')
      await mkdir(out, { recursive: true })
      for (const name of ['native-report.json', 'native-dialog-report.json', 'overwrite-cancel.png', 'overwrite-confirm.png', 'native-failure.png', 'electron.log']) {
        await copyFile(join(evidence, name), join(out, name)).catch(() => undefined)
      }
    }
    if (!passed || process.env.ROVAI_KEEP_ATTACHMENT_DOWNLOAD_FIXTURE === '1') console.log(`Native attachment save fixture: ${fixture}`)
    else await rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
