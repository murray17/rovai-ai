import type { CampClient } from './camp-client'

/** Lazy Desktop-only compatibility adapter; importing it never accesses Electron. */
export const desktopCampClient: CampClient = {
  request: (method, params) => window.rovai.request(method, params),
  onEvent: (listener) => window.rovai.onEvent(listener),
  onClosePreviewRequested: listener => window.rovai.windowControls.onCloseTabRequested(listener),
  get composerAttachments() { return window.rovai.composerAttachments },
  attachments: { kind: 'native',
    open: locator => window.rovai.attachments.open(locator),
    reveal: locator => window.rovai.attachments.reveal(locator)
  },
  get platform() { return window.rovai.platform }
}
