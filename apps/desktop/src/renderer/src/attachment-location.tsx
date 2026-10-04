import { UiText, uiAttribute } from './interface-language'
import { useEffect, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { LocalAttachmentOwnerLocator } from '@contracts'
import { useThreadClient } from './camp-client'
import { writeClipboardText } from './clipboard'

/** Resolve only an explicitly inspected attachment; never read content for a path label. */
export function useAttachmentLocation(locator?: LocalAttachmentOwnerLocator) {
  const client = useThreadClient()
  const key = JSON.stringify(locator)
  const latest = useRef(locator)
  latest.current = locator
  const [location, setLocation] = useState<{ path: string; location: 'local' | 'server' } | null>(null)
  const pending = useRef(false)
  const revision = useRef(0)
  useEffect(() => { revision.current++; pending.current = false; setLocation(null); return () => { revision.current++ } }, [key])
  const inspect = (): void => {
    if (!latest.current || !client.attachmentLocation || location || pending.current) return
    const current = revision.current
    pending.current = true
    void client.attachmentLocation(latest.current).then(value => {
      if (current === revision.current) setLocation(value)
    }).catch(() => undefined).finally(() => { if (current === revision.current) pending.current = false })
  }
  const label = location ? `${location.location === 'server' ? uiAttribute('服务器：') : ''}${location.path}` : undefined
  return { location, label, inspect }
}

export function AttachmentLocationItems({ path, label, onNotify }: {
  path?: string; label?: string; onNotify: (message: string) => void
}) {
  if (!path) return null
  return <>
    <DropdownMenu.Label className="attachment-context-menu-label" title={label}>
      <small className="attachment-location-path">{label}</small>
    </DropdownMenu.Label>
    <DropdownMenu.Item className="attachment-context-menu-item attachment-context-menu-text" onSelect={() => {
      void writeClipboardText(path).then(copied => onNotify(copied ? uiAttribute('已复制完整路径') : uiAttribute('未能复制路径，请重试。'))).catch(() => onNotify(uiAttribute('未能复制路径，请重试。')))
    }}><UiText zh={"复制完整路径"} /></DropdownMenu.Item>
  </>
}
