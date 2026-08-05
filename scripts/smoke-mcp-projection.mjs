import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-mcp-projection-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
const mcpConfigPath = join(fixtureRoot, 'config', 'mcp.json')
const fixture = join(root, 'crates/rovai-core/tests/fixtures/mcp-smoke-server.mjs')
const serverId = '6f589c15-bba8-42e5-a20a-cd6749824207'
const serverName = 'rovai_smoke'
const projectedHttpServerId = '1bb55b1c-39fc-40cc-b9d5-e6ba2dfcd577'
const projectedHttpServerName = 'rovai_smoke_http'
const projectedStdioServerId = '9de5a1c5-d645-425e-8fbd-eb12b7443103'
const projectedStdioServerName = 'rovai_smoke_stdio'
const selected = (process.env.ROVAI_MCP_PROJECTION_SMOKE_ADAPTERS ?? 'all')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const allAdapters = [
  'codex-cli',
  'claude-code-cli',
  'opencode-cli',
  'copilot-cli',
  'kiro-cli',
  'qoder-cli',
  'codebuddy-cli',
  'qwen-code'
]
const adapters = selected.length === 1 && selected[0] === 'all' ? allAdapters : selected
let core = null
let projectedHttp = null
let nativeHttp = null

try {
  for (const adapter of adapters) {
    if (!allAdapters.includes(adapter)) throw new Error(`Unsupported MCP Projection smoke Adapter: ${adapter}`)
  }
  projectedHttp = await startMcpHttpServer('rovai-projection-http')
  nativeHttp = await startMcpHttpServer('runtime-native-http')
  await prepareProject(nativeHttp.url)
  await prepareRovaiConfig(projectedHttp.url)
  core = startCore()
  await core.request('health.check')
  const workspace = await core.request('workspaces.inspect', { path: projectRoot })
  const results = []

  for (const adapterKind of adapters) {
    const runtime = await configureRuntime(core.request, adapterKind)
    const adapterMarker = adapterName(adapterKind)
    const expected = adapterKind === 'codex-cli'
      ? [
          `rovai-projection:${adapterMarker}`,
          `rovai-projection-http:${adapterMarker}-http`,
          `rovai-projection-stdio:${adapterMarker}-stdio`
        ]
      : [`rovai-projection:${adapterMarker}`]
    const forbidden = adapterKind === 'codex-cli'
      ? [
          `runtime-native:${adapterMarker}`,
          `runtime-native:${adapterMarker}-http`,
          `runtime-native-http:${adapterMarker}-stdio`
        ]
      : [`runtime-native:${adapterMarker}`]
    const startedAt = Date.now()
    const result = await runProjectedTool(core.request, workspace, adapterKind, adapterMarker)
    for (const marker of expected) {
      assert(result.output.includes(marker), `${adapterKind} did not return the projected marker ${marker}: ${JSON.stringify(result)}`)
    }
    for (const marker of forbidden) {
      assert(!result.output.includes(marker), `${adapterKind} silently used the same-name Runtime-native MCP ${marker}: ${JSON.stringify(result)}`)
    }
    const expectedServers = adapterKind === 'codex-cli'
      ? [serverName, projectedHttpServerName, projectedStdioServerName]
      : [serverName]
    const exposures = expectedServers.map((name) => result.exposure?.servers?.find((server) => server.name === name))
    for (const exposure of exposures) {
      assert(exposure?.status === 'ready', `${adapterKind} did not freeze a ready MCP exposure: ${JSON.stringify(result.exposure)}`)
      assert(
        adapterKind === 'copilot-cli'
          ? exposure.runtimeName.startsWith('rovai__')
          : exposure.runtimeName === exposure.name,
        `${adapterKind} froze an invalid Runtime MCP name: ${JSON.stringify(exposure)}`
      )
    }
    results.push({
      adapterKind,
      reportedVersion: runtime.snapshot.reportedVersion,
      modelId: selectedModel(adapterKind) ?? runtime.memberRuntimeDefaults?.model?.modelId ?? 'runtime_default',
      runtimeNames: exposures.map((exposure) => exposure.runtimeName),
      results: expected,
      agentRunId: result.agentRunId,
      durationMs: Date.now() - startedAt
    })
  }

  console.log(JSON.stringify({
    ok: true,
    semantics: 'Rovai projection overrides the same-name Runtime-native MCP',
    results
  }, null, 2))
} finally {
  if (core) await core.stop()
  if (projectedHttp) await projectedHttp.stop()
  if (nativeHttp) await nativeHttp.stop()
  await rm(fixtureRoot, { recursive: true, force: true })
}

async function prepareProject(nativeHttpUrl) {
  await mkdir(projectRoot, { recursive: true })
  await mkdir(join(projectRoot, '.codex'), { recursive: true })
  await mkdir(join(projectRoot, '.kiro', 'settings'), { recursive: true })
  const nativeServer = {
    type: 'stdio',
    command: process.execPath,
    args: [fixture],
    env: { ROVAI_MCP_SMOKE_SOURCE: 'runtime-native' }
  }
  const nativeServers = {
    [serverName]: nativeServer,
    [projectedHttpServerName]: nativeServer,
    [projectedStdioServerName]: { url: nativeHttpUrl }
  }
  await writeFile(join(projectRoot, 'README.md'), '# Rovai-ai same-name MCP Projection smoke\n')
  await writeFile(join(projectRoot, '.mcp.json'), `${JSON.stringify({
    mcpServers: nativeServers
  }, null, 2)}\n`)
  await writeFile(join(projectRoot, '.kiro', 'settings', 'mcp.json'), `${JSON.stringify({
    mcpServers: nativeServers
  }, null, 2)}\n`)
  await writeFile(join(projectRoot, 'opencode.json'), `${JSON.stringify({
    mcp: {
      [serverName]: {
        type: 'local',
        command: [process.execPath, fixture],
        enabled: true,
        environment: { ROVAI_MCP_SMOKE_SOURCE: 'runtime-native' }
      },
      [projectedHttpServerName]: {
        type: 'local',
        command: [process.execPath, fixture],
        enabled: true,
        environment: { ROVAI_MCP_SMOKE_SOURCE: 'runtime-native' }
      },
      [projectedStdioServerName]: {
        type: 'remote',
        url: nativeHttpUrl,
        enabled: true
      }
    }
  }, null, 2)}\n`)
  await writeFile(join(projectRoot, '.codex', 'config.toml'), [
    `[mcp_servers.${serverName}]`,
    `command = ${JSON.stringify(process.execPath)}`,
    `args = [${JSON.stringify(fixture)}]`,
    `[mcp_servers.${serverName}.env]`,
    'ROVAI_MCP_SMOKE_SOURCE = "runtime-native"',
    `[mcp_servers.${projectedHttpServerName}]`,
    `command = ${JSON.stringify(process.execPath)}`,
    `args = [${JSON.stringify(fixture)}]`,
    `[mcp_servers.${projectedHttpServerName}.env]`,
    'ROVAI_MCP_SMOKE_SOURCE = "runtime-native"',
    `[mcp_servers.${projectedStdioServerName}]`,
    `url = ${JSON.stringify(nativeHttpUrl)}`,
    ''
  ].join('\n'))
  await run('git', ['init', '-b', 'main'], projectRoot)
  await run('git', ['config', 'user.name', 'Rovai-ai MCP Projection Smoke'], projectRoot)
  await run('git', ['config', 'user.email', 'mcp-projection-smoke@rovai.local'], projectRoot)
  await run('git', ['add', '.'], projectRoot)
  await run('git', ['commit', '-m', 'same-name Runtime-native MCP fixture'], projectRoot)
}

async function prepareRovaiConfig(projectedHttpUrl) {
  await mkdir(resolve(mcpConfigPath, '..'), { recursive: true, mode: 0o700 })
  await chmod(resolve(mcpConfigPath, '..'), 0o700)
  await writeFile(mcpConfigPath, `${JSON.stringify({
    mcpServers: {
      [serverName]: {
        command: process.execPath,
        args: [fixture],
        env: { ROVAI_MCP_SMOKE_SOURCE: 'rovai-projection' }
      },
      [projectedHttpServerName]: {
        url: projectedHttpUrl
      },
      [projectedStdioServerName]: {
        command: process.execPath,
        args: [fixture],
        env: { ROVAI_MCP_SMOKE_SOURCE: 'rovai-projection-stdio' }
      }
    },
    _rovai: {
      schemaVersion: 2,
      servers: {
        [serverName]: {
          serverId,
          enabled: true,
          source: 'user',
          riskLevel: 'standard'
        },
        [projectedHttpServerName]: {
          serverId: projectedHttpServerId,
          enabled: true,
          source: 'user',
          riskLevel: 'standard'
        },
        [projectedStdioServerName]: {
          serverId: projectedStdioServerId,
          enabled: true,
          source: 'user',
          riskLevel: 'standard'
        }
      },
      assignments: [serverId, projectedHttpServerId, projectedStdioServerId]
        .map((assignedServerId) => ({ serverId: assignedServerId, agentProfileId: 'agent-luoke' }))
    }
  }, null, 2)}\n`, { mode: 0o600 })
  await chmod(mcpConfigPath, 0o600)
}

async function configureRuntime(request, adapterKind) {
  const runtime = await configureProductRuntime(request, adapterKind, ['agent-luoke'])
  const modelId = selectedModel(adapterKind)
  if (!modelId) return runtime
  if (!runtime.snapshot.models.some((model) => model.id === modelId)) {
    throw new Error(`${adapterKind} smoke model is unavailable: ${modelId}`)
  }
  const profile = await request('agents.get', { agentProfileId: 'agent-luoke' })
  const configured = await request('agents.runtime.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentProfileId: 'agent-luoke',
      expectedVersion: profile.version,
      adapterKind,
      model: { mode: 'explicit', modelId, options: {} },
      permissions: runtime.memberRuntimeDefaults.permissions
    }
  })
  if (configured.status !== 'applied') {
    throw new Error(`${adapterKind} smoke model was rejected: ${JSON.stringify(configured)}`)
  }
  return runtime
}

async function runProjectedTool(request, workspace, adapterKind, adapterMarker) {
  const toolInstructions = adapterKind === 'codex-cli'
    ? [
        `Call \`${serverName}.echo\` exactly once with text \`${adapterMarker}\`.`,
        `Call \`${projectedHttpServerName}.echo\` exactly once with text \`${adapterMarker}-http\`.`,
        `Call \`${projectedStdioServerName}.echo\` exactly once with text \`${adapterMarker}-stdio\`.`,
        'Return all three tool results.'
      ]
    : [
        `Call the assigned MCP server named \`${serverName}\` and its \`echo\` tool exactly once with text \`${adapterMarker}\`.`,
        'Return the tool result.'
      ]
  const created = await createConfiguredCampAndSend(request, {
    commandId: crypto.randomUUID(),
    workspace,
    body: [...toolInstructions, 'Do not use a Runtime-native server with the same name.'].join('\n'),
    address: { mode: 'explicit', agentProfileIds: ['agent-luoke'] },
    purpose: `Verify ${adapterKind} gives the frozen Rovai MCP Projection precedence over a same-name Runtime-native MCP.`,
    expectedOutput: adapterKind === 'codex-cli'
      ? `All three Rovai projection markers for ${adapterMarker}`
      : `rovai-projection:${adapterMarker}`
  })
  if (created.status !== 'accepted' || !created.payload?.agentRunIds?.[0]) {
    throw new Error(`${adapterKind} MCP Projection Camp was not accepted: ${JSON.stringify(created)}`)
  }
  const agentRunId = created.payload.agentRunIds[0]
  const resolvedApprovals = new Set()
  let lastState = null
  const snapshot = await waitFor(async () => {
    const candidate = await request('camps.snapshot', { campId: created.payload.campId })
    for (const approval of candidate.approvals.filter((value) =>
      value.status === 'pending'
        && !resolvedApprovals.has(value.id)
        && candidate.actions.some((action) => action.id === value.actionId && action.agentRunId === agentRunId)
    )) {
      const option = approval.options.find((value) => value.kind === 'allow_once')
        ?? approval.options.find((value) => value.kind === 'allow_session')
      if (!option) throw new Error(`${adapterKind} MCP request has no exact allow option: ${JSON.stringify(approval)}`)
      const resolution = await request('action.approvals.resolve', {
        commandId: crypto.randomUUID(),
        campId: created.payload.campId,
        approvalId: approval.id,
        expectedVersion: approval.version,
        optionId: option.optionId,
        reason: 'Real same-name MCP Projection smoke test'
      })
      if (resolution.status === 'rejected') throw new Error(`${adapterKind} MCP approval was rejected: ${JSON.stringify(resolution)}`)
      resolvedApprovals.add(approval.id)
    }
    const run = candidate.agentRuns.find((value) => value.id === agentRunId)
    const output = candidate.messages
      .filter((message) => message.authorType === 'agent' && message.sourceAgentRunId === agentRunId)
      .map((message) => message.body)
      .join('\n')
    lastState = { run, output, timeline: candidate.timeline.slice(-8) }
    if (run?.status === 'failed' || run?.status === 'cancelled') {
      throw new Error(`${adapterKind} same-name MCP AgentRun failed: ${JSON.stringify(lastState)}`)
    }
    return run?.status === 'succeeded' ? candidate : null
  }, `${adapterKind} same-name MCP Projection`, 360_000)
  const output = snapshot.messages
    .filter((message) => message.authorType === 'agent' && message.sourceAgentRunId === agentRunId)
    .map((message) => message.body.trim())
    .join('\n')
  const manifest = snapshot.contextManifests.find((value) => value.agentRunId === agentRunId)
  return { agentRunId, output, exposure: manifest?.mcpExposure, lastState }
}

function startMcpHttpServer(source) {
  return new Promise((resolveStart, rejectStart) => {
    const server = createServer(async (request, response) => {
      if (request.method !== 'POST' || request.url !== '/mcp') {
        response.writeHead(404).end()
        return
      }
      try {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (message.id === undefined) {
          response.writeHead(202).end()
          return
        }
        let result
        if (message.method === 'initialize') {
          result = {
            protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'rovai-mcp-http-smoke', version: '1.0.0' }
          }
        } else if (message.method === 'tools/list') {
          result = {
            tools: [{
              name: 'echo',
              description: 'Return a deterministic Rovai-ai HTTP MCP smoke marker.',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
                additionalProperties: false
              }
            }]
          }
        } else if (message.method === 'tools/call') {
          result = {
            content: [{
              type: 'text',
              text: `${source}:${message.params?.arguments?.text ?? ''}`
            }]
          }
        } else {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `Unsupported method: ${message.method}` }
          }))
          return
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
      } catch (error) {
        response.writeHead(500, { 'content-type': 'text/plain' })
        response.end(String(error))
      }
    })
    server.once('error', rejectStart)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolveStart({
        url: `http://127.0.0.1:${address.port}/mcp`,
        stop: () => new Promise((resolveStop, rejectStop) => {
          server.close((error) => error ? rejectStop(error) : resolveStop())
        })
      })
    })
  })
}

function selectedModel(adapterKind) {
  return ({
    'opencode-cli': process.env.ROVAI_MCP_OPENCODE_MODEL ?? 'opencode/mimo-v2.5-free',
    'qoder-cli': process.env.ROVAI_MCP_QODER_MODEL ?? 'deepseek/deepseek-v4-flash-pg',
    'codebuddy-cli': process.env.ROVAI_MCP_CODEBUDDY_MODEL ?? 'deepseek-v4-flash',
    'qwen-code': process.env.ROVAI_MCP_QWEN_MODEL ?? 'deepseek-v4-flash(openai)'
  })[adapterKind] ?? null
}

function adapterName(adapterKind) {
  return adapterKind.replace(/-cli$/, '').replace('-code', '').replaceAll('-', '_')
}

function startCore() {
  const coreExecutable = process.env.ROVAI_CORE_EXECUTABLE
    ? resolve(process.env.ROVAI_CORE_EXECUTABLE)
    : join(root, 'target', 'debug', 'rovai-core')
  const child = spawn(coreExecutable, [
    '--data-dir', dataDir,
    '--mcp-config-path', mcpConfigPath,
    '--antigravity-team-private-dir', join(dataDir, 'runtime-private', 'antigravity-team')
  ], {
    cwd: root,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.pipe(process.stderr)
  const pending = new Map()
  let nextId = 1
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method) return
    const pendingRequest = pending.get(message.id)
    if (!pendingRequest) return
    clearTimeout(pendingRequest.timer)
    pending.delete(message.id)
    if (message.error) pendingRequest.reject(new Error(message.error.message))
    else pendingRequest.resolve(message.result)
  })
  const request = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`Timed out waiting for ${method}`))
    }, 120_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
  const stop = async () => {
    if (child.killed || child.exitCode !== null) return
    child.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      wait(4_000)
    ])
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  return { request, stop }
}

async function waitFor(read, label, timeoutMs) {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await read()
      if (value) return value
    } catch (error) {
      lastError = error
      if (String(error.message).includes('failed:')) throw error
    }
    await wait(500)
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}

function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code) => code === 0
      ? resolveRun(stdout.join(''))
      : rejectRun(new Error(`${command} failed (${code}): ${stderr.join('')}`)))
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
