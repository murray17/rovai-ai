import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  stat,
  writeFile
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(
  process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai-ai.app')
)
const dataDir = process.env.ROVAI_MEMBER_AVATAR_ACCEPT_DATA_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-member-avatar-ui-accept-'))
const outputDir = process.env.ROVAI_MEMBER_AVATAR_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-member-avatar-ui-captures-'))
const firstPort = Number(process.env.ROVAI_MEMBER_AVATAR_ACCEPT_DEBUG_PORT ?? 9451)
const databasePath = join(dataDir, 'rovai.sqlite')
const customDisplayName = '自定义像素伙伴'
const acceptanceExecutablePath = '/usr/bin/true'
const acceptanceExecutableFingerprint = `sha256:${createHash('sha256')
  .update(await readFile(acceptanceExecutablePath))
  .digest('hex')}`
const acceptanceModelCatalog = JSON.stringify([{
  id: 'gpt-avatar-accept',
  displayName: 'Avatar Acceptance Runtime',
  isDefault: true,
  hidden: false,
  deprecated: false,
  options: []
}])
const acceptancePermissionOptions = JSON.stringify([
  {
    key: 'sandbox_mode',
    label: 'Sandbox',
    description: '',
    valueType: 'enum',
    choices: [{ value: 'workspace-write', label: 'workspace-write' }],
    recommendedValue: 'workspace-write',
    scope: 'session',
    risk: 'normal',
    supported: true,
    required: true,
    unsupportedReason: null
  },
  {
    key: 'approval_policy',
    label: 'Approval policy',
    description: '',
    valueType: 'enum',
    choices: [{ value: 'on-request', label: 'on-request' }],
    recommendedValue: 'on-request',
    scope: 'session',
    risk: 'normal',
    supported: true,
    required: true,
    unsupportedReason: null
  }
])

await mkdir(outputDir, { recursive: true })

let first = null
let second = null
let third = null
let customAvatarRef = null
let orphanAvatarRef = null
try {
  first = await launchApp(firstPort, 1440, 920)
  await setTheme(first.cdp, 'day')
  await assertCanonicalSeedAvatars(first.cdp, 'Fresh database')
  await openMembers(first.cdp)
  await selectMember(first.cdp, '洛可')
  await assertBuiltinRenditions(first.cdp, 'day')
  await assertNoHorizontalOverflow(first.cdp, '1440×920 day member detail')
  const dayCapture = join(outputDir, 'member-avatar-day.png')
  await capture(first.cdp, dayCapture)

  await openCreateDialog(first.cdp)
  await waitForExpression(first.cdp,
    `document.querySelectorAll('.member-preset-card').length === 4`)
  await waitForExpression(first.cdp,
    `[...document.querySelectorAll('.member-preset-card .member-avatar--bust img')]
      .every((image) => image.complete && image.naturalWidth > 0)`)
  await assertDialogFitsViewport(first.cdp, '1440×920 day create dialog')
  const dayDialogCapture = join(outputDir, 'member-avatar-create-day.png')
  await capture(first.cdp, dayDialogCapture)
  await clickElementContaining(first.cdp, '.member-preset-card', '洛可')
  await waitForExpression(first.cdp,
    `document.querySelector('input[placeholder="builder"]')?.value === 'luoke-2'`)
  await replaceLabeledInput(first.cdp, '显示名称', '洛可副本')
  await clickButton(first.cdp, '.member-dialog button', '创建成员')
  await waitForExpression(first.cdp, `!document.querySelector('.member-dialog')`, 30_000)
  const presetCopy = (await request(first.cdp, 'agents.list'))
    .find((profile) => profile.displayName === '洛可副本')
  assert(
    presetCopy?.id !== 'agent-luoke'
      && presetCopy?.handle === 'luoke-2'
      && presetCopy.avatarRef === 'rovai://member-avatar/builtin/luoke/v1',
    `Preset copy did not use an independent handle: ${JSON.stringify(presetCopy)}`
  )
  const canonicalLuoke = (await request(first.cdp, 'agents.list'))
    .find((profile) => profile.id === 'agent-luoke')
  assert(
    canonicalLuoke?.handle === 'luoke' && canonicalLuoke.displayName === '洛可',
    `Preset create mutated the canonical companion: ${JSON.stringify(canonicalLuoke)}`
  )

  customAvatarRef = await createManagedProfile(first.cdp, customDisplayName)
  orphanAvatarRef = await saveManagedAvatar(first.cdp, '#74628f', '#a99ad0')
  await reloadRenderer(first.cdp)
  await openMembers(first.cdp)
  await waitForText(first.cdp, '.member-list-copy strong', customDisplayName)
  await selectMember(first.cdp, customDisplayName)
  await waitForExpression(first.cdp,
    `Boolean(document.querySelector('.member-portrait img[src^="blob:"]'))`)
  await waitForExpression(first.cdp,
    `document.querySelector('.member-portrait img[src^="blob:"]')?.naturalWidth > 0`)

  await closeApp(first)
  first = null
  await simulateV24AvatarSchema()

  second = await launchApp(firstPort + 1, 1040, 700)
  await setTheme(second.cdp, 'night')
  await assertCanonicalSeedAvatars(second.cdp, 'Upgraded database')
  const upgradedProfiles = await request(second.cdp, 'agents.list')
  const upgradedQilu = upgradedProfiles.find((profile) => profile.id === 'agent-qilu')
  const restartedCustom = upgradedProfiles.find(
    (profile) => profile.displayName === customDisplayName
  )
  assert(
    upgradedQilu?.displayName === '绮露自定义'
      && upgradedQilu.status === 'archived'
      && upgradedQilu.avatarRef === 'rovai://member-avatar/builtin/qilu/v1',
    `Migration v25 changed non-avatar Profile fields: ${JSON.stringify(upgradedQilu)}`
  )
  assert(
    restartedCustom?.avatarRef === customAvatarRef,
    'Managed custom avatar reference did not survive restart and upgrade'
  )
  await restoreAcceptanceRuntimeSnapshot()
  await openMembers(second.cdp)
  await selectMember(second.cdp, customDisplayName)
  await clickButton(second.cdp, '.member-section-heading button', '编辑身份')
  await waitForSelector(second.cdp, '.member-dialog')
  await waitForExpression(second.cdp,
    `Boolean(document.querySelector('.member-dialog button.primary-button:not(:disabled)'))`,
    30_000)
  await clickButton(second.cdp, '.member-dialog button', '保存身份')
  await waitForExpression(second.cdp, `!document.querySelector('.member-dialog')`, 30_000)
  const readyCustom = (await request(second.cdp, 'agents.list'))
    .find((profile) => profile.displayName === customDisplayName)
  assert(
    readyCustom?.runtimeReadiness?.status === 'ready',
    `Managed custom Profile was not Runtime Ready after restart: ${JSON.stringify(readyCustom?.runtimeReadiness)}`
  )
  await openNewConversation(second.cdp)
  await waitForExpression(second.cdp, `(() => {
    const chip = document.querySelector('.member-ready-chip')
    return chip?.textContent?.includes(${JSON.stringify(customDisplayName)})
      && chip.querySelector('img[src^="blob:"]')?.naturalWidth > 0
  })()`)
  await enterMentionQuery(second.cdp)
  await waitForExpression(second.cdp, `(() => {
    const option = [...document.querySelectorAll('.mention-menu [role="option"]')]
      .find((candidate) => candidate.textContent?.includes(${JSON.stringify(customDisplayName)}))
    return option?.querySelector('img[src^="blob:"]')?.naturalWidth > 0
  })()`)
  await openMembers(second.cdp)
  await selectMember(second.cdp, customDisplayName)
  await waitForExpression(second.cdp,
    `document.querySelector('.member-portrait img[src^="blob:"]')?.naturalWidth > 0`)
  await assertThemeRendition(second.cdp, 'night')
  await assertNoHorizontalOverflow(second.cdp, '1040×700 compact night member detail')
  const nightCapture = join(outputDir, 'member-avatar-night-compact.png')
  await capture(second.cdp, nightCapture)

  await openCreateDialog(second.cdp)
  await assertDialogFitsViewport(second.cdp, '1040×700 compact night create dialog')
  const nightDialogCapture = join(
    outputDir,
    'member-avatar-create-night-compact.png'
  )
  await capture(second.cdp, nightDialogCapture)
  await clickButton(second.cdp, '.member-dialog button', '取消')
  await waitForExpression(second.cdp, `!document.querySelector('.member-dialog')`)

  await clickButton(second.cdp, '.member-status-actions button', '归档')
  await waitForText(second.cdp, '.member-status-actions', '已归档')
  const archivedCustom = (await request(second.cdp, 'agents.list'))
    .find((profile) => profile.displayName === customDisplayName)
  assert(archivedCustom?.status === 'archived', 'Custom Profile was not archived')

  await closeApp(second)
  second = null
  const customAssetDirectory = managedAssetDirectory(customAvatarRef)
  const orphanAssetDirectory = managedAssetDirectory(orphanAvatarRef)
  await assertPrivateAssetDirectory(customAssetDirectory)
  await assertPrivateAssetDirectory(orphanAssetDirectory)
  await rename(
    join(customAssetDirectory, 'icon-192.png'),
    join(customAssetDirectory, 'icon-192.missing')
  )

  third = await launchApp(firstPort + 2, 1040, 700)
  await openMembers(third.cdp)
  await selectMember(third.cdp, customDisplayName)
  await waitForExpression(third.cdp, `(() => {
    const row = [...document.querySelectorAll('.member-list-item')]
      .find((candidate) => candidate.querySelector('strong')?.textContent === ${JSON.stringify(customDisplayName)})
    return row?.querySelector('.member-avatar-fallback')?.textContent?.trim() === '自'
  })()`)
  await waitForExpression(third.cdp,
    `document.querySelector('.member-portrait img[src^="blob:"]')?.naturalWidth > 0`)
  assert(
    (await request(third.cdp, 'agents.list'))
      .find((profile) => profile.displayName === customDisplayName)?.status === 'archived',
    'Archived managed Profile disappeared after a rendition file was lost'
  )

  console.log(JSON.stringify({
    ok: true,
    app: basename(appPath),
    dataDir,
    outputDir,
    verified: {
      freshSeedBuiltinRefs: true,
      packagedBuiltinGlyphBustPortrait: true,
      presetIndependentHandle: 'luoke-2',
      packagedManagedSaveReadIpc: true,
      managedRestartPersistence: true,
      managedRuntimeReadyMentionAndDefaultLead: true,
      migrationV25PreservesProfileFields: true,
      archivedAssetRetention: true,
      orphanAssetRetention: true,
      missingIconControlledFallback: true,
      dayAndCompactNightLayouts: true,
      horizontalOverflow: false
    },
    captures: {
      day: dayCapture,
      dayCreateDialog: dayDialogCapture,
      compactNight: nightCapture,
      compactNightCreateDialog: nightDialogCapture
    }
  }, null, 2))
} finally {
  if (first) await closeApp(first)
  if (second) await closeApp(second)
  if (third) await closeApp(third)
}

async function assertCanonicalSeedAvatars(cdp, context) {
  const profiles = await request(cdp, 'agents.list')
  for (const role of ['luoke', 'muwa', 'mianzhi', 'qilu']) {
    const profile = profiles.find((candidate) => candidate.id === `agent-${role}`)
    assert(
      profile?.avatarRef === `rovai://member-avatar/builtin/${role}/v1`,
      `${context} has an unexpected ${role} avatarRef: ${JSON.stringify(profile)}`
    )
  }
}

async function assertBuiltinRenditions(cdp, theme) {
  await waitForExpression(cdp,
    `[...document.querySelectorAll('.member-list-avatar img')]
      .every((image) => image.complete && image.naturalWidth > 0)`)
  await waitForExpression(cdp,
    `[...document.querySelectorAll('.member-portrait img')]
      .every((image) => image.complete && image.naturalWidth > 0)`)
  const state = await evaluate(cdp, `({
    listImages: document.querySelectorAll('.member-list-avatar img').length,
    portraitImages: document.querySelectorAll('.member-portrait img').length,
    dayDisplay: getComputedStyle(document.querySelector('.member-portrait .member-avatar-image--day')).display,
    nightDisplay: getComputedStyle(document.querySelector('.member-portrait .member-avatar-image--night')).display
  })`)
  assert(state.listImages >= 8, 'Builtin member list did not render Day/Night glyph pairs')
  assert(state.portraitImages === 2, 'Builtin member detail did not render a portrait pair')
  assert(
    theme === 'day'
      ? state.dayDisplay !== 'none' && state.nightDisplay === 'none'
      : state.dayDisplay === 'none' && state.nightDisplay !== 'none',
    `Builtin portrait did not resolve the ${theme} rendition: ${JSON.stringify(state)}`
  )
}

async function assertThemeRendition(cdp, theme) {
  const actual = await evaluate(cdp, `document.documentElement.dataset.theme`)
  assert(actual === theme, `Expected ${theme} theme, found ${actual}`)
}

async function createManagedProfile(cdp, displayName) {
  const avatarRef = await saveManagedAvatar(cdp, '#39777a', '#7db8b6')
  const result = await request(cdp, 'agents.create', {
    commandId: crypto.randomUUID(),
    command: {
      handle: 'custom-avatar',
      displayName,
      avatarRef,
      personaLabel: '验收角色',
      accent: null,
      roleTitle: '本地图片验收',
      roleDescription: '验证受管图片在重启、归档和文件缺失时保持受控行为。',
      instructions: '',
      defaultCapabilities: []
    }
  })
  assert(result.status === 'applied', `Could not create managed Profile: ${JSON.stringify(result)}`)
  return avatarRef
}

async function saveManagedAvatar(cdp, sourceColor, iconColor) {
  return evaluate(cdp, `(async () => {
    async function png(size, color) {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      context.fillStyle = color
      context.fillRect(0, 0, size, size)
      context.fillStyle = '#ffffff'
      context.beginPath()
      context.arc(size / 2, size / 2, size * 0.26, 0, Math.PI * 2)
      context.fill()
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG encode failed')), 'image/png'))
      return new Uint8Array(await blob.arrayBuffer())
    }
    const summary = await window.rovai.memberAvatars.save({
      sourcePng: await png(512, ${JSON.stringify(sourceColor)}),
      iconPng: await png(192, ${JSON.stringify(iconColor)}),
      sourceWidth: 512,
      sourceHeight: 512,
      crop: { centerX: 0.5, centerY: 0.5, size: 0.72 }
    })
    return summary.avatarRef
  })()`, true)
}

async function simulateV24AvatarSchema() {
  const sql = `
    UPDATE agent_profile
    SET avatar_ref = NULL
    WHERE id IN ('agent-luoke', 'agent-muwa', 'agent-mianzhi', 'agent-qilu');
    UPDATE agent_profile
    SET display_name = '绮露自定义', profile_status = 'archived', archived_at = datetime('now')
    WHERE id = 'agent-qilu';
    DELETE FROM schema_migration WHERE version = 25;
    INSERT INTO adapter_installation(
      id, adapter_kind, executable_path, source, auth_scope,
      enabled, version, created_at, updated_at
    ) VALUES (
      'adapter-avatar-accept', 'codex-cli', '${acceptanceExecutablePath}', 'custom',
      'acceptance', 1, 1, datetime('now'), datetime('now')
    );
    INSERT INTO adapter_capability_snapshot(
      installation_id, reported_version, executable_fingerprint,
      authentication_status, probe_status, permission_schema_version,
      capabilities_json, protocols_json, model_catalog_json,
      permission_options_json, observed_at, last_attempted_at, stale_at, last_error
    ) VALUES (
      'adapter-avatar-accept', 'acceptance', '${acceptanceExecutableFingerprint}',
      'authenticated', 'ready', 1, '[]', '[]',
      '${acceptanceModelCatalog}', '${acceptancePermissionOptions}',
      datetime('now'), datetime('now'), NULL, NULL
    );
    UPDATE agent_profile
    SET default_runtime_installation_id = 'adapter-avatar-accept',
        default_model_selection_json = '{"mode":"runtime_default"}',
        default_permission_config_json =
          '{"adapterKind":"codex-cli","schemaVersion":1,"values":{"sandbox_mode":"workspace-write","approval_policy":"on-request"}}'
    WHERE handle = 'custom-avatar';
  `
  await runProcess('/usr/bin/sqlite3', [databasePath, sql])
}

async function restoreAcceptanceRuntimeSnapshot() {
  const sql = `
    UPDATE adapter_capability_snapshot
    SET reported_version = 'acceptance',
        executable_fingerprint = '${acceptanceExecutableFingerprint}',
        authentication_status = 'authenticated',
        probe_status = 'ready',
        permission_schema_version = 1,
        capabilities_json = '[]',
        protocols_json = '[]',
        model_catalog_json = '${acceptanceModelCatalog}',
        permission_options_json = '${acceptancePermissionOptions}',
        observed_at = datetime('now'),
        last_attempted_at = datetime('now'),
        stale_at = NULL,
        last_error = NULL
    WHERE installation_id = 'adapter-avatar-accept';
  `
  await runProcess('/usr/bin/sqlite3', [databasePath, sql])
}

async function openNewConversation(cdp) {
  const opened = await evaluate(cdp, `(() => {
    const button = document.querySelector('.icon-rail button[aria-label="新对话"]')
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert(opened, 'Could not open New Conversation from global navigation')
  await waitForSelector(cdp, '.new-conversation-workspace', 30_000)
}

async function enterMentionQuery(cdp) {
  const changed = await evaluate(cdp, `(() => {
    const textarea = document.querySelector('#new-camp-message')
    if (!textarea) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, '@')
    textarea.setSelectionRange(1, 1)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  assert(changed, 'Could not enter a mention query in New Conversation')
  await waitForSelector(cdp, '.mention-menu')
}

async function openMembers(cdp) {
  const opened = await evaluate(cdp, `(() => {
    const button = document.querySelector('.icon-rail button[aria-label="成员"]')
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert(opened, 'Could not open Members from global navigation')
  await waitForSelector(cdp, '.member-workbench', 30_000)
}

async function reloadRenderer(cdp) {
  await cdp.send('Page.reload', { ignoreCache: true })
  await waitForExpression(cdp,
    `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
  await waitForExpression(cdp,
    `Boolean(document.querySelector('.icon-rail button[aria-label="成员"]:not(:disabled)'))`,
    45_000)
}

async function selectMember(cdp, displayName) {
  const selected = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.member-list-item')]
      .find((candidate) => candidate.querySelector('strong')?.textContent === ${JSON.stringify(displayName)})
    if (!button) return false
    button.click()
    return true
  })()`)
  assert(selected, `Could not select member ${displayName}`)
  await waitForExpression(cdp,
    `document.querySelector('.member-profile-heading h3')?.textContent === ${JSON.stringify(displayName)}`)
}

async function openCreateDialog(cdp) {
  await clickButton(cdp, '.member-hero button', '＋ 新增成员')
  await waitForSelector(cdp, '.member-dialog')
}

async function replaceLabeledInput(cdp, label, value) {
  const changed = await evaluate(cdp, `(() => {
    const field = [...document.querySelectorAll('.member-dialog label')]
      .find((candidate) => candidate.childNodes[0]?.textContent?.trim() === ${JSON.stringify(label)})
    const input = field?.querySelector('input')
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  assert(changed, `Could not edit field ${label}`)
  await waitForExpression(cdp,
    `[...document.querySelectorAll('.member-dialog label')]
      .find((candidate) => candidate.childNodes[0]?.textContent?.trim() === ${JSON.stringify(label)})
      ?.querySelector('input')?.value === ${JSON.stringify(value)}`)
}

async function clickElementContaining(cdp, selector, text) {
  const clicked = await evaluate(cdp, `(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent?.includes(${JSON.stringify(text)}))
    if (!element || element.disabled) return false
    element.click()
    return true
  })()`)
  assert(clicked, `Could not click ${selector} containing ${JSON.stringify(text)}`)
}

async function clickButton(cdp, selector, label) {
  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert(clicked, `Could not click enabled button "${label}" within ${selector}`)
}

async function waitForText(cdp, selector, text) {
  await waitForExpression(cdp, `[...document.querySelectorAll(${JSON.stringify(selector)})]
    .some((node) => node.textContent?.includes(${JSON.stringify(text)}))`, 30_000)
}

async function assertNoHorizontalOverflow(cdp, context) {
  const state = await evaluate(cdp, `({
    documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
    surfaces: [...document.querySelectorAll('.content, .member-workbench, .member-detail')]
      .filter((node) => node.scrollWidth > node.clientWidth + 1)
      .map((node) => ({ className: node.className, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }))
  })`)
  assert(
    !state.documentOverflow && state.surfaces.length === 0,
    `${context} has horizontal overflow: ${JSON.stringify(state)}`
  )
}

async function assertDialogFitsViewport(cdp, context) {
  const state = await evaluate(cdp, `(() => {
    const dialog = document.querySelector('.member-dialog')
    const actions = dialog?.querySelector('.dialog-actions')
    const dialogRect = dialog?.getBoundingClientRect()
    const actionsRect = actions?.getBoundingClientRect()
    return {
      exists: Boolean(dialog && actions && dialogRect && actionsRect),
      horizontalOverflow: dialog ? dialog.scrollWidth > dialog.clientWidth + 1 : true,
      dialogLeft: dialogRect?.left ?? -1,
      dialogRight: dialogRect?.right ?? window.innerWidth + 1,
      actionsTop: actionsRect?.top ?? window.innerHeight + 1,
      actionsBottom: actionsRect?.bottom ?? window.innerHeight + 1,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    }
  })()`)
  assert(
    state.exists
      && !state.horizontalOverflow
      && state.dialogLeft >= 0
      && state.dialogRight <= state.viewportWidth
      && state.actionsTop >= 0
      && state.actionsBottom <= state.viewportHeight,
    `${context} has inaccessible or overflowing actions: ${JSON.stringify(state)}`
  )
}

function managedAssetDirectory(avatarRef) {
  assert(typeof avatarRef === 'string', 'Managed avatar reference was unavailable')
  const assetId = avatarRef.split('/').at(-1)
  return join(dataDir, 'member-avatars', assetId)
}

async function assertPrivateAssetDirectory(directory) {
  for (const file of ['source.png', 'icon-192.png', 'manifest.json']) {
    await access(join(directory, file))
  }
  if (process.platform !== 'win32') {
    assert(((await stat(directory)).mode & 0o777) === 0o700,
      `Managed asset directory is not mode 0700: ${directory}`)
    for (const file of ['source.png', 'icon-192.png', 'manifest.json']) {
      assert(((await stat(join(directory, file))).mode & 0o777) === 0o600,
        `Managed avatar file is not mode 0600: ${join(directory, file)}`)
    }
  }
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  assert(manifest.schemaVersion === 1, 'Managed avatar manifest schema is invalid')
}

async function request(cdp, method, params = {}) {
  return evaluate(
    cdp,
    `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`,
    true
  )
}

async function setTheme(cdp, preference) {
  await evaluate(
    cdp,
    `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`,
    true
  )
  await waitForExpression(cdp,
    `document.documentElement.dataset.theme === ${JSON.stringify(preference)}`)
}

async function launchApp(port, width, height) {
  const stderr = []
  const launcher = spawn('/usr/bin/open', [
    '-na',
    appPath,
    '--args',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`
  ], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe']
  })
  launcher.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  const target = await waitForTarget(port, stderr)
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Page.bringToFront')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  })
  await waitForExpression(cdp,
    `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
  await waitForExpression(cdp,
    `Boolean(document.querySelector('.icon-rail button[aria-label="成员"]:not(:disabled)'))`,
    45_000)
  return { cdp, port, stderr }
}

async function closeApp(running) {
  try {
    await Promise.race([running.cdp.send('Browser.close'), wait(1_000)])
  } catch {
    // The isolated App may already have exited.
  }
  running.cdp.close()
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5_000) {
    try {
      await fetch(`http://127.0.0.1:${running.port}/json`)
    } catch {
      return
    }
    await wait(100)
  }
  throw new Error(`Isolated packaged App did not close on debug port ${running.port}`)
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
  await waitForExpression(
    cdp,
    `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
    timeoutMs
  )
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
      const targets = await fetch(`http://127.0.0.1:${port}/json`)
        .then((response) => response.json())
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
    for (const request of pending.values()) {
      request.reject(new Error('CDP connection closed'))
    }
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

function runProcess(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun(stdout.join(''))
      else rejectRun(
        new Error(`${command} exited with ${code ?? signal}: ${stderr.join('')}`)
      )
    })
  })
}
