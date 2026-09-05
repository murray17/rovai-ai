import type { BrowserWindow } from 'electron'
import type { PreventableQuitEvent } from './app-quit-coordinator'

/** A close-only fence: preparation must finish while the Renderer is alive. */
export function createWindowCloseHandler(
  window: Pick<BrowserWindow, 'close' | 'isDestroyed'>,
  prepareRenderer: () => Promise<void>,
  reportFailure: (error: unknown) => void
): (event: PreventableQuitEvent) => void {
  let preparing = false
  let preparedClose = false

  return (event) => {
    if (preparedClose) {
      preparedClose = false
      return
    }
    event.preventDefault()
    if (preparing) return
    preparing = true

    void (async () => {
      try {
        await prepareRenderer()
        if (!window.isDestroyed()) {
          // Re-enter the native close lifecycle without requesting preparation again.
          preparedClose = true
          window.close()
        }
      } catch (error) {
        preparedClose = false
        reportFailure(error)
      } finally {
        preparing = false
      }
    })()
  }
}
