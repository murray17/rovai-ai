import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createServer } from 'node:net'
import { stagedSidecarPath } from './lib/sidecar-targets.mjs'
import {
  coreDataDirectoryArguments,
  runtimeCampFilesRootForDataDirectory
} from './lib/runtime-camp-files-root.mjs'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai-ai.app'))
const fixtureRoot = process.env.ROVAI_RUNTIME_ACTIVITY_ACCEPT_FIXTURE_ROOT
  ?? await mkdtemp(join(tmpdir(), 'rovai-runtime-activity-ui-accept-'))
const dataDir = join(fixtureRoot, 'user-data')
const runtimeTempDir = process.env.ROVAI_RUNTIME_ACTIVITY_ACCEPT_RUNTIME_TMP
  ?? tmpdir()
const outputDir = process.env.ROVAI_RUNTIME_ACTIVITY_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-runtime-activity-ui-captures-'))
const recoveryBlockerOnly = process.env.ROVAI_RUNTIME_ACTIVITY_ACCEPT_RECOVERY_BLOCKER_ONLY === '1'
const conversationDropZoneOnly = process.env.ROVAI_RUNTIME_ACTIVITY_ACCEPT_DROP_ZONE_ONLY === '1'
const worldMapOnly = process.env.ROVAI_RUNTIME_ACTIVITY_ACCEPT_WORLD_MAP_ONLY === '1'
const runtimeModelOnly = process.env.ROVAI_RUNTIME_ACTIVITY_ACCEPT_MODEL_ONLY === '1'
const databasePath = join(dataDir, 'rovai.sqlite')
const debugPort = process.env.ROVAI_RUNTIME_ACTIVITY_ACCEPT_DEBUG_PORT
  ? Number(process.env.ROVAI_RUNTIME_ACTIVITY_ACCEPT_DEBUG_PORT)
  : await availableLoopbackPort()
const campId = 'rvcamp_01h47kvsy5fk1shh6w1g60eec0'
const campTitle = 'v0.55 Agent 执行过程验收'
const composerLayoutCampId = 'rvcamp_01h47kvsy5fk1shh6w1g60eec1'
const composerLayoutCampTitle = 'v0.56 Composer 布局验收'
const ambientEncounterCampId = 'rvcamp_01h47kvsy5fk1shh6w1g60eec2'
const ambientEncounterCampTitle = 'v0.87 世界地图偶遇验收'
const ambientEncounterAgentIds = Array.from({ length: 11 }, (_, index) => `agent_ambient_${index + 1}`)
const runArticleSelector = 'article.timeline-node.conversation-bubble.agent'
const activeAgentId = 'agent_101'
const worldMapVisibleRuntimeCount = 4
const activeRunId = 'run-codex'
const historicalRunId = 'run-codex-history'
const recoveryBlockedAgentId = 'agent_103'
const recoveryBlockedRunId = 'run-copilot'
const longToolOutputFirstMarker = 'ROVAI_LONG_TOOL_OUTPUT_BEGIN'
const longToolOutputMiddleMarker = 'ROVAI_LONG_TOOL_OUTPUT_MIDDLE'
const longToolOutputLastMarker = 'ROVAI_LONG_TOOL_OUTPUT_END'
const longToolOutput = Array.from({ length: 8_432 }, (_, index) => {
  if (index === 0) return `${longToolOutputFirstMarker} · line 1`
  if (index === 4_215) return `${longToolOutputMiddleMarker} · line ${index + 1}`
  if (index === 8_431) return `${longToolOutputLastMarker} · line ${index + 1}`
  return `fixture output line ${index + 1} · vehicle prepayment reconciliation`
}).join('\n')
const directoryAttachmentSource = join(fixtureRoot, '项目资料')
const codexExpectedCommand = 'rovai camp read --mode timeline --direction before --limit 20'

const runtimes = [
  runtime('codex', 'codex-cli', 'Codex CLI', codexExpectedCommand, {
    protocol: 'codex-app-server', domain: 'shell', semantic: 'shell.execute',
    evidenceKind: 'command', eventType: 'activity.completed', presentationHint: '执行 Shell 命令', payload: {
      item: {
        id: 'op-codex', type: 'commandExecution', status: 'completed', title: null,
        command: '/bin/zsh -lc "rovai camp read --mode timeline --direction before --limit 20"',
        commandActions: [{ type: 'unknown', name: null, path: null }],
        output: longToolOutput
      }
    }
  }),
  runtime('opencode', 'opencode-cli', 'OpenCode', 'read_file', acp('read', 'read_file', 'file', 'file.read')),
  runtime('copilot', 'copilot-cli', 'GitHub Copilot', 'edit_file', {
    ...acp('edit', 'edit_file', 'file', 'file.write', null),
    expectedToolDisclosure: false
  }),
  runtime('kiro', 'kiro-cli', 'Kiro', 'execute', acp('execute', 'execute', 'shell', 'shell.execute')),
  runtime('qoder', 'qoder-cli', 'Qoder', 'search_workspace', {
    ...acp('search', 'search_workspace', 'tool', 'tool.web.search'),
    cancelledWithInProgressActivity: true,
    expectedToolDisclosure: false
  }),
  runtime('codebuddy', 'codebuddy-cli', 'CodeBuddy', 'mcp_call', acp('mcp_tool_call', 'mcp_call', 'tool', 'tool.call')),
  runtime('qwen', 'qwen-code', 'Qwen Code', 'write_file', acp('write_file', 'write_file', 'file', 'file.write')),
  runtime('trae', 'trae-cn-cli', 'TRAE CLI（中国企业版）', 'edit_file', acp('edit_file', 'edit_file', 'file', 'file.write')),
  runtime('claude', 'claude-code-cli', 'Claude Code', 'printf', {
    protocol: 'claude-stream-json', domain: 'shell', semantic: 'shell.execute',
    evidenceKind: 'runtime.action', eventType: 'runtime.action', payload: {
      toolCallId: 'toolu-claude-bash', status: 'completed', kind: 'execute',
      toolName: 'Bash', title: 'Bash', input: "printf '%s\\n' 'ROVAI_CLAUDE_EMPTY_OUTPUT_OK'", output: null
    }
  }),
  runtime('antigravity', 'antigravity-app', 'Antigravity', 'camp.message.send', {
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
await mkdir(join(directoryAttachmentSource, 'docs', 'empty'), { recursive: true })
await writeFile(join(directoryAttachmentSource, 'README.md'), 'Conversation drop zone acceptance.\n')
await writeFile(join(directoryAttachmentSource, 'docs', 'plan.txt'), 'Keep the hierarchy frozen.\n')
await writeFile(join(directoryAttachmentSource, '.env.example'), 'TOKEN=example-only\n')
await initializeDatabase()
await seedFixture()

let app = null
let clipboardArchive = null
let clipboardTouched = false
let testFailure = null
let cleanupFailure = null
try {
  clipboardArchive = await snapshotClipboard()
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
  const workspaceEntryExecution = await evaluate(app.cdp, `(() => ({
    placement: document.querySelector('.execution-drawer')?.dataset.placement ?? null,
    selectedAgentId: document.querySelector('.run-pulse-chip.is-selected')?.dataset.agentId ?? null,
    focusedRunId: document.querySelector('.execution-process-stage.is-focused')?.dataset.agentRunId ?? null,
    drawerOwnsFocus: Boolean(document.activeElement?.closest('.execution-drawer'))
  }))()`)
  assert(workspaceEntryExecution.placement === 'bottom'
    && workspaceEntryExecution.selectedAgentId === activeAgentId
    && workspaceEntryExecution.focusedRunId === activeRunId
    && !workspaceEntryExecution.drawerOwnsFocus,
    `Entering the running Camp did not open its latest Run without stealing focus: ${JSON.stringify(workspaceEntryExecution)}`)
  await evaluate(app.cdp,
    `document.querySelector('.execution-drawer [aria-label="收起执行详情"]')?.click()`)
  await waitForExpression(app.cdp, `!document.querySelector('.execution-drawer')`)

  if (worldMapOnly) {
    const worldMapAcceptance = await verifyCampWorldMap(app.cdp, outputDir)
    console.log(JSON.stringify({
      ok: true,
      mode: 'controlled-camp-world-map-fixture',
      app: basename(appPath),
      fixtureRoot,
      outputDir,
      ...worldMapAcceptance
    }, null, 2))
  } else if (conversationDropZoneOnly) {
    await selectCampConversationView(app.cdp, 'conversation')
    const dropZoneAcceptance = await verifyConversationDropZone(
      app.cdp,
      directoryAttachmentSource,
      outputDir
    )
    console.log(JSON.stringify({
      ok: true,
      mode: 'controlled-conversation-drop-zone-fixture',
      app: basename(appPath),
      fixtureRoot,
      outputDir,
      ...dropZoneAcceptance
    }, null, 2))
  } else if (recoveryBlockerOnly) {
    await selectCampConversationView(app.cdp, 'conversation')
    const recoveryBlockerPresentation = await verifyRecoveryBlockerPresentation(app.cdp)
    const recoveryBlockerCapture = join(outputDir, 'runtime-activity-recovery-blocker.png')
    await capture(app.cdp, recoveryBlockerCapture)
    const recoveryBlockerResolution = await verifyRecoveryBlockerResolution(app.cdp)
    console.log(JSON.stringify({
      ok: true,
      mode: 'controlled-recovery-blocker-fixture',
      recoveryBlockerPresentation,
      recoveryBlockerResolution,
      recoveryBlockerCapture
    }, null, 2))
  } else {
  await selectCampConversationView(app.cdp, 'conversation')
  const timelineFollowLatest = runtimeModelOnly
    ? null
    : await verifyTimelineFollowsLatestAcrossViewportResize(app.cdp)
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

  const messageAuthorProfileTriggers = await collectMessageAuthorProfileTriggers(app.cdp)
  assert(messageAuthorProfileTriggers.length === runtimes.length
    && messageAuthorProfileTriggers.every((entry) =>
      entry.triggerCount === 2
        && entry.avatar.tagName === 'BUTTON'
        && entry.nameTrigger.tagName === 'BUTTON'
        && entry.avatar.label === `查看${entry.name}的基础信息`
        && entry.nameTrigger.label === `查看${entry.name}的基础信息`
        && entry.avatar.hasPopup === 'dialog'
        && entry.nameTrigger.hasPopup === 'dialog'
        && entry.avatar.tabIndex === 0
        && entry.nameTrigger.tabIndex === 0
        && entry.avatar.width >= 28
        && entry.avatar.height >= 28
        && entry.nameTrigger.height >= 28
        && entry.avatar.cursor === 'pointer'
        && entry.nameTrigger.cursor === 'pointer'),
  `Agent message authors are not two accessible profile triggers: ${JSON.stringify(messageAuthorProfileTriggers)}`)

  const firstAuthorName = `${runtimes[0].runtimeName} 验收`
  const firstAuthorPopoverLabel = `${firstAuthorName}的基础信息`
  const authorPopoverCapture = join(outputDir, 'runtime-activity-author-popover.png')
  for (const variant of ['avatar', 'name']) {
    const triggerSelector = `${runArticleSelector} .message-author-${variant}-trigger[data-agent-id="${runtimes[0].agentId}"]`
    await mouseClickSelector(app.cdp, triggerSelector)
    await waitForExpression(app.cdp,
      `document.querySelector('.mention-profile-popover[role="dialog"][aria-label=${JSON.stringify(firstAuthorPopoverLabel)}]')?.classList.contains('is-positioned')`)
    const authorPointerActivation = await evaluate(app.cdp, `(() => ({
      stayedInCamp: Boolean(document.querySelector('.camp-workspace')) && !document.querySelector('.members-view'),
      openedToast: Boolean(document.querySelector('.app-toast')),
      activeTrigger: document.querySelector(${JSON.stringify(`${triggerSelector}[data-mention-open="true"]`)})?.getAttribute('aria-label') ?? null
    }))()`)
    assert(authorPointerActivation.stayedInCamp
      && !authorPointerActivation.openedToast
      && authorPointerActivation.activeTrigger === `查看${firstAuthorName}的基础信息`,
    `Clicking an Agent ${variant} did not open the anchored profile in place: ${JSON.stringify(authorPointerActivation)}`)
    if (variant === 'avatar') await capture(app.cdp, authorPopoverCapture)
    await pressKey(app.cdp, 'Escape', 'Escape', 27, 53)
    await waitForExpression(app.cdp, `!document.querySelector('.mention-profile-popover')`)
  }

  for (const activation of [
    { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36 },
    { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 49 }
  ]) {
    const focused = await evaluate(app.cdp, `(() => {
      const trigger = document.querySelector(
        ${JSON.stringify(`${runArticleSelector} .message-author-name-trigger[data-agent-id="${runtimes[0].agentId}"]`)}
      )
      trigger?.focus({ preventScroll: true })
      return document.activeElement === trigger
    })()`)
    assert(focused, `Could not focus the Agent name trigger for ${activation.code}`)
    await pressKey(
      app.cdp,
      activation.key,
      activation.code,
      activation.windowsVirtualKeyCode,
      activation.nativeVirtualKeyCode
    )
    await waitForExpression(app.cdp,
      `document.querySelector('.mention-profile-popover[role="dialog"][aria-label=${JSON.stringify(firstAuthorPopoverLabel)}]')?.classList.contains('is-positioned')`)
    await waitForExpression(app.cdp,
      `document.activeElement?.classList.contains('mention-profile-popover') === true`)
    await pressKey(app.cdp, 'Escape', 'Escape', 27, 53)
    await waitForExpression(app.cdp, `!document.querySelector('.mention-profile-popover')`)
    await waitForExpression(app.cdp,
      `document.activeElement?.classList.contains('message-author-name-trigger') === true`)
  }

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
  assert(agentDock.entries.every((entry) => entry.childCount === 3
    && entry.nameLineCount >= 1
    && entry.nameLineCount <= 2
    && entry.visibleStateText === ''
    && entry.buttonAriaLabel
    && entry.buttonTitle
    && entry.stateAriaLabel
    && entry.stateTitle
    && ['state-running', 'state-waiting', 'state-completed', 'state-failed', 'state-stopped', 'state-recorded']
      .includes(entry.stateShape)),
  `Agent dock entries were not avatar + two-line name + shaped status markers: ${JSON.stringify(agentDock)}`)
  assert(agentDock.followsTimeline && agentDock.dockTop >= agentDock.timelineBottom - 1,
    `Agent dock is not attached below the conversation timeline: ${JSON.stringify(agentDock)}`)
  assert(agentDock.topRunBadgeCount === 0
    && agentDock.auditTabCount === 0
    && JSON.stringify(agentDock.inspectorTabLabels) === JSON.stringify(['队员', '任务']),
  `Removed top Run/Audit entries or legacy Inspector tabs returned: ${JSON.stringify(agentDock)}`)

  await evaluate(app.cdp, `document.querySelector('.run-pulse-bottom .execution-placement-button')?.click()`)
  await waitForExpression(app.cdp, `(() => {
    const activeTab = document.querySelector('.activity-tabs > .tabs-list [role="tab"][data-state="active"]')
    return activeTab?.textContent?.includes('执行')
      && Boolean(document.querySelector('.run-pulse-inspector'))
      && !document.querySelector('.timeline-pane > .run-pulse')
  })()`)
  await evaluate(app.cdp, `(() => {
    const chip = [...document.querySelectorAll('.run-pulse-inspector .run-pulse-chip[data-agent-id]')]
      .find((candidate) => candidate.dataset.agentId === ${JSON.stringify(activeAgentId)})
    chip?.click()
    return Boolean(chip)
  })()`)
  await waitForExpression(app.cdp,
    `document.querySelector('.execution-drawer')?.dataset.placement === 'inspector'`)
  const executionSidecar = await collectExecutionSidecar(app.cdp)
  assert(JSON.stringify(executionSidecar.inspectorTabLabels) === JSON.stringify(['执行', '队员', '任务'])
    && executionSidecar.activeTab === '执行'
    && executionSidecar.bottomDockCount === 0
    && executionSidecar.sideDockCount === 1
    && executionSidecar.chipCount === runtimes.length
    && executionSidecar.uniqueAgentIds.length === runtimes.length
    && executionSidecar.entryContract
    && executionSidecar.verticalRows
    && executionSidecar.fullWidthRows
    && executionSidecar.listScrollHeight > executionSidecar.listClientHeight
    && executionSidecar.listOverflowY === 'auto'
    && executionSidecar.drawerPlacement === 'inspector'
    && !executionSidecar.resizeHandle
    && executionSidecar.selectedAgentId === activeAgentId
    && !executionSidecar.horizontalOverflow,
  `Inspector execution Sidecar contract failed: ${JSON.stringify(executionSidecar)}`)
  const inspectorRuntimeModel = await collectFocusedRuntimeModelLayout(app.cdp)
  assertFocusedRuntimeModelLayout(inspectorRuntimeModel, 'Inspector')
  const executionSidecarCapture = join(outputDir, 'runtime-activity-execution-sidecar.png')
  await capture(app.cdp, executionSidecarCapture)

  const executionGlobalPlacement = await verifyGlobalExecutionPlacement(app.cdp)
  const executionPlacementFailure = await verifyExecutionPlacementWriteFailure(app.cdp)

  await evaluate(app.cdp,
    `document.querySelector('.run-pulse-inspector .execution-placement-button')?.click()`)
  await waitForExpression(app.cdp, `(() => {
    const drawer = document.querySelector('.execution-drawer')
    return Boolean(document.querySelector('.timeline-pane > .run-pulse.run-pulse-bottom'))
      && !document.querySelector('.activity-tabs [role="tab"][value="execution"]')
      && drawer?.dataset.placement === 'bottom'
      && Boolean(drawer.querySelector('.execution-drawer-resize-handle'))
  })()`)
  const returnedExecutionDock = await collectAgentDock(app.cdp)
  const returnedExecutionSelection = await evaluate(app.cdp, `(() => ({
    selectedAgentId: document.querySelector('.run-pulse-bottom .run-pulse-chip.is-selected')?.dataset.agentId ?? null,
    drawerPlacement: document.querySelector('.execution-drawer')?.dataset.placement ?? null,
    resizeHandle: Boolean(document.querySelector('.execution-drawer .execution-drawer-resize-handle')),
    inspectorTabLabels: [...document.querySelectorAll('.activity-tabs > .tabs-list [role="tab"]')]
      .map((tab) => tab.textContent?.replace(/\\d+/g, '').replace(/\\s+/g, ' ').trim() ?? '')
  }))()`)
  assert(returnedExecutionDock.followsTimeline
    && returnedExecutionSelection.selectedAgentId === activeAgentId
    && returnedExecutionSelection.drawerPlacement === 'bottom'
    && returnedExecutionSelection.resizeHandle
    && JSON.stringify(returnedExecutionSelection.inspectorTabLabels) === JSON.stringify(['队员', '任务']),
  `Execution console did not return to the production bottom surface: ${JSON.stringify({ returnedExecutionDock, returnedExecutionSelection })}`)

  await setTheme(app.cdp, 'night')
  const nightRuntimeModel = await collectFocusedRuntimeModelLayout(app.cdp)
  assertFocusedRuntimeModelLayout(nightRuntimeModel, 'Night bottom Drawer')
  const nightRuntimeModelCapture = join(outputDir, 'runtime-activity-model-night.png')
  await capture(app.cdp, nightRuntimeModelCapture)
  await setTheme(app.cdp, 'day')

  const observed = await collectRuntimeRows(app.cdp)
  assertRuntimeRows(observed)
  const totalToolRows = observed.reduce((total, row) => total + row.toolTitles.length, 0)
  assert(totalToolRows === 10,
    `Expected exactly ten observed structured tool rows: ${JSON.stringify(observed)}`)
  const responsiveRuntimeModels = await verifyResponsiveRuntimeModelLayouts(app.cdp, outputDir)
  if (runtimeModelOnly) {
    const reportPath = join(outputDir, 'runtime-model-acceptance.json')
    const report = {
      ok: true,
      mode: 'controlled-runtime-model-fixture',
      app: basename(appPath),
      fixtureRoot,
      outputDir,
      verified: {
        runtimeCount: observed.length,
        observedRuntimeCount: runtimes.filter((entry) => entry.observedModelId).length,
        fallbackRuntimeCount: runtimes.filter((entry) =>
          entry.modelSelectionSource === 'runtime_default' && !entry.observedModelId).length,
        fixedModelRuntimeCount: runtimes.filter((entry) => entry.modelSelectionSource === 'explicit').length,
        inspectorRuntimeModel,
        nightRuntimeModel,
        responsiveRuntimeModels,
        executionGlobalPlacement,
        executionPlacementFailure
      },
      runtimes: observed,
      captures: {
        inspector: executionSidecarCapture,
        night: nightRuntimeModelCapture,
        ...responsiveRuntimeModels.captures
      }
    }
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify({ ...report, reportPath }, null, 2))
  } else {
  const claudeCommandDisclosure = await verifyClaudeCommandDisclosure(app.cdp)

  const recoveryBlockerPresentation = await verifyRecoveryBlockerPresentation(app.cdp)
  const recoveryBlockerCapture = join(outputDir, 'runtime-activity-recovery-blocker.png')
  await capture(app.cdp, recoveryBlockerCapture)

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
  const completeToolOutput = await verifyCompleteToolOutput(app.cdp)
  const executionAutoFollow = await verifyExecutionAutoFollowControl(app.cdp)
  const toolOutputCapture = join(outputDir, 'runtime-activity-tool-output.png')
  await capture(app.cdp, toolOutputCapture)

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

  const drawerFocusedForEscape = await evaluate(app.cdp, `(() => {
    const closeButton = document.querySelector('.execution-drawer button[aria-label="收起执行详情"]')
    closeButton?.focus({ preventScroll: true })
    return document.activeElement === closeButton
  })()`)
  assert(drawerFocusedForEscape, 'Could not focus the execution Drawer before testing Drawer-level Escape')
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
    `document.querySelector('.camp-workspace')?.getAttribute('aria-label') === ${JSON.stringify(`会话：${composerLayoutCampTitle}`)}`)
  await evaluate(app.cdp, `(() => {
    const grid = document.querySelector('.workspace-grid')
    const toggle = document.querySelector('.topbar-inspector-toggle[aria-pressed="false"]')
    if (grid?.classList.contains('inspector-collapsed')) toggle?.click()
    return true
  })()`)
  await waitForExpression(app.cdp, `!document.querySelector('.workspace-grid')?.classList.contains('inspector-collapsed')`)
  await wait(200)
  const wideComposerLayout = await collectWideComposerLayout(app.cdp)
  assert(wideComposerLayout.viewportWidth === 2560 && wideComposerLayout.viewportHeight === 1440,
    `2K viewport did not apply: ${JSON.stringify(wideComposerLayout)}`)
  assert(wideComposerLayout.documentScrollWidth <= wideComposerLayout.viewportWidth + 1
    && wideComposerLayout.composerBoxWidth >= 1438
    && wideComposerLayout.composerBoxWidth <= 1442
    && wideComposerLayout.timelineTrackWidth >= 1038
    && wideComposerLayout.timelineTrackWidth <= 1042
    && wideComposerLayout.wideMediaMatches
    && wideComposerLayout.composerWidthToken === '1440px',
    `2K Composer or timeline width regressed: ${JSON.stringify(wideComposerLayout)}`)
  assert(Math.abs(wideComposerLayout.leftInset - wideComposerLayout.rightInset) <= 12
    && wideComposerLayout.centerAxisDelta <= 1
    && (wideComposerLayout.composerRouteRailWidth == null
      || Math.abs(wideComposerLayout.composerRouteRailWidth - wideComposerLayout.composerBoxWidth) <= 1)
    && (wideComposerLayout.composerRouteRailCenterDelta == null
      || wideComposerLayout.composerRouteRailCenterDelta <= 1)
    && !wideComposerLayout.inspectorCollapsed
    && wideComposerLayout.actionGap === 5
    && wideComposerLayout.enterHint === 'Enter 发送，Shift+Enter 换行'
    && wideComposerLayout.enterHintVisual === '↵发送·⇧↵换行'
    && wideComposerLayout.sendLabel === '发送'
    && wideComposerLayout.hintImmediatelyPrecedesSend
    && wideComposerLayout.hintToSendGap >= 4
    && wideComposerLayout.hintToSendGap <= 6,
    `2K composer alignment or Enter/Send adjacency regressed: ${JSON.stringify(wideComposerLayout)}`)
  const wideCapture = join(outputDir, 'runtime-activity-wide.png')
  await capture(app.cdp, wideCapture)

  await evaluate(app.cdp, `(() => {
    document.querySelector('.topbar-inspector-toggle[aria-pressed="true"]')?.click()
    return true
  })()`)
  await waitForExpression(app.cdp, `document.querySelector('.workspace-grid')?.classList.contains('inspector-collapsed')`)
  const wideComposerWithoutInspector = await collectWideComposerLayout(app.cdp)
  assert(wideComposerWithoutInspector.documentScrollWidth <= wideComposerWithoutInspector.viewportWidth + 1
    && wideComposerWithoutInspector.composerBoxWidth >= 1438
    && wideComposerWithoutInspector.composerBoxWidth <= 1442
    && wideComposerWithoutInspector.timelineTrackWidth >= 1038
    && wideComposerWithoutInspector.timelineTrackWidth <= 1042
    && Math.abs(wideComposerWithoutInspector.leftInset - wideComposerWithoutInspector.rightInset) <= 12
    && wideComposerWithoutInspector.centerAxisDelta <= 1
    && wideComposerWithoutInspector.wideMediaMatches
    && wideComposerWithoutInspector.composerWidthToken === '1440px'
    && wideComposerWithoutInspector.inspectorCollapsed,
    `2K Composer expanded incorrectly with Inspector hidden: ${JSON.stringify(wideComposerWithoutInspector)}`)
  const wideWithoutInspectorCapture = join(outputDir, 'runtime-activity-wide-inspector-hidden.png')
  await capture(app.cdp, wideWithoutInspectorCapture)

  await evaluate(app.cdp, `(() => {
    document.querySelector('.topbar-inspector-toggle[aria-pressed="false"]')?.click()
    return true
  })()`)
  await waitForExpression(app.cdp, `!document.querySelector('.workspace-grid')?.classList.contains('inspector-collapsed')`)
  await app.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1799, height: 920, deviceScaleFactor: 1, mobile: false
  })
  await waitForExpression(app.cdp, `innerWidth === 1799 && innerHeight === 920`)
  await wait(200)
  const regularComposerLayout = await collectWideComposerLayout(app.cdp)
  assert(regularComposerLayout.documentScrollWidth <= regularComposerLayout.viewportWidth + 1
    && regularComposerLayout.composerBoxWidth >= 1038
    && regularComposerLayout.composerBoxWidth <= 1042
    && (regularComposerLayout.composerRouteRailWidth == null
      || Math.abs(regularComposerLayout.composerRouteRailWidth - regularComposerLayout.composerBoxWidth) <= 1)
    && regularComposerLayout.timelineTrackWidth >= 788
    && regularComposerLayout.timelineTrackWidth <= 792
    && Math.abs(regularComposerLayout.leftInset - regularComposerLayout.rightInset) <= 12
    && regularComposerLayout.centerAxisDelta <= 1
    && !regularComposerLayout.wideMediaMatches
    && regularComposerLayout.composerWidthToken === '1040px',
    `Composer did not retain the 1040px cap below 1800px: ${JSON.stringify(regularComposerLayout)}`)
  await app.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false
  })
  await waitForExpression(app.cdp, `innerWidth === 2560 && innerHeight === 1440`)

  await openCamp(app.cdp, campId)
  await waitForExpression(app.cdp,
    `document.querySelector('.camp-workspace')?.getAttribute('aria-label') === ${JSON.stringify(`会话：${campTitle}`)}`)
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
  const compactRuntimeModel = await collectFocusedRuntimeModelLayout(app.cdp)
  assertFocusedRuntimeModelLayout(compactRuntimeModel, '1040x700 bottom Drawer')
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
  const zoomedRuntimeModel = await collectFocusedRuntimeModelLayout(app.cdp)
  assertFocusedRuntimeModelLayout(zoomedRuntimeModel, '200% zoom bottom Drawer')
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
  const directAgentRunStop = await verifyDirectAgentRunStop(app.cdp)
  const placementRestartResult = await verifyExecutionPlacementAcrossRestart(app)
  app = placementRestartResult.app
  const executionPlacementRestart = placementRestartResult.evidence

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
      recoveryBlockerPresentation,
      runningRunFocusedWithEvidence: observed.find((row) => row.agentId === activeAgentId)?.focusedEvidenceOpen === true,
      executionDrawerResize,
      executionAutoFollow,
      completeToolOutput,
      claudeCommandDisclosure,
      antigravityCoreToolCatalogName: observed.find((row) => row.runtime === 'Antigravity')?.toolTitles[0] === 'camp.message.send',
      conversationPresentation,
      timelineFollowLatest,
      messageAuthorProfileTriggers,
      agentLevelProcessDock: agentDock,
      executionSidecar,
      executionGlobalPlacement,
      executionPlacementFailure,
      executionPlacementRestart,
      inspectorRuntimeModel,
      nightRuntimeModel,
      executionReturnedToBottom: returnedExecutionSelection,
      recipientOnlyHandoffFooter: handoffFooter,
      wideComposerLayout,
      wideConversationLayout,
      recipientOnlyCompactLayout: compactLayout,
      compactRuntimeModel,
      zoomedDrawerLayout,
      zoomedRuntimeModel,
      directAgentRunStop
    },
    runtimes: observed,
    captures: {
      top: topCapture,
      authorPopover: authorPopoverCapture,
      executionSidecar: executionSidecarCapture,
      nightRuntimeModel: nightRuntimeModelCapture,
      bottom: bottomCapture,
      toolOutput: toolOutputCapture,
      recoveryBlocker: recoveryBlockerCapture,
      wide: wideCapture,
      wideConversation: wideConversationCapture,
      compact: compactCapture,
      zoom200: zoomedDrawerCapture
    }
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ ...report, reportPath }, null, 2))
  }
  }
} catch (error) {
  testFailure = error
} finally {
  if (app) {
    try {
      await closeApp(app)
    } catch (error) {
      cleanupFailure = error
    }
  }
  if (clipboardTouched && clipboardArchive) {
    try {
      await restoreClipboardWithRetry(clipboardArchive)
    } catch (error) {
      cleanupFailure = cleanupFailure
        ? new AggregateError([cleanupFailure, error], 'App cleanup and clipboard restoration failed')
        : error
    }
  }
}

if (testFailure || cleanupFailure) {
  process.stderr.write(`Preserved runtime activity fixture: ${fixtureRoot}\n`)
  process.stderr.write(`Preserved runtime activity captures: ${outputDir}\n`)
  if (testFailure && cleanupFailure) {
    throw new AggregateError([testFailure, cleanupFailure],
      'Runtime activity acceptance and cleanup both failed')
  }
  throw testFailure ?? cleanupFailure
}

function runtime(key, adapterKind, runtimeName, expectedToolName, details) {
  const modelFixture = runtimeModelFixture(key)
  return {
    key,
    agentId: `agent_${101 + runtimesLengthHint(key)}`,
    adapterKind,
    runtimeName,
    expectedToolName,
    expectedToolDisclosure: true,
    ...modelFixture,
    ...details
  }
}

function runtimeModelFixture(key) {
  if (key === 'copilot') {
    return { modelSelectionSource: 'explicit', observedModelId: null }
  }
  if (key === 'kiro') {
    return { modelSelectionSource: 'runtime_default', observedModelId: null }
  }
  const modelIds = {
    codex: 'gpt-5.6-codex-runtime-observation-preview-with-an-intentionally-long-identifier',
    opencode: 'opencode/big-pickle',
    qoder: 'qoder-enterprise-latest',
    codebuddy: 'codebuddy/default-v2',
    qwen: 'qwen3-coder-plus',
    trae: 'trae-cn/default',
    claude: 'claude-sonnet-4-6',
    antigravity: 'gemini-3.1-pro-preview'
  }
  return { modelSelectionSource: 'runtime_default', observedModelId: modelIds[key] }
}

function runtimesLengthHint(key) {
  return ['codex', 'opencode', 'copilot', 'kiro', 'qoder', 'codebuddy', 'qwen', 'claude', 'antigravity'].indexOf(key)
}

function acp(kind, toolName, domain, semantic, output = 'fixture completed') {
  return {
    protocol: 'acp-v1', domain, semantic,
    evidenceKind: 'runtime.action', eventType: 'runtime.action', payload: {
      toolCallId: `op-${toolName}`, status: 'completed', kind,
      toolName, title: toolName, output
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
  const runtimeRoot = runtimeCampFilesRootForDataDirectory(dataDir)
  const runtimeRootMarker = JSON.parse(await readFile(
    join(runtimeRoot, '.runtime-camp-files-root.json'),
    'utf8'
  ))
  assert(typeof runtimeRootMarker.rootIdentityDigest === 'string',
    `Runtime Files Root marker did not expose its identity: ${JSON.stringify(runtimeRootMarker)}`)
  const emptyCatalogDigest = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
  const attachmentRootRelativePath = `camps/${campId}/attachments`
  const publishedAttachmentRoot = join(runtimeRoot, attachmentRootRelativePath)
  const campAttachmentViewReceipt = {
    schemaVersion: 2,
    campId,
    attachmentRootRelativePath,
    catalogRevision: 0,
    catalogEntryCount: 0,
    semanticCatalogDigest: emptyCatalogDigest,
    referencedEntries: [],
    referencedEntriesDigest: canonicalJsonDigest([])
  }
  const campAttachmentViewReceiptDigest = canonicalJsonDigest(campAttachmentViewReceipt)
  const runtimeAttachmentAuthReceipt = {
    schemaVersion: 1,
    campId,
    publishedAttachmentRoot,
    rootIdentityDigest: runtimeRootMarker.rootIdentityDigest,
    dispatchGeneration: 1,
    catalogDigestAtDispatch: emptyCatalogDigest,
    visibilityMode: 'generation_fenced_v1',
    compatibilityGeneration: 1,
    manifestViewReceiptDigest: campAttachmentViewReceiptDigest
  }
  const runtimeAttachmentAuthReceiptDigest = canonicalJsonDigest(runtimeAttachmentAuthReceipt)
  const recoveryBlob = await seedManagedBlob(
    Buffer.from(JSON.stringify({ fixture: 'accepted-input-recovery-blocker' })),
    now
  )
  const installationRows = runtimes.map((entry) => `(
    ${sqlLiteral(`installation-runtime-${entry.key}`)}, ${sqlLiteral(entry.adapterKind)},
    ${sqlLiteral(`/fixture/${entry.key}`)}, ${sqlLiteral(entry.key)}, 'custom', 'custom',
    'fixture', 1, 1, 'valid', 1, ${sqlLiteral(now)}, ${sqlLiteral(now)}
  )`).join(',\n')
  const profileRows = runtimes.map((entry, index) => `(
    ${sqlLiteral(`uuid-runtime-${entry.key}`)}, ${sqlLiteral(entry.agentId)},
    ${sqlLiteral(`runtime-${entry.key}`)}, ${sqlLiteral(`${entry.runtimeName} 验收`)},
    ${sqlLiteral(['#5B6C8F', '#4C7A78', '#6B668E', '#7A6756', '#5E7485', '#76627A', '#5C7960', '#786C59', '#596D7B'][index])},
    1, '{}', ${sqlLiteral(now)}, ${sqlLiteral(now)}, '[]', ${sqlLiteral(worldMapOnly && index >= worldMapVisibleRuntimeCount ? 'away' : 'present')}, 1,
    ${sqlLiteral(`runtime_${entry.key}`)}, ${100 + index},
    ${sqlLiteral(entry.adapterKind)}, ${sqlLiteral(`installation-runtime-${entry.key}`)},
    '{"mode":"runtime_default"}',
    ${sqlLiteral(JSON.stringify({ adapterKind: entry.adapterKind, schemaVersion: 1, values: {} }))},
    'Runtime Activity 验收', '', '[]', '', ''
  )`).join(',\n')
  const ambientProfileRows = ambientEncounterAgentIds.map((agentId, index) => `(
    ${sqlLiteral(`uuid-${agentId}`)}, ${sqlLiteral(agentId)},
    ${sqlLiteral(`ambient-${index + 1}`)}, ${sqlLiteral(`闲时队员 ${index + 1}`)},
    ${sqlLiteral(['#5B6C8F', '#4C7A78', '#6B668E', '#7A6756'][index % 4])},
    1, '{}', ${sqlLiteral(now)}, ${sqlLiteral(now)}, '[]', 'present', 1,
    ${sqlLiteral(`ambient_${index + 1}`)}, ${300 + index},
    'codex-cli', 'installation-runtime-codex',
    '{"mode":"runtime_default"}',
    '{"adapterKind":"codex-cli","schemaVersion":1,"values":{}}',
    'member', '', '[]', '', ''
  )`).join(',\n')
  const memberRows = runtimes.map((entry) => `(
    ${sqlLiteral(campId)}, ${sqlLiteral(entry.agentId)}, 'active', '{}', 1, ${sqlLiteral(now)}
  )`).join(',\n')
  const ambientMemberRows = ambientEncounterAgentIds.map((agentId) => `(
    ${sqlLiteral(ambientEncounterCampId)}, ${sqlLiteral(agentId)}, 'active', '{}', 1, ${sqlLiteral(now)}
  )`).join(',\n')
  const conversationRows = runtimes.map((entry) => `(
    ${sqlLiteral(`conversation-${entry.key}`)}, ${sqlLiteral(campId)}, ${sqlLiteral(entry.agentId)},
    1, ${sqlLiteral(now)}, ${sqlLiteral(now)}
  )`).join(',\n')
  const ambientConversationRows = ambientEncounterAgentIds.map((agentId, index) => `(
    ${sqlLiteral(`conversation-ambient-${index + 1}`)}, ${sqlLiteral(ambientEncounterCampId)},
    ${sqlLiteral(agentId)}, 1, ${sqlLiteral(now)}, ${sqlLiteral(now)}
  )`).join(',\n')
  const turnRows = [
    ...runtimes.map((entry, index) => {
      const active = entry.key === 'codex'
      const recoveryBlocked = entry.key === 'copilot'
      const nonTerminal = active || recoveryBlocked
      const updatedAt = `2026-08-05T12:${String(index).padStart(2, '0')}:${active ? '01' : '02'}Z`
      return `(
        ${sqlLiteral(`turn-${entry.key}`)}, ${sqlLiteral(campId)}, 'system_event',
        ${sqlLiteral(`runtime-activity-${entry.key}`)}, ${sqlLiteral(nonTerminal ? 'running' : 'completed')},
        1, ${sqlLiteral(now)}, ${sqlLiteral(nonTerminal ? '2036-08-06T12:00:00Z' : '2026-08-06T12:00:00Z')}, ${nonTerminal ? 0 : 86400}, 32, 16, 1,
        1,
        ${sqlLiteral(`2026-08-05T12:${String(index).padStart(2, '0')}:00Z`)},
        ${sqlLiteral(updatedAt)},
        ${sqlNullable(nonTerminal ? null : updatedAt)}
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
      const recoveryBlocked = entry.key === 'copilot'
      const nonTerminal = active || recoveryBlocked
      const terminalStatus = entry.cancelledWithInProgressActivity ? 'cancelled' : 'succeeded'
      const updatedAt = `2026-08-05T12:${String(index).padStart(2, '0')}:${active ? '01' : '02'}Z`
      return `(
        ${sqlLiteral(`run-${entry.key}`)}, ${sqlLiteral(`turn-${entry.key}`)},
        ${sqlLiteral(`conversation-${entry.key}`)}, 0, 0,
        ${sqlLiteral(`direct:${entry.agentId}`)}, 'initial',
        ${sqlLiteral(`验证 ${entry.runtimeName} Runtime Activity`)},
        'required', '{}', ${sqlLiteral(nonTerminal ? 'queued' : terminalStatus)}, ${sqlLiteral(`runtime-activity-${entry.key}`)},
        1, ${sqlLiteral(`2026-08-05T12:${String(index).padStart(2, '0')}:00Z`)},
        ${sqlNullable(active ? null : `2026-08-05T12:${String(index).padStart(2, '0')}:01Z`)},
        ${sqlNullable(nonTerminal ? null : updatedAt)},
        ${sqlLiteral(updatedAt)},
        ${sqlLiteral(entry.adapterKind)}, ${sqlLiteral(entry.protocol)},
        ${sqlLiteral(JSON.stringify({ source: entry.modelSelectionSource }))},
        ${sqlNullable(entry.observedModelId)}
      )`
    }),
    `(
      ${sqlLiteral(historicalRunId)}, 'turn-codex-history', 'conversation-codex', 0, 0,
      ${sqlLiteral(`direct:${activeAgentId}:history`)}, 'initial',
      'Codex 历史 Runtime Activity',
      'required', '{}', 'succeeded', 'runtime-activity-codex-history',
      1, '2026-08-05T11:58:00Z', '2026-08-05T11:58:01Z',
      '2026-08-05T11:58:02Z', '2026-08-05T11:58:02Z',
      'codex-cli', 'codex-app-server',
      '{"source":"explicit","modelId":"gpt-5.6-fixed"}', NULL
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
    ${sqlLiteral('digest-message-antigravity')}, 'run-antigravity', 'forward', 'run-antigravity', 1,
    '[]', '{}', '{}', 1, ${sqlLiteral(delivery.status)}, 'terminal', 1, 0, 0,
    ${sqlNullable(delivery.failureCode)}, 1, ${sqlLiteral(now)}, ${sqlLiteral(now)}, ${sqlLiteral(now)}
  )`).join(',\n')

  await runSql(databasePath, 'DROP TRIGGER camp_attachment_view_camp_insert;')
  try {
    await runSql(databasePath, `
    PRAGMA foreign_keys = ON;
    BEGIN IMMEDIATE;
    INSERT INTO managed_blob(
      id, sha256, byte_size, media_type, storage_relative_path,
      state, sensitivity, created_at, verified_at, updated_at
    ) VALUES (
      ${sqlLiteral(recoveryBlob.id)}, ${sqlLiteral(recoveryBlob.digest)}, ${recoveryBlob.byteSize},
      'application/json', ${sqlLiteral(recoveryBlob.relativePath)},
      'present', 'normal', ${sqlLiteral(now)}, ${sqlLiteral(now)}, ${sqlLiteral(now)}
    );
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
    ) VALUES ${profileRows}, ${ambientProfileRows};
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
    ), (
      ${sqlLiteral(ambientEncounterCampId)}, ${sqlLiteral(ambientEncounterCampTitle)}, 'user', 'peer', 'quick_chat',
      '', ${sqlLiteral(ambientEncounterAgentIds[0])}, 0, 1,
      ${sqlLiteral(now)}, ${sqlLiteral(now)}
    );
    INSERT INTO camp_attachment_view(
      camp_id, state, generation, root_relative_path,
      root_identity_digest, entry_count, aggregate_bytes,
      catalog_digest, catalog_revision, semantic_catalog_digest,
      active_operation_id, last_error_code,
      created_at, updated_at
    )
    SELECT id, 'ready', 1, 'camps/' || id || '/attachments',
           ${sqlLiteral(runtimeRootMarker.rootIdentityDigest)}, 0, 0,
           ${sqlLiteral(emptyCatalogDigest)}, 0, ${sqlLiteral(emptyCatalogDigest)},
           NULL, NULL, ${sqlLiteral(now)}, ${sqlLiteral(now)}
    FROM camp
    WHERE id IN (
      ${sqlLiteral(campId)},
      ${sqlLiteral(composerLayoutCampId)},
      ${sqlLiteral(ambientEncounterCampId)}
    );
    INSERT INTO camp_member(
      camp_id, agent_id, status, capability_overrides_json, version, joined_at
    ) VALUES ${memberRows}, ${ambientMemberRows}, (
      ${sqlLiteral(composerLayoutCampId)}, ${sqlLiteral(runtimes[0].agentId)}, 'active', '{}', 1, ${sqlLiteral(now)}
    );
    INSERT INTO conversation(id, camp_id, agent_id, version, created_at, updated_at)
    VALUES ${conversationRows}, ${ambientConversationRows}, (
      'conversation-composer-layout', ${sqlLiteral(composerLayoutCampId)}, ${sqlLiteral(runtimes[0].agentId)},
      1, ${sqlLiteral(now)}, ${sqlLiteral(now)}
    );
    UPDATE conversation
    SET native_adapter_installation_id = 'installation-runtime-copilot',
        native_session_id = 'fixture-copilot-session',
        native_binding_compatibility_digest = 'fixture-copilot-compatibility',
        native_binding_id = 'fixture-copilot-binding',
        native_binding_generation = 1,
        native_installation_generation = 1,
        native_session_compatibility_key = 'fixture-copilot-session-v1'
    WHERE id = 'conversation-copilot';
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
      runtime_adapter_kind, runtime_protocol_version,
      runtime_model_selection_json, runtime_observed_model_id
    ) VALUES ${runRows};
    UPDATE agent_run
    SET status = 'waiting', wait_reason = 'recovery_blocked', runtime_recovery_required = 0,
        last_error_code = 'accepted_input_outcome_unknown'
    WHERE id = ${sqlLiteral(recoveryBlockedRunId)};
    INSERT INTO native_session_bootstrap_evidence(
      id, conversation_id, native_binding_id, native_binding_generation,
      contract_version, bootstrap_formatter_version,
      session_charter_blob_id, session_charter_digest,
      memory_entrypoint_blob_id, memory_entrypoint_digest,
      observed_memory_revisions_json, authorization_basis_digest,
      delivery_mode, created_at
    ) VALUES (
      'fixture-copilot-bootstrap', 'conversation-copilot', 'fixture-copilot-binding', 1,
      'native_session_bootstrap_v3', 3,
      ${sqlLiteral(recoveryBlob.id)}, ${sqlLiteral(recoveryBlob.digest)},
      ${sqlLiteral(recoveryBlob.id)}, ${sqlLiteral(recoveryBlob.digest)},
      '[]', 'fixture-authorization-basis', 'native_append', ${sqlLiteral(now)}
    );
    INSERT INTO context_manifest(
      id, agent_run_id, bootstrap_evidence_id, native_binding_generation,
      camp_message_boundary_sequence, conversation_message_boundary_sequence,
      raw_message_refs_json, collaboration_state_digest, collaboration_state_included,
      run_fact_refs_json, run_fact_digest, current_input_source_json,
      attachment_refs_json, attachment_digest,
      skill_exposure_json, skill_exposure_digest,
      current_input_skill_resolution_json,
      current_input_skill_resolution_digest,
      mcp_exposure_json, mcp_exposure_digest, mcp_projection_digest,
      self_active_task_evidence_json, self_active_task_evidence_digest,
      history_fence_version, global_public_message_boundary,
      previous_accepted_public_boundary_sequence,
      context_delivery_profile_version, context_delivery_profile_json,
      context_delivery_profile_digest, originating_public_user_message_ref_json,
      recent_message_refs_json, formatter_version,
      rendered_payload_blob_id, rendered_payload_digest, created_at,
      reference_closure_refs_json, omission_entries_json,
      shared_message_evidence_json, shared_message_evidence_digest,
      run_fact_payload_json, message_projection_audience,
      a2a_guidance_evidence_json, a2a_guidance_evidence_digest,
      context_manifest_version, run_facts_schema_version,
      camp_attachment_view_receipt_version,
      camp_attachment_view_receipt_json,
      camp_attachment_view_receipt_digest
    ) VALUES (
      'fixture-copilot-manifest', ${sqlLiteral(recoveryBlockedRunId)},
      'fixture-copilot-bootstrap', 1, ${runtimes.length}, 0,
      '[]', 'fixture-collaboration', 0,
      '[]', 'fixture-run-fact', '{}',
      '[]', 'fixture-attachments',
      '{"schemaVersion":2,"skills":[]}', '34d0df31466d3cc5a5adedad674cca325dcad3b5593e54e8400447a0617fceaf',
      '{"schemaVersion":1,"selectionSnapshotDigest":"eaf741c591ae9eb798b55a703ddadfeec7c803b91b3199272a7ccd39e56160c1","skillExposureDigest":"34d0df31466d3cc5a5adedad674cca325dcad3b5593e54e8400447a0617fceaf","entries":[]}',
      'ca354ab7bf5c6258ac3e62f926196a2c345be7f00a794c7ca2ad6f9821dbd371',
      '{"schemaVersion":2,"configDigest":"sha256:empty-mcp-config","configStatus":"ready","projectionMode":"unsupported","sameNamePolicy":null,"warnings":[],"servers":[]}',
      'sha256:legacy-empty-mcp-exposure', 'fixture-mcp-projection',
      '[]', 'fixture-active-tasks',
      0, ${runtimes.length}, 0,
      4, '{"profileVersion":4,"maxPublicMessages":15,"maxPublicHistoryChars":24000,"maxMessageBodyChars":2000,"maxPublicReferenceChainMessages":3,"maxSelfActiveTasks":8}',
      'fixture-context-profile', NULL,
      '[]', 21,
      ${sqlLiteral(recoveryBlob.id)}, ${sqlLiteral(recoveryBlob.digest)}, ${sqlLiteral(now)},
      '[]', '[]', '[]', 'fixture-shared-message-evidence', '{"schemaVersion":1}',
      'agent_v1', '{"schemaVersion":1,"included":false}',
      '8f0abde6b1c7b1bf405e1efa2a2cfe82a1bd329a64003a93c3e20c84a8c26d92',
      21, 2, 2,
      ${sqlLiteral(JSON.stringify(campAttachmentViewReceipt))},
      ${sqlLiteral(campAttachmentViewReceiptDigest)}
    );
    INSERT INTO runtime_input_delivery(
      id, agent_run_id, execution_epoch, context_manifest_id,
      native_binding_id, native_binding_generation,
      boundary_camp_message_sequence, dynamic_payload_digest,
      status, native_input_id, prepared_at, accepted_at, updated_at,
      runtime_attachment_auth_receipt_version,
      runtime_attachment_auth_receipt_json,
      runtime_attachment_auth_receipt_digest,
      runtime_request_digest
    ) VALUES (
      'fixture-copilot-input', ${sqlLiteral(recoveryBlockedRunId)}, 1,
      'fixture-copilot-manifest', 'fixture-copilot-binding', 1,
      ${runtimes.length}, ${sqlLiteral(recoveryBlob.digest)},
      'accepted', 'acp-prompt-fixture-host-1',
      ${sqlLiteral(now)}, ${sqlLiteral(now)}, ${sqlLiteral(now)},
      1, ${sqlLiteral(JSON.stringify(runtimeAttachmentAuthReceipt))},
      ${sqlLiteral(runtimeAttachmentAuthReceiptDigest)},
      ${sqlLiteral(canonicalJsonDigest({
        schemaVersion: 1,
        agentRunId: recoveryBlockedRunId,
        executionEpoch: 1,
        contextManifestId: 'fixture-copilot-manifest',
        runtimeAttachmentAuthReceiptDigest
      }))}
    );
    INSERT INTO camp_message(
      id, camp_id, sequence, author_type, author_id, source_agent_run_id,
      body, structured_content_json, address_mode, addressed_agent_ids_json, camp_turn_id,
      agent_run_id, version, created_at, updated_at
    ) VALUES ${messageRows};
    INSERT INTO message_delivery(
      id, camp_id, camp_turn_id, message_id,
      recipient_agent_id, recipient_canonical_position,
      recipient_digest, message_body_digest,
      source_agent_run_id, edge_kind, a2a_root_agent_run_id, a2a_depth,
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
  } finally {
    await runSql(databasePath, `
      CREATE TRIGGER camp_attachment_view_camp_insert
      AFTER INSERT ON camp
      BEGIN
        INSERT INTO camp_attachment_view(
          camp_id, state, generation, root_relative_path,
          root_identity_digest, entry_count, aggregate_bytes,
          catalog_digest, active_operation_id, last_error_code,
          created_at, updated_at
        ) VALUES (
          NEW.id, 'ready', 1, 'camps/' || NEW.id || '/attachments',
          rovai_runtime_camp_files_root_identity_digest(),
          0, 0,
          ${sqlLiteral(emptyCatalogDigest)},
          NULL, NULL, datetime('now'), datetime('now')
        );
      END;
    `)
  }
  await seedEmptyAttachmentViewRoots(runtimeRoot, [
    campId,
    composerLayoutCampId,
    ambientEncounterCampId
  ])

  for (const [index, entry] of runtimes.entries()) {
    if (entry.runLevelOnly) continue
    await seedActivity(entry, index)
  }
}

async function seedEmptyAttachmentViewRoots(runtimeRoot, campIds) {
  const campsRoot = join(runtimeRoot, 'camps')
  await chmod(campsRoot, 0o300)
  try {
    for (const exactCampId of campIds) {
      const campRoot = join(campsRoot, exactCampId)
      const attachmentRoot = join(campRoot, 'attachments')
      await mkdir(campRoot, { mode: 0o700 })
      await mkdir(attachmentRoot, { mode: 0o700 })
      await chmod(attachmentRoot, 0o500)
      await chmod(campRoot, 0o100)
    }
  } finally {
    await chmod(campsRoot, 0o100)
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

async function verifyTimelineFollowsLatestAcrossViewportResize(cdp) {
  const prepared = await evaluate(cdp, `(() => {
    const timeline = document.querySelector('.camp-timeline')
    const dock = document.querySelector('.run-pulse[aria-label="Agent 执行台"]')
    if (!timeline || !dock) return null
    dock.dataset.acceptanceDisplay = dock.style.display
    dock.style.display = 'none'
    timeline.scrollTop = timeline.scrollHeight
    timeline.dispatchEvent(new Event('scroll', { bubbles: true }))
    return {
      clientHeight: timeline.clientHeight,
      scrollHeight: timeline.scrollHeight,
      scrollTop: timeline.scrollTop,
      maxScroll: Math.max(0, timeline.scrollHeight - timeline.clientHeight)
    }
  })()`)
  assert(prepared, 'Timeline follow-latest acceptance could not find the timeline and Agent dock')

  const resized = await evaluate(cdp, `(async () => {
    const timeline = document.querySelector('.camp-timeline')
    const dock = document.querySelector('.run-pulse[aria-label="Agent 执行台"]')
    if (!timeline || !dock) return null
    dock.style.display = dock.dataset.acceptanceDisplay ?? ''
    delete dock.dataset.acceptanceDisplay
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const maxScroll = Math.max(0, timeline.scrollHeight - timeline.clientHeight)
    return {
      clientHeight: timeline.clientHeight,
      scrollHeight: timeline.scrollHeight,
      scrollTop: timeline.scrollTop,
      maxScroll,
      distanceFromBottom: Math.abs(maxScroll - timeline.scrollTop)
    }
  })()`, true)
  assert(resized, 'Timeline follow-latest acceptance lost the timeline and Agent dock')
  try {
    await waitForExpression(cdp, `(() => {
      const timeline = document.querySelector('.camp-timeline')
      return Boolean(timeline)
        && Math.abs(timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop) <= 1
    })()`, 2_000)
  } catch (error) {
    const stalled = await evaluate(cdp, `(() => {
      const timeline = document.querySelector('.camp-timeline')
      if (!timeline) return null
      const maxScroll = Math.max(0, timeline.scrollHeight - timeline.clientHeight)
      return {
        clientHeight: timeline.clientHeight,
        scrollHeight: timeline.scrollHeight,
        scrollTop: timeline.scrollTop,
        maxScroll,
        distanceFromBottom: Math.abs(maxScroll - timeline.scrollTop)
      }
    })()`)
    throw new Error(`Timeline follow-latest did not settle: ${JSON.stringify({ prepared, resized, stalled })}`, {
      cause: error
    })
  }
  const settled = await evaluate(cdp, `(() => {
    const timeline = document.querySelector('.camp-timeline')
    if (!timeline) return null
    const maxScroll = Math.max(0, timeline.scrollHeight - timeline.clientHeight)
    return {
      clientHeight: timeline.clientHeight,
      scrollHeight: timeline.scrollHeight,
      scrollTop: timeline.scrollTop,
      maxScroll,
      distanceFromBottom: Math.abs(maxScroll - timeline.scrollTop)
    }
  })()`)
  assert(resized.clientHeight < prepared.clientHeight,
    `Agent dock did not shrink the timeline viewport: ${JSON.stringify({ prepared, resized })}`)
  assert(settled?.distanceFromBottom <= 1,
    `Timeline did not remain at the latest message after its viewport shrank: ${JSON.stringify({ prepared, resized, settled })}`)
  return { prepared, resized: settled }
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

async function collectMessageAuthorProfileTriggers(cdp) {
  return evaluate(cdp, `(() => {
    const readTrigger = (trigger) => {
      const rect = trigger?.getBoundingClientRect()
      const style = trigger ? getComputedStyle(trigger) : null
      return {
        tagName: trigger?.tagName ?? null,
        label: trigger?.getAttribute('aria-label') ?? null,
        hasPopup: trigger?.getAttribute('aria-haspopup') ?? null,
        tabIndex: trigger?.tabIndex ?? null,
        cursor: style?.cursor ?? null,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0
      }
    }
    return [...document.querySelectorAll(${JSON.stringify(runArticleSelector)})].map((article) => {
      const avatar = article.querySelector(':scope > .message-author-avatar-trigger')
      const nameTrigger = article.querySelector('.bubble-meta > .message-author-name-trigger')
      return {
        name: article.querySelector('.bubble-meta strong')?.textContent?.trim() ?? '',
        triggerCount: article.querySelectorAll('.message-author-trigger').length,
        avatar: readTrigger(avatar),
        nameTrigger: readTrigger(nameTrigger)
      }
    })
  })()`)
}

async function collectAgentDock(cdp) {
  return evaluate(cdp, `(() => {
    const timeline = document.querySelector('.camp-timeline')
    const dock = document.querySelector('.run-pulse[aria-label="Agent 执行台"]')
    const timelineRect = timeline?.getBoundingClientRect()
    const dockRect = dock?.getBoundingClientRect()
    const chips = [...document.querySelectorAll('.run-pulse-chip[data-agent-id]')]
    const agentIds = chips
      .map((chip) => chip.dataset.agentId ?? '')
      .filter(Boolean)
    const entries = chips.map((chip) => {
      const name = chip.querySelector('.run-pulse-chip-copy strong')
      const state = chip.querySelector('.run-pulse-chip-state')
      return {
        agentId: chip.dataset.agentId ?? null,
        childCount: chip.children.length,
        nameLineCount: name?.children.length ?? 0,
        visibleStateText: state?.textContent?.trim() ?? '',
        buttonAriaLabel: chip.getAttribute('aria-label'),
        buttonTitle: chip.getAttribute('title'),
        stateAriaLabel: state?.getAttribute('aria-label'),
        stateTitle: state?.getAttribute('title'),
        stateShape: [...(state?.classList ?? [])].find((name) => name.startsWith('state-')) ?? null
      }
    })
    const auditTabCount = [...document.querySelectorAll('.activity-tabs > .tabs-list [role="tab"]')]
      .filter((tab) => tab.textContent?.includes('审计')).length
    const inspectorTabLabels = [...document.querySelectorAll('.activity-tabs > .tabs-list [role="tab"]')]
      .map((tab) => tab.textContent?.replace(/\\d+/g, '').replace(/\\s+/g, ' ').trim() ?? '')
    return {
      chipCount: agentIds.length,
      agentIds,
      uniqueAgentIds: [...new Set(agentIds)],
      entries,
      followsTimeline: timeline?.closest('.camp-conversation-stage')?.nextElementSibling === dock,
      timelineBottom: timelineRect?.bottom ?? 0,
      dockTop: dockRect?.top ?? 0,
      topRunBadgeCount: document.querySelectorAll('.topbar .run-badge').length,
      auditTabCount,
      inspectorTabLabels
    }
  })()`)
}

async function collectExecutionSidecar(cdp) {
  return evaluate(cdp, `(() => {
    const sideDock = document.querySelector('.run-pulse-inspector')
    const list = sideDock?.querySelector('.run-pulse-list')
    const chips = [...(list?.querySelectorAll('.run-pulse-chip[data-agent-id]') ?? [])]
    const rects = chips.map((chip) => chip.getBoundingClientRect())
    const agentIds = chips.map((chip) => chip.dataset.agentId ?? '').filter(Boolean)
    const inspectorTabLabels = [...document.querySelectorAll('.activity-tabs > .tabs-list [role="tab"]')]
      .map((tab) => tab.textContent?.replace(/\\d+/g, '').replace(/\\s+/g, ' ').trim() ?? '')
    const activeTab = document.querySelector('.activity-tabs > .tabs-list [role="tab"][data-state="active"]')
      ?.textContent?.replace(/\\d+/g, '').replace(/\\s+/g, ' ').trim() ?? null
    const drawer = document.querySelector('.execution-drawer')
    return {
      inspectorTabLabels,
      activeTab,
      bottomDockCount: document.querySelectorAll('.timeline-pane > .run-pulse').length,
      sideDockCount: document.querySelectorAll('.run-pulse-inspector').length,
      chipCount: chips.length,
      uniqueAgentIds: [...new Set(agentIds)],
      entryContract: chips.every((chip) => {
        const name = chip.querySelector('.run-pulse-chip-copy strong')
        const state = chip.querySelector('.run-pulse-chip-state')
        return chip.children.length === 3
          && (name?.children.length ?? 0) >= 1
          && (name?.children.length ?? 0) <= 2
          && (state?.textContent?.trim() ?? '') === ''
          && Boolean(chip.getAttribute('aria-label'))
          && Boolean(chip.getAttribute('title'))
          && Boolean(state?.getAttribute('aria-label'))
          && Boolean([...state.classList].find((name) => name.startsWith('state-')))
      }),
      verticalRows: rects.every((rect, index) => index === 0
        || (Math.abs(rect.x - rects[0].x) <= 1 && rect.y > rects[index - 1].y)),
      fullWidthRows: rects.every((rect) => list && Math.abs(rect.width - list.clientWidth) <= 4),
      listClientHeight: list?.clientHeight ?? 0,
      listScrollHeight: list?.scrollHeight ?? 0,
      listOverflowY: list ? getComputedStyle(list).overflowY : null,
      drawerPlacement: drawer?.dataset.placement ?? null,
      resizeHandle: Boolean(drawer?.querySelector('.execution-drawer-resize-handle')),
      selectedAgentId: sideDock?.querySelector('.run-pulse-chip.is-selected')?.dataset.agentId ?? null,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1
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
    const composerRouteRail = composer?.querySelector('.composer-route-rail')
    const timelineTrack = document.querySelector('.timeline-track')
    const actions = composerBox?.querySelector('.composer-actions')
    const hint = actions?.querySelector('.composer-hint')
    const send = actions?.querySelector('.composer-send')
    const composerRect = composer?.getBoundingClientRect()
    const composerBoxRect = composerBox?.getBoundingClientRect()
    const composerRouteRailRect = composerRouteRail?.getBoundingClientRect()
    const timelineTrackRect = timelineTrack?.getBoundingClientRect()
    const hintRect = hint?.getBoundingClientRect()
    const sendRect = send?.getBoundingClientRect()
    const actionStyle = actions ? getComputedStyle(actions) : null
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      visualViewportWidth: window.visualViewport?.width ?? null,
      wideMediaMatches: matchMedia('(min-width: 1800px)').matches,
      composerWidthToken: getComputedStyle(document.documentElement).getPropertyValue('--conversation-composer-width').trim(),
      documentScrollWidth: document.documentElement.scrollWidth,
      composerBoxWidth: composerBoxRect?.width ?? 0,
      composerRouteRailWidth: composerRouteRailRect?.width ?? null,
      timelineTrackWidth: timelineTrackRect?.width ?? 0,
      leftInset: composerRect && composerBoxRect ? composerBoxRect.left - composerRect.left : 0,
      rightInset: composerRect && composerBoxRect ? composerRect.right - composerBoxRect.right : 0,
      centerAxisDelta: composerBoxRect && timelineTrackRect
        ? Math.abs((composerBoxRect.left + composerBoxRect.width / 2) - (timelineTrackRect.left + timelineTrackRect.width / 2))
        : Number.POSITIVE_INFINITY,
      composerRouteRailCenterDelta: composerBoxRect && composerRouteRailRect
        ? Math.abs((composerBoxRect.left + composerBoxRect.width / 2) - (composerRouteRailRect.left + composerRouteRailRect.width / 2))
        : null,
      inspectorCollapsed: document.querySelector('.workspace-grid')?.classList.contains('inspector-collapsed') ?? false,
      actionGap: Number.parseFloat(actionStyle?.columnGap ?? actionStyle?.gap ?? '0'),
      enterHint: hint?.querySelector('.sr-only')?.textContent?.trim() ?? null,
      enterHintVisual: hint?.querySelector('.composer-hint-visual')?.textContent?.replace(/\\s+/g, '').trim() ?? null,
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
  const stoppedProjectionFixture = entry.cancelledWithInProgressActivity === true
  const evidence = entry.key === 'codex'
    ? [{
        id: 'evidence-codex-start', sequence: 1, eventType: 'activity.started', kind: entry.evidenceKind, phase: 'started',
        payload: { item: { ...entry.payload.item, status: 'inProgress', output: null } }
      }, {
        id: 'evidence-codex-complete', sequence: 2, eventType: entry.eventType, kind: entry.evidenceKind, phase: 'completed', payload: entry.payload
      }]
    : [{
        id: `evidence-${entry.key}`, sequence: 1, eventType: entry.eventType,
        kind: stoppedProjectionFixture ? 'tool_call' : 'tool_result',
        phase: stoppedProjectionFixture ? 'started' : 'completed',
        payload: stoppedProjectionFixture
          ? { ...entry.payload, status: 'in_progress', output: null }
          : entry.payload
      }]
  const preparedEvidence = []
  for (const item of evidence) {
    const encoded = Buffer.from(JSON.stringify(item.payload))
    const blob = encoded.byteLength > 16 * 1024
      ? await seedManagedBlob(encoded, occurredAt)
      : null
    preparedEvidence.push({
      ...item,
      payloadPreview: blob ? boundedEvidencePreview(item.payload) : item.payload,
      contentBlobId: blob?.id ?? null,
      contentByteCount: encoded.byteLength,
      isTruncated: Boolean(blob),
      blob
    })
  }
  const evidenceRows = preparedEvidence.map((item) => `(
    ${sqlLiteral(item.id)}, ${sqlLiteral(runId)}, 1, ${item.sequence},
    ${sqlLiteral(item.eventType)}, ${sqlLiteral(item.kind)}, ${sqlLiteral(item.phase)},
    ${sqlLiteral(`${item.eventType}:${operationId}:${item.phase}`)},
    ${sqlLiteral(JSON.stringify(item.payloadPreview))}, ${sqlNullable(item.contentBlobId)},
    ${item.contentByteCount}, ${item.isTruncated ? 1 : 0}, ${sqlLiteral(occurredAt)}
  )`).join(',\n')
  const managedBlobStatements = preparedEvidence.flatMap((item) => item.blob ? [`
    INSERT INTO managed_blob(
      id, sha256, byte_size, media_type, storage_relative_path,
      state, sensitivity, created_at, verified_at, updated_at
    ) VALUES (
      ${sqlLiteral(item.blob.id)}, ${sqlLiteral(item.blob.digest)}, ${item.blob.byteSize},
      'application/json', ${sqlLiteral(item.blob.relativePath)},
      'present', 'normal', ${sqlLiteral(occurredAt)}, ${sqlLiteral(occurredAt)}, ${sqlLiteral(occurredAt)}
    ) ON CONFLICT(sha256) DO NOTHING;
  `] : []).join('\n')
  const evidenceIds = evidence.map((item) => item.id)
  const toolName = entry.payload.toolName
    ?? (entry.sourceAuthority === 'core' ? 'camp.message.send' : null)
  await runSql(databasePath, `
    PRAGMA foreign_keys = ON;
    BEGIN IMMEDIATE;
    ${managedBlobStatements}
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
      ${sqlLiteral(entry.presentationHint ?? entry.payload.title ?? toolName ?? '工具调用')},
      ${sqlLiteral(stoppedProjectionFixture ? 'progress' : 'terminal')},
      ${sqlLiteral(stoppedProjectionFixture ? 'unknown' : 'succeeded')},
      ${sqlLiteral(entry.credibility ?? 'runtime_structured')},
      'fine_grained', ${sqlLiteral(entry.sourceAuthority ?? 'runtime')},
      ${sqlLiteral(JSON.stringify(evidenceIds))}, 1, ${evidence.length},
      ${evidence.length}, ${sqlLiteral(occurredAt)}, ${sqlLiteral(occurredAt)}
    );
    COMMIT;
  `)
}

function boundedEvidencePreview(value) {
  if (typeof value === 'string') {
    const characters = Array.from(value)
    return characters.length <= 4_000
      ? value
      : `${characters.slice(0, 4_000).join('')}\n…（内容已截断，可按需读取完整证据）`
  }
  if (Array.isArray(value)) return value.slice(0, 24).map(boundedEvidencePreview)
  if (value !== null && typeof value === 'object') {
    return {
      ...Object.fromEntries(Object.entries(value).slice(0, 24).map(([key, child]) => [key, boundedEvidencePreview(child)])),
      _rovaiTruncated: true
    }
  }
  return value
}

async function seedManagedBlob(bytes, occurredAt) {
  const digest = createHash('sha256').update(bytes).digest('hex')
  const id = `blob-sha256-${digest}`
  const relativePath = `sha256/${digest.slice(0, 2)}/${digest}`
  const directory = join(dataDir, 'managed-blobs', 'sha256', digest.slice(0, 2))
  await mkdir(directory, { recursive: true })
  await writeFile(join(dataDir, 'managed-blobs', relativePath), bytes)
  return { id, digest, relativePath, byteSize: bytes.byteLength, occurredAt }
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
        && title === ${JSON.stringify(`${memberName} ${expected.runtimeName}`)}
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
      const toolLayouts = [...document.querySelectorAll('.execution-drawer .tool-call-summary')]
        .map((toolRow) => {
          const icon = toolRow.querySelector('.tool-call-icon')
          const iconSvg = icon?.querySelector('svg')
          const state = toolRow.querySelector('.tool-call-state')
          const disclosure = toolRow.querySelector('.tool-call-disclosure-slot')
          const rowStyle = getComputedStyle(toolRow)
          const iconRect = icon?.getBoundingClientRect()
          const iconSvgRect = iconSvg?.getBoundingClientRect()
          const stateRect = state?.getBoundingClientRect()
          const disclosureRect = disclosure?.getBoundingClientRect()
          return {
            display: rowStyle.display,
            gridTemplateColumns: rowStyle.gridTemplateColumns,
            childCount: toolRow.children.length,
            iconDomain: icon?.dataset.iconDomain ?? null,
            iconWidth: iconRect?.width ?? 0,
            iconSvgWidth: iconSvgRect?.width ?? 0,
            iconSvgHeight: iconSvgRect?.height ?? 0,
            stateWidth: stateRect?.width ?? 0,
            disclosureWidth: disclosureRect?.width ?? 0,
            statusLabel: state?.getAttribute('aria-label') ?? null,
            disclosurePlaceholder: disclosure?.classList.contains('is-placeholder') ?? false,
            summaryAriaLabel: toolRow.matches('summary')
              ? toolRow.getAttribute('aria-label')
              : null
          }
        })
      const modelPresentations = stages.map((stage) => {
        const model = stage.querySelector('.execution-run-model')
        const code = model?.querySelector('code')
        const style = code ? getComputedStyle(code) : null
        return {
          runId: stage.dataset.agentRunId ?? '',
          count: stage.querySelectorAll('.execution-run-model').length,
          text: model?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
          codeText: code?.textContent?.trim() ?? null,
          defaultBadge: model?.querySelector('small')?.textContent?.trim() ?? null,
          title: code?.getAttribute('title') ?? null,
          tabIndex: code?.tabIndex ?? null,
          role: model?.getAttribute('role') ?? null,
          ariaLive: model?.getAttribute('aria-live') ?? null,
          ariaAtomic: model?.getAttribute('aria-atomic') ?? null,
          ariaLabel: model?.getAttribute('aria-label') ?? null,
          observed: model?.classList.contains('is-observed') ?? false,
          waiting: model?.classList.contains('is-waiting') ?? false,
          whiteSpace: style?.whiteSpace ?? null,
          overflowX: style?.overflowX ?? null,
          textOverflow: style?.textOverflow ?? null,
          fontFamily: style?.fontFamily ?? null,
          clientWidth: code?.clientWidth ?? null,
          scrollWidth: code?.scrollWidth ?? null
        }
      })
      const focusedModelCode = focused?.querySelector('.execution-run-model code')
      focusedModelCode?.focus({ preventScroll: true })
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
        focusedModelKeyboardReachable: Boolean(focusedModelCode && document.activeElement === focusedModelCode),
        modelPresentations,
        drawerHorizontalOverflow: (document.querySelector('.execution-drawer')?.scrollWidth ?? 0)
          > (document.querySelector('.execution-drawer')?.clientWidth ?? 0) + 1,
        runSelectorCount: document.querySelectorAll(
          '.execution-run-list, .execution-run-item, [aria-label="选择 AgentRun"]'
        ).length,
        toolTitles: [...document.querySelectorAll('.execution-drawer .tool-call-title')].map((node) => node.textContent?.trim() ?? ''),
        staticToolTitles: [...document.querySelectorAll('.execution-drawer .tool-call-static .tool-call-title')]
          .map((node) => node.textContent?.trim() ?? ''),
        expandableToolTitles: [...document.querySelectorAll('.execution-drawer details.tool-call-disclosure .tool-call-title')]
          .map((node) => node.textContent?.trim() ?? ''),
        toolStates: [...document.querySelectorAll('.execution-drawer .tool-call-state')].map((node) => ({
          label: node.getAttribute('aria-label') ?? '',
          status: [...node.classList].find((name) => name.startsWith('status-'))?.slice(7) ?? null
        })),
        toolStateAnimations: [...document.querySelectorAll('.execution-drawer .tool-call-state')]
          .map((node) => getComputedStyle(node).animationName),
        toolLayouts,
        toolSourceLabelCount: document.querySelectorAll('.execution-drawer .tool-call-source').length,
        hasVisibleSourceLabel: /Core 已验证|Runtime 报告/.test(
          document.querySelector('.execution-drawer')?.textContent ?? ''
        ),
        body: article?.querySelector('.message-content')?.textContent?.trim()
          ?? article?.querySelector('.safe-markdown')?.textContent?.trim() ?? ''
      }
    })()`))
  }
  return rows
}

async function collectFocusedRuntimeModelLayout(cdp) {
  return evaluate(cdp, `(() => {
    const stage = document.querySelector('.execution-process-stage.is-focused')
    const model = stage?.querySelector('.execution-run-model')
    const code = model?.querySelector('code')
    const drawer = document.querySelector('.execution-drawer')
    const style = code ? getComputedStyle(code) : null
    const toolResult = drawer?.querySelector('.tool-call-result-scroll')
    const toolResultRect = toolResult?.getBoundingClientRect()
    const toolDetailRect = toolResult?.closest('.tool-call-detail')?.getBoundingClientRect()
    code?.focus({ preventScroll: true })
    return {
      runId: stage?.dataset.agentRunId ?? null,
      text: model?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      codeText: code?.textContent?.trim() ?? null,
      defaultBadge: model?.querySelector('small')?.textContent?.trim() ?? null,
      title: code?.getAttribute('title') ?? null,
      tabIndex: code?.tabIndex ?? null,
      role: model?.getAttribute('role') ?? null,
      ariaLive: model?.getAttribute('aria-live') ?? null,
      ariaAtomic: model?.getAttribute('aria-atomic') ?? null,
      observed: model?.classList.contains('is-observed') ?? false,
      waiting: model?.classList.contains('is-waiting') ?? false,
      keyboardReachable: Boolean(code && document.activeElement === code),
      whiteSpace: style?.whiteSpace ?? null,
      overflowX: style?.overflowX ?? null,
      textOverflow: style?.textOverflow ?? null,
      clientWidth: code?.clientWidth ?? null,
      scrollWidth: code?.scrollWidth ?? null,
      toolResult: toolResult ? {
        verticalOverflow: toolResult.scrollHeight > toolResult.clientHeight + 1,
        horizontalOverflow: toolResult.scrollWidth > toolResult.clientWidth + 1,
        width: toolResultRect?.width ?? 0,
        detailWidth: toolDetailRect?.width ?? 0,
        height: toolResultRect?.height ?? 0,
        maxViewportHeight: innerHeight * .3,
        middleMarkerVisible: toolResult.textContent?.includes(${JSON.stringify(longToolOutputMiddleMarker)}) ?? false,
        lastMarkerVisible: toolResult.textContent?.includes(${JSON.stringify(longToolOutputLastMarker)}) ?? false
      } : null,
      drawerHorizontalOverflow: (drawer?.scrollWidth ?? 0) > (drawer?.clientWidth ?? 0) + 1
    }
  })()`)
}

function assertFocusedRuntimeModelLayout(layout, context) {
  const expectedModelId = runtimes.find((entry) => entry.key === 'codex')?.observedModelId
  assert(layout.runId === activeRunId
    && layout.codeText === expectedModelId
    && layout.title === expectedModelId
    && layout.text?.startsWith('模型 ')
    && layout.defaultBadge === '· 默认'
    && layout.tabIndex === 0
    && layout.role === 'status'
    && layout.ariaLive === 'polite'
    && layout.ariaAtomic === 'true'
    && layout.observed
    && !layout.waiting
    && layout.keyboardReachable
    && layout.whiteSpace === 'nowrap'
    && layout.overflowX === 'hidden'
    && layout.textOverflow === 'ellipsis'
    && layout.scrollWidth > layout.clientWidth
    && !layout.drawerHorizontalOverflow,
  `${context} did not preserve the accessible, ellipsized runtime model: ${JSON.stringify(layout)}`)
}

async function verifyResponsiveRuntimeModelLayouts(cdp, capturesDirectory) {
  await evaluate(cdp, `(() => {
    const chip = [...document.querySelectorAll('.run-pulse-chip[data-agent-id]')]
      .find((candidate) => candidate.dataset.agentId === ${JSON.stringify(activeAgentId)})
    chip?.click()
    return Boolean(chip)
  })()`)
  await waitForExpression(cdp,
    `document.querySelector('.execution-process-stage.is-focused')?.dataset.agentRunId === ${JSON.stringify(activeRunId)}`)

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1040, height: 700, deviceScaleFactor: 1, mobile: false,
    screenWidth: 1040, screenHeight: 700
  })
  await waitForExpression(cdp, `innerWidth === 1040 && innerHeight === 700`)
  const compact = await collectFocusedRuntimeModelLayout(cdp)
  assertFocusedRuntimeModelLayout(compact, '1040x700 bottom Drawer')
  const compactCapture = join(capturesDirectory, 'runtime-model-compact-1040x700.png')
  await capture(cdp, compactCapture)

  await evaluate(cdp, `(() => {
    document.querySelector('.topbar-inspector-toggle[aria-pressed="true"]')?.click()
    return true
  })()`)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 520, height: 350, deviceScaleFactor: 2, mobile: false,
    screenWidth: 1040, screenHeight: 700
  })
  await waitForExpression(cdp,
    `innerWidth === 520 && innerHeight === 350 && Math.abs(devicePixelRatio - 2) < 0.01`)
  await waitForExpression(cdp,
    `document.querySelector('.workspace-grid')?.classList.contains('inspector-collapsed')`)
  await focusExecutionDrawerResizeHandle(cdp)
  await pressKey(cdp, 'End', 'End', 35)
  await waitForExpression(cdp, `(() => {
    const handle = document.querySelector('.execution-drawer-resize-handle')
    const drawer = document.querySelector('.execution-drawer')
    const now = Number(handle?.getAttribute('aria-valuenow') ?? 0)
    return now === Number(handle?.getAttribute('aria-valuemax') ?? -1)
      && Math.abs((drawer?.getBoundingClientRect().height ?? 0) - now) <= 1
  })()`)
  await evaluate(cdp, `(() => {
    const body = document.querySelector('.execution-drawer-body')
    const stage = document.querySelector('.execution-process-stage.is-focused')
    if (!(body instanceof HTMLElement) || !(stage instanceof HTMLElement)) return false
    body.scrollTop = Math.max(0, stage.offsetTop - 4)
    return true
  })()`)
  await wait(150)
  const openedLongResultAtZoom = await evaluate(cdp, `(() => {
    const disclosure = [...document.querySelectorAll('.execution-drawer details.tool-call-disclosure')]
      .find((candidate) => candidate.querySelector('.tool-call-title')?.textContent?.trim() === ${JSON.stringify(codexExpectedCommand)})
    if (disclosure && !disclosure.open) disclosure.querySelector(':scope > summary')?.click()
    return Boolean(disclosure)
  })()`)
  assert(openedLongResultAtZoom, '200% zoom could not open the long Tool result')
  await waitForExpression(cdp, `(() => {
    const result = document.querySelector('.execution-drawer .tool-call-result-scroll')
    return result?.textContent?.includes(${JSON.stringify(longToolOutputLastMarker)})
  })()`, 30_000)
  const zoom200 = await collectFocusedRuntimeModelLayout(cdp)
  assertFocusedRuntimeModelLayout(zoom200, '200% zoom bottom Drawer')
  assert(zoom200.toolResult
    && zoom200.toolResult.verticalOverflow
    && !zoom200.toolResult.horizontalOverflow
    && zoom200.toolResult.width <= zoom200.toolResult.detailWidth + 1
    && zoom200.toolResult.height <= zoom200.toolResult.maxViewportHeight + 1
    && zoom200.toolResult.middleMarkerVisible
    && zoom200.toolResult.lastMarkerVisible,
  `200% zoom did not keep the complete Tool result inside its local scroll region: ${JSON.stringify(zoom200)}`)
  const zoom200Capture = join(capturesDirectory, 'runtime-model-zoom-200.png')
  await capture(cdp, zoom200Capture)

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 920, deviceScaleFactor: 1, mobile: false,
    screenWidth: 1440, screenHeight: 920
  })
  await waitForExpression(cdp, `innerWidth === 1440 && innerHeight === 920`)
  await evaluate(cdp, `(() => {
    document.querySelector('.topbar-inspector-toggle[aria-pressed="false"]')?.click()
    return true
  })()`)
  await waitForExpression(cdp,
    `!document.querySelector('.workspace-grid')?.classList.contains('inspector-collapsed')`)
  return {
    compact,
    zoom200,
    captures: { compact: compactCapture, zoom200: zoom200Capture }
  }
}

async function verifyConversationDropZone(cdp, sourceDirectory, capturesDirectory) {
  assert(!await evaluate(cdp, `Boolean(document.querySelector('.execution-drawer'))`),
    'Conversation drop acceptance must begin with the Execution Drawer closed')

  const dayDrag = await beginFileDrag(cdp, sourceDirectory, '.timeline-pane')
  await waitForConversationDropLayerPaint(cdp)
  const dayPresentation = await collectConversationDropPresentation(cdp, sourceDirectory)
  assertConversationDropPresentation(dayPresentation, 'day 1440x920', 308)
  assert([
    '文件夹将保存为只读快照，原文件不会移动',
    '支持文件与文件夹 · 将安全复制到附件队列'
  ].includes(dayPresentation.directoryCopy),
  `The drag affordance did not explain directory support: ${JSON.stringify(dayPresentation)}`)
  const dayDraggingCapture = join(capturesDirectory, 'conversation-drop-zone-day-1440x920.png')
  await capture(cdp, dayDraggingCapture)

  await dispatchFileDrag(cdp, 'drop', dayDrag)
  await waitForExpression(cdp, `(() => {
    const card = [...document.querySelectorAll('.composer-attachment-strip .attachment-card')]
      .find((candidate) => candidate.textContent?.includes('项目资料'))
    return !document.querySelector('.conversation-drop-layer')
      && Boolean(card?.querySelector('.attachment-folder-glyph'))
      && card?.textContent?.includes('3 个文件')
      && card?.textContent?.includes('只读快照')
  })()`, 30_000)
  const draft = await evaluate(cdp,
    `window.rovai.request('camp.composerDraft.get', { campId: ${JSON.stringify(campId)} })`,
    true)
  const directoryAttachment = draft?.attachments?.find((attachment) =>
    attachment.displayName === '项目资料')
  assert(directoryAttachment?.kind === 'directory'
    && directoryAttachment?.fileCount === 3
    && directoryAttachment?.mediaType === 'inode/directory'
    && directoryAttachment?.previewKind === 'none'
    && directoryAttachment?.byteSize > 0,
  `Prepared directory attachment did not preserve its explicit model: ${JSON.stringify(draft)}`)
  const readyCapture = join(capturesDirectory, 'conversation-drop-zone-ready-directory.png')
  await capture(cdp, readyCapture)

  await setTheme(cdp, 'night')
  const nightDrag = await beginFileDrag(cdp, sourceDirectory, '.timeline-pane')
  await waitForConversationDropLayerPaint(cdp)
  const nightPresentation = await collectConversationDropPresentation(cdp, sourceDirectory)
  assertConversationDropPresentation(nightPresentation, 'night 1440x920', 308)
  const nightDraggingCapture = join(capturesDirectory, 'conversation-drop-zone-night-1440x920.png')
  await capture(cdp, nightDraggingCapture)
  await dispatchFileDrag(cdp, 'dragCancel', nightDrag)
  await waitForExpression(cdp, `!document.querySelector('.conversation-drop-layer')`)

  await setTheme(cdp, 'day')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1040,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 1040,
    screenHeight: 700
  })
  await waitForExpression(cdp, `innerWidth === 1040 && innerHeight === 700`)
  const compactDrag = await beginFileDrag(cdp, sourceDirectory, '.timeline-pane')
  await waitForConversationDropLayerPaint(cdp)
  const compactPresentation = await collectConversationDropPresentation(cdp, sourceDirectory)
  assertConversationDropPresentation(compactPresentation, 'day 1040x700', 280)
  const compactDraggingCapture = join(capturesDirectory, 'conversation-drop-zone-day-1040x700.png')
  await capture(cdp, compactDraggingCapture)
  await dispatchFileDrag(cdp, 'dragCancel', compactDrag)
  await waitForExpression(cdp, `!document.querySelector('.conversation-drop-layer')`)

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 920,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 1440,
    screenHeight: 920
  })
  await waitForExpression(cdp, `innerWidth === 1440 && innerHeight === 920`)
  const drawerOpened = await evaluate(cdp, `(() => {
    const trigger = document.querySelector('.run-pulse-chip')
    trigger?.click()
    return Boolean(trigger)
  })()`)
  assert(drawerOpened, 'The Agent execution console was missing from the drop-zone fixture')
  await waitForExpression(cdp, `Boolean(document.querySelector('.execution-drawer'))`)
  const visibleDrawerDrag = await beginFileDrag(cdp, sourceDirectory, '.timeline-pane')
  await waitForConversationDropLayerPaint(cdp)
  const visibleDrawerPresentation = await collectConversationDropPresentation(cdp, sourceDirectory)
  assertConversationDropPresentation(visibleDrawerPresentation, 'open Execution Drawer', 308)
  const visibleDrawerCapture = join(capturesDirectory, 'conversation-drop-zone-open-drawer.png')
  await capture(cdp, visibleDrawerCapture)
  await dispatchFileDrag(cdp, 'dragCancel', visibleDrawerDrag)
  await waitForExpression(cdp, `!document.querySelector('.conversation-drop-layer')`)

  await evaluate(cdp,
    `document.querySelector('.run-pulse-bottom .execution-placement-button')?.click()`)
  await waitForExpression(cdp, `(() => {
    const activeTab = document.querySelector('.activity-tabs > .tabs-list [role="tab"][data-state="active"]')
    return activeTab?.textContent?.includes('执行')
      && document.querySelector('.execution-drawer')?.dataset.placement === 'inspector'
  })()`)
  await mouseClickSelector(cdp, '.activity-tabs > .tabs-list [role="tab"]:nth-child(2)')
  await waitForExpression(cdp, `(() => {
    const activeTab = document.querySelector('.activity-tabs > .tabs-list [role="tab"][data-state="active"]')
    return activeTab?.textContent?.includes('任务')
  })()`)
  const hiddenDrawerDrag = await beginFileDrag(cdp, sourceDirectory, '.timeline-pane')
  await waitForExpression(cdp, `Boolean(document.querySelector('.conversation-drop-layer'))`)
  await dispatchFileDrag(cdp, 'dragCancel', hiddenDrawerDrag)
  await waitForExpression(cdp, `!document.querySelector('.conversation-drop-layer')`)

  const sourcePathLeaked = await evaluate(cdp,
    `document.body.innerText.includes(${JSON.stringify(sourceDirectory)})`)
  assert(!sourcePathLeaked, 'The Renderer exposed the original absolute directory path')

  return {
    verified: {
      fullConversationColumnHitTarget: true,
      inspectorAndMenusUnchanged: true,
      executionConsolePresentAndDrawerAllowsDrop: true,
      hiddenInspectorDrawerDoesNotBlockDrop: true,
      explicitDirectoryReadModel: true,
      directoryPreparedThroughRealElectronDrag: true,
      dayNightAndCompactLayouts: true,
      originalAbsolutePathHidden: true,
      horizontalOverflow: false
    },
    presentation: {
      day: dayPresentation,
      night: nightPresentation,
      compact: compactPresentation,
      visibleDrawer: visibleDrawerPresentation
    },
    attachment: directoryAttachment,
    captures: {
      dayDragging: dayDraggingCapture,
      ready: readyCapture,
      nightDragging: nightDraggingCapture,
      compactDragging: compactDraggingCapture,
      visibleDrawer: visibleDrawerCapture
    }
  }
}

async function beginFileDrag(cdp, sourcePath, selector) {
  const point = await evaluate(cdp, `(() => {
    const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect()
    return rect ? {
      x: Math.round(rect.left + Math.min(rect.width * 0.42, rect.width - 20)),
      y: Math.round(rect.top + Math.min(rect.height * 0.42, rect.height - 20))
    } : null
  })()`)
  assert(point, `Could not resolve drag point for ${selector}`)
  const drag = {
    x: point.x,
    y: point.y,
    data: {
      items: [],
      files: [sourcePath],
      dragOperationsMask: 1
    }
  }
  await dispatchFileDrag(cdp, 'dragEnter', drag)
  await dispatchFileDrag(cdp, 'dragOver', drag)
  return drag
}

async function waitForConversationDropLayerPaint(cdp) {
  await waitForExpression(cdp, `(() => {
    const layer = document.querySelector('.conversation-drop-layer')
    return Boolean(layer) && getComputedStyle(layer).opacity === '1'
  })()`)
}

async function dispatchFileDrag(cdp, type, drag) {
  await cdp.send('Input.dispatchDragEvent', {
    type,
    x: drag.x,
    y: drag.y,
    data: drag.data
  })
}

async function collectConversationDropPresentation(cdp, sourceDirectory) {
  return evaluate(cdp, `(() => {
    const grid = document.querySelector('.workspace-grid')?.getBoundingClientRect()
    const layerElement = document.querySelector('.conversation-drop-layer')
    const layer = layerElement?.getBoundingClientRect()
    const callout = document.querySelector('.conversation-drop-callout')?.getBoundingClientRect()
    const inspector = document.querySelector('.activity-pane')?.getBoundingClientRect()
    const runPulse = document.querySelector('.run-pulse')?.getBoundingClientRect()
    const timeline = document.querySelector('.timeline-pane')?.getBoundingClientRect()
    const composer = document.querySelector('.composer')
    const composerRect = composer?.getBoundingClientRect()
    const composerBox = document.querySelector('.composer-box')?.getBoundingClientRect()
    const destination = document.querySelector('.composer-destination')
    const tabs = [...document.querySelectorAll('.activity-tabs > .tabs-list [role="tab"]')]
      .map((tab) => tab.textContent?.replace(/\\d+/g, '').replace(/\\s+/g, ' ').trim())
    const overlap = (left, right) => Boolean(left && right
      && left.left < right.right && left.right > right.left
      && left.top < right.bottom && left.bottom > right.top)
    return {
      calloutHeading: document.querySelector('.conversation-drop-copy strong')?.textContent?.trim(),
      directoryCopy: document.querySelector('.conversation-drop-copy span')?.textContent?.trim(),
      destination: destination?.textContent?.trim(),
      composerHighlighted: document.querySelector('.composer')?.classList.contains('is-dragging-attachments'),
      oldComposerOverlay: Boolean(document.querySelector('.composer-drop-overlay')),
      runPulseVisible: Boolean(runPulse && runPulse.width > 0 && runPulse.height > 0),
      calloutCoversRunPulse: overlap(callout, runPulse),
      layerSpansTimelineAndComposer: overlap(layer, timeline) && overlap(layer, composerRect),
      layerCoversComposerBox: Boolean(layer && composerBox
        && layer.left <= composerBox.left
        && layer.right >= composerBox.right
        && layer.top <= composerBox.top
        && layer.bottom >= composerBox.bottom),
      layerAboveComposer: Boolean(composer && layerElement
        && Number.parseInt(getComputedStyle(layerElement).zIndex, 10)
        > Number.parseInt(getComputedStyle(composer).zIndex, 10)),
      layerInsideGrid: Boolean(grid && layer
        && layer.left >= grid.left + 6
        && layer.top >= grid.top + 6
        && layer.bottom <= grid.bottom - 6),
      inspectorExcluded: !inspector || Boolean(layer && layer.right <= inspector.left - 5),
      calloutWidth: callout?.width ?? 0,
      tabs,
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      sourcePathVisible: document.body.innerText.includes(${JSON.stringify(sourceDirectory)}),
      layer: layer ? { left: layer.left, right: layer.right, top: layer.top, bottom: layer.bottom } : null,
      inspector: inspector ? { left: inspector.left, right: inspector.right } : null
    }
  })()`)
}

function assertConversationDropPresentation(presentation, context, expectedCalloutWidth) {
  assert(presentation.calloutHeading === '松手添加到当前消息'
    && presentation.destination === '将添加到这条消息'
    && presentation.composerHighlighted
    && !presentation.oldComposerOverlay
    && presentation.runPulseVisible
    && !presentation.calloutCoversRunPulse
    && presentation.layerSpansTimelineAndComposer
    && presentation.layerCoversComposerBox
    && presentation.layerAboveComposer
    && presentation.layerInsideGrid
    && presentation.inspectorExcluded
    && Math.abs(presentation.calloutWidth - expectedCalloutWidth) <= 1
    && JSON.stringify(presentation.tabs) === JSON.stringify(['队员', '任务'])
    && !presentation.documentOverflow
    && !presentation.sourcePathVisible,
  `${context} conversation drop presentation failed: ${JSON.stringify(presentation)}`)
}

async function verifyRecoveryBlockerPresentation(cdp) {
  const opened = await evaluate(cdp, `(() => {
    const chip = [...document.querySelectorAll('.run-pulse-chip[data-agent-id]')]
      .find((candidate) => candidate.dataset.agentId === ${JSON.stringify(recoveryBlockedAgentId)})
    chip?.click()
    return Boolean(chip)
  })()`)
  assert(opened, 'Could not open the Agent process containing the recovery blocker')
  await waitForExpression(cdp, `(() => {
    const stage = document.querySelector(
      '.execution-process-stage[data-agent-run-id="${recoveryBlockedRunId}"]'
    )
    return stage?.classList.contains('status-waiting')
      && stage.querySelector('.execution-run-boundary-state')?.textContent?.trim() === '结果待确认'
  })()`)
  await evaluate(cdp, `(() => {
    const stage = document.querySelector(
      '.execution-process-stage[data-agent-run-id="${recoveryBlockedRunId}"]'
    )
    stage?.scrollIntoView({ block: 'center' })
    const disclosure = stage?.querySelector('details.execution-disclosure')
    if (disclosure && !disclosure.open) disclosure.querySelector('summary')?.click()
    return Boolean(disclosure)
  })()`)
  await waitForExpression(cdp, `Boolean(document.querySelector(
    '.execution-process-stage[data-agent-run-id="${recoveryBlockedRunId}"] .process-recovery-blocker[role="status"]'
  ))`)
  const presentation = await evaluate(cdp, `(() => {
    const stage = document.querySelector(
      '.execution-process-stage[data-agent-run-id="${recoveryBlockedRunId}"]'
    )
    const blocker = stage?.querySelector('.process-recovery-blocker')
    const button = blocker?.querySelector('button')
    const style = blocker ? getComputedStyle(blocker) : null
    return {
      state: stage?.querySelector('.execution-run-boundary-state')?.textContent?.trim() ?? '',
      heading: blocker?.querySelector('strong')?.textContent?.trim() ?? '',
      copy: blocker?.querySelector('p')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      button: button?.textContent?.trim() ?? '',
      buttonDisabled: button?.disabled ?? null,
      spinnerCount: stage?.querySelectorAll('.process-spinner').length ?? -1,
      role: blocker?.getAttribute('role') ?? null,
      borderTopWidth: style?.borderTopWidth ?? null,
      backgroundColor: style?.backgroundColor ?? null,
      drawerSummary: document.querySelector('.execution-drawer-header p')?.textContent?.trim() ?? '',
      dockSummary: document.querySelector('.run-pulse-count')?.textContent?.trim() ?? ''
    }
  })()`)
  assert(presentation.state === '结果待确认'
    && presentation.heading === '无法安全自动恢复'
    && presentation.copy.includes('原请求不会自动重发')
    && presentation.copy.includes('新的后续任务')
    && presentation.button === '结束此运行'
    && presentation.buttonDisabled === false
    && presentation.spinnerCount === 0
    && presentation.role === 'status'
    && presentation.borderTopWidth !== '0px'
    && !presentation.drawerSummary.includes('当前有进行中 AgentRun')
    && presentation.dockSummary.includes('1 位执行中')
    && !presentation.dockSummary.includes('2 位执行中'),
  `Recovery blocker presentation mismatch: ${JSON.stringify(presentation)}`)
  return presentation
}

async function verifyRecoveryBlockerResolution(cdp) {
  const clicked = await evaluate(cdp, `(() => {
    const stage = document.querySelector(
      '.execution-process-stage[data-agent-run-id="${recoveryBlockedRunId}"]'
    )
    const button = stage?.querySelector('.process-recovery-blocker button')
    button?.click()
    return Boolean(button)
  })()`)
  assert(clicked, 'Could not invoke the recovery blocker resolution action')
  await waitForExpression(cdp, `(() => {
    const stage = document.querySelector(
      '.execution-process-stage[data-agent-run-id="${recoveryBlockedRunId}"]'
    )
    return stage?.classList.contains('status-failed')
      && stage.querySelector('.execution-run-boundary-state')?.textContent?.trim() === '失败'
      && !stage.querySelector('.process-recovery-blocker')
  })()`, 30_000)
  const snapshot = await evaluate(cdp,
    `window.rovai.request('camps.snapshot', { campId: ${JSON.stringify(campId)} })`, true)
  const run = snapshot?.agentRuns?.find((candidate) => candidate.id === recoveryBlockedRunId)
  const manifest = snapshot?.contextManifests?.find(
    (candidate) => candidate.agentRunId === recoveryBlockedRunId
  )
  const outcomeEvent = snapshot?.timeline?.find((event) =>
    event.eventType === 'agent_run.accepted_input_outcome_unknown'
      && event.entityId === recoveryBlockedRunId
  )
  const resolution = {
    status: run?.status ?? null,
    waitReason: run?.waitReason ?? null,
    acceptedInputStatus: manifest?.delivery?.status ?? null,
    outcomeEventRecorded: Boolean(outcomeEvent),
    toastVisible: await evaluate(cdp,
      `document.body.innerText.includes('已按“结果未知”结束运行；原请求没有重发')`)
  }
  assert(resolution.status === 'failed'
    && resolution.waitReason === null
    && resolution.acceptedInputStatus === 'accepted'
    && resolution.outcomeEventRecorded
    && resolution.toastVisible,
  `Recovery blocker resolution mismatch: ${JSON.stringify(resolution)}`)
  return resolution
}

async function verifyCompleteToolOutput(cdp) {
  const opened = await evaluate(cdp, `(() => {
    const disclosure = [...document.querySelectorAll('.execution-drawer details.tool-call-disclosure')]
      .find((candidate) => candidate.querySelector('.tool-call-title')?.textContent?.trim() === ${JSON.stringify(codexExpectedCommand)})
    const beforeText = disclosure?.querySelector('.tool-call-detail')?.textContent ?? ''
    if (disclosure && !disclosure.open) disclosure.querySelector('summary')?.click()
    return {
      found: Boolean(disclosure),
      fullResultAbsentBeforeExpansion: !beforeText.includes(${JSON.stringify(longToolOutputMiddleMarker)})
        && !beforeText.includes(${JSON.stringify(longToolOutputLastMarker)})
    }
  })()`)
  assert(opened.found && opened.fullResultAbsentBeforeExpansion,
    `Long Tool output was missing or loaded before expansion: ${JSON.stringify(opened)}`)
  await waitForExpression(cdp, `(() => {
    const result = document.querySelector('.execution-drawer .tool-call-result-scroll')
    const text = result?.textContent ?? ''
    return text.includes(${JSON.stringify(longToolOutputMiddleMarker)})
      && text.includes(${JSON.stringify(longToolOutputLastMarker)})
  })()`, 30_000)

  const presentation = await evaluate(cdp, `(() => {
    const detail = document.querySelector('.execution-drawer .tool-call-detail')
    const result = detail?.querySelector('.tool-call-result-scroll')
    const disclosure = detail?.closest('details.tool-call-disclosure')
    const summary = disclosure?.querySelector(':scope > summary')
    const style = result ? getComputedStyle(result) : null
    const rect = result?.getBoundingClientRect()
    const text = result?.textContent ?? ''
    return {
      lineCount: text.split('\\n').length,
      verticalOverflow: result ? result.scrollHeight > result.clientHeight + 1 : null,
      hasFirstMarker: text.includes(${JSON.stringify(longToolOutputFirstMarker)}),
      hasMiddleMarker: text.includes(${JSON.stringify(longToolOutputMiddleMarker)}),
      hasLastMarker: text.includes(${JSON.stringify(longToolOutputLastMarker)}),
      startsWithCommandAndOutputSections: text.startsWith(${JSON.stringify(`命令\n${codexExpectedCommand}\n\n输出\n${longToolOutputFirstMarker}`)}),
      endsWithPublicOutput: text.endsWith(${JSON.stringify(`${longToolOutputLastMarker} · line 8432`)}),
      hasCutNotice: text.includes('…（后续内容未显示）'),
      leakedEnvelope: text.startsWith('{') || text.includes('"_rovaiTruncated"'),
      copyButtonCount: detail?.querySelectorAll('.tool-output-copy-button').length ?? 0,
      legacyCompleteControlCount: detail?.parentElement?.querySelectorAll('.complete-evidence-control').length ?? 0,
      role: result?.getAttribute('role') ?? null,
      tabIndex: result?.tabIndex ?? null,
      ariaLabel: result?.getAttribute('aria-label') ?? null,
      summaryAriaLabel: summary?.getAttribute('aria-label') ?? null,
      resultHeight: rect?.height ?? 0,
      overscrollBehavior: style?.overscrollBehavior ?? null,
      scrollbarGutter: style?.scrollbarGutter ?? null,
      whiteSpace: style?.whiteSpace ?? null,
      overflowWrap: style?.overflowWrap ?? null
    }
  })()`)
  assert(presentation.hasFirstMarker
    && presentation.hasMiddleMarker
    && presentation.hasLastMarker
    && presentation.startsWithCommandAndOutputSections
    && presentation.endsWithPublicOutput
    && presentation.lineCount === 8_436
    && presentation.verticalOverflow
    && !presentation.hasCutNotice
    && !presentation.leakedEnvelope,
  `Long Tool output was not rendered as one complete public result: ${JSON.stringify(presentation)}`)
  assert(presentation.copyButtonCount === 0
    && presentation.legacyCompleteControlCount === 0
    && presentation.role === 'region'
    && presentation.tabIndex === 0
    && presentation.ariaLabel?.includes('完整结果')
    && presentation.summaryAriaLabel === null
    && presentation.resultHeight <= 221
    && presentation.overscrollBehavior === 'contain'
    && presentation.scrollbarGutter?.includes('stable')
    && presentation.whiteSpace === 'pre-wrap'
    && presentation.overflowWrap === 'anywhere',
  `Complete Tool result accessibility or bounded-scroll contract failed: ${JSON.stringify(presentation)}`)

  await evaluate(cdp, `document.querySelector('.execution-drawer .tool-call-result-scroll')?.focus()`)
  await pressKey(cdp, 'End', 'End', 35)
  await waitForExpression(cdp, `(() => {
    const result = document.querySelector('.execution-drawer .tool-call-result-scroll')
    return result && Math.abs(result.scrollHeight - result.clientHeight - result.scrollTop) <= 1
  })()`)
  await pressKey(cdp, 'Home', 'Home', 36)
  await waitForExpression(cdp,
    `document.querySelector('.execution-drawer .tool-call-result-scroll')?.scrollTop === 0`)
  await pressKey(cdp, 'ArrowDown', 'ArrowDown', 40)
  await waitForExpression(cdp,
    `document.querySelector('.execution-drawer .tool-call-result-scroll')?.scrollTop > 0`)
  await pressKey(cdp, 'Home', 'Home', 36)
  await pressKey(cdp, ' ', 'Space', 32)
  await waitForExpression(cdp,
    `document.querySelector('.execution-drawer .tool-call-result-scroll')?.scrollTop > 0`)
  await pressKey(cdp, 'Home', 'Home', 36)
  await pressKey(cdp, 'PageDown', 'PageDown', 34)
  await waitForExpression(cdp,
    `document.querySelector('.execution-drawer .tool-call-result-scroll')?.scrollTop > 0`)
  await pressKey(cdp, 'Escape', 'Escape', 27)
  const keyboard = await evaluate(cdp, `(() => {
    const disclosure = document.activeElement?.closest('details.tool-call-disclosure')
    return {
      summaryFocused: document.activeElement === disclosure?.querySelector(':scope > summary'),
      disclosureOpen: disclosure?.open ?? false,
      drawerPresent: Boolean(document.querySelector('.execution-drawer'))
    }
  })()`)
  assert(keyboard.summaryFocused && keyboard.disclosureOpen && keyboard.drawerPresent,
    `Complete Tool result keyboard navigation failed: ${JSON.stringify(keyboard)}`)

  const readingStart = await evaluate(cdp, `(() => {
    const drawer = document.querySelector('.execution-drawer')
    const body = drawer?.querySelector('.execution-drawer-body')
    const result = drawer?.querySelector('.tool-call-result-scroll')
    const ratio = (element) => {
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
      return maximum > 0 ? element.scrollTop / maximum : 0
    }
    body.scrollTop = Math.round(Math.max(0, body.scrollHeight - body.clientHeight) * .37)
    body.dispatchEvent(new Event('scroll', { bubbles: true }))
    result.scrollTop = Math.round(Math.max(0, result.scrollHeight - result.clientHeight) * .53)
    window.__rovaiExecutionDrawerIdentity = drawer
    window.__rovaiToolResultIdentity = result
    return {
      outerRatio: ratio(body),
      resultRatio: ratio(result),
      disclosureOpen: result.closest('details.tool-call-disclosure')?.open ?? false
    }
  })()`)
  await waitForExpression(cdp,
    `document.querySelector('.execution-drawer-body')?.dataset.followingLatest === 'false'`)
  await evaluate(cdp,
    `document.querySelector('.run-pulse-bottom .execution-placement-button')?.click()`)
  const inspectorReadingRestored = `(() => {
    const drawer = document.querySelector('.execution-drawer')
    const body = drawer?.querySelector('.execution-drawer-body')
    const result = drawer?.querySelector('.tool-call-result-scroll')
    const ratio = (element) => {
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
      return maximum > 0 ? element.scrollTop / maximum : 0
    }
    return drawer?.dataset.placement === 'inspector'
      && drawer === window.__rovaiExecutionDrawerIdentity
      && result === window.__rovaiToolResultIdentity
      && result?.closest('details.tool-call-disclosure')?.open
      && (body.scrollHeight - body.clientHeight <= 1
        || Math.abs(ratio(body) - ${JSON.stringify(readingStart.outerRatio)}) <= .03)
      && Math.abs(ratio(result) - ${JSON.stringify(readingStart.resultRatio)}) <= .03
  })()`
  try {
    await waitForExpression(cdp, inspectorReadingRestored)
  } catch (error) {
    const state = await evaluate(cdp, `(() => {
      const drawer = document.querySelector('.execution-drawer')
      const body = drawer?.querySelector('.execution-drawer-body')
      const result = drawer?.querySelector('.tool-call-result-scroll')
      const reading = (element) => {
        const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
        return {
          ratio: maximum > 0 ? element.scrollTop / maximum : 0,
          scrollTop: element.scrollTop,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight
        }
      }
      return {
        placement: drawer?.dataset.placement ?? null,
        sameDrawer: drawer === window.__rovaiExecutionDrawerIdentity,
        sameResult: result === window.__rovaiToolResultIdentity,
        open: result?.closest('details.tool-call-disclosure')?.open ?? false,
        outer: body ? reading(body) : null,
        result: result ? reading(result) : null
      }
    })()`)
    throw new Error(`Inspector reading position was not restored: ${JSON.stringify({ readingStart, state })}`, {
      cause: error
    })
  }
  const inspectorReading = await evaluate(cdp, `(() => {
    const drawer = document.querySelector('.execution-drawer')
    const body = drawer?.querySelector('.execution-drawer-body')
    const result = drawer?.querySelector('.tool-call-result-scroll')
    const ratio = (element) => {
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
      return maximum > 0 ? element.scrollTop / maximum : 0
    }
    return {
      sameDrawer: drawer === window.__rovaiExecutionDrawerIdentity,
      sameResult: result === window.__rovaiToolResultIdentity,
      outerRatio: ratio(body),
      resultRatio: ratio(result),
      open: result?.closest('details.tool-call-disclosure')?.open ?? false
    }
  })()`)
  await evaluate(cdp,
    `document.querySelector('.run-pulse-inspector .execution-placement-button')?.click()`)
  const bottomReadingRestored = `(() => {
    const drawer = document.querySelector('.execution-drawer')
    const body = drawer?.querySelector('.execution-drawer-body')
    const result = drawer?.querySelector('.tool-call-result-scroll')
    const ratio = (element) => {
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
      return maximum > 0 ? element.scrollTop / maximum : 0
    }
    return drawer?.dataset.placement === 'bottom'
      && drawer === window.__rovaiExecutionDrawerIdentity
      && result === window.__rovaiToolResultIdentity
      && result?.closest('details.tool-call-disclosure')?.open
      && Math.abs(ratio(body) - ${JSON.stringify(readingStart.outerRatio)}) <= .03
      && Math.abs(ratio(result) - ${JSON.stringify(readingStart.resultRatio)}) <= .03
  })()`
  try {
    await waitForExpression(cdp, bottomReadingRestored)
  } catch (error) {
    const state = await evaluate(cdp, `(() => {
      const drawer = document.querySelector('.execution-drawer')
      const body = drawer?.querySelector('.execution-drawer-body')
      const result = drawer?.querySelector('.tool-call-result-scroll')
      const reading = (element) => {
        const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
        return {
          ratio: maximum > 0 ? element.scrollTop / maximum : 0,
          scrollTop: element.scrollTop,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight
        }
      }
      return {
        placement: drawer?.dataset.placement ?? null,
        sameDrawer: drawer === window.__rovaiExecutionDrawerIdentity,
        sameResult: result === window.__rovaiToolResultIdentity,
        open: result?.closest('details.tool-call-disclosure')?.open ?? false,
        outer: body ? reading(body) : null,
        result: result ? reading(result) : null
      }
    })()`)
    throw new Error(`Bottom reading position was not restored: ${JSON.stringify({
      readingStart,
      inspectorReading,
      state
    })}`, { cause: error })
  }
  const bottomReading = await evaluate(cdp, `(() => {
    const drawer = document.querySelector('.execution-drawer')
    const body = drawer?.querySelector('.execution-drawer-body')
    const result = drawer?.querySelector('.tool-call-result-scroll')
    const ratio = (element) => {
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
      return maximum > 0 ? element.scrollTop / maximum : 0
    }
    const value = {
      sameDrawer: drawer === window.__rovaiExecutionDrawerIdentity,
      sameResult: result === window.__rovaiToolResultIdentity,
      outerRatio: ratio(body),
      resultRatio: ratio(result),
      open: result?.closest('details.tool-call-disclosure')?.open ?? false
    }
    delete window.__rovaiExecutionDrawerIdentity
    delete window.__rovaiToolResultIdentity
    return value
  })()`)
  assert(readingStart.disclosureOpen
    && inspectorReading.sameDrawer
    && inspectorReading.sameResult
    && inspectorReading.open
    && bottomReading.sameDrawer
    && bottomReading.sameResult
    && bottomReading.open,
  `Execution console placement did not preserve DOM identity and reading state: ${JSON.stringify({
    readingStart,
    inspectorReading,
    bottomReading
  })}`)

  return { ...presentation, keyboard, readingStart, inspectorReading, bottomReading }
}

async function verifyClaudeCommandDisclosure(cdp) {
  const claudeAgentId = runtimes.find((entry) => entry.key === 'claude').agentId
  const opened = await evaluate(cdp, `(() => {
    const chip = [...document.querySelectorAll('.run-pulse-chip[data-agent-id]')]
      .find((candidate) => candidate.dataset.agentId === ${JSON.stringify(claudeAgentId)})
    chip?.click()
    return Boolean(chip)
  })()`)
  assert(opened, 'Could not select the Claude Runtime process entry')
  await waitForExpression(cdp, `(() => {
    const selected = document.querySelector('.run-pulse-chip.is-selected')
    return selected?.dataset.agentId === ${JSON.stringify(claudeAgentId)}
  })()`)
  await evaluate(cdp, `(() => {
    document.querySelectorAll('.execution-drawer details.execution-disclosure:not([open]) > summary')
      .forEach((summary) => summary.click())
    return true
  })()`)
  await waitForExpression(cdp, `(() => [...document.querySelectorAll(
    '.execution-drawer details.tool-call-disclosure .tool-call-title'
  )].some((candidate) => candidate.textContent?.trim() === 'printf'))()`)
  const presentation = await evaluate(cdp, `(() => {
    const disclosure = [...document.querySelectorAll('.execution-drawer details.tool-call-disclosure')]
      .find((candidate) => candidate.querySelector('.tool-call-title')?.textContent?.trim() === 'printf')
    disclosure?.querySelector('summary')?.click()
    return {
      found: Boolean(disclosure),
      open: disclosure?.open ?? false,
      detail: disclosure?.querySelector('.tool-call-detail pre')?.textContent ?? '',
      staticCount: document.querySelectorAll('.execution-drawer .tool-call-static .tool-call-title').length
    }
  })()`)
  assert(presentation.found
    && presentation.open
    && presentation.detail.includes('ROVAI_CLAUDE_EMPTY_OUTPUT_OK')
    && presentation.staticCount === 0,
  `Claude Bash command without output was not expandable: ${JSON.stringify(presentation)}`)
  return presentation
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

  await evaluate(cdp, `document.querySelector('.execution-drawer-header [aria-label="收起执行详情"]')?.click()`)
  await waitForExpression(cdp, `!document.querySelector('.execution-drawer')`)
  await evaluate(cdp, `(() => {
    const chip = [...document.querySelectorAll('.run-pulse-chip[data-agent-id]')]
      .find((candidate) => candidate.dataset.agentId === ${JSON.stringify(activeAgentId)})
    chip?.click()
    return Boolean(chip)
  })()`)
  await waitForExpression(cdp, `(() => {
    const drawer = document.querySelector('.execution-drawer')
    const handle = drawer?.querySelector('.execution-drawer-resize-handle')
    const stored = Number(sessionStorage.getItem('rovai.execution-drawer-height.v1'))
    return Boolean(handle)
      && drawer?.dataset.userSized === 'true'
      && Number.isFinite(stored)
      && Math.abs((drawer?.getBoundingClientRect().height ?? 0) - stored) <= 1
      && Number(handle?.getAttribute('aria-valuenow')) === stored
  })()`)
  const reopened = await geometry()
  assert(reopened
    && Math.abs(reopened.height - keyboardSized.height) <= 1
    && reopened.storedHeight === keyboardSized.storedHeight
    && reopened.selectedAgentId === activeAgentId
    && reopened.focusedRunId === activeRunId,
  `Execution Drawer height did not survive close and reopen: ${JSON.stringify({ keyboardSized, reopened })}`)

  await focusExecutionDrawerResizeHandle(cdp)
  await pressKey(cdp, ' ', 'Space', 32)
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

async function verifyDirectAgentRunStop(cdp) {
  await waitForExpression(cdp,
    `document.querySelectorAll('.execution-drawer [aria-label="停止当前运行"]').length === 1`)
  const before = await evaluate(cdp, `(() => ({
    stopButtonCount: document.querySelectorAll('.execution-drawer [aria-label="停止当前运行"]').length,
    confirmationDialogCount: document.querySelectorAll('.agent-run-stop-dialog').length,
    overlayCount: document.querySelectorAll('.dialog-overlay').length,
    hasLegacyConfirmationCopy: document.body.innerText.includes('停止此运行？')
      || document.body.innerText.includes('继续运行')
  }))()`)
  assert(before.stopButtonCount === 1
    && before.confirmationDialogCount === 0
    && before.overlayCount === 0
    && !before.hasLegacyConfirmationCopy,
  `AgentRun Stop still exposed confirmation UI before submission: ${JSON.stringify(before)}`)

  const clicked = await evaluate(cdp, `(() => {
    const button = document.querySelector('.execution-drawer [aria-label="停止当前运行"]')
    button?.click()
    return Boolean(button)
  })()`)
  assert(clicked, 'Could not submit AgentRun Stop from the Execution Drawer')
  await waitForExpression(cdp, `(() => {
    const state = document.querySelector('.execution-run-stop-state[role="status"]')?.textContent?.trim()
    return ['正在停止…', '正在确认停止状态', '已停止'].includes(state ?? '')
      && !document.querySelector('.execution-drawer [aria-label="停止当前运行"]')
      && !document.querySelector('.agent-run-stop-dialog')
      && !document.querySelector('.dialog-overlay')
  })()`, 10_000)
  const after = await evaluate(cdp, `(() => ({
    state: document.querySelector('.execution-run-stop-state[role="status"]')?.textContent?.trim() ?? null,
    stopButtonCount: document.querySelectorAll('.execution-drawer [aria-label="停止当前运行"]').length,
    confirmationDialogCount: document.querySelectorAll('.agent-run-stop-dialog').length,
    overlayCount: document.querySelectorAll('.dialog-overlay').length,
    hasLegacyConfirmationCopy: document.body.innerText.includes('停止此运行？')
      || document.body.innerText.includes('继续运行')
  }))()`)
  assert(after.stopButtonCount === 0
    && after.confirmationDialogCount === 0
    && after.overlayCount === 0
    && !after.hasLegacyConfirmationCopy,
  `AgentRun Stop did not remain a single direct action: ${JSON.stringify(after)}`)
  return { before, after }
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
    assert(row.drawerHorizontalOverflow === false,
      `${expected.runtimeName} model metadata overflowed the Drawer: ${JSON.stringify(row)}`)
    const currentModel = row.modelPresentations.find((entry) => entry.runId === `run-${expected.key}`)
    assert(currentModel,
      `${expected.runtimeName} current AgentRun model state was missing: ${JSON.stringify(row)}`)
    if (expected.modelSelectionSource === 'explicit') {
      assert(currentModel.count === 0,
        `${expected.runtimeName} fixed-model Run exposed runtime-default metadata: ${JSON.stringify(row)}`)
    } else {
      const displayedModelId = expected.observedModelId ?? 'Agent 运行时默认'
      assert(currentModel.count === 1
        && currentModel.codeText === displayedModelId
        && currentModel.title === displayedModelId
        && currentModel.tabIndex === 0
        && currentModel.role === 'status'
        && currentModel.ariaLive === 'polite'
        && currentModel.ariaAtomic === 'true'
        && (expected.observedModelId
          ? currentModel.ariaLabel?.includes(displayedModelId)
          : currentModel.ariaLabel?.includes('实际模型尚未由 Agent 运行时报告'))
        && currentModel.whiteSpace === 'nowrap'
        && currentModel.overflowX === 'hidden'
        && currentModel.textOverflow === 'ellipsis'
        && /mono/i.test(currentModel.fontFamily ?? '')
        && row.focusedModelKeyboardReachable,
      `${expected.runtimeName} runtime-default model metadata contract failed: ${JSON.stringify(row)}`)
      if (expected.observedModelId) {
        assert(currentModel.observed
          && !currentModel.waiting
          && currentModel.text?.startsWith('模型 ')
          && currentModel.defaultBadge === '· 默认',
        `${expected.runtimeName} observed model was not rendered as the default-policy model: ${JSON.stringify(row)}`)
      } else {
        assert(currentModel.waiting
          && !currentModel.observed
          && currentModel.defaultBadge === null,
        `${expected.runtimeName} missing observation did not retain the fallback label: ${JSON.stringify(row)}`)
      }
    }
    if (expected.agentId !== activeAgentId) {
      assert(row.runCount === 1 && row.focusedRunId === row.runIds[0],
        `${expected.runtimeName} historical execution could not be reopened: ${JSON.stringify(row)}`)
      if (expected.expectedToolName !== null) {
        assert(row.focusedEvidenceOpen,
          `${expected.runtimeName} historical evidence could not be expanded: ${JSON.stringify(row)}`)
      }
    }
    if (expected.agentId === activeAgentId) {
      const historicalModel = row.modelPresentations.find((entry) => entry.runId === historicalRunId)
      assert(historicalModel?.count === 0,
        `Codex fixed-model historical Run exposed runtime-default metadata: ${JSON.stringify(row)}`)
      assert(currentModel.scrollWidth > currentModel.clientWidth,
        `Long Codex model id did not exercise single-line ellipsis: ${JSON.stringify(row)}`)
    }
    if (expected.expectedToolName === null) {
      assert(row.toolTitles.length === 0,
        `${expected.runtimeName} invented an unreported tool: ${JSON.stringify(row)}`)
      continue
    }
    assert(row.toolTitles.length === 1 && row.toolTitles[0] === expected.expectedToolName,
      `${expected.runtimeName} tool title mismatch: ${JSON.stringify(row)}`)
    assert(row.toolLayouts.length === 1
      && row.toolLayouts.every((layout) => layout.display === 'grid'
        && layout.childCount === 4
        && Math.abs(layout.iconWidth - 16) <= .5
        && Math.abs(layout.iconSvgWidth - 16) <= .5
        && Math.abs(layout.iconSvgHeight - 16) <= .5
        && Math.abs(layout.stateWidth - 16) <= .5
        && Math.abs(layout.disclosureWidth - 20) <= .5
        && layout.statusLabel
        && layout.summaryAriaLabel === null),
    `${expected.runtimeName} Tool row did not keep four fixed tracks and a 16px SVG: ${JSON.stringify(row)}`)
    if (expected.cancelledWithInProgressActivity) {
      assert(row.focusedStatus === 'cancelled'
        && row.toolStates.length === 1
        && row.toolStates[0].label === '已停止'
        && row.toolStates[0].status === 'stopped'
        && row.toolStateAnimations.length === 1
        && row.toolStateAnimations[0] === 'none',
      `${expected.runtimeName} cancelled Run did not stop its in-progress activity presentation: ${JSON.stringify(row)}`)
    } else {
      assert(row.toolStates.length === 1
        && row.toolStates[0].label === '成功'
        && row.toolStates[0].status === 'completed',
      `${expected.runtimeName} terminal Tool state was not a concise accessible success marker: ${JSON.stringify(row)}`)
    }
    if (!expected.expectedToolDisclosure) {
      assert(row.staticToolTitles.length === 1
        && row.staticToolTitles[0] === expected.expectedToolName
        && row.expandableToolTitles.length === 0,
      `${expected.runtimeName} exposed a Tool disclosure without a public result: ${JSON.stringify(row)}`)
      assert(row.toolLayouts[0]?.disclosurePlaceholder,
        `${expected.runtimeName} static Tool row did not retain the disclosure track: ${JSON.stringify(row)}`)
    } else {
      assert(!row.toolLayouts[0]?.disclosurePlaceholder,
        `${expected.runtimeName} expandable Tool row lost its disclosure control: ${JSON.stringify(row)}`)
    }
    assert(row.toolSourceLabelCount === 0 && row.hasVisibleSourceLabel === false,
      `${expected.runtimeName} exposed a redundant source label: ${JSON.stringify(row)}`)
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

async function selectCampConversationView(cdp, view) {
  const label = view === 'world' ? '地图' : '会话'
  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.camp-conversation-view-controls button')]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
    button?.click()
    return Boolean(button)
  })()`)
  assert(clicked, `Camp conversation view button was missing: ${label}`)
  await waitForExpression(cdp, `(() => {
    const button = [...document.querySelectorAll('.camp-conversation-view-controls button')]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
    return button?.getAttribute('aria-pressed') === 'true'
  })()`)
}

async function verifyCampWorldMap(cdp, capturesDirectory) {
  await selectCampConversationView(cdp, 'world')
  await waitForExpression(cdp,
    `document.querySelector('.camp-world-map-panel:not([hidden]) .camp-world-map-image')?.complete === true`)
  const focusedConversationButton = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.camp-conversation-view-controls button')]
      .find((candidate) => candidate.textContent?.trim() === '会话')
    button?.focus()
    return document.activeElement === button
  })()`)
  assert(focusedConversationButton, 'Camp conversation view switch could not receive keyboard focus')
  await pressKey(cdp, ' ', 'Space', 32)
  await waitForExpression(cdp, `(() => {
    const button = [...document.querySelectorAll('.camp-conversation-view-controls button')]
      .find((candidate) => candidate.textContent?.trim() === '会话')
    return button?.getAttribute('aria-pressed') === 'true'
      && document.querySelector('.camp-world-map-panel')?.hasAttribute('hidden') === true
  })()`)
  const focusedWorldButton = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.camp-conversation-view-controls button')]
      .find((candidate) => candidate.textContent?.trim() === '地图')
    button?.focus()
    return document.activeElement === button
  })()`)
  assert(focusedWorldButton, 'Camp world map view switch could not receive keyboard focus')
  await selectCampConversationView(cdp, 'world')
  const staticPresentation = await evaluate(cdp, `(() => {
    const stage = document.querySelector('.camp-conversation-stage')
    const map = document.querySelector('.camp-world-map')
    const frame = document.querySelector('.camp-world-map-frame')
    const controls = document.querySelector('.camp-conversation-view-controls')
    const routeToggle = document.querySelector('.camp-world-map-route-toggle')
    const image = document.querySelector('.camp-world-map-image')
    const stageBounds = stage?.getBoundingClientRect()
    const frameBounds = frame?.getBoundingClientRect()
    const controlsBounds = controls?.getBoundingClientRect()
    return {
      agentCount: document.querySelectorAll('.camp-world-map-agent').length,
      realSpeechCount: document.querySelectorAll('.camp-world-map-speech.is-real').length,
      ambientSpeechCount: document.querySelectorAll('.camp-world-map-speech.is-ambient').length,
      isStatic: map?.classList.contains('is-static') ?? false,
      routesPressed: routeToggle?.getAttribute('aria-pressed') ?? null,
      routeCount: document.querySelectorAll('.camp-world-map-route').length,
      imageWidth: image?.naturalWidth ?? 0,
      imageHeight: image?.naturalHeight ?? 0,
      stageWidth: stageBounds?.width ?? 0,
      stageHeight: stageBounds?.height ?? 0,
      frameWidth: frameBounds?.width ?? 0,
      frameHeight: frameBounds?.height ?? 0,
      controlsWidth: controlsBounds?.width ?? 0,
      controlsInsideStage: Boolean(stageBounds && controlsBounds
        && controlsBounds.top >= stageBounds.top
        && controlsBounds.right <= stageBounds.right + 1),
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      realSpeechText: document.querySelector('.camp-world-map-speech.is-real')?.textContent?.trim() ?? ''
    }
  })()`)
  assert(staticPresentation.agentCount === worldMapVisibleRuntimeCount
    && staticPresentation.realSpeechCount === 1
    && staticPresentation.isStatic
    && staticPresentation.routesPressed === 'false'
    && staticPresentation.routeCount === 15
    && staticPresentation.imageWidth === 2560
    && staticPresentation.imageHeight === 1440,
  `Static world map did not preserve real members, output and the 2K asset: ${JSON.stringify(staticPresentation)}`)
  assert(staticPresentation.stageWidth > 0
    && staticPresentation.stageHeight > 0
    && staticPresentation.frameWidth <= staticPresentation.stageWidth + 1
    && staticPresentation.frameHeight <= staticPresentation.stageHeight + 1
    && staticPresentation.controlsWidth <= 180
    && staticPresentation.controlsInsideStage
    && staticPresentation.documentOverflow <= 1,
  `World map or floating controls escaped the conversation surface: ${JSON.stringify(staticPresentation)}`)
  assert(staticPresentation.realSpeechText.includes('执行 · 正在运行')
    && staticPresentation.realSpeechText.includes('rovai camp read'),
  `World map did not use the real AgentRun activity summary: ${JSON.stringify(staticPresentation)}`)

  const routeToggleClicked = await evaluate(cdp, `(() => {
    const toggle = document.querySelector('.camp-world-map-route-toggle')
    toggle?.click()
    return Boolean(toggle)
  })()`)
  assert(routeToggleClicked, 'World map route toggle was not available')
  await waitForExpression(cdp,
    `document.querySelector('.camp-world-map-route-toggle')?.getAttribute('aria-pressed') === 'true'`)
  const visibleRoutes = await evaluate(cdp, `(() => {
    const routes = [...document.querySelectorAll('.camp-world-map-route')]
    return routes.filter((route) => Number(getComputedStyle(route).opacity) > 0).length
  })()`)
  assert(visibleRoutes === 15, `Route toggle did not reveal all fixed routes: ${visibleRoutes}`)
  const staticDayCapture = join(capturesDirectory, 'camp-world-map-static-day-1440x920.png')
  await capture(cdp, staticDayCapture)

  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
  })
  await waitForExpression(cdp, `!document.querySelector('.camp-world-map')?.classList.contains('is-static')`)
  await waitForExpression(cdp,
    `document.querySelector('.camp-world-map')?.dataset.ambientKind !== 'none'`, 14_000)
  const livePresentation = await evaluate(cdp, `(() => ({
    ambientKind: document.querySelector('.camp-world-map')?.dataset.ambientKind ?? null,
    realSpeechCount: document.querySelectorAll('.camp-world-map-speech.is-real').length,
    ambientBubbleCount: document.querySelectorAll(
      '.camp-world-map-speech.is-ambient, .camp-world-map-ambient-encounter'
    ).length
  }))()`)
  assert(livePresentation.ambientKind !== 'none'
    && livePresentation.realSpeechCount === 1
    && livePresentation.ambientBubbleCount === 1,
  `Real and unrelated ambient world map speech did not coexist: ${JSON.stringify(livePresentation)}`)
  const liveDayCapture = join(capturesDirectory, 'camp-world-map-live-day-1440x920.png')
  await capture(cdp, liveDayCapture)

  await evaluate(cdp, `window.dispatchEvent(new Event('blur'))`)
  await waitForExpression(cdp, `(() => {
    const map = document.querySelector('.camp-world-map')
    return map?.getAttribute('data-motion-state') === 'paused'
      && map.classList.contains('is-static')
      && !document.querySelector('.camp-world-map-speech.is-ambient')
  })()`)
  const inactiveWindowPresentation = await evaluate(cdp, `(async () => {
    const readPositions = () => [...document.querySelectorAll('.camp-world-map-agent')]
      .map((agent) => [agent.style.left, agent.style.top])
    const positionsBefore = readPositions()
    await new Promise((resolve) => setTimeout(resolve, 450))
    const positionsAfter = readPositions()
    const realSpeech = document.querySelector('.camp-world-map-speech.is-real')
    const runningButton = document.querySelector(
      '.camp-world-map-agent[data-mode="running"] .camp-world-map-agent-button'
    )
    return {
      positionsStable: JSON.stringify(positionsBefore) === JSON.stringify(positionsAfter),
      routeAnimationNames: [...document.querySelectorAll('.camp-world-map-route')]
        .map((route) => getComputedStyle(route).animationName),
      runningPulseAnimationName: runningButton
        ? getComputedStyle(runningButton, '::before').animationName
        : null,
      realSpeechAnimationName: realSpeech ? getComputedStyle(realSpeech).animationName : null,
      realSpeechText: realSpeech?.textContent?.trim() ?? ''
    }
  })()`, true)
  assert(inactiveWindowPresentation.positionsStable
    && inactiveWindowPresentation.routeAnimationNames.every((name) => name === 'none')
    && inactiveWindowPresentation.runningPulseAnimationName === 'none'
    && inactiveWindowPresentation.realSpeechAnimationName === 'none'
    && inactiveWindowPresentation.realSpeechText.includes('执行 · 正在运行'),
  `Inactive App window did not pause map motion while preserving real output: ${JSON.stringify(inactiveWindowPresentation)}`)
  await evaluate(cdp, `window.dispatchEvent(new Event('focus'))`)
  await waitForExpression(cdp,
    `document.querySelector('.camp-world-map')?.getAttribute('data-motion-state') === 'active'`)

  await setTheme(cdp, 'night')
  const nightCapture = join(capturesDirectory, 'camp-world-map-live-night-1440x920.png')
  await capture(cdp, nightCapture)

  const opened = await evaluate(cdp, `(() => {
    const trigger = document.querySelector('.camp-world-map-agent[data-mode="running"] .camp-world-map-agent-button')
    trigger?.click()
    return Boolean(trigger)
  })()`)
  assert(opened, 'The running map member did not expose the existing execution Drawer')
  await waitForExpression(cdp, `Boolean(document.querySelector('.execution-drawer-resize-handle'))`)
  await focusExecutionDrawerResizeHandle(cdp)
  await pressKey(cdp, 'End', 'End', 35)
  await waitForExpression(cdp, `(() => {
    const handle = document.querySelector('.execution-drawer-resize-handle')
    return handle?.getAttribute('aria-valuenow') === handle?.getAttribute('aria-valuemax')
  })()`)
  await waitForExpression(cdp, `(() => {
    const stage = document.querySelector('.camp-conversation-stage')?.getBoundingClientRect()
    const frame = document.querySelector('.camp-world-map-frame')?.getBoundingClientRect()
    const density = document.querySelector('.camp-world-map')?.getAttribute('data-density')
    return Boolean(stage && frame
      && frame.height <= stage.height + 1
      && ['compact', 'condensed'].includes(density))
  })()`)
  const compressedPresentation = await evaluate(cdp, `(() => {
    const stage = document.querySelector('.camp-conversation-stage')?.getBoundingClientRect()
    const frame = document.querySelector('.camp-world-map-frame')?.getBoundingClientRect()
    const drawer = document.querySelector('.execution-drawer')?.getBoundingClientRect()
    const controls = document.querySelector('.conversation-controls')?.getBoundingClientRect()
    return {
      stageHeight: stage?.height ?? 0,
      frameHeight: frame?.height ?? 0,
      density: document.querySelector('.camp-world-map')?.getAttribute('data-density') ?? null,
      drawerBottom: drawer?.bottom ?? 0,
      controlsTop: controls?.top ?? 0,
      realSpeechText: document.querySelector('.camp-world-map-speech.is-real')?.textContent?.trim() ?? '',
      liveCaptionText: document.querySelector('.camp-world-map-live-caption')?.textContent?.trim() ?? '',
      documentOverflow: document.documentElement.scrollWidth - innerWidth
    }
  })()`)
  assert(compressedPresentation.stageHeight >= 48
    && compressedPresentation.frameHeight <= compressedPresentation.stageHeight + 1
    && ['compact', 'condensed'].includes(compressedPresentation.density)
    && compressedPresentation.drawerBottom <= compressedPresentation.controlsTop + 1
    && compressedPresentation.realSpeechText.includes('执行 · 正在运行')
    && compressedPresentation.liveCaptionText.includes('真实执行 · Codex CLI 验收')
    && compressedPresentation.documentOverflow <= 1,
  `Resizable execution Drawer broke the compressed world map: ${JSON.stringify(compressedPresentation)}`)
  const compressedCapture = join(capturesDirectory, 'camp-world-map-compressed-night-1440x920.png')
  await capture(cdp, compressedCapture)

  await pressKey(cdp, 'Escape', 'Escape', 27, 53)
  await waitForExpression(cdp, `!document.querySelector('.execution-drawer')`)
  await setTheme(cdp, 'day')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false,
    screenWidth: 2560, screenHeight: 1440
  })
  await waitForExpression(cdp, `innerWidth === 2560 && innerHeight === 1440`)
  await waitForWorldMapFit(cdp)
  const wideLayout = await collectCampWorldMapLayout(cdp)
  assertCampWorldMapLayout(wideLayout, '2560×1440', worldMapVisibleRuntimeCount)
  assert(wideLayout.frameWidth >= 1_700 && wideLayout.frameHeight >= 950,
    `2K world map did not use the available conversation plane: ${JSON.stringify(wideLayout)}`)
  const wideCapture = join(capturesDirectory, 'camp-world-map-day-2560x1440.png')
  await capture(cdp, wideCapture)

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1040, height: 700, deviceScaleFactor: 1, mobile: false,
    screenWidth: 1040, screenHeight: 700
  })
  await waitForExpression(cdp, `innerWidth === 1040 && innerHeight === 700`)
  await waitForWorldMapFit(cdp)
  const compactLayout = await collectCampWorldMapLayout(cdp)
  assertCampWorldMapLayout(compactLayout, '1040×700', worldMapVisibleRuntimeCount)
  assert(['regular', 'compact', 'condensed'].includes(compactLayout.density),
    `Compact world map density was not classified: ${JSON.stringify(compactLayout)}`)
  const compactCapture = join(capturesDirectory, 'camp-world-map-day-1040x700.png')
  await capture(cdp, compactCapture)

  await evaluate(cdp, `(() => {
    const toggle = document.querySelector('.topbar-inspector-toggle[aria-pressed="true"]')
    toggle?.click()
    return true
  })()`)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 520, height: 350, deviceScaleFactor: 2, mobile: false,
    screenWidth: 1040, screenHeight: 700
  })
  await waitForExpression(cdp, `innerWidth === 520 && innerHeight === 350 && Math.abs(devicePixelRatio - 2) < 0.01`)
  await waitForExpression(cdp, `document.querySelector('.workspace-grid')?.classList.contains('inspector-collapsed')`)
  await waitForWorldMapFit(cdp)
  const zoomLayout = await collectCampWorldMapLayout(cdp)
  assertCampWorldMapLayout(zoomLayout, '200% zoom', worldMapVisibleRuntimeCount)
  assert(zoomLayout.cssWidth === 520
    && zoomLayout.cssHeight === 350
    && zoomLayout.devicePixelRatio === 2,
  `200% zoom world map used the wrong viewport: ${JSON.stringify(zoomLayout)}`)
  const zoomCapture = join(capturesDirectory, 'camp-world-map-day-zoom-200.png')
  await capture(cdp, zoomCapture)

  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await waitForExpression(cdp, `document.querySelector('.camp-world-map')?.classList.contains('is-static') === true`)
  const staticTextAfterMotionChange = await evaluate(cdp,
    `document.querySelector('.camp-world-map-speech.is-real')?.textContent?.trim() ?? ''`)
  assert(staticTextAfterMotionChange.includes('执行 · 正在运行'),
    'Reduced motion removed the real execution text')
  const ambientAcceptance = await verifyCampWorldMapAmbientStates(cdp, capturesDirectory)

  return {
    verified: {
      defaultWorldView: true,
      keyboardViewSwitch: true,
      supplied2kAsset: true,
      realAgentRunSpeech: true,
      realAndAmbientSpeechCoexist: livePresentation,
      fixedRouteToggle: true,
      reducedMotionKeepsRealText: true,
      reducedMotionKeepsAmbientText: ambientAcceptance.reducedMotionKeepsAmbientText,
      allIdleSolo: ambientAcceptance.solo,
      controlledEncounter: ambientAcceptance.encounter,
      crowdedAmbientCaption: ambientAcceptance.crowdedCaption,
      condensedAmbientCaption: ambientAcceptance.condensedCaption,
      inactiveWindowPausesMotionKeepsRealText: true,
      existingResizableExecutionDrawer: true,
      compressedContainerLayout: compressedPresentation,
      wideLayout,
      compactLayout,
      zoomLayout
    },
    captures: {
      staticDay: staticDayCapture,
      liveDay: liveDayCapture,
      liveNight: nightCapture,
      compressedNight: compressedCapture,
      wideDay: wideCapture,
      compactDay: compactCapture,
      zoom200Day: zoomCapture,
      ambientSoloReduced: ambientAcceptance.captures.solo,
      ambientEncounterShared: ambientAcceptance.captures.sharedEncounter,
      ambientEncounterCrowded: ambientAcceptance.captures.crowdedEncounter,
      ambientEncounterCondensed: ambientAcceptance.captures.condensedEncounter
    }
  }
}

async function verifyCampWorldMapAmbientStates(cdp, capturesDirectory) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 920, deviceScaleFactor: 1, mobile: false,
    screenWidth: 1440, screenHeight: 920
  })
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })

  await openCamp(cdp, composerLayoutCampId)
  await selectCampConversationView(cdp, 'world')
  await waitForExpression(cdp, `document.querySelector('.camp-world-map')?.dataset.ambientKind === 'solo'`, 14_000)
  const solo = await evaluate(cdp, `(() => {
    const map = document.querySelector('.camp-world-map')
    const speech = document.querySelector('.camp-world-map-speech.is-ambient')
    return {
      agentCount: document.querySelectorAll('.camp-world-map-agent').length,
      ambientKind: map?.dataset.ambientKind ?? null,
      motionState: map?.dataset.motionState ?? null,
      labelCount: speech?.querySelectorAll('.camp-world-map-speech-kind').length ?? -1,
      text: speech?.querySelector('.camp-world-map-speech-text')?.textContent?.trim() ?? '',
      tagName: speech?.tagName ?? null,
      tabIndex: speech?.tabIndex ?? null,
      ariaLive: speech?.getAttribute('aria-live') ?? null,
      animationName: speech ? getComputedStyle(speech).animationName : null,
      captionCount: document.querySelectorAll('.camp-world-map-live-caption').length
    }
  })()`)
  assert(solo.agentCount === 1
    && solo.ambientKind === 'solo'
    && solo.motionState === 'paused'
    && solo.labelCount === 0
    && solo.text.length > 0
    && !solo.text.includes('闲时 · 环境预设')
    && solo.tagName === 'DIV'
    && solo.tabIndex === -1
    && solo.ariaLive === null
    && solo.animationName === 'none'
    && solo.captionCount === 0,
  `Reduced-motion solo ambient state was not static and non-interactive: ${JSON.stringify(solo)}`)
  const soloCapture = join(capturesDirectory, 'camp-world-map-ambient-solo-reduced-1440x920.png')
  await capture(cdp, soloCapture)

  await openCamp(cdp, ambientEncounterCampId)
  await selectCampConversationView(cdp, 'world')
  await waitForExpression(cdp,
    `document.querySelector('.camp-world-map')?.dataset.ambientKind === 'encounter'`, 14_000)
  const encounter = await evaluate(cdp, `(() => {
    const map = document.querySelector('.camp-world-map')
    const bubble = document.querySelector('.camp-world-map-ambient-encounter')
    const caption = document.querySelector('.camp-world-map-live-caption')
    const participants = [...document.querySelectorAll('[data-ambient-encounter-participant]')]
    return {
      agentCount: document.querySelectorAll('.camp-world-map-agent').length,
      population: map?.dataset.population ?? null,
      ambientKind: map?.dataset.ambientKind ?? null,
      motionState: map?.dataset.motionState ?? null,
      bubbleCount: document.querySelectorAll('.camp-world-map-ambient-encounter').length,
      bubbleDisplay: bubble ? getComputedStyle(bubble).display : null,
      bubbleLabelCount: bubble?.querySelectorAll('.camp-world-map-speech-kind').length ?? -1,
      participantSides: participants.map((node) => node.dataset.ambientEncounterParticipant).sort(),
      compositorPositioned: [...document.querySelectorAll('.camp-world-map-agent')].every((node) => {
        const style = getComputedStyle(node)
        return style.left === '0px'
          && style.top === '0px'
          && node.style.getPropertyValue('--world-map-agent-x').length > 0
          && node.style.getPropertyValue('--world-map-agent-y').length > 0
      }),
      captionTagName: caption?.tagName ?? null,
      captionTabIndex: caption?.tabIndex ?? null,
      captionAriaLive: caption?.getAttribute('aria-live') ?? null,
      captionText: caption?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      captionDisplay: caption ? getComputedStyle(caption).display : null
    }
  })()`)
  assert(encounter.agentCount === 11
    && encounter.population === 'crowded'
    && encounter.ambientKind === 'encounter'
    && encounter.motionState === 'paused'
    && encounter.bubbleCount === 1
    && encounter.bubbleDisplay === 'none'
    && encounter.bubbleLabelCount === 0
    && JSON.stringify(encounter.participantSides) === JSON.stringify(['left', 'right'])
    && encounter.compositorPositioned
    && encounter.captionTagName === 'DIV'
    && encounter.captionTabIndex === -1
    && encounter.captionAriaLive === null
    && encounter.captionText.includes('闲时预设 · 偶遇')
    && encounter.captionDisplay !== 'none',
  `Controlled crowded encounter did not use one shared event and a static caption: ${JSON.stringify(encounter)}`)
  const crowdedEncounterCapture = join(capturesDirectory, 'camp-world-map-ambient-encounter-crowded-1440x920.png')
  await capture(cdp, crowdedEncounterCapture)

  const sharedEncounter = await evaluate(cdp, `(() => {
    const map = document.querySelector('.camp-world-map')
    const caption = document.querySelector('.camp-world-map-live-caption')
    if (map) map.dataset.population = 'normal'
    if (caption instanceof HTMLElement) caption.style.display = 'none'
    const bubble = document.querySelector('.camp-world-map-ambient-encounter')
    const frame = document.querySelector('.camp-world-map-frame')
    const participants = [...document.querySelectorAll('[data-ambient-encounter-participant]')]
    const bubbleBounds = bubble?.getBoundingClientRect()
    const frameBounds = frame?.getBoundingClientRect()
    const participantBounds = participants.map((node) => node.getBoundingClientRect())
    return {
      bubbleDisplay: bubble ? getComputedStyle(bubble).display : null,
      bubbleWidth: bubbleBounds?.width ?? 0,
      bubbleHeight: bubbleBounds?.height ?? 0,
      bubbleInsideFrame: Boolean(bubbleBounds && frameBounds
        && bubbleBounds.left >= frameBounds.left - 1
        && bubbleBounds.right <= frameBounds.right + 1
        && bubbleBounds.top >= frameBounds.top - 1
        && bubbleBounds.bottom <= frameBounds.bottom + 1),
      pointerEvents: bubble ? getComputedStyle(bubble).pointerEvents : null,
      buttonCount: bubble?.querySelectorAll('button').length ?? -1,
      labelCount: bubble?.querySelectorAll('.camp-world-map-speech-kind').length ?? -1,
      pseudoContent: bubble ? getComputedStyle(bubble, '::after').content : null,
      participantHorizontalSeparation: participantBounds.length === 2
        ? Math.abs(participantBounds[0].left - participantBounds[1].left)
        : 0
    }
  })()`)
  assert(sharedEncounter.bubbleDisplay !== 'none'
    && sharedEncounter.bubbleWidth > 180
    && sharedEncounter.bubbleHeight > 30
    && sharedEncounter.bubbleInsideFrame
    && sharedEncounter.pointerEvents === 'none'
    && sharedEncounter.buttonCount === 0
    && sharedEncounter.labelCount === 0
    && ['none', 'normal'].includes(sharedEncounter.pseudoContent)
    && sharedEncounter.participantHorizontalSeparation <= 1,
  `Shared encounter bubble moved avatars or reused directional/interactive speech semantics: ${JSON.stringify(sharedEncounter)}`)
  const sharedEncounterCapture = join(capturesDirectory, 'camp-world-map-ambient-encounter-shared-1440x920.png')
  await capture(cdp, sharedEncounterCapture)
  await evaluate(cdp, `(() => {
    const map = document.querySelector('.camp-world-map')
    const caption = document.querySelector('.camp-world-map-live-caption')
    if (map) map.dataset.population = 'crowded'
    if (caption instanceof HTMLElement) caption.style.removeProperty('display')
    return true
  })()`)

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 520, height: 350, deviceScaleFactor: 1, mobile: false,
    screenWidth: 520, screenHeight: 350
  })
  await waitForExpression(cdp,
    `document.querySelector('.camp-world-map')?.dataset.density === 'condensed'`)
  const condensed = await evaluate(cdp, `(() => {
    const map = document.querySelector('.camp-world-map')
    const caption = document.querySelector('.camp-world-map-live-caption')
    const bounds = caption?.getBoundingClientRect()
    return {
      density: map?.dataset.density ?? null,
      ambientKind: map?.dataset.ambientKind ?? null,
      captionText: caption?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      captionTagName: caption?.tagName ?? null,
      captionVisible: Boolean(bounds && bounds.width > 0 && bounds.height > 0),
      documentOverflow: document.documentElement.scrollWidth - innerWidth
    }
  })()`)
  assert(condensed.density === 'condensed'
    && condensed.ambientKind === 'encounter'
    && condensed.captionText.includes('闲时预设 · 偶遇')
    && condensed.captionTagName === 'DIV'
    && condensed.captionVisible
    && condensed.documentOverflow <= 1,
  `Condensed encounter did not retain its one-line ambient caption: ${JSON.stringify(condensed)}`)
  const condensedEncounterCapture = join(capturesDirectory, 'camp-world-map-ambient-encounter-condensed-520x350.png')
  await capture(cdp, condensedEncounterCapture)

  return {
    reducedMotionKeepsAmbientText: true,
    solo,
    encounter,
    crowdedCaption: true,
    condensedCaption: condensed,
    captures: {
      solo: soloCapture,
      sharedEncounter: sharedEncounterCapture,
      crowdedEncounter: crowdedEncounterCapture,
      condensedEncounter: condensedEncounterCapture
    }
  }
}

async function waitForWorldMapFit(cdp) {
  await waitForExpression(cdp, `(() => {
    const stage = document.querySelector('.camp-conversation-stage')?.getBoundingClientRect()
    const frame = document.querySelector('.camp-world-map-frame')?.getBoundingClientRect()
    if (!stage || !frame) return false
    const sourceRatio = 1148 / 646
    const expectedWidth = Math.min(stage.width, stage.height * sourceRatio)
    const expectedHeight = expectedWidth / sourceRatio
    return Math.abs(frame.width - expectedWidth) <= 2
      && Math.abs(frame.height - expectedHeight) <= 2
  })()`)
}

async function collectCampWorldMapLayout(cdp) {
  return evaluate(cdp, `(() => {
    const stage = document.querySelector('.camp-conversation-stage')?.getBoundingClientRect()
    const frame = document.querySelector('.camp-world-map-frame')?.getBoundingClientRect()
    const controls = document.querySelector('.camp-conversation-view-controls')?.getBoundingClientRect()
    return {
      cssWidth: innerWidth,
      cssHeight: innerHeight,
      devicePixelRatio,
      density: document.querySelector('.camp-world-map')?.getAttribute('data-density') ?? null,
      stageWidth: stage?.width ?? 0,
      stageHeight: stage?.height ?? 0,
      frameWidth: frame?.width ?? 0,
      frameHeight: frame?.height ?? 0,
      frameInsideStage: Boolean(stage && frame
        && frame.left >= stage.left - 1
        && frame.right <= stage.right + 1
        && frame.top >= stage.top - 1
        && frame.bottom <= stage.bottom + 1),
      controlsInsideStage: Boolean(stage && controls
        && controls.left >= stage.left - 1
        && controls.right <= stage.right + 1
        && controls.top >= stage.top - 1
        && controls.bottom <= stage.bottom + 1),
      agentCount: document.querySelectorAll('.camp-world-map-agent').length,
      realSpeechText: document.querySelector('.camp-world-map-speech.is-real')?.textContent?.trim() ?? '',
      liveCaptionText: document.querySelector('.camp-world-map-live-caption')?.textContent?.trim() ?? '',
      documentOverflow: document.documentElement.scrollWidth - innerWidth
    }
  })()`)
}

function assertCampWorldMapLayout(layout, label, expectedAgentCount) {
  assert(layout.stageWidth > 0
    && layout.stageHeight > 0
    && layout.frameWidth > 0
    && layout.frameHeight > 0
    && layout.frameInsideStage
    && layout.controlsInsideStage
    && layout.agentCount === expectedAgentCount
    && layout.realSpeechText.includes('执行 · 正在运行')
    && (layout.density !== 'condensed' || layout.liveCaptionText.includes('真实执行 · Codex CLI 验收'))
    && layout.documentOverflow <= 1,
  `${label} world map escaped its conversation container or lost real output: ${JSON.stringify(layout)}`)
}

async function setTheme(cdp, preference) {
  await evaluate(cdp,
    `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  const expectedTheme = preference === 'night' ? 'night' : 'day'
  await waitForExpression(cdp,
    `document.documentElement.dataset.theme === ${JSON.stringify(expectedTheme)}`)
}

async function verifyGlobalExecutionPlacement(cdp) {
  const authority = await evaluate(cdp, 'window.rovai.generalPreferences.get()', true)
  assert(authority.executionConsolePlacement === 'inspector',
    `Moving right did not commit the authoritative preference: ${JSON.stringify(authority)}`)

  await openCamp(cdp, composerLayoutCampId)
  await waitForExpression(cdp,
    `document.querySelector('.camp-workspace')?.getAttribute('aria-label') === ${JSON.stringify(`会话：${composerLayoutCampTitle}`)}`)
  const acrossCamp = await evaluate(cdp, `(() => ({
    bottomDockCount: document.querySelectorAll('.timeline-pane > .run-pulse-bottom').length,
    executionTabCount: [...document.querySelectorAll('.activity-tabs [role="tab"]')]
      .filter((tab) => tab.textContent?.includes('执行')).length
  }))()`)
  const acrossCampAuthority = await evaluate(cdp, 'window.rovai.generalPreferences.get()', true)
  assert(acrossCamp.bottomDockCount === 0
    && acrossCampAuthority.executionConsolePlacement === 'inspector',
  `A second Camp did not inherit Inspector placement: ${JSON.stringify({ acrossCamp, acrossCampAuthority })}`)

  await evaluate(cdp, `document.querySelector('.unified-sidebar button[aria-label="设置"]')?.click()`)
  await waitForExpression(cdp, `Boolean(document.querySelector('.settings-workbench'))`)
  await evaluate(cdp, `document.querySelector('.settings-sidebar-back')?.click()`)
  await waitForExpression(cdp,
    `document.querySelector('.camp-workspace')?.getAttribute('aria-label') === ${JSON.stringify(`会话：${composerLayoutCampTitle}`)}`)
  const acrossPage = await evaluate(cdp, `(() => ({
    bottomDockCount: document.querySelectorAll('.timeline-pane > .run-pulse-bottom').length,
    executionTabCount: [...document.querySelectorAll('.activity-tabs [role="tab"]')]
      .filter((tab) => tab.textContent?.includes('执行')).length
  }))()`)
  const acrossPageAuthority = await evaluate(cdp, 'window.rovai.generalPreferences.get()', true)
  assert(acrossPage.bottomDockCount === 0
    && acrossPageAuthority.executionConsolePlacement === 'inspector',
  `Returning from another primary page lost Inspector placement: ${JSON.stringify({ acrossPage, acrossPageAuthority })}`)

  await evaluate(cdp,
    `document.querySelector('.topbar-inspector-toggle[aria-pressed="true"]')?.click()`)
  await waitForExpression(cdp,
    `document.querySelector('.workspace-grid')?.classList.contains('inspector-collapsed')`)
  await openCamp(cdp, campId)
  await waitForExpression(cdp,
    `document.querySelector('.camp-workspace')?.getAttribute('aria-label') === ${JSON.stringify(`会话：${campTitle}`)}`)
  const runningEntryReveal = await evaluate(cdp, `(() => ({
    inspectorCollapsed: document.querySelector('.workspace-grid')?.classList.contains('inspector-collapsed') ?? false,
    bottomDockCount: document.querySelectorAll('.timeline-pane > .run-pulse-bottom').length,
    activeTab: document.querySelector('.activity-tabs [role="tab"][data-state="active"]')?.textContent
      ?.replace(/\\d+/g, '').replace(/\\s+/g, ' ').trim() ?? null,
    selectedAgentId: document.querySelector('.run-pulse-inspector .run-pulse-chip.is-selected')?.dataset.agentId ?? null,
    focusedRunId: document.querySelector('.execution-process-stage.is-focused')?.dataset.agentRunId ?? null,
    drawerOwnsFocus: Boolean(document.activeElement?.closest('.execution-drawer'))
  }))()`)
  assert(!runningEntryReveal.inspectorCollapsed
    && runningEntryReveal.bottomDockCount === 0
    && runningEntryReveal.activeTab === '执行'
    && runningEntryReveal.selectedAgentId === activeAgentId
    && runningEntryReveal.focusedRunId === activeRunId
    && !runningEntryReveal.drawerOwnsFocus,
    `Entering a running Camp did not reveal its current Inspector Run without stealing focus: ${JSON.stringify(runningEntryReveal)}`)

  await evaluate(cdp, `document.querySelector('.unified-sidebar button[aria-label="设置"]')?.click()`)
  await waitForExpression(cdp, `Boolean(document.querySelector('.settings-workbench'))`)
  await evaluate(cdp, `document.querySelector('.settings-sidebar-back')?.click()`)
  await waitForExpression(cdp,
    `document.querySelector('.camp-workspace')?.getAttribute('aria-label') === ${JSON.stringify(`会话：${campTitle}`)}`)
  const runningPageReturn = await evaluate(cdp, `(() => ({
    activeTab: document.querySelector('.activity-tabs [role="tab"][data-state="active"]')?.textContent
      ?.replace(/\\d+/g, '').replace(/\\s+/g, ' ').trim() ?? null,
    selectedAgentId: document.querySelector('.run-pulse-inspector .run-pulse-chip.is-selected')?.dataset.agentId ?? null,
    focusedRunId: document.querySelector('.execution-process-stage.is-focused')?.dataset.agentRunId ?? null,
    drawerOwnsFocus: Boolean(document.activeElement?.closest('.execution-drawer'))
  }))()`)
  assert(runningPageReturn.activeTab === '执行'
    && runningPageReturn.selectedAgentId === activeAgentId
    && runningPageReturn.focusedRunId === activeRunId
    && !runningPageReturn.drawerOwnsFocus,
    `Returning from another primary page did not restore the running Run: ${JSON.stringify(runningPageReturn)}`)

  return {
    authority,
    acrossCamp,
    acrossCampAuthority,
    acrossPage,
    acrossPageAuthority,
    runningEntryReveal,
    runningPageReturn
  }
}

async function verifyExecutionPlacementAcrossRestart(currentApp) {
  await openCamp(currentApp.cdp, campId)
  await evaluate(currentApp.cdp,
    `document.querySelector('.run-pulse-bottom .execution-placement-button')?.click()`)
  await waitForExpression(currentApp.cdp, `Boolean(document.querySelector('.run-pulse-inspector'))`)
  const beforeRestart = await evaluate(
    currentApp.cdp,
    'window.rovai.generalPreferences.get()',
    true
  )
  assert(beforeRestart.executionConsolePlacement === 'inspector',
    `Restart setup did not save Inspector placement: ${JSON.stringify(beforeRestart)}`)

  await closeApp(currentApp)
  const relaunchedApp = await launchApp(debugPort, 1440, 920)
  try {
    await openCamp(relaunchedApp.cdp, campId)
    await waitForExpression(relaunchedApp.cdp,
      `Boolean(document.querySelector('.camp-workspace')) && !document.querySelector('.timeline-pane > .run-pulse-bottom')`)
    const afterRestart = await evaluate(
      relaunchedApp.cdp,
      'window.rovai.generalPreferences.get()',
      true
    )
    const firstCampPaint = await evaluate(relaunchedApp.cdp, `(() => ({
      bottomDockCount: document.querySelectorAll('.timeline-pane > .run-pulse-bottom').length,
      inspectorDockCount: document.querySelectorAll('.run-pulse-inspector').length,
      executionTabCount: [...document.querySelectorAll('.activity-tabs [role="tab"]')]
        .filter((tab) => tab.textContent?.includes('执行')).length,
      inspectorHidden: document.querySelector('.workspace-grid')?.classList.contains('inspector-collapsed') ?? false,
      activeTab: document.querySelector('.activity-tabs [role="tab"][data-state="active"]')?.textContent
        ?.replace(/\\d+/g, '').replace(/\\s+/g, ' ').trim() ?? null,
      selectedAgentId: document.querySelector('.run-pulse-inspector .run-pulse-chip.is-selected')?.dataset.agentId ?? null,
      focusedRunId: document.querySelector('.execution-process-stage.is-focused')?.dataset.agentRunId ?? null
    }))()`)
    assert(afterRestart.executionConsolePlacement === 'inspector'
      && firstCampPaint.bottomDockCount === 0
      && !firstCampPaint.inspectorHidden
      && firstCampPaint.inspectorDockCount === 1
      && firstCampPaint.executionTabCount === 1
      && firstCampPaint.activeTab === '任务'
      && firstCampPaint.selectedAgentId === null
      && firstCampPaint.focusedRunId === null,
    `Relaunch did not restore Inspector placement before Camp mount: ${JSON.stringify({ afterRestart, firstCampPaint })}`)

    await evaluate(relaunchedApp.cdp, `(() => {
      const tab = [...document.querySelectorAll('.activity-tabs [role="tab"]')]
        .find((candidate) => candidate.textContent?.includes('执行'))
      tab?.click()
      return Boolean(tab)
    })()`)
    await waitForExpression(relaunchedApp.cdp, `Boolean(document.querySelector('.run-pulse-inspector'))`)
    await evaluate(relaunchedApp.cdp,
      `document.querySelector('.run-pulse-inspector .execution-placement-button')?.click()`)
    await waitForExpression(relaunchedApp.cdp,
      `Boolean(document.querySelector('.timeline-pane > .run-pulse-bottom'))`)
    const restoredDefault = await evaluate(
      relaunchedApp.cdp,
      'window.rovai.generalPreferences.get()',
      true
    )
    assert(restoredDefault.executionConsolePlacement === 'bottom',
      `Restart acceptance could not restore the bottom preference: ${JSON.stringify(restoredDefault)}`)
    return {
      app: relaunchedApp,
      evidence: { beforeRestart, afterRestart, firstCampPaint, restoredDefault }
    }
  } catch (error) {
    await closeApp(relaunchedApp)
    throw error
  }
}

async function verifyExecutionPlacementWriteFailure(cdp) {
  const preferencesPath = join(dataDir, 'general-preferences.json')
  const savedPreferences = await readFile(preferencesPath)
  await rm(preferencesPath)
  await mkdir(preferencesPath)
  let failedState
  try {
    await evaluate(cdp,
      `document.querySelector('.run-pulse-inspector .execution-placement-button')?.click()`)
    await waitForExpression(cdp,
      `Boolean(document.querySelector('.run-pulse-inspector .execution-placement-feedback[role="alert"]'))`)
    const authority = await evaluate(cdp, 'window.rovai.generalPreferences.get()', true)
    const temporaryFiles = (await readdir(dataDir)).filter((name) => name.endsWith('.tmp'))
    failedState = await evaluate(cdp, `(() => ({
      inspectorDockCount: document.querySelectorAll('.run-pulse-inspector').length,
      bottomDockCount: document.querySelectorAll('.timeline-pane > .run-pulse-bottom').length,
      message: document.querySelector('.execution-placement-feedback')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      retryVisible: Boolean(document.querySelector('.execution-placement-feedback button'))
    }))()`)
    assert(authority.executionConsolePlacement === 'inspector'
      && failedState.inspectorDockCount === 1
      && failedState.bottomDockCount === 0
      && failedState.message.includes('未能保存，仍在右侧。')
      && failedState.retryVisible
      && temporaryFiles.length === 0,
    `Failed placement write did not retain authority and show retry in place: ${JSON.stringify({ authority, failedState, temporaryFiles })}`)
  } finally {
    await rm(preferencesPath, { recursive: true, force: true })
    await writeFile(preferencesPath, savedPreferences, { mode: 0o600 })
  }

  await evaluate(cdp,
    `document.querySelector('.execution-placement-feedback button')?.click()`)
  await waitForExpression(cdp,
    `Boolean(document.querySelector('.timeline-pane > .run-pulse-bottom'))`)
  const retriedAuthority = await evaluate(cdp, 'window.rovai.generalPreferences.get()', true)
  assert(retriedAuthority.executionConsolePlacement === 'bottom',
    `Placement retry did not commit bottom authority: ${JSON.stringify(retriedAuthority)}`)

  await evaluate(cdp,
    `document.querySelector('.run-pulse-bottom .execution-placement-button')?.click()`)
  await waitForExpression(cdp, `Boolean(document.querySelector('.run-pulse-inspector'))`)
  const restoredAuthority = await evaluate(cdp, 'window.rovai.generalPreferences.get()', true)
  assert(restoredAuthority.executionConsolePlacement === 'inspector',
    `Failure acceptance did not restore Inspector setup: ${JSON.stringify(restoredAuthority)}`)

  return { failedState, retriedAuthority, restoredAuthority }
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

async function mouseClickSelector(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)})
    if (!(target instanceof HTMLElement)) return null
    target.scrollIntoView({ block: 'center', inline: 'nearest' })
    const rect = target.getBoundingClientRect()
    return { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) }
  })()`)
  assert(point, `Could not locate pointer target: ${selector}`)
  await wait(80)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1
  })
}

async function pressKey(cdp, key, code, windowsVirtualKeyCode, nativeVirtualKeyCode = windowsVirtualKeyCode) {
  const params = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode }
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
  const child = spawn(stagedSidecarPath(root, 'rovai-core'), [
    ...coreDataDirectoryArguments(dataDirectory),
    '--skill-library-root', join(dataDirectory, 'managed-skill-library')
  ], {
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

async function snapshotClipboard() {
  const source = String.raw`
    import AppKit
    import Foundation

    let pasteboard = NSPasteboard.general
    var archive: [[[String: String]]] = []
    for item in pasteboard.pasteboardItems ?? [] {
      var flavors: [[String: String]] = []
      for type in item.types {
        guard let data = item.data(forType: type) else {
          fatalError("Could not read Pasteboard flavor \(type.rawValue)")
        }
        flavors.append(["type": type.rawValue, "data": data.base64EncodedString()])
      }
      archive.append(flavors)
    }
    let encoded = try JSONSerialization.data(withJSONObject: archive)
    FileHandle.standardOutput.write(encoded)
  `
  const raw = await runProcess('/usr/bin/xcrun', ['swift', '-e', source])
  const archive = JSON.parse(raw)
  validateClipboardArchive(archive)
  return normalizeClipboardArchive(archive)
}

async function restoreClipboardWithRetry(archive) {
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await restoreClipboard(archive)
      const restored = await snapshotClipboard()
      if (!deepEqual(restored, normalizeClipboardArchive(archive))) {
        throw new Error('Restored Pasteboard bytes do not match the pre-test archive')
      }
      return
    } catch (error) {
      lastError = error
      await wait(100)
    }
  }
  throw new Error(`Could not restore the pre-test Pasteboard after three attempts: ${errorMessage(lastError)}`)
}

async function restoreClipboard(archive) {
  validateClipboardArchive(archive)
  const source = String.raw`
    import AppKit
    import Foundation

    let input = FileHandle.standardInput.readDataToEndOfFile()
    let object = try JSONSerialization.jsonObject(with: input)
    guard let archive = object as? [[[String: String]]] else {
      fatalError("Clipboard archive has an invalid shape")
    }
    var items: [NSPasteboardItem] = []
    for flavors in archive {
      let item = NSPasteboardItem()
      for flavor in flavors {
        guard let typeName = flavor["type"],
              let encoded = flavor["data"],
              let data = Data(base64Encoded: encoded) else {
          fatalError("Clipboard archive contains an invalid flavor")
        }
        guard item.setData(data, forType: NSPasteboard.PasteboardType(typeName)) else {
          fatalError("Could not prepare Pasteboard flavor \(typeName)")
        }
      }
      items.append(item)
    }
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    if !items.isEmpty && !pasteboard.writeObjects(items) {
      fatalError("Could not restore Pasteboard objects")
    }
  `
  await runProcess('/usr/bin/xcrun', ['swift', '-e', source], {
    input: JSON.stringify(archive)
  })
}

function validateClipboardArchive(archive) {
  assert(Array.isArray(archive), 'Pasteboard archive is not an array')
  for (const item of archive) {
    assert(Array.isArray(item), 'Pasteboard item is not an array')
    for (const flavor of item) {
      assert(flavor && typeof flavor === 'object'
        && typeof flavor.type === 'string'
        && typeof flavor.data === 'string', 'Pasteboard flavor is invalid')
    }
  }
}

function normalizeClipboardArchive(archive) {
  return archive.map((item) => item.slice().sort((left, right) =>
    left.type.localeCompare(right.type)))
}

function runSql(path, sql) {
  return runProcess('/usr/bin/sqlite3', [path, sql])
}

function runProcess(command, args, { input } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun(stdout.join(''))
      else rejectRun(new Error(`${command} exited with ${code ?? signal}: ${stderr.join('')}`))
    })
    if (input !== undefined) child.stdin.end(input)
  })
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function sqlNullable(value) {
  return value === null || value === undefined ? 'NULL' : sqlLiteral(value)
}

function deepEqual(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right))
}

function canonicalJsonDigest(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalJson(value)))
    .digest('hex')
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]))
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}

function availableLoopbackPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.unref()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        rejectPort(new Error('Could not allocate an isolated Electron debugging port'))
        return
      }
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port))
    })
  })
}
