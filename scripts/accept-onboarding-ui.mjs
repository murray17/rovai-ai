import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { assertUserDataIsIsolated } from './lib/dev-desktop.mjs'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai-ai.app'))
const fixtureRoot = resolve(process.env.ROVAI_ONBOARDING_ACCEPT_FIXTURE_ROOT
  ?? await mkdtemp(join(tmpdir(), 'rovai-onboarding-ui-accept-')))
const dataDir = assertUserDataIsIsolated(join(fixtureRoot, 'user-data'))
const electronUserDataDir = process.platform === 'win32'
  ? join(dataDir, 'Electron', 'User Data')
  : dataDir
const coreDataDir = process.platform === 'win32'
  ? join(dataDir, 'Core')
  : dataDir
const outputDir = resolve(process.env.ROVAI_ONBOARDING_ACCEPT_OUTPUT_DIR
  ?? join(fixtureRoot, 'captures'))
const firstPort = Number(process.env.ROVAI_ONBOARDING_ACCEPT_DEBUG_PORT ?? 9489)
const width = 1040
const height = 700
const selectedRole = 'qilu'
const expectedStarter = '我想创建一个新的队员，请用 member-studio 帮我开始。'

class ExpectedWindowsPlatformAdmissionBlock extends Error {}

if (process.platform !== 'win32') await mkdir(dataDir, { recursive: true })
await mkdir(outputDir, { recursive: true })

let running = null
const captures = {}
const report = {
  schemaVersion: 1,
  appPath,
  fixtureRoot,
  dataDir,
  outputDir,
  viewport: { width, height },
  selectedRole,
  runtime: null,
  onboarding: null,
  camp: null,
  draft: null,
  captures
}

try {
  running = await launchApp(firstPort)
  await waitForSelector(running.cdp, '.onboarding-welcome', 45_000)
  await setTheme(running.cdp, 'day')
  const welcome = await surfaceState(running.cdp, '.onboarding-welcome')
  assert(welcome.visible && welcome.primaryVisible && welcome.primaryEnabled,
    `Welcome primary action is not visible: ${JSON.stringify(welcome)}`)
  assert(!welcome.hasSkip && !welcome.hasProgress && !welcome.horizontalOverflow,
    `Welcome exposes a skip/progress control or overflows: ${JSON.stringify(welcome)}`)
  captures.welcomeDay = join(outputDir, '01-welcome-day-1040x700.png')
  await capture(running.cdp, captures.welcomeDay)

  await setTheme(running.cdp, 'night')
  captures.welcomeNight = join(outputDir, '02-welcome-night-1040x700.png')
  await capture(running.cdp, captures.welcomeNight)
  await setTheme(running.cdp, 'day')

  await clickByText(running.cdp, '.onboarding-welcome button', '开始旅程')
  await waitForSelector(running.cdp, '.onboarding-member-layout', 5_000)
  const memberPage = await evaluate(running.cdp, `(() => ({
    rows: document.querySelectorAll('.onboarding-member-row').length,
    portraits: document.querySelectorAll('.onboarding-selected-portrait').length,
    hasSkip: document.body.textContent?.includes('跳过') ?? false,
    hasProgress: Boolean(document.querySelector('.onboarding-step, .onboarding-progress')),
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    viewport: [window.innerWidth, window.innerHeight]
  }))()`)
  assert(memberPage.rows === 4 && memberPage.portraits === 1,
    `Member page is not one portrait plus four text rows: ${JSON.stringify(memberPage)}`)
  assert(!memberPage.hasSkip && !memberPage.hasProgress && !memberPage.horizontalOverflow,
    `Member page exposes skip/progress or overflows: ${JSON.stringify(memberPage)}`)
  assert(memberPage.viewport[0] === width && memberPage.viewport[1] === height,
    `Member page viewport is not ${width}x${height}: ${JSON.stringify(memberPage.viewport)}`)
  captures.memberDay = join(outputDir, '03-member-day-1040x700.png')
  await capture(running.cdp, captures.memberDay)

  await clickSelector(running.cdp, `.onboarding-member-row[data-member-role="${selectedRole}"]`)
  await waitForExpression(running.cdp,
    `document.querySelector('.onboarding-member-row[data-member-role="${selectedRole}"]')?.getAttribute('aria-checked') === 'true'`)
  await closeApp(running)
  running = null

  running = await launchApp(firstPort + 1)
  await waitForSelector(running.cdp, '.onboarding-member-layout', 45_000)
  const resumedMember = await evaluate(running.cdp, `({
    selected: document.querySelector('.onboarding-member-row[aria-checked="true"]')?.dataset.memberRole,
    welcomeAbsent: !document.querySelector('.onboarding-welcome')
  })`)
  assert(resumedMember.selected === selectedRole && resumedMember.welcomeAbsent,
    `Restart did not resume the unfinished member page: ${JSON.stringify(resumedMember)}`)
  await clickByText(running.cdp, '.onboarding-member-footer button', '一起开始')
  await waitForSelector(running.cdp, '.onboarding-runtime-track', 5_000)
  captures.runtimeScan = join(outputDir, '04-runtime-scan-day-1040x700.png')
  await capture(running.cdp, captures.runtimeScan)
  await waitForSelector(running.cdp, '.onboarding-runtime-list', 120_000)
  const runtimeAvailability = await evaluate(running.cdp, `
    [...document.querySelectorAll('.onboarding-runtime-row')].map((row) => ({
      label: row.querySelector('strong')?.textContent?.trim(),
      status: row.querySelector('.onboarding-runtime-state')?.textContent?.trim(),
      className: row.querySelector('.onboarding-runtime-state')?.className,
      disabled: row.disabled
    }))`)
  captures.runtimeReadyDay = join(outputDir, '05-runtime-ready-day-1040x700.png')
  await capture(running.cdp, captures.runtimeReadyDay)
  const usableRuntime = runtimeAvailability.some((runtime) => (
    runtime.className?.includes('status-available')
    || runtime.className?.includes('status-installed_unverified')
  ))
  if (!usableRuntime
      && process.env.ROVAI_ONBOARDING_ALLOW_PLATFORM_BLOCKED === '1'
      && runtimeAvailability.length > 0
      && runtimeAvailability.every((runtime) => (
        runtime.disabled && runtime.className?.includes('status-not_qualified')
      ))) {
    report.runtime = {
      platformBlocked: true,
      reason: 'runtime_platform_not_qualified',
      availability: runtimeAvailability
    }
    throw new ExpectedWindowsPlatformAdmissionBlock(
      'Windows Runtime platform admission correctly blocked onboarding continuation'
    )
  }
  assert(usableRuntime,
    `No usable Runtime was available for packaged acceptance: ${JSON.stringify(runtimeAvailability)}`)
  const runtimeChoice = await evaluate(running.cdp, `(() => {
    const rows = [...document.querySelectorAll('.onboarding-runtime-row')]
    const available = rows.filter((row) => row.querySelector('.status-available'))
    const unverified = rows.filter((row) => row.querySelector('.status-installed_unverified'))
    const candidates = available.length > 0 ? available : unverified
    const row = candidates.find((candidate) => candidate.textContent?.includes('Codex CLI')) ?? candidates[0]
    if (!row || row.disabled) return null
    const result = {
      label: row.querySelector('strong')?.textContent?.trim(),
      status: row.querySelector('.onboarding-runtime-state')?.textContent?.trim()
    }
    row.click()
    return result
  })()`)
  assert(runtimeChoice,
    `No usable Runtime was available for packaged acceptance: ${JSON.stringify(runtimeAvailability)}`)
  report.runtime = { ...runtimeChoice, availability: runtimeAvailability }
  await waitForExpression(running.cdp,
    `document.querySelector('.onboarding-runtime-footer .onboarding-primary')?.disabled === false`,
    10_000)
  const runtimeSnapshot = await onboardingGet(running.cdp)
  assert(runtimeSnapshot.status === 'in_progress'
    && runtimeSnapshot.step === 'runtime'
    && runtimeSnapshot.selectedMemberRole === selectedRole
    && runtimeSnapshot.runtimeSelection,
  `Runtime choice was not durably saved: ${JSON.stringify(runtimeSnapshot)}`)
  await closeApp(running)
  running = null

  running = await launchApp(firstPort + 2)
  await waitForSelector(running.cdp, '.onboarding-runtime-track', 45_000)
  await waitForSelector(running.cdp, '.onboarding-runtime-list', 120_000)
  await waitForExpression(running.cdp,
    `document.querySelector('.onboarding-runtime-row[aria-checked="true"]')
      && document.querySelector('.onboarding-runtime-footer .onboarding-primary')?.disabled === false`,
    15_000)
  const resumedRuntime = await onboardingGet(running.cdp)
  assert(resumedRuntime.status === 'in_progress'
    && resumedRuntime.step === 'runtime'
    && resumedRuntime.runtimeSelection?.adapterKind === runtimeSnapshot.runtimeSelection.adapterKind,
  `Restart did not resume the unfinished Runtime page: ${JSON.stringify(resumedRuntime)}`)
  await clickByText(running.cdp, '.onboarding-runtime-footer button', '保存并进入快速对话')
  await waitForExpression(running.cdp,
    `Boolean(document.querySelector('.camp-timeline:not([hidden]) .first-run-camp-welcome'))`,
    60_000)

  const completed = await onboardingGet(running.cdp)
  assert(completed.status === 'completed'
    && completed.origin === 'onboarding'
    && completed.selectedMemberRole === selectedRole
    && completed.quickChatCampId
    && completed.memberAgentId,
  `Page three did not complete onboarding: ${JSON.stringify(completed)}`)
  report.onboarding = completed
  const beforeProjection = await request(running.cdp, 'camps.open', {
    traceId: randomUUID(),
    campId: completed.quickChatCampId
  })
  const campState = await evaluate(running.cdp, `(() => ({
    title: document.querySelector('.first-run-camp-intro span')?.textContent?.trim(),
    keys: [...document.querySelectorAll('.first-run-starter-key')].map((node) => node.textContent?.trim()),
    actions: [...document.querySelectorAll('.first-run-starter-action')].map((node) => node.textContent?.trim()),
    starters: document.querySelectorAll('.first-run-starters button').length,
    composer: document.querySelector('#camp-message')?.textContent ?? '',
    timelineOverflow: (() => {
      const timeline = document.querySelector('.camp-timeline')
      return Boolean(timeline && timeline.scrollWidth > timeline.clientWidth + 1)
    })(),
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
  }))()`)
  assert(beforeProjection.camp.title === '初次集结'
    && beforeProjection.camp.activationState === 'active'
    && beforeProjection.members.length === 1
    && beforeProjection.members[0].agentId === completed.memberAgentId
    && beforeProjection.camp.defaultLeadAgentId === completed.memberAgentId,
  `The created Quick Chat Camp is not exact: ${JSON.stringify(beforeProjection)}`)
  assert(beforeProjection.messages.length === 0 && beforeProjection.agentRuns.length === 0,
    `Initial Camp unexpectedly contains work: ${JSON.stringify({ messages: beforeProjection.messages.length, runs: beforeProjection.agentRuns.length })}`)
  assert(campState.title === '初次集结 · 快速对话'
    && JSON.stringify(campState.keys) === JSON.stringify(['A', 'B', 'C'])
    && campState.actions.every((action) => action.includes('填入输入框'))
    && campState.starters === 3
    && campState.composer === ''
    && !campState.timelineOverflow
    && !campState.horizontalOverflow,
  `First-run Camp surface is incomplete: ${JSON.stringify(campState)}`)
  report.camp = {
    id: beforeProjection.camp.id,
    title: beforeProjection.camp.title,
    activationState: beforeProjection.camp.activationState,
    memberCount: beforeProjection.members.length,
    defaultLeadAgentId: beforeProjection.camp.defaultLeadAgentId
  }

  await setTheme(running.cdp, 'day')
  captures.campDay = join(outputDir, '06-first-run-camp-day-1040x700.png')
  await capture(running.cdp, captures.campDay)
  await setTheme(running.cdp, 'night')
  captures.campNight = join(outputDir, '07-first-run-camp-night-1040x700.png')
  await capture(running.cdp, captures.campNight)
  await setTheme(running.cdp, 'day')

  await clickSelector(running.cdp, '.first-run-starters button')
  await waitForExpression(running.cdp,
    `document.querySelector('#camp-message')?.textContent === ${JSON.stringify(expectedStarter)}
      && document.activeElement === document.querySelector('#camp-message')`,
    5_000)
  await waitForExpression(running.cdp,
    `window.rovai.request('camp.composerDraft.get', { campId: ${JSON.stringify(completed.quickChatCampId)} })
      .then((draft) => draft.body === ${JSON.stringify(expectedStarter)})`,
    10_000)
  const afterProjection = await request(running.cdp, 'camps.open', {
    traceId: randomUUID(),
    campId: completed.quickChatCampId
  })
  const draftInteraction = await evaluate(running.cdp, `(() => {
    const editor = document.querySelector('#camp-message')
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const prefix = document.createRange()
    if (editor && range) {
      prefix.selectNodeContents(editor)
      prefix.setEnd(range.endContainer, range.endOffset)
    }
    return {
      text: editor?.textContent,
      focused: document.activeElement === editor,
      collapsed: selection?.isCollapsed ?? false,
      caretAtEnd: Boolean(editor && range
        && prefix.toString().length === (editor.textContent?.length ?? 0)),
      notice: document.querySelector('.first-run-draft-notice')?.textContent?.trim()
    }
  })()`)
  assert(afterProjection.messages.length === beforeProjection.messages.length
    && afterProjection.agentRuns.length === beforeProjection.agentRuns.length,
  `Choosing a starter created a message or AgentRun: ${JSON.stringify({ before: [beforeProjection.messages.length, beforeProjection.agentRuns.length], after: [afterProjection.messages.length, afterProjection.agentRuns.length] })}`)
  assert(draftInteraction.text === expectedStarter
    && draftInteraction.focused
    && draftInteraction.collapsed
    && draftInteraction.caretAtEnd
    && draftInteraction.notice === '已填入输入框，可修改后发送',
  `Starter did not only fill/focus the Composer: ${JSON.stringify(draftInteraction)}`)
  report.draft = draftInteraction
  captures.campDraftDay = join(outputDir, '08-first-run-camp-draft-day-1040x700.png')
  await capture(running.cdp, captures.campDraftDay)
  await closeApp(running)
  running = null

  running = await launchApp(firstPort + 3)
  await waitForExpression(running.cdp,
    `Boolean(document.querySelector('.camp-timeline:not([hidden]) .first-run-camp-welcome'))`,
    45_000)
  await waitForExpression(running.cdp,
    `document.querySelector('#camp-message')?.textContent === ${JSON.stringify(expectedStarter)}`,
    10_000)
  const restarted = await onboardingGet(running.cdp)
  const restartedProjection = await request(running.cdp, 'camps.open', {
    traceId: randomUUID(),
    campId: completed.quickChatCampId
  })
  assert(restarted.status === 'completed'
    && restarted.quickChatCampId === completed.quickChatCampId
    && restartedProjection.messages.length === 0
    && restartedProjection.agentRuns.length === 0,
  `Completed onboarding/Camp did not survive restart: ${JSON.stringify({ restarted, messages: restartedProjection.messages.length, runs: restartedProjection.agentRuns.length })}`)
  captures.campRestarted = join(outputDir, '09-first-run-camp-restarted-1040x700.png')
  await capture(running.cdp, captures.campRestarted)
  await closeApp(running)
  running = null

  const persistedOnboarding = JSON.parse(await readFile(join(electronUserDataDir, 'onboarding.json'), 'utf8'))
  assert(persistedOnboarding.status === 'completed'
    && persistedOnboarding.quickChatCampId === completed.quickChatCampId,
  `Private onboarding file is not completed: ${JSON.stringify(persistedOnboarding)}`)
  const reportPath = join(outputDir, 'report.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ ok: true, reportPath, ...report }, null, 2)}\n`)
} catch (error) {
  if (error instanceof ExpectedWindowsPlatformAdmissionBlock) {
    const reportPath = join(outputDir, 'report.json')
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify({
      ok: true,
      expectedPlatformBlock: true,
      reportPath,
      ...report
    }, null, 2)}\n`)
  } else {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    fixtureRoot,
    outputDir,
    stderr: running?.stderr ?? []
  }, null, 2)}\n`)
  process.exitCode = 1
  }
} finally {
  if (running) await closeApp(running).catch(() => undefined)
}

async function launchApp(port) {
  const stderr = []
  const executable = process.platform === 'win32'
    ? appPath
    : join(appPath, 'Contents', 'MacOS', 'Rovai-ai')
  if (process.platform === 'win32' && !existsSync(dataDir)) {
    const preparer = join(dirname(executable), 'resources', 'bin', 'rovai-core.exe')
    const prepared = spawnSync(preparer, ['--prepare-windows-data-root', dataDir], {
      cwd: root,
      encoding: 'utf8'
    })
    if (prepared.error) throw prepared.error
    if (prepared.status !== 0) {
      throw new Error(`Windows acceptance data-root preparation failed: ${prepared.stderr}`)
    }
  }
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`
  ], {
    cwd: root,
    env: { ...process.env, ROVAI_ALLOW_ISOLATED_INSTANCE: '1' },
    stdio: ['ignore', 'ignore', 'pipe']
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
    await waitForExpression(cdp,
      `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
    return { cdp, port, stderr, child }
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
      await waitForCoreProcessExit()
      return
    }
    await wait(100)
  }
  await terminateChild(app.child)
  await waitForCoreProcessExit()
}

async function waitForCoreProcessExit(timeoutMs = 15_000) {
  const lockPath = join(coreDataDir, '.rovai-core-instance.lock')
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const owner = JSON.parse(await readFile(lockPath, 'utf8'))
      if (!Number.isSafeInteger(owner.processId) || !processIsAlive(owner.processId)) return
    } catch {
      return
    }
    await wait(100)
  }
  throw new Error(`Isolated rovai-core did not exit for ${dataDir}`)
}

function processIsAlive(processId) {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    wait(5_000)
  ])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

async function onboardingGet(cdp) {
  return evaluate(cdp, 'window.rovai.onboarding.get()', true)
}

async function request(cdp, method, params = {}) {
  return evaluate(cdp,
    `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`, true)
}

async function setTheme(cdp, theme) {
  const current = await evaluate(cdp, 'document.documentElement.dataset.theme')
  if (current !== theme) {
    const hasOnboardingToggle = await evaluate(cdp,
      `Boolean(document.querySelector('.onboarding-theme-toggle'))`)
    if (hasOnboardingToggle) {
      await clickSelector(cdp, '.onboarding-theme-toggle')
    } else {
      await evaluate(cdp,
        `window.rovai.appearance.setPreference(${JSON.stringify(theme)})`, true)
    }
  }
  await waitForExpression(cdp,
    `document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, 5_000)
}

async function surfaceState(cdp, selector) {
  return evaluate(cdp, `(() => {
    const surface = document.querySelector(${JSON.stringify(selector)})
    const primary = surface?.querySelector('.onboarding-primary')
    const rect = primary?.getBoundingClientRect()
    return {
      visible: Boolean(surface),
      primaryVisible: Boolean(rect && rect.top >= 0 && rect.bottom <= window.innerHeight),
      primaryEnabled: Boolean(primary && !primary.disabled),
      hasSkip: document.body.textContent?.includes('跳过') ?? false,
      hasProgress: Boolean(document.querySelector('.onboarding-step, .onboarding-progress')),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
    }
  })()`)
}

async function clickSelector(cdp, selector) {
  const clicked = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element || element.disabled) return false
    element.click()
    return true
  })()`)
  if (!clicked) throw new Error(`Could not click selector: ${selector}`)
}

async function clickByText(cdp, selector, text) {
  const clicked = await evaluate(cdp, `(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent?.includes(${JSON.stringify(text)}))
    if (!element || element.disabled) return false
    element.click()
    return true
  })()`)
  if (!clicked) throw new Error(`Could not click ${selector} containing ${text}`)
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
      ?? response.result.exceptionDetails.text)
  }
  return response.result?.result?.value
}

async function waitForSelector(cdp, selector, timeoutMs) {
  await waitForExpression(cdp,
    `Boolean(document.querySelector(${JSON.stringify(selector)}))`, timeoutMs)
}

async function waitForExpression(cdp, expression, timeoutMs = 5_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await evaluate(cdp, expression, true)) return
    } catch {
      // The Renderer may be moving between surfaces.
    }
    await wait(100)
  }
  throw new Error(`Expression did not become true within ${timeoutMs}ms: ${expression}`)
}

async function waitForTarget(debugPort, stderr) {
  const timeoutMs = process.platform === 'win32' ? 45_000 : 15_000
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json`)
        .then((response) => response.json())
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
