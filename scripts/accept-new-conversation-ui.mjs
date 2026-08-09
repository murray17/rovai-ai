import { writeFile } from 'node:fs/promises'

const port = Number(process.env.ROVAI_DEBUG_PORT ?? 9223)
const width = Number(process.env.ROVAI_CAPTURE_WIDTH ?? 1440)
const height = Number(process.env.ROVAI_CAPTURE_HEIGHT ?? 920)
const scale = Number(process.env.ROVAI_CAPTURE_SCALE ?? 1)
const theme = process.env.ROVAI_CAPTURE_THEME ?? 'day'
const createCamp = process.env.ROVAI_ACCEPT_CREATE === '1'
const reducedMotion = process.env.ROVAI_REDUCED_MOTION === '1'
const output = process.argv[2] ?? '/tmp/rovai-new-conversation.png'

if (!['day', 'night'].includes(theme)) throw new Error(`Unsupported theme: ${theme}`)
if (!Number.isFinite(scale) || scale < 1) throw new Error(`Unsupported scale: ${scale}`)

const target = await waitForTarget(port)
const cdp = await connectCdp(target.webSocketDebuggerUrl)
try {
  await cdp.send('Page.bringToFront')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: Math.floor(width / scale),
    height: Math.floor(height / scale),
    deviceScaleFactor: scale,
    mobile: false
  })
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{
      name: 'prefers-reduced-motion',
      value: reducedMotion ? 'reduce' : 'no-preference'
    }]
  })
  await cdp.send('Runtime.evaluate', {
    expression: `window.rovai.appearance.setPreference(${JSON.stringify(theme)})`,
    awaitPromise: true,
    returnByValue: true
  })
  await waitForExpression(
    cdp,
    `document.documentElement.dataset.theme === 'day'`,
    5_000
  )
  const existingDialog = await cdp.send('Runtime.evaluate', {
    expression: `Boolean(document.querySelector('.new-camp-dialog'))`,
    returnByValue: true
  })
  if (existingDialog.result?.result?.value) {
    await pressKey(cdp, 'Escape')
    await waitForExpression(cdp, `document.querySelector('.new-camp-dialog') === null`, 5_000)
  }
  await waitForExpression(
    cdp,
    `Boolean([...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === '新对话' && !button.disabled))`,
    20_000
  )
  await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.getAttribute('aria-label') === '新对话')
      button?.focus()
      button?.click()
    })()`
  })
  await waitForExpression(cdp, `Boolean(document.querySelector('.new-camp-dialog'))`, 5_000)
  await waitForExpression(
    cdp,
    `document.activeElement?.classList.contains('new-camp-picker-trigger') === true`,
    5_000
  )
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('.new-camp-picker-trigger.member-trigger')?.click()`
  })
  await waitForExpression(
    cdp,
    `document.querySelectorAll('.new-camp-member-option input[type="checkbox"]').length > 0`,
    5_000
  )

  const inspection = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const dialog = document.querySelector('.new-camp-dialog')
      const text = dialog?.textContent ?? ''
      const buttons = [...(dialog?.querySelectorAll('button') ?? [])]
      const primary = buttons.find((button) => button.classList.contains('primary-button'))
      const memberChecks = [...(dialog?.querySelectorAll('.new-camp-member-option input[type="checkbox"]') ?? [])]
      const rect = dialog?.getBoundingClientRect()
      return {
        title: dialog?.querySelector('h2')?.textContent,
        primary: primary?.textContent?.trim(),
        primaryEnabled: primary?.disabled === false,
        description: dialog?.querySelector('[data-radix-dialog-description]')?.textContent?.trim(),
        collaborationRemoved: !text.includes('并肩协作')
          && !text.includes('领队统筹')
          && !text.includes('暂未开放')
          && !text.includes('协作方式'),
        saysRecommended: text.includes('推荐'),
        optionalShell: Boolean(dialog?.querySelector('.new-camp-optional-shell')),
        selectedMembers: memberChecks.filter((input) => input.checked).length,
        memberCount: memberChecks.length,
        focusedProject: document.activeElement?.classList.contains('new-camp-picker-trigger'),
        viewportOverflow: document.documentElement.scrollWidth > window.innerWidth,
        overflowNodes: [...document.querySelectorAll('body *')]
          .filter((node) => {
            const nodeRect = node.getBoundingClientRect()
            return nodeRect.right > window.innerWidth + 1 || nodeRect.left < -1
          })
          .slice(0, 8)
          .map((node) => ({ tag: node.tagName, className: node.className, right: Math.round(node.getBoundingClientRect().right) })),
        dialogOverflow: Boolean(rect && (rect.left < 0 || rect.right > window.innerWidth || rect.top < 0 || rect.bottom > window.innerHeight)),
        bodyScrollable: (() => {
          const body = dialog?.querySelector('.new-camp-dialog-body')
          return Boolean(body && body.scrollHeight >= body.clientHeight)
        })()
      }
    })()`,
    returnByValue: true
  })
  const value = inspection.result?.result?.value
  if (
    value?.title !== '创建新对话'
    || value?.primary !== '创建'
    || value?.primaryEnabled !== true
    || value?.description !== '确定这段对话的工作环境与队员。'
    || value?.collaborationRemoved !== true
    || value?.saysRecommended !== false
    || value?.optionalShell !== true
    || value?.memberCount < 1
    || value?.selectedMembers !== value?.memberCount
    || value?.focusedProject !== true
    || value?.viewportOverflow !== false
    || value?.dialogOverflow !== false
  ) {
    throw new Error(`New Conversation Dialog acceptance failed: ${JSON.stringify(value)}`)
  }
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('.new-camp-picker-trigger.member-trigger')?.click()`
  })
  await waitForExpression(
    cdp,
    `document.querySelector('.new-camp-picker-menu.member-menu') === null`,
    5_000
  )
  await pressKey(cdp, 'Tab')
  await waitForExpression(
    cdp,
    `document.querySelector('.new-camp-dialog')?.contains(document.activeElement) === true`,
    5_000
  )

  const screenshot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  })
  await writeFile(output, Buffer.from(screenshot.result.data, 'base64'))
  if (createCamp) {
    await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('.new-camp-dialog .primary-button')?.click()`
    })
    await waitForExpression(
      cdp,
      `document.querySelector('.new-camp-dialog') === null && Boolean(document.querySelector('#camp-message'))`,
      10_000
    )
    await waitForExpression(cdp, `document.activeElement?.id === 'camp-message'`, 5_000)
    const created = await cdp.send('Runtime.evaluate', {
      expression: `({
        title: document.querySelector('.topbar h1')?.textContent,
        composerFocused: document.activeElement?.id === 'camp-message',
        publicMessages: document.querySelectorAll('.conversation-bubble').length,
        selectedCamp: document.querySelector('.camp-nav-row.selected')?.textContent
      })`,
      returnByValue: true
    })
    const createdValue = created.result?.result?.value
    if (
      createdValue?.title !== '未命名对话'
      || createdValue?.composerFocused !== true
      || createdValue?.publicMessages !== 0
      || !createdValue?.selectedCamp?.includes('未命名对话')
    ) {
      throw new Error(`Created Camp acceptance failed: ${JSON.stringify(createdValue)}`)
    }
  } else {
    await pressKey(cdp, 'Escape')
    await waitForExpression(cdp, `document.querySelector('.new-camp-dialog') === null`, 5_000)
    await waitForExpression(
      cdp,
      `document.activeElement?.getAttribute('aria-label') === '新对话'`,
      5_000
    )
  }
  process.stdout.write(`${output}\n`)
} finally {
  cdp.close()
}

async function waitForTarget(debugPort) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 15_000) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json`)
        .then((response) => response.json())
      const target = targets.find((candidate) => candidate.type === 'page')
      if (target) return target
    } catch {
      // Electron is still starting.
    }
    await wait(100)
  }
  throw new Error('Electron DevTools target did not appear')
}

async function waitForExpression(cdp, expression, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const state = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true
    })
    if (state.result?.result?.value) return
    await wait(80)
  }
  throw new Error(`Expression did not become true: ${expression}`)
}

async function connectCdp(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 1
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const request = message.id ? pending.get(message.id) : null
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message)
  })
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() {
      socket.close()
    }
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function pressKey(cdp, key) {
  const virtualKey = key === 'Tab' ? 9 : key === 'Escape' ? 27 : key.charCodeAt(0)
  const code = key === 'Tab' ? 'Tab' : key === 'Escape' ? 'Escape' : key
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey
  })
}
