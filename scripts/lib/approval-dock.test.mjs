import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import react from '@vitejs/plugin-react'
import electron from 'electron'
import { build } from 'vite'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'

const root = resolve(import.meta.dirname, '../..')
const source = join(root, 'scripts/fixtures/approval-dock')

test('production approvals preserve decision identity, safe focus and readable reasons across desktop and phone layouts', { timeout: 90_000 }, async (t) => {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-approval-dock-test-'))
  const userData = join(fixture, 'user-data')
  const skillRoot = join(userData, 'managed-skill-library')
  await mkdir(skillRoot, { recursive: true })
  let child
  let closed
  try {
    await build({ configFile: false, root: source, base: './', logLevel: 'error', plugins: [react()],
      resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      build: { outDir: join(fixture, 'renderer'), minify: false } })
    const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete environment.ELECTRON_RUN_AS_NODE
    process.stdout.write(`Isolated approval userData: ${userData}; Skill Library: ${skillRoot} (unused); no Core/Runtime\n`)
    child = spawn(electron, [join(source, 'main.cjs'), join(fixture, 'renderer/index.html'), userData,
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 75_000)
    let code
    try { [code] = await closed } finally { clearTimeout(timeout) }
    assert.equal(code, 0, `Approval interaction regression failed:\n${output}`)
    assert.equal(JSON.parse(output.split('\n').find(line => line.startsWith('{'))).ok, true)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed }
    if (process.env.ROVAI_KEEP_APPROVAL_FIXTURE === '1') process.stdout.write(`Approval screenshots: ${fixture}\n`)
    else await rm(fixture, { recursive: true, force: true })
  }
})
