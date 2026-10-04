import { Menu, nativeImage, Tray } from 'electron'
import iconPath from '../../../../build/icon.png?asset'

/** Called only by the Windows main-window owner, after app.ready. */
export function createWindowsTray(open: () => void, quit: () => void, english: boolean): Tray {
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) throw new Error('Rovai tray icon is unavailable')
  const tray = new Tray(icon.resize({ width: 16, height: 16 }))
  try {
    tray.setToolTip('Rovai')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: english ? 'Open Rovai' : '打开 Rovai', click: open },
      { label: english ? 'Quit Rovai' : '退出 Rovai', click: quit }
    ]))
    tray.on('click', open)
    return tray
  } catch (error) {
    tray.destroy()
    throw error
  }
}
