// The official kernel remains unchanged. Only groups created by its detached
// spawn calls enter this owner ledger; no process-name or system-wide scan.
const cp = require('node:child_process')
const spawn = cp.spawn
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { AsyncLocalStorage } = require('node:async_hooks')
const cliScope = new AsyncLocalStorage()
function snapshotCliContext(active) {
  const root = process.env.ROVAI_ZCODE_CLI_CONTEXT_DIR
  const source = process.env.ROVAI_CLI_CONTEXT
  if (!root || !source) return undefined
  let bytes = fs.readFileSync(source)
  if (!active) bytes = Buffer.from(JSON.stringify({ ...JSON.parse(bytes), lease: null }))
  const name = crypto.createHash('sha256').update(bytes).digest('hex')
  const snapshot = path.join(root, `${name}.json`)
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  try { fs.writeFileSync(snapshot, bytes, { mode: 0o600, flag: 'wx' }) }
  catch (error) { if (error.code !== 'EEXIST' || !fs.readFileSync(snapshot).equals(bytes)) throw new Error('ZCode CLI context snapshot unavailable') }
  return snapshot
}
if (process.env.ROVAI_ZCODE_CLI_CONTEXT_DIR) {
  const emit = process.stdin.emit
  // Native NDJSON dispatch attaches its promise chain inside the data callback.
  // Keep the initiating Run's lease through async subagents and delayed spawns,
  // even while later requests are handled by this same Node process.
  process.stdin.emit = function (event, ...args) {
    if (event !== 'data') return Reflect.apply(emit, this, [event, ...args])
    return cliScope.run(snapshotCliContext(true), () => Reflect.apply(emit, this, [event, ...args]))
  }
}
function freezeCliContext(args) {
  const root = process.env.ROVAI_ZCODE_CLI_CONTEXT_DIR
  if (!root) return args // Ordinary Probe never enables credential snapshots.
  const index = Array.isArray(args[1]) ? 2 : 1
  const options = args[index] ?? {}
  const env = options.env ?? process.env
  if (!env.ROVAI_CLI_CONTEXT) return args
  // Unscoped initialization/timers get no business lease. Never fall back to
  // whichever newer Run happens to be bound when a delayed child starts.
  const snapshot = cliScope.getStore() ?? snapshotCliContext(false)
  const next = [...args]
  next[index] = { ...options, env: { ...env, ROVAI_CLI_CONTEXT: snapshot } }
  return next
}
if (process.platform === 'win32') {
  // ManagedProcess atomically owns the native Host and every descendant in a
  // non-breakaway, kill-on-close Windows Job. Unix negative-PID groups do not
  // exist here; keep lease freezing but let the Core-owned Job prove cleanup.
  cp.spawn = function (...args) {
    args = freezeCliContext(args)
    const index = Array.isArray(args[1]) ? 2 : 1
    args[index] = { ...args[index], windowsHide: true }
    return Reflect.apply(spawn, this, args)
  }
  // Rust canonical paths carry a Win32 verbatim prefix. Node's CommonJS
  // realpath resolver rejects that prefix even though fs and CreateProcess
  // accept it. Preserve the resolved target while using its ordinary spelling.
  const kernel = process.argv[1]
  const loadPath = kernel.startsWith('\\\\?\\UNC\\')
    ? `\\\\${kernel.slice(8)}`
    : kernel.startsWith('\\\\?\\') ? kernel.slice(4) : kernel
  require(loadPath)
} else {
const owner = process.pid
const groups = new Set()
let exiting = false
const killGroup = (pid) => {
  try { process.kill(-pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
}
function watchOwner() {
  const fs = require('node:fs')
  const owner = Number(process.argv[1])
  if (!Number.isSafeInteger(owner) || owner <= 1) process.exit(70)
  process.stdout.on('error', () => {}) // Owner may die before the EOF cleanup callback.
  const report = process.env.ROVAI_ZCODE_OWNER_REPORT
  const groups = new Set([owner])
  const closedLeaders = new Set()
  let buffered = ''
  const exists = (pid) => {
    try { process.kill(-pid, 0); return true } catch (error) {
      if (error.code === 'ESRCH') return false
      // Permission errors do not establish that the group is empty.
      return true
    }
  }
  const forgetEmpty = (pid) => {
    if (exists(pid)) return false
    groups.delete(pid)
    closedLeaders.delete(pid)
    process.stdout.write(`gone:${pid}\n`)
    return true
  }
  // A direct shell's close is only a cue to observe its owned group. Descendants
  // may still be running with all inherited stdio already closed.
  const monitor = setInterval(() => {
    for (const pid of closedLeaders) forgetEmpty(pid)
  }, 100)
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffered += chunk
    if (buffered.length > 65536) process.exit(70)
    let newline
    while ((newline = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      const pid = Number(line.slice(1))
      if (!Number.isSafeInteger(pid) || pid <= 1) process.exit(70)
      if (line[0] === '+') groups.add(pid)
      else if (line[0] === '?' && groups.has(pid)) closedLeaders.add(pid)
      else process.exit(70)
      if (groups.size > 4096) process.exit(70)
    }
  })
  process.stdin.once('end', () => {
    clearInterval(monitor)
    const deadline = Date.now() + 2000
    let signalFailed = false
    setTimeout(function clean() {
      for (const pid of [...groups].reverse()) {
        if (!exists(pid)) { groups.delete(pid); continue }
        try { process.kill(-pid, 'SIGKILL') } catch (error) {
          if (error.code !== 'ESRCH') signalFailed = true
        }
      }
      for (const pid of groups) if (!exists(pid)) groups.delete(pid)
      if (groups.size && Date.now() < deadline) { setTimeout(clean, 25); return }
      const confirmed = groups.size === 0 && !signalFailed
      if (report) {
        try {
          fs.writeFileSync(`${report}.tmp`, JSON.stringify({ confirmed, pendingGroups: groups.size, signalFailed }), { mode: 0o600 })
          fs.renameSync(`${report}.tmp`, report)
        } catch { process.exit(70) }
      }
      process.exit(confirmed ? 0 : 70)
    }, 25)
  })
  process.stdout.write('ready\n')
}
const watcher = spawn(process.execPath, ['--eval', `(${watchOwner.toString()})()`, String(owner)], {
  detached: true, stdio: ['pipe', 'pipe', 'ignore']
})
const failClosed = () => {
  if (exiting) return
  for (const pid of groups) killGroup(pid)
  killGroup(owner)
}
watcher.once('error', failClosed)
watcher.once('exit', failClosed)
watcher.stdin.on('error', failClosed)
process.once('exit', () => { exiting = true })
cp.spawn = function (...args) {
  args = freezeCliContext(args)
  const child = Reflect.apply(spawn, this, args)
  const options = Array.isArray(args[1]) ? args[2] : args[1]
  if (child.pid && options?.detached === true) {
    const pid = child.pid
    groups.add(pid)
    watcher.stdin.write(`+${pid}\n`)
    child.once('close', () => { watcher.stdin.write(`?${pid}\n`) })
  }
  return child
}
let buffered = ''
let ready = false
watcher.stdout.setEncoding('utf8')
watcher.stdout.on('data', (chunk) => {
  buffered += chunk
  if (buffered.length > 65536) { failClosed(); return }
  let newline
  while ((newline = buffered.indexOf('\n')) !== -1) {
    const line = buffered.slice(0, newline)
    buffered = buffered.slice(newline + 1)
    if (!ready && line === 'ready') {
      ready = true
      watcher.unref()
      watcher.stdin.unref()
      watcher.stdout.unref()
      require(process.argv[1])
    } else if (ready && /^gone:[0-9]+$/.test(line)) {
      groups.delete(Number(line.slice(5)))
    } else failClosed()
  }
})
}
