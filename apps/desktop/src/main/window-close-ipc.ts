import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { isWindowCloseBehavior, parseWindowCloseResponse } from '../shared/window-close'
import type { WindowsWindowClose } from './windows-window-close'

export function createWindowCloseRequestHandler(platform: NodeJS.Platform, owner: () => WindowsWindowClose | null, mainWindow: () => BrowserWindow | null) {
  return (event: IpcMainInvokeEvent, command: unknown, value: unknown) => {
    const window = mainWindow()
    const controller = owner()
    if (platform !== 'win32' || !controller || !window || window.isDestroyed()
      || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Window close behavior is only available to the Windows main frame')
    }
    if (command === 'get') return controller.get()
    if (command === 'set' && isWindowCloseBehavior(value)) return controller.setBehavior(value)
    if (command === 'respond') return controller.respond(parseWindowCloseResponse(value))
    throw new Error('Invalid window close request')
  }
}
