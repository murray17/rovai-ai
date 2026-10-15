// Transparent private evidence recorder. Never writes prompt bodies or credentials.
import { spawn } from 'node:child_process'
import { readFileSync, appendFileSync, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
const config = JSON.parse(readFileSync(new URL('./proxy-config.json', import.meta.url), 'utf8'))
const pending = new Map()
function record(row) {
  let stage = 'unknown'
  try { stage = readFileSync(config.stagePath, 'utf8').trim() } catch {}
  appendFileSync(config.wirePath, JSON.stringify({ ...row, stage, pid: process.pid, cwd: process.cwd() }) + '\n')
}
function observe(line, direction) {
  let v
  try { v = JSON.parse(line) } catch { return }
  if (!v || typeof v !== 'object') return
  const p = v.params ?? {}, method = v.method ?? v.type ?? v.event
  if (direction === 'in' && v.id !== undefined) pending.set(String(v.id), method)
  const r = { direction, id: v.id, method, requestMethod: pending.get(String(v.id)),
    sessionId: p.sessionId ?? p.threadId ?? v.session_id ?? v.conversation_id,
    sessionPath: v.sessionPath, commandType: p.command?.type, updateType: p.update?.sessionUpdate,
    subtype: v.subtype, isError: v.is_error, success: v.success }
  const b = v.result ?? v.data
  if (b && typeof b === 'object') {
    r.resultSessionId = b.sessionId ?? b.conversation_id ?? b.thread?.id
    r.sessionFile = b.sessionFile; r.capabilities = b.agentCapabilities
  }
  if (v.error && typeof v.error === 'object') r.error = { code: v.error.code, data: v.error.data }
  if (direction === 'out') r.responseMarkers = [...new Set(line.match(/WIN_RESUME_[A-Z_0-9]+/g) ?? [])]
  if (direction === 'in') {
    r.businessMarkers = [...new Set(line.match(/WIN_RESUME_[A-Z_0-9]+/g) ?? [])]
    if (['session/resume', 'session/load', 'thread/resume'].includes(method)) r.target = { sessionId: p.sessionId ?? p.threadId, cwd: p.cwd }
  }
  record(r)
}
const args = process.argv.slice(2)
const resumeFlag = ['--resume', '--session-id', '--conversation'].find(flag => args.includes(flag))
// Observe the same inherited context before launching the real CLI. Never log
// the whole context: it also carries private transport and lease material.
let processContext
if (process.env.ROVAI_CLI_CONTEXT) {
  const contextPath = process.env.ROVAI_CLI_CONTEXT, runTmp = process.env.ROVAI_RUN_TMP
  try {
    const context = JSON.parse(readFileSync(contextPath, 'utf8'))
    processContext = { contextPath, processId: context.processId, runTmp,
      runTmpExists: !!runTmp && existsSync(runTmp), unbound: context.lease == null }
  } catch (error) { processContext = { contextPath, runTmp, readErrorCode: error.code ?? 'invalid-json' } }
}
record({ direction: 'launch', target: config.target, prefix: config.prefix, resumeFlag,
  processContext,
  resumeArgument: resumeFlag ? args[args.indexOf(resumeFlag) + 1] : null,
  additionalDirectories: args.flatMap((arg, i) => arg === '--add-dir' ? [{ path: args[i + 1], exists: existsSync(args[i + 1]) }] : []),
  environment: { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
    configKeys: Object.keys(process.env).filter(k => /^(CODEBUDDY_CONFIG_DIR|QODER_CONFIG_DIR|QWEN_HOME|QWEN_RUNTIME_DIR|RESUME_ENV)$/i.test(k)), RESUME_ENV: process.env.RESUME_ENV } })
const child = spawn(config.target, [...(config.prefix ?? []), ...args], {
  env: { ...process.env, ...(config.env ?? {}) }, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true
})
record({ direction: 'spawn', childPid: child.pid })
// Observe lines independently of forwarding so buffering never changes native input bytes.
createInterface({ input: process.stdin }).on('line', line => observe(line, 'in'))
createInterface({ input: child.stdout }).on('line', line => observe(line, 'out'))
process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout)
child.stdin.on('error', () => {})
child.on('error', error => { record({ direction: 'spawn-error', code: error.code }); process.exitCode = 1 })
child.on('close', code => process.exit(code ?? 1))
