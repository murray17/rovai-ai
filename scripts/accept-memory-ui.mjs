import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai-ai.app'))
const dataDir = process.env.ROVAI_MEMORY_ACCEPT_DATA_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-memory-ui-accept-'))
const outputDir = process.env.ROVAI_MEMORY_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-memory-ui-captures-'))
const firstPort = Number(process.env.ROVAI_MEMORY_ACCEPT_DEBUG_PORT ?? 9441)
const initialBody = '实际验收：重要改动应提供明确验证结果。'
const revisedBody = '实际验收：重要改动应提供明确、可复现的验证结果。'
const forgottenBody = '实际验收临时项：完成后应被永久遗忘。'

await mkdir(outputDir, { recursive: true })

let first = null
let second = null
try {
  first = await launchApp(firstPort, 1440, 920)
  await setTheme(first.cdp, 'day')
  await assertNoMemoryOnboarding(first.cdp, 'Fresh database')
  await openMemory(first.cdp)

  await createHearthMemory(first.cdp, initialBody)
  await chooseMemoryTab(first.cdp, '共同记忆')
  await waitForText(first.cdp, '.memory-catalog-item > strong', initialBody)
  await assertNoHorizontalOverflow(first.cdp, 'day Memory Library')

  await clickMemoryAction(first.cdp, initialBody, '修订')
  await waitForSelector(first.cdp, '.memory-editor-dialog textarea')
  await replaceTextarea(first.cdp, revisedBody)
  await clickButton(first.cdp, '.memory-editor-dialog button', '保存')
  await waitForText(first.cdp, '.memory-catalog-item > strong', revisedBody)

  const revisedRecord = await request(first.cdp, 'memory.list')
  const durable = revisedRecord.memories.find((memory) => memory.currentBody === revisedBody)
  assert(durable?.revisions.length === 2, 'UI revision did not preserve two authoritative Revisions')

  const dayCapture = join(outputDir, 'memory-day.png')
  await capture(first.cdp, dayCapture)

  await clickMemoryAction(first.cdp, revisedBody, '停止沿用')
  await chooseMemoryTab(first.cdp, '已停止沿用')
  await waitForText(first.cdp, '.memory-catalog-item > strong', revisedBody)
  await clickMemoryAction(first.cdp, revisedBody, '重新沿用')
  await waitForTextToDisappear(first.cdp, '.memory-catalog-item > strong', revisedBody)
  await chooseMemoryTab(first.cdp, '全部')
  await chooseMemoryTab(first.cdp, '共同记忆')
  await waitForText(first.cdp, '.memory-catalog-item > strong', revisedBody)

  await createHearthMemory(first.cdp, forgottenBody)
  await waitForText(first.cdp, '.memory-catalog-item > strong', forgottenBody)
  await clickMemoryAction(first.cdp, forgottenBody, '永久遗忘')
  await waitForSelector(first.cdp, '.memory-confirm-dialog')
  assert((await hasText(first.cdp, '.memory-confirm-dialog', '不能恢复'))
      || (await hasText(first.cdp, '.memory-confirm-dialog', '不可撤销')),
    'Forget confirmation did not communicate irreversibility')
  await clickButton(first.cdp, '.memory-confirm-dialog button', '永久遗忘')
  await waitForTextToDisappear(first.cdp, '.memory-catalog-item > strong', forgottenBody)
  await chooseMemoryTab(first.cdp, '已停止沿用')
  const forgottenRecord = (await request(first.cdp, 'memory.list')).memories
    .find((memory) => memory.lifecycle === 'forgotten')
  assert(forgottenRecord?.currentBody === null
      && forgottenRecord.revisions.every((revision) => revision.body === null),
  'UI forget left readable Revision text in SQLite reads')

  await closeApp(first)
  first = null
  await wait(750)

  second = await launchApp(firstPort + 1, 1040, 700)
  await assertNoMemoryOnboarding(second.cdp, 'Restarted database')
  await setTheme(second.cdp, 'night')
  await openMemory(second.cdp)
  const restartedLibrary = await request(second.cdp, 'memory.list')
  assert(restartedLibrary.memories.some((memory) => memory.currentBody === revisedBody),
    'Packaged Core did not return the active Memory after App restart')
  await chooseMemoryTab(second.cdp, '全部')
  await chooseMemoryTab(second.cdp, '共同记忆')
  await waitForText(second.cdp, '.memory-catalog-item > strong', revisedBody)
  assert(!(await hasText(second.cdp, 'body', forgottenBody)),
    'Forgotten Memory body returned after packaged App restart')
  await assertNoHorizontalOverflow(second.cdp, 'compact night Memory Library')
  const nightCapture = join(outputDir, 'memory-night-compact.png')
  await capture(second.cdp, nightCapture)

  console.log(JSON.stringify({
    ok: true,
    app: basename(appPath),
    dataDir,
    outputDir,
    verified: {
      packagedRendererToCoreIpc: true,
      noStartupMemorySettingsDialog: true,
      firstClassLongTermMemoryNavigation: true,
      freshDatabaseAgentWritesDefaultOn: true,
      restartedDatabaseAgentWritesDefaultOn: true,
      createReviseRevisionHistory: true,
      retireReactivate: true,
      irreversibleForget: true,
      sqliteIsTheOnlyMemoryAuthority: true,
      restartPersistence: true,
      dayAndNightPreferenceDayLayouts: true,
      horizontalOverflow: false
    },
    captures: {
      day: dayCapture,
      compactNightPreferenceDay: nightCapture
    }
  }, null, 2))
} finally {
  if (first) await closeApp(first)
  if (second) await closeApp(second)
}

async function createHearthMemory(cdp, body) {
  await clickButton(cdp, '.memory-library-header button', '＋ 新增记忆')
  await waitForSelector(cdp, '.memory-editor-dialog textarea')
  await replaceTextarea(cdp, body)
  await replaceRetrievalKeys(cdp, '验收记忆')
  await clickButton(cdp, '.memory-editor-dialog button', '保存')
  await waitForEditorOutcome(cdp, 'create')
}

async function assertNoMemoryOnboarding(cdp, context) {
  const dialogOpen = await evaluate(cdp,
    `Boolean(document.querySelector('.memory-onboarding-dialog'))`)
  assert(dialogOpen === false,
    `${context} unexpectedly showed a removed Memory permission onboarding dialog`)
}

async function openMemory(cdp) {
  const navigation = await evaluate(cdp, `(() => {
    const memory = [...document.querySelectorAll('.unified-sidebar button')]
      .find((candidate) => candidate.getAttribute('aria-label')?.startsWith('记忆'))
    if (!memory || memory.disabled) return null
    memory.click()
    return { height: memory.getBoundingClientRect().height }
  })()`)
  assert(navigation, 'Could not open long-term Memory from global navigation')
  assert(navigation.height <= 40,
    `Memory navigation label wrapped unexpectedly (${navigation.height}px high)`)
  await waitForSelector(cdp, '.memory-library')
  await waitForExpression(cdp, `!document.querySelector('.memory-library .memory-error')`)
}

async function chooseMemoryTab(cdp, label) {
  await clickButton(cdp, '.memory-scope-tabs button, .memory-governance-tabs button', label)
  await waitForExpression(cdp, `[
    ...document.querySelectorAll('.memory-scope-tabs button, .memory-governance-tabs button')
  ].some((button) => (button.textContent?.trim() === ${JSON.stringify(label)}
      || [...button.childNodes].some((node) =>
        node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === ${JSON.stringify(label)}))
    && (button.getAttribute('aria-current') === 'page'
      || button.getAttribute('aria-pressed') === 'true'))`)
}

async function clickMemoryAction(cdp, body, label) {
  const selected = await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.memory-catalog-item')]
      .find((candidate) => candidate.querySelector(':scope > strong')?.textContent
        === ${JSON.stringify(body)})
    if (!row) return false
    row.click()
    return true
  })()`)
  assert(selected, `Could not select Memory "${body}"`)
  await waitForExpression(cdp, `document.querySelector('.memory-detail > header h3')?.textContent
    === ${JSON.stringify(body)}`)
  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.memory-detail-actions button')]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
    if (!button) return false
    button.click()
    return true
  })()`)
  assert(clicked, `Could not click Memory action "${label}" for "${body}"`)
}

async function waitForEditorOutcome(cdp, operation) {
  await waitForExpression(cdp, `!document.querySelector('.memory-editor-dialog')
    || Boolean(document.querySelector('.memory-error'))`, 60_000)
  const state = await evaluate(cdp, `({
    dialogOpen: Boolean(document.querySelector('.memory-editor-dialog')),
    error: document.querySelector('.memory-error')?.textContent ?? null
  })`)
  assert(!state.dialogOpen, `Memory ${operation} failed in the packaged UI: ${state.error ?? 'unknown error'}`)
}

async function replaceTextarea(cdp, value) {
  const changed = await evaluate(cdp, `(() => {
    const textarea = document.querySelector('.memory-editor-dialog textarea')
    if (!textarea) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, ${JSON.stringify(value)})
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  assert(changed, 'Memory editor textarea was unavailable')
  await waitForExpression(cdp, `document.querySelector('.memory-editor-dialog textarea')?.value
    === ${JSON.stringify(value)}`)
}

async function replaceRetrievalKeys(cdp, value) {
  const changed = await evaluate(cdp, `(() => {
    const input = [...document.querySelectorAll('.memory-editor-dialog input')]
      .find((candidate) => candidate.closest('label')?.textContent?.includes('Retrieval Keys'))
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  assert(changed, 'Memory editor Retrieval Keys input was unavailable')
  await waitForExpression(cdp, `[...document.querySelectorAll('.memory-editor-dialog input')]
    .some((input) => input.value === ${JSON.stringify(value)})`)
}

async function clickButton(cdp, selector, label) {
  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)}
        || [...candidate.childNodes].some((node) =>
          node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === ${JSON.stringify(label)}))
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert(clicked, `Could not click enabled button "${label}" within ${selector}`)
}

async function request(cdp, method, params = {}) {
  return evaluate(cdp, `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`, true)
}

async function setTheme(cdp, preference) {
  await evaluate(cdp, `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  await waitForExpression(cdp, `document.documentElement.dataset.theme === 'day'`)
}

async function hasText(cdp, selector, text) {
  return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.textContent
    ?.includes(${JSON.stringify(text)}) === true`)
}

async function waitForText(cdp, selector, text) {
  try {
    await waitForExpression(cdp, `[...document.querySelectorAll(${JSON.stringify(selector)})]
      .some((node) => node.textContent === ${JSON.stringify(text)})`, 30_000)
  } catch {
    const visible = await evaluate(cdp, `document.querySelector('.memory-library')?.textContent ?? ''`)
    throw new Error(`Memory UI did not show ${JSON.stringify(text)}. Visible content: ${JSON.stringify(visible)}`)
  }
}

async function waitForTextToDisappear(cdp, selector, text) {
  await waitForExpression(cdp, `![...document.querySelectorAll(${JSON.stringify(selector)})]
    .some((node) => node.textContent === ${JSON.stringify(text)})`)
}

async function assertNoHorizontalOverflow(cdp, context) {
  const state = await evaluate(cdp, `({
    documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
    contentOverflow: [...document.querySelectorAll('.content, .memory-library, .memory-workbench, .memory-detail')]
      .some((node) => node.scrollWidth > node.clientWidth + 1)
  })`)
  assert(!state.documentOverflow && !state.contentOverflow,
    `${context} has horizontal overflow: ${JSON.stringify(state)}`)
}

async function launchApp(port, width, height) {
  const executable = join(appPath, 'Contents', 'MacOS', 'Rovai-ai')
  const stderr = []
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
    await waitForExpression(cdp, `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
    await waitForExpression(cdp, `Boolean(
      document.querySelector('.unified-sidebar button[aria-label="新对话"]:not(:disabled)')
    )`, 45_000)
    const health = await request(cdp, 'health.check')
    const expectedDatabasePath = await realpath(join(dataDir, 'rovai.sqlite'))
    const actualDatabasePath = await realpath(health.database.path)
    assert(actualDatabasePath === expectedDatabasePath,
      `Isolated App opened the wrong database: ${JSON.stringify({ expectedDatabasePath, actualDatabasePath })}`)
    return { cdp, child, port, stderr }
  } catch (error) {
    cdp?.close()
    await terminateChild(child)
    throw error
  }
}

async function closeApp(running) {
  try {
    await Promise.race([
      running.cdp.send('Browser.close'),
      wait(1_000)
    ])
  } catch {
    // The isolated test instance may already have exited.
  }
  running.cdp.close()
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5_000) {
    try {
      await fetch(`http://127.0.0.1:${running.port}/json`)
    } catch {
      await terminateChild(running.child)
      return
    }
    await wait(100)
  }
  await terminateChild(running.child)
  throw new Error(`Isolated packaged App did not close on debug port ${running.port}`)
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
