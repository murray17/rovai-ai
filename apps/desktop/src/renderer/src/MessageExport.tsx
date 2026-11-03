import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { ThreadMessageView } from '@contracts'
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader } from './AppDialog'
import { useThreadClient } from './camp-client'
import { getOrLoadImagePayload } from './ImageGallery'
import { CurrentUserAvatar } from './CurrentUserProfile'
import { MemberAvatar } from './MemberAvatar'
import { UiText, uiAttribute } from './interface-language'
import { writeClipboardText } from './clipboard'
import { CopyIcon } from './CopyIcon'
import { formatByteSize } from './ui-model'
import { AgentArtifactIcon, classifyAttachmentDisplay } from './attachment-presentation'
import { MessageExportContext } from './message-export-context'
import {
  defaultMessageExportOptions, defaultMessageExportTitle, downloadMessageExport, exportableMessages, exportDocumentPNG,
  exportEntryShowsTime, exportFilename, messageExportMarkdown, snapshotExportDocument, standaloneExportHTML, toggleExportSelection,
  type MessageExportEntry, type MessageExportFormat, type MessageExportOptions
} from './message-export'
import './message-export.css'

export function ExportGlyph(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" /></svg>
}
export function MessageSelectButton({ onSelect }: { onSelect(): void }): React.JSX.Element {
  return <button className="message-select-button" type="button" title={uiAttribute('选择多条消息')} aria-label={uiAttribute('选择多条消息')} onClick={onSelect}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 5h8M13 12h8M13 19h8m-18-2 2 2 4-4M3 7l2 2 4-4" /></svg>
  </button>
}
export function useMessageExport(threadId: string, messages: readonly ThreadMessageView[]) {
  const eligible = useMemo(() => exportableMessages(messages), [messages])
  const [state, setState] = useState<{ threadId: string; ids: Set<string>; anchor: string | null; selecting: boolean }>({ threadId, ids: new Set(), anchor: null, selecting: false })
  const [preview, setPreview] = useState<{ threadId: string; entries: MessageExportEntry[] } | null>(null)
  const selectionTrigger = useRef<HTMLElement | null>(null)
  useEffect(() => {
    setState(s => s.threadId === threadId ? s : { threadId, ids: new Set(), anchor: null, selecting: false })
    setPreview(p => p?.threadId === threadId ? p : null)
  }, [threadId])
  const selecting = state.threadId === threadId && state.selecting
  const selected = new Set(eligible.filter(m => state.threadId === threadId && state.ids.has(m.id)).map(m => m.id))
  const cancel = () => {
    setState({ threadId, ids: new Set(), anchor: null, selecting: false })
    requestAnimationFrame(() => { if (selectionTrigger.current?.isConnected) selectionTrigger.current.focus() })
  }
  useEffect(() => {
    if (selecting) document.querySelector<HTMLInputElement>('.message-export-check input:checked, .message-export-check input')?.focus()
  }, [selecting])
  useEffect(() => {
    if (!selecting || preview?.threadId === threadId) return
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"][data-state="open"]')) { event.preventDefault(); cancel() }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [selecting, threadId, preview])
  return { eligible, selected, selecting, entries: preview?.threadId === threadId ? preview.entries : null, cancel,
    start: (id?: string) => {
      selectionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      window.getSelection()?.removeAllRanges()
      setState({ threadId, ids: new Set(id ? [id] : []), anchor: id ?? null, selecting: true })
    },
    toggle: (id: string, range: boolean) => setState(s => ({ threadId, ids: toggleExportSelection(selected, eligible, id, s.threadId === threadId ? s.anchor : null, range), anchor: id, selecting: true })),
    all: () => setState({ threadId, ids: selected.size === eligible.length ? new Set() : new Set(eligible.map(m => m.id)), anchor: null, selecting: true }),
    clear: () => setState({ threadId, ids: new Set(), anchor: null, selecting: true }),
    open: (entries: MessageExportEntry[]) => { if (entries.length) setPreview({ threadId, entries }) },
    close: () => setPreview(null)
  }
}
export function MessageSelectionDock({ selection, onExport }: { selection: ReturnType<typeof useMessageExport>; onExport(): void }): React.JSX.Element | null {
  if (!selection.selecting) return null
  return <div className="message-selection-dock" role="region" aria-label={uiAttribute('多选消息操作')}>
    <div className="message-selection-dock-inner">
      <strong aria-live="polite">{uiAttribute('已选 {0} 条', String(selection.selected.size))}</strong>
      <div className="message-selection-actions"><button type="button" onClick={selection.all}>{selection.selected.size === selection.eligible.length ? uiAttribute('取消全选') : uiAttribute('全选已加载')}</button>
        <button type="button" onClick={selection.clear} disabled={!selection.selected.size}><UiText zh="清空" /></button>
        <span className="message-selection-spacer" /><button type="button" onClick={selection.cancel}><UiText zh="取消" /></button>
        <button className="primary-button" type="button" disabled={!selection.selected.size} onClick={onExport}><ExportGlyph /><UiText zh="导出" /></button>
      </div>
    </div>
  </div>
}
function ExportAttachment({ threadId, messageId, attachment, runtime = false }: { runtime?: boolean; threadId: string; messageId: string; attachment: ThreadMessageView['attachments'][number] }): React.JSX.Element {
  const client = useThreadClient(), [image, setImage] = useState<string | null>(null), [pending, setPending] = useState(attachment.previewKind === 'image')
  useEffect(() => {
    if (attachment.previewKind !== 'image') return
    let active = true, url: string | null = null
    void getOrLoadImagePayload(runtime ? { kind: 'runtime', threadId, image: { id: attachment.id, displayName: attachment.displayName, mediaType: attachment.mediaType ?? 'image/png', byteSize: attachment.byteSize ?? 0 } }
      : { kind: 'attachment', threadId, locator: { owner: 'message', threadId, messageId, attachmentRefId: attachment.id }, image: attachment }, client).then(result => {
      if (!active || !result) return
      url = URL.createObjectURL(result.blob); setImage(url)
    }).catch(() => undefined).finally(() => { if (active) setPending(false) })
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [client, threadId, messageId, attachment.id, attachment.previewKind, runtime])
  return <div className="message-export-attachment" data-export-pending={pending}>
    {image ? <img className="message-export-image" src={image} alt={attachment.displayName} onError={() => setImage(null)} />
      : <AgentArtifactIcon type={classifyAttachmentDisplay(attachment).agentDisplayType} />}
    <span><strong>{attachment.displayName}</strong><small>{attachment.mediaType ?? attachment.kind}{attachment.byteSize !== null ? ' · ' + formatByteSize(attachment.byteSize) : ''}
      {attachment.previewKind === 'image' && !pending && !image && <> · <UiText zh="原图不可用" /></>}</small></span>
  </div>
}
export function MessageExportDialog({ threadId, title: sourceTitle, entries, renderBody, onClose }: {
  threadId: string; title: string; entries: MessageExportEntry[] | null
  renderBody(message: ThreadMessageView): ReactNode; onClose(): void
}): React.JSX.Element {
  const [format, setFormat] = useState<MessageExportFormat>('html')
  const [settings, setSettings] = useState<Record<MessageExportFormat, MessageExportOptions>>(() => ({ html: defaultMessageExportOptions('html'), png: defaultMessageExportOptions('png'), markdown: defaultMessageExportOptions('markdown') }))
  const [customTitle, setCustomTitle] = useState<string | null>(null)
  const defaultTitle = defaultMessageExportTitle(sourceTitle)
  const title = customTitle ?? defaultTitle
  const [renaming, setRenaming] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const [manualCopy, setManualCopy] = useState<string | null>(null), [zoom, setZoom] = useState<string | null>(null), [copied, setCopied] = useState(false)
  const trigger = useRef<HTMLElement | null>(null)
  const reader = useRef<HTMLElement>(null), controller = useRef<AbortController | null>(null), options = settings[format]
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { setError(null); setManualCopy(null); setZoom(null) }, [entries])
  useEffect(() => { setCopied(false) }, [entries, format])
  useEffect(() => {
    reader.current?.querySelectorAll<HTMLElement>('button:not(.markdown-code-copy), a:not([href^="https://"]):not([href^="http://"])').forEach(node => { node.tabIndex = -1 })
  }, [entries, format, options])
  const name = title.trim() || defaultTitle
  const markdown = entries ? messageExportMarkdown(name, entries, options) : ''
  const close = () => { if (!busy) onClose() }
  const download = async () => {
    if (busy || !entries?.length) return
    const control = new AbortController(); controller.current?.abort(); controller.current = control
    setBusy(true); setError(null)
    try {
      let blob: Blob
      if (format === 'markdown') blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      else {
        if (!reader.current) return
        const captured = await snapshotExportDocument(reader.current, control.signal, format)
        blob = format === 'png' ? await exportDocumentPNG(captured) : new Blob([standaloneExportHTML(name, captured)], { type: 'text/html;charset=utf-8' })
      }
      control.signal.throwIfAborted(); downloadMessageExport(blob, exportFilename(name, format))
    } catch (e) { if (!control.signal.aborted) setError(e instanceof Error ? e.message : uiAttribute('导出失败，请重试。')) }
    finally { if (!control.signal.aborted) setBusy(false) }
  }
  return <Dialog.Root open={entries !== null} onOpenChange={open => { if (!open) close() }}><Dialog.Portal>
    <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
    <AppDialogContent className="message-export-dialog" width="wide"
      onOpenAutoFocus={() => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
      onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus() }}
      onEscapeKeyDown={event => { if (busy || zoom) { event.preventDefault(); if (zoom) setZoom(null) } }} onInteractOutside={event => { if (busy) event.preventDefault() }}>
      <AppDialogHeader title={uiAttribute('导出预览')} description={uiAttribute('预览并导出选中的消息')} hideDescription closeDisabled={busy} />
      <AppDialogBody className="message-export-body">
        <div className="message-export-title-row">{renaming ? <input autoFocus value={title} maxLength={100} aria-label={uiAttribute('导出标题')} disabled={busy} onChange={e => setCustomTitle(e.target.value)} onBlur={() => setRenaming(false)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setRenaming(false) } }} />
          : <button type="button" className="message-export-title" aria-label={uiAttribute('修改导出标题')} disabled={busy} onClick={() => setRenaming(true)}><span>{name}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 15z" /></svg></button>}</div>
        <div className="message-export-formats" role="group" aria-label={uiAttribute('导出格式')}>
          {(['png', 'html', 'markdown'] as const).map(f => <button key={f} type="button" aria-pressed={f === format} disabled={busy} onClick={() => { setFormat(f); setError(null); setManualCopy(null) }}>{f === 'png' ? uiAttribute('图片 PNG') : f === 'html' ? uiAttribute('网页 HTML') : 'Markdown'}</button>)}
        </div>
        <div className="message-export-options" role="group" aria-label={uiAttribute('包含信息')}>
          {(['avatars', 'authors', 'times', 'recipients'] as const).filter(k => !(k === 'avatars' && format === 'markdown') && !(k === 'recipients' && entries?.every(e => e.excerpt !== undefined))).map(k => <label key={k}><input type="checkbox" checked={options[k]} disabled={busy} onChange={e => setSettings(s => ({ ...s, [format]: { ...s[format], [k]: e.target.checked } }))} />{uiAttribute({ avatars: '头像', authors: '作者', times: '时间', recipients: '发送对象' }[k])}</label>)}
        </div>
        <div className="message-export-preview" tabIndex={0} aria-label={uiAttribute('导出内容预览')}>
          {format === 'markdown' ? <pre className="message-export-markdown">{markdown}</pre> : <MessageExportContext.Provider value={true}>
            <article ref={reader} className="message-export-document" data-export-format={format}><h2>{name}</h2>
              {entries?.map((e, index) => <section className={`message-export-entry${e.message.authorType === 'agent' ? '' : ' is-user'}${options.avatars ? ' has-avatar' : ''}`} key={e.message.id}>
                {options.avatars && (e.message.authorType === 'user'
                  ? <CurrentUserAvatar profile={{ displayName: e.author, avatarDataUrl: e.avatarDataUrl ?? null }} className="local-message-avatar" />
                  : <MemberAvatar agentId={e.message.authorId} avatarRef={e.avatarRef} displayName={e.author} size="list" decorative />)}
                <div className="message-export-stack"><div className="message-export-meta">{options.authors && <strong>{e.author}</strong>}{options.times && exportEntryShowsTime(e, entries[index + 1]) && <time>{new Date(e.message.createdAt).toLocaleString()}</time>}</div>
                  <div className="message-export-bubble" onClickCapture={event => {
                    const target = event.target as Element
                    if (format !== 'html' || (!target.closest('.markdown-code-copy') && !target.closest('a[href^="https://"],a[href^="http://"]'))) { event.preventDefault(); event.stopPropagation() }
                  }}>
                    {e.excerpt !== undefined ? <p className="message-export-excerpt">{e.excerpt}</p> : <>{e.reply && <blockquote>{e.reply}</blockquote>}{renderBody(e.message)}</>}
                  </div>
                  {e.excerpt === undefined && e.message.attachments.map(a => <div key={a.id} onClick={event => { const im = (event.target as Element).closest('img'); if (im && format === 'html') setZoom(im.src) }}><ExportAttachment threadId={threadId} messageId={e.message.id} attachment={a} /></div>)}
                  {e.excerpt === undefined && e.runtimeImages?.map(a => <div key={a.id} onClick={event => { const im = (event.target as Element).closest('img'); if (im && format === 'html') setZoom(im.src) }}><ExportAttachment runtime threadId={threadId} messageId={e.message.id} attachment={{ ...a, kind: 'file', fileCount: null, availability: 'available', previewKind: 'image' }} /></div>)}
                  {e.excerpt === undefined && options.recipients && e.recipients.length > 0 && <div className="message-export-recipients"><UiText zh="发送给" /> {e.recipients.map(n => '@' + n).join('、')}</div>}
                </div>
              </section>)}
            </article>
          </MessageExportContext.Provider>}
        </div>
        {manualCopy && <textarea className="message-export-manual-copy" readOnly value={manualCopy} onFocus={e => e.currentTarget.select()} aria-label={uiAttribute('请选择并复制文本')} />}
        {error && <p className="message-export-error" role="alert">{error}</p>}
      </AppDialogBody>
      <AppDialogFooter leading={<button type="button" className="quiet-button" disabled={busy} onClick={close}><UiText zh="返回调整" /></button>}>
        <button type="button" className="quiet-button message-export-copy" disabled={busy} onClick={() => { void writeClipboardText(markdown).then(ok => { setCopied(ok); if (!ok) { setManualCopy(markdown); setError(uiAttribute('复制失败，请手动复制。')) } }) }}><CopyIcon copied={copied} />{copied ? uiAttribute('已复制') : uiAttribute('复制文本')}</button>
        <button type="button" className="primary-button" disabled={busy} aria-busy={busy} onClick={() => void download()}><ExportGlyph />{busy ? uiAttribute('正在生成…') : uiAttribute('下载 {0}', format === 'markdown' ? 'Markdown' : format.toUpperCase())}</button>
      </AppDialogFooter>
      <Dialog.Root open={zoom !== null} onOpenChange={open => { if (!open) setZoom(null) }}><Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <Dialog.Content className="message-export-zoom" aria-describedby={undefined}>
          <Dialog.Title className="sr-only"><UiText zh="放大图片" /></Dialog.Title>
          <Dialog.Close asChild><button type="button" aria-label={uiAttribute('关闭图片')}><img src={zoom ?? undefined} alt={uiAttribute('放大图片')} /></button></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal></Dialog.Root>
    </AppDialogContent>
  </Dialog.Portal></Dialog.Root>
}
