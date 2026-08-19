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
    `document.documentElement.dataset.theme === ${JSON.stringify(theme)}`,
    5_000
  )
  const existingDialog = await cdp.send('Runtime.evaluate', {
    expression: `Boolean(document.querySelector('.new-camp-dialog'))`,
    returnByValue: true
  })
  if (existingDialog.result?.result?.value) {
    await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('.new-camp-dialog .dialog-close')?.click()`
    })
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
  const memberSelection = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const checks = [...document.querySelectorAll('.new-camp-member-option input[type="checkbox"]')]
      return { count: checks.length, selected: checks.filter((input) => input.checked).length }
    })()`,
    returnByValue: true
  })
  const memberSelectionValue = memberSelection.result?.result?.value ?? { count: 0, selected: 0 }

  const inspection = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const dialog = document.querySelector('.new-camp-dialog')
      const text = dialog?.textContent ?? ''
      const buttons = [...(dialog?.querySelectorAll('button') ?? [])]
      const primary = buttons.find((button) => button.classList.contains('primary-button'))
      const rect = dialog?.getBoundingClientRect()
      return {
        title: dialog?.querySelector('h2')?.textContent,
        primary: primary?.textContent?.trim(),
        primaryEnabled: primary?.disabled === false,
        description: document.getElementById(dialog?.getAttribute('aria-describedby') ?? '')?.textContent?.trim(),
        collaborationRemoved: !text.includes('并肩协作')
          && !text.includes('领队统筹')
          && !text.includes('暂未开放')
          && !text.includes('协作方式'),
        saysRecommended: text.includes('推荐'),
        optionalShell: Boolean(dialog?.querySelector('.new-camp-optional-shell')),
        optionalCollapsed: !dialog?.querySelector('.new-camp-optional-panel'),
        headerCreationIcon: Boolean(dialog?.querySelector('.new-camp-dialog-header-icon svg path')),
        leadPicker: (() => {
          const trigger = dialog?.querySelector('.new-camp-lead-trigger')
          return {
            custom: Boolean(trigger) && !dialog?.querySelector('.new-camp-lead-field select'),
            hasAvatar: Boolean(trigger?.querySelector('.member-avatar')),
            hasAvailability: trigger?.textContent?.includes('可用') === true,
            hasAriaPopup: trigger?.getAttribute('aria-haspopup') === 'menu'
          }
        })(),
        agentRuntimeCopyRemoved: !text.includes('Agent 运行时'),
        defaultsAttentionRemoved: !text.includes('默认配置已失效')
          && !text.includes('已保存配置曾失效')
          && !text.includes('以上调整只用于本次创建'),
        dropdownIcons: (() => {
          const icons = [...dialog.querySelectorAll('.new-camp-chevron')]
          const rightEdges = icons.map((icon) => icon.getBoundingClientRect().right)
          return {
            count: icons.length,
            allSvg: icons.every((icon) => icon.tagName === 'svg'),
            positions: icons.map((icon) => ({
              right: icon.getBoundingClientRect().right,
              parentClass: icon.parentElement?.className ?? null
            })),
            rightEdgeSpread: rightEdges.length > 0
              ? Math.max(...rightEdges) - Math.min(...rightEdges)
              : null
          }
        })(),
        selectedMembers: ${JSON.stringify(memberSelectionValue.selected)},
        memberCount: ${JSON.stringify(memberSelectionValue.count)},
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
    || value?.optionalCollapsed !== true
    || value?.headerCreationIcon !== true
    || value?.leadPicker?.custom !== true
    || value?.leadPicker?.hasAvatar !== true
    || value?.leadPicker?.hasAvailability !== true
    || value?.leadPicker?.hasAriaPopup !== true
    || value?.agentRuntimeCopyRemoved !== true
    || value?.defaultsAttentionRemoved !== true
    || value?.dropdownIcons?.count !== 4
    || value?.dropdownIcons?.allSvg !== true
    || value?.dropdownIcons?.rightEdgeSpread > 2
    || value?.memberCount < 1
    || value?.selectedMembers !== value?.memberCount
    || value?.focusedProject !== true
    || value?.viewportOverflow !== false
    || value?.dialogOverflow !== false
  ) {
    throw new Error(`New Conversation Dialog acceptance failed: ${JSON.stringify(value)}`)
  }
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('.new-camp-picker-menu.member-menu')
      ? document.querySelector('.new-camp-picker-trigger.member-trigger')?.click()
      : undefined`
  })
  await waitForExpression(
    cdp,
    `document.querySelector('.new-camp-picker-menu.member-menu') === null`,
    5_000
  )
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('.new-camp-lead-trigger')?.focus()`
  })
  await wait(100)
  await dispatchDomKey(cdp, 'ArrowDown')
  await waitForExpression(
    cdp,
    `Boolean(document.querySelector('.new-camp-lead-menu'))`,
    5_000
  )
  const leadMenuInspection = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const menu = document.querySelector('.new-camp-lead-menu')
      const options = [...(menu?.querySelectorAll('[role="menuitemradio"]') ?? [])]
      return {
        count: options.length,
        allHaveAvatars: options.every((option) => Boolean(option.querySelector('.member-avatar'))),
        checkedCount: options.filter((option) => option.getAttribute('aria-checked') === 'true').length,
        activeInside: Boolean(menu?.contains(document.activeElement)),
        activeLabel: document.activeElement?.getAttribute('aria-label') ?? null
      }
    })()`,
    returnByValue: true
  })
  const leadMenuValue = leadMenuInspection.result?.result?.value
  if (
    leadMenuValue?.count !== memberSelectionValue.selected
    || leadMenuValue?.allHaveAvatars !== true
    || leadMenuValue?.checkedCount !== 1
    || leadMenuValue?.activeInside !== true
  ) {
    throw new Error(`Lead picker acceptance failed: ${JSON.stringify(leadMenuValue)}`)
  }
  await dispatchDomKey(cdp, 'ArrowDown')
  if (leadMenuValue.count > 1) {
    await waitForExpression(
      cdp,
      `document.activeElement?.getAttribute('aria-label') !== ${JSON.stringify(leadMenuValue.activeLabel)}`,
      5_000
    )
  }
  const navigatedLead = await cdp.send('Runtime.evaluate', {
    expression: `document.activeElement?.getAttribute('aria-label') ?? null`,
    returnByValue: true
  })
  const navigatedLeadLabel = navigatedLead.result?.result?.value
  if (leadMenuValue.count > 1 && navigatedLeadLabel === leadMenuValue.activeLabel) {
    throw new Error(`Lead picker arrow navigation did not move focus: ${JSON.stringify(leadMenuValue)}`)
  }
  if (leadMenuValue.count > 1) {
    await dispatchDomKey(cdp, 'Enter')
  } else {
    await dispatchDomKey(cdp, 'Escape')
  }
  await waitForExpression(cdp, `document.querySelector('.new-camp-lead-menu') === null`, 5_000)
  await waitForExpression(
    cdp,
    `document.activeElement?.classList.contains('new-camp-lead-trigger') === true`,
    5_000
  )
  await wait(100)
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('.new-camp-optional-trigger')?.click()`
  })
  await waitForExpression(cdp, `document.activeElement?.id === 'new-camp-name'`, 5_000)
  const optionalInspection = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const trigger = document.querySelector('.new-camp-optional-trigger')
      const panel = document.querySelector('.new-camp-optional-panel')
      const input = document.getElementById('new-camp-name')
      const triggerRect = trigger?.getBoundingClientRect()
      const panelRect = panel?.getBoundingClientRect()
      return {
        expanded: trigger?.getAttribute('aria-expanded') === 'true',
        placeholder: input?.getAttribute('placeholder'),
        focused: document.activeElement === input,
        indent: triggerRect && panelRect ? panelRect.left - triggerRect.left : null,
        unnamedHint: panel?.textContent?.includes('留空将创建为「未命名对话」。') === true
      }
    })()`,
    returnByValue: true
  })
  const optionalValue = optionalInspection.result?.result?.value
  if (
    optionalValue?.expanded !== true
    || optionalValue?.placeholder !== '输入名称...'
    || optionalValue?.focused !== true
    || optionalValue?.indent < 40
    || optionalValue?.unnamedHint !== true
  ) {
    throw new Error(`Optional name acceptance failed: ${JSON.stringify(optionalValue)}`)
  }

  await cdp.send('Page.bringToFront')
  await wait(100)
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
  const keyDefinition = {
    ArrowDown: { code: 'ArrowDown', virtualKey: 40 },
    Enter: { code: 'Enter', virtualKey: 13 },
    Escape: { code: 'Escape', virtualKey: 27 },
    Tab: { code: 'Tab', virtualKey: 9 }
  }[key] ?? { code: key, virtualKey: key.charCodeAt(0) }
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code: keyDefinition.code,
    windowsVirtualKeyCode: keyDefinition.virtualKey,
    nativeVirtualKeyCode: keyDefinition.virtualKey
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code: keyDefinition.code,
    windowsVirtualKeyCode: keyDefinition.virtualKey,
    nativeVirtualKeyCode: keyDefinition.virtualKey
  })
}

async function dispatchDomKey(cdp, key) {
  await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const target = document.activeElement
      if (!target) return false
      const init = { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true, cancelable: true }
      target.dispatchEvent(new KeyboardEvent('keydown', init))
      target.dispatchEvent(new KeyboardEvent('keyup', init))
      return true
    })()`,
    returnByValue: true
  })
}
