import type { BrowserWindow } from 'electron'

/** Keep host navigation limited to the native macOS swipe gesture. */
export function installWindowNavigation(window: BrowserWindow, platform: NodeJS.Platform): void {
  if (platform === 'darwin') window.on('swipe', (event, direction) => {
    if (direction !== 'right' && direction !== 'left') return
    event.preventDefault()
    window.webContents.send('rovai:navigation-requested', direction === 'right' ? 'back' : 'forward')
  })
}
