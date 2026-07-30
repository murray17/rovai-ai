import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent
} from 'react'
import type { MemberAvatarCrop } from '@contracts'
import {
  avatarCropSizeFromZoomPercent,
  avatarCropSourceResolution,
  avatarCropToStageTransform,
  avatarCropZoomPercent,
  clampAvatarCrop,
  defaultAvatarCrop,
  isAvatarCropLowResolution,
  moveAvatarCropFromStageDrag,
  nudgeAvatarCrop,
  resizeAvatarCrop
} from './member-avatar-crop'

export type MemberAvatarCropperProps = {
  sourceUrl: string
  sourceWidth: number
  sourceHeight: number
  value: MemberAvatarCrop
  onChange(next: MemberAvatarCrop): void
  disabled?: boolean
}

const PREVIEW_SIZES = [28, 32, 34, 44] as const
const INITIAL_STAGE_SIZE = 320

export function MemberAvatarCropper({
  sourceUrl,
  sourceWidth,
  sourceHeight,
  value,
  onChange,
  disabled = false
}: MemberAvatarCropperProps): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const instructionsId = useId()
  const [stageSize, setStageSize] = useState(INITIAL_STAGE_SIZE)
  const crop = useMemo(
    () => clampAvatarCrop(value, sourceWidth, sourceHeight),
    [sourceHeight, sourceWidth, value]
  )
  const transform = useMemo(
    () => avatarCropToStageTransform(crop, sourceWidth, sourceHeight, stageSize),
    [crop, sourceHeight, sourceWidth, stageSize]
  )
  const cropResolution = avatarCropSourceResolution(crop, sourceWidth, sourceHeight)
  const lowResolution = isAvatarCropLowResolution(crop, sourceWidth, sourceHeight)
  const zoomPercent = avatarCropZoomPercent(crop)

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = (): void => {
      const next = stage.getBoundingClientRect().width
      if (Number.isFinite(next) && next > 0) setStageSize(next)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const cancelDrag = (): void => {
      drag.current = null
    }
    window.addEventListener('blur', cancelDrag)
    return () => window.removeEventListener('blur', cancelDrag)
  }, [])

  const beginDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  }

  const continueDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (disabled || !current || current.pointerId !== event.pointerId) return
    const deltaX = event.clientX - current.x
    const deltaY = event.clientY - current.y
    drag.current = { ...current, x: event.clientX, y: event.clientY }
    onChange(
      moveAvatarCropFromStageDrag(
        crop,
        deltaX,
        deltaY,
        sourceWidth,
        sourceHeight,
        stageSize
      )
    )
  }

  const finishDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const changeZoom = (percent: number): void => {
    onChange(
      resizeAvatarCrop(
        crop,
        avatarCropSizeFromZoomPercent(percent),
        sourceWidth,
        sourceHeight
      )
    )
  }

  const wheelZoom = (event: WheelEvent<HTMLDivElement>): void => {
    if (disabled) return
    event.preventDefault()
    const multiplier = Math.exp(event.deltaY * 0.0012)
    onChange(
      resizeAvatarCrop(
        crop,
        crop.size * multiplier,
        sourceWidth,
        sourceHeight
      )
    )
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    const step = event.shiftKey ? 0.04 : 0.01
    let deltaX = 0
    let deltaY = 0
    if (event.key === 'ArrowLeft') deltaX = -step
    else if (event.key === 'ArrowRight') deltaX = step
    else if (event.key === 'ArrowUp') deltaY = -step
    else if (event.key === 'ArrowDown') deltaY = step
    else return
    event.preventDefault()
    onChange(
      nudgeAvatarCrop(crop, deltaX, deltaY, sourceWidth, sourceHeight)
    )
  }

  return (
    <section className="avatar-crop-editor" aria-label="设置小头像取景">
      <div
        ref={stageRef}
        className="avatar-crop-stage"
        tabIndex={disabled ? -1 : 0}
        aria-label="小头像取景。拖动图片调整位置，使用方向键微调；按住 Shift 可加速。"
        aria-describedby={instructionsId}
        aria-disabled={disabled}
        onPointerDown={beginDrag}
        onPointerMove={continueDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={() => {
          drag.current = null
        }}
        onWheel={wheelZoom}
        onKeyDown={handleKeyDown}
      >
        <img
          src={sourceUrl}
          alt=""
          draggable={false}
          style={{
            width: sourceWidth,
            height: sourceHeight,
            transformOrigin: '0 0',
            transform: `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale})`
          }}
        />
        <span className="avatar-crop-safe-area" aria-hidden="true" />
        <span className="avatar-crop-frame" aria-hidden="true" />
      </div>
      <p id={instructionsId} className="avatar-crop-instructions">
        拖动图片定位；方向键微调 1%，Shift + 方向键微调 4%。
      </p>

      <div className="avatar-crop-controls">
        <label className="avatar-crop-zoom">
          <span>缩放</span>
          <input
            type="range"
            min="0"
            max="100"
            value={zoomPercent}
            disabled={disabled}
            aria-label="小头像放大倍率"
            aria-valuetext={`${zoomPercent}% 放大`}
            onChange={(event) => changeZoom(Number(event.target.value))}
          />
          <output>{zoomPercent}%</output>
        </label>
        <button
          className="quiet-button compact"
          type="button"
          disabled={disabled}
          onClick={() => onChange(defaultAvatarCrop(sourceWidth, sourceHeight))}
        >
          重置取景
        </button>
      </div>

      <div className="avatar-crop-previews" aria-label="小头像实际尺寸预览">
        {PREVIEW_SIZES.map((size) => (
          <AvatarCropPreview
            key={size}
            size={size}
            sourceUrl={sourceUrl}
            sourceWidth={sourceWidth}
            sourceHeight={sourceHeight}
            crop={crop}
          />
        ))}
      </div>

      <p
        className={lowResolution ? 'avatar-crop-quality attention' : 'avatar-crop-quality'}
      >
        取景源分辨率约 {cropResolution}×{cropResolution}px。
        {lowResolution
          ? ' 小尺寸头像可能模糊，建议降低放大倍率或换用更清晰的图片。'
          : ' 适合生成紧凑头像。'}
      </p>
    </section>
  )
}

function AvatarCropPreview({
  size,
  sourceUrl,
  sourceWidth,
  sourceHeight,
  crop
}: {
  size: number
  sourceUrl: string
  sourceWidth: number
  sourceHeight: number
  crop: MemberAvatarCrop
}): React.JSX.Element {
  const transform = avatarCropToStageTransform(
    crop,
    sourceWidth,
    sourceHeight,
    size
  )
  return (
    <figure>
      <span
        className="avatar-crop-preview"
        style={{
          width: size,
          height: size,
          borderRadius: '50%'
        }}
      >
        <img
          src={sourceUrl}
          alt=""
          draggable={false}
          style={{
            width: sourceWidth,
            height: sourceHeight,
            transformOrigin: '0 0',
            transform: `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale})`
          }}
        />
      </span>
      <figcaption>{size}px</figcaption>
    </figure>
  )
}
