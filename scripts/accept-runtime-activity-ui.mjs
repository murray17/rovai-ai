import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai-ai.app'))
const fixtureRoot = process.env.ROVAI_RUNTIME_ACTIVITY_ACCEPT_FIXTURE_ROOT
  ?? await mkdtemp(join(tmpdir(), 'rovai-runtime-activity-ui-accept-'))
const dataDir = join(fixtureRoot, 'user-data')
const runtimeTempDir = process.env.ROVAI_RUNTIME_ACTIVITY_ACCEPT_RUNTIME_TMP
  ?? await mkdtemp('/tmp/rv-activity-')
const outputDir = process.env.ROVAI_RUNTIME_ACTIVITY_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-runtime-activity-ui-captures-'))
const databasePath = join(dataDir, 'rovai.sqlite')
const debugPort = Number(process.env.ROVAI_RUNTIME_ACTIVITY_ACCEPT_DEBUG_PORT ?? 9581)
const campId = 'camp-runtime-activity-v041'
const campTitle = 'v0.41 九 Runtime Activity 验收'
const runArticleSelector = 'article.timeline-node.conversation-bubble.agent'

const runtimes = [
  runtime('codex', 'codex-cli', 'Codex CLI', 'filesystem/read_file', 'Runtime 报告', {
    protocol: 'codex-app-server', domain: 'tool', semantic: 'tool.mcp.call',
    evidenceKind: 'activity', eventType: 'activity.completed', payload: {
      item: { id: 'op-codex', type: 'mcpToolCall', status: 'completed', server: 'filesystem', tool: 'read_file', output: 'README.md' }
    }
  }),
  runtime('opencode', 'opencode-cli', 'OpenCode', 'read_file', 'Runtime 报告', acp('read', 'read_file', 'file', 'file.read')),
  runtime('copilot', 'copilot-cli', 'GitHub Copilot', 'edit_file', 'Runtime 报告', acp('edit', 'edit_file', 'file', 'file.write')),
  runtime('kiro', 'kiro-cli', 'Kiro', 'execute', 'Runtime 报告', acp('execute', 'execute', 'shell', 'shell.execute')),
  runtime('qoder', 'qoder-cli', 'Qoder', 'search_workspace', 'Runtime 报告', acp('search', 'search_workspace', 'tool', 'tool.web.search')),
  runtime('codebuddy', 'codebuddy-cli', 'CodeBuddy', 'mcp_call', 'Runtime 报告', acp('mcp_tool_call', 'mcp_call', 'tool', 'tool.call')),
  runtime('qwen', 'qwen-code', 'Qwen Code', 'write_file', 'Runtime 报告', acp('write_file', 'write_file', 'file', 'file.write')),
  runtime('claude', 'claude-code-cli', 'Claude Code', null, null, {
    protocol: 'claude-stream-json', domain: 'runtime', semantic: 'runtime.run', runLevelOnly: true
  }),
  runtime('antigravity', 'antigravity-app', 'Antigravity', 'team.call_member', 'Core 已验证', {
    protocol: 'antigravity-log', domain: 'tool', semantic: 'tool.call',
    evidenceKind: 'runtime.action', eventType: 'runtime.action', sourceAuthority: 'core',
    credibility: 'core_verified', payload: {
      toolCallId: 'op-antigravity', status: 'completed', kind: 'mcp_tool_call',
      title: 'Team Tool', sourceAuthority: 'core', canonicalTool: 'team.call_member', output: 'delivered'
    }
  })
]

await mkdir(dataDir, { recursive: true })
await mkdir(outputDir, { recursive: true })
await initializeDatabase()
await seedFixture()

let app = null
try {
  app = await launchApp(debugPort, 1480, 1120)
  await setTheme(app.cdp, 'day')
  await openCamp(app.cdp, campId)
  await waitForExpression(app.cdp,
    `document.querySelectorAll(${JSON.stringify(runArticleSelector)}).length > 0`, 30_000)
  const renderedRunCount = await evaluate(app.cdp,
    `document.querySelectorAll(${JSON.stringify(runArticleSelector)}).length`)
  assert(renderedRunCount === runtimes.length,
    `Expected ${runtimes.length} rendered AgentRuns, found ${renderedRunCount}: ${await evaluate(app.cdp, 'document.body.innerText.slice(0, 5000)')}`)
  await evaluate(app.cdp, `(() => {
    document.querySelectorAll('details.execution-disclosure').forEach((details) => { details.open = true })
    return true
  })()`)
  await wait(250)

  const observed = await collectRuntimeRows(app.cdp)
  assertRuntimeRows(observed)
  const totalToolRows = observed.reduce((total, row) => total + row.toolTitles.length, 0)
  assert(totalToolRows === 8,
    `Expected exactly eight observed tool rows and one honest run-level row: ${JSON.stringify(observed)}`)

  await evaluate(app.cdp, `(() => {
    const timeline = document.querySelector('.camp-timeline')
    if (timeline) timeline.scrollTop = 0
    return timeline?.scrollTop ?? 0
  })()`)
  await wait(150)
  const topCapture = join(outputDir, 'runtime-activity-top.png')
  await capture(app.cdp, topCapture)

  await evaluate(app.cdp, `(() => {
    const timeline = document.querySelector('.camp-timeline')
    if (timeline) timeline.scrollTop = timeline.scrollHeight
    return timeline?.scrollTop ?? 0
  })()`)
  await wait(150)
  const bottomCapture = join(outputDir, 'runtime-activity-bottom.png')
  await capture(app.cdp, bottomCapture)

  const reportPath = join(outputDir, 'runtime-activity-acceptance.json')
  const report = {
    ok: true,
    mode: 'controlled-structured-fixture',
    classifierVersion: 'activity-v1',
    app: basename(appPath),
    fixtureRoot,
    outputDir,
    verified: {
      runtimeCount: observed.length,
      canonicalToolRows: totalToolRows,
      codexLifecycleMergedToOneRow: observed.find((row) => row.runtime === 'Codex CLI')?.toolTitles.length === 1,
      claudeRunLevelDoesNotInventTools: observed.find((row) => row.runtime === 'Claude Code')?.toolTitles.length === 0,
      antigravityCoreToolCatalogName: observed.find((row) => row.runtime === 'Antigravity')?.toolTitles[0] === 'team.call_member'
    },
    runtimes: observed,
    captures: { top: topCapture, bottom: bottomCapture }
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ ...report, reportPath }, null, 2))
} finally {
  if (app) await closeApp(app)
}

function runtime(key, adapterKind, runtimeName, expectedToolName, expectedSource, details) {
  return {
    key,
    agentId: `agent_${101 + runtimesLengthHint(key)}`,
    adapterKind,
    runtimeName,
    expectedToolName,
    expectedSource,
    ...details
  }
}

function runtimesLengthHint(key) {
  return ['codex', 'opencode', 'copilot', 'kiro', 'qoder', 'codebuddy', 'qwen', 'claude', 'antigravity'].indexOf(key)
}

function acp(kind, toolName, domain, semantic) {
  return {
    protocol: 'acp-v1', domain, semantic,
    evidenceKind: 'runtime.action', eventType: 'runtime.action', payload: {
      toolCallId: `op-${toolName}`, status: 'completed', kind,
      toolName, title: toolName, output: 'fixture completed'
    }
  }
}

async function initializeDatabase() {
  const core = startCore(dataDir)
  try {
    const health = await core.request('health.check')
    assert(health?.database?.ok, `Core did not initialize the fixture database: ${JSON.stringify(health)}`)
  } finally {
    await core.stop()
  }
}

async function seedFixture() {
  const now = '2026-08-05T12:00:00Z'
  const profileRows = runtimes.map((entry, index) => `(
    ${sqlLiteral(`uuid-runtime-${entry.key}`)}, ${sqlLiteral(entry.agentId)},
    ${sqlLiteral(`runtime-${entry.key}`)}, ${sqlLiteral(`${entry.runtimeName} 验收`)},
    ${sqlLiteral(['#5B6C8F', '#4C7A78', '#6B668E', '#7A6756', '#5E7485', '#76627A', '#5C7960', '#786C59', '#596D7B'][index])},
    0, '{}', ${sqlLiteral(now)}, ${sqlLiteral(now)}, '[]', 'present', 1,
    ${sqlLiteral(`runtime_${entry.key}`)}, ${100 + index}, ${sqlLiteral(entry.adapterKind)},
    'Runtime Activity 验收', '', '[]', '', ''
  )`).join(',\n')
  const memberRows = runtimes.map((entry) => `(
    ${sqlLiteral(campId)}, ${sqlLiteral(entry.agentId)}, 'active', '{}', 1, ${sqlLiteral(now)}
  )`).join(',\n')
  const conversationRows = runtimes.map((entry) => `(
    ${sqlLiteral(`conversation-${entry.key}`)}, ${sqlLiteral(campId)}, ${sqlLiteral(entry.agentId)},
    1, ${sqlLiteral(now)}, ${sqlLiteral(now)}
  )`).join(',\n')
  const turnRows = runtimes.map((entry, index) => `(
    ${sqlLiteral(`turn-${entry.key}`)}, ${sqlLiteral(campId)}, 'system_event',
    ${sqlLiteral(`runtime-activity-${entry.key}`)}, 'completed',
    1, ${sqlLiteral(now)}, '2026-08-06T12:00:00Z', 86400, 32, 16, 1,
    1,
    ${sqlLiteral(`2026-08-05T12:${String(index).padStart(2, '0')}:00Z`)},
    ${sqlLiteral(`2026-08-05T12:${String(index).padStart(2, '0')}:02Z`)},
    ${sqlLiteral(`2026-08-05T12:${String(index).padStart(2, '0')}:02Z`)}
  )`).join(',\n')
  const runRows = runtimes.map((entry, index) => `(
    ${sqlLiteral(`run-${entry.key}`)}, ${sqlLiteral(`turn-${entry.key}`)},
    ${sqlLiteral(`conversation-${entry.key}`)}, 0, 0,
    ${sqlLiteral(`direct:${entry.agentId}`)}, 'initial',
    ${sqlLiteral(`验证 ${entry.runtimeName} Runtime Activity`)}, '展示观测诚实的工具名称',
    'required', '{}', 'succeeded', ${sqlLiteral(`runtime-activity-${entry.key}`)},
    1, ${sqlLiteral(`2026-08-05T12:${String(index).padStart(2, '0')}:00Z`)},
    ${sqlLiteral(`2026-08-05T12:${String(index).padStart(2, '0')}:01Z`)},
    ${sqlLiteral(`2026-08-05T12:${String(index).padStart(2, '0')}:02Z`)},
    ${sqlLiteral(`2026-08-05T12:${String(index).padStart(2, '0')}:02Z`)},
    ${sqlLiteral(entry.adapterKind)}, ${sqlLiteral(entry.protocol)}
  )`).join(',\n')
  const messageRows = runtimes.map((entry, index) => {
    const body = entry.runLevelOnly
      ? 'Run-level：Runtime 未报告内部工具；Rovai 未生成命令、文件或工具调用卡片。'
      : entry.sourceAuthority === 'core'
        ? 'Core Team Tool：名称必须通过 Rovai Tool Catalog 验证。'
        : '结构化 Runtime Activity：标题来自 Runtime 报告的工具名称。'
    return `(
      ${sqlLiteral(`message-${entry.key}`)}, ${sqlLiteral(campId)}, ${index + 1},
      'agent', ${sqlLiteral(entry.agentId)}, ${sqlLiteral(`run-${entry.key}`)},
      ${sqlLiteral(body)}, 'default', '[]', ${sqlLiteral(`turn-${entry.key}`)},
      ${sqlLiteral(`run-${entry.key}`)}, 1,
      ${sqlLiteral(`2026-08-05T12:${String(index).padStart(2, '0')}:02Z`)},
      ${sqlLiteral(`2026-08-05T12:${String(index).padStart(2, '0')}:02Z`)}
    )`
  }).join(',\n')

  await runSql(databasePath, `
    PRAGMA foreign_keys = ON;
    BEGIN IMMEDIATE;
    INSERT INTO agent_profile(
      uuid, id, slug, display_name, accent, runtime_enabled, visual_state_json,
      created_at, updated_at, default_capabilities_json, profile_status, version,
      handle, member_order, selected_runtime_adapter_kind, team_role,
      professional_responsibilities, personality_traits_json,
      working_principles, growth_topic
    ) VALUES ${profileRows};
    INSERT INTO camp(
      id, title, name_origin, collaboration_mode, project_binding_kind,
      project_path, default_lead_agent_id, status, last_message_sequence,
      version, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(campId)}, ${sqlLiteral(campTitle)}, 'user', 'peer', 'quick_chat',
      '', ${sqlLiteral(runtimes[0].agentId)}, 'active', ${runtimes.length}, 1,
      ${sqlLiteral(now)}, ${sqlLiteral(now)}
    );
    INSERT INTO camp_member(
      camp_id, agent_profile_id, status, capability_overrides_json, version, joined_at
    ) VALUES ${memberRows};
    INSERT INTO conversation(id, camp_id, agent_profile_id, version, created_at, updated_at)
    VALUES ${conversationRows};
    INSERT INTO camp_turn(
      id, camp_id, trigger_type, trigger_id, status,
      execution_budget_schema_version, execution_budget_accepted_at,
      execution_budget_deadline_at, execution_budget_elapsed_seconds,
      execution_budget_max_agent_run_responsibilities,
      execution_budget_max_accepted_a2a,
      execution_budget_root_agent_run_responsibilities,
      version, created_at, updated_at, ended_at
    ) VALUES ${turnRows};
    INSERT INTO agent_run(
      id, camp_turn_id, conversation_id,
      initial_camp_context_through_sequence, initial_conversation_context_through_sequence,
      responsibility_key, start_reason, purpose, expected_output, completion_role,
      effective_config_json, status, idempotency_key, execution_epoch,
      created_at, started_at, ended_at, updated_at,
      runtime_adapter_kind, runtime_protocol_version
    ) VALUES ${runRows};
    INSERT INTO camp_message(
      id, camp_id, sequence, author_type, author_id, source_agent_run_id,
      body, address_mode, addressed_agent_profile_ids_json, camp_turn_id,
      agent_run_id, version, created_at, updated_at
    ) VALUES ${messageRows};
    UPDATE agent_run
    SET final_camp_message_id = 'message-' || substr(id, length('run-') + 1)
    WHERE camp_turn_id LIKE 'turn-%';
    COMMIT;
  `)

  for (const [index, entry] of runtimes.entries()) {
    if (entry.runLevelOnly) continue
    await seedActivity(entry, index)
  }
}

async function seedActivity(entry, index) {
  const runId = `run-${entry.key}`
  const operationId = `operation-${entry.key}`
  const occurredAt = `2026-08-05T12:${String(index).padStart(2, '0')}:01Z`
  const evidence = entry.key === 'codex'
    ? [{
        id: 'evidence-codex-start', sequence: 1, eventType: 'activity.started', kind: 'tool_call', phase: 'started',
        payload: { item: { ...entry.payload.item, status: 'inProgress', output: null } }
      }, {
        id: 'evidence-codex-complete', sequence: 2, eventType: entry.eventType, kind: 'tool_call', phase: 'completed', payload: entry.payload
      }]
    : [{
        id: `evidence-${entry.key}`, sequence: 1, eventType: entry.eventType,
        kind: 'tool_result', phase: 'completed', payload: entry.payload
      }]
  const evidenceRows = evidence.map((item) => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(runId)}, 1, ${item.sequence},
    ${sqlLiteral(item.eventType)}, ${sqlLiteral(item.kind)}, ${sqlLiteral(item.phase)},
    ${sqlLiteral(`${item.eventType}:${operationId}:${item.phase}`)},
    ${sqlLiteral(JSON.stringify(item.payload))}, NULL,
    ${Buffer.byteLength(JSON.stringify(item.payload))}, 0, ${sqlLiteral(occurredAt)}
  )`).join(',\n')
  const evidenceIds = evidence.map((item) => item.id)
  const toolName = entry.payload.toolName
    ?? (entry.key === 'codex' ? 'filesystem/read_file' : null)
    ?? (entry.sourceAuthority === 'core' ? 'team.call_member' : null)
  await runSql(databasePath, `
    PRAGMA foreign_keys = ON;
    BEGIN IMMEDIATE;
    INSERT INTO agent_run_execution_evidence(
      id, agent_run_id, execution_epoch, sequence, event_type, kind, phase,
      source_event_key, payload_preview_json, content_blob_id,
      content_byte_count, is_truncated, occurred_at
    ) VALUES ${evidenceRows};
    INSERT INTO canonical_runtime_activity(
      agent_run_id, execution_epoch, operation_id, classifier_version,
      activity_domain, semantic_kind, tool_name, presentation_hint,
      phase, outcome, credibility, coverage_level, source_authority,
      source_evidence_ids_json, first_evidence_sequence,
      last_evidence_sequence, revision, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(runId)}, 1, ${sqlLiteral(operationId)}, 'activity-v1',
      ${sqlLiteral(entry.domain)}, ${sqlLiteral(entry.semantic)}, ${sqlNullable(toolName)},
      ${sqlLiteral(entry.payload.title ?? toolName ?? 'Runtime 工具调用')},
      'terminal', 'succeeded', ${sqlLiteral(entry.credibility ?? 'runtime_structured')},
      'fine_grained', ${sqlLiteral(entry.sourceAuthority ?? 'runtime')},
      ${sqlLiteral(JSON.stringify(evidenceIds))}, 1, ${evidence.length},
      ${evidence.length}, ${sqlLiteral(occurredAt)}, ${sqlLiteral(occurredAt)}
    );
    COMMIT;
  `)
}

async function collectRuntimeRows(cdp) {
  return evaluate(cdp, `(() => [...document.querySelectorAll(${JSON.stringify(runArticleSelector)})].map((article) => {
    const meta = article.querySelector('.bubble-meta')
    const spans = [...(meta?.querySelectorAll(':scope > span') ?? [])].map((span) => span.textContent?.trim() ?? '')
    return {
      member: meta?.querySelector('strong')?.textContent?.trim() ?? '',
      runtime: spans.find((text) => ${JSON.stringify(runtimes.map((entry) => entry.runtimeName))}.includes(text)) ?? '',
      toolTitles: [...article.querySelectorAll('.tool-call-title')].map((node) => node.textContent?.trim() ?? ''),
      toolSources: [...article.querySelectorAll('.tool-call-source')].map((node) => node.textContent?.trim() ?? ''),
      body: article.querySelector('.message-content')?.textContent?.trim()
        ?? article.querySelector('.safe-markdown')?.textContent?.trim() ?? ''
    }
  }))()`)
}

function assertRuntimeRows(observed) {
  assert(observed.length === runtimes.length,
    `Expected ${runtimes.length} Runtime rows: ${JSON.stringify(observed)}`)
  for (const expected of runtimes) {
    const row = observed.find((candidate) => candidate.runtime === expected.runtimeName)
    assert(row, `Missing ${expected.runtimeName} row: ${JSON.stringify(observed)}`)
    if (expected.expectedToolName === null) {
      assert(row.toolTitles.length === 0,
        `${expected.runtimeName} invented an unreported tool: ${JSON.stringify(row)}`)
      continue
    }
    assert(row.toolTitles.length === 1 && row.toolTitles[0] === expected.expectedToolName,
      `${expected.runtimeName} tool title mismatch: ${JSON.stringify(row)}`)
    assert(row.toolSources[0] === expected.expectedSource,
      `${expected.runtimeName} source label mismatch: ${JSON.stringify(row)}`)
  }
}

async function openCamp(cdp, id) {
  await waitForExpression(cdp, `(() => {
    const target = ${JSON.stringify(`camp:${id}`)}
    return [...document.querySelectorAll('[data-sidebar-menu-target]')]
      .some((element) => element.dataset.sidebarMenuTarget === target)
  })()`, 30_000)
  const opened = await evaluate(cdp, `(() => {
    const target = ${JSON.stringify(`camp:${id}`)}
    const menu = [...document.querySelectorAll('[data-sidebar-menu-target]')]
      .find((element) => element.dataset.sidebarMenuTarget === target)
    const button = menu?.closest('.camp-nav-row')?.querySelector('.camp-nav-open')
    button?.click()
    return Boolean(button)
  })()`)
  assert(opened, `Could not open Camp ${id}`)
  try {
    await waitForExpression(cdp, `Boolean(document.querySelector('.camp-workspace'))`, 30_000)
  } catch (error) {
    const state = await evaluate(cdp, `({
      selectedCamp: document.querySelector('.camp-nav-row.selected .camp-nav-open')?.textContent?.trim() ?? null,
      surface: document.querySelector('main')?.className ?? null,
      text: document.body.innerText.slice(0, 4000)
    })`)
    throw new Error(`Camp ${id} did not open: ${JSON.stringify(state)}`, { cause: error })
  }
}

async function setTheme(cdp, preference) {
  await evaluate(cdp,
    `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  await waitForExpression(cdp, `document.documentElement.dataset.theme === 'day'`)
}

async function launchApp(port, width, height) {
  const executable = join(appPath, 'Contents', 'MacOS', 'Rovai-ai')
  const stderr = []
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`
  ], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ROVAI_ALLOW_ISOLATED_INSTANCE: '1', TMPDIR: runtimeTempDir }
  })
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  let cdp = null
  try {
    const target = await waitForTarget(port, stderr)
    cdp = await connectCdp(target.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Page.bringToFront')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false
    })
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    })
    await waitForExpression(cdp,
      `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
    const health = await evaluate(cdp, `window.rovai.request('health.check', {})`, true)
    assert(await realpath(health.database.path) === await realpath(databasePath),
      `Isolated App opened the wrong database: ${JSON.stringify(health.database.path)}`)
    return { cdp, port, child }
  } catch (error) {
    cdp?.close()
    await terminateChild(child)
    throw error
  }
}

async function closeApp(app) {
  try {
    await Promise.race([app.cdp.send('Browser.close'), wait(1_000)])
  } catch {
    // The isolated App may already have exited.
  }
  app.cdp.close()
  await terminateChild(app.child)
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    wait(3_000)
  ])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

async function capture(cdp, path) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false, fromSurface: true
  })
  await writeFile(path, Buffer.from(result.result.data, 'base64'))
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true
  })
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description
      ?? response.result.exceptionDetails.text
      ?? `Evaluation failed: ${expression}`)
  }
  return response.result?.result?.value
}

async function waitForExpression(cdp, expression, timeoutMs = 10_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression)) return
    await wait(100)
  }
  if (await evaluate(cdp, expression)) return
  throw new Error(`Expression did not become true within ${timeoutMs}ms: ${expression}`)
}

async function waitForTarget(port, stderr) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
      const target = targets.find((candidate) => candidate.type === 'page')
      if (target) return target
    } catch {
      // Electron is still starting.
    }
    await wait(150)
  }
  throw new Error(`Electron DevTools target did not appear. ${stderr.join('')}`)
}

async function connectCdp(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 1
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', rejectOpen, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id) return
    const pendingRequest = pending.get(message.id)
    if (!pendingRequest) return
    pending.delete(message.id)
    if (message.error) pendingRequest.reject(new Error(message.error.message))
    else pendingRequest.resolve(message)
  })
  socket.addEventListener('close', () => {
    for (const pendingRequest of pending.values()) {
      pendingRequest.reject(new Error('CDP connection closed'))
    }
    pending.clear()
  })
  return {
    send(method, params = {}) {
      return new Promise((resolveSend, rejectSend) => {
        const id = nextId++
        pending.set(id, { resolve: resolveSend, reject: rejectSend })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() { socket.close() }
  }
}

function startCore(dataDirectory) {
  const child = spawn(join(root, 'resources', 'bin', 'rovai-core'), ['--data-dir', dataDirectory], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TMPDIR: runtimeTempDir }
  })
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))
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
    }, 30_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
  const stop = async () => {
    if (child.killed || child.exitCode !== null) return
    child.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      wait(3_000)
    ])
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  return { request, stop }
}

function runSql(path, sql) {
  return runProcess('/usr/bin/sqlite3', [path, sql])
}

function runProcess(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code) => {
      if (code === 0) resolveRun(stdout.join(''))
      else rejectRun(new Error(`${command} exited ${code}: ${stderr.join('')}`))
    })
  })
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function sqlNullable(value) {
  return value === null || value === undefined ? 'NULL' : sqlLiteral(value)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
