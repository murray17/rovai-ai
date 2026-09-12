import { createContext, useContext, type ReactNode } from 'react'
import type { RovaiApi } from '@contracts'
import { desktopCampClient } from './desktop-camp-client'

/** Dependencies of the existing Camp UI, not a public HTTP operation allowlist.
 * Remote adapters must authorize each operation and resource at the Host boundary.
 * Native startup, credentials, window controls and supervisor are intentionally absent.
 */
export type CampClient = Pick<RovaiApi,
  'request' | 'onEvent' | 'composerAttachments' | 'platform'
> & {
  /** Optional host shortcut; browsers retain their own tab/window shortcuts. */
  onClosePreviewRequested?: RovaiApi['windowControls']['onCloseTabRequested']
  attachments: (RovaiApi['attachments'] & { kind: 'native' }) | {
    kind: 'download'
    download: RovaiApi['attachments']['open']
  }
}

const CampClientContext = createContext<CampClient | null>(null)

export function CampClientProvider({ client, children }: {
  // Keep this object stable for one mounted client scope. Switching Host/session
  // must remount the business subtree; draft coordinators and UI state are scoped
  // to that mount. Remote connection generations/caches are implemented separately.
  client: CampClient
  children: ReactNode
}): React.JSX.Element {
  return <CampClientContext.Provider value={client}>{children}</CampClientContext.Provider>
}

export function useCampClient(): CampClient {
  // Existing Desktop mounts retain their real bridge. Browser/review mounts must
  // inject a client; no global window.rovai shim or empty-result fallback is created.
  return useContext(CampClientContext) ?? desktopCampClient
}
