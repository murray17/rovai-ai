import { spawn } from 'node:child_process'
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const executable = process.env.ROVAI_GROK_BIN?.trim() || 'grok'
const modelId = process.env.ROVAI_GROK_MODEL_ID?.trim()
const baseUrl = process.env.ROVAI_GROK_MODEL_BASE_URL?.trim()
const apiKey = process.env.ROVAI_GROK_MODEL_API_KEY?.trim()
const apiBackend = process.env.ROVAI_GROK_MODEL_API_BACKEND?.trim() || 'chat_completions'
const contextWindow = Number(process.env.ROVAI_GROK_MODEL_CONTEXT_WINDOW || 204800)
const keepFixture = process.env.ROVAI_KEEP_GROK_PROBE_FIXTURE === '1'
const environmentOnly = process.env.ROVAI_GROK_ENV_ONLY === '1'
const extendedProbe = process.env.ROVAI_GROK_EXTENDED_PROBE === '1'
const noLeader = process.env.ROVAI_GROK_NO_LEADER === '1'
const processPlugin = process.env.ROVAI_GROK_PROCESS_PLUGIN === '1'
const collisionProbe = process.env.ROVAI_GROK_MCP_COLLISION_PROBE === '1'
const productionPluginShape = process.env.ROVAI_GROK_MCP_PRODUCTION_SHAPE === '1'
const pluginWithoutVersion = process.env.ROVAI_GROK_PLUGIN_WITHOUT_VERSION === '1'
const pluginServerName = process.env.ROVAI_GROK_PLUGIN_SERVER_NAME?.trim() || 'rovai-plugin-probe'
const pluginManifestName = process.env.ROVAI_GROK_PLUGIN_MANIFEST_NAME?.trim()
  || 'rovai-session-plugin'
const productionPluginPath = process.env.ROVAI_GROK_PLUGIN_PRODUCTION_PATH === '1'
const managedSandbox = process.env.ROVAI_GROK_MANAGED_SANDBOX === '1'
const setModelOption = process.env.ROVAI_GROK_SET_MODEL_OPTION === '1'
const setModelMethod = process.env.ROVAI_GROK_SET_MODEL_METHOD === '1'
const omitSessionMeta = process.env.ROVAI_GROK_OMIT_SESSION_META === '1'
const managedProcessGroup = process.env.ROVAI_GROK_MANAGED_PROCESS_GROUP === '1'
const permissionMode = process.env.ROVAI_GROK_PERMISSION_MODE?.trim()
const compactionProbe = process.env.ROVAI_GROK_COMPACTION_PROBE === '1'

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

const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-grok-runtime-probe-'))
const grokHome = join(fixtureRoot, 'grok-home')
const projectRoot = join(fixtureRoot, 'project')
const pluginRoot = productionPluginPath
  ? join(fixtureRoot, 'data', 'runtime', 'grok-build', 'external-mcp', 'grok-mcp-plugin-probe')
  : join(fixtureRoot, 'rovai-session-plugin')
const providerAlias = 'rovai-private-provider'
const pluginResultPrefix = `rovai-grok-plugin-${process.pid}-${Date.now()}`
const pluginCollisionPrefix = `rovai-grok-plugin-collision-${process.pid}-${Date.now()}`
const nativeCollisionPrefix = `rovai-grok-native-collision-${process.pid}-${Date.now()}`
const pluginStartupMarker = join(fixtureRoot, 'plugin-started')
const pluginCollisionStartupMarker = join(fixtureRoot, 'plugin-collision-started')
const nativeCollisionStartupMarker = join(fixtureRoot, 'native-collision-started')
let child
const pending = new Map()
const stderr = []

try {
  await mkdir(grokHome, { mode: 0o700 })
  await mkdir(projectRoot, { mode: 0o700 })
  await writeFile(join(projectRoot, 'README.md'), '# Grok Build ACP Probe\n')
  if (extendedProbe) {
    const fixtureServer = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'crates',
      'rovai-core',
      'tests',
      'fixtures',
      'mcp-smoke-server.mjs'
    )
    await mkdir(pluginRoot, { recursive: productionPluginPath, mode: 0o700 })
    await writeFile(join(pluginRoot, 'plugin.json'), JSON.stringify({
      name: pluginManifestName,
      ...(!pluginWithoutVersion ? { version: '1.0.0' } : {})
    }, null, 2), { mode: 0o600 })
    const pluginMcpServers = {
      [pluginServerName]: {
        ...(productionPluginShape ? { type: 'stdio', cwd: projectRoot } : {}),
        command: process.execPath,
        args: [fixtureServer],
        env: {
          ROVAI_MCP_SMOKE_SOURCE: pluginResultPrefix,
          ROVAI_MCP_SMOKE_STARTUP_MARKER: pluginStartupMarker
        }
      }
    }
    if (collisionProbe) {
      pluginMcpServers['rovai-collision-probe'] = {
        command: process.execPath,
        args: [fixtureServer],
        env: {
          ROVAI_MCP_SMOKE_SOURCE: pluginCollisionPrefix,
          ROVAI_MCP_SMOKE_STARTUP_MARKER: pluginCollisionStartupMarker
        }
      }
    }
    await writeFile(join(pluginRoot, '.mcp.json'), JSON.stringify({
      mcpServers: pluginMcpServers
    }, null, 2), { mode: 0o600 })
  }
  if (!environmentOnly) {
    const configLines = [
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
    ]
    if (collisionProbe) {
      configLines.push(
        '[mcp_servers.rovai-collision-probe]',
        `command = ${tomlString(process.execPath)}`,
        `args = [${tomlString(join(
          dirname(fileURLToPath(import.meta.url)),
          '..',
          'crates',
          'rovai-core',
          'tests',
          'fixtures',
          'mcp-smoke-server.mjs'
        ))}]`,
        `env = { ROVAI_MCP_SMOKE_SOURCE = ${tomlString(nativeCollisionPrefix)}, ROVAI_MCP_SMOKE_STARTUP_MARKER = ${tomlString(nativeCollisionStartupMarker)} }`,
        '',
      )
    }
    configLines.push(
      '[cli]',
      'auto_update = false',
      ''
    )
    await writeFile(join(grokHome, 'config.toml'), configLines.join('\n'), { mode: 0o600 })
  }

  const grokArguments = [
    ...(permissionMode ? ['--permission-mode', permissionMode] : []),
    '--no-auto-update',
    'agent',
    ...(noLeader || processPlugin ? ['--no-leader'] : []),
    ...(extendedProbe && processPlugin ? ['--plugin-dir', pluginRoot] : []),
    'stdio'
  ]
  const sandboxDenialRoot = join(fixtureRoot, 'automation-v1')
  if (managedSandbox) await mkdir(sandboxDenialRoot, { mode: 0o700 })
  child = spawn(managedSandbox ? '/usr/bin/sandbox-exec' : executable, [
    ...(managedSandbox ? [
      '-p',
      `(version 1) (allow default) (deny file-read* (subpath ${JSON.stringify(sandboxDenialRoot)})) (deny file-write* (subpath ${JSON.stringify(sandboxDenialRoot)}))`,
      '--',
      executable
    ] : []),
    ...grokArguments
  ], {
    cwd: projectRoot,
    detached: managedProcessGroup,
    env: {
      ...process.env,
      ...(collisionProbe ? {
        HOME: fixtureRoot,
        XDG_CONFIG_HOME: join(fixtureRoot, 'xdg-config')
      } : {}),
      GROK_HOME: grokHome,
      GROK_DEFAULT_MODEL: environmentOnly ? modelId : providerAlias,
      GROK_DISABLE_AUTOUPDATER: '1',
      ROVAI_GROK_MODEL_API_KEY: apiKey,
      XAI_API_KEY: apiKey,
      ...(environmentOnly ? { GROK_MODELS_BASE_URL: baseUrl } : {})
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })

  child.stderr.on('data', (chunk) => {
    if (stderr.join('').length < 32_768) stderr.push(chunk.toString('utf8'))
  })
  const notifications = []
  const compactionEvents = []
  const assistantText = []
  const mcpTelemetry = {
    toolCallObserved: false,
    toolResultObserved: false,
    completedToolResultObserved: false,
    toolUpdateStatuses: [],
    toolResultSamples: [],
    serverUpdates: [],
    initializedToolCounts: []
  }
  let nextId = 1
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch (error) {
      rejectAll(new Error(`Grok emitted invalid stdout JSON: ${error.message}`))
      return
    }
    if (message.method && message.id != null) {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Method not found' }
      })}\n`)
      return
    }
    if (message.method) {
      notifications.push(sanitizeMessageShape(message))
      const extensionParams = message.params?.params
      const update = message.params?.update ?? extensionParams?.update
      if (typeof update?.sessionUpdate === 'string'
          && update.sessionUpdate.startsWith('auto_compact_')) {
        compactionEvents.push(sanitizeCompactionEvent(message, update))
      }
      if (message.method === '_x.ai/mcp/server_status') {
        mcpTelemetry.serverUpdates.push(sanitizeMcpServerStatus(message.params))
      }
      if (message.method === '_x.ai/mcp/init_progress'
          || message.method === '_x.ai/mcp_initialized') {
        const count = message.params?.mcpToolCount ?? message.params?.total
        if (Number.isFinite(count)) mcpTelemetry.initializedToolCounts.push(count)
      }
      if (message.method === 'session/update' && update?.sessionUpdate === 'tool_call') {
        const searchable = JSON.stringify({ title: update.title, rawInput: update.rawInput })
        if (searchable.includes('echo') || searchable.includes(pluginServerName)) {
          mcpTelemetry.toolCallObserved = true
        }
      }
      if (message.method === 'session/update' && update?.sessionUpdate === 'tool_call_update') {
        const searchable = JSON.stringify({ content: update.content, rawOutput: update.rawOutput })
        if (typeof update.status === 'string') mcpTelemetry.toolUpdateStatuses.push(update.status)
        if (searchable !== '{}') mcpTelemetry.toolResultSamples.push(searchable.slice(0, 1_024))
        if (searchable.includes(pluginResultPrefix)) {
          mcpTelemetry.toolResultObserved = true
          if (update.status === 'completed') mcpTelemetry.completedToolResultObserved = true
        }
      }
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
      error.data = message.error.data
      request.reject(error)
    }
    else request.resolve(message.result ?? {})
  })
  child.once('error', rejectAll)
  child.once('close', (code, signal) => {
    if (pending.size > 0) rejectAll(new Error(`Grok exited early (code=${code}, signal=${signal})`))
  })

  const request = (method, params, timeoutMs = 30_000) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`Timed out waiting for ${method}`))
    }, timeoutMs)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })

  const initialize = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false
    },
    clientInfo: {
      name: 'rovai_probe',
      title: 'Rovai-ai Grok Runtime Probe',
      version: '1'
    }
  })
  const authMethodIds = Array.isArray(initialize.authMethods)
    ? initialize.authMethods.map((method) => method?.id).filter((id) => typeof id === 'string')
    : []
  const initializeMeta = initialize._meta && typeof initialize._meta === 'object'
    ? initialize._meta
    : {}
  const defaultAuthMethodId = typeof initializeMeta.defaultAuthMethodId === 'string'
    ? initializeMeta.defaultAuthMethodId
    : null
  const nonInteractiveAuthMethods = new Set(['xai.api_key', 'cached_token'])
  const authMethod = defaultAuthMethodId
    && authMethodIds.includes(defaultAuthMethodId)
    && nonInteractiveAuthMethods.has(defaultAuthMethodId)
    ? defaultAuthMethodId
    : ['cached_token', 'xai.api_key'].find((id) => authMethodIds.includes(id)) ?? null
  if (authMethod) {
    await request('authenticate', { methodId: authMethod, _meta: { headless: true } }, 30_000)
  }

  let resumeProbe = null
  if (extendedProbe) {
    try {
      await request('session/resume', {
        sessionId: 'rovai-probe-deliberately-missing-session',
        cwd: projectRoot,
        mcpServers: []
      }, 30_000)
      resumeProbe = { accepted: true, errorCode: null, errorMessage: null }
    } catch (error) {
      resumeProbe = {
        accepted: false,
        errorCode: typeof error.code === 'number' ? error.code : null,
        errorMessage: String(error.message).slice(0, 512)
      }
    }
  }

  const session = await request('session/new', {
    cwd: projectRoot,
    mcpServers: [],
    ...(extendedProbe && !omitSessionMeta ? {
      _meta: {
        rules: [
          'When a user message contains ROVAI_NATIVE_RULES_TRIGGER,',
          'reply with exactly ROVAI_GROK_NATIVE_RULES_OK and nothing else.'
        ].join(' '),
        ...(!processPlugin ? { pluginDirs: [pluginRoot] } : {}),
        yoloMode: true
      }
    } : {})
  }, 30_000)
  const sessionId = session.sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('Grok session/new did not return a Session ID')
  }
  if (setModelOption) {
    await request('session/set_config_option', {
      sessionId,
      configId: 'model',
      type: 'select',
      value: modelId
    }, 30_000)
  }
  if (setModelMethod) {
    await request('session/set_model', {
      sessionId,
      modelId
    }, 30_000)
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 750))
  const firstOutputStart = assistantText.length
  const terminal = await request('session/prompt', {
    sessionId,
    prompt: [{
      type: 'text',
      text: extendedProbe
        ? 'ROVAI_NATIVE_RULES_TRIGGER. Reply with the word WRONG.'
        : 'Reply with exactly ROVAI_GROK_PROBE_OK and nothing else.'
    }]
  }, 180_000)
  await waitForQuiet(assistantText, 2, 200)
  const firstOutput = assistantText.slice(firstOutputStart).join('')

  let compaction = null
  if (compactionProbe) {
    const armed = await request('_x.ai/debug/arm_auto_compact', { sessionId }, 30_000)
    const compactionOutputStart = assistantText.length
    const compactionTerminal = await request('session/prompt', {
      sessionId,
      prompt: [{
        type: 'text',
        text: 'After compaction, reply with exactly ROVAI_GROK_COMPACTION_OK and nothing else.'
      }]
    }, 300_000)
    await waitForQuiet(assistantText, 2, 200)
    const compactionOutput = assistantText.slice(compactionOutputStart).join('')
    compaction = {
      armed: true,
      armResponseKeys: armed && typeof armed === 'object' ? Object.keys(armed).sort() : [],
      stopReason: compactionTerminal.stopReason ?? null,
      expectedMarkerObserved: compactionOutput.includes('ROVAI_GROK_COMPACTION_OK'),
      events: compactionEvents
    }
  }

  let mcpProbe = null
  if (extendedProbe) {
    const mcpOutputStart = assistantText.length
    const mcpTerminal = await request('session/prompt', {
      sessionId,
      prompt: [{
        type: 'text',
        text: [
          `Use the MCP echo tool from the ${pluginServerName} server exactly once.`,
          'Pass the exact argument text "verify".',
          'Then reply with exactly the tool result and nothing else.'
        ].join(' ')
      }]
    }, 180_000)
    await waitForQuiet(assistantText, 2, 200)
    const mcpOutput = assistantText.slice(mcpOutputStart).join('')
    mcpProbe = {
      stopReason: mcpTerminal.stopReason ?? null,
      resultMarkerObserved: mcpOutput.includes(`${pluginResultPrefix}:verify`),
      resultPrefixObserved: mcpOutput.includes(pluginResultPrefix),
      ...mcpTelemetry
    }
    if (collisionProbe) {
      const collisionOutputStart = assistantText.length
      const collisionTerminal = await request('session/prompt', {
        sessionId,
        prompt: [{
          type: 'text',
          text: [
            'Use the MCP echo tool from the rovai-collision-probe server exactly once.',
            'Pass the exact argument text "collision".',
            'Then reply with exactly the tool result and nothing else.'
          ].join(' ')
        }]
      }, 180_000)
      await waitForQuiet(assistantText, 2, 200)
      const collisionOutput = assistantText.slice(collisionOutputStart).join('')
      const telemetry = JSON.stringify(mcpTelemetry.toolResultSamples)
      mcpProbe.collision = {
        stopReason: collisionTerminal.stopReason ?? null,
        pluginWon: collisionOutput.includes(pluginCollisionPrefix)
          || telemetry.includes(pluginCollisionPrefix),
        nativeWon: collisionOutput.includes(nativeCollisionPrefix)
          || telemetry.includes(nativeCollisionPrefix),
        pluginServerStarted: await pathExists(pluginCollisionStartupMarker),
        nativeServerStarted: await pathExists(nativeCollisionStartupMarker)
      }
    }
    mcpProbe.uniquePluginServerStarted = await pathExists(pluginStartupMarker)
  }

  console.log(JSON.stringify({
    runtime: 'grok-build',
    provider: {
      modelId,
      apiBackend,
      baseUrlPresent: true,
      credentialPresent: true
    },
    initialize: {
      protocolVersion: initialize.protocolVersion,
      keys: Object.keys(initialize).sort(),
      authMethodIds,
      selectedAuthMethodId: authMethod,
      defaultAuthMethodId,
      metaKeys: Object.keys(initializeMeta).sort(),
      pluginDirsCapability: sanitizeCapability(initializeMeta['x.ai/pluginDirs']),
      mcpServers: sanitizeMcpServers(initializeMeta.mcpServers),
      agentCapabilities: initialize.agentCapabilities ?? null
    },
    resumeProbe,
    session: {
      keys: Object.keys(session).sort(),
      sessionIdPresent: true,
      modelIds: observedModelIds(session),
      modeIds: observedModeIds(session)
    },
    prompt: {
      stopReason: terminal.stopReason ?? null,
      expectedMarkerObserved: firstOutput.includes(
        extendedProbe ? 'ROVAI_GROK_NATIVE_RULES_OK' : 'ROVAI_GROK_PROBE_OK'
      ),
      thinkingTextObserved: firstOutput.includes('<think>'),
      notificationShapes: notifications
    },
    compactionProbe: compaction,
    mcpProbe
  }, null, 2))
} catch (error) {
  const detail = child ? boundedChildError(child, stderr, [apiKey]) : ''
  throw new Error(`${error.message}${detail ? ` (${detail})` : ''}`)
} finally {
  if (child && child.exitCode == null && child.signalCode == null) {
    child.kill('SIGTERM')
    await Promise.race([
      new Promise((resolveWait) => child.once('close', resolveWait)),
      new Promise((resolveWait) => setTimeout(resolveWait, 2_000))
    ])
    if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
  }
  if (keepFixture) console.error(`Grok probe fixture kept at ${fixtureRoot}`)
  else await rm(fixtureRoot, { recursive: true, force: true })
}

function rejectAll(error) {
  for (const request of pending.values()) {
    clearTimeout(request.timer)
    request.reject(error)
  }
  pending.clear()
}

function tomlString(value) {
  return JSON.stringify(value)
}

function sanitizeMessageShape(message) {
  const update = message.params?.update ?? message.params?.params?.update
  return {
    method: message.method,
    sessionUpdate: typeof update?.sessionUpdate === 'string' ? update.sessionUpdate : null,
    keys: Object.keys(update ?? message.params ?? {}).sort()
  }
}

function sanitizeCompactionEvent(message, update) {
  const payload = message.params?.params ?? message.params ?? {}
  const meta = payload?._meta
  return {
    method: message.method,
    innerMethod: typeof message.params?.method === 'string' ? message.params.method : null,
    sessionIdPresent: typeof payload.sessionId === 'string' && payload.sessionId.length > 0,
    sessionUpdate: update.sessionUpdate,
    eventIdPresent: typeof meta?.eventId === 'string' && meta.eventId.length > 0,
    isReplay: meta?.isReplay === true,
    updateKeys: Object.keys(update).sort(),
    tokensBeforeType: update.tokens_before == null ? null : typeof update.tokens_before,
    tokensAfterType: update.tokens_after == null ? null : typeof update.tokens_after,
    elapsedMsType: update.elapsed_ms == null ? null : typeof update.elapsed_ms
  }
}

function observedModelIds(session) {
  const ids = new Set()
  for (const model of session.models?.availableModels ?? []) {
    if (typeof model?.modelId === 'string') ids.add(model.modelId)
  }
  for (const option of session.configOptions ?? []) {
    if (option?.id !== 'model') continue
    if (typeof option.currentValue === 'string') ids.add(option.currentValue)
    for (const value of option.options ?? []) {
      if (typeof value?.value === 'string') ids.add(value.value)
    }
  }
  return [...ids].sort()
}

function observedModeIds(session) {
  const ids = new Set()
  if (typeof session.modes?.currentModeId === 'string') ids.add(session.modes.currentModeId)
  for (const mode of session.modes?.availableModes ?? []) {
    if (typeof mode?.id === 'string') ids.add(mode.id)
  }
  return [...ids].sort()
}

function sanitizeCapability(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value ?? null
  if (Array.isArray(value)) return { type: 'array', length: value.length }
  if (typeof value === 'object') return { type: 'object', keys: Object.keys(value).sort() }
  return null
}

function sanitizeMcpServerStatus(value) {
  return {
    name: typeof value?.name === 'string' ? value.name : null,
    source: typeof value?.source === 'string' ? value.source : null,
    status: typeof value?.status === 'string' ? value.status : null,
    reason: typeof value?.reason === 'string' ? value.reason.slice(0, 256) : null,
    detail: typeof value?.detail === 'string' ? value.detail.slice(0, 256) : null,
    toolCount: Array.isArray(value?.tools) ? value.tools.length : null
  }
}

function sanitizeMcpServers(value) {
  if (!Array.isArray(value)) return []
  return value.map((server) => ({
    name: typeof server?.name === 'string' ? server.name : null,
    source: typeof server?.source === 'string' ? server.source : null,
    enabled: typeof server?.enabled === 'boolean' ? server.enabled : null,
    keys: server && typeof server === 'object' ? Object.keys(server).sort() : []
  }))
}

async function waitForQuiet(chunks, checks, intervalMs) {
  let previous = -1
  let stable = 0
  while (stable < checks) {
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs))
    const length = chunks.join('').length
    if (length === previous) stable += 1
    else stable = 0
    previous = length
  }
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function boundedChildError(processHandle, chunks, secrets) {
  let output = chunks.join('').replaceAll(/\s+/g, ' ').trim()
  for (const secret of secrets.filter(Boolean)) output = output.replaceAll(secret, '[REDACTED]')
  output = output.replaceAll(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]').slice(0, 4_096)
  const status = `Grok status (code=${processHandle.exitCode}, signal=${processHandle.signalCode})`
  return output ? `${status}; stderr=${output}` : status
}
