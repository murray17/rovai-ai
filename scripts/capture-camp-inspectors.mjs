import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const appPath = process.argv[2]
const outputPrefix = process.argv[3] ?? '/tmp/lumen-camp-inspectors'
const userDataDir = process.env.LUMEN_CAPTURE_USER_DATA_DIR
const port = Number(process.env.LUMEN_DEBUG_PORT ?? 9433)
const width = Number(process.env.LUMEN_CAPTURE_WIDTH ?? 1440)
const height = Number(process.env.LUMEN_CAPTURE_HEIGHT ?? 920)
const theme = process.env.LUMEN_CAPTURE_THEME ?? null
const relaxed = process.env.LUMEN_CAPTURE_RELAXED === '1'

if (!appPath || !userDataDir) {
  throw new Error('Usage: LUMEN_CAPTURE_USER_DATA_DIR=<data> node scripts/capture-camp-inspectors.mjs <Lumen AI.app> [output-prefix]')
}
if (theme && !['system', 'day', 'night'].includes(theme)) {
  throw new Error(`Unknown LUMEN_CAPTURE_THEME: ${theme}`)
}

const executable = join(appPath, 'Contents', 'MacOS', 'Lumen AI')
const app = spawn(executable, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`
], { stdio: ['ignore', 'ignore', 'pipe'] })
const stderr = []
app.stderr.on('data', (chunk) => stderr.push(String(chunk)))

try {
  const target = await waitForTarget(port)
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  await cdp.send('Page.bringToFront')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  })
  if (theme) {
    await cdp.send('Runtime.evaluate', {
      expression: `window.lumen.appearance.setPreference(${JSON.stringify(theme)})`,
      awaitPromise: true,
      returnByValue: true
    })
    if (theme !== 'system') {
      await waitForExpression(cdp, `document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, 5_000)
    }
  }
  await waitForExpression(cdp, `Boolean(document.querySelector('.camp-nav-row'))`, 45_000)
  await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const group = document.querySelector('.camp-nav-group[data-group="lobby"] .camp-group-toggle')
      if (group?.getAttribute('aria-expanded') === 'false') group.click()
      document.querySelector('.camp-nav-row .camp-nav-open')?.click()
    })()`,
    returnByValue: true
  })
  await waitForExpression(cdp, `Boolean(document.querySelector('.camp-workspace'))`, 30_000)
  if (!relaxed) {
    await waitForExpression(cdp, `document.querySelectorAll('.a2a-row').length === 2`, 30_000)
  }
  const activityInspection = await cdp.send('Runtime.evaluate', {
    expression: `document.querySelectorAll('.a2a-row').length`,
    returnByValue: true
  })
  const a2aRows = activityInspection.result?.result?.value
  await capture(cdp, `${outputPrefix}-activity.png`)

  if (relaxed) {
    const panelCounts = {}
    for (const tabName of ['Task', '上下文', '审批', '审计']) {
      await openTab(cdp, tabName)
      const tabSlug = ({ Task: 'tasks', 上下文: 'context', 审批: 'approvals', 审计: 'audit' })[tabName]
      const selector = ({
        Task: '.task-list-row',
        上下文: '.context-card',
        审批: '.approval-card',
        审计: '.audit-row'
      })[tabName]
      const count = await cdp.send('Runtime.evaluate', {
        expression: `document.querySelectorAll(${JSON.stringify(selector)}).length`,
        returnByValue: true
      })
      panelCounts[tabSlug] = count.result?.result?.value
      await capture(cdp, `${outputPrefix}-${tabSlug}.png`)
    }
    const relaxedInspection = await cdp.send('Runtime.evaluate', {
      expression: `({
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        theme: document.documentElement.dataset.theme,
        viewport: { width: window.innerWidth, height: window.innerHeight }
      })`,
      returnByValue: true
    })
    const result = { a2aRows, ...panelCounts, ...relaxedInspection.result?.result?.value }
    if (result.horizontalOverflow || (theme && theme !== 'system' && result.theme !== theme)) {
      throw new Error(`Camp workspace acceptance failed: ${JSON.stringify(result)}`)
    }
    cdp.close()
    console.log(JSON.stringify({ ok: true, ...result }, null, 2))
    process.stdout.write(`${outputPrefix}-activity.png\n`)
    process.stdout.write(`${outputPrefix}-tasks.png\n`)
    process.stdout.write(`${outputPrefix}-context.png\n`)
    process.stdout.write(`${outputPrefix}-approvals.png\n`)
    process.stdout.write(`${outputPrefix}-audit.png\n`)
  }

  if (!relaxed) {
    await openTab(cdp, '上下文')
    await waitForExpression(cdp, `document.querySelectorAll('.context-card').length === 3`, 10_000)
    const inspection = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const panel = document.querySelector('.context-panel')
        const text = panel?.textContent ?? ''
        return {
          contextCards: document.querySelectorAll('.context-card').length,
          compactions: document.querySelectorAll('.compaction-row').length,
          leakedFrozenPrompt: text.includes('[CURRENT_INPUT]') || text.includes('执行 A2A 验收协议'),
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
          activeTab: document.activeElement?.textContent?.includes('上下文') ?? false,
          viewport: { width: window.innerWidth, height: window.innerHeight }
        }
      })()`,
      returnByValue: true
    })
    const result = { a2aRows, ...inspection.result?.result?.value }
    if (result.a2aRows !== 2
        || result?.contextCards !== 3
        || result?.compactions !== 0
        || result?.leakedFrozenPrompt
        || result?.horizontalOverflow
        || !result?.activeTab) {
      throw new Error(`Camp Inspector acceptance failed: ${JSON.stringify(result)}`)
    }
    await capture(cdp, `${outputPrefix}-context.png`)
    cdp.close()
    console.log(JSON.stringify({ ok: true, ...result }, null, 2))
    process.stdout.write(`${outputPrefix}-activity.png\n${outputPrefix}-context.png\n`)
  }
} finally {
  app.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveClose) => app.once('close', resolveClose)),
    wait(2_000)
  ])
  if (app.exitCode === null) app.kill('SIGKILL')
}

async function capture(cdp, path) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  })
  await writeFile(path, Buffer.from(result.result.data, 'base64'))
}

async function openTab(cdp, label) {
  const opened = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const tab = [...document.querySelectorAll('.tabs-list button')]
        .find((button) => button.textContent?.includes(${JSON.stringify(label)}))
      tab?.focus()
      tab?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
      tab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      tab?.click()
      return Boolean(tab) && document.activeElement === tab
    })()`,
    returnByValue: true
  })
  if (!opened.result?.result?.value) throw new Error(`${label} tab was not keyboard-focusable`)
  await waitForExpression(cdp, `(() => {
    const tab = [...document.querySelectorAll('.tabs-list button')]
      .find((button) => button.textContent?.includes(${JSON.stringify(label)}))
    return tab?.getAttribute('data-state') === 'active'
  })()`, 5_000)
}

async function waitForExpression(cdp, expression, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const state = await cdp.send('Runtime.evaluate', { expression, returnByValue: true })
    if (state.result?.result?.value) return
    await wait(100)
  }
  throw new Error(`Expression did not become true within ${timeoutMs}ms: ${expression}`)
}

async function waitForTarget(debugPort) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 15_000) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => response.json())
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

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
