import {
  MEMBER_AVATAR_LIMITS,
  type MemberAvatarCrop,
  type MemberAvatarSourceSelection
} from '@contracts'
import { avatarCropToPixels, clampAvatarCrop } from './member-avatar-crop'

export type NormalizedMemberAvatarSource = {
  sourcePng: Uint8Array
  width: number
  height: number
}

export type NormalizedMemberAvatarAsset = NormalizedMemberAvatarSource & {
  iconPng: Uint8Array
  crop: MemberAvatarCrop
}

export function validateDecodedMemberAvatarDimensions(
  width: number,
  height: number
): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('角色图片尺寸无效')
  }
  if (
    width < MEMBER_AVATAR_LIMITS.minimumDecodedEdge
    || height < MEMBER_AVATAR_LIMITS.minimumDecodedEdge
  ) {
    throw new Error(
      `角色图片至少需要 ${MEMBER_AVATAR_LIMITS.minimumDecodedEdge}×${MEMBER_AVATAR_LIMITS.minimumDecodedEdge}px`
    )
  }
  if (
    width > MEMBER_AVATAR_LIMITS.maximumDecodedEdge
    || height > MEMBER_AVATAR_LIMITS.maximumDecodedEdge
  ) {
    throw new Error(`角色图片单边不能超过 ${MEMBER_AVATAR_LIMITS.maximumDecodedEdge}px`)
  }
  if (width * height > MEMBER_AVATAR_LIMITS.maximumDecodedPixels) {
    throw new Error('角色图片总像素不能超过 3200 万')
  }
}

export function normalizedMemberAvatarDimensions(
  width: number,
  height: number
): { width: number; height: number } {
  validateDecodedMemberAvatarDimensions(width, height)
  const longest = Math.max(width, height)
  if (longest <= MEMBER_AVATAR_LIMITS.normalizedMaximumEdge) return { width, height }
  const scale = MEMBER_AVATAR_LIMITS.normalizedMaximumEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

export function isMemberAvatarSourceLowQuality(width: number, height: number): boolean {
  validateDecodedMemberAvatarDimensions(width, height)
  return (
    width < MEMBER_AVATAR_LIMITS.qualityWarningEdge
    || height < MEMBER_AVATAR_LIMITS.qualityWarningEdge
  )
}

export async function normalizeMemberAvatarSource(
  selection: MemberAvatarSourceSelection
): Promise<NormalizedMemberAvatarSource> {
  if (selection.byteLength !== selection.bytes.byteLength) {
    throw new Error('角色图片字节长度不一致')
  }
  if (selection.byteLength > MEMBER_AVATAR_LIMITS.selectedFileBytes) {
    throw new Error('角色图片不能超过 10 MiB')
  }
  validateDecodedMemberAvatarDimensions(
    selection.inspectedWidth,
    selection.inspectedHeight
  )

  const bitmap = await createImageBitmap(
    new Blob([ownedArrayBuffer(selection.bytes)], { type: selection.mediaType }),
    { imageOrientation: 'from-image' }
  )
  try {
    validateDecodedMemberAvatarDimensions(bitmap.width, bitmap.height)
    const dimensions = normalizedMemberAvatarDimensions(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) throw new Error('无法创建角色图片画布')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.clearRect(0, 0, dimensions.width, dimensions.height)
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height)
    const sourcePng = await canvasToPngBytes(canvas)
    if (sourcePng.byteLength > MEMBER_AVATAR_LIMITS.normalizedSourceBytes) {
      throw new Error('规范化角色图片超过 16 MiB')
    }
    return {
      sourcePng,
      width: dimensions.width,
      height: dimensions.height
    }
  } finally {
    bitmap.close()
  }
}

export async function deriveMemberAvatarIcon(
  source: NormalizedMemberAvatarSource,
  crop: MemberAvatarCrop
): Promise<NormalizedMemberAvatarAsset> {
  const safeCrop = clampAvatarCrop(crop, source.width, source.height)
  const bitmap = await createImageBitmap(
    new Blob([ownedArrayBuffer(source.sourcePng)], { type: 'image/png' })
  )
  try {
    if (bitmap.width !== source.width || bitmap.height !== source.height) {
      throw new Error('规范化角色图片尺寸不一致')
    }
    const rect = avatarCropToPixels(safeCrop, source.width, source.height)
    const canvas = document.createElement('canvas')
    canvas.width = MEMBER_AVATAR_LIMITS.iconEdge
    canvas.height = MEMBER_AVATAR_LIMITS.iconEdge
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) throw new Error('无法创建小头像画布')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(
      bitmap,
      rect.x,
      rect.y,
      rect.size,
      rect.size,
      0,
      0,
      canvas.width,
      canvas.height
    )
    const iconPng = await canvasToPngBytes(canvas)
    if (iconPng.byteLength > MEMBER_AVATAR_LIMITS.iconBytes) {
      throw new Error('派生小头像超过 1 MiB')
    }
    if (
      source.sourcePng.byteLength + iconPng.byteLength
      > MEMBER_AVATAR_LIMITS.saveIpcBytes
    ) {
      throw new Error('角色图片保存数据超过 17 MiB')
    }
    return {
      ...source,
      iconPng,
      crop: safeCrop
    }
  } finally {
    bitmap.close()
  }
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value)
      else reject(new Error('无法编码 PNG 图片'))
    }, 'image/png')
  })
  return new Uint8Array(await blob.arrayBuffer())
}
