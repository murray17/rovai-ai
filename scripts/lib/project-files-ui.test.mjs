import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'electron'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'
const root = resolve(import.meta.dirname, '../..')
test('real project browser links the file entry and sidecar, preserves resizing, search and file previews', { timeout: 120_000 }, async t => {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-project-browser-ui-')))
  t.diagnostic(`Isolated userData: ${join(fixture, 'userData')}; Core: ${join(fixture, 'data')}; Skills: ${join(fixture, 'data/skills')}`)
  const source = join(root, 'scripts/fixtures/project-files')
  let child, closed
  try {
    await build({ configFile: false, root: source, base: './', logLevel: 'error', plugins: [react()], resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } }, build: { outDir: join(fixture, 'ui'), emptyOutDir: true } })
    const require = createRequire(import.meta.url), esbuild = createRequire(require.resolve('vite'))('esbuild')
    await esbuild.build({ stdin: { contents: "export {FilePreviewService} from './apps/desktop/src/main/file-preview/file-preview-service'; export {CoreFilePreviewSourceAuthority} from './apps/desktop/src/main/file-preview/file-preview-authority'", resolveDir: root, loader: 'ts' }, outfile: join(fixture, 'service.cjs'), bundle: true, platform: 'node', format: 'cjs' })
    child = spawn(electron, [join(source, 'main.cjs'), root, fixture], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close'); let output = ''
    child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
    const [code] = await closed
    assert.equal(code, 0, output)
    t.diagnostic(output.split('\n').filter(line => line.startsWith('{')).join('\n'))
  } finally {
    if (child && child.exitCode === null) { child.kill('SIGKILL'); await closed }
    if (process.env.ROVAI_KEEP_PROJECT_FILES_FIXTURE === '1') t.diagnostic(`Screenshots and isolated fixture: ${fixture}`)
    else await rm(fixture, { recursive: true, force: true })
  }
})
