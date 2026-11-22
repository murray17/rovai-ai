import { BusyLabel } from './BusyLabel'
import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import type { MemberAvatarCrop } from '@contracts'
import { useThreadClient } from './camp-client'
import { normalizeMemberAvatarSource, normalizedMemberAvatarBlob, type NormalizedMemberAvatarSource } from './member-avatar-image'
import { readErrorMessage } from './error-message'
import * as Dialog from '@radix-ui/react-dialog'
import { MemberAvatar } from './MemberAvatar'
import { MemberAvatarCropper } from './MemberAvatarCropper'
import { AppDialogContent, AppDialogHeader, AppDialogBody, AppDialogFooter, AppDialogGlyph, DialogControlIcon } from './AppDialog'
import { BUILTIN_MEMBER_PRESETS } from './member-presets'
import { uiAttribute } from './interface-language'

export function MemberAvatarEditor({ value, open, disabled, returnFocusRef, onChange, onClose, onPendingChange }: {
  value: string | null
  open: boolean
  disabled: boolean
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onChange(value: string | null): void
  onClose(): void
  onPendingChange(pending: boolean): void
}): React.JSX.Element {
  const client = useThreadClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<{ asset: NormalizedMemberAvatarSource; url: string } | null>(null)
  const [crop, setCrop] = useState<MemberAvatarCrop | null>(null)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const presetsId = useId()
  const uploadButton = useRef<HTMLButtonElement>(null)
  const dialogId = useId()
  const attempt = useRef(0)
  useEffect(() => { onPendingChange(busy || Boolean(source)) }, [busy, source, onPendingChange])
  useEffect(() => () => { attempt.current++ }, [])
  useEffect(() => {
    if (!open) { attempt.current++; setSource(null); setCrop(null); setBusy(false); setError(null); setPresetsOpen(false) }
  }, [open])
  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url) }, [source])
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const target = source ? document.getElementById(dialogId)?.querySelector<HTMLElement>('.avatar-crop-stage') : uploadButton.current
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, source])
  const dismiss = () => {
    attempt.current++
    setBusy(false); setSource(null); setCrop(null); setError(null)
    onClose()
  }
  const back = () => { setSource(null); setCrop(null); setError(null) }
  const choose = (ref: string | null): void => { onChange(ref); dismiss() }
  const upload = async (): Promise<void> => {
    if (busy || disabled) return
    const current = ++attempt.current
    setBusy(true); setError(null)
    try {
      const selection = await client.memberAvatars.selectSource()
      if (!selection || attempt.current !== current) return
      const asset = await normalizeMemberAvatarSource(selection)
      if (attempt.current !== current) return
      const url = URL.createObjectURL(normalizedMemberAvatarBlob(asset))
      setCrop({ centerX: .5, centerY: .5, size: 1 })
      setSource({ asset, url })
    } catch (failure) {
      if (attempt.current === current) setError(`${uiAttribute('更换未应用，原头像已保留。')} ${readErrorMessage(failure)}`)
    } finally { if (attempt.current === current) setBusy(false) }
  }
  const confirm = async (): Promise<void> => {
    if (!source || !crop || busy || disabled) return
    const current = ++attempt.current
    setBusy(true); setError(null)
    try {
      // Materialize an immutable file; only the main identity Save commits its
      // reference to the member. Cancellation can never change the Profile.
      const saved = await client.memberAvatars.save({
        kind: 'image', source: source.asset.kind === 'gif' ? source.asset.sourceGif : source.asset.sourcePng,
        sourceWidth: source.asset.width, sourceHeight: source.asset.height, crop
      })
      if (current === attempt.current) choose(saved.avatarRef)
    } catch (failure) {
      if (current === attempt.current) setError(`${uiAttribute('更换未应用，原头像已保留。')} ${readErrorMessage(failure)}`)
    } finally { if (current === attempt.current) setBusy(false) }
  }
  return <Dialog.Root open={open} onOpenChange={next => { if (!next) dismiss() }}>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
      <AppDialogContent id={dialogId} className={`avatar-picker-dialog${source ? ' avatar-cut-dialog' : ''}`} tone="neutral"
        onOpenAutoFocus={event => { event.preventDefault(); uploadButton.current?.focus({ preventScroll: true }) }}
        onCloseAutoFocus={event => {
          event.preventDefault()
          requestAnimationFrame(() => {
            const target = returnFocusRef.current
            if (target?.isConnected) target.focus({ preventScroll: true })
          })
        }}>
        <AppDialogHeader title={uiAttribute(source ? '裁切头像' : '更换头像')}
          description={uiAttribute(source ? '调整头像里显示的部分。' : '上传一张图片作为队员头像，也可以展开预设头像。')}
          hideDescription closeLabel={uiAttribute('关闭')} />
        <AppDialogBody>
          {source && crop ? <MemberAvatarCropper compact sourceUrl={source.url} sourceWidth={source.asset.width} sourceHeight={source.asset.height} value={crop} onChange={setCrop} disabled={busy} /> : <>
            <div className="avatar-picker-upload-area" aria-busy={busy}>
              <span className="avatar-picker-upload-glyph"><AppDialogGlyph name="image" /></span>
              <button ref={uploadButton} className="member-editor-primary avatar-picker-upload" type="button" title={uiAttribute('支持 PNG、JPEG 和 GIF')}
                disabled={disabled || busy}
                aria-busy={busy} onClick={() => void upload()} aria-live="polite">
                <BusyLabel busy={busy}>{uiAttribute('上传头像')}</BusyLabel>
              </button>
            </div>
            <div className="avatar-picker-presets">
              <button className="avatar-picker-preset-toggle" type="button" disabled={disabled || busy} aria-expanded={presetsOpen}
                aria-controls={presetsId} onClick={() => setPresetsOpen(current => !current)}>
                <span>{uiAttribute('使用预设头像')}</span><DialogControlIcon name="chevron" />
              </button>
              <div id={presetsId} className="avatar-picker-options" hidden={!presetsOpen} aria-label={uiAttribute('预设头像')}>
                {BUILTIN_MEMBER_PRESETS.map(preset => <button key={preset.role} className="member-editor-avatar-option" type="button" disabled={disabled || busy}
                  aria-pressed={value === preset.avatarRef} aria-label={preset.displayName} onClick={() => choose(preset.avatarRef)}>
                  <MemberAvatar agentId={preset.role} avatarRef={preset.avatarRef} displayName={preset.displayName} size="picker" decorative />
                  <span>{preset.displayName}</span>
                  {value === preset.avatarRef && <span className="avatar-picker-check"><DialogControlIcon name="check" /></span>}
                </button>)}
              </div>
            </div>
          </>}
          {error && <p className="member-editor-field-error" role="alert">{error}</p>}
        </AppDialogBody>
        {source ? <AppDialogFooter>
          <button className="quiet-button" type="button" disabled={busy} onClick={back}>{uiAttribute('返回')}</button>
          <button className="member-editor-primary" type="button" disabled={disabled || busy || !crop}
            onClick={() => void confirm()}>{uiAttribute('确认头像')}</button>
        </AppDialogFooter> : <AppDialogFooter leading={value && <button className="quiet-button avatar-picker-remove" type="button" disabled={disabled || busy} onClick={() => choose(null)}>{uiAttribute('移除头像')}</button>}>
          <Dialog.Close asChild><button className="quiet-button" type="button">{uiAttribute('取消')}</button></Dialog.Close>
        </AppDialogFooter>}
      </AppDialogContent>
    </Dialog.Portal>
  </Dialog.Root>
}
