import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { AppearanceSnapshot, CoreMethod, ThemePreference } from '@contracts'
import { CoreClient } from './core-client'
import {
  isThemePreference,
  nativeThemeSource,
  readThemePreference,
  resolvedTheme,
  themeBackground,
  writeThemePreference
} from './appearance-preference'

const allowedMethods = new Set<CoreMethod>([
  'health.check',
  'agents.list',
  'agents.get',
  'agents.memberships.list',
  'agents.create',
  'agents.update',
  'agents.runtime.set',
  'agents.runtime.clear',
  'agents.status.set',
  'agents.reorder',
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
  'camps.delete',
  'campTurns.cancel',
  'camps.snapshot',
  'tasks.create',
  'tasks.update',
  'tasks.list',
  'tasks.get',
  'camp.messages.send',
  'action.approvals.resolve',
  'events.subscribe',
  'diagnostics.export'
])
const core = new CoreClient()
let mainWindow: BrowserWindow | null = null
let themePreference: ThemePreference = 'system'
let appearanceFilePath = ''
let lastAppearanceSignature = ''

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
      mainWindow.webContents.send('lumen:appearance-changed', snapshot)
    }
  }
  return snapshot
}

function createWindow(): void {
  const theme = appearanceSnapshot().resolvedTheme
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    title: 'Lumen AI',
    titleBarStyle: 'hiddenInset',
    backgroundColor: themeBackground(theme),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

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

app.whenReady().then(() => {
  appearanceFilePath = join(app.getPath('userData'), 'appearance.json')
  themePreference = readThemePreference(appearanceFilePath)
  nativeTheme.themeSource = nativeThemeSource(themePreference)
  nativeTheme.on('updated', publishAppearance)
  publishAppearance()
  core.start()
  core.onEvent((event) => mainWindow?.webContents.send('lumen:event', event))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

ipcMain.handle('lumen:request', async (_event, method: CoreMethod, params?: unknown) => {
  if (!allowedMethods.has(method)) throw new Error(`Renderer requested an unsupported method: ${method}`)
  return core.request(method, params)
})

ipcMain.handle('lumen:appearance-get', () => appearanceSnapshot())

ipcMain.handle('lumen:appearance-set', async (_event, preference: unknown) => {
  if (!isThemePreference(preference)) throw new Error('Unsupported theme preference')
  await writeThemePreference(appearanceFilePath, preference)
  themePreference = preference
  nativeTheme.themeSource = nativeThemeSource(preference)
  return publishAppearance()
})

ipcMain.handle('lumen:select-project', async () => {
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

ipcMain.handle('lumen:select-runtime-executable', async () => {
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

ipcMain.handle('lumen:select-skill-import-directory', async () => {
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

ipcMain.handle('lumen:reveal-skill', async (_event, skillId: unknown) => {
  if (typeof skillId !== 'string' || !skillId.trim()) {
    throw new Error('Skill ID 无效。')
  }
  const location = await core.request<{ skillId: string; path: string }>(
    'skills.revealLocation',
    { skillId }
  )
  shell.showItemInFolder(location.path)
})

ipcMain.handle('lumen:reveal-mcp-config', async () => {
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

ipcMain.handle('lumen:export-diagnostics', async () => {
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, {
        title: '导出 Lumen 诊断数据',
        defaultPath: `lumen-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
    : await dialog.showSaveDialog({
        title: '导出 Lumen 诊断数据',
        defaultPath: `lumen-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
  if (result.canceled || !result.filePath) return null
  const diagnostics = await core.request('diagnostics.export')
  await writeFile(result.filePath, `${JSON.stringify(diagnostics, null, 2)}\n`, { mode: 0o600 })
  return result.filePath
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  nativeTheme.removeListener('updated', publishAppearance)
  core.stop()
})
