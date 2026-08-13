import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai-ai.app'))
const fixtureRoot = process.env.ROVAI_NOTIFICATION_ACCEPT_FIXTURE_ROOT
  ?? await mkdtemp(join(tmpdir(), 'rovai-notification-ui-accept-'))
const dataDir = join(fixtureRoot, 'user-data')
const workspaceDir = join(fixtureRoot, 'workspace')
const outputDir = process.env.ROVAI_NOTIFICATION_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-notification-ui-captures-'))
const databasePath = join(dataDir, 'rovai.sqlite')
const firstPort = Number(process.env.ROVAI_NOTIFICATION_ACCEPT_DEBUG_PORT ?? 9471)

await mkdir(dataDir, { recursive: true })
await mkdir(workspaceDir, { recursive: true })
await mkdir(outputDir, { recursive: true })
await writeFile(join(workspaceDir, 'README.md'), '# Notification Episode UI acceptance\n')

const campId = await createFixtureCamp()
await insertApprovalEpisode('episode-approval-initial', '-3 minutes')
await insertTerminalTurn('turn-completed-initial', 'completed', '-2 minutes')
await insertTerminalTurn('turn-incomplete-initial', 'cancelled', '-1 minute')
await insertMessageMention(
  'message-mention-initial',
  '请确认 v0.71 的精确消息定位。',
  null,
  '-30 seconds'
)

let dayApp = null
let compactApp = null
try {
  dayApp = await launchApp(firstPort, 1440, 920, false)
  await setTheme(dayApp.cdp, 'day')
  await assertNotificationBadge(dayApp.cdp, 4)
  assert(!(await evaluate(dayApp.cdp, `Boolean(document.querySelector('.notification-heads-up'))`)),
    'Existing Episode history was replayed as a heads-up after launch')

  await openNotificationCenter(dayApp.cdp)
  await assertNotificationDrawer(dayApp.cdp, 4, 'day desktop')
  const drawerCapture = join(outputDir, 'notification-center-day.png')
  await capture(dayApp.cdp, drawerCapture)
  await closeDialogWithEscape(dayApp.cdp)
  assert(await evaluate(dayApp.cdp,
    `document.activeElement === document.querySelector('.notification-trigger')`),
  'Closing the notification center did not restore focus to the bell')

  const initialInbox = await request(dayApp.cdp, 'notifications.inbox', {
    filter: 'all',
    limit: 50
  })
  const initialMention = initialInbox.items.find(
    (item) => item.mention?.messageId === 'message-mention-initial'
  )
  assert(initialMention, `Initial Mention Episode was unavailable: ${JSON.stringify(initialInbox)}`)
  await openNotificationCenter(dayApp.cdp)
  await clickEpisodeAction(dayApp.cdp, initialMention.id, '查看消息')
  await waitForExpression(dayApp.cdp, `!document.querySelector('.notification-drawer')`)
  await waitForExpression(dayApp.cdp, `
    document.querySelector('[data-message-id="message-mention-initial"]')
      ?.classList.contains('notification-focus-target') === true
  `, 15_000)
  await assertNotificationBadge(dayApp.cdp, 3)
  const clickedInbox = await request(dayApp.cdp, 'notifications.inbox', {
    filter: 'all',
    limit: 50
  })
  const clickedEpisode = clickedInbox.items.find((item) => item.id === initialMention.id)
  assert(clickedEpisode?.unread === false
      && clickedEpisode.unacknowledgedMentionCount === 0
      && clickedEpisode.reasons.some(
        (reason) => reason.semantic === 'user_mention' && reason.state === 'acknowledged'
      ),
  `Exact Mention acknowledgement did not persist: ${JSON.stringify(clickedInbox)}`)
  await openNotificationCenter(dayApp.cdp)
  await assertNotificationDrawer(dayApp.cdp, 4, 'day desktop after exact acknowledgement', 3)
  assert(!(await evaluate(dayApp.cdp,
    `document.querySelector('[data-notification-id="${initialMention.id}"]')
      ?.classList.contains('unread')`)),
  'The acknowledged Mention Episode returned to its unread presentation')
  await closeDialogWithEscape(dayApp.cdp)

  const markBoundary = await request(dayApp.cdp, 'notifications.inbox', {
    filter: 'all',
    limit: 50
  })
  const readAllResult = await request(dayApp.cdp, 'notifications.markAllRead', {
    commandId: crypto.randomUUID(),
    command: { throughChangeSequence: markBoundary.throughChangeSequence }
  })
  assert(readAllResult.status === 'applied',
    `Could not normalize the Episode fixture: ${JSON.stringify(readAllResult)}`)
  await assertNotificationBadge(dayApp.cdp, 0)

  await openNotificationSettings(dayApp.cdp)
  await assertNotificationPreferences(dayApp.cdp)
  const settingsCapture = join(outputDir, 'notification-settings-day.png')
  await capture(dayApp.cdp, settingsCapture)
  await setPrimaryHeadsUpPreference(dayApp.cdp, false)
  await insertTerminalTurn('turn-completed-muted', 'completed')
  await assertNotificationBadge(dayApp.cdp, 1)
  await wait(3_000)
  assert(!(await evaluate(dayApp.cdp, `Boolean(document.querySelector('.notification-heads-up'))`)),
    'An Episode admitted while heads-up was disabled still opened a heads-up')
  await setPrimaryHeadsUpPreference(dayApp.cdp, true)

  await closeApp(dayApp)
  dayApp = null
  await wait(500)

  compactApp = await launchApp(firstPort + 1, 1040, 700, true)
  await setTheme(compactApp.cdp, 'night')
  await assertNotificationBadge(compactApp.cdp, 1)
  assert(!(await evaluate(compactApp.cdp, `Boolean(document.querySelector('.notification-heads-up'))`)),
    'Unread Episode history was replayed as a heads-up after restart')
  await openNotificationSettings(compactApp.cdp)
  await assertNotificationPreferences(compactApp.cdp)
  const compactSettingsCapture = join(outputDir, 'notification-settings-night-compact.png')
  await capture(compactApp.cdp, compactSettingsCapture)
  await emulateDesktopZoom(compactApp.cdp, 1040, 700, 2)
  await assertNotificationPreferenceRecovery(compactApp.cdp)
  await emulateDesktopZoom(compactApp.cdp, 1040, 700, 1)
  await evaluate(compactApp.cdp,
    `document.querySelector('.settings-sidebar-back')?.click()`)
  await waitForSelector(compactApp.cdp, '.unified-sidebar')
  await evaluate(compactApp.cdp,
    `document.querySelector('.unified-sidebar button[aria-label="队员"]')?.click()`)
  await waitForSelector(compactApp.cdp, '.members-view')
  await focusNewConversation(compactApp.cdp)

  await insertRunningTurn('turn-mention-live')
  await insertMessageMention(
    'message-mention-live-1',
    '第一条实时消息提到你。',
    'turn-mention-live'
  )
  await waitForSelector(compactApp.cdp, '.notification-heads-up', 15_000)
  assert(await evaluate(compactApp.cdp, `(() => {
    window.__notificationAcceptHeadsUp = document.querySelector('.notification-heads-up')
    return Boolean(window.__notificationAcceptHeadsUp)
  })()`), 'Could not retain the live Episode heads-up identity')
  await wait(75)
  await insertMessageMention(
    'message-mention-live-2',
    '第二条实时消息提到你。',
    'turn-mention-live'
  )
  await waitForExpression(compactApp.cdp, `
    document.querySelector('.notification-heads-up')?.textContent
      ?.includes('第二条实时消息提到你。') === true
  `, 15_000)
  assert(await evaluate(compactApp.cdp,
    `window.__notificationAcceptHeadsUp === document.querySelector('.notification-heads-up')`),
  'A new exact Occurrence signal remounted the existing Episode heads-up instead of updating it in place')
  assert(await evaluate(compactApp.cdp,
    `document.activeElement?.getAttribute('aria-label') === '新对话'`),
  'The updated Episode heads-up stole keyboard focus')
  await assertNotificationBadge(compactApp.cdp, 2)
  const aggregateInbox = await request(compactApp.cdp, 'notifications.inbox', {
    filter: 'unread',
    limit: 50
  })
  const liveMentionEpisodes = aggregateInbox.items.filter(
    (item) => item.campTurnId === 'turn-mention-live'
  )
  assert(liveMentionEpisodes.length === 1
      && liveMentionEpisodes[0].mentionCount === 2
      && liveMentionEpisodes[0].unacknowledgedMentionCount === 2,
  `Same-turn Mentions did not materialize as one partially readable Episode: ${JSON.stringify(aggregateInbox)}`)
  await clickFirstButton(compactApp.cdp, '.notification-heads-up-close')
  await waitForExpression(compactApp.cdp, `!document.querySelector('.notification-heads-up')`)
  await focusNewConversation(compactApp.cdp)

  await insertTerminalTurn('turn-completed-live', 'completed')
  await waitForSelector(compactApp.cdp, '.notification-heads-up', 15_000)
  assert(await evaluate(compactApp.cdp,
    `document.activeElement?.getAttribute('aria-label') === '新对话'`),
  'The completion heads-up stole keyboard focus')
  const headsUpText = await evaluate(compactApp.cdp,
    `document.querySelector('.notification-heads-up')?.textContent ?? ''`)
  assert(headsUpText.includes('等待你的下一步')
      && headsUpText.includes('本轮协作已经完成')
      && !headsUpText.includes('README.md'),
  `The heads-up did not use fixed data-minimized copy: ${JSON.stringify(headsUpText)}`)
  await assertNotificationBadge(compactApp.cdp, 3)
  const headsUpCapture = join(outputDir, 'notification-heads-up-compact-reduced-motion.png')
  await capture(compactApp.cdp, headsUpCapture)

  await clickFirstButton(compactApp.cdp, '.notification-heads-up-close')
  await waitForExpression(compactApp.cdp, `!document.querySelector('.notification-heads-up')`)
  await openNotificationCenter(compactApp.cdp)
  await selectNotificationFilter(compactApp.cdp, '全部')
  await waitForExpression(compactApp.cdp,
    `document.querySelectorAll('.notification-row').length === 7`)
  await assertNotificationDrawer(compactApp.cdp, 7, 'compact reduced-motion', 3)
  await clickButton(compactApp.cdp, '.notification-drawer-actions button', '全部已读')
  await waitForExpression(compactApp.cdp,
    `document.querySelector('.notification-drawer-header span')?.textContent === '0 项未读'`)
  await assertNotificationBadge(compactApp.cdp, 0)

  await emulateDesktopZoom(compactApp.cdp, 1040, 700, 2)
  await assertNotificationDrawer(compactApp.cdp, 7, '200% zoom', 0)
  await assertZoomedNotificationFunctionality(compactApp.cdp)
  await selectNotificationFilter(compactApp.cdp, '未读')
  await waitForExpression(compactApp.cdp,
    `document.querySelectorAll('.notification-row').length === 0`)
  await selectNotificationFilter(compactApp.cdp, '全部')
  await waitForExpression(compactApp.cdp,
    `document.querySelectorAll('.notification-row').length === 7`)
  const zoomCapture = join(outputDir, 'notification-center-night-200-percent.png')
  await capture(compactApp.cdp, zoomCapture)
  await emulateDesktopZoom(compactApp.cdp, 1040, 700, 1)

  const visibleEpisodes = await request(compactApp.cdp, 'notifications.inbox', {
    filter: 'all',
    limit: 50
  })
  for (const episode of visibleEpisodes.items) {
    const result = await request(compactApp.cdp, 'notifications.clear', {
      commandId: crypto.randomUUID(),
      command: {
        episodeId: episode.id,
        throughAttentionRevision: episode.attentionRevision
      }
    })
    assert(result.status === 'applied',
      `Could not clear Episode ${episode.id}: ${JSON.stringify(result)}`)
  }
  await waitForExpression(compactApp.cdp,
    `document.querySelectorAll('.notification-row').length === 0`, 15_000)
  const emptyInbox = await request(compactApp.cdp, 'notifications.inbox', {
    filter: 'all',
    limit: 50
  })
  assert(emptyInbox.unreadCount === 0 && emptyInbox.items.length === 0,
    `Packaged Episode commands did not persist: ${JSON.stringify(emptyInbox)}`)

  console.log(JSON.stringify({
    ok: true,
    app: basename(appPath),
    fixtureRoot,
    outputDir,
    verified: {
      packagedRendererToCoreIpc: true,
      sourceFactsMaterializeEpisodes: true,
      existingEpisodesDoNotReplayHeadsUp: true,
      unreadEpisodeBadgeAndAccessibleName: true,
      persistentDrawerAndFixedCopy: true,
      exactMentionAcknowledgementAndNavigation: true,
      boundedMarkAllAndRevisionBoundedClear: true,
      fiveNotificationPreferences: true,
      preferenceFailurePreservesFocusAndScroll: true,
      headsUpPreferenceTakesEffectWithoutReplay: true,
      restartPersistence: true,
      liveHeadsUpWithoutFocusTheft: true,
      sameTurnMentionsUpdateOneHeadsUpInPlace: true,
      escapeRestoresBellFocus: true,
      dayDesktopAndNightCompactReducedMotionLayouts: true,
      twoHundredPercentZoomKeepsDrawerFunctional: true,
      horizontalOverflow: false
    },
    captures: {
      drawer: drawerCapture,
      settings: settingsCapture,
      compactSettings: compactSettingsCapture,
      compactHeadsUp: headsUpCapture,
      zoomedDrawer: zoomCapture
    }
  }, null, 2))
} finally {
  if (dayApp) await closeApp(dayApp)
  if (compactApp) await closeApp(compactApp)
}

async function createFixtureCamp() {
  const core = startCore(dataDir)
  try {
    await core.request('health.check')
    const preflight = await core.request('camps.creationPreflight')
    const workspace = await core.request('workspaces.inspect', { path: workspaceDir })
    const created = await core.request('camps.create', {
      commandId: crypto.randomUUID(),
      name: 'v0.71 通知 Episode 验收 Camp',
      workspace: { projectPath: workspace.projectPath },
      memberAgentIds: preflight.presentMembers.map((member) => member.agentId),
      defaultLeadAgentId: preflight.initialLeadAgentId,
      collaborationMode: 'peer'
    })
    assert(created.status === 'applied' && created.payload?.campId,
      `Could not create the Notification Episode fixture Camp: ${JSON.stringify(created)}`)
    return created.payload.campId
  } finally {
    await core.stop()
  }
}

async function insertApprovalEpisode(episodeId, modifier = 'now') {
  const timestamp = sqliteTimestamp(modifier)
  await runProcess('/usr/bin/sqlite3', [databasePath, `
    PRAGMA foreign_keys = ON;
    BEGIN IMMEDIATE;
    UPDATE notification_change_clock
    SET current_sequence = current_sequence + 1
    WHERE singleton = 1;
    INSERT INTO notification_episode(
      id, aggregation_key, recipient_user_id, kind, camp_id,
      camp_turn_id, source_message_id, approval_generation,
      version, attention_revision, created_change_sequence,
      last_change_sequence, sort_at, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(episodeId)},
      ${sqlLiteral(`approval:local_user:${campId}:1`)},
      'local_user', 'approval', ${sqlLiteral(campId)},
      NULL, NULL, 1, 0, 0,
      (SELECT current_sequence FROM notification_change_clock WHERE singleton = 1),
      (SELECT current_sequence FROM notification_change_clock WHERE singleton = 1),
      ${timestamp}, ${timestamp}, ${timestamp}
    );
    INSERT INTO notification_occurrence(
      id, episode_id, recipient_user_id, semantic, source_type,
      source_id, source_revision, camp_id, camp_turn_id,
      source_message_id, approval_id, admitted_episode_version,
      admitted_attention_revision, admitted_change_sequence, occurred_at
    ) VALUES (
      'occurrence-approval-initial', ${sqlLiteral(episodeId)}, 'local_user',
      'approval_pending', 'approval', 'approval-fixture', 1,
      ${sqlLiteral(campId)}, NULL, NULL, 'approval-fixture', 1, 1,
      (SELECT current_sequence FROM notification_change_clock WHERE singleton = 1),
      ${timestamp}
    );
    COMMIT;
  `])
}

async function insertTerminalTurn(turnId, status, modifier = 'now') {
  assert(['completed', 'failed', 'cancelled'].includes(status),
    `Unsupported terminal fixture status: ${status}`)
  const timestamp = sqliteTimestamp(modifier)
  await runProcess('/usr/bin/sqlite3', [databasePath, `
    PRAGMA foreign_keys = ON;
    INSERT INTO camp_turn(
      id, camp_id, trigger_type, trigger_id, status,
      execution_budget_schema_version, execution_budget_accepted_at,
      execution_budget_deadline_at, execution_budget_elapsed_seconds,
      execution_budget_max_agent_run_responsibilities,
      execution_budget_max_accepted_a2a,
      execution_budget_root_agent_run_responsibilities,
      version, created_at, updated_at, ended_at
    ) VALUES (
      ${sqlLiteral(turnId)}, ${sqlLiteral(campId)}, 'system_event',
      ${sqlLiteral(`notification-accept:${turnId}`)}, ${sqlLiteral(status)},
      1, ${timestamp}, datetime(${timestamp}, '+1 day'), 86400, 32, 16, 1,
      1, ${timestamp}, ${timestamp}, ${timestamp}
    );
  `])
}

async function insertRunningTurn(turnId) {
  await runProcess('/usr/bin/sqlite3', [databasePath, `
    PRAGMA foreign_keys = ON;
    INSERT INTO camp_turn(
      id, camp_id, trigger_type, trigger_id, status,
      execution_budget_schema_version, execution_budget_accepted_at,
      execution_budget_deadline_at, execution_budget_elapsed_seconds,
      execution_budget_max_agent_run_responsibilities,
      execution_budget_max_accepted_a2a,
      execution_budget_root_agent_run_responsibilities,
      version, created_at, updated_at, ended_at
    ) VALUES (
      ${sqlLiteral(turnId)}, ${sqlLiteral(campId)}, 'system_event',
      ${sqlLiteral(`notification-accept:${turnId}`)}, 'running',
      1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      datetime('now', '+1 day'), 86400, 32, 16, 1,
      1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL
    );
  `])
}

async function insertMessageMention(messageId, body, campTurnId = null, modifier = 'now') {
  const timestamp = sqliteTimestamp(modifier)
  const structuredContent = JSON.stringify([
    { kind: 'current_user_mention', userId: 'local_user' },
    { kind: 'text', text: body }
  ])
  await runProcess('/usr/bin/sqlite3', [databasePath, `
    PRAGMA foreign_keys = ON;
    BEGIN IMMEDIATE;
    UPDATE camp
    SET last_message_sequence = last_message_sequence + 1,
        version = version + 1,
        updated_at = ${timestamp}
    WHERE id = ${sqlLiteral(campId)};
    INSERT INTO camp_message(
      id, camp_id, sequence, author_type, author_id, source_agent_run_id,
      body, address_mode, addressed_agent_ids_json, reply_to_camp_message_id,
      camp_turn_id, agent_run_id, tombstoned_at, version,
      created_at, updated_at, structured_content_json, content_digest
    ) SELECT
      ${sqlLiteral(messageId)}, id, last_message_sequence, 'agent',
      COALESCE(default_lead_agent_id, 'agent-muwa'), NULL,
      ${sqlLiteral(`@你 ${body}`)}, 'default', '[]', NULL,
      ${campTurnId ? sqlLiteral(campTurnId) : 'NULL'}, NULL, NULL, 1,
      ${timestamp}, ${timestamp}, ${sqlLiteral(structuredContent)},
      ${sqlLiteral(`sha256:notification-accept:${messageId}`)}
    FROM camp WHERE id = ${sqlLiteral(campId)};
    COMMIT;
  `])
}

async function openNotificationCenter(cdp) {
  const opened = await evaluate(cdp, `(() => {
    const button = document.querySelector('.notification-trigger')
    button?.click()
    return button?.getAttribute('aria-label') ?? null
  })()`)
  assert(opened, 'The global notification button was unavailable')
  await waitForSelector(cdp, '.notification-drawer')
}

async function selectNotificationFilter(cdp, label) {
  const selected = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.notification-filter button')]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
    button?.click()
    return Boolean(button)
  })()`)
  assert(selected, `Notification filter ${JSON.stringify(label)} was unavailable`)
  await waitForExpression(cdp, `
    [...document.querySelectorAll('.notification-filter button')]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
      ?.getAttribute('aria-pressed') === 'true'
  `)
}

async function assertNotificationDrawer(cdp, expectedRows, context, expectedUnread = expectedRows) {
  const state = await evaluate(cdp, `({
    rows: document.querySelectorAll('.notification-row').length,
    title: document.querySelector('.notification-drawer-header')?.textContent ?? '',
    copy: document.querySelector('.notification-list')?.textContent ?? '',
    drawerOverflow: (() => {
      const node = document.querySelector('.notification-drawer')
      return node ? node.scrollWidth > node.clientWidth + 1 : true
    })(),
    documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
    closeName: document.querySelector('.notification-drawer .dialog-close')?.getAttribute('aria-label')
  })`)
  assert(state.rows === expectedRows,
    `${context} Episode row count was ${state.rows}, expected ${expectedRows}`)
  if (expectedUnread !== null) {
    assert(state.title.includes(`${expectedUnread} 项未读`),
      `${context} unread Episode summary was incorrect: ${JSON.stringify(state.title)}`)
  }
  assert(state.copy.includes('待审批')
      && state.copy.includes('等待你的下一步')
      && state.copy.includes('执行未完成')
      && state.copy.includes('提到你')
      && !state.copy.includes('README.md'),
  `${context} content was not fixed and data-minimized: ${JSON.stringify(state.copy)}`)
  assert(!state.drawerOverflow && !state.documentOverflow,
    `${context} notification center overflowed horizontally: ${JSON.stringify(state)}`)
  assert(state.closeName === '关闭通知中心',
    `${context} notification center close button had no accessible name`)
}

async function assertNotificationBadge(cdp, expected, timeout = 15_000) {
  await waitForExpression(cdp, `(() => {
    const button = document.querySelector('.notification-trigger')
    return button?.getAttribute('aria-label') === ${JSON.stringify(
      expected > 0 ? `通知，${expected} 项未读` : '通知'
    )}
  })()`, timeout)
  const badge = await evaluate(cdp,
    `document.querySelector('.notification-trigger-badge')?.textContent?.trim() ?? null`)
  assert(badge === (expected > 0 ? String(expected) : null),
    `Notification badge was ${JSON.stringify(badge)}, expected ${expected}`)
}

async function openNotificationSettings(cdp) {
  const opened = await evaluate(cdp, `(() => {
    const settings = document.querySelector('.unified-sidebar-footer button[aria-label="设置"]')
    settings?.click()
    return Boolean(settings)
  })()`)
  assert(opened, 'Could not open Settings')
  await waitForSelector(cdp, '.settings-sidebar-menu')
  const selected = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.settings-sidebar-menu button')]
      .find((candidate) => candidate.textContent?.includes('通知'))
    button?.click()
    return Boolean(button)
  })()`)
  assert(selected, 'Notification Settings entry was unavailable')
  await waitForSelector(cdp, '.notification-settings')
}

async function assertNotificationPreferences(cdp) {
  await waitForExpression(cdp,
    `document.querySelectorAll('.notification-switch input[role="switch"]').length === 5`)
  const state = await evaluate(cdp, `(() => ({
    values: [...document.querySelectorAll('.notification-switch input[role="switch"]')]
      .map((input) => input.checked),
    names: [...document.querySelectorAll('.notification-switch input[role="switch"]')]
      .map((input) => input.getAttribute('aria-label')),
    scenarios: [...document.querySelectorAll('.notification-scenario-heading h3')]
      .map((heading) => heading.textContent?.trim()),
    scenarioCounts: [...document.querySelectorAll('.notification-scenario-heading span')]
      .map((count) => count.textContent?.trim()),
    hasMasterPanel: Boolean(document.querySelector('.notification-master-panel')),
    hasBoundarySection: Boolean(document.querySelector('.notification-boundary')),
    documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
  }))()`)
  assert(state.values.every(Boolean),
    `Notification preferences did not default on: ${JSON.stringify(state.values)}`)
  assert(JSON.stringify(state.names) === JSON.stringify([
    '浮层提醒', '待审批', '提到你', '本轮完成', '执行未完成'
  ]), `Notification preference order or accessible names drifted: ${JSON.stringify(state.names)}`)
  assert(JSON.stringify(state.scenarios) === JSON.stringify(['需要响应', '本轮结果'])
      && state.scenarioCounts.every((count) => count === '2 / 2 项已开启')
      && state.hasMasterPanel && !state.hasBoundarySection && !state.documentOverflow,
  `Notification preference hierarchy was incomplete: ${JSON.stringify(state)}`)
}

async function setPrimaryHeadsUpPreference(cdp, enabled) {
  const current = await evaluate(cdp,
    `document.querySelector('.notification-switch input[role="switch"]')?.checked`)
  if (current !== enabled) {
    await evaluate(cdp,
      `document.querySelector('.notification-switch input[role="switch"]')?.click()`)
  }
  await waitForExpression(cdp,
    `window.rovai.request('notifications.preference.get')
      .then((value) => value.headsUpEnabled === ${JSON.stringify(enabled)})`,
  15_000, true)
  await waitForExpression(cdp,
    `document.querySelector('.notification-switch input[role="switch"]')?.checked
      === ${JSON.stringify(enabled)}`)
  await waitForExpression(cdp, `(() => {
    const children = [...document.querySelectorAll(
      '.notification-scenario .notification-switch input[role="switch"]'
    )]
    const counts = [...document.querySelectorAll('.notification-scenario-heading span')]
      .map((count) => count.textContent ?? '')
    return children.length === 4
      && children.every((input) => input.disabled === ${JSON.stringify(!enabled)})
      && counts.every((count) => count.includes(${JSON.stringify(enabled ? '已开启' : '已保留')}))
  })()`)
}

async function assertNotificationPreferenceRecovery(cdp) {
  const current = await request(cdp, 'notifications.preference.get')
  assert(current.approvalHeadsUpEnabled === true,
    `Approval heads-up preference was not available for recovery: ${JSON.stringify(current)}`)
  const baseline = await evaluate(cdp, `(() => {
    const panel = document.querySelector('.settings-panel-notifications')
    const input = document.querySelector(
      '[data-notification-preference="approvalHeadsUpEnabled"]'
    )
    if (!panel || !input) return null
    panel.scrollTop = Math.min(48, Math.max(0, panel.scrollHeight - panel.clientHeight))
    input.focus({ preventScroll: true })
    return {
      scrollTop: panel.scrollTop,
      maxScroll: panel.scrollHeight - panel.clientHeight,
      focused: document.activeElement === input
    }
  })()`)
  assert(baseline?.focused && baseline.maxScroll > 0,
    `Could not establish preference focus and scroll baseline: ${JSON.stringify(baseline)}`)

  const externalUpdate = await request(cdp, 'notifications.preference.update', {
    commandId: crypto.randomUUID(),
    command: {
      expectedVersion: current.version,
      headsUpEnabled: current.headsUpEnabled,
      approvalHeadsUpEnabled: false,
      userMentionHeadsUpEnabled: current.userMentionHeadsUpEnabled,
      turnCompletedHeadsUpEnabled: current.turnCompletedHeadsUpEnabled,
      turnIncompleteHeadsUpEnabled: current.turnIncompleteHeadsUpEnabled
    }
  })
  assert(externalUpdate.status === 'applied',
    `Could not create a real preference version conflict: ${JSON.stringify(externalUpdate)}`)
  await evaluate(cdp, `document.querySelector(
    '[data-notification-preference="approvalHeadsUpEnabled"]'
  )?.click()`)
  await waitForSelector(cdp, '.notification-settings-error')
  await waitForExpression(cdp,
    `document.querySelector('.notification-switches')?.getAttribute('aria-busy') === 'false'`)
  const failed = await evaluate(cdp, `(() => {
    const panel = document.querySelector('.settings-panel-notifications')
    const input = document.querySelector(
      '[data-notification-preference="approvalHeadsUpEnabled"]'
    )
    return {
      checked: input?.checked,
      focused: document.activeElement === input,
      scrollTop: panel?.scrollTop,
      error: document.querySelector('.notification-settings-error')?.textContent ?? ''
    }
  })()`)
  assert(failed.checked === false
      && failed.focused
      && Math.abs(failed.scrollTop - baseline.scrollTop) <= 1
      && failed.error.includes('其他窗口更新'),
  `Preference conflict lost focus, scroll, or authoritative state: ${JSON.stringify({ baseline, failed })}`)

  await clickFirstButton(cdp, '.notification-settings-error button')
  await waitForExpression(cdp, `!document.querySelector('.notification-settings-error')`)
  await waitForExpression(cdp,
    `window.rovai.request('notifications.preference.get')
      .then((value) => value.approvalHeadsUpEnabled === false)`,
  15_000, true)
  const retried = await evaluate(cdp, `(() => {
    const panel = document.querySelector('.settings-panel-notifications')
    const input = document.querySelector(
      '[data-notification-preference="approvalHeadsUpEnabled"]'
    )
    return {
      focused: document.activeElement === input,
      scrollTop: panel?.scrollTop
    }
  })()`)
  assert(retried.focused && Math.abs(retried.scrollTop - baseline.scrollTop) <= 1,
    `Preference retry lost focus or scroll: ${JSON.stringify({ baseline, retried })}`)

  await evaluate(cdp, `document.querySelector(
    '[data-notification-preference="approvalHeadsUpEnabled"]'
  )?.click()`)
  await waitForExpression(cdp,
    `window.rovai.request('notifications.preference.get')
      .then((value) => value.approvalHeadsUpEnabled === true)`,
  15_000, true)
}

async function focusNewConversation(cdp) {
  const focused = await evaluate(cdp, `(() => {
    const target = document.querySelector('.unified-sidebar button[aria-label="新对话"]')
    target?.focus()
    return target?.getAttribute('aria-label') ?? null
  })()`)
  assert(focused === '新对话', 'Could not establish the heads-up focus baseline')
}

async function closeDialogWithEscape(cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
  await waitForExpression(cdp, `!document.querySelector('.notification-drawer')`)
  await wait(50)
}

async function clickEpisodeAction(cdp, episodeId, label) {
  const clicked = await evaluate(cdp, `(() => {
    const row = document.querySelector(
      '[data-notification-id=${JSON.stringify(episodeId)}]'
    )
    const button = [...(row?.querySelectorAll('button') ?? [])]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert(clicked, `Could not click ${JSON.stringify(label)} for Episode ${episodeId}`)
}

async function clickButton(cdp, selector, label) {
  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert(clicked, `Could not click enabled button ${JSON.stringify(label)} within ${selector}`)
}

async function clickFirstButton(cdp, selector) {
  const clicked = await evaluate(cdp, `(() => {
    const button = document.querySelector(${JSON.stringify(selector)})
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert(clicked, `Could not click an enabled button within ${selector}`)
}

async function request(cdp, method, params = {}) {
  return evaluate(cdp,
    `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`, true)
}

async function setTheme(cdp, preference) {
  await evaluate(cdp, `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  const expectedTheme = preference === 'night' ? 'night' : 'day'
  await waitForExpression(cdp,
    `document.documentElement.dataset.theme === ${JSON.stringify(expectedTheme)}`)
}

async function emulateDesktopZoom(cdp, physicalWidth, physicalHeight, zoomFactor) {
  const cssWidth = Math.round(physicalWidth / zoomFactor)
  const cssHeight = Math.round(physicalHeight / zoomFactor)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: cssWidth,
    height: cssHeight,
    deviceScaleFactor: zoomFactor,
    mobile: false,
    screenWidth: physicalWidth,
    screenHeight: physicalHeight
  })
  await waitForExpression(cdp, `(() => {
    return window.innerWidth === ${cssWidth}
      && window.innerHeight === ${cssHeight}
      && Math.abs(window.devicePixelRatio - ${zoomFactor}) < 0.01
  })()`)
}

async function assertZoomedNotificationFunctionality(cdp) {
  const state = await evaluate(cdp, `(() => {
    const drawer = document.querySelector('.notification-drawer')
    const list = document.querySelector('.notification-list')
    const close = document.querySelector('.notification-drawer .dialog-close')
    const closeRect = close?.getBoundingClientRect()
    const before = list?.scrollTop ?? 0
    if (list) list.scrollTop = list.scrollHeight
    const after = list?.scrollTop ?? 0
    if (list) list.scrollTop = before
    return {
      cssViewport: [window.innerWidth, window.innerHeight],
      devicePixelRatio: window.devicePixelRatio,
      physicalViewport: [
        Math.round(window.innerWidth * window.devicePixelRatio),
        Math.round(window.innerHeight * window.devicePixelRatio)
      ],
      drawerVisible: Boolean(drawer),
      closeVisible: Boolean(closeRect
        && closeRect.width > 0
        && closeRect.height > 0
        && closeRect.bottom > 0
        && closeRect.top < window.innerHeight),
      filtersVisible: document.querySelectorAll('.notification-filter button').length === 2,
      scrollable: Boolean(list && list.scrollHeight > list.clientHeight && after > before),
      drawerOverflow: drawer ? drawer.scrollWidth > drawer.clientWidth + 1 : true,
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
    }
  })()`)
  assert(state.cssViewport[0] === 520 && state.cssViewport[1] === 350
      && Math.abs(state.devicePixelRatio - 2) < 0.01
      && state.physicalViewport[0] === 1040 && state.physicalViewport[1] === 700
      && state.drawerVisible && state.closeVisible && state.filtersVisible && state.scrollable
      && !state.drawerOverflow && !state.documentOverflow,
  `200% zoom hid Notification Center functionality: ${JSON.stringify(state)}`)
}

async function launchApp(port, width, height, reducedMotion) {
  const executable = join(appPath, 'Contents', 'MacOS', 'Rovai-ai')
  const stderr = []
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`
  ], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ROVAI_ALLOW_ISOLATED_INSTANCE: '1' }
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
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    })
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{
        name: 'prefers-reduced-motion',
        value: reducedMotion ? 'reduce' : 'no-preference'
      }]
    })
    await waitForExpression(cdp,
      `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
    await waitForExpression(cdp,
      `Boolean(document.querySelector('.notification-trigger'))`, 45_000)
    const health = await request(cdp, 'health.check')
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
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5_000) {
    try {
      await fetch(`http://127.0.0.1:${app.port}/json`)
    } catch {
      await terminateChild(app.child)
      return
    }
    await wait(100)
  }
  await terminateChild(app.child)
  throw new Error(`Isolated packaged App did not close on debug port ${app.port}`)
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
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  })
  await writeFile(path, Buffer.from(result.result.data, 'base64'))
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  })
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description
      ?? response.result.exceptionDetails.text
      ?? `Evaluation failed: ${expression}`)
  }
  return response.result?.result?.value
}

async function waitForSelector(cdp, selector, timeoutMs = 10_000) {
  await waitForExpression(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`, timeoutMs)
}

async function waitForExpression(cdp, expression, timeoutMs = 10_000, awaitPromise = false) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression, awaitPromise)) return
    await wait(100)
  }
  if (await evaluate(cdp, expression, awaitPromise)) return
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
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message)
  })
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('CDP connection closed'))
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
    close() {
      socket.close()
    }
  }
}

function startCore(dataDirectory) {
  const child = spawn(join(root, 'resources', 'bin', 'rovai-core'), [
    '--data-dir',
    dataDirectory,
    '--skill-library-root',
    join(dataDirectory, 'managed-skill-library')
  ], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.pipe(process.stderr)
  const pending = new Map()
  let nextId = 1
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method) return
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
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

function sqliteTimestamp(modifier) {
  return modifier === 'now'
    ? "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
    : `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ${sqlLiteral(modifier)})`
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function runProcess(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code, signal) => code === 0
      ? resolveRun(stdout.join(''))
      : rejectRun(new Error(`${command} exited with ${code ?? signal}: ${stderr.join('')}`)))
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
