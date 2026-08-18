import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createServer } from 'node:net'
import { seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai-ai.app'))
const fixtureRoot = process.env.ROVAI_CONVERSATION_FIND_ACCEPT_FIXTURE_ROOT
  ?? await mkdtemp(join(tmpdir(), 'rovai-conversation-find-ui-accept-'))
const dataDir = join(fixtureRoot, 'user-data')
const outputDir = process.env.ROVAI_CONVERSATION_FIND_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-conversation-find-ui-captures-'))
const runtimeTempDir = process.env.ROVAI_CONVERSATION_FIND_ACCEPT_RUNTIME_TMP
  ?? await mkdtemp('/tmp/rv-find-')
const databasePath = join(dataDir, 'rovai.sqlite')
const campTitle = '当前会话查找验收'
const query = 'orbit-needle'

await mkdir(dataDir, { recursive: true })
await mkdir(outputDir, { recursive: true })
seedCompletedOnboardingForAcceptance(dataDir)
const fixture = await createFixture()

let app = null
let compactApp = null
try {
  app = await launchApp(await availableLoopbackPort(), 1440, 920, false)
  await setTheme(app.cdp, 'day')
  const desktopCapture = join(outputDir, 'conversation-find-day-1440x920.png')
  const desktop = await verifyConversationFind(
    app.cdp,
    fixture,
    '1440×920',
    desktopCapture
  )
  const mapReturn = await verifyMapShortcutReturn(app.cdp)
  const mapButtonFocus = await verifyMapButtonRetainsFocus(app.cdp)
  const nonCampBoundary = await verifyNonCampBoundary(app.cdp, fixture.campId)
  await closeApp(app)
  app = null

  compactApp = await launchApp(await availableLoopbackPort(), 1040, 700, true)
  await setTheme(compactApp.cdp, 'night')
  await openCamp(compactApp.cdp, fixture.campId)
  await chooseConversationView(compactApp.cdp, 'conversation')
  await focusTimeline(compactApp.cdp)
  await pressShortcut(compactApp.cdp)
  await typeQuery(compactApp.cdp, query)
  await waitForFindResult(compactApp.cdp, '4 / 4', 'find-message-64')
  const compact = await collectFindLayout(compactApp.cdp)
  assertFindLayout(compact, '1040×700')
  const compactCapture = join(outputDir, 'conversation-find-night-1040x700.png')
  await capture(compactApp.cdp, compactCapture)

  const report = {
    ok: true,
    app: basename(appPath),
    fixtureRoot,
    outputDir,
    verified: {
      exactCompleteHistoryCount: desktop.exactCount,
      readyQueryEditDoesNotAnnounceNoMatch: desktop.readyQueryEdit,
      unloadedOlderTargetUsesBoundedWindow: desktop.loadedOlderTarget,
      exactOccurrenceVisibilityInLongMessage: desktop.longMessageOccurrenceVisibility,
      enterAndShiftEnterWrap: desktop.wrapTraversal,
      escapeRestoresFocusAndReadingAnchor: desktop.escapeRestore,
      cssHighlightsAndCurrentMessageRail: desktop.highlightPresentation,
      mapCommandFReturnsToConversation: mapReturn,
      mapButtonRetainsFocusWhenClosingFind: mapButtonFocus,
      nonCampPagesDoNotSummonConversationFind: nonCampBoundary,
      dayDesktopLayout: desktop.layout,
      nightCompactReducedMotionLayout: compact
    },
    captures: {
      desktop: desktopCapture,
      compact: compactCapture
    }
  }
  const reportPath = join(outputDir, 'conversation-find-acceptance.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ ...report, reportPath }, null, 2))
} finally {
  if (app) await closeApp(app)
  if (compactApp) await closeApp(compactApp)
}

async function createFixture() {
  const core = startCore(dataDir)
  let campId
  let leadAgentId
  try {
    const health = await core.request('health.check')
    assert(health?.database?.ok, `Core did not initialize acceptance data: ${JSON.stringify(health)}`)
    const preflight = await core.request('camps.creationPreflight')
    leadAgentId = preflight.initialLeadAgentId
    assert(leadAgentId, `Acceptance fixture has no Default Lead: ${JSON.stringify(preflight)}`)
    const created = await core.request('camps.create', {
      commandId: randomUUID(),
      name: campTitle,
      workspace: null,
      memberAgentIds: [leadAgentId],
      defaultLeadAgentId: leadAgentId,
      collaborationMode: 'peer',
      activationState: 'active'
    })
    campId = created?.payload?.campId
    assert(created?.status === 'applied' && campId,
      `Could not create conversation find Camp: ${JSON.stringify(created)}`)
  } finally {
    await core.stop()
  }

  const rows = []
  for (let sequence = 1; sequence <= 65; sequence += 1) {
    const hour = 8 + Math.floor((sequence - 1) / 60)
    const minute = (sequence - 1) % 60
    const createdAt = `2026-08-18T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`
    let authorType = sequence % 3 === 0 ? 'agent' : 'user'
    let authorId = authorType === 'agent' ? leadAgentId : 'local_user'
    let body = `会话查找验收消息 ${sequence}`
    if (sequence === 2) {
      authorType = 'system'
      authorId = 'system'
      body = 'orbit-needle 只在系统消息中，不应计入'
    } else if (sequence === 3) {
      body = 'Orbit-Needle at the beginning of unloaded history.'
    } else if (sequence === 33) {
      body = [
        'ORBIT-NEEDLE at the top of one deliberately long message.',
        ...Array.from({ length: 64 }, (_, index) =>
          `Long message paragraph ${index + 1} keeps the two exact occurrences far apart.`),
        'Final orbit-needle at the bottom of the same long message.'
      ].join('\n\n')
    } else if (sequence === 64) {
      body = 'Final orbit-needle near the current reading position.'
    }
    rows.push(`(
      ${sqlLiteral(`find-message-${sequence}`)}, ${sqlLiteral(campId)}, ${sequence},
      ${sqlLiteral(authorType)}, ${sqlLiteral(authorId)}, ${sqlLiteral(body)},
      ${sqlLiteral(JSON.stringify([{ kind: 'text', text: body }]))},
      'default', '[]', 1,
      ${sqlLiteral(createdAt)}, ${sqlLiteral(createdAt)}
    )`)
  }
  await runSql(databasePath, `
    PRAGMA busy_timeout = 5000;
    BEGIN IMMEDIATE;
    INSERT INTO camp_message(
      id, camp_id, sequence, author_type, author_id, body,
      structured_content_json, address_mode, addressed_agent_ids_json,
      version, created_at, updated_at
    ) VALUES ${rows.join(',\n')};
    UPDATE camp
    SET activation_state = 'active', updated_at = '2026-08-18T09:05:00Z'
    WHERE id = ${sqlLiteral(campId)};
    COMMIT;
  `)
  return { campId, leadAgentId }
}

async function verifyConversationFind(cdp, fixture, context, screenshotPath) {
  await openCamp(cdp, fixture.campId)
  await chooseConversationView(cdp, 'conversation')
  await waitForExpression(cdp,
    `document.querySelectorAll('.camp-timeline [data-message-id]').length === 20`)
  const baseline = await focusTimeline(cdp)
  await pressShortcut(cdp)
  await waitForExpression(cdp,
    `document.activeElement?.matches('.conversation-find-form input') === true`)
  await typeQuery(cdp, query)
  await waitForFindResult(cdp, '4 / 4', 'find-message-64')
  const initial = await evaluate(cdp, `(() => ({
    count: document.querySelector('.conversation-find-count')?.textContent?.trim(),
    current: document.querySelector('.conversation-find-current-message')?.dataset.messageId,
    inputFocused: document.activeElement?.matches('.conversation-find-form input') === true,
    systemSelected: Boolean(document.querySelector('[data-message-id="find-message-2"].conversation-find-current-message'))
  }))()`)
  assert(initial.count === '4 / 4' && initial.current === 'find-message-64'
    && initial.inputFocused && !initial.systemSelected,
  `Initial exact result was incorrect: ${JSON.stringify(initial)}`)
  const readyQueryEdit = await verifyReadyQueryEditDoesNotAnnounceNoMatch(cdp)

  await pressKey(cdp, 'Enter', 'Enter', 13)
  await waitForFindResult(cdp, '1 / 4', 'find-message-3')
  const older = await evaluate(cdp, `(() => ({
    renderedMessages: document.querySelectorAll('.camp-timeline [data-message-id]').length,
    olderPresent: Boolean(document.querySelector('[data-message-id="find-message-3"]')),
    inputFocused: document.activeElement?.matches('.conversation-find-form input') === true,
    passiveHighlight: Boolean(CSS.highlights?.get('conversation-find-match')),
    currentHighlight: Boolean(CSS.highlights?.get('conversation-find-current')),
    currentRail: getComputedStyle(document.querySelector('.conversation-find-current-message'), '::after').width
  }))()`)
  assert(older.renderedMessages > 20 && older.olderPresent && older.inputFocused,
    `Older match did not load through a bounded target window: ${JSON.stringify(older)}`)
  assert(older.passiveHighlight && older.currentHighlight && older.currentRail === '1px',
    `Find highlights/current message rail were missing: ${JSON.stringify(older)}`)

  await pressKey(cdp, 'Enter', 'Enter', 13)
  await waitForFindResult(cdp, '2 / 4', 'find-message-33')
  const longMessageFirstOccurrence = await collectCurrentFindVisibility(cdp)
  assert(longMessageFirstOccurrence.visible,
    `The first occurrence in a long message was outside the safe viewport: ${JSON.stringify(longMessageFirstOccurrence)}`)

  await pressKey(cdp, 'Enter', 'Enter', 13)
  await waitForFindResult(cdp, '3 / 4', 'find-message-33')
  const longMessageLastOccurrence = await collectCurrentFindVisibility(cdp)
  assert(longMessageLastOccurrence.visible,
    `The last occurrence in a long message was outside the safe viewport: ${JSON.stringify(longMessageLastOccurrence)}`)

  await pressKey(cdp, 'Enter', 'Enter', 13)
  await waitForFindResult(cdp, '4 / 4', 'find-message-64')
  const layout = await collectFindLayout(cdp)
  assertFindLayout(layout, context)
  await capture(cdp, screenshotPath)
  await pressKey(cdp, 'Escape', 'Escape', 27)
  await waitForExpression(cdp, `!document.querySelector('.conversation-find-surface')`)
  await waitForExpression(cdp, `(() => {
    const timeline = document.querySelector('.camp-timeline')
    const viewport = timeline?.getBoundingClientRect()
    const anchor = document.querySelector(${JSON.stringify(`[data-message-id="${baseline.firstVisibleMessageId}"]`)})
    return document.activeElement === timeline
      && viewport && anchor
      && Math.abs((anchor.getBoundingClientRect().top - viewport.top) - ${baseline.topOffset}) <= 2
  })()`)
  const restored = await evaluate(cdp, `(() => {
    const timeline = document.querySelector('.camp-timeline')
    const viewport = timeline.getBoundingClientRect()
    const firstVisible = [...timeline.querySelectorAll('[data-message-id]')]
      .find((node) => {
        const rect = node.getBoundingClientRect()
        return rect.bottom > viewport.top && rect.top < viewport.bottom
      })
    return {
      activeTimeline: document.activeElement === timeline,
      scrollTop: timeline.scrollTop,
      firstVisibleMessageId: firstVisible?.dataset.messageId ?? null,
      topOffset: firstVisible ? firstVisible.getBoundingClientRect().top - viewport.top : null,
      findCurrentClassCount: document.querySelectorAll('.conversation-find-current-message').length,
      highlightCount: Number(Boolean(CSS.highlights?.get('conversation-find-match')))
        + Number(Boolean(CSS.highlights?.get('conversation-find-current')))
    }
  })()`)
  assert(restored.activeTimeline
    && restored.firstVisibleMessageId === baseline.firstVisibleMessageId
    && Math.abs(restored.topOffset - baseline.topOffset) <= 2
    && restored.findCurrentClassCount === 0
    && restored.highlightCount === 0,
  `Escape did not restore reading/focus state: ${JSON.stringify({ baseline, restored })}`)

  return {
    exactCount: initial,
    readyQueryEdit,
    loadedOlderTarget: older,
    longMessageOccurrenceVisibility: {
      first: longMessageFirstOccurrence,
      last: longMessageLastOccurrence
    },
    wrapTraversal: true,
    escapeRestore: { baseline, restored },
    highlightPresentation: older,
    layout
  }
}

async function collectCurrentFindVisibility(cdp) {
  return evaluate(cdp, `(() => {
    const timeline = document.querySelector('.camp-timeline')
    const surface = document.querySelector('.conversation-find-surface')
    const currentHighlight = CSS.highlights?.get('conversation-find-current')
    const range = currentHighlight ? [...currentHighlight][0] : null
    if (!timeline || !surface || !range) return { visible: false, reason: 'missing-target' }
    const viewport = timeline.getBoundingClientRect()
    const surfaceBounds = surface.getBoundingClientRect()
    const target = range.getBoundingClientRect()
    const safeTop = Math.max(viewport.top, surfaceBounds.bottom + 8)
    const safeBottom = viewport.bottom - 12
    return {
      visible: target.top >= safeTop - 1 && target.bottom <= safeBottom + 1,
      targetTop: target.top,
      targetBottom: target.bottom,
      safeTop,
      safeBottom,
      scrollTop: timeline.scrollTop
    }
  })()`)
}

async function verifyReadyQueryEditDoesNotAnnounceNoMatch(cdp) {
  await evaluate(cdp, `(() => {
    const status = document.querySelector('#conversation-find-status')
    const count = document.querySelector('.conversation-find-count')
    const observations = { announcements: [], counts: [] }
    const record = () => {
      observations.announcements.push(status?.textContent?.trim() ?? '')
      observations.counts.push(count?.textContent?.trim() ?? '')
    }
    const observer = new MutationObserver(record)
    if (status) observer.observe(status, { childList: true, characterData: true, subtree: true })
    if (count) observer.observe(count, { childList: true, characterData: true, subtree: true })
    record()
    globalThis.__conversationFindEditObservation = { observer, observations }
  })()`)
  await typeQuery(cdp, 'x')
  await waitForExpression(cdp,
    `document.querySelector('.conversation-find-form input')?.value === ${JSON.stringify(`${query}x`)}`)
  await wait(50)
  await pressKey(cdp, 'Backspace', 'Backspace', 8)
  await waitForFindResult(cdp, '4 / 4', 'find-message-64')
  const result = await evaluate(cdp, `(() => {
    const observation = globalThis.__conversationFindEditObservation
    observation?.observer?.disconnect()
    delete globalThis.__conversationFindEditObservation
    return observation?.observations ?? null
  })()`)
  assert(result
    && result.announcements.includes('正在查找当前会话')
    && result.counts.includes('正在查找')
    && !result.announcements.includes('当前会话中没有匹配项')
    && !result.counts.includes('无匹配')
    && !result.counts.includes('搜索失败'),
  `Editing a ready query exposed a stale result announcement: ${JSON.stringify(result)}`)
  return result
}

async function verifyMapShortcutReturn(cdp) {
  await chooseConversationView(cdp, 'world')
  await waitForExpression(cdp,
    `document.querySelector('.camp-world-map-panel')?.hasAttribute('hidden') === false`)
  await pressShortcut(cdp)
  await waitForExpression(cdp, `(() => {
    const input = document.querySelector('.conversation-find-form input')
    return document.querySelector('.camp-world-map-panel')?.hasAttribute('hidden') === true
      && document.querySelector('.camp-conversation-view-controls button[aria-pressed="true"]')?.textContent?.trim() === '会话'
      && document.activeElement === input
  })()`)
  const state = await evaluate(cdp, `({
    findVisible: Boolean(document.querySelector('.conversation-find-surface')),
    worldHidden: document.querySelector('.camp-world-map-panel')?.hasAttribute('hidden'),
    focused: document.activeElement?.getAttribute('aria-label')
  })`)
  await pressKey(cdp, 'Escape', 'Escape', 27)
  return state
}

async function verifyMapButtonRetainsFocus(cdp) {
  await chooseConversationView(cdp, 'conversation')
  await pressShortcut(cdp)
  await waitForExpression(cdp,
    `document.activeElement?.matches('.conversation-find-form input') === true`)
  const focused = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.camp-conversation-view-controls button')]
      .find((candidate) => candidate.textContent?.trim() === '地图')
    button?.focus({ preventScroll: true })
    return document.activeElement === button
  })()`)
  assert(focused, 'Could not focus the map button while conversation find was open')
  await pressNativeButtonEnter(cdp)
  await waitForExpression(cdp, `(() => {
    const active = document.activeElement
    return !document.querySelector('.conversation-find-surface')
      && document.querySelector('.camp-world-map-panel')?.hasAttribute('hidden') === false
      && active?.textContent?.trim() === '地图'
  })()`)
  const state = await evaluate(cdp, `({
    findVisible: Boolean(document.querySelector('.conversation-find-surface')),
    worldVisible: document.querySelector('.camp-world-map-panel')?.hasAttribute('hidden') === false,
    focused: document.activeElement?.textContent?.trim(),
    composerFocused: document.activeElement?.matches('.composer-editor') === true
  })`)
  assert(!state.findVisible && state.worldVisible && state.focused === '地图'
    && !state.composerFocused,
  `Closing find through the map button moved focus: ${JSON.stringify(state)}`)
  return state
}

async function verifyNonCampBoundary(cdp, campId) {
  const clicked = await evaluate(cdp, `(() => {
    const button = document.querySelector('.rail-button[aria-label="队员"]')
    button?.click()
    return Boolean(button)
  })()`)
  assert(clicked, 'Could not open the Members page for non-Camp shortcut acceptance')
  await waitForExpression(cdp,
    `Boolean(document.querySelector('.members-workspace')) && !document.querySelector('.camp-workspace')`)
  await pressShortcut(cdp)
  await wait(250)
  const state = await evaluate(cdp, `({
    membersVisible: Boolean(document.querySelector('.members-workspace')),
    campMounted: Boolean(document.querySelector('.camp-workspace')),
    findVisible: Boolean(document.querySelector('.conversation-find-surface'))
  })`)
  assert(state.membersVisible && !state.campMounted && !state.findVisible,
    `Non-Camp page summoned conversation find: ${JSON.stringify(state)}`)
  await openCamp(cdp, campId)
  return state
}

async function collectFindLayout(cdp) {
  return evaluate(cdp, `(() => {
    const stage = document.querySelector('.camp-conversation-stage')
    const surface = document.querySelector('.conversation-find-surface')
    const controls = document.querySelector('.camp-conversation-view-controls')
    const input = document.querySelector('.conversation-find-form input')
    const stageRect = stage?.getBoundingClientRect()
    const surfaceRect = surface?.getBoundingClientRect()
    const controlsRect = controls?.getBoundingClientRect()
    return {
      viewport: { width: innerWidth, height: innerHeight },
      stage: stageRect ? { left: stageRect.left, right: stageRect.right, top: stageRect.top } : null,
      surface: surfaceRect ? {
        left: surfaceRect.left, right: surfaceRect.right,
        top: surfaceRect.top, bottom: surfaceRect.bottom,
        width: surfaceRect.width, height: surfaceRect.height
      } : null,
      controls: controlsRect ? {
        left: controlsRect.left, right: controlsRect.right,
        top: controlsRect.top, bottom: controlsRect.bottom
      } : null,
      overlap: surfaceRect && controlsRect
        ? Math.max(0, Math.min(surfaceRect.right, controlsRect.right) - Math.max(surfaceRect.left, controlsRect.left))
        : null,
      inputFocused: document.activeElement === input,
      horizontalOverflow: stage ? stage.scrollWidth > stage.clientWidth + 1 : true,
      theme: document.documentElement.dataset.theme,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches
    }
  })()`)
}

function assertFindLayout(layout, context) {
  assert(layout.surface && layout.controls && layout.stage
    && layout.surface.left >= layout.stage.left
    && layout.surface.right <= layout.stage.right
    && layout.surface.top >= layout.stage.top
    && layout.surface.bottom <= layout.viewport.height
    && layout.overlap === 0
    && layout.inputFocused
    && !layout.horizontalOverflow,
  `Conversation find escaped or overlapped the ${context} layout: ${JSON.stringify(layout)}`)
}

async function focusTimeline(cdp) {
  const baseline = await evaluate(cdp, `(() => {
    const timeline = document.querySelector('.camp-timeline')
    if (!(timeline instanceof HTMLElement)) return null
    timeline.scrollTop = timeline.scrollHeight
    timeline.focus({ preventScroll: true })
    const viewport = timeline.getBoundingClientRect()
    const firstVisible = [...timeline.querySelectorAll('[data-message-id]')]
      .find((node) => {
        const rect = node.getBoundingClientRect()
        return rect.bottom > viewport.top && rect.top < viewport.bottom
      })
    return {
      scrollTop: timeline.scrollTop,
      firstVisibleMessageId: firstVisible?.dataset.messageId ?? null,
      topOffset: firstVisible ? firstVisible.getBoundingClientRect().top - viewport.top : null,
      focused: document.activeElement === timeline
    }
  })()`)
  assert(baseline?.focused && baseline.firstVisibleMessageId,
    `Could not focus the conversation timeline: ${JSON.stringify(baseline)}`)
  return baseline
}

async function typeQuery(cdp, value) {
  await waitForExpression(cdp,
    `document.activeElement?.matches('.conversation-find-form input') === true`)
  await cdp.send('Input.insertText', { text: value })
}

async function waitForFindResult(cdp, count, messageId) {
  await waitForExpression(cdp, `(() => {
    const count = document.querySelector('.conversation-find-count')?.textContent?.trim()
    const current = document.querySelector('.conversation-find-current-message')?.dataset.messageId
    return count === ${JSON.stringify(count)}
      && current === ${JSON.stringify(messageId)}
      && !document.querySelector('.conversation-find-spinner')
      && document.activeElement?.matches('.conversation-find-form input') === true
  })()`, 20_000)
}

async function chooseConversationView(cdp, view) {
  const label = view === 'world' ? '地图' : '会话'
  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.camp-conversation-view-controls button')]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
    button?.click()
    return Boolean(button)
  })()`)
  assert(clicked, `Could not select conversation view ${view}`)
  await waitForExpression(cdp,
    `document.querySelector('.camp-conversation-view-controls button[aria-pressed="true"]')?.textContent?.trim() === ${JSON.stringify(label)}`)
}

async function openCamp(cdp, campId) {
  await waitForExpression(cdp, `(() => {
    const target = ${JSON.stringify(`camp:${campId}`)}
    return [...document.querySelectorAll('[data-sidebar-menu-target]')]
      .some((element) => element.dataset.sidebarMenuTarget === target)
  })()`, 30_000)
  const opened = await evaluate(cdp, `(() => {
    const target = ${JSON.stringify(`camp:${campId}`)}
    const menu = [...document.querySelectorAll('[data-sidebar-menu-target]')]
      .find((element) => element.dataset.sidebarMenuTarget === target)
    const button = menu?.closest('.camp-nav-row')?.querySelector('.camp-nav-open')
    button?.click()
    return Boolean(button)
  })()`)
  assert(opened, `Could not open Camp ${campId}`)
  await waitForExpression(cdp, `Boolean(document.querySelector('.camp-workspace'))`, 30_000)
}

async function setTheme(cdp, preference) {
  await evaluate(cdp, `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  const expected = preference === 'night' ? 'night' : 'day'
  await waitForExpression(cdp,
    `document.documentElement.dataset.theme === ${JSON.stringify(expected)}`)
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
    env: {
      ...process.env,
      TMPDIR: runtimeTempDir,
      ROVAI_ALLOW_ISOLATED_INSTANCE: '1'
    }
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
      features: [{
        name: 'prefers-reduced-motion',
        value: reducedMotion ? 'reduce' : 'no-preference'
      }]
    })
    await waitForExpression(cdp,
      `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
    const health = await evaluate(cdp, `window.rovai.request('health.check', {})`, true)
    assert(await realpath(health.database.path) === await realpath(databasePath),
      `Packaged App opened the wrong database: ${JSON.stringify(health.database.path)}`)
    return { cdp, port, child }
  } catch (error) {
    cdp?.close()
    await terminateChild(child)
    throw error
  }
}

async function closeApp(appInstance) {
  try {
    await Promise.race([appInstance.cdp.send('Browser.close'), wait(1_000)])
  } catch {
    // The isolated App may already have exited.
  }
  appInstance.cdp.close()
  const startedAt = Date.now()
  while (Date.now() - startedAt < 8_000) {
    try {
      await fetch(`http://127.0.0.1:${appInstance.port}/json`)
    } catch {
      await terminateChild(appInstance.child)
      return
    }
    await wait(100)
  }
  await terminateChild(appInstance.child)
  throw new Error(`Isolated packaged App did not close on debug port ${appInstance.port}`)
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

async function pressShortcut(cdp) {
  await pressKey(cdp, 'f', 'KeyF', 70, 4)
}

async function pressNativeButtonEnter(cdp) {
  const params = {
    key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'char', ...params, text: '\r', unmodifiedText: '\r'
  })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
}

async function pressKey(cdp, key, code, windowsVirtualKeyCode, modifiers = 0) {
  const params = {
    key, code, windowsVirtualKeyCode,
    nativeVirtualKeyCode: windowsVirtualKeyCode,
    modifiers
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
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
  while (Date.now() - startedAt < 25_000) {
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
  const child = spawn(join(root, 'resources', 'bin', 'rovai-core'), [
    '--data-dir', dataDirectory,
    '--skill-library-root', join(dataDirectory, 'managed-skill-library')
  ], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TMPDIR: runtimeTempDir }
  })
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
    const child = spawn(command, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
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
  })
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

async function availableLoopbackPort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : null
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose())
  })
  assert(port, 'Could not allocate a loopback DevTools port')
  return port
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms))
}
