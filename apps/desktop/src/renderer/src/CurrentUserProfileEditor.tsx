import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { currentUserDisplayName, currentUserNameError, type CurrentUserProfile, type MemberAvatarCrop } from '@contracts'
import { CurrentUserAvatar, useCurrentUserProfile } from './CurrentUserProfile'
import { useMemberRosterLayout } from './MemberRosterLayout'
import { AppDialogContent, DialogControlIcon } from './AppDialog'
import { MemberAvatarCropper } from './MemberAvatarCropper'
import { defaultAvatarCrop } from './member-avatar-crop'
import { normalizeMemberAvatarSource, deriveMemberAvatarIcon, type NormalizedMemberAvatarSource } from './member-avatar-image'
import { readErrorMessage } from './error-message'

function PictureIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
}

export type CurrentUserProfileEditorHandle = { discard(): void }

export const CurrentUserProfileEditor = forwardRef<CurrentUserProfileEditorHandle, {
  onStateChange(dirty: boolean, busy: boolean): void
}>(function CurrentUserProfileEditor({ onStateChange }, ref) {
  const { profile: saved, ready, error: loadError, reload, save: saveProfile } = useCurrentUserProfile()
  const [draft, setDraft] = useState<CurrentUserProfile>(saved)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [fieldError, setFieldError] = useState('')
  const [imageError, setImageError] = useState('')
  const [readingImage, setReadingImage] = useState(false)
  const [cropBusy, setCropBusy] = useState(false)
  const [cropSource, setCropSource] = useState<(NormalizedMemberAvatarSource & { sourceUrl: string }) | null>(null)
  const [crop, setCrop] = useState<MemberAvatarCrop | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const dirty = draft.displayName !== saved.displayName || draft.avatarDataUrl !== saved.avatarDataUrl
  const busy = status === 'saving' || readingImage || cropBusy
  const disabled = busy || !ready
  const initialized = useRef(false)
  useEffect(() => {
    if (ready && !initialized.current) {
      initialized.current = true
      setDraft(saved)
    }
  }, [ready, saved])
  useEffect(() => { onStateChange(dirty, busy) }, [dirty, busy, onStateChange])
  useEffect(() => () => {
    if (cropSource) URL.revokeObjectURL(cropSource.sourceUrl)
  }, [cropSource])
  const discard = () => {
    setDraft(saved)
    setStatus('idle')
    setFieldError('')
    setImageError('')
    setCropSource(null)
  }
  useImperativeHandle(ref, () => ({ discard }))
  const changeDraft = (patch: Partial<CurrentUserProfile>) => {
    setDraft(prev => ({ ...prev, ...patch }))
    setStatus('idle')
  }
  function validate() {
    const error = currentUserNameError(draft.displayName) ?? ''
    setFieldError(error)
    return !error
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!validate()) { nameInput.current?.focus(); return }
    if (!dirty || disabled) return
    setStatus('saving')
    setImageError('')
    try {
      const next = await saveProfile(draft)
      setDraft(next)
      setStatus('saved')
    } catch (failure) {
      setImageError(readErrorMessage(failure))
      setStatus('error')
    }
  }
  async function loadImage() {
    if (disabled) return
    setImageError('')
    setReadingImage(true)
    try {
      const selection = await window.rovai.memberAvatars.selectSource()
      if (!selection) return
      const normalized = await normalizeMemberAvatarSource(selection)
      const sourceUrl = URL.createObjectURL(new Blob([Uint8Array.from(normalized.sourcePng).buffer], { type: 'image/png' }))
      setCrop(defaultAvatarCrop(normalized.width, normalized.height))
      setCropSource({ ...normalized, sourceUrl })
    } catch (failure) {
      setImageError(readErrorMessage(failure).replaceAll('角色图片', '图片'))
    } finally { setReadingImage(false) }
  }
  function closeCrop() {
    if (cropBusy) return
    setCropSource(null)
  }
  async function applyCrop() {
    if (!cropSource || !crop || cropBusy) return
    setCropBusy(true)
    try {
      const asset = await deriveMemberAvatarIcon(cropSource, crop)
      const reader = new FileReader()
      const data = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(new Blob([Uint8Array.from(asset.iconPng).buffer], { type: 'image/png' }))
      })
      changeDraft({ avatarDataUrl: data })
      setCropSource(null)
    } catch { setImageError('暂时无法处理图片，请重新选择。') }
    finally { setCropBusy(false) }
  }
  return <div className="member-detail-scroll personal-detail-scroll"><div className="member-detail-page">
    <header className="member-detail-header member-editor-member-header personal-detail-header"><div className="member-detail-heading"><CurrentUserAvatar profile={saved} size={50}/><div><h1>个人资料</h1><p>设置你在对话中的头像和名称。</p></div></div></header>
    <section className="member-editor-section profile-section" aria-labelledby="profile-title">
    {!ready && <p className="profile-load-state" role={loadError ? 'alert' : 'status'}>
      {loadError ? `个人资料无法加载：${loadError}` : '正在读取个人资料…'}
      {loadError && <button className="quiet-button compact" onClick={reload}>重新加载</button>}
    </p>}
    <h2 id="profile-title">头像与名称</h2>
    <form onSubmit={save} className="profile-form" noValidate>
      <div className="profile-avatar-row">
        <button className="profile-avatar-button" type="button" onClick={() => void loadImage()} disabled={disabled} aria-label="更换个人头像">
          <CurrentUserAvatar profile={draft} size={64}/>
          <span className="profile-avatar-edit"><PictureIcon/></span>
        </button>
        <div className="profile-avatar-copy">
          <span className="profile-field-label">个人头像</span>
          <div className="profile-avatar-actions">
            <button className="quiet-button compact" type="button" disabled={disabled} onClick={() => void loadImage()}>{readingImage ? '正在读取…' : '更换头像'}</button>
            {draft.avatarDataUrl && <button className="profile-text-button" type="button" disabled={disabled} onClick={() => changeDraft({ avatarDataUrl: null })}>恢复默认</button>}
          </div>
          <small>PNG 或 JPG，至少 256×256 px，最大 10 MB</small>
        </div>
      </div>
      {imageError && <p className="profile-error" role="alert">{imageError}</p>}
      <div className="profile-name-field">
        <label className="profile-field-label" htmlFor="profile-name">名称</label>
        <div className={`profile-name-control ${fieldError ? 'is-invalid' : ''}`}>
          <input id="profile-name" ref={nameInput} value={draft.displayName} placeholder="你" autoComplete="off" disabled={disabled} aria-describedby="profile-name-help profile-name-error" aria-invalid={Boolean(fieldError)} onChange={e => { changeDraft({ displayName: e.target.value }); setFieldError(currentUserNameError(e.target.value) ?? '') }} onBlur={validate}/>
          <span aria-hidden="true">{[...draft.displayName].length}/32</span>
        </div>
        <small id="profile-name-help">默认显示“你”。修改后用于所有对话，清空可恢复默认。</small>
        <p id="profile-name-error" className="profile-error" role={fieldError ? 'alert' : undefined}>{fieldError}</p>
      </div>
      <div className="profile-save-row">
        <span className={status === 'error' ? 'profile-save-state is-error' : 'profile-save-state'} role="status" aria-live="polite">
          {status === 'saving' ? '正在保存…' : status === 'error' ? '保存失败，更改已保留。请重试。' : dirty ? '有未保存的更改' : status === 'saved' ? <><DialogControlIcon name="check"/>已保存</> : '当前资料已保存'}
        </span>
        {dirty && <button className="profile-text-button" type="button" disabled={disabled} onClick={discard}>放弃更改</button>}
        <button className="member-editor-primary member-editor-save" aria-label={status === 'error' ? '重试保存个人资料' : '保存个人资料'} type="submit" disabled={!dirty || disabled || Boolean(fieldError)}><DialogControlIcon name="save"/>{status === 'saving' ? '正在保存…' : status === 'error' ? '重试保存' : '保存'}</button>
      </div>
    </form>
    <Dialog.Root open={Boolean(cropSource)} onOpenChange={open => !open && closeCrop()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay"/>
        <AppDialogContent className="profile-crop-dialog" tone="neutral" aria-describedby="profile-crop-description">
          <div className="profile-crop-heading"><Dialog.Title>调整头像</Dialog.Title><Dialog.Close asChild><button className="profile-text-button profile-icon-close" aria-label="关闭头像裁剪" disabled={cropBusy}><DialogControlIcon name="close"/></button></Dialog.Close></div>
          <Dialog.Description id="profile-crop-description">调整图片位置，让主体落在圆形区域内。</Dialog.Description>
          {cropSource && crop && <MemberAvatarCropper sourceUrl={cropSource.sourceUrl} sourceWidth={cropSource.width} sourceHeight={cropSource.height} value={crop} onChange={setCrop} disabled={cropBusy}/>}
          <div className="profile-crop-footer"><Dialog.Close asChild><button className="quiet-button" type="button" disabled={cropBusy}>取消</button></Dialog.Close><button className="primary-button" type="button" disabled={cropBusy} onClick={() => void applyCrop()}>{cropBusy ? '正在处理…' : '使用此头像'}</button></div>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  </section></div></div>
})


export function CurrentUserRosterEntry({ dirty, selected, onSelect }: { dirty: boolean, selected: boolean, onSelect(): void }) {
  const { profile } = useCurrentUserProfile()
  const { collapsed } = useMemberRosterLayout()
  const displayName = currentUserDisplayName(profile)
  return <div className="personal-roster-entry">
    <button type="button" className={`personal-roster-button ${selected ? 'is-selected' : ''}`} aria-current={selected ? 'page' : undefined} aria-label={`你的资料，${displayName}${dirty ? '，有未保存更改' : ''}`} title={collapsed ? `${displayName} · 你的资料` : undefined} onClick={onSelect}>
      <span className="personal-roster-avatar"><CurrentUserAvatar profile={profile} size={40}/>{dirty && <i className="personal-dirty-dot" aria-hidden="true"/>}</span>
      <span className="personal-roster-copy"><span className="personal-roster-name"><span className="personal-roster-display">{displayName}</span></span><span>个人资料</span></span>
    </button>
  </div>
}
