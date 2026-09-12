import { createContext, useContext, type ReactNode } from 'react'
import type { RovaiApi } from '@contracts'
import { desktopCampClient } from './desktop-camp-client'

/** Dependencies of the existing Camp UI, not a public HTTP operation allowlist.
 * Remote adapters must authorize each operation and resource at the Host boundary.
 * Native startup, credentials, window controls and supervisor are intentionally absent.
 */
export type CampClient = Pick<RovaiApi,
  'request' | 'composerAttachments' | 'platform'
> & {
  onEvent?: RovaiApi['onEvent']
  /** Authorized invalidation signal; it is deliberately not a CoreEvent. */
  onInvalidated?: (listener: () => void) => () => void
  /** Optional host shortcut; browsers retain their own tab/window shortcuts. */
  onClosePreviewRequested?: RovaiApi['windowControls']['onCloseTabRequested']
  attachments: (RovaiApi['attachments'] & { kind: 'native' }) | {
    kind: 'download'
    download: RovaiApi['attachments']['open']
  }
}

const CampClientContext = createContext<CampClient | null>(null)

export function CampClientProvider({ client, children }: {
  // Stable for one Host/Owner/editor scope. Authentication renewal changes the
  // transport generation, not this object or the mounted Composer.
  client: CampClient
  children: ReactNode
}): React.JSX.Element {
  return <CampClientContext.Provider value={client}>{children}</CampClientContext.Provider>
}

export function useCampClient(): CampClient {
  // Existing Desktop mounts retain their real bridge. Browser/review mounts must
  // inject a client; no global window.rovai shim or empty-result fallback is created.
  const client = useContext(CampClientContext)
  if (client) return client
  if (typeof window === 'undefined' || window.rovai) return desktopCampClient
  throw new Error('共享页面缺少 CampClientProvider；浏览器不能使用 Desktop 默认适配。')
}
