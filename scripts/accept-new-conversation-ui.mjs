import { writeFile } from 'node:fs/promises'

const port = Number(process.env.ROVAI_DEBUG_PORT ?? 9223)
const width = Number(process.env.ROVAI_CAPTURE_WIDTH ?? 1440)
const height = Number(process.env.ROVAI_CAPTURE_HEIGHT ?? 920)
const scale = Number(process.env.ROVAI_CAPTURE_SCALE ?? 1)
const theme = process.env.ROVAI_CAPTURE_THEME ?? 'day'
const createCamp = process.env.ROVAI_ACCEPT_CREATE === '1'
const enableOneClick = process.env.ROVAI_ACCEPT_ONE_CLICK === '1'
const expectPreferenceFailure = process.env.ROVAI_ACCEPT_PREFERENCE_FAILURE === '1'
const reducedMotion = process.env.ROVAI_REDUCED_MOTION === '1'
const output = process.argv[2] ?? '/tmp/rovai-new-conversation.png'

if (!['day', 'night'].includes(theme)) throw new Error(`Unsupported theme: ${theme}`)
if (!Number.isFinite(scale) || scale < 1) throw new Error(`Unsupported scale: ${scale}`)

const target = await waitForTarget(port)
const cdp = await connectCdp(target.webSocketDebuggerUrl)
try {
  const originalPreferences = await evaluate(cdp, 'window.rovai.generalPreferences.get()')
  if (originalPreferences.oneClickNewConversationEnabled) throw new Error('Acceptance requires an isolated profile with one-click disabled')
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
      expression: `document.querySelector('.new-camp-dialog .compact-close')?.click()`
    })
    await waitForExpression(cdp, `document.querySelector('.new-camp-dialog') === null`, 5_000)
  }
  await waitForExpression(
    cdp,
    `Boolean([...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === '新对话' && !button.disabled))`,
    45_000
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
    expression: `document.querySelector('button[aria-labelledby~="new-camp-members-label"]')?.focus()`
  })
  await pressKey(cdp, 'ArrowDown')
  await waitForExpression(
    cdp,
    `document.querySelectorAll('.compact-menu[aria-label="选择队员"] [role="menuitemcheckbox"]').length > 0`,
    5_000
  )
  const memberSelection = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const checks = [...document.querySelectorAll('.compact-menu[aria-label="选择队员"] [role="menuitemcheckbox"]')]
      return { count: checks.length, selected: checks.filter((input) => input.getAttribute('aria-checked') === 'true').length }
    })()`,
    returnByValue: true
  })
  const memberSelectionValue = memberSelection.result?.result?.value ?? { count: 0, selected: 0 }

  const inspection = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const dialog = document.querySelector('.new-camp-dialog')
      const text = dialog?.textContent ?? ''
      const buttons = [...(dialog?.querySelectorAll('button') ?? [])]
      const primary = buttons.find((button) => button.classList.contains('compact-primary'))
      const rect = dialog?.getBoundingClientRect()
      return {
        title: dialog?.querySelector('h2')?.textContent,
        quickSettingUnchecked: dialog?.querySelector('.new-camp-quick-label input')?.checked === false,
        memberGrid: (() => {
          const items = [...document.querySelectorAll('.new-camp-member-grid [role=menuitemcheckbox]')]
          const rects = items.map(item => item.getBoundingClientRect())
          return rects.every((rect, index) => index < 2 || Math.abs(rect.left - rects[index % 2].left) < 1)
            && (rects.length < 2 || Math.abs(rects[0].top - rects[1].top) < 1)
            && (rects.length < 3 || rects[2].top > rects[0].top)
        })(),
        primary: primary?.textContent?.trim(),
        primaryEnabled: primary?.disabled === false,
        description: document.getElementById(dialog?.getAttribute('aria-describedby') ?? '')?.textContent?.trim(),
        collaborationRemoved: !text.includes('并肩协作')
          && !text.includes('领队统筹')
          && !text.includes('暂未开放')
          && !text.includes('协作方式'),
        saysRecommended: text.includes('推荐'),
        optionalShell: Boolean(dialog?.querySelector('.compact-name-disclosure')),
        optionalCollapsed: !dialog?.querySelector('.compact-name-field'),
        headerCreationIcon: Boolean(dialog?.querySelector('.new-camp-dialog-header-icon svg path')),
        leadPicker: (() => {
          const trigger = dialog?.querySelector('button[aria-labelledby~="new-camp-lead-label"]')
          return {
            custom: Boolean(trigger) && !dialog?.querySelector('.new-camp-lead-field select'),
            hasAvatar: Boolean(trigger?.querySelector('.member-avatar')),
            hasAvailability: trigger?.textContent?.includes('可用') === true,
            hasAriaPopup: trigger?.getAttribute('aria-haspopup') === 'menu'
          }
        })(),
        agentRuntimeCopyRemoved: !dialog?.querySelector('button[aria-labelledby~="new-camp-lead-label"]')?.textContent?.includes('Agent 运行时'),
        defaultsAttentionRemoved: !text.includes('默认配置已失效')
          && !text.includes('已保存配置曾失效')
          && !text.includes('以上调整只用于本次创建'),
        dropdownIcons: (() => {
          const icons = [...dialog.querySelectorAll('.compact-picker > svg:last-child')]
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
        memberMenuFocused: Boolean(document.querySelector('.compact-menu[aria-label="选择队员"]')?.contains(document.activeElement)),
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
          const body = dialog?.querySelector('.compact-body')
          return Boolean(body && body.scrollHeight >= body.clientHeight)
        })()
      }
    })()`,
    returnByValue: true
  })
  const value = inspection.result?.result?.value
  if (
    value?.title !== '新对话'
    || value?.quickSettingUnchecked !== true
    || value?.memberGrid !== true
    || value?.primary !== '新建'
    || value?.primaryEnabled !== true
    || value?.description !== '选择工作目录、队员与负责人。对话名称可选。'
    || value?.collaborationRemoved !== true
    || value?.saysRecommended !== false
    || value?.optionalShell !== true
    || value?.optionalCollapsed !== true
    || value?.headerCreationIcon !== false
    || value?.leadPicker?.custom !== true
    || value?.leadPicker?.hasAvatar !== true
    || value?.leadPicker?.hasAriaPopup !== true
    || value?.agentRuntimeCopyRemoved !== true
    || value?.defaultsAttentionRemoved !== true
    || value?.dropdownIcons?.count !== 3
    || value?.dropdownIcons?.allSvg !== true
    || value?.dropdownIcons?.rightEdgeSpread > 2
    || value?.memberCount < 1
    || value?.selectedMembers !== value?.memberCount
    || value?.memberMenuFocused !== true
    || value?.viewportOverflow !== false
    || value?.dialogOverflow !== false
  ) {
    throw new Error(`New Conversation Dialog acceptance failed: ${JSON.stringify(value)}`)
  }
  if (memberSelectionValue.count >= 4) {
    const activeIndex = `Array.from(document.querySelectorAll('.new-camp-member-grid [role=menuitemcheckbox]')).indexOf(document.activeElement)`
    await evaluate(cdp, `document.querySelector('.new-camp-member-grid [role=menuitemcheckbox]').focus()`)
    await pressKey(cdp, 'ArrowRight')
    await waitForExpression(cdp, `${activeIndex} === 1`, 5_000)
    await pressKey(cdp, 'ArrowDown')
    await waitForExpression(cdp, `${activeIndex} === 3`, 5_000)
    await pressKey(cdp, 'ArrowLeft')
    await waitForExpression(cdp, `${activeIndex} === 2`, 5_000)
    await pressKey(cdp, 'ArrowUp')
    await waitForExpression(cdp, `${activeIndex} === 0`, 5_000)
  }
  if (scale === 1) {
    const rosterScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true })
    await writeFile(output.replace(/\.png$/, '-roster.png'), Buffer.from(rosterScreenshot.result.data, 'base64'))
  }
  if (enableOneClick && memberSelectionValue.count > 1) {
    await evaluate(cdp, `document.querySelector('.new-camp-member-grid [role=menuitemcheckbox]').click()`)
    memberSelectionValue.selected -= 1
    await waitForExpression(cdp, `document.querySelectorAll('.new-camp-member-grid [aria-checked="true"]').length === ${memberSelectionValue.selected}`, 5_000)
  }
  await pressKey(cdp, 'Escape')
  await waitForExpression(
    cdp,
    `document.querySelector('.compact-menu[aria-label="选择队员"]') === null`,
    5_000
  )
  await waitForExpression(cdp, `document.activeElement?.matches('button[aria-labelledby~="new-camp-members-label"]') === true`, 5_000)
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('button[aria-labelledby~="new-camp-lead-label"]')?.focus()`
  })
  await wait(100)
  await pressKey(cdp, 'ArrowDown')
  await waitForExpression(
    cdp,
    `Boolean(document.querySelector('.compact-menu[aria-label="选择负责人"]'))`,
    5_000
  )
  const leadMenuInspection = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const menu = document.querySelector('.compact-menu[aria-label="选择负责人"]')
      const options = [...(menu?.querySelectorAll('[role="menuitemradio"]') ?? [])]
      return {
        count: options.length,
        allHaveAvatars: options.every((option) => Boolean(option.querySelector('.member-avatar'))),
        checkedCount: options.filter((option) => option.getAttribute('aria-checked') === 'true').length,
        activeInside: Boolean(menu?.contains(document.activeElement)),
        activeLabel: document.activeElement?.textContent ?? null
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
  await pressKey(cdp, 'ArrowDown')
  if (leadMenuValue.count > 1) {
    await waitForExpression(
      cdp,
      `document.activeElement?.textContent !== ${JSON.stringify(leadMenuValue.activeLabel)}`,
      5_000
    )
  }
  const navigatedLead = await cdp.send('Runtime.evaluate', {
    expression: `document.activeElement?.textContent ?? null`,
    returnByValue: true
  })
  const navigatedLeadLabel = navigatedLead.result?.result?.value
  if (leadMenuValue.count > 1 && navigatedLeadLabel === leadMenuValue.activeLabel) {
    throw new Error(`Lead picker arrow navigation did not move focus: ${JSON.stringify(leadMenuValue)}`)
  }
  if (leadMenuValue.count > 1) {
    await evaluate(cdp, `[...document.querySelectorAll('.compact-menu[aria-label="选择负责人"] [role=menuitemradio]')].find(option => option.textContent === ${JSON.stringify(navigatedLeadLabel)}).click()`)
  } else {
    await pressKey(cdp, 'Escape')
  }
  await waitForExpression(cdp, `document.querySelector('.compact-menu[aria-label="选择负责人"]') === null`, 5_000)
  await waitForExpression(
    cdp,
    `document.activeElement?.matches('button[aria-labelledby~="new-camp-lead-label"]') === true`,
    5_000
  )
  await wait(100)
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('.compact-name-disclosure > button')?.click()`
  })
  await waitForExpression(cdp, `document.activeElement?.id === 'new-camp-name'`, 5_000)
  const optionalInspection = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const trigger = document.querySelector('.compact-name-disclosure > button')
      const panel = document.querySelector('.compact-name-field')
      const input = document.getElementById('new-camp-name')
      const triggerRect = trigger?.getBoundingClientRect()
      const panelRect = panel?.getBoundingClientRect()
      return {
        expanded: trigger?.getAttribute('aria-expanded') === 'true',
        placeholder: input?.getAttribute('placeholder'),
        focused: document.activeElement === input,
        indent: triggerRect && panelRect ? panelRect.left - triggerRect.left : null,
        unnamedHint: panel?.textContent?.includes('留空为「未命名对话」') === true
      }
    })()`,
    returnByValue: true
  })
  const optionalValue = optionalInspection.result?.result?.value
  if (
    optionalValue?.expanded !== true
    || optionalValue?.placeholder !== '输入名称...'
    || optionalValue?.focused !== true
    || Math.abs(optionalValue?.indent ?? 1) > 0.5
    || optionalValue?.unnamedHint !== true
  ) {
    throw new Error(`Optional name acceptance failed: ${JSON.stringify(optionalValue)}`)
  }

  if (enableOneClick) {
    await evaluate(cdp, `document.querySelector('.new-camp-quick-label input').click()`)
    await waitForExpression(cdp, `document.querySelector('.new-camp-quick-effective')?.textContent === '本次新建成功后生效'`, 5_000)
    const beforeSubmit = await evaluate(cdp, 'window.rovai.generalPreferences.get()')
    assertSamePreferences(beforeSubmit, originalPreferences, 'Checking alone must not save preferences')
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
      expression: `document.querySelector('.new-camp-dialog .compact-primary')?.click()`
    })
    await waitForExpression(
      cdp,
      `document.querySelector('.new-camp-dialog') === null && Boolean(document.querySelector('#camp-message'))`,
      10_000
    )
    await waitForExpression(cdp, `document.activeElement?.id === 'camp-message'`, 5_000)
    await waitForExpression(cdp, `document.querySelector('.camp-nav-row.selected')?.textContent?.includes('未命名对话') === true`, 10_000)
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

  const savedPreferences = await evaluate(cdp, 'window.rovai.generalPreferences.get()')
  if (createCamp && enableOneClick && !expectPreferenceFailure) {
    const createdCamp = await evaluate(cdp, `(async () => {
      const target = document.querySelector('.camp-nav-row.selected')?.querySelector('[data-sidebar-menu-target]')?.dataset.sidebarMenuTarget
      if (!target?.startsWith('camp:')) throw new Error('Missing selected Camp identity')
      return window.rovai.request('camps.open', { campId: target.slice(5), traceId: crypto.randomUUID() })
    })()`)
    if (savedPreferences.oneClickNewConversationEnabled !== true
      || savedPreferences.newConversationDefaultsRequireConfirmation !== false
      || savedPreferences.newConversationDefaults?.defaultLeadAgentId !== createdCamp.camp.defaultLeadAgentId
      || JSON.stringify([...savedPreferences.newConversationDefaults.memberAgentIds].sort())
        !== JSON.stringify(createdCamp.members.map(member => member.agentId).sort())) {
      throw new Error('Saved defaults do not match the successfully created Camp')
    }
    // The next click must open a new Pending Camp directly, using the saved team.
    const previousId = createdCamp.camp.id
    await waitForExpression(cdp, `document.querySelector('button[aria-label="新对话"]')?.disabled === false`, 10_000)
    await evaluate(cdp, `void (window.__previousAcceptanceComposer = document.getElementById('camp-message'))`)
    await evaluate(cdp, `document.querySelector('button[aria-label="新对话"]').click()`)
    await waitForExpression(cdp, `!document.querySelector('.new-camp-dialog') && document.activeElement?.id === 'camp-message' && document.activeElement !== window.__previousAcceptanceComposer`, 10_000)
    // An empty Pending Camp is intentionally absent from Navigation until it has a draft.
    await cdp.send('Input.insertText', { text: '一键新建验收草稿（未发送）' })
    await waitForExpression(cdp, `(() => { const target = document.querySelector('.camp-nav-row.selected')?.querySelector('[data-sidebar-menu-target]')?.dataset.sidebarMenuTarget; return !document.querySelector('.new-camp-dialog') && target?.startsWith('camp:') && target !== ${JSON.stringify('camp:' + previousId)} })()`, 10_000)
    await waitForExpression(cdp, `document.activeElement?.id === 'camp-message'`, 5_000)
    const nextCamp = await evaluate(cdp, `(async () => {
      const target = document.querySelector('.camp-nav-row.selected [data-sidebar-menu-target]').dataset.sidebarMenuTarget
      return window.rovai.request('camps.open', { campId: target.slice(5), traceId: crypto.randomUUID() })
    })()`)
    if (nextCamp.messages.length !== 0 || nextCamp.agentRuns.length !== 0
      || nextCamp.camp.activationState !== 'pending'
      || nextCamp.camp.defaultLeadAgentId !== savedPreferences.newConversationDefaults.defaultLeadAgentId
      || JSON.stringify(nextCamp.members.map(member => member.agentId).sort())
        !== JSON.stringify([...savedPreferences.newConversationDefaults.memberAgentIds].sort())) {
      throw new Error('One-click did not create a Pending Camp with the saved team')
    }
  } else {
    assertSamePreferences(savedPreferences, originalPreferences, 'Cancelled, ordinary or failed preference saves must preserve defaults')
    if (expectPreferenceFailure) {
      await waitForExpression(cdp, `document.body.textContent.includes('对话已创建，但默认队伍与一键新建设置未保存')`, 5_000)
    }
  }
  process.stdout.write(`${output}\n`)
} finally {
  cdp.close()
}

async function waitForTarget(debugPort) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 60_000) {
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
  const observed = await evaluate(cdp, `({ activeElement: document.activeElement?.outerHTML, menus: [...document.querySelectorAll('[role="menu"]')].map(menu => menu.getAttribute('aria-label')) })`)
  throw new Error(`Expression did not become true: ${expression}; observed: ${JSON.stringify(observed)}`)
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
    ArrowUp: { code: 'ArrowUp', virtualKey: 38 },
    ArrowLeft: { code: 'ArrowLeft', virtualKey: 37 },
    ArrowRight: { code: 'ArrowRight', virtualKey: 39 },
    Enter: { code: 'Enter', virtualKey: 13 },
    Escape: { code: 'Escape', virtualKey: 27 },
    Tab: { code: 'Tab', virtualKey: 9 }
  }[key] ?? { code: key, virtualKey: key.charCodeAt(0) }
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    code: keyDefinition.code,
    windowsVirtualKeyCode: keyDefinition.virtualKey
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code: keyDefinition.code,
    windowsVirtualKeyCode: keyDefinition.virtualKey
  })
}


async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails))
  return response.result?.result?.value
}

function assertSamePreferences(actual, expected, message) {
  for (const key of ['newConversationDefaults', 'newConversationDefaultsRequireConfirmation', 'oneClickNewConversationEnabled']) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) throw new Error(message)
  }
}
