// Paid, explicitly authorized native Runtime research; see adjacent README.md.
// New native sessions use a temporary project and existing native account/config.
// Never starts Rovai Core/App. Raw inbound wire stays in a private temporary fixture.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

const runtime = process.argv[2]
const mode = process.argv[3] ?? 'foreground'
const piExtension = process.env.SUBAGENT_PROBE_PI_EXTENSION
const idleMs = Number(process.env.SUBAGENT_PROBE_IDLE_MS ?? 20000)
if (!Number.isInteger(idleMs) || idleMs < 0 || idleMs > 60000) throw new Error('SUBAGENT_PROBE_IDLE_MS must be 0..60000')
const launch = {
  copilot: ['copilot', '--acp', '--stdio', '--no-auto-update', '--no-color', '--log-level', 'error', '--no-ask-user'],
  opencode: ['opencode', 'acp', '--log-level', 'error'],
  kiro: ['kiro-cli', 'acp'],
  qoder: ['qodercli', '--acp'],
  codebuddy: ['codebuddy', '--acp'],
  qwen: ['qwen', '--acp'],
  trae: ['traecli', 'acp', 'serve'],
  kimi: ['kimi', 'acp'],
  grok: ['grok', '--no-auto-update', 'agent', '--no-leader', 'stdio'],
  dsh: ['dsh', '--profile', 'acp'],
  minimax: ['mcode', 'acp'],
  command: ['command-code', 'acp'],
  hermes: ['hermes', 'acp'],
  claude: ['claude', '-p', '--verbose', '--output-format', 'stream-json', '--include-partial-messages', '--permission-mode', 'bypassPermissions'],
  pi: ['pi', '--mode', 'rpc'],
  codex: ['codex', 'app-server'],
  zcode: ['zcode', 'app-server'],
  antigravity: ['agy', '--output-format', 'stream-json', '--mode', 'auto', '--print-timeout', '0'],
}
if (!launch[runtime] || !['foreground', 'background', 'parallel'].includes(mode)) throw new Error('Select runtime and foreground/background/parallel')
const fixture = await mkdtemp(join(tmpdir(), `rovai-subagent-${runtime}-${mode}-`))
const project = join(fixture, 'workspace')
await mkdir(project)
await mkdir(join(fixture, 'user-data', 'managed-skill-library'), { recursive: true })
await writeFile(join(project, 'fixture.txt'), 'ROVAI_CHILD_FILE_MARKER_7319\nThe sample color is amber.\n')
if (runtime === 'pi' && piExtension) {
  await mkdir(join(project, '.pi', 'agents'), { recursive: true })
  await writeFile(join(project, '.pi', 'agents', 'probe.md'), '---\nname: probe\ndescription: Read the isolated fixture once\ntools: read\n---\nRead only the requested fixture and return its marker. Do not delegate.\n')
}
execFileSync('git', ['init', '-q'], { cwd: project })
const marker = mode.toUpperCase()
const instruction = `This is an authorized native subagent protocol test in an isolated temporary workspace. Use your native subagent/delegation tool to start ${mode === 'parallel' ? 'exactly two independent subagents concurrently' : 'exactly one subagent'}. ${mode === 'background' ? 'Use asynchronous/background mode if the native tool supports it; continue with a short parent progress message before waiting for completion. If background is unsupported, use foreground and state that explicitly.' : 'Wait for the child result before your final reply.'} Give each child this task: Read only fixture.txt in ${project} using one native read or shell tool, then return exactly CHILD_${marker}_BEGIN followed by the file marker and CHILD_${marker}_END. Do not write files, search the web, invoke MCP, run another CLI, or create grandchildren. The parent must not read the file itself. Parent final reply: PARENT_${marker}_DONE. If no native subagent tool is available, say NATIVE_SUBAGENT_UNAVAILABLE and list only the names of available tools. Do not simulate delegation.${runtime === 'pi' && piExtension ? ' Use the explicitly loaded subagent extension with agent="probe", agentScope="project", confirmProjectAgents=false; this temporary project contains the authorized read-only probe definition.' : ''}`
const environment = { ...process.env, COMMANDCODE_SKIP_UPDATES: '1', MSGPACKR_NATIVE_ACCELERATION_DISABLED: 'true' }
for (const name of Object.keys(environment)) if (name.startsWith('ROVAI_') || name === 'CLAUDECODE') delete environment[name]
// ZCode allows its mutable native storage to be isolated while the caller supplies
// the existing personal provider configuration by absolute path.
if (runtime === 'zcode') environment.ZCODE_DATA_BASE_DIR = fixture
const command = [...launch[runtime]]
if (runtime === 'pi') command.push('--no-session')
if (runtime === 'pi' && piExtension) command.push('--no-extensions', '--extension', resolve(piExtension), '--approve')
if (runtime === 'claude') command.push(instruction)
if (runtime === 'antigravity') command.push('--add-dir', project, '--log-file', join(fixture, 'native.log'), '--print', instruction)
console.log(JSON.stringify({ runtime, mode, fixture, channel: 'automatic_acceptance', project, startsCore: false }))
const child = spawn(command[0], command.slice(1), { cwd: project, env: environment, stdio: ['pipe', 'pipe', 'pipe'] })
const wire = [], pending = new Map(); let nextId = 0, sessionId, failure, terminal, stderr = '', finished = false
let resolveDone
const done = new Promise(resolve => { resolveDone = resolve })
const write = value => {
  if (runtime === 'zcode') delete value.jsonrpc
  if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(value) + '\n')
}
const request = (method, params = {}, timeout = 180000) => new Promise((resolve, reject) => {
  const id = ++nextId
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, timeout)
  pending.set(id, { resolve, reject, timer })
  write({ ...(runtime === 'zcode' ? {} : { jsonrpc: '2.0' }), id, method, params })
})
child.stderr.on('data', chunk => { stderr += chunk })
child.stdin.on('error', error => { failure ??= error.message; resolveDone() })
child.on('error', error => { failure = error.message; resolveDone() })
child.on('close', code => {
  if (!finished && code) failure ??= `Process exit ${code}`
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(`Process closed: ${code}`)) }
  pending.clear(); resolveDone()
})
createInterface({ input: child.stdout }).on('line', line => {
  let message; try { message = JSON.parse(line) } catch { return }
  wire.push(message)
  if (message.method && message.id !== undefined) {
    if (runtime === 'zcode' && message.method === 'session/requestRuntimePreferences') {
      write({ id: message.id, result: { nativeSearchEnhancementsEnabled: false, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: false, modelContextBudgetStrategy: 'preflight-v1' } })
    } else if (message.method === 'session/request_permission') {
      const option = message.params?.options?.find(value => value.kind === 'allow_once')
      write({ jsonrpc: '2.0', id: message.id, result: { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } } })
    } else if (message.method === 'fs/read_text_file' && resolve(message.params.path) === join(project, 'fixture.txt')) {
      readFile(join(project, 'fixture.txt'), 'utf8').then(
        content => write({ jsonrpc: '2.0', id: message.id, result: { content } }),
        () => write({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Fixture read failed' } }),
      )
    } else write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unsupported probe request' } })
    return
  }
  const entry = pending.get(message.id)
  if (entry) {
    clearTimeout(entry.timer); pending.delete(message.id)
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result)
  }
  const rootFinished = (runtime === 'claude' && message.type === 'result')
    || (runtime === 'antigravity' && message.event === 'result')
    || (runtime === 'pi' && message.type === 'agent_end')
    || (runtime === 'codex' && message.method === 'turn/completed' && message.params?.threadId === sessionId)
    || (runtime === 'zcode' && message.method === 'session/event' && message.params?.sessionId === sessionId && message.params?.type === 'turn.completed')
  if (rootFinished) {
    terminal = message; resolveDone()
  }
})
const deadline = setTimeout(() => {
  failure ??= 'Prompt deadline'
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(failure)) }
  pending.clear(); resolveDone()
}, 240000)
try {
  if (runtime === 'zcode') {
    const workspace = { workspacePath: project, workspaceKey: project }
    await request('workspace/readPresentation', { workspace })
    const session = await request('session/create', { workspace, persistence: 'deferred', mode: 'yolo', titleGenerationEnabled: false })
    sessionId = session.session?.sessionId ?? session.sessionId
    if (!sessionId) throw new Error('Missing ZCode session identity')
    await request('session/subscribe', { sessionId, deliveryKind: 'desktop-continuous', includeSnapshot: false })
    await request('session/setMode', { sessionId, mode: 'yolo' })
    await request('v4/command', { commandId: crypto.randomUUID(), clientId: 'rovai_subagent_probe', sessionId, type: 'sendText', payload: { text: instruction, requestedDelivery: 'startNow' }, issuedAt: Date.now() })
    await done
    if (mode === 'background') await new Promise(resolve => setTimeout(resolve, idleMs))
  } else if (runtime === 'codex') {
    await request('initialize', { clientInfo: { name: 'rovai_subagent_probe', version: '1' }, capabilities: { experimentalApi: true } })
    write({ method: 'initialized' })
    const session = await request('thread/start', { cwd: project, approvalPolicy: 'never', sandbox: 'workspace-write' })
    sessionId = session.thread.id
    await request('turn/start', { threadId: sessionId, input: [{ type: 'text', text: instruction }] })
    await done
  } else if (runtime === 'pi') {
    write({ id: 'probe', type: 'prompt', message: instruction }); await done
  } else if (['claude', 'antigravity'].includes(runtime)) {
    child.stdin.end(); await done
  } else {
    await request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: false } }, clientInfo: { name: 'rovai_subagent_probe', version: '1' } }, 45000)
    const session = await request('session/new', { cwd: project, mcpServers: [] }, 45000)
    sessionId = session.sessionId
    terminal = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text: instruction }] })
    if (runtime === 'hermes' || mode === 'background') {
      // A parent prompt can end before native background delivery. Observe a bounded
      // idle interval without inventing another model input or polling task state.
      await new Promise(resolve => setTimeout(resolve, idleMs))
    }
  }
} catch (error) { failure = error.message }
finally {
  finished = true; clearTimeout(deadline)
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Probe closed')) }
  pending.clear()
  if (sessionId && failure) write({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
  child.stdin.end(); child.kill('SIGTERM')
  const killDeadline = setTimeout(() => child.kill('SIGKILL'), 3000)
  killDeadline.unref()
  child.once('close', () => clearTimeout(killDeadline))
  const shapes = new Map()
  for (const message of wire) {
    const update = message.params?.update ?? message
    const type = update.sessionUpdate ?? message.method ?? message.type ?? 'response'
    const key = JSON.stringify({ type, keys: Object.keys(update), meta: Object.keys(update._meta ?? {}), parent: update.parent_tool_use_id ?? update.parentToolCallId ?? update._meta?.parentToolCallId ?? null })
    shapes.set(key, (shapes.get(key) ?? 0) + 1)
  }
  const summary = { runtime, mode, idleMs, variant: runtime === 'pi' && piExtension ? 'explicit-example-extension' : 'default', fixture, sessionId, failure, terminal, eventCount: wire.length, shapes: [...shapes].map(([shape, count]) => ({ ...JSON.parse(shape), count })) }
  await writeFile(join(fixture, 'wire.jsonl'), wire.map(value => JSON.stringify(value)).join('\n') + '\n', { mode: 0o600 })
  await writeFile(join(fixture, 'stderr.txt'), stderr, { mode: 0o600 })
  await writeFile(join(fixture, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ runtime, mode, fixture, eventCount: wire.length, failed: !!failure }))
  if (failure) process.exitCode = 1
}
