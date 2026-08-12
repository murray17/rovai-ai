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
const zoomFactor = Number(process.env.ROVAI_CAPTURE_ZOOM_FACTOR ?? 1)
const cssWidth = Math.round(width / zoomFactor)
const cssHeight = Math.round(height / zoomFactor)
const theme = process.env.ROVAI_CAPTURE_THEME ?? 'day'

if (!appPath || !userDataDir) {
  throw new Error('Usage: ROVAI_CAPTURE_USER_DATA_DIR=<data> node scripts/capture-skills.mjs <Rovai-ai.app> [output.png]')
}
if (!['day', 'night'].includes(theme)) throw new Error(`Unknown ROVAI_CAPTURE_THEME: ${theme}`)
if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
  throw new Error(`ROVAI_CAPTURE_ZOOM_FACTOR must be greater than zero: ${zoomFactor}`)
}

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
    width: cssWidth,
    height: cssHeight,
    deviceScaleFactor: zoomFactor,
    mobile: false,
    screenWidth: width,
    screenHeight: height
  })
  await waitForExpression(
    cdp,
    `window.innerWidth === ${cssWidth}
      && window.innerHeight === ${cssHeight}
      && Math.abs(window.devicePixelRatio - ${zoomFactor}) < 0.01`,
    5_000
  )
  await waitForExpression(cdp, `Boolean(document.querySelector('.unified-sidebar-footer button[aria-label="设置"]'))`, 45_000)
  await waitForExpression(cdp, `document.querySelector('.startup-gate') === null`, 45_000)
  await cdp.send('Runtime.evaluate', {
    expression: `window.rovai.appearance.setPreference(${JSON.stringify(theme)})`,
    awaitPromise: true,
    returnByValue: true
  })
  await waitForExpression(cdp,
    `document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, 5_000)
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
    document.querySelectorAll('.skill-card').length === 7
      || Boolean(document.querySelector('.skill-page-error'))
  )`, 30_000)
  const initialSkillState = await evaluate(cdp, `({
    cardCount: document.querySelectorAll('.skill-card').length,
    error: document.querySelector('.skill-page-error')?.textContent?.trim() ?? null
  })`)
  if (initialSkillState.cardCount !== 7 || initialSkillState.error) {
    throw new Error(`Skill settings did not load the seven bundled Skills: ${JSON.stringify(initialSkillState)}`)
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

  const result = await evaluate(cdp, `(async () => {
    const subnavButtons = [...document.querySelectorAll('.settings-sidebar-menu button')]
    const active = document.querySelector('.settings-sidebar-menu button.active')
    const skillCards = [...document.querySelectorAll('.skill-card')]
    const skillViews = await window.rovai.request('skills.list')
    const skillViewByName = new Map(skillViews.map((skill) => [skill.name, skill]))
    const identityColorIndex = (identityId) => {
      let hash = 0x811c9dc5
      for (const character of identityId) {
        hash ^= character.codePointAt(0) ?? 0
        hash = Math.imul(hash, 0x01000193)
      }
      return (hash >>> 0) % 8 + 1
    }
    const resolveColorToken = (token) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(' + token + ')'
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    }
    const bundled = skillCards.filter((card) => card.querySelector('.skill-source.source-bundled'))
    const thirdParty = skillCards.filter((card) => card.querySelector('.skill-source.source-third-party'))
    const official = [...bundled, ...thirdParty]
    const enabled = skillCards.filter((card) =>
      card.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true'
    )
    const tastefulUi = skillCards.find((card) => card.dataset.skillName === 'tasteful-ui')
    const panel = document.querySelector('.settings-panel')
    const cardMetrics = skillCards.map((card) => {
      const skill = skillViewByName.get(card.dataset.skillName)
      const mark = card.querySelector('.skill-card-mark')
      const title = card.querySelector('.skill-card-title > strong')
      const description = card.querySelector('.skill-card-heading > p')
      const source = card.querySelector('.skill-source')
      const toggle = card.querySelector('.skill-toggle')
      const knob = toggle?.querySelector('span')
      const details = card.querySelector('.skill-card-details')
      const toggleRect = toggle?.getBoundingClientRect()
      return {
        name: card.dataset.skillName,
        identityToken: card.style.getPropertyValue('--skill-identity').trim(),
        expectedIdentityToken: skill ? 'var(--identity-' + identityColorIndex(skill.id) + ')' : null,
        markColor: mark ? getComputedStyle(mark).color : null,
        expectedMarkColor: skill
          ? resolveColorToken('--identity-' + identityColorIndex(skill.id))
          : null,
        titleFontSize: title ? getComputedStyle(title).fontSize : null,
        descriptionFontSize: description ? getComputedStyle(description).fontSize : null,
        sourceFontSize: source ? getComputedStyle(source).fontSize : null,
        sourceBadge: source?.textContent?.trim(),
        switchText: toggle?.textContent?.trim(),
        switchWidth: toggleRect?.width,
        switchHeight: toggleRect?.height,
        switchBorderColor: toggle ? getComputedStyle(toggle).borderColor : null,
        switchBackgroundColor: toggle ? getComputedStyle(toggle).backgroundColor : null,
        switchKnobColor: knob ? getComputedStyle(knob).backgroundColor : null,
        detailsRailColor: details ? getComputedStyle(details).borderLeftColor : null,
        detailsBackgroundColor: details ? getComputedStyle(details).backgroundColor : null
      }
    })
    return {
      theme: document.documentElement.dataset.theme,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      panelOverflow: panel ? panel.scrollWidth > panel.clientWidth : true,
      subnav: subnavButtons.map((button) => button.querySelector('strong')?.textContent?.trim()),
      activeSection: active?.querySelector('strong')?.textContent?.trim(),
      skillNames: skillCards.map((card) => card.querySelector('.skill-card-title > strong')?.textContent?.trim()),
      bundledCount: bundled.length,
      bundledBadges: bundled.map((card) => card.querySelector('.skill-source')?.textContent?.trim()),
      thirdPartyCount: thirdParty.length,
      enabledOfficialCount: official.filter((card) =>
        card.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true'
      ).length,
      enabledCount: enabled.length,
      operationColumns: [...document.querySelectorAll('.skill-library-columns > div > span')]
        .map((column) => column.textContent?.trim()),
      legacyMoreButtonCount: document.querySelectorAll('.skill-more-button').length,
      primaryProvenanceCount: document.querySelectorAll('.skill-card-primary .skill-card-provenance, .skill-card-primary .skill-source-link').length,
      cardMetrics,
      steelColors: {
        brand: resolveColorToken('--brand'),
        brandSoft: resolveColorToken('--brand-soft')
      },
      tastefulUiSource: {
        badge: tastefulUi?.querySelector('.skill-source')?.textContent?.trim(),
        repository: tastefulUi?.querySelector('.skill-detail-source .skill-source-link')?.textContent?.trim(),
        href: tastefulUi?.querySelector('.skill-detail-source .skill-source-link')?.getAttribute('href'),
        revision: tastefulUi?.querySelector('.skill-detail-source-revision')?.textContent?.trim(),
        primaryRepository: tastefulUi?.querySelector('.skill-card-primary .skill-source-link')?.textContent?.trim() ?? null
      },
      importButton: [...document.querySelectorAll('.skill-settings button')]
        .some((button) => button.textContent?.trim() === '选择文件夹'),
      projectionStatusVisible: document.querySelector('.skill-settings')?.textContent?.includes('项目投影状态'),
      legacyOfficialVisible: document.querySelector('.skill-settings')?.textContent?.includes('Rovai 官方'),
      loadingVisible: document.querySelector('.skill-settings')?.textContent?.includes('正在读取 Skill Library'),
      legacyLongSourceLabelVisible: skillCards.some((card) => {
        const badge = card.querySelector('.skill-source')?.textContent?.trim()
        return badge === 'Rovai 内置' || badge === 'GitHub 三方'
      })
    }
  })()`)

  const identityTokensValid = result.cardMetrics.every((card) =>
    /^var\(--identity-[1-8]\)$/.test(card.identityToken)
      && card.identityToken === card.expectedIdentityToken
      && card.markColor === card.expectedMarkColor
  )
  const coloredIdentityMarks = new Set(result.cardMetrics.map((card) => card.markColor)).size > 1
  const readableSkillType = result.cardMetrics.every((card) =>
    card.titleFontSize === '14px'
      && card.descriptionFontSize === '12.5px'
      && card.sourceFontSize === '10.5px'
  )
  const switchesValid = result.cardMetrics.every((card) =>
    card.switchText === ''
      && Math.abs(card.switchWidth - 34) < 0.1
      && Math.abs(card.switchHeight - 20) < 0.1
      && card.switchBorderColor === result.steelColors.brand
      && card.switchBackgroundColor === result.steelColors.brandSoft
      && card.switchKnobColor === result.steelColors.brand
  )
  const detailStyles = new Set(result.cardMetrics.map((card) =>
    `${card.detailsRailColor}|${card.detailsBackgroundColor}`
  ))
  const detailsStayNeutral = detailStyles.size === 1
    && result.cardMetrics.every((card) => card.detailsRailColor !== card.markColor)

  if (result.theme !== theme
      || result.viewport.width !== cssWidth
      || result.viewport.height !== cssHeight
      || result.devicePixelRatio !== zoomFactor
      || result.horizontalOverflow
      || result.panelOverflow
      || JSON.stringify(result.subnav) !== JSON.stringify(['通用', '外观', '通知', 'Skill', 'MCP', 'Agent 运行时', '诊断与修复'])
      || result.activeSection !== 'Skill'
      || result.bundledCount !== 6
      || !result.bundledBadges.every((badge) => badge === 'Rovai')
      || result.thirdPartyCount !== 1
      || result.enabledOfficialCount !== 7
      || JSON.stringify(result.skillNames) !== JSON.stringify([
        'analyze-agent-codebase',
        'cli-operations',
        'grill-duo',
        'grill-duo-with-docs',
        'memory-stewardship',
        'tasteful-ui',
        'worktree'
      ])
      || JSON.stringify(result.operationColumns) !== JSON.stringify(['投递范围', '状态', '查看'])
      || result.legacyMoreButtonCount !== 0
      || result.primaryProvenanceCount !== 0
      || !identityTokensValid
      || !coloredIdentityMarks
      || !readableSkillType
      || !switchesValid
      || !detailsStayNeutral
      || result.tastefulUiSource.badge !== 'GitHub'
      || result.tastefulUiSource.repository !== 'DonkeyKing01/tasteful-ui-skill'
      || result.tastefulUiSource.href !== 'https://github.com/DonkeyKing01/tasteful-ui-skill'
      || result.tastefulUiSource.revision !== '159ccd47'
      || result.tastefulUiSource.primaryRepository !== null
      || !result.importButton
      || result.projectionStatusVisible
      || result.legacyOfficialVisible
      || result.legacyLongSourceLabelVisible
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
      sourceLabel: details?.querySelector('.skill-detail-source > span')?.textContent?.trim(),
      sourceRepository: details?.querySelector('.skill-source-link')?.textContent?.trim(),
      sourceRevision: details?.querySelector('.skill-detail-source-revision')?.textContent?.trim(),
      hasContentDigest: details?.textContent?.includes('内容摘要'),
      explainsPinnedCopy: details?.textContent?.includes('不会随上游自动更新'),
      deleteVisible: details?.textContent?.includes('删除 Skill')
    }
  })()`)
  if (detailsPanel.expanded !== 'true'
      || !detailsPanel.hasRevision
      || detailsPanel.sourceLabel !== '来源'
      || detailsPanel.sourceRepository !== 'DonkeyKing01/tasteful-ui-skill'
      || detailsPanel.sourceRevision !== '159ccd47'
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
  const rect = await evaluate(cdp, `(async () => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))
    const bounds = element.getBoundingClientRect()
    return {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
      visible: bounds.top >= 0
        && bounds.left >= 0
        && bounds.bottom <= window.innerHeight
        && bounds.right <= window.innerWidth
    }
  })()`)
  if (!rect) throw new Error(`Element was unavailable: ${selector}`)
  if (!rect.visible) throw new Error(`Element did not scroll into the viewport: ${selector}`)
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
