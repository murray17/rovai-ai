import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const appPath = process.argv[2]
const outputPrefix = process.argv[3] ?? '/tmp/rovai-mcp'
const port = Number(process.env.ROVAI_DEBUG_PORT ?? 9451)

if (!appPath) {
  throw new Error('Usage: node scripts/capture-mcp.mjs <Rovai-ai.app> [output-prefix]')
}

const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-mcp-app-'))
const home = join(fixtureRoot, 'home')
const userDataDir = join(fixtureRoot, 'electron')
const codexHome = join(home, '.codex')
const configPath = join(home, '.rovai', 'mcp.json')
await mkdir(codexHome, { recursive: true })
await mkdir(userDataDir, { recursive: true })
await writeFile(join(codexHome, 'config.toml'), [
  '[mcp_servers.imported_docs]',
  'command = "/usr/bin/env"',
  'args = ["node"]',
  'env = { API_TOKEN = "rovai-secret-must-not-render" }',
  ''
].join('\n'))

const executable = join(appPath, 'Contents', 'MacOS', 'Rovai-ai')
const app = spawn(executable, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`
], {
  env: {
    ...process.env,
    HOME: home,
    CODEX_HOME: codexHome
  },
  stdio: ['ignore', 'ignore', 'pipe']
})
const stderr = []
app.stderr.on('data', (chunk) => {
  stderr.push(String(chunk))
  if (process.env.ROVAI_CAPTURE_DEBUG === '1') process.stderr.write(chunk)
})

try {
  const target = await waitForTarget(port)
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.bringToFront')
  await resize(cdp, 1440, 920)
  await waitForExpression(cdp, `Boolean(document.querySelector('.unified-sidebar-footer button[aria-label="设置"]'))`, 45_000)
  await click(cdp, `.unified-sidebar-footer button[aria-label="设置"]`)
  await waitForExpression(cdp, `Boolean(document.querySelector('.settings-workbench'))`, 10_000)
  await clickButtonByText(cdp, '.settings-sidebar-menu button', 'MCP')
  await waitForExpression(cdp, `Boolean(document.querySelector('.mcp-settings'))`, 10_000)
  await waitForExpression(cdp, `Boolean(document.querySelector('.mcp-import-dialog'))`, 30_000)

  const initial = await evaluate(cdp, `(() => ({
    subnav: [...document.querySelectorAll('.settings-sidebar-menu strong')].map((node) => node.textContent?.trim()),
    candidateCount: document.querySelectorAll('.mcp-import-candidate').length,
    candidateStates: [...document.querySelectorAll('.mcp-import-candidate')].map((node) => ({
      text: node.innerText,
      disabled: node.querySelector('input[type="checkbox"]')?.disabled,
      checked: node.querySelector('input[type="checkbox"]')?.checked
    })),
    secretVisible: document.body.innerText.includes('rovai-secret-must-not-render'),
    context7Visible: document.body.innerText.toLowerCase().includes('context7'),
    sourceStatus: [...document.querySelectorAll('.mcp-source-status')].map((node) => node.textContent?.trim())
  }))()`)
  assert(
    JSON.stringify(initial.subnav) === JSON.stringify(['技能', 'MCP', 'Agent 运行时', '外观', '诊断']),
    `Settings navigation is incorrect: ${JSON.stringify(initial)}`
  )
  assert(initial.candidateCount === 1, `Expected one isolated Codex candidate: ${JSON.stringify(initial)}`)
  assert(!initial.candidateStates[0]?.disabled, `The isolated Codex candidate is not importable: ${JSON.stringify(initial)}`)
  assert(!initial.secretVisible, 'Imported literal secret reached the Renderer')
  assert(!initial.context7Visible, 'A default Context7 server appeared in the fresh MCP Library')

  await evaluate(cdp, `document.querySelector('.mcp-import-candidate input[type="checkbox"]')?.click()`)
  await wait(200)
  const selectedCandidate = await evaluate(cdp, `(() => ({
    checked: document.querySelector('.mcp-import-candidate input[type="checkbox"]')?.checked,
    options: Boolean(document.querySelector('.mcp-import-options')),
    dialog: Boolean(document.querySelector('.mcp-import-dialog')),
    body: document.body.innerText.slice(0, 1200),
    importButton: [...document.querySelectorAll('.mcp-import-dialog button')]
      .find((node) => node.textContent?.includes('导入所选'))?.outerHTML
  }))()`)
  assert(selectedCandidate.checked && selectedCandidate.options, `Candidate selection did not update: ${JSON.stringify(selectedCandidate)}`)
  await waitForExpression(cdp, `(() => {
    const button = [...document.querySelectorAll('.mcp-import-dialog button')]
      .find((node) => node.textContent?.includes('导入所选'))
    return Boolean(button) && !button.disabled
  })()`, 5_000)
  await clickButtonByText(cdp, '.mcp-import-dialog button', '导入所选')
  await waitForExpression(cdp, `document.querySelectorAll('.mcp-server-row').length === 1`, 15_000)
  const imported = await evaluate(cdp, `(() => {
    const row = document.querySelector('.mcp-server-row')
    return {
      text: row?.innerText,
      enabled: row?.querySelector('[role="switch"]')?.getAttribute('aria-checked'),
      secretVisible: document.body.innerText.includes('rovai-secret-must-not-render')
    }
  })()`)
  assert(imported.text.includes('imported_docs'), `Imported Server is missing: ${JSON.stringify(imported)}`)
  assert(imported.text.includes('API_TOKEN'), `Missing imported value is not explained: ${JSON.stringify(imported)}`)
  assert(imported.enabled === 'false', `Credential-incomplete import was enabled: ${JSON.stringify(imported)}`)
  assert(!imported.secretVisible, 'Imported literal secret reached the Library row')

  await clickButtonByText(cdp, '.mcp-settings button', '添加 MCP')
  await waitForExpression(cdp, `Boolean(document.querySelector('.mcp-editor-dialog'))`, 5_000)
  await setLabeledValue(cdp, '.mcp-editor-dialog', '名称', 'smoke-http')
  await setLabeledValue(cdp, '.mcp-editor-dialog', '连接方式', 'streamable_http', 'select')
  await setLabeledValue(cdp, '.mcp-editor-dialog', 'URL', 'https://example.test/mcp')
  await clickButtonByText(cdp, '.mcp-editor-dialog button', '保存')
  await waitForExpression(cdp, `document.querySelectorAll('.mcp-server-row').length === 2`, 10_000)

  await clickRowButton(cdp, 'smoke-http', '编辑')
  await waitForExpression(cdp, `Boolean(document.querySelector('.mcp-editor-dialog'))`, 5_000)
  const memberEdit = await evaluate(cdp, `(() => {
    const options = [...document.querySelectorAll('.mcp-member-options label')]
    const last = options.at(-1)?.querySelector('input')
    if (!last || !last.checked) return false
    last.click()
    return true
  })()`)
  assert(memberEdit, 'The Server editor did not expose active member assignments')
  await clickButtonByText(cdp, '.mcp-editor-dialog button', '保存')
  await waitForExpression(cdp, `!document.querySelector('.mcp-editor-dialog')`, 10_000)
  const assignment = await rowText(cdp, 'smoke-http')
  assert(assignment.includes('适用队员：'), 'Member assignment summary is missing')
  assert(!assignment.includes('绮露'), `Unchecked member remained assigned: ${assignment}`)

  await clickRowSwitch(cdp, 'smoke-http')
  await waitForExpression(cdp, `(() => {
    const row = [...document.querySelectorAll('.mcp-server-row')]
      .find((node) => node.querySelector('.mcp-server-title strong')?.textContent === 'smoke-http')
    return row?.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'false'
  })()`, 10_000)

  await chmod(configPath, 0o644)
  await evaluate(cdp, `window.dispatchEvent(new Event('focus'))`)
  await waitForExpression(cdp, `Boolean(document.querySelector('.mcp-permission-banner'))`, 10_000)
  await clickButtonByText(cdp, '.mcp-permission-banner button', '修复权限')
  await waitForExpression(cdp, `!document.querySelector('.mcp-permission-banner')`, 10_000)
  assert((await stat(configPath)).mode % 0o1000 === 0o600, 'Permission repair did not restore 0600')

  await capture(cdp, `${outputPrefix}-day.png`)
  const day = await layoutState(cdp)
  assertLayout(day, 1440, 920, 'day')

  await evaluate(cdp, `window.rovai.appearance.setPreference('night')`)
  await waitForExpression(cdp, `document.documentElement.dataset.theme === 'day'`, 5_000)
  await resize(cdp, 1040, 700)
  await capture(cdp, `${outputPrefix}-night-preference-day-compact.png`)
  const nightPreferenceDay = await layoutState(cdp)
  assertLayout(nightPreferenceDay, 1040, 700, 'day')

  await clickRowButton(cdp, 'smoke-http', '删除')
  await waitForExpression(cdp, `Boolean(document.querySelector('.compact-dialog'))`, 5_000)
  await clickButtonByText(cdp, '.compact-dialog button', '删除')
  await waitForExpression(cdp, `document.querySelectorAll('.mcp-server-row').length === 1`, 10_000)
  const finalNames = await evaluate(cdp, `[...document.querySelectorAll('.mcp-server-title > strong')].map((node) => node.textContent)`)
  assert(JSON.stringify(finalNames) === JSON.stringify(['imported_docs']), `Delete did not converge: ${JSON.stringify(finalNames)}`)

  cdp.close()
  console.log(JSON.stringify({
    ok: true,
    subnav: initial.subnav,
    sourceStatus: initial.sourceStatus,
    importedSecretRedacted: true,
    noDefaultContext7: true,
    memberAssignmentEdited: true,
    enableTogglePersisted: true,
    permissionsRepaired: true,
    day,
    nightPreferenceDay,
    finalNames,
    screenshots: [`${outputPrefix}-day.png`, `${outputPrefix}-night-preference-day-compact.png`]
  }, null, 2))
} finally {
  app.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveClose) => app.once('close', resolveClose)),
    wait(2_000)
  ])
  if (app.exitCode === null) app.kill('SIGKILL')
  await rm(fixtureRoot, { recursive: true, force: true })
}

async function resize(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  })
}

async function layoutState(cdp) {
  return evaluate(cdp, `(() => {
    const panel = document.querySelector('.settings-panel')
    const dialog = document.querySelector('[data-radix-dialog-content]')
    return {
      theme: document.documentElement.dataset.theme,
      width: window.innerWidth,
      height: window.innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      panelOverflow: panel ? panel.scrollWidth > panel.clientWidth : true,
      dialogOpen: Boolean(dialog),
      focusVisibleTarget: document.activeElement?.tagName
    }
  })()`)
}

function assertLayout(value, width, height, theme) {
  assert(value.width === width && value.height === height, `Viewport mismatch: ${JSON.stringify(value)}`)
  assert(value.theme === theme, `Theme mismatch: ${JSON.stringify(value)}`)
  assert(!value.horizontalOverflow && !value.panelOverflow, `MCP settings overflow: ${JSON.stringify(value)}`)
  assert(!value.dialogOpen, `Unexpected dialog obscured acceptance capture: ${JSON.stringify(value)}`)
}

async function setLabeledValue(cdp, root, label, value, control = 'input') {
  const changed = await evaluate(cdp, `(() => {
    const root = document.querySelector(${JSON.stringify(root)})
    const field = [...(root?.querySelectorAll('label') ?? [])]
      .find((candidate) => candidate.querySelector('span')?.textContent?.trim() === ${JSON.stringify(label)})
    const element = field?.querySelector(${JSON.stringify(control)})
    if (!element) return false
    const prototype = element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)})
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    return true
  })()`)
  assert(changed, `Could not set field ${label}`)
}

async function rowText(cdp, name) {
  return evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.mcp-server-row')]
      .find((node) => node.querySelector('.mcp-server-title strong')?.textContent === ${JSON.stringify(name)})
    return row?.innerText ?? ''
  })()`)
}

async function clickRowButton(cdp, name, label) {
  const clicked = await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.mcp-server-row')]
      .find((node) => node.querySelector('.mcp-server-title strong')?.textContent === ${JSON.stringify(name)})
    const button = [...(row?.querySelectorAll('button') ?? [])]
      .find((node) => node.textContent?.trim() === ${JSON.stringify(label)})
    button?.focus()
    button?.click()
    return Boolean(button)
  })()`)
  assert(clicked, `Could not click ${label} for ${name}`)
}

async function clickRowSwitch(cdp, name) {
  const clicked = await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.mcp-server-row')]
      .find((node) => node.querySelector('.mcp-server-title strong')?.textContent === ${JSON.stringify(name)})
    const button = row?.querySelector('[role="switch"]')
    button?.focus()
    button?.click()
    return Boolean(button)
  })()`)
  assert(clicked, `Could not toggle ${name}`)
}

async function clickButtonByText(cdp, selector, label) {
  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((node) => node.textContent?.trim().includes(${JSON.stringify(label)}))
    button?.focus()
    button?.click()
    return Boolean(button) && document.activeElement === button
  })()`)
  assert(clicked, `Button was missing or not focusable: ${label}`)
}

async function click(cdp, selector) {
  const clicked = await evaluate(cdp, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)})
    node?.focus()
    node?.click()
    return Boolean(node)
  })()`)
  assert(clicked, `Element was missing: ${selector}`)
}

async function capture(cdp, path) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  })
  await writeFile(path, Buffer.from(result.result.data, 'base64'))
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  })
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.text)
  }
  return response.result?.result?.value
}

async function waitForExpression(cdp, expression, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression)) return
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
    if (!message.id) {
      if (process.env.ROVAI_CAPTURE_DEBUG === '1' && message.method === 'Runtime.exceptionThrown') {
        process.stderr.write(`${JSON.stringify(message.params)}\n`)
      }
      return
    }
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
