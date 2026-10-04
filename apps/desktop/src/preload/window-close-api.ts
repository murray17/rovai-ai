import type { IpcRenderer } from 'electron'
import type { WindowCloseApi, WindowCloseSnapshot } from '@contracts'
import { WINDOW_CLOSE_CHANNEL, WINDOW_CLOSE_CHANGED } from '../shared/window-close'

export function createWindowCloseApi(ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>, platform: NodeJS.Platform): WindowCloseApi | undefined {
  if (platform !== 'win32') return undefined
  return {
    get: () => ipc.invoke(WINDOW_CLOSE_CHANNEL, 'get'),
    setBehavior: value => ipc.invoke(WINDOW_CLOSE_CHANNEL, 'set', value),
    respond: value => ipc.invoke(WINDOW_CLOSE_CHANNEL, 'respond', value),
    onChanged(listener) {
      const handler = (_event: unknown, value: WindowCloseSnapshot): void => listener(value)
      ipc.on(WINDOW_CLOSE_CHANGED, handler)
      return () => { ipc.removeListener(WINDOW_CLOSE_CHANGED, handler) }
    }
  }
}
