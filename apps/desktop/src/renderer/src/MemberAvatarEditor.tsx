import { useEffect, useMemo, useRef, useState } from 'react'
import { parseControlledMemberAvatarRef } from '@contracts'
import { MemberAvatar } from './MemberAvatar'
import { MemberAvatarCropper } from './MemberAvatarCropper'
import { DialogControlIcon } from './AppDialog'
import { BUILTIN_MEMBER_PRESETS } from './member-presets'
import {
  deriveMemberAvatarIcon,
  normalizeMemberAvatarSource
} from './member-avatar-image'
import { defaultAvatarCrop } from './member-avatar-crop'
import { readErrorMessage } from './error-message'
import type { PendingMemberAvatarSource } from './member-avatar-submit'

export function MemberAvatarEditor({
  value,
  open,
  disabled,
  onChange,
  onClose,
  onPendingChange
}: {
  value: string | null
  open: boolean
  disabled: boolean
  onChange(value: string | null): void
  onClose(): void
  onPendingChange(pending: boolean): void
}): React.JSX.Element {
  const [source, setSource] = useState<PendingMemberAvatarSource | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const loaded = useRef<string | null>(null)
  const sourceUrl = useMemo(
    () =>
      source
        ? URL.createObjectURL(
            new Blob([Uint8Array.from(source.sourcePng).buffer], {
              type: 'image/png'
            })
          )
        : null,
    [source?.sourcePng]
  )
  useEffect(
    () => () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    },
    [sourceUrl]
  )
  useEffect(
    () => () => {
      generation.current++
    },
    []
  )
  useEffect(() => {
    onPendingChange(busy || Boolean(source?.needsSave))
  }, [busy, source?.needsSave, onPendingChange])
  useEffect(() => {
    if (
      !open ||
      !value ||
      loaded.current === value ||
      parseControlledMemberAvatarRef(value)?.kind !== 'managed'
    )
      return
    const attempt = ++generation.current
    loaded.current = value
    setBusy(true)
    void window.rovai.memberAvatars
      .read(value, 'portrait')
      .then((image) => {
        if (attempt !== generation.current) return
        if (!image)
          throw new Error('原角色图片不可读取。可以替换图片或移除当前图片。')
        setSource({
          sourcePng: Uint8Array.from(image.bytes),
          width: image.width,
          height: image.height,
          crop: image.crop,
          needsSave: false
        })
      })
      .catch((issue) => {
        if (attempt === generation.current) setError(readErrorMessage(issue))
      })
      .finally(() => {
        if (attempt === generation.current) setBusy(false)
      })
  }, [open, value])
  const chooseImage = async (): Promise<void> => {
    const attempt = ++generation.current
    setBusy(true)
    setError(null)
    try {
      const selected = await window.rovai.memberAvatars.selectSource()
      if (!selected) return
      const normalized = await normalizeMemberAvatarSource(selected)
      if (attempt === generation.current)
        setSource({
          ...normalized,
          crop: defaultAvatarCrop(normalized.width, normalized.height),
          needsSave: true
        })
    } catch (issue) {
      if (attempt === generation.current) setError(readErrorMessage(issue))
    } finally {
      if (attempt === generation.current) setBusy(false)
    }
  }
  const applyCrop = async (): Promise<void> => {
    if (!source || busy) return
    const attempt = ++generation.current
    setBusy(true)
    setError(null)
    try {
      const asset = await deriveMemberAvatarIcon(source, source.crop)
      const persisted = await window.rovai.memberAvatars.save({
        sourcePng: asset.sourcePng,
        iconPng: asset.iconPng,
        sourceWidth: asset.width,
        sourceHeight: asset.height,
        crop: asset.crop
      })
      if (attempt !== generation.current) return
      loaded.current = persisted.avatarRef
      setSource(null)
      onChange(persisted.avatarRef)
      onClose()
    } catch (issue) {
      if (attempt === generation.current) setError(readErrorMessage(issue))
    } finally {
      if (attempt === generation.current) setBusy(false)
    }
  }
  const choose = (ref: string | null): void => {
    generation.current++
    loaded.current = null
    setSource(null)
    setError(null)
    onChange(ref)
  }
  return (
    <div
      className="member-editor-avatar-editor"
      hidden={!open}
      aria-label="页内角色图片编辑"
    >
      <div className="member-editor-subheading">
        <span>角色图片</span>
        <button
          className="member-editor-icon-button"
          type="button"
          aria-label="收起角色图片编辑"
          disabled={busy}
          onClick={onClose}
        >
          <DialogControlIcon name="close" />
        </button>
      </div>
      <div className="member-editor-avatar-options">
        {BUILTIN_MEMBER_PRESETS.map((preset) => (
          <button
            key={preset.role}
            type="button"
            className="member-editor-avatar-option"
            aria-label={`使用${preset.displayName}的角色图片`}
            aria-pressed={value === preset.avatarRef}
            disabled={disabled || busy}
            onClick={() => choose(preset.avatarRef)}
          >
            <MemberAvatar
              agentId={preset.role}
              avatarRef={preset.avatarRef}
              displayName={preset.displayName}
              size="picker"
              decorative
            />
            <span>{preset.displayName}</span>
          </button>
        ))}
        <div className="member-editor-avatar-upload">
          <button
            type="button"
            className="member-editor-secondary"
            disabled={disabled || busy}
            onClick={() => void chooseImage()}
          >
            {busy ? '正在处理…' : '上传图片'}
          </button>
          <small>PNG / JPEG · 最大 10 MiB</small>
        </div>
      </div>
      {source && sourceUrl && (
        <div className="member-editor-crop">
          <MemberAvatarCropper
            sourceUrl={sourceUrl}
            sourceWidth={source.width}
            sourceHeight={source.height}
            value={source.crop}
            disabled={disabled || busy}
            onChange={(crop) => setSource({ ...source, crop, needsSave: true })}
          />
          <div className="member-editor-crop-actions">
            <button
              type="button"
              className="member-editor-cancel"
              disabled={busy}
              onClick={() => setSource(null)}
            >
              取消裁剪
            </button>
            <button
              type="button"
              className="member-editor-secondary"
              disabled={disabled || busy}
              onClick={() => void applyCrop()}
            >
              使用这张图片
            </button>
          </div>
        </div>
      )}
      {value && !source && (
        <button
          className="member-editor-text-button"
          type="button"
          disabled={disabled || busy}
          onClick={() => choose(null)}
        >
          移除角色图片
        </button>
      )}
      {error && (
        <p className="member-editor-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
