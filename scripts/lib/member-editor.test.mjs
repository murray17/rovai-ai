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
const source = join(root, 'scripts/fixtures/member-editor')
test(
  'inline member editor preserves drafts, native runtime choices and approved geometry',
  { timeout: 180_000 },
  async (t) => {
    if (!admitElectronIntegrationTest(t)) return
    const fixture = await mkdtemp(join(tmpdir(), 'rovai-member-editor-test-'))
    let child,
      closed,
      passed = false
    try {
      await build({
        configFile: false,
        root: source,
        base: './',
        logLevel: 'error',
        plugins: [react()],
        resolve: {
          alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') }
        },
        build: { outDir: join(fixture, 'renderer'), minify: false }
      })
      const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
      delete env.ELECTRON_RUN_AS_NODE
      child = spawn(
        electron,
        [
          join(source, 'main.cjs'),
          join(fixture, 'renderer/index.html'),
          join(fixture, 'user-data'),
          ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
        ],
        { env, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      closed = once(child, 'close')
      let output = ''
      child.stdout.on('data', (chunk) => {
        output += chunk
      })
      child.stderr.on('data', (chunk) => {
        output += chunk
      })
      const timer = setTimeout(() => child.kill('SIGKILL'), 150_000)
      let code
      try {
        ;[code] = await closed
      } finally {
        clearTimeout(timer)
      }
      assert.equal(code, 0, output)
      console.log(
        output
          .split('\n')
          .filter((line) => line.startsWith('{'))
          .join('\n')
      )
      passed = true
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await closed
      }
      if (!passed || process.env.ROVAI_KEEP_MEMBER_EDITOR_FIXTURE === '1')
        console.log(`Member editor fixture: ${fixture}`)
      else await rm(fixture, { recursive: true, force: true })
    }
  }
)
