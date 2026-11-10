import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberAvatarRendition } from '@contracts'
import type { ManagedAvatarRead } from './managed-avatar-cache'
import {
  clearManagedAvatarObjectUrlCache,
  invalidateManagedAvatarObjectUrl,
  managedAvatarObjectUrl
} from './managed-avatar-cache'

const AVATAR_REF =
  'rovai://member-avatar/managed/123e4567-e89b-12d3-a456-426614174000'

describe('managed avatar object URL cache', () => {
  const originalCreateObjectUrl = URL.createObjectURL
  const originalRevokeObjectUrl = URL.revokeObjectURL
  const createObjectUrl = vi.fn(() => 'blob:managed-avatar')
  const revokeObjectUrl = vi.fn()

  beforeEach(async () => {
    await clearManagedAvatarObjectUrlCache()
    createObjectUrl.mockClear()
    revokeObjectUrl.mockClear()
    URL.createObjectURL = createObjectUrl
    URL.revokeObjectURL = revokeObjectUrl
  })

  afterEach(async () => {
    await clearManagedAvatarObjectUrlCache()
    URL.createObjectURL = originalCreateObjectUrl
    URL.revokeObjectURL = originalRevokeObjectUrl
  })

  it('coalesces reads and revokes the object URL when invalidated', async () => {
    const read = vi.fn<ManagedAvatarRead>().mockResolvedValue({
      mediaType: 'image/png',
      bytes: Uint8Array.from([137, 80, 78, 71]),
      width: 192,
      height: 192,
      crop: { centerX: 0.5, centerY: 0.5, size: 1 }
    })

    const first = managedAvatarObjectUrl(AVATAR_REF, 'icon', read)
    const second = managedAvatarObjectUrl(AVATAR_REF, 'icon', read)

    expect(first).toBe(second)
    await expect(first).resolves.toBe('blob:managed-avatar')
    expect(read).toHaveBeenCalledTimes(1)
    const otherHostRead = vi.fn<ManagedAvatarRead>().mockResolvedValue(null)
    await expect(managedAvatarObjectUrl(AVATAR_REF, 'icon', otherHostRead)).resolves.toBeNull()
    expect(otherHostRead).toHaveBeenCalledTimes(1)
    await expect(managedAvatarObjectUrl(AVATAR_REF, 'icon', read)).resolves.toBe('blob:managed-avatar')
    await invalidateManagedAvatarObjectUrl(AVATAR_REF, 'icon', read)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:managed-avatar')
  })

  it('keeps icon and portrait entries independent', async () => {
    const read = vi.fn<ManagedAvatarRead>().mockResolvedValue({
      mediaType: 'image/png',
      bytes: Uint8Array.from([1, 2, 3]),
      width: 192,
      height: 192,
      crop: { centerX: 0.5, centerY: 0.5, size: 1 }
    })
    createObjectUrl
      .mockReturnValueOnce('blob:icon')
      .mockReturnValueOnce('blob:portrait')

    await managedAvatarObjectUrl(AVATAR_REF, 'icon', read)
    await managedAvatarObjectUrl(AVATAR_REF, 'portrait', read)
    expect(read).toHaveBeenCalledTimes(2)
    await invalidateManagedAvatarObjectUrl(AVATAR_REF, undefined, read)
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:icon')
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:portrait')
  })

  it('caches a missing read without constructing an object URL', async () => {
    const missingRead = vi.fn<ManagedAvatarRead>().mockResolvedValue(null)
    await expect(managedAvatarObjectUrl(AVATAR_REF, 'icon', missingRead)).resolves.toBeNull()
    await expect(managedAvatarObjectUrl(AVATAR_REF, 'icon', missingRead)).resolves.toBeNull()
    expect(missingRead).toHaveBeenCalledTimes(1)
    expect(createObjectUrl).not.toHaveBeenCalled()

  })

  it('retries a failed read after recovery while coalescing concurrent callers', async () => {
    const read = vi.fn<ManagedAvatarRead>()
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValue({ mediaType: 'image/png', bytes: Uint8Array.from([1, 2, 3]), width: 192, height: 192,
        crop: { centerX: 0.5, centerY: 0.5, size: 1 } })
    const first = managedAvatarObjectUrl(AVATAR_REF, 'icon', read)
    expect(managedAvatarObjectUrl(AVATAR_REF, 'icon', read)).toBe(first)
    await expect(first).resolves.toBeNull()
    expect(createObjectUrl).not.toHaveBeenCalled()

    await expect(managedAvatarObjectUrl(AVATAR_REF, 'icon', read)).resolves.toBe('blob:managed-avatar')
    expect(read).toHaveBeenCalledTimes(2)
    await expect(managedAvatarObjectUrl(AVATAR_REF, 'icon', read)).resolves.toBe('blob:managed-avatar')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('turns an invalidated in-flight result into null and revokes it immediately', async () => {
    let resolveRead!: (value: MemberAvatarRendition | null) => void
    const pendingRead = new Promise<MemberAvatarRendition | null>((resolve) => {
      resolveRead = resolve
    })
    const read: ManagedAvatarRead = () => pendingRead
    const result = managedAvatarObjectUrl(AVATAR_REF, 'icon', read)
    const invalidation = invalidateManagedAvatarObjectUrl(AVATAR_REF, 'icon', read)
    resolveRead({
      mediaType: 'image/png',
      bytes: Uint8Array.from([1]),
      width: 192,
      height: 192,
      crop: { centerX: 0.5, centerY: 0.5, size: 1 }
    })

    await expect(result).resolves.toBeNull()
    await invalidation
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:managed-avatar')
  })
})
