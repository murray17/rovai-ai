import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const appPath = process.argv[2]
const outputPath = process.argv[3] ?? '/tmp/rovai-skills.png'
const cleanOutputPath = outputPath.endsWith('.png')
  ? `${outputPath.slice(0, -'.png'.length)}-clean.png`
  : `${outputPath}-clean.png`
const outputStem = outputPath.endsWith('.png') ? outputPath.slice(0, -'.png'.length) : outputPath
const settingsOverviewPaths = {
  general: `${outputStem}-general.png`,
  appearance: `${outputStem}-appearance.png`,
  runtime: `${outputStem}-runtime.png`
}
const userDataDir = process.env.ROVAI_CAPTURE_USER_DATA_DIR
const port = Number(process.env.ROVAI_DEBUG_PORT ?? 9443)
const width = Number(process.env.ROVAI_CAPTURE_WIDTH ?? 1440)
const height = Number(process.env.ROVAI_CAPTURE_HEIGHT ?? 920)
const theme = process.env.ROVAI_CAPTURE_THEME ?? 'day'

if (!appPath || !userDataDir) {
  throw new Error('Usage: ROVAI_CAPTURE_USER_DATA_DIR=<data> node scripts/capture-skills.mjs <Rovai-ai.app> [output.png]')
}
if (!['day', 'night'].includes(theme)) throw new Error(`Unknown ROVAI_CAPTURE_THEME: ${theme}`)

const executable = join(appPath, 'Contents', 'MacOS', 'Rovai-ai')
const app = spawn(executable, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`
], {
  env: { ...process.env, ROVAI_ALLOW_ISOLATED_INSTANCE: '1' },
  stdio: ['ignore', 'ignore', 'pipe']
})
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
  await waitForExpression(cdp, `Boolean(document.querySelector('.unified-sidebar-footer button[aria-label="设置"]'))`, 45_000)
  await waitForExpression(cdp, `document.querySelector('.startup-gate') === null`, 45_000)
  await cdp.send('Runtime.evaluate', {
    expression: `window.rovai.appearance.setPreference(${JSON.stringify(theme)})`,
    awaitPromise: true,
    returnByValue: true
  })
  await waitForExpression(cdp, `document.documentElement.dataset.theme === 'day'`, 5_000)
  const opened = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const button = document.querySelector('.unified-sidebar-footer button[aria-label="设置"]')
      button?.focus()
      button?.click()
      return Boolean(button) && document.activeElement === button
    })()`,
    returnByValue: true
  })
  if (!opened.result?.result?.value) throw new Error('Settings entry was not keyboard-focusable')
  await waitForExpression(cdp, `Boolean(document.querySelector('.settings-sidebar-menu'))`, 5_000)
  await openSection(cdp, 'Skill')
  await waitForExpression(cdp, `Boolean(document.querySelector('.skill-settings')) && (
    document.querySelectorAll('.skill-card').length === 6
      || Boolean(document.querySelector('.skill-page-error'))
  )`, 30_000)
  const initialSkillState = await evaluate(cdp, `({
    cardCount: document.querySelectorAll('.skill-card').length,
    error: document.querySelector('.skill-page-error')?.textContent?.trim() ?? null
  })`)
  if (initialSkillState.cardCount !== 6 || initialSkillState.error) {
    throw new Error(`Skill settings did not load the six bundled Skills: ${JSON.stringify(initialSkillState)}`)
  }

  await waitForEvaluation(cdp, `(async () => (
    await window.rovai.request('runtime.installations.list')
  ).some((candidate) => candidate.adapterKind === 'codex-cli' && candidate.memberRuntimeDefaults))()`, 45_000)
  const runtimeConfiguration = await evaluate(cdp, `(async () => {
    const profile = await window.rovai.request('members.get', { agentId: 'agent_1' })
    const installation = (await window.rovai.request('runtime.installations.list'))
      .find((candidate) => candidate.adapterKind === 'codex-cli' && candidate.memberRuntimeDefaults)
    if (!installation) throw new Error('Codex Runtime defaults are unavailable')
    return window.rovai.request('members.runtime.set', {
      commandId: crypto.randomUUID(),
      command: {
        agentId: profile.agentId,
        expectedVersion: profile.version,
        adapterKind: 'codex-cli',
        model: installation.memberRuntimeDefaults.model,
        permissions: installation.memberRuntimeDefaults.permissions
      }
    })
  })()`)
  if (runtimeConfiguration?.status !== 'applied') {
    throw new Error(`Skill member fixture Runtime selection failed: ${JSON.stringify(runtimeConfiguration)}`)
  }
  await openSection(cdp, 'MCP')
  await waitForExpression(cdp, `Boolean(document.querySelector('.mcp-settings'))`, 5_000)
  await openSection(cdp, 'Skill')
  await waitForExpression(cdp, `Boolean(document.querySelector('.skill-card'))`, 5_000)

  const result = await evaluate(cdp, `(() => {
    const subnavButtons = [...document.querySelectorAll('.settings-sidebar-menu button')]
    const active = document.querySelector('.settings-sidebar-menu button.active')
    const skillCards = [...document.querySelectorAll('.skill-card')]
    const bundled = skillCards.filter((card) => card.querySelector('.skill-source.source-bundled'))
    const thirdParty = skillCards.filter((card) => card.querySelector('.skill-source.source-third-party'))
    const official = [...bundled, ...thirdParty]
    const enabled = skillCards.filter((card) =>
      card.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true'
    )
    const tastefulUi = skillCards.find((card) => card.dataset.skillName === 'tasteful-ui')
    const panel = document.querySelector('.settings-panel')
    return {
      theme: document.documentElement.dataset.theme,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      panelOverflow: panel ? panel.scrollWidth > panel.clientWidth : true,
      subnav: subnavButtons.map((button) => button.querySelector('strong')?.textContent?.trim()),
      activeSection: active?.querySelector('strong')?.textContent?.trim(),
      skillNames: skillCards.map((card) => card.querySelector('.skill-card-title > strong')?.textContent?.trim()),
      bundledCount: bundled.length,
      thirdPartyCount: thirdParty.length,
      enabledOfficialCount: official.filter((card) =>
        card.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true'
      ).length,
      enabledCount: enabled.length,
      operationColumns: [...document.querySelectorAll('.skill-library-columns > div > span')]
        .map((column) => column.textContent?.trim()),
      legacyMoreButtonCount: document.querySelectorAll('.skill-more-button').length,
      tastefulUiSource: {
        badge: tastefulUi?.querySelector('.skill-source')?.textContent?.trim(),
        repository: tastefulUi?.querySelector('.skill-source-link')?.textContent?.trim(),
        href: tastefulUi?.querySelector('.skill-source-link')?.getAttribute('href'),
        revision: tastefulUi?.querySelector('.skill-provenance-revision')?.textContent?.trim()
      },
      importButton: [...document.querySelectorAll('.skill-settings button')]
        .some((button) => button.textContent?.trim() === '选择文件夹'),
      projectionStatusVisible: document.querySelector('.skill-settings')?.textContent?.includes('项目投影状态'),
      legacyOfficialVisible: document.querySelector('.skill-settings')?.textContent?.includes('Rovai 官方'),
      loadingVisible: document.querySelector('.skill-settings')?.textContent?.includes('正在读取 Skill Library')
    }
  })()`)

  if (result.theme !== 'day'
      || result.viewport.width !== width
      || result.viewport.height !== height
      || result.horizontalOverflow
      || result.panelOverflow
      || JSON.stringify(result.subnav) !== JSON.stringify(['通用', '外观', '通知', 'Skill', 'MCP', 'Agent 运行时', '诊断与修复'])
      || result.activeSection !== 'Skill'
      || result.bundledCount !== 5
      || result.thirdPartyCount !== 1
      || result.enabledOfficialCount !== 6
      || JSON.stringify(result.skillNames) !== JSON.stringify([
        'analyze-agent-codebase',
        'grill-duo',
        'grill-duo-with-docs',
        'memory-stewardship',
        'tasteful-ui',
        'worktree'
      ])
      || JSON.stringify(result.operationColumns) !== JSON.stringify(['投递范围', '状态', '查看'])
      || result.legacyMoreButtonCount !== 0
      || result.tastefulUiSource.badge !== 'GitHub 三方'
      || result.tastefulUiSource.repository !== 'DonkeyKing01/tasteful-ui-skill'
      || result.tastefulUiSource.href !== 'https://github.com/DonkeyKing01/tasteful-ui-skill'
      || result.tastefulUiSource.revision !== '159ccd47'
      || !result.importButton
      || result.projectionStatusVisible
      || result.legacyOfficialVisible
      || result.loadingVisible) {
    throw new Error(`Skill settings acceptance failed: ${JSON.stringify(result)}`)
  }

  await clickElement(cdp, '.skill-card[data-skill-name="tasteful-ui"] .skill-detail-button')
  await waitForExpression(cdp, `!document.querySelector('.skill-card[data-skill-name="tasteful-ui"] .skill-card-details')?.hidden`, 5_000)
  const detailsPanel = await evaluate(cdp, `(() => {
    const card = document.querySelector('.skill-card[data-skill-name="tasteful-ui"]')
    const details = card?.querySelector('.skill-card-details')
    return {
      expanded: card?.querySelector('.skill-detail-button')?.getAttribute('aria-expanded'),
      hasRevision: details?.textContent?.includes('Revision'),
      hasContentDigest: details?.textContent?.includes('内容摘要'),
      explainsPinnedCopy: details?.textContent?.includes('不会随上游自动更新'),
      deleteVisible: details?.textContent?.includes('删除 Skill')
    }
  })()`)
  if (detailsPanel.expanded !== 'true'
      || !detailsPanel.hasRevision
      || !detailsPanel.hasContentDigest
      || !detailsPanel.explainsPinnedCopy
      || detailsPanel.deleteVisible) {
    throw new Error(`Skill card details acceptance failed: ${JSON.stringify(detailsPanel)}`)
  }
  await clickElement(cdp, '.skill-card[data-skill-name="tasteful-ui"] .skill-detail-button')
  await waitForExpression(cdp, `document.querySelector('.skill-card[data-skill-name="tasteful-ui"] .skill-card-details')?.hidden === true`, 5_000)

  await clickElement(cdp, '.skill-group-select')
  await waitForExpression(cdp, `document.querySelectorAll('.skill-group-option').length === 9`, 5_000)
  const groupMenu = await evaluate(cdp, `(() => {
    const options = [...document.querySelectorAll('.skill-group-option')]
    const codex = options.find((option) => option.textContent?.includes('.codex/skills'))
    const avatar = codex?.querySelector('.skill-member-stack .member-avatar')
    return {
      groupCount: options.length,
      codexMemberName: codex?.querySelector('.skill-member-line')?.textContent?.trim(),
      realAvatarRendered: Boolean(avatar?.querySelector('.member-avatar-image')),
      legacyLetterAvatarVisible: Boolean(codex?.querySelector('.skill-member')),
      verifiedCount: options.filter((option) => option.querySelector('.skill-group-name-line > i.verified')?.textContent === '已验证').length,
      unverifiedCount: options.filter((option) => option.querySelector('.skill-group-name-line > i.unverified')?.textContent === '暂未验证').length
    }
  })()`)
  if (groupMenu.groupCount !== 9
      || !groupMenu.codexMemberName?.includes('小狐狸')
      || !groupMenu.realAvatarRendered
      || groupMenu.legacyLetterAvatarVisible
      || groupMenu.verifiedCount !== 9
      || groupMenu.unverifiedCount !== 0) {
    throw new Error(`Skill group menu acceptance failed: ${JSON.stringify(groupMenu)}`)
  }

  await capture(cdp, outputPath)
  await pressEscape(cdp)
  await waitForExpression(cdp, `!document.querySelector('.skill-group-options')`, 5_000)
  await capture(cdp, cleanOutputPath)

  await openSection(cdp, '通用')
  await waitForExpression(cdp, `Boolean(document.querySelector('.general-settings'))`, 5_000)
  await capture(cdp, settingsOverviewPaths.general)
  await openSection(cdp, '外观')
  await waitForExpression(cdp, `Boolean(document.querySelector('.appearance-settings'))`, 5_000)
  const appearanceReady = await evaluate(cdp, `Boolean(document.querySelector('.appearance-settings'))`)
  await capture(cdp, settingsOverviewPaths.appearance)
  await openSection(cdp, 'Agent 运行时')
  await waitForExpression(cdp, `Boolean(document.querySelector('.runtime-installations'))`, 10_000)
  await wait(6_000)
  await capture(cdp, settingsOverviewPaths.runtime)
  await openSection(cdp, '诊断与修复')
  await waitForExpression(cdp, `Boolean(document.querySelector('.diagnostics-center'))`, 5_000)
  const diagnosticsReady = await evaluate(cdp, `Boolean(document.querySelector('.diagnostics-center'))`)
  await openSection(cdp, 'Skill')
  await waitForExpression(cdp, `Boolean(document.querySelector('.skill-settings'))`, 5_000)
  const navigation = await evaluate(cdp, `(() => {
    const skills = [...document.querySelectorAll('.settings-sidebar-menu button')]
      .find((button) => button.textContent?.includes('Skill'))
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

  cdp.close()
  console.log(JSON.stringify({ ok: true, ...result, detailsPanel, groupMenu, navigation, outputPath, cleanOutputPath, settingsOverviewPaths }, null, 2))
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
    awaitPromise: true,
    returnByValue: true
  })
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description
      ?? response.result.exceptionDetails.text)
  }
  return response.result?.result?.value
}

async function openSection(cdp, label) {
  const opened = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.settings-sidebar-menu button')]
      .find((candidate) => candidate.textContent?.includes(${JSON.stringify(label)}))
    button?.focus()
    button?.click()
    return Boolean(button) && document.activeElement === button
  })()`)
  if (!opened) throw new Error(`${label} settings section was not keyboard-focusable`)
}

async function clickElement(cdp, selector) {
  const rect = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    const bounds = element.getBoundingClientRect()
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
  })()`)
  if (!rect) throw new Error(`Element was unavailable: ${selector}`)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: rect.x,
    y: rect.y,
    button: 'left',
    clickCount: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: rect.x,
    y: rect.y,
    button: 'left',
    clickCount: 1
  })
}

async function pressEscape(cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
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

async function waitForEvaluation(cdp, expression, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await evaluate(cdp, expression)) return
    } catch {
      // The packaged Core may still be publishing its first Runtime snapshot.
    }
    await wait(100)
  }
  throw new Error(`Evaluation did not become true within ${timeoutMs}ms: ${expression}`)
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
