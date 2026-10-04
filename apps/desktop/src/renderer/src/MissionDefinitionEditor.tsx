import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ButtonHTMLAttributes, type DragEvent, type ReactNode, type RefObject } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { ThreadMessageAttachmentView, LocalAttachmentSourceView, MissionAttachmentDraft } from '@contracts'
import { newCommandId } from '../../shared/command-id'
import { AttachmentCard, ComposerAttachmentStrip } from './AttachmentCard'
import { Icon, TagColorDot, tagStyle } from './MissionControls'
import { NavigationIcon } from './NavigationIcon'
import { dataTransferContainsFiles, droppedAttachmentInputs, type AttachmentPreparationInput } from './attachment-drop'
import {
  FileExtensionLabel,
  UserFileIcon,
  attachmentBaseName,
  attachmentFormatLabel,
  classifyAttachmentDisplay
} from './attachment-presentation'
import { UiText, uiAttribute } from './interface-language'

export type MissionDraftAttachment =
  | { kind: 'stored'; attachment: LocalAttachmentSourceView }
  | { kind: 'local'; id: string; file: File; kindHint: 'file' | 'directory' }

export type MissionWritingPlaneHandle = { chooseFiles(): void }

export function missionAttachmentDrafts(attachments: MissionDraftAttachment[]): MissionAttachmentDraft[] {
  return attachments
    .filter((attachment): attachment is Extract<MissionDraftAttachment, {kind: 'local'}> => attachment.kind === 'local')
    .map(({ id, file, kindHint }) => ({ id, file, kindHint }))
}

export function keptMissionAttachmentIds(attachments: MissionDraftAttachment[]): string[] {
  return attachments
    .filter((attachment): attachment is Extract<MissionDraftAttachment, {kind: 'stored'}> => attachment.kind === 'stored')
    .map(({ attachment }) => attachment.id)
}

export function storedMissionAttachments(attachments: LocalAttachmentSourceView[] | undefined): MissionDraftAttachment[] {
  return (attachments ?? []).map(attachment => ({ kind: 'stored', attachment }))
}

function attachmentIdentity(attachment: MissionDraftAttachment): string {
  return attachment.kind === 'stored'
    ? `stored:${attachment.attachment.id}`
    : `local:${attachment.id}`
}

function LocalImage({ file }: { file: File }): React.JSX.Element {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return <img src={url} alt="" />
}

export function missionLocalAttachmentView(
  attachment: Extract<MissionDraftAttachment, {kind: 'local'}>
): ThreadMessageAttachmentView {
  const directory = attachment.kindHint === 'directory'
  return {
    id: attachment.id,
    displayName: attachment.file.name,
    kind: attachment.kindHint,
    fileCount: directory ? null : 1,
    mediaType: directory ? 'inode/directory' : attachment.file.type || null,
    byteSize: directory ? null : attachment.file.size,
    previewKind: !directory && attachment.file.type.startsWith('image/') ? 'image' : 'none',
    availability: 'unknown'
  }
}

function MissionLocalAttachmentItem({ attachment, disabled, onRemove }: {
  attachment: Extract<MissionDraftAttachment, {kind: 'local'}>
  disabled: boolean
  onRemove(): void
}): React.JSX.Element {
  const view = missionLocalAttachmentView(attachment)
  const display = classifyAttachmentDisplay(view)
  const image = view.previewKind === 'image'
  return <div className={`attachment-card composer-attachment-card${image ? ' composer-image-attachment' : ''}`}>
    <div className="attachment-open" aria-label={view.displayName}>
      {image
        ? <span className="attachment-visual composer-image-preview" aria-hidden="true"><LocalImage file={attachment.file}/></span>
        : <><UserFileIcon type={display.userDisplayType === 'image' ? 'document' : display.userDisplayType}/><span className="attachment-copy"><span className="attachment-title-line"><strong title={view.displayName}>{attachmentBaseName(view.displayName, view.kind)}</strong><FileExtensionLabel>{attachmentFormatLabel(view.displayName, view.kind)}</FileExtensionLabel></span></span></>}
    </div>
    <button type="button" className="attachment-remove" aria-label={uiAttribute("移除附件 {0}", String(view.displayName))} onClick={onRemove} disabled={disabled}>×</button>
  </div>
}

function MissionAttachmentItem({ attachment, mission, disabled, onRemove, onNotify }: {
  attachment: MissionDraftAttachment
  mission?: {threadId: string; missionId: string}
  disabled: boolean
  onRemove(): void
  onNotify(message: string): void
}): React.JSX.Element {
  if (attachment.kind === 'local') {
    return <MissionLocalAttachmentItem attachment={attachment} disabled={disabled} onRemove={onRemove}/>
  }
  if (!mission) return <></>
  return <AttachmentCard attachment={attachment.attachment} locator={{ owner: 'mission', ...mission, attachmentRefId: attachment.attachment.id }} presentation="composer" disabled={disabled} onRemove={onRemove} onNotify={onNotify}/>
}

export const MissionWritingPlane = forwardRef<MissionWritingPlaneHandle, {
  title: string
  description: string
  attachments: MissionDraftAttachment[]
  disabled: boolean
  attachmentsDisabled?: boolean
  titleInputRef?: RefObject<HTMLInputElement | null>
  titleError?: string
  descriptionError?: string
  mission?: {threadId: string; missionId: string}
  onTitleChange(value: string): void
  onDescriptionChange(value: string): void
  onAttachmentsChange(value: MissionDraftAttachment[]): void
  onNotify(message: string): void
}>(({
  title, description, attachments, disabled, attachmentsDisabled = false, titleInputRef, titleError, descriptionError,
  mission, onTitleChange, onDescriptionChange, onAttachmentsChange, onNotify
}, ref) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  useImperativeHandle(ref, () => ({ chooseFiles: () => inputRef.current?.click() }), [])
  const addFiles = (inputs: AttachmentPreparationInput[]): void => {
    if (disabled || attachmentsDisabled || !inputs.length) return
    const existing = new Set(attachments
      .filter((attachment): attachment is Extract<MissionDraftAttachment, {kind: 'local'}> => attachment.kind === 'local')
      .map(({ file }) => `${file.name}:${file.size}:${file.lastModified}`))
    const unique = inputs.filter(({ file }) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`))
    const remaining = 10 - attachments.length
    if (remaining <= 0) { onNotify(uiAttribute('使命附件最多 10 个。')); return }
    const accepted = unique.slice(0, remaining).map(({ file, kindHint }) => ({ kind: 'local' as const, id: newCommandId(), file, kindHint }))
    if (accepted.length) onAttachmentsChange([...attachments, ...accepted])
    if (unique.length > accepted.length) onNotify(uiAttribute('使命附件最多 10 个。'))
    else if (!accepted.length) onNotify(uiAttribute('这些文件已经添加。'))
  }
  const withFiles = (event: DragEvent<HTMLElement>): boolean => dataTransferContainsFiles(event.dataTransfer)
  return <section className="mission-editor-writing-plane"
    onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); addFiles(files.map(file => ({ file, kindHint: 'file' }))) } }}
    onDragEnter={event => { if (!withFiles(event)) return; event.preventDefault(); if (disabled || attachmentsDisabled) return; dragDepth.current += 1; setDragging(true) }}
    onDragOver={event => { if (!withFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = disabled || attachmentsDisabled ? 'none' : 'copy' }}
    onDragLeave={event => { if (!withFiles(event)) return; event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) }}
    onDrop={event => { if (!withFiles(event)) return; event.preventDefault(); dragDepth.current = 0; setDragging(false); addFiles(droppedAttachmentInputs(event.dataTransfer)) }}>
    <label className="sr-only" htmlFor="mission-editor-title"><UiText zh={"使命名称"} /></label>
    <input ref={titleInputRef} id="mission-editor-title" className="mission-editor-title" aria-label={uiAttribute("使命名称")} placeholder={uiAttribute("使命名称")} autoComplete="off" value={title} disabled={disabled} aria-invalid={!!titleError} onChange={event => onTitleChange(event.target.value)}/>
    {!!attachments.length && <ComposerAttachmentStrip ariaLabel={uiAttribute("使命附件，使用左右方向键浏览")}>
      {attachments.map((attachment, index) => <MissionAttachmentItem key={attachmentIdentity(attachment)} attachment={attachment} mission={mission} disabled={disabled || attachmentsDisabled} onNotify={onNotify} onRemove={() => onAttachmentsChange(attachments.filter((_, candidate) => candidate !== index))}/>) }
    </ComposerAttachmentStrip>}
    <label className="sr-only" htmlFor="mission-editor-description"><UiText zh={"使命描述"} /></label>
    <textarea id="mission-editor-description" className="mission-editor-description" aria-label={uiAttribute("使命描述")} placeholder={uiAttribute("告诉队员，这次要完成什么…")} spellCheck={false} value={description} disabled={disabled} aria-invalid={!!descriptionError} onChange={event => onDescriptionChange(event.target.value)}/>
    {(titleError || descriptionError) && <p className="mission-editor-field-error" role="alert">{titleError || descriptionError}</p>}
    {dragging && <div className="mission-editor-drop-overlay"><div><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4"/></svg><span><UiText zh={"松开以添加到使命"} /></span></div></div>}
    <input ref={inputRef} type="file" multiple hidden disabled={disabled || attachmentsDisabled} onChange={event => { addFiles(Array.from(event.target.files ?? []).map(file => ({ file, kindHint: 'file' }))); event.target.value = '' }}/>
  </section>
})
MissionWritingPlane.displayName = 'MissionWritingPlane'

export function MissionAttachmentButton({ onClick, disabled }: {onClick(): void; disabled: boolean}): React.JSX.Element {
  return <button type="button" className="mission-editor-icon-button" aria-label={uiAttribute("添加附件")} title={uiAttribute("添加附件 · 支持粘贴或拖入")} onClick={onClick} disabled={disabled}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8.5 13.5 7-7a3 3 0 0 1 4.25 4.25l-9 9a5 5 0 0 1-7.08-7.08l9-9"/><path d="m16 10-7 7a2 2 0 0 1-2.83-2.83l7-7"/></svg>
  </button>
}

type MissionPropertyChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: ReactNode
  children: ReactNode
  locked?: boolean
}

export const MissionPropertyChip = forwardRef<HTMLButtonElement, MissionPropertyChipProps>(function MissionPropertyChip({ icon, children, locked = false, disabled = false, className = '', onClick, ...buttonProps }, ref) {
  return <button ref={ref} {...buttonProps} type="button" className={`mission-editor-property${locked ? ' is-locked' : ''}${className ? ` ${className}` : ''}`} disabled={disabled || locked} onClick={locked ? undefined : onClick}>
    {icon}<span className="mission-editor-property-copy">{children}</span>{locked && <svg className="mission-editor-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>}
  </button>
})

export function MissionTagPicker({ tags, catalog, disabled, portalContainer, onChange }: {
  tags: string[]
  catalog: string[]
  disabled: boolean
  portalContainer: HTMLElement | null
  onChange(tags: string[]): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const normalized = query.trim().replace(/\s+/g, ' ')
  const all = useMemo(() => [...new Set([...catalog, ...tags])].sort((a, b) => a.localeCompare(b, 'zh-CN')), [catalog, tags])
  const found = all.filter(tag => tag.toLocaleLowerCase().includes(normalized.toLocaleLowerCase()))
  const exact = all.some(tag => tag.toLocaleLowerCase() === normalized.toLocaleLowerCase())
  const tooLong = [...normalized].length > 24
  const toggle = (tag: string): void => onChange(tags.includes(tag) ? tags.filter(candidate => candidate !== tag) : [...tags, tag])
  const create = (): void => {
    if (!normalized || exact || tooLong || tags.length >= 30) return
    onChange([...tags, normalized]); setQuery('')
  }
  const visibleTags = tags.slice(0, 2)
  return <Popover.Root open={open} onOpenChange={value => { setOpen(value); if (!value) setQuery('') }}>
    <Popover.Trigger asChild><MissionPropertyChip className="mission-editor-tag-property" icon={<Icon name="tag"/>} disabled={disabled} aria-label={tags.length ? uiAttribute("标签：{0}", String(tags.join('、'))) : uiAttribute("添加标签")}>{tags.length
      ? <span className="mission-editor-selected-tags">{visibleTags.map(tag => <span className="mission-editor-selected-tag" style={tagStyle(tag)} key={tag}>{tag}</span>)}{tags.length > visibleTags.length && <span className="mission-editor-selected-tag-overflow">+{tags.length - visibleTags.length}</span>}</span>
      : uiAttribute("添加标签")}</MissionPropertyChip></Popover.Trigger>
    <Popover.Portal container={portalContainer}><Popover.Content className="compact-menu mission-editor-tag-popover" align="start" sideOffset={6} collisionPadding={12} onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus() }}>
      <label className="mission-tag-search"><NavigationIcon name="search"/><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} aria-label={uiAttribute("搜索或新建标签")} placeholder={uiAttribute("搜索或新建标签…")} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); create() } }}/></label>
      <div className="mission-tag-options" role="group" aria-label={uiAttribute("可选标签")}>
        {found.map(tag => {
          const selected = tags.includes(tag)
          return <button type="button" className={`compact-option mission-editor-tag-option${selected ? ' is-selected' : ''}`} style={tagStyle(tag)} key={tag} role="checkbox" aria-checked={selected} onClick={() => toggle(tag)}><TagColorDot tag={tag}/><span>{tag}</span>{selected && <Icon name="check"/>}</button>
        })}
        {normalized && !exact && <button type="button" className="compact-option" onClick={create} disabled={tooLong || tags.length >= 30}><Icon name="plus"/><span><UiText zh={"新建“"} />{normalized}”</span></button>}
        {tooLong && <p className="compact-inline-error" role="alert"><UiText zh={"标签最多 24 个字符。"} /></p>}
      </div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}

export function ProjectGlyph(): React.JSX.Element { return <NavigationIcon name="folder-open"/> }
export function TeamGlyph(): React.JSX.Element { return <NavigationIcon name="users"/> }
