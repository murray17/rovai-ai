import { nativeImage } from 'electron'
import { MEMBER_AVATAR_LIMITS } from '@contracts'
import { inspectPng } from './member-avatar-assets'

const MINIMUM_UPLOAD_EDGE = 240
const MAXIMUM_UPLOAD_BYTES = 2 * 1024 * 1024

/** Produce a DingTalk-only upload rendition in memory; never rewrite the member icon.
 * The console rejects Rovai's 192px icons with 66003. Invalid/undecodable images
 * return null so the gateway can fail locally without uploading a fallback avatar.
 */
export function prepareDingTalkAvatarPng(bytes: Uint8Array): Uint8Array | null {
  try {
    if (bytes.byteLength > MAXIMUM_UPLOAD_BYTES) return null
    const source = inspectPng(bytes)
    // Bound decoded memory before invoking the native codec. Managed icons are
    // square; do not introduce a different crop or distort an unexpected source.
    if (source.width !== source.height || source.width > MEMBER_AVATAR_LIMITS.normalizedMaximumEdge) return null

    const image = nativeImage.createFromBuffer(Buffer.from(bytes))
    if (image.isEmpty()) return null
    const decoded = image.getSize()
    if (decoded.width !== source.width || decoded.height !== source.height) return null
    if (source.width >= MINIMUM_UPLOAD_EDGE) return bytes

    const resized = image.resize({
      width: MINIMUM_UPLOAD_EDGE, height: MINIMUM_UPLOAD_EDGE, quality: 'best'
    })
    if (resized.isEmpty()) return null
    const result = new Uint8Array(resized.toPNG())
    if (result.byteLength > MAXIMUM_UPLOAD_BYTES) return null
    const upload = inspectPng(result)
    return upload.width === MINIMUM_UPLOAD_EDGE && upload.height === MINIMUM_UPLOAD_EDGE ? result : null
  } catch {
    // Native decoder/encoder details are not public channel errors.
    return null
  }
}
