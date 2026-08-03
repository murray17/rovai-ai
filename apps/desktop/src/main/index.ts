import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, shell } from 'electron'
import type {
  AppearanceSnapshot,
  CoreMethod,
  NavigationPin,
  SaveMemberAvatarAssetInput,
  ThemePreference
} from '@contracts'
import { CoreClient } from './core-client'
import {
  isThemePreference,
  nativeThemeSource,
  readThemePreference,
  resolvedTheme,
  themeBackground,
  writeThemePreference
} from './appearance-preference'
import {
  readWindowStateFile,
  sanitizeWindowState,
  writeWindowStateFile
} from './window-state'
import {
  inspectMemberAvatarSourceFile,
  MemberAvatarAssetService
} from './member-avatar-assets'
import { legacyUserDataPath } from './user-data-path'
import { deleteRetiredManagedDirectory } from './quick-chat-cutover'
import { readNavigationPins, writeNavigationPins } from './navigation-pins'
import { RUNTIME_RENDERER_CORE_METHODS } from './runtime-core-methods'

const allowedMethods = new Set<CoreMethod>([
  'health.check',
  ...RUNTIME_RENDERER_CORE_METHODS,
  'agents.list',
  'agents.get',
  'agents.memberships.list',
  'agents.create',
  'agents.update',
  'agents.avatar.set',
  'agents.memoryWrite.set',
  'agents.runtime.set',
  'agents.runtime.clear',
  'agents.presence.set',
  'agents.removalPreview',
  'agents.remove',
  'agents.reorder',
  'memory.list',
  'memory.get',
  'memory.settings.get',
  'memory.settings.set',
  'memory.create',
  'memory.revise',
  'memory.retire',
  'memory.reactivate',
  'memory.forget',
  'memory.supersede',
  'memory.review.schedule',
  'memory.hearthProposals.list',
  'memory.hearthProposals.accept',
  'memory.hearthProposals.reject',
  'memory.hearthProposals.rejectBatch',
  'campMembers.memoryWrite.set',
  'context.summaryModel.get',
  'context.summaryModel.set',
  'runtime.installations.list',
  'runtime.installations.create',
  'runtime.installations.update',
  'runtime.installations.refresh',
  'skills.list',
  'skills.get',
  'skills.import.inspect',
  'skills.import.commit',
  'skills.setEnabled',
  'skills.delete',
  'skills.projections.listIssues',
  'skills.reconcile',
  'skills.revealLocation',
  'mcp.config.get',
  'mcp.config.repairPermissions',
  'mcp.servers.create',
  'mcp.servers.update',
  'mcp.servers.setEnabled',
  'mcp.servers.delete',
  'mcp.import.scan',
  'mcp.import.commit',
  'conversations.restartNativeSession',
  'app.info',
  'camps.creationPreflight',
  'workspaces.inspect',
  'navigation.snapshot',
  'navigation.groupCamps',
  'navigation.campViewed',
  'camps.create',
  'camps.rename',
  'camps.changeDefaultLead',
  'camps.reconcileDefaultLead',
  'camps.delete',
  'campTurns.cancel',
  'camps.snapshot',
  'agentRunEvidence.getContent',
  'agentRunEvidence.list',
  'tasks.create',
  'tasks.update',
  'tasks.list',
  'tasks.get',
  'camp.composerDraft.get',
  'camp.composerDraft.save',
  'camp.composerDraft.removeAttachment',
  'camp.composerDraft.discard',
  'camp.messages.send',
  'action.approvals.resolve',
  'notifications.inbox',
  'notifications.createdSince',
  'notifications.markRead',
  'notifications.markCampRead',
  'notifications.markAllRead',
  'notifications.clear',
  'notifications.clearRead',
  'notifications.preference.get',
  'notifications.preference.update',
  'events.subscribe',
  'diagnostics.export'
])
const APP_NAME = 'Rovai-ai'
app.setName(APP_NAME)
const isolatedAcceptanceInstance =
  process.env.ROVAI_ALLOW_ISOLATED_INSTANCE === '1'
  && app.commandLine.hasSwitch('user-data-dir')
const primaryInstance = isolatedAcceptanceInstance || app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
const core = new CoreClient()
let mainWindow: BrowserWindow | null = null
let themePreference: ThemePreference = 'system'
let appearanceFilePath = ''
let navigationFilePath = ''
let lastAppearanceSignature = ''

const legacyDataPath = legacyUserDataPath(
  app.getPath('appData'),
  APP_NAME,
  app.commandLine.hasSwitch('user-data-dir')
)
if (legacyDataPath) app.setPath('userData', legacyDataPath)
const memberAvatars = new MemberAvatarAssetService(app.getPath('userData'))

function appearanceSnapshot(): AppearanceSnapshot {
  return {
    preference: themePreference,
    resolvedTheme: resolvedTheme(nativeTheme.shouldUseDarkColors)
  }
}

function publishAppearance(): AppearanceSnapshot {
  const snapshot = appearanceSnapshot()
  const signature = `${snapshot.preference}:${snapshot.resolvedTheme}`
  mainWindow?.setBackgroundColor(themeBackground(snapshot.resolvedTheme))
  if (signature !== lastAppearanceSignature) {
    lastAppearanceSignature = signature
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rovai:appearance-changed', snapshot)
    }
  }
  return snapshot
}

const MIN_WINDOW_WIDTH = 1040
const MIN_WINDOW_HEIGHT = 700
const RAIL_BUTTON_INSET_X = 12
const RAIL_BUTTON_INSET_Y = 14

function createWindow(): void {
  const theme = appearanceSnapshot().resolvedTheme
  const windowStatePath = join(app.getPath('userData'), 'window-state.json')
  const savedState = sanitizeWindowState(
    readWindowStateFile(windowStatePath),
    screen.getAllDisplays().map((display) => display.workArea),
    MIN_WINDOW_WIDTH,
    MIN_WINDOW_HEIGHT
  )
  mainWindow = new BrowserWindow({
    width: savedState?.width ?? 1440,
    height: savedState?.height ?? 920,
    x: savedState?.x,
    y: savedState?.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    title: APP_NAME,
    titleBarStyle: 'hidden',
    trafficLightPosition: {
      x: RAIL_BUTTON_INSET_X,
      y: RAIL_BUTTON_INSET_Y
    },
    backgroundColor: themeBackground(theme),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  let persistBoundsTimer: ReturnType<typeof setTimeout> | null = null
  const persistBounds = (): void => {
    if (persistBoundsTimer) clearTimeout(persistBoundsTimer)
    persistBoundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen()) return
      void writeWindowStateFile(windowStatePath, mainWindow.getBounds()).catch(() => undefined)
    }, 400)
  }
  mainWindow.on('resize', persistBounds)
  mainWindow.on('move', persistBounds)

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL()
    if (current && url !== current) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

if (primaryInstance) void app.whenReady().then(async () => {
  await deleteRetiredManagedDirectory(app.getPath('userData'))
  appearanceFilePath = join(app.getPath('userData'), 'appearance.json')
  navigationFilePath = join(app.getPath('userData'), 'navigation.json')
  themePreference = readThemePreference(appearanceFilePath)
  nativeTheme.themeSource = nativeThemeSource(themePreference)
  nativeTheme.on('updated', publishAppearance)
  publishAppearance()
  void memberAvatars.cleanupStaleTemporaryDirectories().catch(() => undefined)
  core.start()
  core.onEvent((event) => mainWindow?.webContents.send('rovai:event', event))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error: unknown) => {
  console.error('[rovai] Quick Chat cutover failed; startup aborted.', error)
  app.quit()
})

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

ipcMain.handle('rovai:request', async (_event, method: CoreMethod, params?: unknown) => {
  if (!allowedMethods.has(method)) throw new Error(`Renderer requested an unsupported method: ${method}`)
  return core.request(method, params)
})

ipcMain.handle('rovai:appearance-get', () => appearanceSnapshot())

ipcMain.handle('rovai:appearance-set', async (_event, preference: unknown) => {
  if (!isThemePreference(preference)) throw new Error('Unsupported theme preference')
  await writeThemePreference(appearanceFilePath, preference)
  themePreference = preference
  nativeTheme.themeSource = nativeThemeSource(preference)
  return publishAppearance()
})

ipcMain.handle('rovai:navigation-pins-get', () => readNavigationPins(navigationFilePath))

ipcMain.handle('rovai:navigation-pins-replace', (_event, pins: NavigationPin[]) =>
  writeNavigationPins(navigationFilePath, pins)
)

ipcMain.handle('rovai:member-avatar-select-source', async () => {
  const options = {
    title: '选择角色图片',
    buttonLabel: '选择图片',
    filters: [
      { name: '静态图片', extensions: ['png', 'jpg', 'jpeg'] }
    ],
    properties: ['openFile'] as Array<'openFile'>
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return inspectMemberAvatarSourceFile(result.filePaths[0])
})

ipcMain.handle(
  'rovai:member-avatar-save',
  async (_event, input: SaveMemberAvatarAssetInput) => memberAvatars.save(input)
)

ipcMain.handle(
  'rovai:member-avatar-read',
  async (
    _event,
    avatarRef: unknown,
    rendition: unknown
  ) => {
    if (
      typeof avatarRef !== 'string'
      || (rendition !== 'icon' && rendition !== 'portrait')
    ) {
      throw new Error('Unsupported member avatar read request')
    }
    return memberAvatars.read(avatarRef, rendition)
  }
)

const MAX_COMPOSER_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_COMPOSER_PREVIEW_BYTES = 8 * 1024 * 1024

function requireIpcString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024) {
    throw new Error(`${label} 无效。`)
  }
  return value
}

function requireDraftRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('Draft Revision 无效。')
  }
  return value as number
}

ipcMain.handle(
  'rovai:composer-attachment-prepare-path',
  async (
    _event,
    campId: unknown,
    expectedRevision: unknown,
    sourcePath: unknown,
    displayName: unknown
  ) => {
    return core.request('camp.attachments.prepareFromPath' as CoreMethod, {
      campId: requireIpcString(campId, 'Camp ID'),
      expectedRevision: requireDraftRevision(expectedRevision),
      sourcePath: requireIpcString(sourcePath, '附件路径'),
      displayName: requireIpcString(displayName, '附件名称')
    })
  }
)

ipcMain.handle(
  'rovai:composer-attachment-prepare-bytes',
  async (
    _event,
    campId: unknown,
    expectedRevision: unknown,
    displayName: unknown,
    input: unknown
  ) => {
    const resolvedCampId = requireIpcString(campId, 'Camp ID')
    const resolvedRevision = requireDraftRevision(expectedRevision)
    const resolvedDisplayName = requireIpcString(displayName, '附件名称')
    if (!(input instanceof Uint8Array) || input.byteLength > MAX_COMPOSER_ATTACHMENT_BYTES) {
      throw new Error('附件无效或超过 25 MiB。')
    }
    const ingressDirectory = join(app.getPath('userData'), 'attachment-ingress')
    await mkdir(ingressDirectory, { recursive: true, mode: 0o700 })
    await chmod(ingressDirectory, 0o700)
    const temporaryPath = join(ingressDirectory, `${randomUUID()}.tmp`)
    try {
      await writeFile(temporaryPath, input, { flag: 'wx', mode: 0o600 })
      return await core.request('camp.attachments.prepareFromPath' as CoreMethod, {
        campId: resolvedCampId,
        expectedRevision: resolvedRevision,
        sourcePath: temporaryPath,
        displayName: resolvedDisplayName
      })
    } finally {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }
)

ipcMain.handle(
  'rovai:composer-attachment-preview',
  async (_event, attachmentId: unknown) => {
    const source = await core.request<{
      path: string
      mediaType: string
      byteSize: number
    } | null>('camp.attachments.previewSource' as CoreMethod, {
      attachmentId: requireIpcString(attachmentId, '附件 ID')
    })
    if (!source || source.byteSize > MAX_COMPOSER_PREVIEW_BYTES) return null
    const bytes = await readFile(source.path)
    if (bytes.byteLength !== source.byteSize || bytes.byteLength > MAX_COMPOSER_PREVIEW_BYTES) {
      return null
    }
    return {
      mediaType: source.mediaType,
      bytes: new Uint8Array(bytes)
    }
  }
)

ipcMain.handle('rovai:select-workspace-directory', async () => {
  const options = {
    title: '选择工作目录',
    buttonLabel: '选择目录',
    properties: ['openDirectory'] as Array<'openDirectory'>
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return core.request('workspaces.inspect', { path: result.filePaths[0] })
})

ipcMain.handle('rovai:select-runtime-executable', async () => {
  const options = {
    title: '选择本机 Agent Runtime 可执行文件',
    buttonLabel: '选择 Runtime',
    properties: ['openFile'] as Array<'openFile'>
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

ipcMain.handle('rovai:select-skill-import-directory', async () => {
  const options = {
    title: '导入 Skill',
    buttonLabel: '检查目录',
    properties: ['openDirectory'] as Array<'openDirectory'>
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

ipcMain.handle('rovai:reveal-skill', async (_event, skillId: unknown) => {
  if (typeof skillId !== 'string' || !skillId.trim()) {
    throw new Error('Skill ID 无效。')
  }
  const location = await core.request<{ skillId: string; path: string }>(
    'skills.revealLocation',
    { skillId }
  )
  shell.showItemInFolder(location.path)
})

ipcMain.handle('rovai:reveal-mcp-config', async () => {
  const config = await core.request<{ path: string; exists: boolean }>('mcp.config.get')
  if (config.exists) {
    shell.showItemInFolder(config.path)
    return
  }
  const directory = dirname(config.path)
  const error = await shell.openPath(directory)
  if (error) {
    throw new Error(`MCP 配置目录尚不存在：${directory}`)
  }
})

ipcMain.handle('rovai:export-diagnostics', async () => {
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, {
        title: '导出 Rovai-ai 诊断数据',
        defaultPath: `rovai-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
    : await dialog.showSaveDialog({
        title: '导出 Rovai-ai 诊断数据',
        defaultPath: `rovai-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
  if (result.canceled || !result.filePath) return null
  const diagnostics = await core.request('diagnostics.export')
  await writeFile(result.filePath, `${JSON.stringify(diagnostics, null, 2)}\n`, { mode: 0o600 })
  return result.filePath
})

ipcMain.handle('rovai:export-memory', async () => {
  const options = {
    title: '导出 Rovai-ai 记忆',
    defaultPath: `rovai-memory-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  const exported = await core.request('memory.export')
  const temporary = `${result.filePath}.rovai-${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(exported, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx'
    })
    await chmod(temporary, 0o600)
    await rename(temporary, result.filePath)
    await chmod(result.filePath, 0o600)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  return result.filePath
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  nativeTheme.removeListener('updated', publishAppearance)
  core.stop()
})
