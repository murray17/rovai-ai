import type { IpcRenderer, WebContents } from 'electron'

const CLOSE_TAB_CHANNEL = 'rovai:close-tab-requested'
const CLOSE_WINDOW_CHANNEL = 'rovai:close-window-shortcut'

export function installCloseTabShortcut(contents: WebContents, platform: NodeJS.Platform, closeWindow: () => void): void {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isComposing || input.alt || input.shift) return
    const primary = platform === 'darwin' ? input.meta : input.control
    const secondary = platform === 'darwin' ? input.control : input.meta
    if (!primary || secondary || input.key.toLowerCase() !== 'w') return

    // Native menu accelerators run before Renderer keydown handlers.
    event.preventDefault()
    if (!input.isAutoRepeat) contents.send(CLOSE_TAB_CHANNEL)
  })
  contents.on('ipc-message', (_event, channel) => {
    if (channel === CLOSE_WINDOW_CHANNEL) closeWindow()
  })
}

export function createCloseTabShortcutHandler(
  ipc: Pick<IpcRenderer, 'on' | 'send'>
): (listener: () => boolean) => () => void {
  let current: (() => boolean) | null = null
  ipc.on(CLOSE_TAB_CHANNEL, () => {
    if (!current?.()) ipc.send(CLOSE_WINDOW_CHANNEL)
  })
  return (listener) => {
    current = listener
    return () => { if (current === listener) current = null }
  }
}
