import type { BrowserWindow, MessageChannelMain } from 'electron'
import {
  APP_PREPARE_QUIT_CHANNEL,
  type AppQuitPreparationResponse
} from '../shared/app-lifecycle'

function rendererPreparationResponse(value: unknown): AppQuitPreparationResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Renderer returned an invalid App quit preparation response')
  }
  const response = value as Record<string, unknown>
  if (response.status === 'prepared') return { status: 'prepared' }
  if (response.status === 'failed' && typeof response.message === 'string') {
    return { status: 'failed', message: response.message }
  }
  throw new Error('Renderer returned an invalid App quit preparation response')
}

/** Requests preparation only while a live, loaded Renderer can own a Composer. */
export function requestRendererQuitPreparation(
  window: BrowserWindow | null,
  createChannel: () => MessageChannelMain
): Promise<void> {
  if (
    !window
    || window.isDestroyed()
    || window.webContents.isDestroyed()
    || window.webContents.isLoadingMainFrame()
  ) {
    return Promise.resolve()
  }

  const { port1, port2 } = createChannel()
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      port1.removeListener('message', onMessage)
      port1.removeListener('close', onClose)
      port1.close()
    }
    const succeed = (): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    const onMessage = (event: Electron.MessageEvent): void => {
      try {
        const response = rendererPreparationResponse(event.data)
        if (response.status === 'failed') {
          fail(new Error(response.message || 'Renderer failed to prepare for App quit'))
          return
        }
        succeed()
      } catch (error) {
        fail(error)
      }
    }
    const onClose = (): void => {
      fail(new Error('Renderer closed before App quit preparation completed'))
    }

    port1.once('message', onMessage)
    port1.once('close', onClose)
    port1.start()
    try {
      window.webContents.postMessage(APP_PREPARE_QUIT_CHANNEL, null, [port2])
    } catch (error) {
      port2.close()
      fail(error)
    }
  })
}
