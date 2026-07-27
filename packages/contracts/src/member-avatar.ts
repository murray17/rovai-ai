export const BUILTIN_MEMBER_AVATAR_ROLES = [
  'luoke',
  'muwa',
  'mianzhi',
  'qilu'
] as const

export const MEMBER_AVATAR_LIMITS = {
  selectedFileBytes: 10 * 1024 * 1024,
  minimumDecodedEdge: 256,
  qualityWarningEdge: 512,
  maximumDecodedEdge: 8192,
  maximumDecodedPixels: 32_000_000,
  normalizedMaximumEdge: 2048,
  normalizedSourceBytes: 16 * 1024 * 1024,
  iconEdge: 192,
  iconBytes: 1024 * 1024,
  saveIpcBytes: 17 * 1024 * 1024,
  manifestBytes: 16 * 1024
} as const

export type BuiltinMemberAvatarRole = (typeof BUILTIN_MEMBER_AVATAR_ROLES)[number]

export type ControlledMemberAvatarRef =
  | {
      kind: 'builtin'
      role: BuiltinMemberAvatarRole
      version: 1
      value: string
    }
  | {
      kind: 'managed'
      assetId: string
      value: string
    }

const BUILTIN_REF_PATTERN =
  /^rovai:\/\/member-avatar\/builtin\/(luoke|muwa|mianzhi|qilu)\/v1$/
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MANAGED_REF_PREFIX = 'rovai://member-avatar/managed/'

export function builtinMemberAvatarRef(role: BuiltinMemberAvatarRole): string {
  return `rovai://member-avatar/builtin/${role}/v1`
}

export function managedMemberAvatarRef(assetId: string): string {
  if (!CANONICAL_UUID_PATTERN.test(assetId)) {
    throw new Error('Managed member avatar assetId must be a canonical lowercase UUID')
  }
  return `${MANAGED_REF_PREFIX}${assetId}`
}

export function parseControlledMemberAvatarRef(
  value: string
): ControlledMemberAvatarRef | null {
  const builtin = BUILTIN_REF_PATTERN.exec(value)
  if (builtin) {
    const role = builtin[1] as BuiltinMemberAvatarRole
    return { kind: 'builtin', role, version: 1, value }
  }
  if (!value.startsWith(MANAGED_REF_PREFIX)) return null
  const assetId = value.slice(MANAGED_REF_PREFIX.length)
  if (!CANONICAL_UUID_PATTERN.test(assetId)) return null
  return { kind: 'managed', assetId, value }
}

export function clampControlledMemberAvatarCrop(
  crop: { centerX: number; centerY: number; size: number },
  sourceWidth: number,
  sourceHeight: number
): { centerX: number; centerY: number; size: number } {
  if (
    !Number.isFinite(sourceWidth)
    || !Number.isFinite(sourceHeight)
    || sourceWidth <= 0
    || sourceHeight <= 0
  ) {
    throw new Error('Member avatar source dimensions must be finite positive numbers')
  }
  if (
    !Number.isFinite(crop.centerX)
    || !Number.isFinite(crop.centerY)
    || !Number.isFinite(crop.size)
  ) {
    throw new Error('Member avatar crop values must be finite numbers')
  }
  const size = Math.min(Math.max(crop.size, 0.12), 1)
  const edge = size * Math.min(sourceWidth, sourceHeight)
  const horizontalInset = edge / 2 / sourceWidth
  const verticalInset = edge / 2 / sourceHeight
  return {
    centerX: Math.min(Math.max(crop.centerX, horizontalInset), 1 - horizontalInset),
    centerY: Math.min(Math.max(crop.centerY, verticalInset), 1 - verticalInset),
    size
  }
}

export function validateMemberAvatarDimensions(
  width: number,
  height: number,
  maximumEdge: number = MEMBER_AVATAR_LIMITS.maximumDecodedEdge,
  maximumPixels: number = MEMBER_AVATAR_LIMITS.maximumDecodedPixels
): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Member avatar dimensions must be positive integers')
  }
  if (
    width < MEMBER_AVATAR_LIMITS.minimumDecodedEdge
    || height < MEMBER_AVATAR_LIMITS.minimumDecodedEdge
  ) {
    throw new Error('Member avatar dimensions are below the minimum')
  }
  if (width > maximumEdge || height > maximumEdge || width * height > maximumPixels) {
    throw new Error('Member avatar dimensions exceed the resource limit')
  }
}
