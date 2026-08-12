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
    CODEX_HOME: codexHome,
    ROVAI_ALLOW_ISOLATED_INSTANCE: '1'
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
  const existingMembers = await request(cdp, 'members.list')
  for (let index = existingMembers.length; index < 12; index += 1) {
    const result = await request(cdp, 'members.create', {
      commandId: crypto.randomUUID(),
      command: {
        displayName: `名册滚动验收 ${String(index + 1).padStart(2, '0')}`,
        teamRole: index % 2 === 0 ? '长列表协作者' : '能力配置协作者',
        professionalResponsibilities: '验证大量在队队员时 MCP 分配名册保持在工作台内部滚动。',
        personalityTraits: ['可验证'],
        workingPrinciples: '',
        growthTopic: ''
      }
    })
    assert(result.status === 'applied', `Could not create roster fixture ${index + 1}: ${JSON.stringify(result)}`)
  }
  if (existingMembers.length < 12) {
    await evaluate(cdp, `location.reload()`)
    await waitForExpression(cdp, `Boolean(document.querySelector('.unified-sidebar-footer button[aria-label="设置"]'))`, 45_000)
  }
  await click(cdp, `.unified-sidebar-footer button[aria-label="设置"]`)
  await waitForExpression(cdp, `Boolean(document.querySelector('.settings-workbench'))`, 10_000)
  await clickButtonByText(cdp, '.settings-sidebar-menu button', 'MCP')
  await waitForExpression(cdp, `Boolean(document.querySelector('.mcp-settings'))`, 10_000)
  await waitForExpression(cdp, `document.querySelectorAll('.mcp-server-row').length === 2`, 30_000)

  const initial = await evaluate(cdp, `(() => ({
    subnav: [...document.querySelectorAll('.settings-sidebar-menu strong')].map((node) => node.textContent?.trim()),
    serverNames: [...document.querySelectorAll('.mcp-server-title strong')].map((node) => node.textContent?.trim()),
    memberRows: document.querySelectorAll('.mcp-member-roster-row').length,
    memberAvatars: document.querySelectorAll('.mcp-member-roster-row .member-avatar').length,
    rosterOverflowY: getComputedStyle(document.querySelector('.mcp-member-roster')).overflowY,
    rosterScrollable: document.querySelector('.mcp-member-roster').scrollHeight > document.querySelector('.mcp-member-roster').clientHeight,
    importDialog: Boolean(document.querySelector('.mcp-import-dialog')),
    publicPreview: document.querySelector('.mcp-source-panel pre')?.textContent ?? '',
    hiddenMetadataVisible: document.body.innerText.includes('_rovai'),
    sourceSecretVisible: document.body.innerText.includes('rovai-secret-must-not-render'),
    persistentRiskText: document.querySelector('.mcp-settings')?.innerText.includes('高权限') ?? false,
    riskTagCount: document.querySelectorAll('.mcp-risk-badge, .mcp-risk-dialog').length,
    assignmentScopeCount: document.querySelectorAll('.mcp-assignment-scope').length,
    assignmentFootnoteCount: document.querySelectorAll('.mcp-footnote').length,
    assignmentOptionStateCount: document.querySelectorAll('.mcp-assignment-option-state').length,
    searchInChooserHeading: Boolean(document.querySelector('.mcp-assignment-chooser-heading .mcp-search-field input')),
    rosterHeadingBorderBottom: getComputedStyle(document.querySelector('.mcp-member-roster-heading')).borderBottomWidth,
    selectedRosterBackground: getComputedStyle(document.querySelector('.mcp-member-roster-row[aria-selected="true"]')).backgroundColor,
    unselectedRosterBackgrounds: [...document.querySelectorAll('.mcp-member-roster-row:not([aria-selected="true"])')]
      .map((node) => getComputedStyle(node).backgroundColor),
    sharedHeadingCount: document.querySelectorAll('.settings-page-heading').length,
    legacyHeroCount: document.querySelectorAll('.project-hero').length,
    heading: document.querySelector('.settings-page-heading h1')?.textContent
  }))()`)
  assert(
    JSON.stringify(initial.subnav) === JSON.stringify(['通用', '外观', '通知', 'Skill', 'MCP', 'Agent 运行时', '诊断与修复']),
    `Settings navigation is incorrect: ${JSON.stringify(initial)}`
  )
  assert(JSON.stringify(initial.serverNames) === JSON.stringify(['context7', 'playwright']), `Fresh reviewed defaults are incorrect: ${JSON.stringify(initial)}`)
  assert(initial.memberRows > 0 && initial.memberAvatars === initial.memberRows, `Member Assignment roster or avatars are missing: ${JSON.stringify(initial)}`)
  assert(initial.rosterOverflowY === 'auto', `Member roster is not independently scrollable: ${JSON.stringify(initial)}`)
  if (initial.memberRows >= 8) assert(initial.rosterScrollable, `Tall member roster did not overflow inside the workbench: ${JSON.stringify(initial)}`)
  assert(!initial.importDialog, 'MCP import scanned automatically on first load')
  assert(!initial.hiddenMetadataVisible, 'Hidden _rovai metadata reached the Renderer')
  assert(!initial.sourceSecretVisible, 'Source literal secret reached the Renderer before import')
  assert(!initial.persistentRiskText && initial.riskTagCount === 0, `Persistent MCP risk UI is still visible: ${JSON.stringify(initial)}`)
  assert(initial.assignmentScopeCount === 0, `Legacy assignment scope badge is still visible: ${JSON.stringify(initial)}`)
  assert(initial.assignmentFootnoteCount === 0, `Legacy assignment scope footnote is still visible: ${JSON.stringify(initial)}`)
  assert(initial.assignmentOptionStateCount === 0, `Legacy assignment state labels are still visible: ${JSON.stringify(initial)}`)
  assert(initial.searchInChooserHeading, `Assignment search was not placed in the chooser heading: ${JSON.stringify(initial)}`)
  assert(initial.rosterHeadingBorderBottom === '0px', `Roster heading still has a separator: ${JSON.stringify(initial)}`)
  assert(new Set(initial.unselectedRosterBackgrounds).size === 1, `Unselected roster rows do not share one neutral background: ${JSON.stringify(initial)}`)
  assert(!initial.unselectedRosterBackgrounds.includes(initial.selectedRosterBackground), `Selected roster row is not the only persistent colored row: ${JSON.stringify(initial)}`)
  assert(initial.sharedHeadingCount === 1 && initial.heading === 'MCP 配置', `MCP did not use the shared Settings heading: ${JSON.stringify(initial)}`)
  assert(initial.legacyHeroCount === 0, `Legacy boxed Hero returned to MCP Settings: ${JSON.stringify(initial)}`)

  const rosterKeyboardStarted = await evaluate(cdp, `(() => {
    const selected = document.querySelector('.mcp-member-roster-row[aria-selected="true"]')
    selected?.focus()
    return Boolean(selected) && document.activeElement === selected
  })()`)
  assert(rosterKeyboardStarted, 'Could not focus the selected member roster row')
  await dispatchKey(cdp, 'End')
  await wait(250)
  const rosterEndState = await evaluate(cdp, `(() => {
    const rows = [...document.querySelectorAll('.mcp-member-roster-row')]
    return {
      selectedIndex: rows.findIndex((row) => row.getAttribute('aria-selected') === 'true'),
      activeIndex: rows.indexOf(document.activeElement),
      count: rows.length
    }
  })()`)
  assert(rosterEndState.count > 0 && rosterEndState.selectedIndex === rosterEndState.count - 1 && rosterEndState.activeIndex === rosterEndState.count - 1, `End did not select and focus the last roster row: ${JSON.stringify(rosterEndState)}`)
  await dispatchKey(cdp, 'Home')
  await waitForExpression(cdp, `(() => {
    const row = document.querySelector('.mcp-member-roster-row')
    return row?.getAttribute('aria-selected') === 'true' && document.activeElement === row
  })()`, 5_000)

  await setValue(cdp, '.mcp-assignment-chooser-heading input', 'play')
  await waitForExpression(cdp, `document.querySelectorAll('.mcp-assignment-option').length === 1 && document.querySelector('.mcp-assignment-option')?.dataset.mcpServerName === 'playwright'`, 5_000)
  await setValue(cdp, '.mcp-assignment-chooser-heading input', '')
  await clickButtonByText(cdp, '.mcp-assignment-toolbar button', '只看未分配')
  await waitForExpression(cdp, `[...document.querySelectorAll('.mcp-assignment-option input')].every((node) => !node.checked)`, 5_000)
  await clickButtonByText(cdp, '.mcp-assignment-toolbar button', '全部')

  await clickButtonByText(cdp, '.mcp-settings button', '从本机 Agent 导入')
  await waitForExpression(cdp, `Boolean(document.querySelector('.mcp-import-dialog'))`, 30_000)
  const importPreview = await evaluate(cdp, `(() => ({
    candidateCount: document.querySelectorAll('.mcp-import-candidate').length,
    candidateStates: [...document.querySelectorAll('.mcp-import-candidate')].map((node) => ({
      text: node.innerText,
      disabled: node.querySelector('input[type="checkbox"]')?.disabled,
      checked: node.querySelector('input[type="checkbox"]')?.checked
    })),
    secretVisible: document.body.innerText.includes('rovai-secret-must-not-render'),
    sourceStatus: [...document.querySelectorAll('.mcp-source-status')].map((node) => node.textContent?.trim())
  }))()`)
  assert(importPreview.candidateCount === 1, `Expected one isolated Codex candidate: ${JSON.stringify(importPreview)}`)
  assert(!importPreview.candidateStates[0]?.disabled, `The isolated Codex candidate is not importable: ${JSON.stringify(importPreview)}`)
  assert(!importPreview.secretVisible, 'Imported literal secret reached the Renderer')

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
  await waitForExpression(cdp, `document.querySelectorAll('.mcp-server-row').length === 3`, 15_000)
  const imported = await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.mcp-server-row')]
      .find((node) => node.querySelector('.mcp-server-title strong')?.textContent === 'imported_docs')
    return {
      text: row?.innerText,
      enabled: row?.querySelector('[role="switch"]')?.getAttribute('aria-checked'),
      secretVisible: document.body.innerText.includes('rovai-secret-must-not-render')
    }
  })()`)
  assert(imported.text.includes('imported_docs'), `Imported Server is missing: ${JSON.stringify(imported)}`)
  assert(imported.enabled === 'false', `Credential-incomplete import was enabled: ${JSON.stringify(imported)}`)
  assert(!imported.secretVisible, 'Imported literal secret reached the Library row')

  await clickButtonByText(cdp, '.mcp-settings button', '添加 MCP')
  await waitForExpression(cdp, `Boolean(document.querySelector('.mcp-editor-dialog'))`, 5_000)
  await setValue(cdp, '.mcp-json-editor textarea', JSON.stringify({
    mcpServers: { 'smoke-http': { url: 'https://example.test/mcp' } }
  }, null, 2))
  await clickButtonByText(cdp, '.mcp-editor-dialog button', '保存')
  await waitForExpression(cdp, `document.querySelectorAll('.mcp-server-row').length === 4`, 10_000)
  await waitForExpression(cdp, `document.activeElement?.textContent?.includes('添加 MCP')`, 5_000)

  await evaluate(cdp, `[...document.querySelectorAll('.mcp-member-roster-row')].at(-1)?.click()`)
  await waitForExpression(cdp, `document.querySelectorAll('.mcp-assignment-option input:checked').length === 0`, 5_000)
  await clickButtonByText(cdp, '.mcp-bulk-actions button', '选择筛选结果')
  await waitForExpression(cdp, `(() => {
    const options = [...document.querySelectorAll('.mcp-assignment-option')]
    const checked = options.filter((node) => node.querySelector('input')?.checked).map((node) => node.dataset.mcpServerName)
    return checked.length === 4 && checked.includes('playwright') && !document.querySelector('.mcp-risk-dialog')
  })()`, 15_000)
  await clickButtonByText(cdp, '.mcp-bulk-actions button', '清空当前筛选')
  await waitForExpression(cdp, `document.querySelectorAll('.mcp-assignment-option input:checked').length === 0`, 15_000)
  await evaluate(cdp, `document.querySelector('.mcp-member-roster-row')?.click()`)
  await waitForExpression(cdp, `document.querySelector('.mcp-member-roster-row')?.getAttribute('aria-selected') === 'true'`, 5_000)

  const assignment = await evaluate(cdp, `(() => {
    const label = [...document.querySelectorAll('.mcp-assignment-option')]
      .find((node) => node.dataset.mcpServerName === 'smoke-http')
    const checkbox = label?.querySelector('input')
    if (!checkbox || checkbox.checked) return false
    checkbox.click()
    return true
  })()`)
  assert(assignment, 'Assignment workbench did not expose the new MCP option')
  await waitForExpression(cdp, `(() => {
    const row = [...document.querySelectorAll('.mcp-server-row')]
      .find((node) => node.querySelector('.mcp-server-title strong')?.textContent === 'smoke-http')
    return row?.querySelector('.mcp-server-assignees')?.textContent.includes('1 位队员')
  })()`, 10_000)

  await clickRowSwitch(cdp, 'smoke-http')
  await waitForExpression(cdp, `(() => {
    const row = [...document.querySelectorAll('.mcp-server-row')]
      .find((node) => node.querySelector('.mcp-server-title strong')?.textContent === 'smoke-http')
    return row?.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true'
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

  await capture(cdp, `${outputPrefix}-day-clean.png`)
  const cleanDay = await layoutState(cdp)
  assertLayout(cleanDay, 1440, 920, 'day')

  await evaluate(cdp, `document.querySelector('.mcp-installed-section')?.scrollIntoView({ block: 'start' })`)
  await wait(150)
  await capture(cdp, `${outputPrefix}-library-clean.png`)
  const libraryDay = await layoutState(cdp)
  assertLayout(libraryDay, 1440, 920, 'day')
  await evaluate(cdp, `document.querySelector('.settings-panel')?.scrollTo({ top: 0 })`)

  await evaluate(cdp, `window.rovai.appearance.setPreference('night')`)
  await waitForExpression(cdp, `document.documentElement.dataset.theme === 'day'`, 5_000)
  await resize(cdp, 1040, 700)
  await capture(cdp, `${outputPrefix}-night-preference-day-compact.png`)
  const nightPreferenceDay = await layoutState(cdp)
  assertLayout(nightPreferenceDay, 1040, 700, 'day')

  await evaluate(cdp, `[...document.querySelectorAll('details')].forEach((node) => { node.open = false })`)
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  const reducedMotion = await evaluate(cdp, `matchMedia('(prefers-reduced-motion: reduce)').matches`)
  assert(reducedMotion, 'Reduced-motion media emulation was not applied')
  await resize(cdp, 520, 700)
  const zoom200 = await layoutState(cdp)
  assertLayout(zoom200, 520, 700, 'day')
  await resize(cdp, 1040, 700)

  await clickRowButton(cdp, 'smoke-http', '删除')
  await waitForExpression(cdp, `Boolean(document.querySelector('.compact-dialog'))`, 5_000)
  await clickButtonByText(cdp, '.compact-dialog button', '删除')
  await waitForExpression(cdp, `document.querySelectorAll('.mcp-server-row').length === 3`, 10_000)
  const finalNames = await evaluate(cdp, `[...document.querySelectorAll('.mcp-server-title > strong')].map((node) => node.textContent)`)
  assert(JSON.stringify(finalNames) === JSON.stringify(['context7', 'imported_docs', 'playwright']), `Delete did not converge: ${JSON.stringify(finalNames)}`)

  const sharedSettingsHeadings = []
  for (const [navigationLabel, expectedHeading] of [
    ['通用', '通用'],
    ['外观', '外观'],
    ['通知', '通知'],
    ['Skill', 'Skill 管理'],
    ['MCP', 'MCP 配置'],
    ['Agent 运行时', 'Agent 运行时'],
    ['诊断与修复', '诊断与修复']
  ]) {
    await clickButtonByText(cdp, '.settings-sidebar-menu button', navigationLabel)
    await waitForExpression(cdp, `document.querySelector('.settings-page-heading h1')?.textContent === ${JSON.stringify(expectedHeading)}`, 10_000)
    const headingState = await evaluate(cdp, `(() => ({
      count: document.querySelectorAll('.settings-page-heading').length,
      legacyHeroCount: document.querySelectorAll('.project-hero').length,
      heading: document.querySelector('.settings-page-heading h1')?.textContent
    }))()`)
    assert(headingState.count === 1, `${navigationLabel} did not render exactly one shared Settings heading: ${JSON.stringify(headingState)}`)
    assert(headingState.legacyHeroCount === 0, `${navigationLabel} rendered a legacy boxed Hero: ${JSON.stringify(headingState)}`)
    sharedSettingsHeadings.push(headingState.heading)
  }

  cdp.close()
  console.log(JSON.stringify({
    ok: true,
    subnav: initial.subnav,
    sourceStatus: importPreview.sourceStatus,
    importedSecretRedacted: true,
    reviewedDefaultsMaterialized: true,
    noAutomaticImportScan: true,
    rosterKeyboardNavigation: true,
    assignmentSearchAndFilter: true,
    searchInChooserHeading: true,
    neutralRosterWithSelectedSteelState: true,
    persistentRiskUiRemoved: true,
    highRiskMutationUsesOrdinaryFlow: true,
    memberAssignmentEdited: true,
    bulkAssignmentEdited: true,
    enableTogglePersisted: true,
    permissionsRepaired: true,
    day,
    cleanDay,
    libraryDay,
    nightPreferenceDay,
    zoom200,
    reducedMotion,
    finalNames,
    sharedSettingsHeadings,
    screenshots: [
      `${outputPrefix}-day.png`,
      `${outputPrefix}-day-clean.png`,
      `${outputPrefix}-library-clean.png`,
      `${outputPrefix}-night-preference-day-compact.png`
    ]
  }, null, 2))
} finally {
  app.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveClose) => app.once('close', resolveClose)),
    wait(2_000)
  ])
  if (app.exitCode === null) app.kill('SIGKILL')
  await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}

async function resize(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  })
}

async function dispatchKey(cdp, key) {
  const windowsVirtualKeyCode = key === 'End' ? 35 : 36
  const nativeVirtualKeyCode = key === 'End' ? 119 : 115
  const params = { key, code: key, windowsVirtualKeyCode, nativeVirtualKeyCode }
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
}

async function layoutState(cdp) {
  return evaluate(cdp, `(() => {
    const panel = document.querySelector('.settings-panel')
    const dialog = document.querySelector('[data-radix-dialog-content]')
    const roster = document.querySelector('.mcp-member-roster')
    const workbench = document.querySelector('.mcp-assignment-workbench')
    const panelRect = panel?.getBoundingClientRect()
    return {
      theme: document.documentElement.dataset.theme,
      width: window.innerWidth,
      height: window.innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      panelOverflow: panel ? panel.scrollWidth > panel.clientWidth : true,
      panelWidth: panel?.clientWidth,
      panelScrollWidth: panel?.scrollWidth,
      overflowing: panelRect ? [...panel.querySelectorAll('*')]
        .filter((node) => node.getBoundingClientRect().right > panelRect.right + 1)
        .slice(0, 8)
        .map((node) => ({
          tagName: node.tagName,
          className: node.className,
          parentClassName: node.parentElement?.className,
          text: node.textContent?.trim().slice(0, 60),
          width: Math.round(node.getBoundingClientRect().width),
          right: Math.round(node.getBoundingClientRect().right - panelRect.right)
        })) : [],
      dialogOpen: Boolean(dialog),
      focusVisibleTarget: document.activeElement?.tagName,
      rosterCount: document.querySelectorAll('.mcp-member-roster-row').length,
      rosterOverflowX: roster ? getComputedStyle(roster).overflowX : null,
      rosterOverflowY: roster ? getComputedStyle(roster).overflowY : null,
      rosterScrollsX: roster ? roster.scrollWidth > roster.clientWidth : false,
      rosterScrollsY: roster ? roster.scrollHeight > roster.clientHeight : false,
      workbenchColumns: workbench ? getComputedStyle(workbench).gridTemplateColumns : null
    }
  })()`)
}

function assertLayout(value, width, height, theme) {
  assert(value.width === width && value.height === height, `Viewport mismatch: ${JSON.stringify(value)}`)
  assert(value.theme === theme, `Theme mismatch: ${JSON.stringify(value)}`)
  assert(!value.horizontalOverflow && !value.panelOverflow, `MCP settings overflow: ${JSON.stringify(value)}`)
  assert(!value.dialogOpen, `Unexpected dialog obscured acceptance capture: ${JSON.stringify(value)}`)
  if (value.rosterCount >= 8 && width > 820) {
    assert(value.rosterOverflowY === 'auto' && value.rosterScrollsY, `Tall roster did not scroll vertically inside the workbench: ${JSON.stringify(value)}`)
  }
  if (value.rosterCount >= 8 && width <= 820) {
    assert(value.rosterOverflowX === 'auto' && value.rosterScrollsX, `Narrow roster did not become a bounded horizontal strip: ${JSON.stringify(value)}`)
  }
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

async function setValue(cdp, selector, value) {
  const changed = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)})
    element.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  assert(changed, `Could not set ${selector}`)
}

async function rowText(cdp, name) {
  return evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.mcp-server-row')]
      .find((node) => node.querySelector('.mcp-server-title strong')?.textContent === ${JSON.stringify(name)})
    return row?.innerText ?? ''
  })()`)
}

async function clickRowButton(cdp, name, label) {
  const expanded = await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.mcp-server-row')]
      .find((node) => node.querySelector('.mcp-server-title strong')?.textContent === ${JSON.stringify(name)})
    const details = row?.querySelector('.mcp-server-details-button')
    if (!row || !details) return false
    if (details.getAttribute('aria-expanded') !== 'true') details.click()
    return true
  })()`)
  assert(expanded, `Could not expand ${name}`)
  await waitForExpression(cdp, `(() => {
    const row = [...document.querySelectorAll('.mcp-server-row')]
      .find((node) => node.querySelector('.mcp-server-title strong')?.textContent === ${JSON.stringify(name)})
    return Boolean(row?.querySelector('.mcp-server-row-details:not([hidden])'))
  })()`, 5_000)
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

async function request(cdp, method, params = {}) {
  return evaluate(cdp, `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`)
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
