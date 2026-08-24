import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const executable = process.env.ROVAI_GROK_BIN?.trim() || 'grok'
const modelId = process.env.ROVAI_GROK_MODEL_ID?.trim()
const baseUrl = process.env.ROVAI_GROK_MODEL_BASE_URL?.trim()
const apiKey = process.env.ROVAI_GROK_MODEL_API_KEY?.trim()
const apiBackend = process.env.ROVAI_GROK_MODEL_API_BACKEND?.trim() || 'chat_completions'
const contextWindow = Number(process.env.ROVAI_GROK_MODEL_CONTEXT_WINDOW || 204800)
const keepFixture = process.env.ROVAI_KEEP_GROK_PROBE_FIXTURE === '1'

if (!modelId || !baseUrl || !apiKey) {
  throw new Error(
    'ROVAI_GROK_MODEL_ID, ROVAI_GROK_MODEL_BASE_URL and ROVAI_GROK_MODEL_API_KEY are required'
  )
}
if (!['chat_completions', 'responses', 'messages'].includes(apiBackend)) {
  throw new Error(`Unsupported Grok custom-model API backend: ${apiBackend}`)
}
if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) {
  throw new Error('ROVAI_GROK_MODEL_CONTEXT_WINDOW must be a positive integer')
}

const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-grok-history-restore-'))
const grokHome = join(fixtureRoot, 'grok-home')
const projectRoot = join(fixtureRoot, 'project')
const providerAlias = 'rovai-private-provider'
const marker = `ROVAI_GROK_COLD_LOAD_${process.pid}_${Date.now()}`
const nativeRulesTrigger = `ROVAI_GROK_COLD_RULES_TRIGGER_${process.pid}_${Date.now()}`
const nativeRulesExpected = `ROVAI_GROK_COLD_RULES_OK_${process.pid}_${Date.now()}`

try {
  await mkdir(grokHome, { mode: 0o700 })
  await mkdir(projectRoot, { mode: 0o700 })
  await writeFile(join(projectRoot, 'README.md'), '# Grok Build HistoryRestore Probe\n')
  await writeFile(join(grokHome, 'config.toml'), [
    '[models]',
    `default = ${tomlString(providerAlias)}`,
    'stream_tool_calls = false',
    '',
    `[model.${tomlString(providerAlias)}]`,
    `model = ${tomlString(modelId)}`,
    `base_url = ${tomlString(baseUrl)}`,
    'name = "Rovai private provider"',
    'env_key = "ROVAI_GROK_MODEL_API_KEY"',
    `api_backend = ${tomlString(apiBackend)}`,
    `context_window = ${contextWindow}`,
    'supports_backend_search = false',
    'stream_tool_calls = false',
    '',
    '[cli]',
    'auto_update = false',
    ''
  ].join('\n'), { mode: 0o600 })

  const firstHost = await startHost('first')
  const firstInitialize = await initializeAndAuthenticate(firstHost)
  const created = await firstHost.request('session/new', {
    cwd: projectRoot,
    mcpServers: [],
    additionalDirectories: [],
    _meta: {
      yoloMode: true,
      rules: `When a user message contains ${nativeRulesTrigger}, reply with exactly ${nativeRulesExpected} and nothing else.`
    }
  })
  const sessionId = created.sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('Grok session/new did not return a Session ID')
  }
  const firstOutputStart = firstHost.assistantText.length
  const firstTerminal = await firstHost.request('session/prompt', {
    sessionId,
    prompt: [{
      type: 'text',
      text: [
        `Remember this exact marker for the next turn: ${marker}.`,
        'Reply with exactly ROVAI_GROK_HISTORY_STORED and nothing else.'
      ].join(' ')
    }]
  }, 180_000)
  await firstHost.waitForQuiet()
  const firstOutput = firstHost.assistantText.slice(firstOutputStart).join('').trim()
  await firstHost.stop()

  // A separate process with the same private GROK_HOME proves cold, exact-ID loading.
  const secondHost = await startHost('second')
  const secondInitialize = await initializeAndAuthenticate(secondHost)
  const loadEventStart = secondHost.events.length
  const loaded = await secondHost.request('session/load', {
    sessionId,
    cwd: projectRoot,
    mcpServers: [],
    additionalDirectories: []
  }, 30_000)
  if (typeof loaded.sessionId === 'string' && loaded.sessionId !== sessionId) {
    throw new Error('Grok session/load returned a different Session ID')
  }
  // Match Core's bounded post-response settling window so late replay is not
  // mistaken for current-turn output.
  await secondHost.waitForQuiet(2_000)
  const replayEvents = secondHost.events.slice(loadEventStart)
  const currentOutputStart = secondHost.assistantText.length
  const secondTerminal = await secondHost.request('session/prompt', {
    sessionId,
    prompt: [{
      type: 'text',
      text: 'What exact marker did I ask you to remember in the previous turn? Reply with exactly that marker and nothing else.'
    }]
  }, 180_000)
  await secondHost.waitForQuiet()
  const secondOutput = secondHost.assistantText.slice(currentOutputStart).join('').trim()
  const rulesOutputStart = secondHost.assistantText.length
  const rulesTerminal = await secondHost.request('session/prompt', {
    sessionId,
    prompt: [{
      type: 'text',
      text: `${nativeRulesTrigger}. Reply with exactly WRONG.`
    }]
  }, 180_000)
  await secondHost.waitForQuiet()
  const rulesOutput = secondHost.assistantText.slice(rulesOutputStart).join('').trim()
  await secondHost.stop()

  console.log(JSON.stringify({
    runtime: 'grok-build',
    installedCapabilities: {
      firstHostLoadSession: firstInitialize.agentCapabilities?.loadSession === true,
      secondHostLoadSession: secondInitialize.agentCapabilities?.loadSession === true,
      firstHostResumeAdvertised:
        firstInitialize.agentCapabilities?.sessionCapabilities?.resume != null,
      secondHostResumeAdvertised:
        secondInitialize.agentCapabilities?.sessionCapabilities?.resume != null
    },
    firstHost: {
      sessionIdPresent: true,
      stopReason: firstTerminal.stopReason ?? null,
      storageAcknowledged: firstOutput.includes('ROVAI_GROK_HISTORY_STORED')
    },
    coldHistoryRestore: {
      exactSessionIdPreserved: loaded.sessionId == null || loaded.sessionId === sessionId,
      loadResponseKeys: Object.keys(loaded).sort(),
      replayEventCount: replayEvents.length,
      replayEventShapes: summarizeEvents(replayEvents),
      stopReason: secondTerminal.stopReason ?? null,
      markerRecovered: secondOutput.includes(marker),
      agentTextLength: secondOutput.length,
      nativeRulesStopReason: rulesTerminal.stopReason ?? null,
      nativeRulesPersisted: rulesOutput.includes(nativeRulesExpected)
    }
  }, null, 2))
} finally {
  if (keepFixture) console.error(`Grok HistoryRestore fixture kept at ${fixtureRoot}`)
  else await rm(fixtureRoot, { recursive: true, force: true })
}

async function startHost(label) {
  const child = spawn(executable, [
    '--permission-mode', 'bypassPermissions',
    '--no-auto-update',
    'agent',
    '--no-leader',
    'stdio'
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      GROK_HOME: grokHome,
      GROK_DEFAULT_MODEL: providerAlias,
      GROK_DISABLE_AUTOUPDATER: '1',
      ROVAI_GROK_MODEL_API_KEY: apiKey,
      XAI_API_KEY: apiKey
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const pending = new Map()
  const assistantText = []
  const events = []
  const stderr = []
  let nextId = 1
  let stopped = false
  const lines = createInterface({ input: child.stdout })
  const rejectAll = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  lines.on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch (error) {
      rejectAll(new Error(`${label} Grok host emitted invalid stdout JSON: ${error.message}`))
      return
    }
    if (message.method && message.id != null) {
      events.push(eventShape(message))
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Method not found' }
      })}\n`)
      return
    }
    if (message.method) {
      events.push(eventShape(message))
      const update = message.params?.update
      if (message.method === 'session/update'
          && update?.sessionUpdate === 'agent_message_chunk'
          && typeof update.content?.text === 'string') {
        assistantText.push(update.content.text)
      }
      return
    }
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) {
      const error = new Error(message.error.message || JSON.stringify(message.error))
      error.code = message.error.code
      request.reject(error)
    } else {
      request.resolve(message.result ?? {})
    }
  })
  child.stderr.on('data', (chunk) => {
    if (stderr.join('').length < 32_768) stderr.push(chunk.toString('utf8'))
  })
  child.once('error', rejectAll)
  child.once('close', (code, signal) => {
    if (!stopped && pending.size > 0) {
      rejectAll(new Error(
        `${label} Grok host exited early (code=${code}, signal=${signal}): ${redact(stderr.join(''))}`
      ))
    }
  })

  return {
    assistantText,
    events,
    request(method, params, timeoutMs = 30_000) {
      return new Promise((resolve, reject) => {
        const id = nextId++
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Timed out waiting for ${label} ${method}`))
        }, timeoutMs)
        pending.set(id, { resolve, reject, timer })
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      })
    },
    async waitForQuiet(maximumMs = 1_000) {
      const startedAt = Date.now()
      let previous = -1
      let stable = 0
      while (Date.now() - startedAt < maximumMs && stable < 2) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        const length = events.length
        if (length === previous) stable += 1
        else stable = 0
        previous = length
      }
    },
    async stop() {
      stopped = true
      if (child.exitCode != null || child.signalCode != null) return
      child.kill('SIGTERM')
      await Promise.race([
        new Promise((resolve) => child.once('close', resolve)),
        new Promise((resolve) => setTimeout(resolve, 2_000))
      ])
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
    }
  }
}

async function initializeAndAuthenticate(host) {
  const initialize = await host.request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false
    },
    clientInfo: {
      name: 'rovai_history_restore_probe',
      title: 'Rovai-ai Grok HistoryRestore Probe',
      version: '1'
    }
  })
  const methodIds = Array.isArray(initialize.authMethods)
    ? initialize.authMethods.map((method) => method?.id).filter((id) => typeof id === 'string')
    : []
  const defaultMethod = initialize._meta?.defaultAuthMethodId
  const nonInteractive = new Set(['xai.api_key', 'cached_token'])
  const selected = typeof defaultMethod === 'string'
    && methodIds.includes(defaultMethod)
    && nonInteractive.has(defaultMethod)
    ? defaultMethod
    : ['cached_token', 'xai.api_key'].find((id) => methodIds.includes(id))
  if (!selected) throw new Error('Grok advertised no safe non-interactive auth method')
  await host.request('authenticate', { methodId: selected, _meta: { headless: true } })
  return initialize
}

function summarizeEvents(events) {
  const counts = new Map()
  for (const event of events) {
    const key = `${event.method}:${event.sessionUpdate ?? '-'}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([shape, count]) => ({ shape, count }))
}

function eventShape(message) {
  return {
    method: message.method,
    sessionUpdate: message.params?.update?.sessionUpdate
      ?? message.params?.sessionUpdate
      ?? null
  }
}

function tomlString(value) {
  return JSON.stringify(value)
}

function redact(value) {
  return value.replaceAll(apiKey, '<redacted>').replaceAll(/\s+/g, ' ').trim().slice(0, 2_048)
}
