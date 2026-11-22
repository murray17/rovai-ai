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
const source = join(root, 'scripts/fixtures/capability-workspace')

test('current Skills, toolbox and MCP preserve reading, member configuration and credential editing', { timeout: 120_000 }, async (t) => {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-capability-workspace-test-'))
  const userData = join(fixture, 'user-data')
  const skillLibraryRoot = join(userData, 'managed-skill-library')
  let child
  let closed
  try {
    await mkdir(skillLibraryRoot, { recursive: true })
    await build({ configFile: false, root: source, base: './', logLevel: 'error', plugins: [react()],
      resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      build: { outDir: join(fixture, 'renderer'), minify: false } })
    const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete environment.ELECTRON_RUN_AS_NODE
    process.stdout.write(`Isolated capability userData: ${userData}; Skill Library: ${skillLibraryRoot} (unused); no Core/Runtime\n`)
    child = spawn(electron, [join(source, 'main.cjs'), join(fixture, 'renderer/index.html'), userData,
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 90_000)
    let code
    try { [code] = await closed } finally { clearTimeout(timeout) }
    assert.equal(code, 0, `Capability interaction regression failed:\n${output}`)
    assert.equal(JSON.parse(output.split('\n').find(line => line.startsWith('{'))).ok, true)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed }
    if (process.env.ROVAI_KEEP_CAPABILITY_FIXTURE === '1') process.stdout.write(`Capability screenshots: ${fixture}\n`)
    else await rm(fixture, { recursive: true, force: true })
  }
})
