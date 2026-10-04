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
const source = join(root, 'scripts/fixtures/windows-window-close')
test('Windows close choice uses production Main, preload and UI; hide preserves the original window and normal quit', { timeout: 120_000 }, async t => {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-windows-close-'))
  let child, closed
  try {
    await build({ configFile: false, root: source, base: './', logLevel: 'error', plugins: [react()],
      resolve: { alias: { '@renderer': join(root, 'apps/desktop/src/renderer/src'), '@shared': join(root, 'apps/desktop/src/shared'), '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      build: { outDir: join(fixture, 'renderer') } })
    for (const entry of ['owner', 'preload']) {
      await build({ configFile: false, root, logLevel: 'error',
        plugins: [{ name: 'fixture-native-assets', enforce: 'pre', load(id) { if (id.endsWith('?asset')) return `export default ${JSON.stringify(id.slice(0, -6))}` } }],
        build: { ssr: join(source, `${entry}.ts`), outDir: join(fixture, entry), minify: false,
          rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: 'index.cjs' } } } })
    }
    const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete env.ELECTRON_RUN_AS_NODE
    process.stdout.write(`Automatic acceptance; userData=${join(fixture, 'user-data')}; isolated Skill Library=${join(fixture, 'user-data/managed-skill-library')}; no Core/Runtime\n`)
    child = spawn(electron, [join(source, 'main.cjs'), fixture, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk) })
    child.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk) })
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000)
    try {
      const [code] = await closed
      assert.equal(code, 0, output)
      const report = JSON.parse(output.split('\n').find(line => line.startsWith('{"ok"')))
      assert.equal(report.ok, true)
      assert.equal(report.prepares, 2)
      assert.equal(report.drains, 1)
      assert.equal(report.nativeWindowsTray, process.platform === 'win32')
    } finally { clearTimeout(timer) }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed }
    if (process.env.ROVAI_KEEP_WINDOWS_CLOSE_FIXTURE === '1') process.stdout.write(`Window close evidence: ${fixture}\n`)
    else await rm(fixture, { recursive: true, force: true })
  }
})
