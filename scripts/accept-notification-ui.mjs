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
await writeFile(join(workspaceDir, 'README.md'), '# Notification UI acceptance\n')

const campId = await createFixtureCamp()
await insertNotification('notification-approval', 'runtime_permission_attention', '-3 minutes')
await insertNotification('notification-completed', 'camp_turn_completed', '-2 minutes')
await insertNotification('notification-incomplete', 'camp_turn_incomplete', '-1 minute')

let dayApp = null
let compactApp = null
try {
  dayApp = await launchApp(firstPort, 1440, 920, false)
  await setTheme(dayApp.cdp, 'day')
  await assertNotificationBadge(dayApp.cdp, 3)
  assert(!(await evaluate(dayApp.cdp, `Boolean(document.querySelector('.notification-heads-up'))`)),
    'Existing notifications were replayed as a heads-up after launch')

  await openNotificationCenter(dayApp.cdp)
  await assertNotificationDrawer(dayApp.cdp, 3, 'day desktop')
  const drawerCapture = join(outputDir, 'notification-center-day.png')
  await capture(dayApp.cdp, drawerCapture)
  await closeDialogWithEscape(dayApp.cdp)
  assert(await evaluate(dayApp.cdp,
    `document.activeElement === document.querySelector('.notification-trigger')`),
  'Closing the notification center did not restore focus to the bell')

  await openNotificationSettings(dayApp.cdp)
  await assertNotificationPreferences(dayApp.cdp)
  const settingsCapture = join(outputDir, 'notification-settings-day.png')
  await capture(dayApp.cdp, settingsCapture)
  await setPrimaryHeadsUpPreference(dayApp.cdp, false)
  await insertNotification('notification-muted', 'camp_turn_completed', 'now')
  await assertNotificationBadge(dayApp.cdp, 4)
  await wait(3_000)
  assert(!(await evaluate(dayApp.cdp, `Boolean(document.querySelector('.notification-heads-up'))`)),
    'A notification created while heads-up was disabled still opened a heads-up')
  await setPrimaryHeadsUpPreference(dayApp.cdp, true)

  await closeApp(dayApp)
  dayApp = null
  await wait(500)

  compactApp = await launchApp(firstPort + 1, 1040, 700, true)
  await setTheme(compactApp.cdp, 'day')
  await assertNotificationBadge(compactApp.cdp, 4)
  const focused = await evaluate(compactApp.cdp, `(() => {
    const target = document.querySelector('.unified-sidebar button[aria-label="新对话"]')
    target?.focus()
    return target?.getAttribute('aria-label') ?? null
  })()`)
  assert(focused === '新对话', 'Could not establish the focus target before the heads-up')

  await insertNotification('notification-live', 'camp_turn_completed', 'now')
  await waitForSelector(compactApp.cdp, '.notification-heads-up', 15_000)
  assert(await evaluate(compactApp.cdp,
    `document.activeElement?.getAttribute('aria-label') === '新对话'`),
  'The heads-up stole keyboard focus')
  const headsUpText = await evaluate(compactApp.cdp,
    `document.querySelector('.notification-heads-up')?.textContent ?? ''`)
  assert(headsUpText.includes('执行完成')
      && headsUpText.includes('一次协作已经完成')
      && !headsUpText.includes('README.md'),
  `The heads-up did not use fixed data-minimized copy: ${JSON.stringify(headsUpText)}`)
  await assertNotificationBadge(compactApp.cdp, 5)
  const headsUpCapture = join(outputDir, 'notification-heads-up-compact-reduced-motion.png')
  await capture(compactApp.cdp, headsUpCapture)

  await clickButton(compactApp.cdp, '.notification-heads-up-close', '×')
  await waitForExpression(compactApp.cdp,
    `!document.querySelector('.notification-heads-up')`)
  await openNotificationCenter(compactApp.cdp)
  await assertNotificationDrawer(compactApp.cdp, 5, 'compact reduced-motion')
  await clickButton(compactApp.cdp, '.notification-drawer-actions button', '全部已读')
  await waitForExpression(compactApp.cdp,
    `document.querySelector('.notification-drawer-header span')?.textContent === '0 条未读'`)
  await assertNotificationBadge(compactApp.cdp, 0)
  await clickButton(compactApp.cdp, '.notification-drawer-actions button', '清除已读')
  await waitForExpression(compactApp.cdp,
    `document.querySelectorAll('.notification-row').length === 0`)
  const inbox = await request(compactApp.cdp, 'notifications.inbox', { filter: 'all', limit: 50 })
  assert(inbox.unreadCount === 0 && inbox.items.length === 0,
    `Packaged notification commands did not persist: ${JSON.stringify(inbox)}`)

  console.log(JSON.stringify({
    ok: true,
    app: basename(appPath),
    fixtureRoot,
    outputDir,
    verified: {
      packagedRendererToCoreIpc: true,
      existingNotificationsDoNotReplayHeadsUp: true,
      unreadBadgeAndAccessibleName: true,
      persistentDrawerAndFixedCopy: true,
      allUnreadAndClearReadCommands: true,
      notificationPreferences: true,
      headsUpPreferenceTakesEffectWithoutReplay: true,
      restartPersistence: true,
      liveHeadsUpWithoutFocusTheft: true,
      escapeRestoresBellFocus: true,
      dayDesktopAndCompactReducedMotionLayouts: true,
      horizontalOverflow: false
    },
    captures: {
      drawer: drawerCapture,
      settings: settingsCapture,
      compactHeadsUp: headsUpCapture
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
      name: 'v0.28 通知验收 Camp',
      workspace: { projectPath: workspace.projectPath },
      memberAgentProfileIds: preflight.presentMembers.map((member) => member.agentProfileId),
      defaultLeadAgentProfileId: preflight.initialLeadAgentProfileId,
      collaborationMode: 'peer'
    })
    assert(created.status === 'applied' && created.payload?.campId,
      `Could not create the notification fixture Camp: ${JSON.stringify(created)}`)
    return created.payload.campId
  } finally {
    await core.stop()
  }
}

async function insertNotification(id, kind, modifier) {
  const timestamp = modifier === 'now'
    ? "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
    : `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ${sqlLiteral(modifier)})`
  await runProcess('/usr/bin/sqlite3', [databasePath, `
    INSERT INTO in_app_notification(
      id, recipient_user_id, kind, camp_id, camp_turn_id,
      resolved_at, read_at, cleared_at, version, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(id)}, 'local-user', ${sqlLiteral(kind)}, ${sqlLiteral(campId)}, NULL,
      NULL, NULL, NULL, 1, ${timestamp}, ${timestamp}
    );
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

async function assertNotificationDrawer(cdp, expectedRows, context) {
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
    `${context} notification row count was ${state.rows}, expected ${expectedRows}`)
  assert(state.title.includes(`${expectedRows} 条未读`),
    `${context} notification unread summary was incorrect: ${JSON.stringify(state.title)}`)
  assert(state.copy.includes('待审批')
      && state.copy.includes('执行完成')
      && state.copy.includes('执行未完成')
      && !state.copy.includes('README.md'),
  `${context} notification content was not fixed and data-minimized: ${JSON.stringify(state.copy)}`)
  assert(!state.drawerOverflow && !state.documentOverflow,
    `${context} notification center overflowed horizontally: ${JSON.stringify(state)}`)
  assert(state.closeName === '关闭通知中心',
    `${context} notification center close button had no accessible name`)
}

async function assertNotificationBadge(cdp, expected) {
  await waitForExpression(cdp, `(() => {
    const button = document.querySelector('.notification-trigger')
    return button?.getAttribute('aria-label') === ${JSON.stringify(
      expected > 0 ? `通知，${expected} 条未读` : '通知'
    )}
  })()`, 15_000)
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
    `document.querySelectorAll('.notification-switch input[role="switch"]').length === 3`)
  let values = await evaluate(cdp,
    `[...document.querySelectorAll('.notification-switch input[role="switch"]')]
      .map((input) => input.checked)`)
  assert(values.every(Boolean), `Notification preferences did not default on: ${JSON.stringify(values)}`)
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
}

async function closeDialogWithEscape(cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
  await waitForExpression(cdp, `!document.querySelector('.notification-drawer')`)
  await wait(50)
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

async function request(cdp, method, params = {}) {
  return evaluate(cdp,
    `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`, true)
}

async function setTheme(cdp, preference) {
  await evaluate(cdp, `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  await waitForExpression(cdp, `document.documentElement.dataset.theme === 'day'`)
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
  const child = spawn(join(root, 'resources', 'bin', 'rovai-core'), ['--data-dir', dataDirectory], {
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
