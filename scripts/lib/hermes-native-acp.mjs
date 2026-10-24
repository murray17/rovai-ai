import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { symlink } from 'node:fs/promises'

// Hermes resolves the exact interpreter and boot environment. Replace only the
// known entry point, retaining the official isolated bootstrap and native Home.
export function hermesManagedCommand(executable, script, env = process.env) {
  const command = JSON.parse(execFileSync(executable, ['--print-runtime-command'], { env, encoding: 'utf8' }))
  const entry = "runpy.run_module('hermes_cli.main', run_name='__main__', alter_sys=True)"
  if (command.length !== 4 || command[1] !== '-I' || command[2] !== '-c' || !command[3].endsWith(entry)) {
    throw new Error('Unsupported Hermes installation-bound launcher')
  }
  command[3] = command[3].slice(0, -entry.length) + "runpy.run_path(sys.argv[1], run_name='__main__')"
  return [...command, script]
}

export async function openHermesAcp({ executable, script, cwd, env }) {
  if (env.ROVAI_HERMES_DEPENDENCY_HOME) {
    await symlink(join(env.ROVAI_HERMES_DEPENDENCY_HOME, 'installs'), join(env.HERMES_HOME, 'installs'), 'dir')
      .catch(error => { if (error.code !== 'EEXIST') throw error })
  }
  env = { ...env, ROVAI_HERMES_LAUNCHER: executable,
    HERMES_DISABLE_LAZY_INSTALLS: '1',
    ROVAI_HERMES_STORAGE: env.ROVAI_HERMES_STORAGE ?? join(env.HERMES_HOME, 'rovai-storage') }
  const [command, ...args] = hermesManagedCommand(executable, script, env)
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const events = [], pending = new Map()
  let id = 0, stderr = ''
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000) })
  const rejectAll = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error) } pending.clear() }
  child.on('error', rejectAll)
  child.on('exit', code => rejectAll(new Error(`Hermes exited (${code})`)))
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
  createInterface({ input: child.stdout }).on('line', line => {
    let message
    try { message = JSON.parse(line) } catch { return }
    events.push(message)
    if (message.method && message.id !== undefined) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...(message.method === 'session/request_permission'
        ? { result: { outcome: { outcome: 'selected', optionId: message.params.options.find(o => o.kind === 'allow_once')?.optionId } } }
        : { error: { code: -32601, message: 'Unsupported acceptance client method' } }) }) + '\n')
      return
    }
    const p = pending.get(message.id)
    if (!p) return
    pending.delete(message.id); clearTimeout(p.timer)
    message.error ? p.reject(Object.assign(new Error(message.error.message), { rpcError: message.error })) : p.resolve(message.result)
  })
  const client = { events, child, get stderr() { return stderr }, request(method, params = {}, timeout = 120000) {
    return new Promise((resolve, reject) => {
      const next = ++id, timer = setTimeout(() => { pending.delete(next); reject(new Error(`Hermes timeout: ${method}`)) }, timeout)
      pending.set(next, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n')
    })
  }, control(operation, params) {
    return new Promise((resolve, reject) => {
      const helper = spawn(command, args, { cwd, env: { ...env, ROVAI_HERMES_CONTROL: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
      let output = '', errors = ''
      helper.stdout.on('data', chunk => { output += chunk }); helper.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000) })
      const timer = setTimeout(() => helper.kill('SIGKILL'), 45000)
      helper.on('error', reject)
      helper.on('close', code => { clearTimeout(timer); try {
        const value = JSON.parse(output)
        if (code || value.error) reject(new Error(value.error ?? errors)); else resolve(value.result)
      } catch (error) { reject(error) } })
      helper.stdin.end(JSON.stringify({ operation, params }))
    })
  }, notify(method, params) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n') }, async close() {
    child.stdin.end()
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 3000)
    const result = await closed; clearTimeout(timer); return result
  } }
  try {
    client.initialize = await client.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'rovai-hermes-acceptance', version: '1' } })
    return client
  } catch (error) { await client.close(); throw new Error(`${error.message}\n${stderr}`) }
}
