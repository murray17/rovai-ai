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
const fixtureSource = join(root, 'scripts/fixtures/camp-open-projection')

test('business-only CampOpen keeps cards, earlier pages and reading position across refresh', { timeout: 60_000 }, async (t) => {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-camp-open-projection-test-'))
  let child
  let closed
  try {
    await build({
      configFile: false, root: fixtureSource, base: './', logLevel: 'error', plugins: [react()],
      resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      build: { outDir: join(fixture, 'renderer'), minify: false }
    })
    const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete environment.ELECTRON_RUN_AS_NODE
    process.stdout.write(`Automatic acceptance userData: ${join(fixture, 'user-data')}; no Core/SQLite/Skill Library/Runtime\n`)
    child = spawn(electron, [
      join(fixtureSource, 'main.cjs'), join(fixture, 'renderer/index.html'), join(fixture, 'user-data'),
      ...(process.platform === 'linux'
        || process.env.ROVAI_CAMP_OPEN_ACCEPT_NO_SANDBOX === '1'
        ? ['--no-sandbox']
        : [])
    ], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 45_000)
    let code
    try { [code] = await closed } finally { clearTimeout(timeout) }
    assert.equal(code, 0, `CampOpen refresh regression failed:\n${output}`)
    const report = JSON.parse(output.split('\n').find(line => line.startsWith('{')))
    assert.equal(report.ok, true)
    process.stdout.write(`${JSON.stringify(report)}\n`)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await closed
    }
    if (process.env.ROVAI_KEEP_CAMP_OPEN_FIXTURE === '1') {
      process.stdout.write(`CampOpen fixture: ${fixture}\n`)
    } else {
      await rm(fixture, { recursive: true, force: true })
    }
  }
})
