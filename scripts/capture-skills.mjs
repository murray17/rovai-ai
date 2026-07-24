import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const appPath = process.argv[2]
const outputPath = process.argv[3] ?? '/tmp/lumen-skills.png'
const userDataDir = process.env.LUMEN_CAPTURE_USER_DATA_DIR
const port = Number(process.env.LUMEN_DEBUG_PORT ?? 9443)
const width = Number(process.env.LUMEN_CAPTURE_WIDTH ?? 1440)
const height = Number(process.env.LUMEN_CAPTURE_HEIGHT ?? 920)
const theme = process.env.LUMEN_CAPTURE_THEME ?? 'day'

if (!appPath || !userDataDir) {
  throw new Error('Usage: LUMEN_CAPTURE_USER_DATA_DIR=<data> node scripts/capture-skills.mjs <Lumen AI.app> [output.png]')
}
if (!['day', 'night'].includes(theme)) throw new Error(`Unknown LUMEN_CAPTURE_THEME: ${theme}`)

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
  await waitForExpression(cdp, `Boolean(document.querySelector('.settings-entry'))`, 45_000)
  await cdp.send('Runtime.evaluate', {
    expression: `window.lumen.appearance.setPreference(${JSON.stringify(theme)})`,
    awaitPromise: true,
    returnByValue: true
  })
  await waitForExpression(cdp, `document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, 5_000)
  const opened = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const button = document.querySelector('.settings-entry')
      button?.focus()
      button?.click()
      return Boolean(button) && document.activeElement === button
    })()`,
    returnByValue: true
  })
  if (!opened.result?.result?.value) throw new Error('Settings entry was not keyboard-focusable')
  await waitForExpression(cdp, `document.querySelectorAll('.skill-row').length >= 2`, 30_000)

  const result = await evaluate(cdp, `(() => {
    const subnavButtons = [...document.querySelectorAll('.settings-subnav button')]
    const active = document.querySelector('.settings-subnav button.active')
    const skillRows = [...document.querySelectorAll('.skill-row')]
    const bundled = skillRows.filter((row) => row.textContent?.includes('Lumen 内置'))
    const enabled = skillRows.filter((row) =>
      row.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true'
    )
    const panel = document.querySelector('.settings-panel')
    return {
      theme: document.documentElement.dataset.theme,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      panelOverflow: panel ? panel.scrollWidth > panel.clientWidth : true,
      subnav: subnavButtons.map((button) => button.querySelector('strong')?.textContent?.trim()),
      activeSection: active?.querySelector('strong')?.textContent?.trim(),
      skillNames: skillRows.map((row) => row.querySelector('.skill-title-line > strong')?.textContent?.trim()),
      bundledCount: bundled.length,
      enabledBundledCount: bundled.filter((row) =>
        row.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true'
      ).length,
      enabledCount: enabled.length,
      importButton: [...document.querySelectorAll('.skill-settings button')]
        .some((button) => button.textContent?.trim() === '导入 Skill'),
      reconcileButton: [...document.querySelectorAll('.skill-settings button')]
        .some((button) => button.textContent?.trim() === '重新同步项目'),
      projectionStatusVisible: document.querySelector('.skill-settings')?.textContent?.includes('项目投影状态'),
      loadingVisible: document.querySelector('.skill-settings')?.textContent?.includes('正在读取 Skill Library')
    }
  })()`)

  if (result.theme !== theme
      || result.viewport.width !== width
      || result.viewport.height !== height
      || result.horizontalOverflow
      || result.panelOverflow
      || JSON.stringify(result.subnav) !== JSON.stringify(['技能', 'MCP', '外观', '诊断'])
      || result.activeSection !== '技能'
      || result.bundledCount < 2
      || result.enabledBundledCount < 2
      || !result.skillNames.includes('grill-me')
      || !result.skillNames.includes('grill-with-docs')
      || !result.importButton
      || !result.reconcileButton
      || !result.projectionStatusVisible
      || result.loadingVisible) {
    throw new Error(`Skill settings acceptance failed: ${JSON.stringify(result)}`)
  }

  await openSection(cdp, '外观')
  await waitForExpression(cdp, `Boolean(document.querySelector('.appearance-settings'))`, 5_000)
  const appearanceReady = await evaluate(cdp, `Boolean(document.querySelector('.appearance-settings'))`)
  await openSection(cdp, '诊断')
  await waitForExpression(cdp, `Boolean(document.querySelector('.diagnostics-card'))`, 5_000)
  const diagnosticsReady = await evaluate(cdp, `Boolean(document.querySelector('.diagnostics-card'))`)
  await openSection(cdp, '技能')
  await waitForExpression(cdp, `Boolean(document.querySelector('.skill-settings'))`, 5_000)
  const navigation = await evaluate(cdp, `(() => {
    const skills = [...document.querySelectorAll('.settings-subnav button')]
      .find((button) => button.textContent?.includes('技能'))
    return {
      appearanceReady: ${JSON.stringify(appearanceReady)},
      diagnosticsReady: ${JSON.stringify(diagnosticsReady)},
      skillsRestored: Boolean(document.querySelector('.skill-settings')),
      focused: document.activeElement === skills
    }
  })()`)
  if (!navigation.appearanceReady
      || !navigation.diagnosticsReady
      || !navigation.skillsRestored
      || !navigation.focused) {
    throw new Error(`Skill settings navigation acceptance failed: ${JSON.stringify(navigation)}`)
  }

  await capture(cdp, outputPath)
  cdp.close()
  console.log(JSON.stringify({ ok: true, ...result, navigation, outputPath }, null, 2))
} finally {
  app.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveClose) => app.once('close', resolveClose)),
    wait(2_000)
  ])
  if (app.exitCode === null) app.kill('SIGKILL')
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true
  })
  return response.result?.result?.value
}

async function openSection(cdp, label) {
  const opened = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.settings-subnav button')]
      .find((candidate) => candidate.textContent?.includes(${JSON.stringify(label)}))
    button?.focus()
    button?.click()
    return Boolean(button) && document.activeElement === button
  })()`)
  if (!opened) throw new Error(`${label} settings section was not keyboard-focusable`)
}

async function capture(cdp, path) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  })
  await writeFile(path, Buffer.from(result.result.data, 'base64'))
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
  while (Date.now() - startedAt < 20_000) {
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
