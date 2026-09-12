import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { WorkspaceSelection } from '@contracts'
import { AppDialogContent, AppDialogHeader, AppDialogBody, AppDialogFooter } from '../../desktop/src/renderer/src/AppDialog'
import type { ConsoleClient, WorkspaceListing } from './client'

export function HostWorkspacePicker({ transport, onSelect }: { transport: ConsoleClient; onSelect(value: WorkspaceSelection | null): void }) {
  const [listing, setListing] = useState<WorkspaceListing | null>(null)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  async function browse(target?: string, offset = 0): Promise<void> {
    const current = ++generation.current
    setBusy(true); setError('')
    try {
      const next = await transport.getWorkspaces(target, offset)
      if (current !== generation.current) return
      setListing(previous => offset && previous?.projectPath === next.projectPath ? { ...next, directories: [...previous.directories, ...next.directories] } : next)
      setPath(next.projectPath)
    } catch { if (current === generation.current) setError('无法读取该目录。请检查 Host 上的路径、访问权限和连接状态。') }
    finally { if (current === generation.current) setBusy(false) }
  }
  useEffect(() => { void browse(); return () => { generation.current++ } }, [transport])
  return <Dialog.Root open onOpenChange={open => { if (!open) onSelect(null) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><AppDialogContent>
    <AppDialogHeader title="选择 Host 工作目录" description="浏览这台 Host 有权访问的目录，或直接输入完整路径。" />
    <AppDialogBody>
      <form className="web-workspace-path" onSubmit={event => { event.preventDefault(); void browse(path) }}><label htmlFor="host-workspace-path">目录路径</label><div><input id="host-workspace-path" value={path} spellCheck={false} autoComplete="off" onChange={event => setPath(event.target.value)} /><button type="submit" className="quiet-button compact" disabled={busy || !path}>前往</button></div></form>
      <div className="web-workspace-actions"><button type="button" className="quiet-button compact" disabled={busy} onClick={() => void browse()}>主目录</button><button type="button" className="quiet-button compact" disabled={busy || !listing?.parentPath} onClick={() => listing?.parentPath && void browse(listing.parentPath)}>上一级</button>{listing?.roots.map(root => <button type="button" key={root} className="quiet-button compact" disabled={busy} onClick={() => void browse(root)}>{root}</button>)}</div>
      {error && <p role="alert">{error}</p>}
      <div className="web-workspace-list" aria-busy={busy}>{listing?.directories.map(choice => <button type="button" className="web-workspace-choice" key={choice.projectPath} disabled={busy} onClick={() => void browse(choice.projectPath)}><strong>{choice.name}</strong><span>{choice.projectPath}</span></button>)}</div>
      {busy ? <p role="status">正在读取目录…</p> : listing?.directories.length === 0 && <p>没有子目录，可以使用当前目录。</p>}
      {listing?.nextOffset != null && <button type="button" className="quiet-button compact" disabled={busy} onClick={() => void browse(listing.projectPath, listing.nextOffset!)}>加载更多目录</button>}
    </AppDialogBody>
    <AppDialogFooter><button type="button" className="quiet-button" onClick={() => onSelect(null)}>取消</button><button type="button" className="primary-button" disabled={busy || !listing || !!error || path !== listing.projectPath} onClick={() => listing && onSelect({ name: listing.name, projectPath: listing.projectPath })}>使用此目录</button></AppDialogFooter>
  </AppDialogContent></Dialog.Portal></Dialog.Root>
}
