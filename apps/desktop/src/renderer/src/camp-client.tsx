import { uiAttribute } from './interface-language'
import { createContext, useContext, type ReactNode } from 'react'
import type { RovaiApi } from '@contracts'
import { desktopThreadClient } from './desktop-camp-client'

/** Dependencies of the existing Thread UI, not a public HTTP operation allowlist.
 * Remote adapters must authorize each operation and resource at the Host boundary.
 * Native startup, credentials, window controls and supervisor are intentionally absent.
 */
export interface EditingRecovery { get(identity: string): unknown; set(identity: string, value: unknown): void }

export type ThreadClient = Pick<RovaiApi,
  'request' | 'singleChatAttachments' | 'platform'
> & {
  missionAttachments: RovaiApi['missionAttachments'] | null
  composerAttachments: Omit<RovaiApi['composerAttachments'], 'preview'> & {
    preview(locator: import('@contracts').LocalAttachmentOwnerLocator): Promise<Omit<import('@contracts').AttachmentPreviewResult, 'preview'> & {
      preview: import('@contracts').AttachmentPreview | { blob: Blob } | null
    }>
  }
  editingRecovery?: EditingRecovery
  /** Explicit resource/platform dependencies of the shared management pages. */
  exportMonitoring: (filter: import('@contracts').MonitoringFilter) => Promise<{ exported: boolean; path?: string }>
  revealMonitoringExport: RovaiApi['revealMonitoringExport'] | null
  exportDiagnostics: () => Promise<{ exported: boolean; path?: string }>
  revealDiagnosticsExport: RovaiApi['revealDiagnosticsExport'] | null
  memberAvatars: RovaiApi['memberAvatars']
  selectSkillImportDirectory: RovaiApi['selectSkillImportDirectory']
  selectRuntimeExecutable: RovaiApi['selectRuntimeExecutable'] | null
  revealMcpConfig: RovaiApi['revealMcpConfig'] | null
  channels: (Pick<RovaiApi['channels'], 'get' | 'onChanged' | 'publishMemberBot' | 'retryMemberBot' | 'selectPublicationApprover'> & {
    native: Pick<RovaiApi['channels'], 'connect' | 'disconnect' | 'cancelQrAttempt' | 'refreshLoginQr'> | null
  }) | null
  onEvent?: RovaiApi['onEvent']
  /** Authorized invalidation signal; it is deliberately not a CoreEvent. */
  onInvalidated?: (listener: (change?: import('@contracts').ThreadReadInvalidation) => void) => () => void
  /** Optional host shortcut; browsers retain their own tab/window shortcuts. */
  onClosePreviewRequested?: RovaiApi['windowControls']['onCloseTabRequested']
  attachmentLocation?: (locator: import('@contracts').LocalAttachmentOwnerLocator) => Promise<{ path: string; location: 'local' | 'server' } | null>
  attachments: (RovaiApi['attachments'] & { kind: 'native' }) | {
    kind: 'download'
    download: RovaiApi['attachments']['open']
  }
}

const ThreadClientContext = createContext<ThreadClient | null>(null)

export function ThreadClientProvider({ client, children }: {
  // Stable for one Host/Owner/editor scope. Authentication renewal changes the
  // transport generation, not this object or the mounted Composer.
  client: ThreadClient
  children: ReactNode
}): React.JSX.Element {
  return <ThreadClientContext.Provider value={client}>{children}</ThreadClientContext.Provider>
}

export function useThreadClient(): ThreadClient {
  // Existing Desktop mounts retain their real bridge. Browser/review mounts must
  // inject a client; no global window.rovai shim or empty-result fallback is created.
  const client = useContext(ThreadClientContext)
  if (client) return client
  if (typeof window === 'undefined' || window.rovai) return desktopThreadClient
  throw new Error(uiAttribute('共享页面缺少 ThreadClientProvider；浏览器不能使用 Desktop 默认适配。'))
}

export function useEditingRecovery(): EditingRecovery | undefined { return useContext(ThreadClientContext)?.editingRecovery }
