// Explicit, isolated real Runtime acceptance. Native content is relayed unchanged;
// only field names, identities, numeric counts and timings are retained by the probe.
import { mkdtemp, mkdir, writeFile, chmod, readFile, realpath, copyFile, cp } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend, composerDocumentForAddress } from './lib/create-configured-camp.mjs'
import { querySqliteRows } from './lib/sqlite.mjs'

const repository = resolve(import.meta.dirname, '..')
const kind = process.argv[2]
const coldRestart = process.env.ROVAI_METRICS_COLD_RESTART === '1'
const compactAfterRestart = process.env.ROVAI_METRICS_GROK_COMPACT_AFTER_RESTART === '1'
if (compactAfterRestart && (kind !== 'grok-build' || !coldRestart)) {
  throw new Error('Native Grok compaction acceptance requires a cold restart')
}
const commands = {
  'codex-cli': ['codex', 'ROVAI_CODEX_BIN'],
  'claude-code-cli': ['claude', 'ROVAI_CLAUDE_CODE_BIN'],
  'opencode-cli': ['opencode', 'ROVAI_OPENCODE_BIN'],
  'copilot-cli': ['copilot', 'ROVAI_COPILOT_BIN'],
  'codebuddy-cli': ['codebuddy', 'ROVAI_CODEBUDDY_BIN'],
  'qwen-code': ['qwen', 'ROVAI_QWEN_BIN'],
  pi: ['pi', 'ROVAI_PI_BIN'],
  'kimi-code-cli': ['kimi', 'ROVAI_KIMI_BIN'],
  'grok-build': ['grok', 'ROVAI_GROK_BIN'],
  'deepseek-harness': ['dsh', 'ROVAI_DEEPSEEK_HARNESS_BIN'],
  'qoder-cli': ['qoder', 'ROVAI_QODER_BIN'],
  'kiro-cli': ['kiro-cli', 'ROVAI_KIRO_BIN'],
  'trae-cn-cli': ['trae-cli', 'ROVAI_TRAE_CN_BIN'],
  'zcode-app': null,
  'antigravity-app': ['agy', 'ROVAI_ANTIGRAVITY_BIN']
}
if (!Object.hasOwn(commands, kind)) throw new Error('Select an in-scope Runtime')
if (kind === 'kimi-code-cli' && !process.env.ROVAI_METRICS_NATIVE_HOME) {
  throw new Error('Kimi acceptance requires ROVAI_METRICS_NATIVE_HOME containing official config.toml')
}
const fixture = await realpath(process.env.ROVAI_METRICS_FIXTURE_ROOT ?? await mkdtemp(join(tmpdir(), `rovai-runtime-metrics-${kind}-`)))
const data = join(fixture, 'user-data'), workspacePath = join(fixture, 'workspace')
const rawPath = join(fixture, 'native-shapes.jsonl')
const coreSource = process.env.ROVAI_METRICS_CORE ?? join(repository, 'resources/bin/macos-arm64/rovai-core')
const fixtureCore = join(fixture, 'rovai-core')
await copyFile(coreSource, fixtureCore); await chmod(fixtureCore, 0o700)
await copyFile(join(dirname(coreSource), 'rovai'), join(fixture, 'rovai'))
await chmod(join(fixture, 'rovai'), 0o700)
// Release Core resolves bundled Skills beside its owned executable. Copy the
// source bundle; the installed library remains isolated under this fixture.
await cp(join(repository, 'skills'), join(fixture, 'skills'), { recursive: true })
const coreDigest = createHash('sha256').update(await readFile(fixtureCore)).digest('hex')
await mkdir(data); await mkdir(workspacePath)
await mkdir(join(data, 'managed-skill-library')); await writeFile(join(data, 'mcp.json'), '{}')
console.log(JSON.stringify({ kind, fixture, coreDigest, channel: 'automatic_acceptance', data, skillLibrary: join(data, 'managed-skill-library'), mcp: join(data, 'mcp.json') }))
if (kind === 'pi') {
  const piHome = join(fixture, 'pi-agent')
  await mkdir(piHome, { mode: 0o700 })
  for (const name of ['auth.json', 'settings.json', 'models.json']) {
    await copyFile(join(homedir(), '.pi', 'agent', name), join(piHome, name))
    await chmod(join(piHome, name), 0o600)
  }
  process.env.PI_CODING_AGENT_DIR = piHome
  if (process.env.ROVAI_METRICS_THINKING_LEVEL) {
    const settingsPath = join(piHome, 'settings.json')
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    settings.defaultThinkingLevel = process.env.ROVAI_METRICS_THINKING_LEVEL
    await writeFile(settingsPath, JSON.stringify(settings), { mode: 0o600 })
  }
}
if (process.env.ROVAI_METRICS_NATIVE_HOME) {
  const nativeHome = join(fixture, 'native-home')
  await mkdir(nativeHome, { mode: 0o700 })
  const names = ['grok-build', 'kimi-code-cli'].includes(kind) ? ['config.toml'] : ['settings.yaml', 'cordis.patch.yml']
  for (const name of names) {
    try {
      await copyFile(join(process.env.ROVAI_METRICS_NATIVE_HOME, name), join(nativeHome, name))
      await chmod(join(nativeHome, name), 0o600)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  if (kind === 'grok-build') process.env.GROK_HOME = nativeHome
  if (kind === 'kimi-code-cli') {
    // Use the official provider/model configuration in a fixture-owned Home.
    // OAuth state is optional for BYOK, and no daily sessions are copied.
    await readFile(join(nativeHome, 'config.toml'))
    try { await cp(join(process.env.ROVAI_METRICS_NATIVE_HOME, 'oauth'), join(nativeHome, 'oauth'), { recursive: true, dereference: true }) } catch (error) { if (error.code !== 'ENOENT') throw error }
    process.env.KIMI_CODE_HOME = nativeHome
  }
  if (kind === 'deepseek-harness') {
    try { await cp(join(process.env.ROVAI_METRICS_NATIVE_HOME, 'profiles'), join(nativeHome, 'profiles'), { recursive: true }) } catch (error) { if (error.code !== 'ENOENT') throw error }
    process.env.DSH_HOME = nativeHome; process.env.DSH_AGENTS_HOME = join(fixture, 'agents-home')
  }
  if (['grok-build', 'deepseek-harness'].includes(kind)) {
    const claude = JSON.parse(await readFile(join(homedir(), '.claude/settings.json'), 'utf8')).env
    const token = claude.ANTHROPIC_AUTH_TOKEN ?? claude.ANTHROPIC_API_KEY
    const origin = new URL(claude.ANTHROPIC_BASE_URL).origin
    // These fixtures use the same authorised sub2api origin as Claude. A copied
    // env-key reference is resolved in memory; never print or inline the key.
    if (kind === 'grok-build') {
      const configPath = join(nativeHome, 'config.toml')
      let config = await readFile(configPath, 'utf8')
      const base = config.match(/^base_url\s*=\s*"([^"]+)"/m)?.[1]
      if (!base || new URL(base).origin !== origin) throw new Error('Probe provider origin does not match authorised sub2api')
      const keyName = config.match(/^env_key\s*=\s*"([A-Z_]+)"/m)?.[1]
      if (keyName) {
        if (!token) throw new Error('Probe credential reference is unavailable')
        process.env[keyName] = token
      }
      config = config.replace(/^model\s*=\s*"[^"]+"/m, `model = ${JSON.stringify(claude.ANTHROPIC_MODEL)}`)
      await writeFile(configPath, config, { mode: 0o600 })
    } else {
      const configPath = join(nativeHome, 'settings.yaml')
      let config = await readFile(configPath, 'utf8')
      const base = config.match(/baseURL:\s*(\S+)/)?.[1]
      if (!base || new URL(base).origin !== origin) throw new Error('Probe provider origin does not match authorised sub2api')
      const keyName = config.match(/apiKeyEnv:\s*(\S+)/)?.[1]
      if (!keyName || !token) throw new Error('Probe credential reference is unavailable')
      process.env[keyName] = token
      config = config.replaceAll('gpt-6-sol', claude.ANTHROPIC_MODEL)
      if (process.env.ROVAI_METRICS_THINKING_LEVEL) {
        const model = claude.ANTHROPIC_MODEL
        const effort = process.env.ROVAI_METRICS_THINKING_LEVEL
        // The copied custom route has no installed catalog metadata. Declare
        // only the effort being exercised, in the supported native settings.
        config = config.replace(new RegExp(`(id: ${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n)([ ]+)`),
          `$1$2reasoningEfforts: { ${effort}: ${effort} }\n$2`)
      }
      await writeFile(configPath, config, { mode: 0o600 })
      const patchPath = join(nativeHome, 'cordis.patch.yml')
      try {
        const patch = (await readFile(patchPath, 'utf8')).replaceAll('gpt-6-sol', claude.ANTHROPIC_MODEL)
        await writeFile(patchPath, patch, { mode: 0o600 })
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
}
let nativeExecutable = null
let observerExecutable = null
if (commands[kind]) {
  const [command, override] = commands[kind]
  nativeExecutable = await realpath(process.env[override]
    ?? execFileSync('/usr/bin/which', [command], { encoding: 'utf8' }).trim())
  const wrapper = join(fixture, 'native-observer')
  observerExecutable = wrapper
  await writeFile(wrapper, `#!/usr/bin/env python3
import sys,subprocess,threading,json,time,uuid
child=subprocess.Popen([${JSON.stringify(nativeExecutable)}]+sys.argv[1:],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def forward_input():
    try:
        for line in sys.stdin.buffer:
            child.stdin.write(line);child.stdin.flush()
        child.stdin.close()
    except (BrokenPipeError,ValueError): pass
threading.Thread(target=forward_input,daemon=True).start()
def forward_diagnostics():
    for line in child.stderr:
        sys.stderr.buffer.write(line);sys.stderr.buffer.flush()
threading.Thread(target=forward_diagnostics,daemon=True).start()
numeric_keys={'input_tokens','output_tokens','prompt_tokens','completion_tokens','total_tokens','cached_tokens','cache_read_tokens','cache_write_tokens','cache_read_input_tokens','cache_creation_input_tokens','cache_write_input_tokens','reasoning_tokens','thinking_tokens','used','size','contextWindow','context_window','modelContextWindow','inputTokens','outputTokens','totalTokens','cachedInputTokens','cacheWriteInputTokens','cachedReadTokens','cachedWriteTokens','cacheReadTokens','cacheWriteTokens','thoughtTokens','cacheCreationTokens','reasoningTokens','context_usage_ratio','context_tokens','context_window_size','input','output','cacheRead','cacheWrite','tokens_before','tokens_after','tokens_used','percentage','contextUsagePercentage','context_window_tokens','maxInputTokens','promptTokenCount','candidatesTokenCount','totalTokenCount','cachedContentTokenCount','elapsed_ms'}
observer_generation=str(uuid.uuid4())
def numeric(v,path='',depth=0):
    if depth>6 or not isinstance(v,dict): return {}
    result={}
    for key,value in v.items():
        if key in {'content','delta','text','thinking','summary','arguments','output','input','systemPrompt'} and isinstance(value,(dict,list,str)): continue
        p=path+'/'+key
        if key in numeric_keys and isinstance(value,(int,float)) and not isinstance(value,bool): result[p]=value
        elif isinstance(value,dict): result.update(numeric(value,p,depth+1))
    return result
identities={}
def identity(v):
    if not isinstance(v,(str,int)): return None
    k=str(v)
    if k not in identities:
        if len(identities)>=512: return 'capacity-exceeded'
        identities[k]='identity-'+str(len(identities)+1)
    return identities[k]
def managed_context(v):
    if v.get('type')!='extension_ui_request' or v.get('method')!='setStatus' or v.get('statusKey')!='rovai-managed-context-usage': return None
    try:
        status=json.loads(v.get('statusText',''))
        return {k:status[k] for k in ['usedTokens','windowTokens','provider','modelId'] if k in status}
    except (ValueError,TypeError): return None
with open(${JSON.stringify(rawPath)},'a',buffering=1) as out:
    for line in child.stdout:
        try:
            v=json.loads(line); p=v.get('params') or {}; u=p.get('update') or {}; a=v.get('assistantMessageEvent') or {}; e=v.get('event') or {}; d=v.get('delta') or {}
            if not isinstance(p,dict): p={}
            if not isinstance(e,dict): e={}
            item=p.get('item') or {}
            out.write(json.dumps({'observerGeneration':observer_generation,'atMs':round(time.monotonic()*1000),'method':v.get('method'),'type':v.get('type') or p.get('type'),'itemType':item.get('type'),'sessionUpdate':u.get('sessionUpdate'),'deltaType':a.get('type') or d.get('type') or (e.get('delta') or {}).get('type'),'nativeStep':{k:(v.get('step_update') or {}).get(k) for k in ['step_index','state','step_type']},'nativeEvent':v.get('event') if isinstance(v.get('event'),str) else None,'resultKeys':sorted((v.get('result') or {}).keys()) if isinstance(v.get('result'),dict) else [],'modelWindows':[{'modelId':m.get('modelId'),'window':(m.get('_meta') or {}).get('maxInputTokens')} for m in ((v.get('result') or {}).get('models') or {}).get('availableModels',[])] if isinstance(v.get('result'),dict) else [],'keys':sorted(v.keys()),'paramsKeys':sorted(p.keys()),'dataKeys':sorted((p.get('data') or {}).keys()),'nativeModel':(p.get('data') or {}).get('model') if isinstance((p.get('data') or {}).get('model'),str) else None,'nativeTimestamp':p.get('timestamp') if isinstance(p.get('timestamp'),str) and len(p['timestamp'])<=40 else None,'updateKeys':sorted(u.keys()),'contentKeys':sorted((u.get('content') or {}).keys()),'eventKeys':sorted(e.keys()),'itemId':identity(p.get('itemId') or item.get('id') or u.get('messageId') or (e.get('message') or {}).get('id')),'turnId':identity(p.get('turnId')),'summaryIndex':p.get('summaryIndex'),'contentIndex':p.get('contentIndex',a.get('contentIndex')),'textOffset':p.get('textOffset',u.get('textOffset')),'parentPresent':any(u.get(k)!=None for k in ['agentId','sourceAgentId','subagentId','parentAgentId','parentSessionId']) or v.get('parent_tool_use_id')!=None,'usageFields':numeric(v),'managedContext':managed_context(v)})+'\\n')
        except Exception: pass
        sys.stdout.buffer.write(line);sys.stdout.buffer.flush()
sys.exit(child.wait())
`, { mode: 0o700 })
  process.env[override] = wrapper
}
const events = [], metrics = [], runs = [], restartChecks = []
const started = performance.now()
const startCore = () => startQualificationCore({
  coreExecutable: fixtureCore,
  dataDirectory: data, workingDirectory: repository, runtimeCacheDirectory: join(fixture, 'cache'),
  mcpConfigPath: join(data, 'mcp.json'), onNotification(event) {
    if (event.method.startsWith('agent_run.') && !['agent_run.log', 'agent_run.execution_changed'].includes(event.method)) {
      events.push({ atMs: Math.round(performance.now() - started), method: event.method })
    }
  }
})
let core = startCore()
let run = null, campId = null, installation = null, failure = null
let failureDetail = null
try {
  await core.request('health.check')
  if (observerExecutable) {
    const startup = await core.request('runtime.startup.get', { runtimeKind: kind })
    await core.request('runtime.startup.save', { runtimeKind: kind, expectedRevision: startup.revision,
      configuration: { programPath: observerExecutable, environment: [] } })
  }
  let configurationDeadline
  try {
    installation = await Promise.race([
      configureProductRuntime(core.request, kind, ['agent_1']),
      new Promise((_, reject) => { configurationDeadline = setTimeout(() => reject(new Error('timed out configuring Runtime')), 90000) })
    ])
  } finally { clearTimeout(configurationDeadline) }
  if (process.env.ROVAI_METRICS_MODEL) {
    const profile = await core.request('members.get', { agentId: 'agent_1' })
    const options = process.env.ROVAI_METRICS_MODEL_OPTIONS ? JSON.parse(process.env.ROVAI_METRICS_MODEL_OPTIONS) : {}
    const changed = await core.request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
      agentId: 'agent_1', expectedVersion: profile.version, adapterKind: kind,
      permissions: profile.runtimeConfiguration.permissions,
      model: { mode: 'explicit', modelId: process.env.ROVAI_METRICS_MODEL, options }
    } })
    if (changed.status !== 'applied') throw new Error('Explicit probe model was not applied')
  }
  const workspace = await core.request('workspaces.inspect', { path: workspacePath })
  const accepted = await createConfiguredCampAndSend(core.request, { commandId: crypto.randomUUID(), workspace,
    memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1',
    body: (process.env.ROVAI_METRICS_PROMPT_FILE ? await readFile(process.env.ROVAI_METRICS_PROMPT_FILE, 'utf8') : process.env.ROVAI_METRICS_PROMPT) ?? 'This is an isolated native usage and context acceptance. Analyze consistency, retries and recovery in a library catalogue. Use a read-only shell command to inspect the workspace, then explain the design in about 600 words. Do not delegate or modify files. Finally use rovai send --public-only for a brief completion, following Session Charter. Finish normally.',
    purpose: 'Native Usage and Session Context acceptance' })
  campId = accepted.payload.threadId ?? accepted.payload.campId
  const deadline = performance.now() + Number(process.env.ROVAI_METRICS_TIMEOUT_MS ?? 480000)
  let nextProgress = performance.now() + 30000
  while (performance.now() < deadline) {
    const snapshot = await core.request('camps.snapshot', { campId }, 15000)
    run = snapshot.agentRuns.find(candidate => !runs.some(old => old.id === candidate.id))
    if (run) {
      const now = performance.now()
      const projection = await core.request('monitoring.execution', { campId, agentRunIds: [run.id] }, 15000)
      if (JSON.stringify(projection) !== JSON.stringify(metrics.at(-1)?.projection)) {
        metrics.push({ atMs: Math.round(now - started), status: run.status, projection })
      }
      if (['succeeded', 'failed', 'cancelled'].includes(run.status)) {
        const bindings = querySqliteRows(join(data, 'rovai.sqlite'),
          'SELECT id AS conversationId, native_session_id AS nativeSessionId, native_binding_id AS nativeBindingId, native_binding_generation AS generation FROM conversation')
        const nativeBinding = bindings.find(binding => binding.conversationId === run.conversationId) ?? null
        if (coldRestart && (!nativeBinding?.nativeSessionId || (runs.length > 0
          && JSON.stringify(nativeBinding) !== JSON.stringify(runs[0].nativeBinding)))) {
          throw new Error('Cold restart did not retain the exact native Session binding')
        }
        runs.push({ id: run.id, executionEpoch: run.executionEpoch, status: run.status, nativeBinding, projection })
        if ((process.env.ROVAI_METRICS_RESUME === '1' || coldRestart)
          && runs.length === 1 && run.status === 'succeeded') {
          if (coldRestart) {
            const stopped = await core.stop()
            if (stopped.code !== 0) throw new Error('First isolated Core did not stop cleanly')
            if (compactAfterRestart) process.env.ROVAI_INTERNAL_GROK_COMPACTION_ACCEPTANCE = '1'
            core = startCore()
            await core.request('health.check')
            const recovered = await core.request('monitoring.execution', { campId, agentRunIds: [run.id] })
            const unchanged = JSON.stringify(recovered) === JSON.stringify(projection)
            restartChecks.push({ previousRunId: run.id, previousProjection: projection,
              recoveredProjection: recovered, unchanged, compactAfterRestart })
            if (!unchanged) throw new Error('Isolated Core restart changed persisted metrics')
          }
          const followup = process.env.ROVAI_METRICS_FOLLOWUP_PROMPT_FILE
            ? await readFile(process.env.ROVAI_METRICS_FOLLOWUP_PROMPT_FILE, 'utf8')
            : 'Continue in this same native session for a second isolated metrics acceptance. Explain retry ownership in about 250 words, run sleep 3 once, then briefly describe recovery. Do not delegate or change files. Send a short completion with rovai send --public-only and finish normally.'
          await core.request('camp.messages.send', { commandId: crypto.randomUUID(), campId,
            content: composerDocumentForAddress({ mode: 'default' }, followup),
            sourceAttachments: [], quotes: [], replyToCampMessageId: null,
            execution: { taskId: null, purpose: 'Same Session successor Usage baseline', completionRole: 'required' } })
          continue
        }
        break
      }
      if (now >= nextProgress) {
        console.log(JSON.stringify({ kind, stage: 'live', status: run.status }))
        nextProgress = now + 30000
      }
    }
    await new Promise(done => setTimeout(done, 1000))
  }
  if (!['succeeded', 'failed', 'cancelled'].includes(run?.status)) failure = 'acceptance_deadline'
} catch (error) {
  // Do not include arbitrary provider error payloads, paths or credentials.
  failure = error.message.startsWith('timed out') ? error.message : error.message.split(':')[0].slice(0, 160)
  failureDetail = error.message.replace(/https?:\/\/\S+/g, '<endpoint>')
    .replace(/(?:\/[\w.@ -]+){2,}/g, '<path>')
    .replace(/[A-Za-z0-9_+\/=.-]{16,}/g, '<identifier>')
    .replace(/(?:api[_ -]?key|token|bearer|secret|password)\s*[:=]?\s*\S+/gi, '<credential>')
    .slice(0, 1200)
  events.push({ method: 'probe.failure', categories: ['model', 'auth', 'quota', 'permission', 'protocol', 'version', 'executable', 'unsupported', 'config'].filter(word => error.message.toLowerCase().includes(word)) })
} finally {
  const stopped = await core.stop()
  const frozen = (await querySqliteRows(join(data, 'rovai.sqlite'),
    'SELECT runtime_observed_model_id, runtime_model_selection_json, public_runtime_failure_json FROM agent_run ORDER BY started_at DESC LIMIT 1'))[0]
  let raw = []
  try { raw = (await readFile(rawPath, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) } catch {}
  const groups = {}
  for (const event of raw) {
    const key = [event.method, event.type, event.sessionUpdate, event.deltaType, event.nativeEvent].filter(Boolean).join('/')
    groups[key] ??= { count: 0, firstAtMs: event.atMs, lastAtMs: event.atMs }
    groups[key].count++
    groups[key].firstAtMs = Math.min(groups[key].firstAtMs, event.atMs)
    groups[key].lastAtMs = Math.max(groups[key].lastAtMs, event.atMs)
  }
  const report = { kind, fixture, coreDigest, rawObservation: raw.length ? 'captured' : 'not_captured', status: run?.status ?? null, failure, version: installation?.snapshot?.reportedVersion ?? null,
    model: frozen?.runtime_observed_model_id ?? (frozen?.runtime_model_selection_json ? JSON.parse(frozen.runtime_model_selection_json) : null),
    requestedModel: frozen?.runtime_model_selection_json ? JSON.parse(frozen.runtime_model_selection_json) : null,
    observedModel: frozen?.runtime_observed_model_id ?? null,
    publicFailure: frozen?.public_runtime_failure_json ? (() => {
      const failure = JSON.parse(frozen.public_runtime_failure_json)
      return { code: failure.code, origin: failure.origin, phase: failure.phase,
        categories: ['model', 'reasoning', 'auth', 'quota', 'permission', 'protocol', 'version', 'executable', 'unsupported', 'config']
          .filter(word => (failure.detail ?? '').toLowerCase().includes(word)) }
    })() : null,
    rawGroups: groups,
    rendererVerified: false, stopped: stopped.code === 0 }
  report.runs = runs
  report.restartChecks = restartChecks
  report.metrics = metrics
  report.failureDetail = failureDetail
  report.meteringDiagnosticFlags = [
    'failed to persist copilot-cli Usage', 'failed to persist qoder-cli Usage',
    'Context observation has no time', 'Runtime Usage token field is outside the safe integer range',
    'Runtime Usage cache buckets exceed prompt input total', 'dropped fenced ACP message',
  ].filter(message => stopped.stderrTail.includes(message))
  await writeFile(join(fixture, 'evidence.json'), JSON.stringify({ report, events }, null, 2))
  console.log(JSON.stringify({ ...report, metrics: undefined }))
}
