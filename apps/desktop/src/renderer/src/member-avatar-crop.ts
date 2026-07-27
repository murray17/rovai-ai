import {
  clampControlledMemberAvatarCrop,
  type MemberAvatarCrop
} from '@contracts'

export type PixelCropRect = {
  x: number
  y: number
  size: number
}

export type CropStageTransform = {
  scale: number
  translateX: number
  translateY: number
}

export const MIN_AVATAR_CROP_SIZE = 0.12
export const MAX_AVATAR_CROP_SIZE = 1
export const DEFAULT_AVATAR_CROP: Readonly<MemberAvatarCrop> = {
  centerX: 0.5,
  centerY: 0.38,
  size: 0.72
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite positive number`)
  }
}

export function validateAvatarCrop(crop: MemberAvatarCrop): void {
  if (
    !Number.isFinite(crop.centerX)
    || !Number.isFinite(crop.centerY)
    || !Number.isFinite(crop.size)
  ) {
    throw new Error('Avatar crop values must be finite numbers')
  }
}

export function clampAvatarCrop(
  input: MemberAvatarCrop,
  sourceWidth: number,
  sourceHeight: number
): MemberAvatarCrop {
  return clampControlledMemberAvatarCrop(input, sourceWidth, sourceHeight)
}

export function defaultAvatarCrop(
  sourceWidth: number,
  sourceHeight: number
): MemberAvatarCrop {
  return clampAvatarCrop({ ...DEFAULT_AVATAR_CROP }, sourceWidth, sourceHeight)
}

export function avatarCropToPixels(
  crop: MemberAvatarCrop,
  sourceWidth: number,
  sourceHeight: number
): PixelCropRect {
  const safe = clampAvatarCrop(crop, sourceWidth, sourceHeight)
  const size = safe.size * Math.min(sourceWidth, sourceHeight)
  return {
    x: safe.centerX * sourceWidth - size / 2,
    y: safe.centerY * sourceHeight - size / 2,
    size
  }
}

export function avatarCropToStageTransform(
  crop: MemberAvatarCrop,
  sourceWidth: number,
  sourceHeight: number,
  stageSize: number
): CropStageTransform {
  assertFinitePositive(stageSize, 'Crop stage size')
  const safe = clampAvatarCrop(crop, sourceWidth, sourceHeight)
  const cropEdge = safe.size * Math.min(sourceWidth, sourceHeight)
  const scale = stageSize / cropEdge
  return {
    scale,
    translateX: stageSize / 2 - safe.centerX * sourceWidth * scale,
    translateY: stageSize / 2 - safe.centerY * sourceHeight * scale
  }
}

export function moveAvatarCropFromStageDrag(
  crop: MemberAvatarCrop,
  pointerDeltaX: number,
  pointerDeltaY: number,
  sourceWidth: number,
  sourceHeight: number,
  stageSize: number
): MemberAvatarCrop {
  if (!Number.isFinite(pointerDeltaX) || !Number.isFinite(pointerDeltaY)) {
    throw new Error('Pointer deltas must be finite numbers')
  }
  const transform = avatarCropToStageTransform(
    crop,
    sourceWidth,
    sourceHeight,
    stageSize
  )
  return clampAvatarCrop(
    {
      ...crop,
      centerX: crop.centerX - pointerDeltaX / (transform.scale * sourceWidth),
      centerY: crop.centerY - pointerDeltaY / (transform.scale * sourceHeight)
    },
    sourceWidth,
    sourceHeight
  )
}

export function nudgeAvatarCrop(
  crop: MemberAvatarCrop,
  deltaX: number,
  deltaY: number,
  sourceWidth: number,
  sourceHeight: number
): MemberAvatarCrop {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    throw new Error('Avatar crop nudge must use finite numbers')
  }
  return clampAvatarCrop(
    {
      ...crop,
      centerX: crop.centerX + deltaX,
      centerY: crop.centerY + deltaY
    },
    sourceWidth,
    sourceHeight
  )
}

export function resizeAvatarCrop(
  crop: MemberAvatarCrop,
  nextSize: number,
  sourceWidth: number,
  sourceHeight: number
): MemberAvatarCrop {
  if (!Number.isFinite(nextSize)) {
    throw new Error('Avatar crop size must be a finite number')
  }
  return clampAvatarCrop({ ...crop, size: nextSize }, sourceWidth, sourceHeight)
}

export function avatarCropSourceResolution(
  crop: MemberAvatarCrop,
  sourceWidth: number,
  sourceHeight: number
): number {
  return Math.round(avatarCropToPixels(crop, sourceWidth, sourceHeight).size)
}

export function isAvatarCropLowResolution(
  crop: MemberAvatarCrop,
  sourceWidth: number,
  sourceHeight: number,
  minimum = 256
): boolean {
  assertFinitePositive(minimum, 'Minimum crop resolution')
  return avatarCropSourceResolution(crop, sourceWidth, sourceHeight) < minimum
}

export function avatarCropZoomPercent(crop: MemberAvatarCrop): number {
  validateAvatarCrop(crop)
  const safeSize = clampNumber(crop.size, MIN_AVATAR_CROP_SIZE, MAX_AVATAR_CROP_SIZE)
  return Math.round(
    ((MAX_AVATAR_CROP_SIZE - safeSize)
      / (MAX_AVATAR_CROP_SIZE - MIN_AVATAR_CROP_SIZE))
      * 100
  )
}

export function avatarCropSizeFromZoomPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    throw new Error('Avatar crop zoom percentage must be finite')
  }
  const normalized = clampNumber(percent, 0, 100) / 100
  return MAX_AVATAR_CROP_SIZE
    - normalized * (MAX_AVATAR_CROP_SIZE - MIN_AVATAR_CROP_SIZE)
}
