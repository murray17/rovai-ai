// Rovai owns process lifetime; the official ZCode kernel is loaded unchanged.
// Native detached Bash groups outlive app-server on EOF. A companion retains
// their group identities and reaps them if the native process or Core dies.
const cp = require('node:child_process')
const spawn = cp.spawn
const owner = process.pid // ManagedProcess creates this exact process group.
const groups = new Set()
let exiting = false
const killGroup = (pid) => {
  try { process.kill(-pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
}
function watchOwner() {
  const owner = Number(process.argv[1])
  if (!Number.isSafeInteger(owner) || owner <= 1) process.exit(70)
  const groups = new Set([owner])
  let buffered = ''
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
      else if (line[0] === '-') groups.delete(pid)
      else process.exit(70)
    }
  })
  process.stdin.once('end', () => {
    // Allow the official process's normal exit to preserve its exit code.
    // Detached groups remain ours until their stdio-close acknowledgement.
    setTimeout(() => {
      for (const pid of [...groups].reverse()) {
        try { process.kill(-pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') process.exitCode = 70 }
      }
      process.exit(process.exitCode ?? 0)
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
  const child = Reflect.apply(spawn, this, args)
  const options = Array.isArray(args[1]) ? args[2] : args[1]
  if (child.pid && options?.detached === true) {
    const pid = child.pid
    groups.add(pid)
    watcher.stdin.write(`+${pid}\n`)
    child.once('close', () => { groups.delete(pid); watcher.stdin.write(`-${pid}\n`) })
  }
  return child
}
let ready = ''
watcher.stdout.setEncoding('utf8')
watcher.stdout.on('data', (chunk) => {
  ready += chunk
  if (ready !== 'ready\n') { if (ready.length > 6) failClosed(); return }
  watcher.stdout.removeAllListeners('data')
  watcher.unref()
  watcher.stdin.unref()
  watcher.stdout.unref()
  require(process.argv[1])
})
