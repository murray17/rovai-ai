import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { CoreMethod, Task } from '@contracts'
import { CoreClient } from './core-client'

const allowedMethods = new Set<CoreMethod>([
  'health.check',
  'agents.list',
  'agents.get',
  'agents.create',
  'agents.update',
  'agents.runtime.set',
  'agents.runtime.clear',
  'agents.status.set',
  'runtime.installations.list',
  'runtime.installations.create',
  'runtime.installations.update',
  'runtime.installations.refresh',
  'app.info',
  'camps.list',
  'camps.snapshot',
  'camp.messages.send',
  'action.approvals.resolve',
  'execution.preflight',
  'projects.open',
  'projects.list',
  'tasks.create',
  'tasks.createAndQueueExecution',
  'tasks.list',
  'tasks.complete',
  'tasks.get',
  'tasks.diff',
  'tasks.start',
  'tasks.resume',
  'tasks.send',
  'tasks.interrupt',
  'events.list',
  'events.subscribe',
  'approvals.list',
  'approvals.resolve',
  'diagnostics.export'
])
const core = new CoreClient()
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 700,
    show: false,
    title: 'Lumen AI',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#F4F0E8',
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

ipcMain.handle('lumen:select-project', async () => {
  const options = {
    title: '打开 Git 项目',
    buttonLabel: '打开项目',
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return core.request('projects.open', { path: result.filePaths[0] })
})

ipcMain.handle('lumen:reveal-task-workspace', async (_event, taskId: string) => {
  if (!taskId || typeof taskId !== 'string') throw new Error('Invalid task id')
  const task = await core.request<Task>('tasks.get', { taskId })
  if (!task.executionRoot) throw new Error('Task workspace is unavailable')
  shell.showItemInFolder(task.executionRoot)
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

app.on('before-quit', () => core.stop())
