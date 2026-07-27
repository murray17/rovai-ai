import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm
} from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  MEMBER_AVATAR_LIMITS,
  clampControlledMemberAvatarCrop,
  managedMemberAvatarRef,
  parseControlledMemberAvatarRef,
  validateMemberAvatarDimensions,
  type MemberAvatarAssetSummary,
  type MemberAvatarCrop,
  type MemberAvatarRendition,
  type MemberAvatarSourceSelection,
  type SaveMemberAvatarAssetInput
} from '@contracts'

type PngInspection = {
  mediaType: 'image/png'
  width: number
  height: number
}

type JpegInspection = {
  mediaType: 'image/jpeg'
  width: number
  height: number
}

type ImageInspection = PngInspection | JpegInspection

type AvatarManifestFile = {
  file: string
  mediaType: 'image/png'
  width: number
  height: number
  byteLength: number
  sha256: string
}

type AvatarManifestV1 = {
  schemaVersion: 1
  assetId: string
  createdAt: string
  source: AvatarManifestFile & {
    orientationNormalized: true
    metadataStripped: true
  }
  icon: AvatarManifestFile
  iconCrop: MemberAvatarCrop
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const
const MANAGED_TEMP_PATTERN =
  /^\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const STALE_TEMP_AGE_MS = 24 * 60 * 60 * 1000

export class MemberAvatarAssetService {
  readonly root: string

  constructor(userDataPath: string) {
    this.root = join(userDataPath, 'member-avatars')
  }

  async save(input: SaveMemberAvatarAssetInput): Promise<MemberAvatarAssetSummary> {
    const sourcePng = ownedBytes(input.sourcePng, 'sourcePng')
    const iconPng = ownedBytes(input.iconPng, 'iconPng')
    if (sourcePng.byteLength > MEMBER_AVATAR_LIMITS.normalizedSourceBytes) {
      throw new Error('Normalized member avatar source exceeds the byte limit')
    }
    if (iconPng.byteLength > MEMBER_AVATAR_LIMITS.iconBytes) {
      throw new Error('Member avatar icon exceeds the byte limit')
    }
    if (sourcePng.byteLength + iconPng.byteLength > MEMBER_AVATAR_LIMITS.saveIpcBytes) {
      throw new Error('Member avatar save payload exceeds the byte limit')
    }

    const sourceInspection = inspectPng(sourcePng)
    const iconInspection = inspectPng(iconPng)
    validateMemberAvatarDimensions(
      sourceInspection.width,
      sourceInspection.height,
      MEMBER_AVATAR_LIMITS.normalizedMaximumEdge,
      MEMBER_AVATAR_LIMITS.normalizedMaximumEdge ** 2
    )
    if (
      sourceInspection.width !== input.sourceWidth
      || sourceInspection.height !== input.sourceHeight
    ) {
      throw new Error('Normalized member avatar source dimensions do not match')
    }
    if (
      iconInspection.width !== MEMBER_AVATAR_LIMITS.iconEdge
      || iconInspection.height !== MEMBER_AVATAR_LIMITS.iconEdge
    ) {
      throw new Error('Member avatar icon must be exactly 192 by 192 pixels')
    }
    const crop = clampControlledMemberAvatarCrop(
      input.crop,
      input.sourceWidth,
      input.sourceHeight
    )
    if (!sameCrop(crop, input.crop)) {
      throw new Error('Member avatar crop must already be within source bounds')
    }

    await ensurePrivateDirectory(this.root)
    const assetId = randomUUID()
    const temporaryDirectory = join(this.root, `.tmp-${assetId}`)
    const finalDirectory = join(this.root, assetId)
    await mkdir(temporaryDirectory, { mode: 0o700 })
    try {
      const source: AvatarManifestV1['source'] = {
        file: 'source.png',
        mediaType: 'image/png',
        width: sourceInspection.width,
        height: sourceInspection.height,
        byteLength: sourcePng.byteLength,
        sha256: sha256(sourcePng),
        orientationNormalized: true,
        metadataStripped: true
      }
      const icon: AvatarManifestV1['icon'] = {
        file: 'icon-192.png',
        mediaType: 'image/png',
        width: iconInspection.width,
        height: iconInspection.height,
        byteLength: iconPng.byteLength,
        sha256: sha256(iconPng)
      }
      const manifest: AvatarManifestV1 = {
        schemaVersion: 1,
        assetId,
        createdAt: new Date().toISOString(),
        source,
        icon,
        iconCrop: crop
      }
      const manifestBytes = new TextEncoder().encode(
        `${JSON.stringify(manifest, null, 2)}\n`
      )
      if (manifestBytes.byteLength > MEMBER_AVATAR_LIMITS.manifestBytes) {
        throw new Error('Member avatar manifest exceeds the byte limit')
      }

      await writePrivateFile(join(temporaryDirectory, source.file), sourcePng)
      await writePrivateFile(join(temporaryDirectory, icon.file), iconPng)
      await writePrivateFile(
        join(temporaryDirectory, 'manifest.json'),
        manifestBytes
      )
      await syncDirectory(temporaryDirectory)
      await rename(temporaryDirectory, finalDirectory)
      await syncDirectory(this.root)
      return {
        avatarRef: managedMemberAvatarRef(assetId),
        sourceWidth: source.width,
        sourceHeight: source.height,
        crop
      }
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async read(
    avatarRef: string,
    rendition: 'icon' | 'portrait'
  ): Promise<MemberAvatarRendition | null> {
    const parsed = parseControlledMemberAvatarRef(avatarRef)
    if (!parsed || parsed.kind !== 'managed') return null
    try {
      await assertPrivateDirectory(this.root)
      const assetDirectory = join(this.root, parsed.assetId)
      const directoryInfo = await lstat(assetDirectory)
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) return null
      const manifestBytes = await readBoundedRegularFile(
        join(assetDirectory, 'manifest.json'),
        MEMBER_AVATAR_LIMITS.manifestBytes
      )
      const manifest = parseManifest(manifestBytes, parsed.assetId)
      const expected = rendition === 'icon' ? manifest.icon : manifest.source
      const maximumBytes = rendition === 'icon'
        ? MEMBER_AVATAR_LIMITS.iconBytes
        : MEMBER_AVATAR_LIMITS.normalizedSourceBytes
      const bytes = await readBoundedRegularFile(
        join(assetDirectory, expected.file),
        maximumBytes
      )
      const inspection = inspectPng(bytes)
      if (
        bytes.byteLength !== expected.byteLength
        || inspection.width !== expected.width
        || inspection.height !== expected.height
        || sha256(bytes) !== expected.sha256
      ) {
        return null
      }
      return {
        mediaType: 'image/png',
        bytes,
        width: expected.width,
        height: expected.height,
        crop: manifest.iconCrop
      }
    } catch {
      return null
    }
  }

  async cleanupStaleTemporaryDirectories(now = Date.now()): Promise<number> {
    await ensurePrivateDirectory(this.root)
    let removed = 0
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !MANAGED_TEMP_PATTERN.test(entry.name)) continue
      const candidate = join(this.root, entry.name)
      const info = await lstat(candidate)
      if (
        info.isSymbolicLink()
        || now - info.mtimeMs < STALE_TEMP_AGE_MS
      ) {
        continue
      }
      await rm(candidate, { recursive: true, force: true })
      removed += 1
    }
    return removed
  }
}

export async function inspectMemberAvatarSourceFile(
  filePath: string
): Promise<MemberAvatarSourceSelection> {
  const bytes = await readBoundedRegularFile(
    filePath,
    MEMBER_AVATAR_LIMITS.selectedFileBytes
  )
  const inspection = inspectImage(bytes)
  validateMemberAvatarDimensions(inspection.width, inspection.height)
  return {
    displayName: basename(filePath),
    mediaType: inspection.mediaType,
    bytes,
    inspectedWidth: inspection.width,
    inspectedHeight: inspection.height,
    byteLength: bytes.byteLength
  }
}

export function inspectImage(bytes: Uint8Array): ImageInspection {
  if (hasPrefix(bytes, PNG_SIGNATURE)) return inspectPng(bytes)
  return inspectJpeg(bytes)
}

export function inspectPng(bytes: Uint8Array): PngInspection {
  if (!hasPrefix(bytes, PNG_SIGNATURE)) throw new Error('Unsupported member avatar image type')
  let offset: number = PNG_SIGNATURE.length
  let width = 0
  let height = 0
  let sawHeader = false
  let sawEnd = false
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) throw new Error('Truncated PNG member avatar')
    const length = readU32(bytes, offset)
    const typeOffset = offset + 4
    const dataOffset = offset + 8
    const endOffset = dataOffset + length + 4
    if (endOffset < dataOffset || endOffset > bytes.byteLength) {
      throw new Error('Invalid PNG member avatar chunk length')
    }
    const type = ascii(bytes, typeOffset, 4)
    if (!sawHeader && type !== 'IHDR') throw new Error('PNG member avatar is missing IHDR')
    if (type === 'IHDR') {
      if (sawHeader || length !== 13) throw new Error('Invalid PNG member avatar IHDR')
      width = readU32(bytes, dataOffset)
      height = readU32(bytes, dataOffset + 4)
      const bitDepth = bytes[dataOffset + 8]
      const colorType = bytes[dataOffset + 9]
      const compression = bytes[dataOffset + 10]
      const filter = bytes[dataOffset + 11]
      const interlace = bytes[dataOffset + 12]
      if (
        !validPngColorDepth(colorType, bitDepth)
        || compression !== 0
        || filter !== 0
        || (interlace !== 0 && interlace !== 1)
        || width === 0
        || height === 0
      ) {
        throw new Error('Unsupported PNG member avatar encoding')
      }
      sawHeader = true
    } else if (type === 'acTL') {
      throw new Error('Animated PNG member avatars are not supported')
    } else if (type === 'IEND') {
      if (length !== 0 || endOffset !== bytes.byteLength) {
        throw new Error('Invalid PNG member avatar ending')
      }
      sawEnd = true
      break
    }
    offset = endOffset
  }
  if (!sawHeader || !sawEnd) throw new Error('Incomplete PNG member avatar')
  return { mediaType: 'image/png', width, height }
}

export function inspectJpeg(bytes: Uint8Array): JpegInspection {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('Unsupported member avatar image type')
  }
  let offset = 2
  while (offset < bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.byteLength) break
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.byteLength) throw new Error('Truncated JPEG member avatar')
    const length = readU16(bytes, offset)
    if (length < 2 || offset + length > bytes.byteLength) {
      throw new Error('Invalid JPEG member avatar segment')
    }
    if (isJpegStartOfFrame(marker)) {
      if (length < 8) throw new Error('Invalid JPEG member avatar dimensions')
      const height = readU16(bytes, offset + 3)
      const width = readU16(bytes, offset + 5)
      if (width === 0 || height === 0) {
        throw new Error('Invalid JPEG member avatar dimensions')
      }
      return { mediaType: 'image/jpeg', width, height }
    }
    offset += length
  }
  throw new Error('JPEG member avatar is missing dimensions')
}

function parseManifest(bytes: Uint8Array, expectedAssetId: string): AvatarManifestV1 {
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  if (!isRecord(value) || value.schemaVersion !== 1 || value.assetId !== expectedAssetId) {
    throw new Error('Invalid member avatar manifest')
  }
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error('Invalid member avatar manifest timestamp')
  }
  const source = parseManifestFile(value.source, 'source.png')
  const icon = parseManifestFile(value.icon, 'icon-192.png')
  if (!isRecord(value.source)) throw new Error('Invalid member avatar source manifest')
  if (
    value.source.orientationNormalized !== true
    || value.source.metadataStripped !== true
  ) {
    throw new Error('Invalid member avatar normalization manifest')
  }
  if (
    source.byteLength > MEMBER_AVATAR_LIMITS.normalizedSourceBytes
    || icon.byteLength > MEMBER_AVATAR_LIMITS.iconBytes
  ) {
    throw new Error('Invalid member avatar file size manifest')
  }
  validateMemberAvatarDimensions(
    source.width,
    source.height,
    MEMBER_AVATAR_LIMITS.normalizedMaximumEdge,
    MEMBER_AVATAR_LIMITS.normalizedMaximumEdge ** 2
  )
  if (
    icon.width !== MEMBER_AVATAR_LIMITS.iconEdge
    || icon.height !== MEMBER_AVATAR_LIMITS.iconEdge
  ) {
    throw new Error('Invalid member avatar icon manifest')
  }
  if (!isRecord(value.iconCrop)) throw new Error('Invalid member avatar crop manifest')
  const rawCrop = {
    centerX: value.iconCrop.centerX,
    centerY: value.iconCrop.centerY,
    size: value.iconCrop.size
  }
  if (
    typeof rawCrop.centerX !== 'number'
    || typeof rawCrop.centerY !== 'number'
    || typeof rawCrop.size !== 'number'
  ) {
    throw new Error('Invalid member avatar crop manifest')
  }
  const typedCrop: MemberAvatarCrop = {
    centerX: rawCrop.centerX,
    centerY: rawCrop.centerY,
    size: rawCrop.size
  }
  const iconCrop = clampControlledMemberAvatarCrop(
    typedCrop,
    source.width,
    source.height
  )
  if (!sameCrop(iconCrop, typedCrop)) {
    throw new Error('Out-of-bounds member avatar crop manifest')
  }
  return {
    schemaVersion: 1,
    assetId: expectedAssetId,
    createdAt: value.createdAt,
    source: {
      ...source,
      orientationNormalized: true,
      metadataStripped: true
    },
    icon,
    iconCrop
  }
}

function parseManifestFile(value: unknown, expectedFile: string): AvatarManifestFile {
  if (
    !isRecord(value)
    || value.file !== expectedFile
    || value.mediaType !== 'image/png'
    || !Number.isInteger(value.width)
    || !Number.isInteger(value.height)
    || !Number.isInteger(value.byteLength)
    || typeof value.sha256 !== 'string'
    || !SHA256_PATTERN.test(value.sha256)
  ) {
    throw new Error('Invalid member avatar file manifest')
  }
  if (
    (value.width as number) <= 0
    || (value.height as number) <= 0
    || (value.byteLength as number) <= 0
  ) {
    throw new Error('Invalid member avatar file manifest')
  }
  return {
    file: expectedFile,
    mediaType: 'image/png',
    width: value.width as number,
    height: value.height as number,
    byteLength: value.byteLength as number,
    sha256: value.sha256
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await assertPrivateDirectory(path)
  await chmod(path, 0o700)
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('Member avatar root must be a private directory')
  }
}

async function readBoundedRegularFile(path: string, maximumBytes: number): Promise<Uint8Array> {
  const linkInfo = await lstat(path)
  if (
    linkInfo.isSymbolicLink()
    || !linkInfo.isFile()
    || linkInfo.size > maximumBytes
  ) {
    throw new Error('Member avatar file is invalid or exceeds the byte limit')
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maximumBytes || info.size !== linkInfo.size) {
      throw new Error('Member avatar file changed during inspection')
    }
    const buffer = await handle.readFile()
    if (buffer.byteLength !== info.size || buffer.byteLength > maximumBytes) {
      throw new Error('Member avatar file changed during read')
    }
    return Uint8Array.from(buffer)
  } finally {
    await handle.close()
  }
}

async function writePrivateFile(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function ownedBytes(value: Uint8Array, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error(`Member avatar ${label} must be a Uint8Array`)
  }
  return Uint8Array.from(value)
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function sameCrop(left: MemberAvatarCrop, right: MemberAvatarCrop): boolean {
  return (
    Math.abs(left.centerX - right.centerX) <= Number.EPSILON
    && Math.abs(left.centerY - right.centerY) <= Number.EPSILON
    && Math.abs(left.size - right.size) <= Number.EPSILON
  )
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return (
    bytes.byteLength >= prefix.length
    && prefix.every((value, index) => bytes[index] === value)
  )
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
  )
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function validPngColorDepth(colorType: number, bitDepth: number): boolean {
  if (colorType === 0) return [1, 2, 4, 8, 16].includes(bitDepth)
  if (colorType === 2 || colorType === 4 || colorType === 6) {
    return bitDepth === 8 || bitDepth === 16
  }
  return colorType === 3 && [1, 2, 4, 8].includes(bitDepth)
}

function isJpegStartOfFrame(marker: number): boolean {
  return [
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf
  ].includes(marker)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
