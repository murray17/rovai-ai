import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  coreDataDirectoryArguments,
  removeEphemeralRuntimeCampFilesRoot
} from './runtime-camp-files-root.mjs'

const repository = resolve(import.meta.dirname, '../..')
const binary = join(repository, 'target/debug/rovai-host')

// Owns the new CLI -> embedded Core -> process signal seam. The existing stdio
// suite cannot prove that Host signals reach the in-process shutdown protocol.
// This fixture runs no model and reopens only to prove lease release/recovery.
test('Headless Host refuses missing or occupied authority and settles before process exit', {
  timeout: 90_000,
  skip: process.platform === 'win32' ? 'Windows console events require native console acceptance' : false
}, async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-host-lifecycle-')))
  const dataDir = join(fixture, 'data')
  const args = [
    'run',
    ...coreDataDirectoryArguments(dataDir),
    '--skill-library-root', join(dataDir, 'skills'),
    '--mcp-config-path', join(dataDir, 'mcp.json')
  ]
  const processes = []
  const start = (extra = []) => {
    const host = launch([...args, ...extra])
    processes.push(host)
    return host
  }
  try {
    const absent = start()
    assert.equal((await within(absent.closed)).code, 1, absent.output())
    assert.match(absent.output(), /authority_required_existing_missing/)
    await assert.rejects(access(join(dataDir, 'rovai.sqlite')), { code: 'ENOENT' })

    const first = start(['--initialize'])
    await within(first.ready)
    const second = start()
    assert.equal((await within(second.closed)).code, 1, second.output())
    assert.match(second.output(), /owned_by_active_core/)
    assert.equal(first.child.exitCode, null, 'a refused contender must not stop the owner')

    assert.equal(first.child.kill('SIGTERM'), true)
    const stopped = await within(first.closed)
    assert.deepEqual(stopped, { code: 0, signal: null }, first.output())
    assert.match(first.output(), /Host Core stopped after durable settlement/)
    await access(join(dataDir, 'rovai.sqlite'))

    const reopened = start()
    await within(reopened.ready)
    assert.equal(reopened.child.kill('SIGINT'), true)
    assert.deepEqual(await within(reopened.closed), { code: 0, signal: null }, reopened.output())
    assert.match(reopened.output(), /Host Core stopped after durable settlement/)
  } finally {
    for (const host of processes) {
      if (host.child.exitCode === null && host.child.signalCode === null) host.child.kill('SIGKILL')
      await within(host.closed)
    }
    await removeEphemeralRuntimeCampFilesRoot(dataDir, { temporaryDirectory: fixture })
    await rm(fixture, { recursive: true, force: true })
  }
})

function launch(args) {
  const child = spawn(binary, args, { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let readyResolve
  let readyReject
  const ready = new Promise((resolveReady, rejectReady) => {
    readyResolve = resolveReady
    readyReject = rejectReady
  })
  // Refusal cases intentionally await process exit instead of readiness.
  void ready.catch(() => {})
  const collect = (chunk) => {
    output = (output + chunk.toString()).slice(-65_536)
    if (output.includes('Host Core is ready')) readyResolve()
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const closed = new Promise((resolveClosed) => {
    child.once('error', (error) => {
      readyReject(error)
      resolveClosed({ error: error.message })
    })
    child.once('close', (code, signal) => {
      readyReject(new Error(`Host exited before readiness: ${output}`))
      resolveClosed({ code, signal })
    })
  })
  return { child, closed, ready, output: () => output }
}

async function within(promise) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Host lifecycle step exceeded 15 seconds')), 15_000)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
