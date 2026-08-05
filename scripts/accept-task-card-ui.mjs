import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai-ai.app'))
const fixtureRoot = process.env.ROVAI_TASK_CARD_ACCEPT_FIXTURE_ROOT
  ?? await mkdtemp(join(tmpdir(), 'rovai-task-card-ui-accept-'))
const dataDir = join(fixtureRoot, 'user-data')
const runtimeTempDir = process.env.ROVAI_TASK_CARD_ACCEPT_RUNTIME_TMP
  ?? await mkdtemp('/tmp/rv-task-')
const outputDir = process.env.ROVAI_TASK_CARD_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-task-card-ui-captures-'))
const databasePath = join(dataDir, 'rovai.sqlite')
const firstPort = Number(process.env.ROVAI_TASK_CARD_ACCEPT_DEBUG_PORT ?? 9501)

await mkdir(dataDir, { recursive: true })
await mkdir(outputDir, { recursive: true })

const fixture = await createFixtureCamp()
let desktopApp = null
let compactApp = null

try {
  desktopApp = await launchApp(firstPort, 1440, 920, false)
  await setTheme(desktopApp.cdp, 'day')
  await openCamp(desktopApp.cdp, fixture.campId)

  const initialSnapshot = await request(desktopApp.cdp, 'camps.snapshot', {
    campId: fixture.campId
  })
  assert(initialSnapshot.messages.length === 0 && initialSnapshot.tasks.length === 0,
    `Task-card fixture did not start empty: ${JSON.stringify(initialSnapshot)}`)

  const createdTask = await request(desktopApp.cdp, 'tasks.create', {
    commandId: crypto.randomUUID(),
    campId: fixture.campId,
    title: '确认任务卡创建位置',
    description: '这段说明只能出现在任务详情，不能出现在会话卡片。',
    assigneeAgentId: fixture.primaryAssignee.id
  })
  const completedTaskId = createdTask.payload?.taskId
  assert(createdTask.status === 'applied' && completedTaskId,
    `Could not create completed-path Task: ${JSON.stringify(createdTask)}`)

  await waitForTaskCard(desktopApp.cdp, '确认任务卡创建位置', '待处理', 1)
  await markTaskCard(desktopApp.cdp, completedTaskId)
  await assertTaskCardProjection(desktopApp.cdp, {
    title: '确认任务卡创建位置',
    status: '待处理',
    assigneeName: fixture.primaryAssignee.name,
    count: 1
  })

  let task = await getTask(desktopApp.cdp, fixture.campId, completedTaskId)
  const startedTask = await request(desktopApp.cdp, 'tasks.update', {
    commandId: crypto.randomUUID(),
    campId: fixture.campId,
    taskId: completedTaskId,
    expectedVersion: task.version,
    title: '任务卡已原地更新',
    description: '更新后的说明仍然只能在任务详情里看到。',
    status: 'in_progress',
    assignee: {
      operation: 'assign',
      agentProfileId: fixture.secondaryAssignee.id
    }
  })
  assert(startedTask.status === 'applied',
    `Could not update Task in place: ${JSON.stringify(startedTask)}`)
  await waitForTaskCard(desktopApp.cdp, '任务卡已原地更新', '进行中', 1)
  await assertMarkedTaskCard(desktopApp.cdp, completedTaskId)
  await assertTaskCardProjection(desktopApp.cdp, {
    title: '任务卡已原地更新',
    status: '进行中',
    assigneeName: fixture.secondaryAssignee.name,
    count: 1
  })

  task = await getTask(desktopApp.cdp, fixture.campId, completedTaskId)
  const completedTask = await request(desktopApp.cdp, 'tasks.update', {
    commandId: crypto.randomUUID(),
    campId: fixture.campId,
    taskId: completedTaskId,
    expectedVersion: task.version,
    status: 'completed'
  })
  assert(completedTask.status === 'applied',
    `Could not complete Task: ${JSON.stringify(completedTask)}`)
  await waitForTaskCard(desktopApp.cdp, '任务卡已原地更新', '已完成', 1)
  await assertMarkedTaskCard(desktopApp.cdp, completedTaskId)

  const createdCancelledTask = await request(desktopApp.cdp, 'tasks.create', {
    commandId: crypto.randomUUID(),
    campId: fixture.campId,
    title: '取消路径仍复用原卡',
    description: '取消后保留在任务详情与审计记录。',
    assigneeAgentId: null
  })
  const cancelledTaskId = createdCancelledTask.payload?.taskId
  assert(createdCancelledTask.status === 'applied' && cancelledTaskId,
    `Could not create cancellation-path Task: ${JSON.stringify(createdCancelledTask)}`)
  await waitForTaskCard(desktopApp.cdp, '取消路径仍复用原卡', '待处理', 2)
  await markTaskCard(desktopApp.cdp, cancelledTaskId)

  task = await getTask(desktopApp.cdp, fixture.campId, cancelledTaskId)
  const cancelledTask = await request(desktopApp.cdp, 'tasks.update', {
    commandId: crypto.randomUUID(),
    campId: fixture.campId,
    taskId: cancelledTaskId,
    expectedVersion: task.version,
    status: 'cancelled'
  })
  assert(cancelledTask.status === 'applied',
    `Could not cancel Task: ${JSON.stringify(cancelledTask)}`)
  await waitForTaskCard(desktopApp.cdp, '取消路径仍复用原卡', '已取消', 2)
  await assertMarkedTaskCard(desktopApp.cdp, cancelledTaskId)

  const terminalSnapshot = await request(desktopApp.cdp, 'camps.snapshot', {
    campId: fixture.campId
  })
  assert(terminalSnapshot.tasks.length === 2 && terminalSnapshot.messages.length === 0,
    `Task lifecycle created a CampMessage or lost a Task: ${JSON.stringify(terminalSnapshot)}`)

  await openTaskDetails(desktopApp.cdp, '任务卡已原地更新')
  await assertTerminalDetails(desktopApp.cdp, '更新后的说明仍然只能在任务详情里看到。')
  await assertNoHorizontalOverflow(desktopApp.cdp, '1440×920')
  const desktopCapture = join(outputDir, 'task-card-details-day-1440x920.png')
  await capture(desktopApp.cdp, desktopCapture)

  await closeApp(desktopApp)
  desktopApp = null
  await wait(500)

  compactApp = await launchApp(firstPort + 1, 1040, 700, true)
  await setTheme(compactApp.cdp, 'day')
  await openCamp(compactApp.cdp, fixture.campId)
  await waitForTaskCard(compactApp.cdp, '任务卡已原地更新', '已完成', 2)
  await openTaskDetails(compactApp.cdp, '取消路径仍复用原卡')
  await assertTerminalDetails(compactApp.cdp, '取消后保留在任务详情与审计记录。')
  await assertNoHorizontalOverflow(compactApp.cdp, '1040×700 reduced-motion')
  const compactCapture = join(outputDir, 'task-card-details-compact-1040x700.png')
  await capture(compactApp.cdp, compactCapture)

  console.log(JSON.stringify({
    ok: true,
    app: basename(appPath),
    fixtureRoot,
    outputDir,
    verified: {
      createProjectsExactlyOneCard: true,
      titleStatusAndAssigneeUpdateInPlace: true,
      completionAndCancellationReuseCard: true,
      descriptionOnlyAppearsInDetails: true,
      taskLifecycleCreatesNoCampMessages: true,
      taskCardOpensCurrentTerminalDetails: true,
      desktopAndCompactReducedMotionLayouts: true,
      horizontalOverflow: false
    },
    captures: {
      desktop: desktopCapture,
      compact: compactCapture
    }
  }, null, 2))
} finally {
  if (desktopApp) await closeApp(desktopApp)
  if (compactApp) await closeApp(compactApp)
}

async function createFixtureCamp() {
  const core = startCore(dataDir)
  try {
    await core.request('health.check')
    const preflight = await core.request('camps.creationPreflight')
    const presentMembers = preflight.presentMembers
    assert(presentMembers.length > 0,
      `Task-card fixture has no present members: ${JSON.stringify(preflight)}`)
    const created = await core.request('camps.create', {
      commandId: crypto.randomUUID(),
      name: 'v0.38 任务卡原地更新验收',
      workspace: null,
      memberAgentProfileIds: presentMembers.map((member) => member.agentProfileId),
      defaultLeadAgentProfileId: preflight.initialLeadAgentProfileId,
      collaborationMode: 'peer'
    })
    assert(created.status === 'applied' && created.payload?.campId,
      `Could not create task-card fixture Camp: ${JSON.stringify(created)}`)
    const primary = presentMembers[0]
    const secondary = presentMembers[1] ?? primary
    return {
      campId: created.payload.campId,
      primaryAssignee: { id: primary.agentProfileId, name: primary.displayName },
      secondaryAssignee: { id: secondary.agentProfileId, name: secondary.displayName }
    }
  } finally {
    await core.stop()
  }
}

async function getTask(cdp, campId, taskId) {
  const task = await request(cdp, 'tasks.get', { campId, taskId })
  assert(task?.id === taskId, `Could not read Task ${taskId}: ${JSON.stringify(task)}`)
  return task
}

async function waitForTaskCard(cdp, title, status, count) {
  await waitForExpression(cdp, `(() => {
    const cards = [...document.querySelectorAll('button.task-event-card')]
    const card = cards.find((candidate) => candidate.getAttribute('aria-label')
      === ${JSON.stringify(`打开任务：${title}`)})
    return cards.length === ${count}
      && card?.textContent?.includes(${JSON.stringify(status)})
  })()`, 20_000)
}

async function markTaskCard(cdp, taskId) {
  const marked = await evaluate(cdp, `(() => {
    const cards = [...document.querySelectorAll('button.task-event-card')]
    const card = cards.at(-1)
    if (!card) return false
    card.dataset.acceptTaskId = ${JSON.stringify(taskId)}
    window.__taskCardAcceptanceReferences ??= {}
    window.__taskCardAcceptanceReferences[${JSON.stringify(taskId)}] = card
    return true
  })()`)
  assert(marked, `Could not mark Task card ${taskId}`)
}

async function assertMarkedTaskCard(cdp, taskId) {
  const retained = await evaluate(cdp, `(() => {
    const taskId = ${JSON.stringify(taskId)}
    const card = document.querySelector('[data-accept-task-id="' + taskId + '"]')
    return Boolean(card && window.__taskCardAcceptanceReferences?.[taskId] === card)
  })()`)
  assert(retained, `Task card ${taskId} was replaced instead of updated in place`)
}

async function assertTaskCardProjection(cdp, expected) {
  const state = await evaluate(cdp, `(() => {
    const cards = [...document.querySelectorAll('button.task-event-card')]
    return {
      count: cards.length,
      copy: cards.map((card) => card.textContent ?? ''),
      labels: cards.map((card) => card.getAttribute('aria-label')),
      widths: cards.map((card) => ({ client: card.clientWidth, scroll: card.scrollWidth })),
      descriptionVisible: [
        '这段说明只能出现在任务详情',
        '更新后的说明仍然只能在任务详情',
        '取消后保留在任务详情与审计记录'
      ].some((description) => document.querySelector('.camp-timeline')?.textContent
        ?.includes(description) ?? false)
    }
  })()`)
  assert(state.count === expected.count,
    `Task card count was ${state.count}, expected ${expected.count}: ${JSON.stringify(state)}`)
  assert(state.labels.includes(`打开任务：${expected.title}`)
      && state.copy.some((copy) => copy.includes(expected.title)
        && copy.includes(expected.status)
        && copy.includes(`负责人 · ${expected.assigneeName}`)),
  `Task card did not project current fields: ${JSON.stringify(state)}`)
  assert(!state.descriptionVisible,
    `Task description leaked into the conversation card: ${JSON.stringify(state)}`)
  assert(state.widths.every((width) => width.scroll <= width.client + 1),
    `Task card overflowed horizontally: ${JSON.stringify(state.widths)}`)
}

async function openTaskDetails(cdp, title) {
  const opened = await evaluate(cdp, `(() => {
    const label = ${JSON.stringify(`打开任务：${title}`)}
    const card = [...document.querySelectorAll('button.task-event-card')]
      .find((candidate) => candidate.getAttribute('aria-label') === label)
    card?.click()
    return Boolean(card)
  })()`)
  assert(opened, `Could not open Task card ${JSON.stringify(title)}`)
  await waitForExpression(cdp, `(() => {
    const heading = document.querySelector('.task-editor-heading')?.textContent ?? ''
    return heading.includes('Task 详情') && Boolean(document.querySelector('.task-editor'))
  })()`)
}

async function assertTerminalDetails(cdp, expectedDescription) {
  const state = await evaluate(cdp, `(() => {
    const editor = document.querySelector('.task-editor')
    const description = editor?.querySelector('textarea')
    return {
      description: description?.value ?? null,
      disabled: description?.disabled ?? false,
      note: editor?.querySelector('.task-terminal-note')?.textContent ?? '',
      visible: Boolean(editor)
    }
  })()`)
  assert(state.visible && state.disabled && state.description === expectedDescription
      && state.note.includes('已结束的 Task 保留为只读记录'),
  `Task details did not show current terminal data: ${JSON.stringify(state)}`)
}

async function assertNoHorizontalOverflow(cdp, context) {
  const state = await evaluate(cdp, `(() => {
    const timeline = document.querySelector('.camp-timeline')
    const inspector = document.querySelector('.activity-pane')
    return {
      document: document.documentElement.scrollWidth > window.innerWidth + 1,
      timeline: timeline ? timeline.scrollWidth > timeline.clientWidth + 1 : true,
      inspector: inspector ? inspector.scrollWidth > inspector.clientWidth + 1 : true,
      viewport: [window.innerWidth, window.innerHeight]
    }
  })()`)
  assert(!state.document && !state.timeline && !state.inspector,
    `${context} overflowed horizontally: ${JSON.stringify(state)}`)
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

async function request(cdp, method, params = {}) {
  return evaluate(cdp,
    `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`, true)
}

async function setTheme(cdp, preference) {
  await evaluate(cdp,
    `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
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
    close() {
      socket.close()
    }
  }
}

function startCore(dataDirectory) {
  const child = spawn(join(root, 'resources', 'bin', 'rovai-core'), ['--data-dir', dataDirectory], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TMPDIR: runtimeTempDir }
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
  const requestCore = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
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
  return { request: requestCore, stop }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
