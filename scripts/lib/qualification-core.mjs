import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { access } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { runCaptured } from './qualification-common.mjs'

export async function findCompetingRovaiProcesses() {
  const result = await runCaptured('/bin/ps', ['-axo', 'pid=,ppid=,command='], { timeoutMs: 10_000 })
  if (result.code !== 0) throw new Error(`could not inspect running processes: ${result.stderr}`)
  return parseProcessTable(result.stdout).filter((process) => {
    const command = process.command
    return /^(?:\S*\/)rovai-core(?:\s|$)/.test(command)
      || /^rovai-core(?:\s|$)/.test(command)
      || /^\S*Rovai-ai\.app\/Contents\/MacOS\/Rovai-ai(?:\s|$)/.test(command)
  })
}

export async function processTable() {
  const result = await runCaptured('/bin/ps', ['-axo', 'pid=,ppid=,command='], { timeoutMs: 10_000 })
  if (result.code !== 0) throw new Error(`could not inspect running processes: ${result.stderr}`)
  return parseProcessTable(result.stdout)
}

export function descendantsOf(table, rootPid) {
  const descendants = new Set()
  let changed = true
  while (changed) {
    changed = false
    for (const process of table) {
      if ((process.ppid === rootPid || descendants.has(process.ppid)) && !descendants.has(process.pid)) {
        descendants.add(process.pid)
        changed = true
      }
    }
  }
  return [...descendants]
}

export async function waitForProcessesToExit(pids, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let remaining = [...new Set(pids)]
  while (remaining.length > 0 && Date.now() < deadline) {
    const table = await processTable()
    const live = new Set(table.map((process) => process.pid))
    remaining = remaining.filter((pid) => live.has(pid))
    if (remaining.length > 0) await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  return remaining
}

export function startQualificationCore({
  coreExecutable,
  dataDirectory,
  workingDirectory,
  runtimeCacheDirectory
}) {
  const executable = resolve(coreExecutable)
  const args = ['--data-dir', resolve(dataDirectory)]
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (key.startsWith('ROVAI_QUALIFICATION_')) delete environment[key]
  }
  environment.CARGO_TARGET_DIR = resolve(runtimeCacheDirectory, 'cargo-target')
  environment.npm_config_cache = resolve(runtimeCacheDirectory, 'npm-cache')
  environment.PNPM_HOME = environment.PNPM_HOME ?? ''
  const child = spawn(executable, args, {
    cwd: workingDirectory,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const pending = new Map()
  const stderrHash = createHash('sha256')
  let stderrBytes = 0
  let stderrTail = ''
  let nextId = 1
  let stopping = false
  let closeResult = null
  const closePromise = new Promise((resolveClose) => {
    child.once('close', (code, signal) => {
      closeResult = { code, signal }
      resolveClose(closeResult)
      if (!stopping) rejectPending(new Error(`rovai-core exited early (code=${code}, signal=${signal})`))
    })
  })
  child.stderr.on('data', (chunk) => {
    stderrHash.update(chunk)
    stderrBytes += chunk.length
    stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-16_384)
  })
  child.once('error', (error) => rejectPending(error))
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch (error) {
      rejectPending(new Error(`rovai-core emitted invalid JSON: ${error.message}`))
      return
    }
    if (message.method) return
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })

  function rejectPending(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }

  return {
    pid: child.pid,
    executable,
    request(method, params = {}, timeoutMs = 60_000) {
      if (child.exitCode !== null) return Promise.reject(new Error(`rovai-core is not running: ${method}`))
      const id = nextId++
      return new Promise((resolveRequest, rejectRequest) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          rejectRequest(new Error(`timed out waiting for ${method}`))
        }, timeoutMs)
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
      })
    },
    async stop(timeoutMs = 30_000) {
      stopping = true
      if (child.exitCode === null) child.stdin.end()
      await Promise.race([
        closePromise,
        unrefTimeout(timeoutMs)
      ])
      if (child.exitCode === null) child.kill('SIGTERM')
      await Promise.race([
        closePromise,
        unrefTimeout(5_000)
      ])
      if (child.exitCode === null) child.kill('SIGKILL')
      await closePromise
      rejectPending(new Error('rovai-core stopped'))
      return {
        ...closeResult,
        stderrDigest: stderrHash.digest('hex'),
        stderrBytes,
        stderrTail
      }
    }
  }
}

function unrefTimeout(milliseconds) {
  return new Promise((resolveTimeout) => {
    const timer = setTimeout(resolveTimeout, milliseconds)
    timer.unref()
  })
}

function parseProcessTable(output) {
  return output.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }] : []
  })
}

export async function assertExecutable(path) {
  await access(path)
  return { path: resolve(path), basename: basename(path) }
}
