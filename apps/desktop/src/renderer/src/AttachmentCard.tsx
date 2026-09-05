import { useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { CampMessageAttachmentView, LocalAttachmentAvailability, LocalAttachmentOwnerLocator } from '@contracts'
import { useOptionalFilePreview } from './FilePreviewContext'
import { formatByteSize } from './ui-model'
import {
  AgentArtifactIcon, FileExtensionLabel, UserFileIcon,
  attachmentBaseName, attachmentFormatLabel, classifyAttachmentDisplay
} from './attachment-presentation'

type AttachmentKind = 'file' | 'directory'

export function attachmentRevealLabel(platform: NodeJS.Platform): string {
  return platform === 'darwin'
    ? '在 Finder 中显示'
    : platform === 'win32'
      ? '在文件资源管理器中显示'
      : '显示所在位置'
}

function AttachmentFolderGlyph(): JSX.Element {
  return (
    <svg className="attachment-folder-glyph" viewBox="0 0 24 24">
      <path className="fill" d="M3.8 7.2c0-1.1.9-2 2-2h4l2 2.1h6.5c1.1 0 2 .9 2 2v7.4c0 1.1-.9 2-2 2H5.8c-1.1 0-2-.9-2-2Z" />
      <path d="M3.8 8.2V7.1c0-1 .8-1.8 1.8-1.8h4.1l2.1 2.1h6.4c1.1 0 2 .9 2 2v7.3c0 1.1-.9 2-2 2H5.8c-1.1 0-2-.9-2-2V8.2Z" />
    </svg>
  )
}

function localAttachmentLocatorKey(locator: LocalAttachmentOwnerLocator): string {
  if (locator.owner === 'composer') {
    return `composer:${locator.campId}:${locator.attachmentRefId}`
  }
  if (locator.owner === 'message') {
    return `message:${locator.campId}:${locator.messageId}:${locator.attachmentRefId}`
  }
  if (locator.owner === 'pending') {
    return `pending:${locator.campId}:${locator.pendingInputId}:${locator.attachmentRefId}`
  }
  if (locator.owner === 'pending_edit') {
    return `pending-edit:${locator.campId}:${locator.pendingInputId}:${locator.editToken}:${locator.attachmentRefId}`
  }
  if (locator.owner === 'single_chat_composer') {
    return `single-chat-composer:${locator.campId}:${locator.conversationId}:${locator.attachmentRefId}`
  }
  if (locator.owner === 'single_chat_message') {
    return `single-chat-message:${locator.campId}:${locator.conversationId}:${locator.conversationMessageId}:${locator.attachmentRefId}`
  }
  if (locator.owner === 'single_chat_pending') {
    return `single-chat-pending:${locator.campId}:${locator.conversationId}:${locator.pendingInputId}:${locator.attachmentRefId}`
  }
  return `single-chat-pending-edit:${locator.campId}:${locator.conversationId}:${locator.pendingInputId}:${locator.editToken}:${locator.attachmentRefId}`
}

export function AttachmentCard({
  attachment,
  onRemove,
  locator,
  onNotify = () => undefined,
  disabled = false,
  menuItems,
  presentation = 'composer'
}: {
  attachment: CampMessageAttachmentView
  onRemove?: () => void
  locator: LocalAttachmentOwnerLocator
  onNotify?: (message: string) => void
  disabled?: boolean
  menuItems?: ReactNode
  presentation?: 'composer' | 'user-timeline' | 'agent-timeline'
}): JSX.Element {
  const filePreview = useOptionalFilePreview()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [attachmentAction, setAttachmentAction] = useState<'open' | 'reveal' | null>(null)
  const [availability, setAvailability] = useState<LocalAttachmentAvailability>(attachment.availability)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [contextAnchor, setContextAnchor] = useState({ x: 0, y: 0 })
  const attachmentButtonRef = useRef<HTMLButtonElement>(null)
  const locatorRef = useRef(locator)
  locatorRef.current = locator
  const timeline = presentation !== 'composer'
  const interactive = timeline || Boolean(menuItems)
  const agentPresentation = presentation === 'agent-timeline'
  const composerImage = presentation === 'composer' && attachment.previewKind === 'image'
  const displayClassification = classifyAttachmentDisplay(attachment)
  const baseName = attachmentBaseName(attachment.displayName, attachment.kind)
  const formatLabel = attachmentFormatLabel(attachment.displayName, attachment.kind)
  const rendererPlatform = typeof window === 'undefined' ? 'darwin' : window.rovai.platform
  const locatorKey = localAttachmentLocatorKey(locator)
  useEffect(() => {
    if (attachment.previewKind !== 'image') return
    if (timeline && attachment.availability === 'unknown') return
    let active = true
    let objectUrl: string | null = null
    void window.rovai.composerAttachments.preview(locatorRef.current)
      .then((result) => {
        if (active) setAvailability(result.availability)
        if (!active || !result.preview) {
          if (active) setPreviewFailed(true)
          return
        }
        const preview = result.preview
        objectUrl = URL.createObjectURL(new Blob(
          [Uint8Array.from(preview.bytes).buffer],
          { type: preview.mediaType }
        ))
        setPreviewUrl(objectUrl)
      })
      .catch(() => {
        if (active) setPreviewFailed(true)
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment.availability, attachment.id, attachment.previewKind, locatorKey, timeline])

  const runAttachmentAction = async (
    action: 'open' | 'reveal',
    forceSystem = false
  ): Promise<void> => {
    if (!interactive || disabled || attachmentAction) return
    setAttachmentAction(action)
    try {
      if (action === 'open') {
        if (!forceSystem && attachment.kind === 'file' && filePreview) {
          const outcome = await filePreview.open({
            kind: 'attachment',
            campId: locator.campId,
            locator
          }, undefined, { fileName: attachment.displayName })
          if (outcome.kind === 'error') {
            if (outcome.error.code === 'attachment_missing') setAvailability('missing')
            else if (outcome.error.code === 'attachment_unreadable') setAvailability('unreadable')
            else if (outcome.error.code === 'attachment_kind_changed') setAvailability('kind_changed')
            onNotify(outcome.error.message)
          } else setAvailability('available')
          return
        }
        const result = await window.rovai.attachments.open(locator)
        setAvailability(result.availability)
        if (result.error === 'target_unavailable') onNotify('此附件当前不可用')
        else if (result.error) onNotify('无法使用系统应用打开此附件')
      } else {
        const result = await window.rovai.attachments.reveal(locator)
        setAvailability(result.availability)
        if (result.error === 'target_unavailable') onNotify('此附件当前不可用')
        else if (result.error) {
          onNotify(rendererPlatform === 'darwin'
            ? '无法在 Finder 中显示此附件'
            : rendererPlatform === 'win32'
              ? '无法在文件资源管理器中显示此附件'
              : '无法显示此附件所在位置')
        }
      }
    } catch {
      onNotify(action === 'open'
        ? '无法使用系统应用打开此附件'
        : '无法显示此附件所在位置')
    } finally {
      setAttachmentAction(null)
    }
  }

  const revealLabel = attachmentRevealLabel(rendererPlatform)
  const systemOpenLabel = attachment.kind === 'directory'
    ? '打开文件夹'
    : '使用系统应用打开'
  const hasImagePreview = attachment.previewKind === 'image' && previewUrl !== null
  const showAttachmentContextMenu = (x: number, y: number): void => {
    setContextAnchor({ x, y })
    setContextMenuOpen(true)
  }
  const showAttachmentKeyboardMenu = (): void => {
    const bounds = attachmentButtonRef.current?.getBoundingClientRect()
    showAttachmentContextMenu(bounds?.left ?? 8, bounds?.bottom ?? 8)
  }

  const availabilityLabel = availability === 'missing'
    ? '文件已不可用'
    : availability === 'unreadable'
      ? '文件无法读取'
      : availability === 'kind_changed'
        ? '文件类型已变化'
        : null

  const detailLabel = availabilityLabel ?? (agentPresentation
    ? attachment.kind === 'directory'
      ? `${attachment.fileCount === null ? '文件数未知' : `${attachment.fileCount} 个文件`} · ${attachment.byteSize === null ? '大小未知' : formatByteSize(attachment.byteSize)}`
      : `${attachmentTypeLabel(attachment.mediaType)} · ${attachment.byteSize === null ? '大小未知' : formatByteSize(attachment.byteSize)}`
    : null)

  const content = composerImage
    ? (
        <span className="attachment-visual composer-image-preview" aria-hidden="true">
          {previewUrl
            ? <img src={previewUrl} alt="" />
            : !previewFailed ? <i className="attachment-loading" /> : <b>!</b>}
        </span>
      )
    : (
        <>
          {agentPresentation
            ? <AgentArtifactIcon type={displayClassification.agentDisplayType} />
            : (
                <UserFileIcon
                  type={displayClassification.userDisplayType === 'image'
                    ? 'document'
                    : displayClassification.userDisplayType}
                />
              )}
          <span className="attachment-copy">
            <span className="attachment-title-line">
              <strong title={attachment.displayName}>{baseName}</strong>
              <FileExtensionLabel>{formatLabel}</FileExtensionLabel>
            </span>
            {detailLabel && <small>{detailLabel}</small>}
          </span>
          {agentPresentation && (
            <span className="agent-file-open-cue" aria-hidden="true">
              <svg viewBox="0 0 18 18">
                <path d="M10.3 3.3h4.4v4.4M14.5 3.5 8.6 9.4" />
                <path d="M13.5 9.5v4.3H3.8v-9.7h4.3" />
              </svg>
              <span>打开</span>
            </span>
          )}
        </>
      )

  return (
    <div
      className={`attachment-card ${presentation === 'composer' ? 'composer-attachment-card' : presentation} ${composerImage ? 'composer-image-attachment' : ''} type-${displayClassification.agentDisplayType} ${availabilityLabel ? `attachment-availability-${availability}` : ''}`}
      aria-label={availabilityLabel ? `${attachment.displayName}：${availabilityLabel}` : undefined}
      data-context-open={contextMenuOpen ? 'true' : undefined}
      onContextMenu={interactive && !disabled
        ? (event) => {
            event.preventDefault()
            if (event.clientX === 0 && event.clientY === 0) showAttachmentKeyboardMenu()
            else showAttachmentContextMenu(event.clientX, event.clientY)
          }
        : undefined}
    >
      {interactive
        ? (
            <>
              <button
                className={`attachment-open ${hasImagePreview ? 'is-preview' : ''}`}
                type="button"
                aria-busy={attachmentAction !== null}
                aria-label={hasImagePreview
                  ? `预览附件 ${attachment.displayName}`
                  : attachment.kind === 'file' && filePreview
                    ? `打开文件预览 ${attachment.displayName}`
                    : `${systemOpenLabel} ${attachment.displayName}`}
                disabled={disabled || attachmentAction !== null}
                onClick={() => {
                  if (!timeline && hasImagePreview) setPreviewOpen(true)
                  else if (attachment.kind === 'file' && filePreview) void runAttachmentAction('open')
                  else if (hasImagePreview) setPreviewOpen(true)
                  else void runAttachmentAction('open')
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
                  event.preventDefault()
                  showAttachmentKeyboardMenu()
                }}
                ref={attachmentButtonRef}
              >
                {content}
                {attachmentAction && <i className="attachment-action-loading" aria-hidden="true" />}
              </button>
              <DropdownMenu.Root open={contextMenuOpen} onOpenChange={setContextMenuOpen}>
                <DropdownMenu.Trigger asChild>
                  <span
                    className="attachment-context-anchor"
                    style={{ left: contextAnchor.x, top: contextAnchor.y }}
                  />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="attachment-context-menu"
                    aria-label={`附件操作：${attachment.displayName}`}
                    align="start"
                    side="right"
                    sideOffset={4}
                    collisionPadding={8}
                    loop
                    onCloseAutoFocus={(event) => {
                      event.preventDefault()
                      attachmentButtonRef.current?.focus()
                    }}
                  >
                    <DropdownMenu.Label className="attachment-context-menu-label">
                      <strong>{attachment.displayName}</strong>
                      <small>{attachment.kind === 'directory' ? '文件夹' : attachmentTypeLabel(attachment.mediaType)}</small>
                    </DropdownMenu.Label>
                    <DropdownMenu.Item
                      className="attachment-context-menu-item"
                      disabled={disabled || attachmentAction !== null}
                      onSelect={() => void runAttachmentAction('open', true)}
                    >
                      <AttachmentOpenGlyph kind={attachment.kind} />
                      <span>{systemOpenLabel}</span>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="attachment-context-menu-separator" />
                    <DropdownMenu.Item
                      className="attachment-context-menu-item"
                      disabled={disabled || attachmentAction !== null}
                      onSelect={() => void runAttachmentAction('reveal')}
                    >
                      <AttachmentRevealGlyph />
                      <span>{revealLabel}</span>
                    </DropdownMenu.Item>
                    {menuItems && <>
                      <DropdownMenu.Separator className="attachment-context-menu-separator" />
                      {menuItems}
                    </>}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </>
          )
        : hasImagePreview
          ? (
              <button
                className="attachment-open is-preview"
                type="button"
                aria-label={`预览附件 ${attachment.displayName}`}
                disabled={disabled}
                onClick={() => setPreviewOpen(true)}
              >
                {content}
              </button>
            )
          : <div className="attachment-open">{content}</div>}
      {hasImagePreview && (
            <Dialog.Root open={previewOpen} onOpenChange={setPreviewOpen}>
              <Dialog.Portal>
                <Dialog.Overlay className="attachment-lightbox-overlay" />
                <Dialog.Content className="attachment-lightbox" aria-describedby={undefined}>
                  <Dialog.Title>{attachment.displayName}</Dialog.Title>
                  <img src={previewUrl} alt={attachment.displayName} />
                  <Dialog.Close className="attachment-lightbox-close" aria-label="关闭附件预览">×</Dialog.Close>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
      )}
      {onRemove && (
        <button
          className="attachment-remove"
          type="button"
          aria-label={`移除附件 ${attachment.displayName}`}
          disabled={disabled}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </div>
  )
}

function AttachmentOpenGlyph({ kind }: { kind: 'file' | 'directory' }): JSX.Element {
  return kind === 'directory'
    ? (
        <svg className="attachment-menu-icon" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M2.8 5.8h4l1.5 1.7h6.9v6.7H2.8z" />
          <path d="M2.8 7.5V4.8h4.4l1.3 1.5" />
        </svg>
      )
    : (
        <svg className="attachment-menu-icon" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M3.4 3.2h7.2l4 4v7.6H3.4z" />
          <path d="M10.6 3.2v4h4M6.2 11.1h5.7M9.7 8.8l2.2 2.3-2.2 2.2" />
        </svg>
      )
}

function AttachmentRevealGlyph(): JSX.Element {
  return (
    <svg className="attachment-menu-icon" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M2.8 5.8h4l1.5 1.7h6.9v6.7H2.8z" />
      <circle cx="11.9" cy="11.2" r="2.1" />
      <path d="m13.4 12.7 1.8 1.8" />
    </svg>
  )
}

export function ComposerAttachmentStrip({ children }: { children: ReactNode }): JSX.Element {
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const onWheel = (event: WheelEvent): void => scrollAttachmentStripOnWheel(strip, event)
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => strip.removeEventListener('wheel', onWheel)
  }, [])
  return (
    <div
      className="composer-attachment-strip"
      role="group"
      aria-label="待发送附件，使用左右方向键浏览"
      tabIndex={0}
      onKeyDown={scrollAttachmentStripOnKeyDown}
      ref={stripRef}
    >
      {children}
    </div>
  )
}

function scrollAttachmentStripOnKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
  const strip = event.currentTarget
  const step = Math.max(144, Math.round(strip.clientWidth * 0.64))
  if (event.key === 'ArrowLeft') strip.scrollBy({ left: -step })
  else if (event.key === 'ArrowRight') strip.scrollBy({ left: step })
  else if (event.key === 'Home') strip.scrollTo({ left: 0 })
  else if (event.key === 'End') strip.scrollTo({ left: strip.scrollWidth })
  else return
  event.preventDefault()
}

function scrollAttachmentStripOnWheel(strip: HTMLDivElement, event: WheelEvent): void {
  if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || event.deltaY === 0) return
  const nextScrollLeft = Math.max(0, Math.min(
    strip.scrollWidth - strip.clientWidth,
    strip.scrollLeft + event.deltaY
  ))
  if (nextScrollLeft === strip.scrollLeft) return
  strip.scrollLeft = nextScrollLeft
  event.preventDefault()
}

export function AttachmentPlaceholder({
  name,
  kind,
  state,
  detail,
  onRemove
}: {
  name: string
  kind: AttachmentKind
  state: 'preparing' | 'error'
  detail?: string
  onRemove?: () => void
}): JSX.Element {
  return (
    <div className={`attachment-card composer-attachment-card attachment-${state}`}>
      <span className="attachment-visual" aria-hidden="true">
        {kind === 'directory'
          ? (
              <span className="attachment-folder-state">
                <AttachmentFolderGlyph />
                {state === 'preparing'
                  ? <i className="attachment-loading" />
                  : <b>!</b>}
              </span>
            )
          : state === 'preparing' ? <i className="attachment-loading" /> : '!'}
      </span>
      <span className="attachment-copy">
        <strong title={name}>{name}</strong>
        <small title={detail}>
          {state === 'preparing'
            ? kind === 'directory' ? '正在添加文件夹…' : '正在添加…'
            : detail ?? '附件处理失败'}
        </small>
      </span>
      {onRemove && (
        <button className="attachment-remove" type="button" aria-label={`移除失败附件 ${name}`} onClick={onRemove}>×</button>
      )}
    </div>
  )
}

function attachmentTypeLabel(mediaType: string | null): string {
  if (!mediaType) return '文件'
  if (mediaType === 'inode/directory') return '文件夹'
  if (mediaType.startsWith('image/')) return '图片'
  if (mediaType === 'application/pdf') return 'PDF'
  if (mediaType.includes('zip')) return '压缩文件'
  if (mediaType.startsWith('text/')) return '文本'
  return '文件'
}
