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
  ?? tmpdir()
const outputDir = process.env.ROVAI_RUNTIME_ACTIVITY_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-runtime-activity-ui-captures-'))
const databasePath = join(dataDir, 'rovai.sqlite')
const debugPort = Number(process.env.ROVAI_RUNTIME_ACTIVITY_ACCEPT_DEBUG_PORT ?? 9581)
const campId = 'camp-runtime-activity-v055'
const campTitle = 'v0.55 Agent 执行过程验收'
const composerLayoutCampId = 'camp-composer-layout-v056'
const composerLayoutCampTitle = 'v0.56 Composer 布局验收'
const runArticleSelector = 'article.timeline-node.conversation-bubble.agent'
const activeAgentId = 'agent_101'
const activeRunId = 'run-codex'
const historicalRunId = 'run-codex-history'

const runtimes = [
  runtime('codex', 'codex-cli', 'Codex CLI', '读取 README.md', 'Runtime 报告', {
    protocol: 'codex-app-server', domain: 'shell', semantic: 'shell.execute',
    evidenceKind: 'command', eventType: 'activity.completed', presentationHint: '读取 README.md', payload: {
      item: {
        id: 'op-codex', type: 'commandExecution', status: 'completed', title: null,
        command: '/bin/zsh -lc "sed -n 1,120p /repo/docs/README.md"',
        commandActions: [{ type: 'read', name: 'sed', path: '/repo/docs/README.md' }],
        output: Array.from({ length: 32 }, (_, index) => `${index + 1}: README.md fixture output`).join('\n')
      }
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
  runtime('antigravity', 'antigravity-app', 'Antigravity', 'camp.message.send', 'Core 已验证', {
    protocol: 'antigravity-log', domain: 'tool', semantic: 'tool.call',
    evidenceKind: 'runtime.action', eventType: 'runtime.action', sourceAuthority: 'core',
    credibility: 'core_verified', payload: {
      toolCallId: 'op-antigravity', status: 'completed', kind: 'mcp_tool_call',
      title: 'Built-in CLI', sourceAuthority: 'core', canonicalTool: 'camp.message.send', output: 'delivered'
    }
  })
]

await mkdir(dataDir, { recursive: true })
await mkdir(outputDir, { recursive: true })
await initializeDatabase()
await seedFixture()

let app = null
try {
  app = await launchApp(debugPort, 1440, 920)
  await setTheme(app.cdp, 'day')
  await activateControlledRun()
  await openCamp(app.cdp, campId)
  await waitForExpression(app.cdp,
    `document.querySelectorAll(${JSON.stringify(runArticleSelector)}).length > 0`, 30_000)
  const renderedMessageCount = await evaluate(app.cdp,
    `document.querySelectorAll(${JSON.stringify(runArticleSelector)}).length`)
  assert(renderedMessageCount === runtimes.length,
    `Expected ${runtimes.length} rendered Agent messages, found ${renderedMessageCount}: ${await evaluate(app.cdp, 'document.body.innerText.slice(0, 5000)')}`)

  const conversationPresentation = await collectConversationPresentation(app.cdp)
  assert(conversationPresentation.articleCount === runtimes.length
    && conversationPresentation.articleBackgrounds.length === 1
    && conversationPresentation.copyBackgrounds.length === 1
    && conversationPresentation.surfaceBackgrounds.length === 1
    && conversationPresentation.articleBackgrounds[0] === 'rgba(0, 0, 0, 0)'
    && conversationPresentation.copyBackgrounds[0] === 'rgba(0, 0, 0, 0)'
    && conversationPresentation.surfaceBackgrounds[0] === 'rgba(0, 0, 0, 0)',
    `Agent messages did not share one conversation surface: ${JSON.stringify(conversationPresentation)}`)
  assert(conversationPresentation.copyButtonPlacements.length === runtimes.length
    && conversationPresentation.copyButtonPlacements.every((placement) =>
      placement.position === 'absolute'
        && placement.top === '-2px'
        && placement.right === '0px'
        && placement.topOffset >= -4.25
        && placement.topOffset <= -1.75
        && Math.abs(placement.rightOffset) <= 0.75),
  `Message copy buttons did not share one top-right action anchor: ${JSON.stringify(conversationPresentation.copyButtonPlacements)}`)
  assert(conversationPresentation.dayLabels.length > 0
    && conversationPresentation.dayLabels.every((label) => /^\d{1,2}月\d{1,2}日 周[一二三四五六日] · DAY \d+$/.test(label))
    && conversationPresentation.dayLabels.every((label) => !label.includes('今天') && !label.includes('发布准备')),
    `Timeline did not use durable message dates: ${JSON.stringify(conversationPresentation)}`)

  await evaluate(app.cdp, `(() => {
    const copyButton = document.querySelector('.message-surface.has-delivery .message-copy-button')
    copyButton?.focus({ preventScroll: true })
    return document.activeElement === copyButton
  })()`)
  await wait(250)
  const handoffFooter = await collectHandoffFooter(app.cdp)
  assert(handoffFooter.count === 1,
    `Expected one recipient-only message footer: ${JSON.stringify(handoffFooter)}`)
  assert(handoffFooter.text.includes('发送给@Codex CLI 验收、@OpenCode 验收')
    && !handoffFooter.text.includes('发送给：'),
    `Recipient-only footer content mismatch: ${JSON.stringify(handoffFooter)}`)
  assert(handoffFooter.recipientMentions.length === 2
    && handoffFooter.recipientMentions.every((mention) => mention.text.startsWith('@'))
    && handoffFooter.recipientMentions.every((mention) => mention.role === 'button' && mention.tabIndex === 0)
    && handoffFooter.recipientMentions.every((mention) => mention.cursor === 'pointer')
    && handoffFooter.recipientMentions.every((mention) => mention.color === 'rgb(47, 97, 200)'),
    `A2A recipients were not blue interactive mentions: ${JSON.stringify(handoffFooter)}`)
  assert(!['已送达', '投递失败', '等待审批', '已取消'].some((label) => handoffFooter.text.includes(label))
    && handoffFooter.stateLabelCount === 0,
    `Message footer exposed Delivery state: ${JSON.stringify(handoffFooter)}`)
  assert(handoffFooter.legacyOriginCount === 0 && handoffFooter.compactDeliveryCount === 0,
    `Legacy message Delivery chrome returned: ${JSON.stringify(handoffFooter)}`)
  assert(handoffFooter.background === 'rgba(0, 0, 0, 0)'
    && handoffFooter.borderRadius === '0px'
    && handoffFooter.railBorderLeftWidth === '1px'
    && handoffFooter.railBorderBottomWidth === '1px',
    `Recipient-only footer geometry mismatch: ${JSON.stringify(handoffFooter)}`)
  assert(handoffFooter.contentGap >= 0 && handoffFooter.contentGap <= 4,
    `Recipient-only footer must stay visually attached to the message: ${JSON.stringify(handoffFooter)}`)
  assert(handoffFooter.surfaceReserve >= 0 && handoffFooter.surfaceReserve <= 0.5
    && handoffFooter.copyButtonPosition === 'absolute',
    `Hidden copy affordance must not reserve a blank line: ${JSON.stringify(handoffFooter)}`)
  assert(handoffFooter.copyButtonFocused && handoffFooter.copyButtonOpacity === '1'
    && handoffFooter.messageBodyFocusWithin
    && Math.abs(handoffFooter.copyButtonTopOffset + 2) <= 0.75
    && Math.abs(handoffFooter.copyButtonRightOffset) <= 0.75
    && handoffFooter.copyButtonHorizontalGap >= 0,
    `Focused copy affordance must stay visible without covering recipients: ${JSON.stringify(handoffFooter)}`)
  await evaluate(app.cdp, `document.activeElement?.blur()`)

  const activatedMention = await evaluate(app.cdp, `(() => {
    const mention = document.querySelector('.message-delivery-recipient-name.message-mention-token.is-interactive')
    mention?.click()
    return mention?.textContent?.trim() ?? null
  })()`)
  assert(activatedMention === '@Codex CLI 验收',
    `Could not activate the first A2A mention: ${JSON.stringify(activatedMention)}`)
  await waitForExpression(app.cdp,
    `Boolean(document.querySelector('.mention-profile-popover[role="dialog"][aria-label="Codex CLI 验收的基础信息"]'))`)
  await app.cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 53
  })
  await app.cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 53
  })
  await waitForExpression(app.cdp, `!document.querySelector('.mention-profile-popover')`)

  const agentDock = await collectAgentDock(app.cdp)
  assert(agentDock.chipCount === runtimes.length
    && agentDock.uniqueAgentIds.length === runtimes.length
    && agentDock.agentIds.filter((agentId) => agentId === activeAgentId).length === 1,
    `Agent dock did not aggregate one entry per Agent: ${JSON.stringify(agentDock)}`)
  assert(agentDock.followsTimeline && agentDock.dockTop >= agentDock.timelineBottom - 1,
    `Agent dock is not attached below the conversation timeline: ${JSON.stringify(agentDock)}`)
  assert(agentDock.topRunBadgeCount === 0
    && agentDock.auditTabCount === 0
    && JSON.stringify(agentDock.inspectorTabLabels) === JSON.stringify(['任务', '队员']),
  `Removed top Run/Audit entries or legacy Inspector tabs returned: ${JSON.stringify(agentDock)}`)

  const observed = await collectRuntimeRows(app.cdp)
  assertRuntimeRows(observed)
  const totalToolRows = observed.reduce((total, row) => total + row.toolTitles.length, 0)
  assert(totalToolRows === 8,
    `Expected exactly eight observed tool rows and one honest run-level row: ${JSON.stringify(observed)}`)

  await evaluate(app.cdp, `(() => {
    const activeChip = [...document.querySelectorAll('.run-pulse-chip[data-agent-id]')]
      .find((chip) => chip.dataset.agentId === ${JSON.stringify(activeAgentId)})
    activeChip?.focus()
    activeChip?.click()
    return Boolean(activeChip)
  })()`)
  await waitForExpression(app.cdp, `(() => {
    const focused = document.querySelector('.execution-process-stage.is-focused')
    return focused?.dataset.agentRunId === ${JSON.stringify(activeRunId)}
      && Boolean(focused.querySelector('.execution-disclosure.run-live.is-running'))
  })()`)
  const executionDrawerResize = await verifyExecutionDrawerResizeControl(app.cdp)
  const executionAutoFollow = await verifyExecutionAutoFollowControl(app.cdp)

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

  await app.cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 53
  })
  await app.cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 53
  })
  await waitForExpression(app.cdp, `!document.querySelector('.execution-drawer')`)
  await waitForExpression(app.cdp,
    `document.activeElement?.dataset.agentId === ${JSON.stringify(activeAgentId)}`)
  await app.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false
  })
  await openCamp(app.cdp, composerLayoutCampId)
  await waitForExpression(app.cdp,
    `document.querySelector('.camp-workspace')?.getAttribute('aria-label') === ${JSON.stringify(`Camp：${composerLayoutCampTitle}`)}`)
  await wait(200)
  const wideComposerLayout = await collectWideComposerLayout(app.cdp)
  assert(wideComposerLayout.viewportWidth === 2560 && wideComposerLayout.viewportHeight === 1440,
    `2K viewport did not apply: ${JSON.stringify(wideComposerLayout)}`)
  assert(wideComposerLayout.documentScrollWidth <= wideComposerLayout.viewportWidth + 1
    && wideComposerLayout.composerBoxWidth >= 1038
    && wideComposerLayout.composerBoxWidth <= 1042,
    `2K composer did not expand to about 1040px: ${JSON.stringify(wideComposerLayout)}`)
  assert(Math.abs(wideComposerLayout.leftInset - wideComposerLayout.rightInset) <= 12
    && wideComposerLayout.actionGap === 5
    && wideComposerLayout.enterHint === 'Enter'
    && wideComposerLayout.sendLabel === '发送'
    && wideComposerLayout.hintImmediatelyPrecedesSend
    && wideComposerLayout.hintToSendGap >= 4
    && wideComposerLayout.hintToSendGap <= 6,
    `2K composer alignment or Enter/Send adjacency regressed: ${JSON.stringify(wideComposerLayout)}`)
  const wideCapture = join(outputDir, 'runtime-activity-wide.png')
  await capture(app.cdp, wideCapture)

  await openCamp(app.cdp, campId)
  await waitForExpression(app.cdp,
    `document.querySelector('.camp-workspace')?.getAttribute('aria-label') === ${JSON.stringify(`Camp：${campTitle}`)}`)
  await wait(200)
  const wideConversationLayout = await collectWideConversationLayout(app.cdp)
  assert(wideConversationLayout.viewportWidth === 2560
    && wideConversationLayout.viewportHeight === 1440
    && wideConversationLayout.documentScrollWidth <= wideConversationLayout.viewportWidth + 1,
  `2K conversation viewport overflowed: ${JSON.stringify(wideConversationLayout)}`)
  assert(wideConversationLayout.timelineTrackWidth >= 1038
    && wideConversationLayout.timelineTrackWidth <= 1042
    && wideConversationLayout.messageBodyWidth > wideConversationLayout.narrativeWidth + 160
    && wideConversationLayout.narrativeWidth <= 720,
  `2K conversation did not preserve a narrow narrative lane inside the wide work lane: ${JSON.stringify(wideConversationLayout)}`)
  assert(wideConversationLayout.articleBackground === 'rgba(0, 0, 0, 0)'
    && wideConversationLayout.surfaceBackground === 'rgba(0, 0, 0, 0)'
    && wideConversationLayout.copyBackground === 'rgba(0, 0, 0, 0)',
  `2K conversation added an actor-owned message surface: ${JSON.stringify(wideConversationLayout)}`)
  const wideConversationCapture = join(outputDir, 'runtime-activity-wide-conversation.png')
  await capture(app.cdp, wideConversationCapture)
  await app.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1040, height: 700, deviceScaleFactor: 1, mobile: false
  })
  await evaluate(app.cdp, `(() => {
    const timeline = document.querySelector('.camp-timeline')
    if (timeline) timeline.scrollTop = timeline.scrollHeight
    return timeline?.scrollTop ?? 0
  })()`)
  await evaluate(app.cdp, `(() => {
    const activeChip = [...document.querySelectorAll('.run-pulse-chip[data-agent-id]')]
      .find((chip) => chip.dataset.agentId === ${JSON.stringify(activeAgentId)})
    activeChip?.click()
    const handle = document.querySelector('.execution-drawer-resize-handle')
    handle?.focus({ preventScroll: true })
    return Boolean(activeChip && handle)
  })()`)
  await waitForExpression(app.cdp, `Boolean(document.querySelector('.execution-drawer-resize-handle'))`)
  await focusExecutionDrawerResizeHandle(app.cdp)
  await pressKey(app.cdp, 'End', 'End', 35)
  await waitForExpression(app.cdp, `(() => {
    const handle = document.querySelector('.execution-drawer-resize-handle')
    const drawer = document.querySelector('.execution-drawer')
    const now = Number(handle?.getAttribute('aria-valuenow') ?? 0)
    return now === Number(handle?.getAttribute('aria-valuemax') ?? -1)
      && Math.abs((drawer?.getBoundingClientRect().height ?? 0) - now) <= 1
  })()`)
  await evaluate(app.cdp, `(() => {
    const timeline = document.querySelector('.camp-timeline')
    if (timeline) timeline.scrollTop = timeline.scrollHeight
    return timeline?.scrollTop ?? 0
  })()`)
  await wait(200)
  const compactLayout = await collectCompactHandoffLayout(app.cdp)
  assert(compactLayout.viewportWidth === 1040 && compactLayout.viewportHeight === 700,
    `Compact viewport did not apply: ${JSON.stringify(compactLayout)}`)
  assert(compactLayout.documentScrollWidth <= compactLayout.viewportWidth + 1
    && compactLayout.timelineScrollWidth <= compactLayout.timelineClientWidth + 1
    && compactLayout.footerScrollWidth <= compactLayout.footerClientWidth + 1,
    `Recipient-only footer overflowed at 1040x700: ${JSON.stringify(compactLayout)}`)
  assert(compactLayout.footerLeft >= compactLayout.timelineLeft - 1
    && compactLayout.footerRight <= compactLayout.timelineRight + 1
    && compactLayout.footerTop >= compactLayout.timelineTop - 1
    && compactLayout.footerBottom <= compactLayout.timelineBottom + 1,
    `Recipient-only footer escaped the compact timeline viewport: ${JSON.stringify(compactLayout)}`)
  assert(compactLayout.dockLeft >= compactLayout.timelineLeft - 1
    && compactLayout.dockRight <= compactLayout.timelineRight + 1
    && compactLayout.dockTop >= compactLayout.timelineBottom - 1,
    `Agent dock escaped the compact conversation column: ${JSON.stringify(compactLayout)}`)
  assert(compactLayout.drawerLeft >= compactLayout.timelineLeft - 1
    && compactLayout.drawerRight <= compactLayout.timelineRight + 1
    && compactLayout.drawerBottom <= compactLayout.controlsTop + 1
    && compactLayout.drawerAriaNow === compactLayout.drawerAriaMax
    && compactLayout.drawerUserSized
    && compactLayout.resizeHandleTop >= 0
    && compactLayout.resizeHandleBottom <= compactLayout.viewportHeight,
    `Resizable execution Drawer overlapped controls or escaped at 1040x700: ${JSON.stringify(compactLayout)}`)
  assert(compactLayout.timelineHeight >= 96,
    `Resizable execution Drawer left too little compact conversation history: ${JSON.stringify(compactLayout)}`)
  const compactCapture = join(outputDir, 'runtime-activity-compact.png')
  await capture(app.cdp, compactCapture)

  await evaluate(app.cdp, `(() => {
    const toggle = document.querySelector('.topbar-inspector-toggle[aria-pressed="true"]')
    toggle?.click()
    return !toggle || true
  })()`)
  await app.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 520, height: 350, deviceScaleFactor: 2, mobile: false,
    screenWidth: 1040, screenHeight: 700
  })
  await waitForExpression(app.cdp, `innerWidth === 520 && innerHeight === 350 && Math.abs(devicePixelRatio - 2) < 0.01`)
  await waitForExpression(app.cdp, `document.querySelector('.workspace-grid')?.classList.contains('inspector-collapsed')`)
  await focusExecutionDrawerResizeHandle(app.cdp)
  await pressKey(app.cdp, 'End', 'End', 35)
  await waitForExpression(app.cdp, `(() => {
    const handle = document.querySelector('.execution-drawer-resize-handle')
    const drawer = document.querySelector('.execution-drawer')
    const now = Number(handle?.getAttribute('aria-valuenow') ?? 0)
    return now === Number(handle?.getAttribute('aria-valuemax') ?? -1)
      && Math.abs((drawer?.getBoundingClientRect().height ?? 0) - now) <= 1
  })()`)
  await wait(150)
  const zoomedDrawerLayout = await collectZoomedDrawerLayout(app.cdp)
  assert(zoomedDrawerLayout.cssViewportWidth === 520
    && zoomedDrawerLayout.cssViewportHeight === 350
    && zoomedDrawerLayout.physicalViewportWidth === 1040
    && zoomedDrawerLayout.physicalViewportHeight === 700
    && zoomedDrawerLayout.drawerVisible
    && zoomedDrawerLayout.resizeHandleVisible
    && zoomedDrawerLayout.drawerAriaNow === zoomedDrawerLayout.drawerAriaMax
    && Math.min(zoomedDrawerLayout.drawerBottom, zoomedDrawerLayout.timelinePaneBottom)
      <= zoomedDrawerLayout.controlsTop + 1
    && zoomedDrawerLayout.composerTop >= zoomedDrawerLayout.controlsTop - 1
    && zoomedDrawerLayout.composerBottom <= zoomedDrawerLayout.cssViewportHeight + 1
    && zoomedDrawerLayout.timelineHeight >= 48
    && zoomedDrawerLayout.drawerBodyScrollable,
    `200% zoom hid or overlapped the resizable execution Drawer: ${JSON.stringify(zoomedDrawerLayout)}`)
  const zoomedDrawerCapture = join(outputDir, 'runtime-activity-zoom-200.png')
  await capture(app.cdp, zoomedDrawerCapture)

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
      sameAgentRunsShareOneProcess: observed.find((row) => row.agentId === activeAgentId)?.runCount === 2,
      runningRunFocusedWithEvidence: observed.find((row) => row.agentId === activeAgentId)?.focusedEvidenceOpen === true,
      executionDrawerResize,
      executionAutoFollow,
      claudeRunLevelDoesNotInventTools: observed.find((row) => row.runtime === 'Claude Code')?.toolTitles.length === 0,
      antigravityCoreToolCatalogName: observed.find((row) => row.runtime === 'Antigravity')?.toolTitles[0] === 'camp.message.send',
      conversationPresentation,
      agentLevelProcessDock: agentDock,
      recipientOnlyHandoffFooter: handoffFooter,
      wideComposerLayout,
      wideConversationLayout,
      recipientOnlyCompactLayout: compactLayout,
      zoomedDrawerLayout
    },
    runtimes: observed,
    captures: {
      top: topCapture,
      bottom: bottomCapture,
      wide: wideCapture,
      wideConversation: wideConversationCapture,
      compact: compactCapture,
      zoom200: zoomedDrawerCapture
    }
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

async function activateControlledRun() {
  const status = await runSql(databasePath, `
    PRAGMA busy_timeout = 5000;
    UPDATE agent_run
    SET status = 'running',
        started_at = '2026-08-05T12:00:01Z',
        ended_at = NULL,
        updated_at = '2026-08-05T12:00:01Z',
        version = version + 1
    WHERE id = ${sqlLiteral(activeRunId)} AND status = 'queued';
    SELECT status FROM agent_run WHERE id = ${sqlLiteral(activeRunId)};
  `)
  assert(status.trim().split(/\s+/).at(-1) === 'running',
    `Controlled AgentRun did not enter running state: ${status}`)
}

async function seedFixture() {
  const now = '2026-08-05T12:00:00Z'
  const installationRows = runtimes.map((entry) => `(
    ${sqlLiteral(`installation-runtime-${entry.key}`)}, ${sqlLiteral(entry.adapterKind)},
    ${sqlLiteral(`/fixture/${entry.key}`)}, ${sqlLiteral(entry.key)}, 'custom', 'custom',
    'fixture', 1, 1, 'valid', 1, ${sqlLiteral(now)}, ${sqlLiteral(now)}
  )`).join(',\n')
  const profileRows = runtimes.map((entry, index) => `(
    ${sqlLiteral(`uuid-runtime-${entry.key}`)}, ${sqlLiteral(entry.agentId)},
    ${sqlLiteral(`runtime-${entry.key}`)}, ${sqlLiteral(`${entry.runtimeName} 验收`)},
    ${sqlLiteral(['#5B6C8F', '#4C7A78', '#6B668E', '#7A6756', '#5E7485', '#76627A', '#5C7960', '#786C59', '#596D7B'][index])},
    1, '{}', ${sqlLiteral(now)}, ${sqlLiteral(now)}, '[]', 'present', 1,
    ${sqlLiteral(`runtime_${entry.key}`)}, ${100 + index},
    ${sqlLiteral(entry.adapterKind)}, ${sqlLiteral(`installation-runtime-${entry.key}`)},
    '{"mode":"runtime_default"}',
    ${sqlLiteral(JSON.stringify({ adapterKind: entry.adapterKind, schemaVersion: 1, values: {} }))},
    'Runtime Activity 验收', '', '[]', '', ''
  )`).join(',\n')
  const memberRows = runtimes.map((entry) => `(
    ${sqlLiteral(campId)}, ${sqlLiteral(entry.agentId)}, 'active', '{}', 1, ${sqlLiteral(now)}
  )`).join(',\n')
  const conversationRows = runtimes.map((entry) => `(
    ${sqlLiteral(`conversation-${entry.key}`)}, ${sqlLiteral(campId)}, ${sqlLiteral(entry.agentId)},
    1, ${sqlLiteral(now)}, ${sqlLiteral(now)}
  )`).join(',\n')
  const turnRows = [
    ...runtimes.map((entry, index) => {
      const active = entry.key === 'codex'
      const updatedAt = `2026-08-05T12:${String(index).padStart(2, '0')}:${active ? '01' : '02'}Z`
      return `(
        ${sqlLiteral(`turn-${entry.key}`)}, ${sqlLiteral(campId)}, 'system_event',
        ${sqlLiteral(`runtime-activity-${entry.key}`)}, ${sqlLiteral(active ? 'running' : 'completed')},
        1, ${sqlLiteral(now)}, ${sqlLiteral(active ? '2036-08-06T12:00:00Z' : '2026-08-06T12:00:00Z')}, ${active ? 0 : 86400}, 32, 16, 1,
        1,
        ${sqlLiteral(`2026-08-05T12:${String(index).padStart(2, '0')}:00Z`)},
        ${sqlLiteral(updatedAt)},
        ${sqlNullable(active ? null : updatedAt)}
      )`
    }),
    `(
      'turn-codex-history', ${sqlLiteral(campId)}, 'system_event',
      'runtime-activity-codex-history', 'completed',
      1, ${sqlLiteral(now)}, '2026-08-06T12:00:00Z', 86400, 32, 16, 1,
      1, '2026-08-05T11:58:00Z', '2026-08-05T11:58:02Z', '2026-08-05T11:58:02Z'
    )`
  ].join(',\n')
  const runRows = [
    ...runtimes.map((entry, index) => {
      const active = entry.key === 'codex'
      const updatedAt = `2026-08-05T12:${String(index).padStart(2, '0')}:${active ? '01' : '02'}Z`
      return `(
        ${sqlLiteral(`run-${entry.key}`)}, ${sqlLiteral(`turn-${entry.key}`)},
        ${sqlLiteral(`conversation-${entry.key}`)}, 0, 0,
        ${sqlLiteral(`direct:${entry.agentId}`)}, 'initial',
        ${sqlLiteral(`验证 ${entry.runtimeName} Runtime Activity`)},
        'required', '{}', ${sqlLiteral(active ? 'queued' : 'succeeded')}, ${sqlLiteral(`runtime-activity-${entry.key}`)},
        1, ${sqlLiteral(`2026-08-05T12:${String(index).padStart(2, '0')}:00Z`)},
        ${sqlNullable(active ? null : `2026-08-05T12:${String(index).padStart(2, '0')}:01Z`)},
        ${sqlNullable(active ? null : updatedAt)},
        ${sqlLiteral(updatedAt)},
        ${sqlLiteral(entry.adapterKind)}, ${sqlLiteral(entry.protocol)}
      )`
    }),
    `(
      ${sqlLiteral(historicalRunId)}, 'turn-codex-history', 'conversation-codex', 0, 0,
      ${sqlLiteral(`direct:${activeAgentId}:history`)}, 'initial',
      'Codex 历史 Runtime Activity',
      'required', '{}', 'succeeded', 'runtime-activity-codex-history',
      1, '2026-08-05T11:58:00Z', '2026-08-05T11:58:01Z',
      '2026-08-05T11:58:02Z', '2026-08-05T11:58:02Z',
      'codex-cli', 'codex-app-server'
    )`
  ].join(',\n')
  const messageRows = runtimes.map((entry, index) => {
    const body = entry.runLevelOnly
      ? 'Run-level：Runtime 未报告内部工具；Rovai 未生成命令、文件或工具调用卡片。'
      : entry.sourceAuthority === 'core'
        ? 'Core Built-in CLI：名称必须通过 Rovai Tool Catalog 验证。'
        : '结构化 Runtime Activity：标题来自 Runtime 报告的工具名称。'
    const addressedAgentIds = entry.key === 'antigravity'
      ? [runtimes[0].agentId, runtimes[1].agentId]
      : []
    return `(
      ${sqlLiteral(`message-${entry.key}`)}, ${sqlLiteral(campId)}, ${index + 1},
      'agent', ${sqlLiteral(entry.agentId)}, ${sqlLiteral(`run-${entry.key}`)},
      ${sqlLiteral(body)}, ${sqlLiteral(JSON.stringify([{ kind: 'text', text: body }]))},
      ${sqlLiteral(addressedAgentIds.length > 0 ? 'explicit' : 'default')},
      ${sqlLiteral(JSON.stringify(addressedAgentIds))}, ${sqlLiteral(`turn-${entry.key}`)},
      ${sqlLiteral(`run-${entry.key}`)}, 1,
      ${sqlLiteral(`2026-08-05T12:${String(index).padStart(2, '0')}:02Z`)},
      ${sqlLiteral(`2026-08-05T12:${String(index).padStart(2, '0')}:02Z`)}
    )`
  }).join(',\n')
  const deliveryRows = [{
    id: 'delivery-antigravity-codex', recipientAgentId: runtimes[0].agentId,
    recipientCanonicalPosition: 0, status: 'settled', failureCode: null
  }, {
    id: 'delivery-antigravity-opencode', recipientAgentId: runtimes[1].agentId,
    recipientCanonicalPosition: 1, status: 'failed', failureCode: 'runtime_unavailable'
  }].map((delivery) => `(
    ${sqlLiteral(delivery.id)}, ${sqlLiteral(campId)}, 'turn-antigravity',
    'message-antigravity', ${sqlLiteral(delivery.recipientAgentId)},
    ${delivery.recipientCanonicalPosition}, ${sqlLiteral(`digest-${delivery.id}`)},
    ${sqlLiteral('digest-message-antigravity')}, 'run-antigravity', 'run-antigravity', 1,
    '[]', '{}', '{}', 1, ${sqlLiteral(delivery.status)}, 'terminal', 1, 0, 0,
    ${sqlNullable(delivery.failureCode)}, 1, ${sqlLiteral(now)}, ${sqlLiteral(now)}, ${sqlLiteral(now)}
  )`).join(',\n')

  await runSql(databasePath, `
    PRAGMA foreign_keys = ON;
    BEGIN IMMEDIATE;
    INSERT INTO adapter_installation(
      id, adapter_kind, executable_path, command_name, installation_class,
      source, auth_scope, enabled, generation, path_state, version,
      created_at, updated_at
    ) VALUES ${installationRows};
    INSERT INTO agent_profile(
      uuid, id, slug, display_name, accent, runtime_enabled, visual_state_json,
      created_at, updated_at, default_capabilities_json, profile_status, version,
      handle, member_order, selected_runtime_adapter_kind,
      default_runtime_installation_id, default_model_selection_json,
      default_permission_config_json, team_role,
      professional_responsibilities, personality_traits_json,
      working_principles, growth_topic
    ) VALUES ${profileRows};
    INSERT INTO camp(
      id, title, name_origin, collaboration_mode, project_binding_kind,
      project_path, default_lead_agent_id, last_message_sequence,
      version, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(campId)}, ${sqlLiteral(campTitle)}, 'user', 'peer', 'quick_chat',
      '', ${sqlLiteral(runtimes[0].agentId)}, ${runtimes.length}, 1,
      ${sqlLiteral(now)}, ${sqlLiteral(now)}
    ), (
      ${sqlLiteral(composerLayoutCampId)}, ${sqlLiteral(composerLayoutCampTitle)}, 'user', 'peer', 'quick_chat',
      '', ${sqlLiteral(runtimes[0].agentId)}, 0, 1,
      ${sqlLiteral(now)}, ${sqlLiteral(now)}
    );
    INSERT INTO camp_member(
      camp_id, agent_id, status, capability_overrides_json, version, joined_at
    ) VALUES ${memberRows}, (
      ${sqlLiteral(composerLayoutCampId)}, ${sqlLiteral(runtimes[0].agentId)}, 'active', '{}', 1, ${sqlLiteral(now)}
    );
    INSERT INTO conversation(id, camp_id, agent_id, version, created_at, updated_at)
    VALUES ${conversationRows}, (
      'conversation-composer-layout', ${sqlLiteral(composerLayoutCampId)}, ${sqlLiteral(runtimes[0].agentId)},
      1, ${sqlLiteral(now)}, ${sqlLiteral(now)}
    );
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
      responsibility_key, start_reason, purpose, completion_role,
      effective_config_json, status, idempotency_key, execution_epoch,
      created_at, started_at, ended_at, updated_at,
      runtime_adapter_kind, runtime_protocol_version
    ) VALUES ${runRows};
    INSERT INTO camp_message(
      id, camp_id, sequence, author_type, author_id, source_agent_run_id,
      body, structured_content_json, address_mode, addressed_agent_ids_json, camp_turn_id,
      agent_run_id, version, created_at, updated_at
    ) VALUES ${messageRows};
    INSERT INTO message_delivery(
      id, camp_id, camp_turn_id, message_id,
      recipient_agent_id, recipient_canonical_position,
      recipient_digest, message_body_digest,
      source_agent_run_id, a2a_root_agent_run_id, a2a_depth,
      ancestor_agent_ids_json, recipient_presentation_snapshot_json,
      frozen_snapshot_json, queue_sequence, status, dispatch_phase,
      dispatch_attempt_count, retry_generation, manual_intervention_required,
      failure_code, version, created_at, updated_at, ended_at
    ) VALUES ${deliveryRows};
    UPDATE agent_run
    SET final_camp_message_id = 'message-' || substr(id, length('run-') + 1)
    WHERE status IN ('succeeded', 'failed', 'cancelled')
      AND id <> ${sqlLiteral(historicalRunId)};
    COMMIT;
  `)

  for (const [index, entry] of runtimes.entries()) {
    if (entry.runLevelOnly) continue
    await seedActivity(entry, index)
  }
}

async function collectHandoffFooter(cdp) {
  return evaluate(cdp, `(() => {
    const footer = document.querySelector('.message-delivery-footer')
    const rail = footer?.querySelector('.message-delivery-handoff-rail')
    const messageSurface = footer?.previousElementSibling
    const messageBody = footer?.closest('.message-body')
    const messageContent = messageSurface?.querySelector(':scope > .final-copy, :scope > .message-bubble')
    const copyButton = messageSurface?.querySelector('.message-copy-button')
    const recipients = footer?.querySelector('.message-delivery-recipients')
    const footerStyle = footer ? getComputedStyle(footer) : null
    const railStyle = rail ? getComputedStyle(rail) : null
    const copyButtonStyle = copyButton ? getComputedStyle(copyButton) : null
    const footerRect = footer?.getBoundingClientRect()
    const surfaceRect = messageSurface?.getBoundingClientRect()
    const bodyRect = messageBody?.getBoundingClientRect()
    const contentRect = messageContent?.getBoundingClientRect()
    const copyButtonRect = copyButton?.getBoundingClientRect()
    const recipientsRect = recipients?.getBoundingClientRect()
    const recipientMentions = [...(footer?.querySelectorAll('.message-delivery-recipient-name') ?? [])]
      .map((mention) => ({
        text: mention.textContent?.trim() ?? '',
        role: mention.getAttribute('role'),
        tabIndex: mention.tabIndex,
        color: getComputedStyle(mention).color,
        cursor: getComputedStyle(mention).cursor
      }))
    return {
      count: document.querySelectorAll('.message-delivery-footer').length,
      text: footer?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      background: footerStyle?.backgroundColor ?? null,
      borderRadius: footerStyle?.borderRadius ?? null,
      railBorderLeftWidth: railStyle?.borderLeftWidth ?? null,
      railBorderBottomWidth: railStyle?.borderBottomWidth ?? null,
      contentGap: footerRect && contentRect ? footerRect.top - contentRect.bottom : null,
      surfaceReserve: surfaceRect && contentRect ? surfaceRect.bottom - contentRect.bottom : null,
      copyButtonPosition: copyButtonStyle?.position ?? null,
      copyButtonOpacity: copyButtonStyle?.opacity ?? null,
      copyButtonFocused: document.activeElement === copyButton,
      surfaceFocusWithin: messageSurface?.matches(':focus-within') ?? false,
      messageBodyFocusWithin: messageBody?.matches(':focus-within') ?? false,
      documentHasFocus: document.hasFocus(),
      copyButtonTopOffset: copyButtonRect && bodyRect ? copyButtonRect.top - bodyRect.top : null,
      copyButtonRightOffset: copyButtonRect && bodyRect ? bodyRect.right - copyButtonRect.right : null,
      copyButtonHorizontalGap: copyButtonRect && recipientsRect ? copyButtonRect.left - recipientsRect.right : null,
      recipientMentions,
      stateLabelCount: footer?.querySelectorAll('.message-delivery-state').length ?? 0,
      legacyOriginCount: document.querySelectorAll('.message-run-origin').length,
      compactDeliveryCount: document.querySelectorAll('.delivery-status-list.is-compact').length
    }
  })()`)
}

async function collectConversationPresentation(cdp) {
  return evaluate(cdp, `(() => {
    const articles = [...document.querySelectorAll(${JSON.stringify(runArticleSelector)})]
    const unique = (values) => [...new Set(values)]
    return {
      articleCount: articles.length,
      articleBackgrounds: unique(articles.map((article) => getComputedStyle(article).backgroundColor)),
      surfaceBackgrounds: unique(articles.map((article) => {
        const surface = article.querySelector('.message-surface')
        return surface ? getComputedStyle(surface).backgroundColor : null
      })),
      copyBackgrounds: unique(articles.map((article) => {
        const copy = article.querySelector('.final-copy')
        return copy ? getComputedStyle(copy).backgroundColor : null
      })),
      copyButtonPlacements: articles.map((article) => {
        const body = article.querySelector('.message-body')
        const button = article.querySelector('.message-copy-button')
        const bodyRect = body?.getBoundingClientRect()
        const buttonRect = button?.getBoundingClientRect()
        return {
          position: button ? getComputedStyle(button).position : null,
          top: button ? getComputedStyle(button).top : null,
          right: button ? getComputedStyle(button).right : null,
          topOffset: bodyRect && buttonRect ? buttonRect.top - bodyRect.top : null,
          rightOffset: bodyRect && buttonRect ? bodyRect.right - buttonRect.right : null
        }
      }),
      dayLabels: [...document.querySelectorAll('.timeline-day')]
        .map((node) => node.textContent?.replace(/\\s+/g, ' ').trim() ?? '')
        .filter(Boolean)
    }
  })()`)
}

async function collectAgentDock(cdp) {
  return evaluate(cdp, `(() => {
    const timeline = document.querySelector('.camp-timeline')
    const dock = document.querySelector('.run-pulse[aria-label="Agent 执行台"]')
    const timelineRect = timeline?.getBoundingClientRect()
    const dockRect = dock?.getBoundingClientRect()
    const agentIds = [...document.querySelectorAll('.run-pulse-chip[data-agent-id]')]
      .map((chip) => chip.dataset.agentId ?? '')
      .filter(Boolean)
    const auditTabCount = [...document.querySelectorAll('.activity-tabs > .tabs-list [role="tab"]')]
      .filter((tab) => tab.textContent?.includes('审计')).length
    const inspectorTabLabels = [...document.querySelectorAll('.activity-tabs > .tabs-list [role="tab"]')]
      .map((tab) => tab.textContent?.replace(/\\d+/g, '').replace(/\\s+/g, ' ').trim() ?? '')
    return {
      chipCount: agentIds.length,
      agentIds,
      uniqueAgentIds: [...new Set(agentIds)],
      followsTimeline: timeline?.nextElementSibling === dock,
      timelineBottom: timelineRect?.bottom ?? 0,
      dockTop: dockRect?.top ?? 0,
      topRunBadgeCount: document.querySelectorAll('.topbar .run-badge').length,
      auditTabCount,
      inspectorTabLabels
    }
  })()`)
}

async function collectCompactHandoffLayout(cdp) {
  return evaluate(cdp, `(() => {
    const footer = document.querySelector('.message-delivery-footer')
    const timeline = document.querySelector('.camp-timeline')
    const dock = document.querySelector('.run-pulse[aria-label="Agent 执行台"]')
    const drawer = document.querySelector('.execution-drawer')
    const resizeHandle = drawer?.querySelector('.execution-drawer-resize-handle')
    const controls = document.querySelector('.conversation-controls')
    const footerRect = footer?.getBoundingClientRect()
    const timelineRect = timeline?.getBoundingClientRect()
    const dockRect = dock?.getBoundingClientRect()
    const drawerRect = drawer?.getBoundingClientRect()
    const resizeHandleRect = resizeHandle?.getBoundingClientRect()
    const controlsRect = controls?.getBoundingClientRect()
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      timelineClientWidth: timeline?.clientWidth ?? 0,
      timelineScrollWidth: timeline?.scrollWidth ?? 0,
      timelineLeft: timelineRect?.left ?? 0,
      timelineRight: timelineRect?.right ?? 0,
      timelineTop: timelineRect?.top ?? 0,
      timelineBottom: timelineRect?.bottom ?? 0,
      footerClientWidth: footer?.clientWidth ?? 0,
      footerScrollWidth: footer?.scrollWidth ?? 0,
      footerLeft: footerRect?.left ?? 0,
      footerRight: footerRect?.right ?? 0,
      footerTop: footerRect?.top ?? 0,
      footerBottom: footerRect?.bottom ?? 0,
      dockLeft: dockRect?.left ?? 0,
      dockRight: dockRect?.right ?? 0,
      dockTop: dockRect?.top ?? 0,
      drawerLeft: drawerRect?.left ?? 0,
      drawerRight: drawerRect?.right ?? 0,
      drawerBottom: drawerRect?.bottom ?? 0,
      drawerAriaNow: Number(resizeHandle?.getAttribute('aria-valuenow') ?? 0),
      drawerAriaMax: Number(resizeHandle?.getAttribute('aria-valuemax') ?? 0),
      drawerUserSized: drawer?.dataset.userSized === 'true',
      resizeHandleTop: resizeHandleRect?.top ?? -1,
      resizeHandleBottom: resizeHandleRect?.bottom ?? -1,
      controlsTop: controlsRect?.top ?? 0,
      timelineHeight: timelineRect?.height ?? 0
    }
  })()`)
}

async function collectZoomedDrawerLayout(cdp) {
  return evaluate(cdp, `(() => {
    const timeline = document.querySelector('.camp-timeline')
    const timelinePane = document.querySelector('.timeline-pane')
    const drawer = document.querySelector('.execution-drawer')
    const drawerBody = drawer?.querySelector('.execution-drawer-body')
    const resizeHandle = drawer?.querySelector('.execution-drawer-resize-handle')
    const controls = document.querySelector('.conversation-controls')
    const composer = document.querySelector('.composer-box')
    const timelineRect = timeline?.getBoundingClientRect()
    const timelinePaneRect = timelinePane?.getBoundingClientRect()
    const drawerRect = drawer?.getBoundingClientRect()
    const resizeHandleRect = resizeHandle?.getBoundingClientRect()
    const controlsRect = controls?.getBoundingClientRect()
    const composerRect = composer?.getBoundingClientRect()
    return {
      cssViewportWidth: innerWidth,
      cssViewportHeight: innerHeight,
      devicePixelRatio,
      physicalViewportWidth: Math.round(innerWidth * devicePixelRatio),
      physicalViewportHeight: Math.round(innerHeight * devicePixelRatio),
      drawerVisible: Boolean(drawerRect && drawerRect.width > 0 && drawerRect.height > 0),
      resizeHandleVisible: Boolean(resizeHandleRect
        && resizeHandleRect.width > 0
        && resizeHandleRect.height > 0
        && resizeHandleRect.top >= 0
        && resizeHandleRect.bottom <= innerHeight),
      drawerBottom: drawerRect?.bottom ?? 0,
      timelinePaneBottom: timelinePaneRect?.bottom ?? 0,
      drawerAriaNow: Number(resizeHandle?.getAttribute('aria-valuenow') ?? 0),
      drawerAriaMax: Number(resizeHandle?.getAttribute('aria-valuemax') ?? 0),
      controlsTop: controlsRect?.top ?? 0,
      composerTop: composerRect?.top ?? 0,
      composerBottom: composerRect?.bottom ?? 0,
      timelineHeight: timelineRect?.height ?? 0,
      drawerBodyScrollable: Boolean(drawerBody && drawerBody.scrollHeight > drawerBody.clientHeight)
    }
  })()`)
}

async function collectWideComposerLayout(cdp) {
  return evaluate(cdp, `(() => {
    const composer = document.querySelector('.composer')
    const composerBox = composer?.querySelector('.composer-box')
    const actions = composerBox?.querySelector('.composer-actions')
    const hint = actions?.querySelector('.composer-hint')
    const send = actions?.querySelector('.composer-send')
    const composerRect = composer?.getBoundingClientRect()
    const composerBoxRect = composerBox?.getBoundingClientRect()
    const hintRect = hint?.getBoundingClientRect()
    const sendRect = send?.getBoundingClientRect()
    const actionStyle = actions ? getComputedStyle(actions) : null
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      composerBoxWidth: composerBoxRect?.width ?? 0,
      leftInset: composerRect && composerBoxRect ? composerBoxRect.left - composerRect.left : 0,
      rightInset: composerRect && composerBoxRect ? composerRect.right - composerBoxRect.right : 0,
      actionGap: Number.parseFloat(actionStyle?.columnGap ?? actionStyle?.gap ?? '0'),
      enterHint: hint?.textContent?.trim() ?? null,
      sendLabel: send?.textContent?.trim() ?? null,
      hintImmediatelyPrecedesSend: hint?.nextElementSibling === send,
      hintToSendGap: hintRect && sendRect ? sendRect.left - hintRect.right : null
    }
  })()`)
}

async function collectWideConversationLayout(cdp) {
  return evaluate(cdp, `(() => {
    const article = document.querySelector(${JSON.stringify(runArticleSelector)})
    const track = document.querySelector('.timeline-track')
    const body = article?.querySelector('.message-body')
    const surface = article?.querySelector('.message-surface')
    const copy = article?.querySelector('.final-copy')
    const narrative = copy?.querySelector('.safe-markdown > p')
      ?? copy?.querySelector('.safe-markdown')
    const rect = (node) => node?.getBoundingClientRect()
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      timelineTrackWidth: rect(track)?.width ?? 0,
      messageBodyWidth: rect(body)?.width ?? 0,
      surfaceWidth: rect(surface)?.width ?? 0,
      narrativeWidth: rect(narrative)?.width ?? 0,
      articleBackground: article ? getComputedStyle(article).backgroundColor : null,
      surfaceBackground: surface ? getComputedStyle(surface).backgroundColor : null,
      copyBackground: copy ? getComputedStyle(copy).backgroundColor : null
    }
  })()`)
}

async function seedActivity(entry, index) {
  const runId = `run-${entry.key}`
  const operationId = `operation-${entry.key}`
  const occurredAt = `2026-08-05T12:${String(index).padStart(2, '0')}:01Z`
  const evidence = entry.key === 'codex'
    ? [{
        id: 'evidence-codex-start', sequence: 1, eventType: 'activity.started', kind: entry.evidenceKind, phase: 'started',
        payload: { item: { ...entry.payload.item, status: 'inProgress', output: null } }
      }, {
        id: 'evidence-codex-complete', sequence: 2, eventType: entry.eventType, kind: entry.evidenceKind, phase: 'completed', payload: entry.payload
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
    ?? (entry.sourceAuthority === 'core' ? 'camp.message.send' : null)
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
      ${sqlLiteral(entry.presentationHint ?? entry.payload.title ?? toolName ?? 'Runtime 工具调用')},
      'terminal', 'succeeded', ${sqlLiteral(entry.credibility ?? 'runtime_structured')},
      'fine_grained', ${sqlLiteral(entry.sourceAuthority ?? 'runtime')},
      ${sqlLiteral(JSON.stringify(evidenceIds))}, 1, ${evidence.length},
      ${evidence.length}, ${sqlLiteral(occurredAt)}, ${sqlLiteral(occurredAt)}
    );
    COMMIT;
  `)
}

async function collectRuntimeRows(cdp) {
  const rows = []
  for (const expected of runtimes) {
    const memberName = `${expected.runtimeName} 验收`
    const opened = await evaluate(cdp, `(() => {
      const agentId = ${JSON.stringify(expected.agentId)}
      const chip = [...document.querySelectorAll('.run-pulse-chip[data-agent-id]')]
        .find((candidate) => candidate.dataset.agentId === agentId)
      chip?.click()
      return Boolean(chip)
    })()`)
    assert(opened, `Missing Agent process entry for ${memberName}`)
    await waitForExpression(cdp, `(() => {
      const selected = document.querySelector('.run-pulse-chip.is-selected')
      const title = document.querySelector('#execution-drawer-title')?.textContent?.trim() ?? ''
      return selected?.dataset.agentId === ${JSON.stringify(expected.agentId)}
        && title === ${JSON.stringify(`${memberName} · 执行过程`)}
    })()`)
    if (expected.agentId === activeAgentId) {
      await waitForExpression(cdp, `(() => {
        const stage = document.querySelector('.execution-process-stage.is-focused')
        return stage?.dataset.agentRunId === ${JSON.stringify(activeRunId)}
          && stage.classList.contains('status-running')
          && Boolean(stage.querySelector('.execution-disclosure.run-live.is-running'))
      })()`)
    }
    await evaluate(cdp, `(() => {
      document.querySelectorAll('.execution-drawer details.execution-disclosure:not([open]) > summary')
        .forEach((summary) => summary.click())
      return true
    })()`)
    if (expected.expectedToolName !== null && expected.expectedToolName !== undefined) {
      await waitForExpression(cdp, `document.querySelectorAll('.execution-drawer .tool-call-title').length > 0`, 10_000)
    } else {
      await wait(150)
    }
    rows.push(await evaluate(cdp, `(() => {
      const selectedMember = ${JSON.stringify(memberName)}
      const article = [...document.querySelectorAll(${JSON.stringify(runArticleSelector)})]
        .find((candidate) => candidate.querySelector('.bubble-meta strong')?.textContent?.trim() === selectedMember)
      const meta = article?.querySelector('.bubble-meta')
      const spans = [...(meta?.querySelectorAll(':scope > span') ?? [])].map((span) => span.textContent?.trim() ?? '')
      const stages = [...document.querySelectorAll('.execution-drawer .execution-process-stage[data-agent-run-id]')]
      const focused = stages.find((stage) => stage.classList.contains('is-focused'))
      return {
        member: selectedMember,
        agentId: ${JSON.stringify(expected.agentId)},
        runtime: spans.find((text) => ${JSON.stringify(runtimes.map((entry) => entry.runtimeName))}.includes(text)) ?? '',
        runCount: stages.length,
        runIds: stages.map((stage) => stage.dataset.agentRunId ?? ''),
        focusedRunId: focused?.dataset.agentRunId ?? null,
        focusedStatus: [...(focused?.classList ?? [])].find((name) => name.startsWith('status-'))?.slice(7) ?? null,
        focusedEvidenceOpen: Boolean(
          focused?.querySelector('.execution-disclosure.run-live')
          || focused?.querySelector('details.execution-disclosure[open]')
        ),
        runSelectorCount: document.querySelectorAll(
          '.execution-run-list, .execution-run-item, [aria-label="选择 AgentRun"]'
        ).length,
        toolTitles: [...document.querySelectorAll('.execution-drawer .tool-call-title')].map((node) => node.textContent?.trim() ?? ''),
        toolSources: [...document.querySelectorAll('.execution-drawer .tool-call-source')].map((node) => node.textContent?.trim() ?? ''),
        body: article?.querySelector('.message-content')?.textContent?.trim()
          ?? article?.querySelector('.safe-markdown')?.textContent?.trim() ?? ''
      }
    })()`))
  }
  return rows
}

async function verifyExecutionDrawerResizeControl(cdp) {
  const geometry = async () => evaluate(cdp, `(() => {
    const drawer = document.querySelector('.execution-drawer')
    const handle = drawer?.querySelector('.execution-drawer-resize-handle')
    const body = drawer?.querySelector('.execution-drawer-body')
    const focused = drawer?.querySelector('.execution-process-stage.is-focused')
    const drawerRect = drawer?.getBoundingClientRect()
    const handleRect = handle?.getBoundingClientRect()
    const drawerStyle = drawer ? getComputedStyle(drawer) : null
    return drawer && handle && body && drawerRect && handleRect ? {
      height: Math.round(drawerRect.height),
      inlineStyle: drawer.getAttribute('style'),
      computedHeight: drawerStyle?.height ?? null,
      computedMinHeight: drawerStyle?.minHeight ?? null,
      computedMaxHeight: drawerStyle?.maxHeight ?? null,
      computedFlex: drawerStyle?.flex ?? null,
      parentHeight: drawer.parentElement?.clientHeight ?? null,
      handleX: Math.round(handleRect.left + handleRect.width / 2),
      handleY: Math.round(handleRect.top + handleRect.height / 2),
      role: handle.getAttribute('role'),
      orientation: handle.getAttribute('aria-orientation'),
      min: Number(handle.getAttribute('aria-valuemin')),
      max: Number(handle.getAttribute('aria-valuemax')),
      now: Number(handle.getAttribute('aria-valuenow')),
      userSized: drawer.dataset.userSized === 'true',
      storedHeight: sessionStorage.getItem('rovai.execution-drawer-height.v1'),
      selectedAgentId: document.querySelector('.run-pulse-chip.is-selected')?.dataset.agentId ?? null,
      focusedRunId: focused?.dataset.agentRunId ?? null,
      followingLatest: body.dataset.followingLatest === 'true',
      bottomDistance: Math.round(body.scrollHeight - body.scrollTop - body.clientHeight)
    } : null
  })()`)

  const initial = await geometry()
  assert(initial
    && initial.role === 'separator'
    && initial.orientation === 'horizontal'
    && initial.min >= 48
    && initial.max > initial.min
    && initial.now >= initial.min
    && initial.now <= initial.max,
  `Execution Drawer resize separator is not accessible: ${JSON.stringify(initial)}`)

  await focusExecutionDrawerResizeHandle(cdp)
  await pressKey(cdp, 'Home', 'Home', 36)
  await waitForExpression(cdp, `(() => {
    const handle = document.querySelector('.execution-drawer-resize-handle')
    const drawer = document.querySelector('.execution-drawer')
    const now = Number(handle?.getAttribute('aria-valuenow') ?? 0)
    return now === Number(handle?.getAttribute('aria-valuemin') ?? -1)
      && Math.abs((drawer?.getBoundingClientRect().height ?? 0) - now) <= 1
      && document.querySelector('.execution-drawer')?.dataset.userSized === 'true'
  })()`)
  const minimum = await geometry()
  await focusExecutionDrawerResizeHandle(cdp)
  await pressKey(cdp, 'PageUp', 'PageUp', 33)
  await waitForExpression(cdp, `(() => {
    const handle = document.querySelector('.execution-drawer-resize-handle')
    const drawer = document.querySelector('.execution-drawer')
    const now = Number(handle?.getAttribute('aria-valuenow') ?? 0)
    return now > Number(handle?.getAttribute('aria-valuemin') ?? 0)
      && Math.abs((drawer?.getBoundingClientRect().height ?? 0) - now) <= 1
  })()`)
  const keyboardSized = await geometry()
  assert(minimum && keyboardSized
    && keyboardSized.height > minimum.height
    && keyboardSized.storedHeight === String(keyboardSized.now),
  `Keyboard resize or session persistence failed: ${JSON.stringify({ minimum, keyboardSized })}`)

  await evaluate(cdp, `document.querySelector('.execution-drawer-header .quiet-button')?.click()`)
  await waitForExpression(cdp, `!document.querySelector('.execution-drawer')`)
  await evaluate(cdp, `(() => {
    const chip = [...document.querySelectorAll('.run-pulse-chip[data-agent-id]')]
      .find((candidate) => candidate.dataset.agentId === ${JSON.stringify(activeAgentId)})
    chip?.click()
    return Boolean(chip)
  })()`)
  await waitForExpression(cdp, `Boolean(document.querySelector('.execution-drawer-resize-handle'))`)
  const reopened = await geometry()
  assert(reopened
    && Math.abs(reopened.height - keyboardSized.height) <= 1
    && reopened.storedHeight === keyboardSized.storedHeight
    && reopened.selectedAgentId === activeAgentId
    && reopened.focusedRunId === activeRunId,
  `Execution Drawer height did not survive close and reopen: ${JSON.stringify({ keyboardSized, reopened })}`)

  await focusExecutionDrawerResizeHandle(cdp)
  await pressKey(cdp, 'Enter', 'Enter', 13)
  await waitForExpression(cdp, `document.querySelector('.execution-drawer')?.dataset.userSized === 'false'
    && sessionStorage.getItem('rovai.execution-drawer-height.v1') === null`)
  await wait(100)
  const reset = await geometry()
  assert(reset && !reset.userSized && reset.storedHeight === null,
    `Execution Drawer did not reset to its responsive default: ${JSON.stringify(reset)}`)

  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: reset.handleX, y: reset.handleY,
    button: 'none', buttons: 0
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: reset.handleX, y: reset.handleY,
    button: 'left', buttons: 1, clickCount: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: reset.handleX, y: reset.handleY + 64,
    button: 'left', buttons: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: reset.handleX, y: reset.handleY + 64,
    button: 'left', buttons: 0, clickCount: 1
  })
  await waitForExpression(cdp, `document.querySelector('.execution-drawer')?.dataset.userSized === 'true'`)
  await wait(100)
  const pointerSized = await geometry()
  assert(pointerSized
    && pointerSized.height < reset.height - 30
    && pointerSized.selectedAgentId === activeAgentId
    && pointerSized.focusedRunId === activeRunId
    && pointerSized.followingLatest
    && pointerSized.bottomDistance <= 2,
  `Pointer resize changed execution identity or lost live follow: ${JSON.stringify({ reset, pointerSized })}`)

  return {
    separatorAccessible: true,
    keyboardResize: { minimum: minimum.height, expanded: keyboardSized.height },
    pointerResize: { before: reset.height, after: pointerSized.height },
    sessionHeightSurvivesReopen: true,
    enterRestoresResponsiveDefault: true,
    selectedAgentId: pointerSized.selectedAgentId,
    focusedRunId: pointerSized.focusedRunId,
    liveFollowPreserved: pointerSized.followingLatest
  }
}

async function verifyExecutionAutoFollowControl(cdp) {
  await evaluate(cdp, `(() => {
    document.querySelectorAll('.execution-drawer details.tool-call-disclosure:not([open]) > summary')
      .forEach((summary) => summary.click())
    return true
  })()`)
  await wait(100)
  const geometry = await evaluate(cdp, `(() => {
    const body = document.querySelector('.execution-drawer-body')
    if (!(body instanceof HTMLElement)) return null
    body.scrollTop = body.scrollHeight
    body.dispatchEvent(new Event('scroll', { bubbles: true }))
    return {
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      following: body.dataset.followingLatest
    }
  })()`)
  assert(geometry && geometry.scrollHeight > geometry.clientHeight,
    `Running execution fixture is not scrollable: ${JSON.stringify(geometry)}`)
  await waitForExpression(cdp,
    `document.querySelector('.execution-drawer-body')?.dataset.followingLatest === 'true'`)
  await evaluate(cdp, `(() => {
    const body = document.querySelector('.execution-drawer-body')
    if (!(body instanceof HTMLElement)) return false
    body.scrollTop = 0
    body.dispatchEvent(new Event('scroll', { bubbles: true }))
    return true
  })()`)
  await waitForExpression(cdp,
    `document.querySelector('.execution-drawer-body')?.dataset.followingLatest === 'false'`)
  await evaluate(cdp, `(() => {
    const body = document.querySelector('.execution-drawer-body')
    if (!(body instanceof HTMLElement)) return false
    body.scrollTop = body.scrollHeight
    body.dispatchEvent(new Event('scroll', { bubbles: true }))
    return true
  })()`)
  await waitForExpression(cdp,
    `document.querySelector('.execution-drawer-body')?.dataset.followingLatest === 'true'`)
  return {
    scrollable: true,
    manualScrollPauses: true,
    returningToBottomResumes: true
  }
}

function assertRuntimeRows(observed) {
  assert(observed.length === runtimes.length,
    `Expected ${runtimes.length} Runtime rows: ${JSON.stringify(observed)}`)
  const active = observed.find((row) => row.agentId === activeAgentId)
  assert(active?.runCount === 2
    && active.runIds.includes(historicalRunId)
    && active.runIds.includes(activeRunId),
    `Same-Agent AgentRuns were not aggregated in one Drawer: ${JSON.stringify(active)}`)
  assert(active.focusedRunId === activeRunId
    && active.focusedStatus === 'running'
    && active.focusedEvidenceOpen,
    `Explicit Agent click did not focus and reveal the running AgentRun: ${JSON.stringify(active)}`)
  for (const expected of runtimes) {
    const row = observed.find((candidate) => candidate.runtime === expected.runtimeName)
    assert(row, `Missing ${expected.runtimeName} row: ${JSON.stringify(observed)}`)
    assert(row.runSelectorCount === 0,
      `${expected.runtimeName} Drawer exposed an AgentRun selector: ${JSON.stringify(row)}`)
    if (expected.agentId !== activeAgentId) {
      assert(row.runCount === 1 && row.focusedRunId === row.runIds[0],
        `${expected.runtimeName} historical execution could not be reopened: ${JSON.stringify(row)}`)
      if (expected.expectedToolName !== null) {
        assert(row.focusedEvidenceOpen,
          `${expected.runtimeName} historical evidence could not be expanded: ${JSON.stringify(row)}`)
      }
    }
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
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
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

async function focusExecutionDrawerResizeHandle(cdp) {
  await cdp.send('Page.bringToFront')
  await wait(80)
  const focused = await evaluate(cdp, `(() => {
    const handle = document.querySelector('.execution-drawer-resize-handle')
    handle?.focus({ preventScroll: true })
    return document.activeElement === handle
  })()`)
  assert(focused, 'Could not focus the Execution Drawer resize separator')
}

async function pressKey(cdp, key, code, windowsVirtualKeyCode) {
  const params = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
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
