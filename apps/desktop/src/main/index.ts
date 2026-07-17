import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { CoreMethod } from '@contracts'
import { CoreClient } from './core-client'

const allowedMethods = new Set<CoreMethod>([
  'health.check',
  'agents.list',
  'app.info',
  'projects.open',
  'projects.list',
  'tasks.create',
  'tasks.list',
  'tasks.get',
  'tasks.diff'
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

ipcMain.handle('lumen:reveal-path', async (_event, path: string) => {
  if (!path || typeof path !== 'string') throw new Error('Invalid path')
  shell.showItemInFolder(path)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => core.stop())
