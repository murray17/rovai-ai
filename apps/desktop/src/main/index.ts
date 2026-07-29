import { chmod, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, shell } from 'electron'
import type {
  AppearanceSnapshot,
  CoreMethod,
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
import { RUNTIME_RENDERER_CORE_METHODS } from './runtime-core-methods'

const allowedMethods = new Set<CoreMethod>([
  'health.check',
  ...RUNTIME_RENDERER_CORE_METHODS,
  'agents.list',
  'agents.get',
  'agents.memberships.list',
  'agents.create',
  'agents.update',
  'agents.runtime.set',
  'agents.runtime.clear',
  'agents.presence.set',
  'agents.removalPreview',
  'agents.remove',
  'agents.reorder',
  'memory.list',
  'memory.get',
  'memory.autoPolicy.get',
  'memory.autoPolicy.set',
  'memory.create',
  'memory.revise',
  'memory.retire',
  'memory.reactivate',
  'memory.forget',
  'memory.confirm',
  'memory.supersede',
  'memory.review.schedule',
  'memory.proposals.list',
  'memory.proposals.accept',
  'memory.proposals.reject',
  'memory.proposals.rejectBatch',
  'memory.projections.listIssues',
  'memory.reconcile',
  'campMembers.memoryProposal.set',
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
  'repositories.inspect',
  'navigation.snapshot',
  'navigation.groupCamps',
  'navigation.campViewed',
  'camps.createFromFirstMessage',
  'camps.rename',
  'camps.changeDefaultLead',
  'camps.reconcileDefaultLead',
  'camps.delete',
  'campTurns.cancel',
  'camps.snapshot',
  'agentRunEvidence.getContent',
  'tasks.create',
  'tasks.update',
  'tasks.list',
  'tasks.get',
  'camp.messages.send',
  'action.approvals.resolve',
  'events.subscribe',
  'diagnostics.export'
])
const APP_NAME = 'Rovai-ai'
app.setName(APP_NAME)
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
const core = new CoreClient()
let mainWindow: BrowserWindow | null = null
let themePreference: ThemePreference = 'system'
let appearanceFilePath = ''
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

if (primaryInstance) app.whenReady().then(() => {
  appearanceFilePath = join(app.getPath('userData'), 'appearance.json')
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

ipcMain.handle('rovai:select-project', async () => {
  const options = {
    title: '打开 Git 项目',
    buttonLabel: '打开项目',
    properties: ['openDirectory'] as Array<'openDirectory'>
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return core.request('repositories.inspect', { path: result.filePaths[0] })
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
    title: '导出 Rovai-ai 长期记忆',
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
