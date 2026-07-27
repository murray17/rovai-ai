import type { MemberAvatarRendition, MemberAvatarsApi } from '@contracts'

export type ManagedAvatarRenditionKind = 'icon' | 'portrait'
export type ManagedAvatarRead = MemberAvatarsApi['read']

type CacheEntry = {
  token: object
  promise: Promise<string | null>
}

const managedAvatarCache = new Map<string, CacheEntry>()

function cacheKey(avatarRef: string, rendition: ManagedAvatarRenditionKind): string {
  return `${avatarRef}\u0000${rendition}`
}

function renditionObjectUrl(rendition: MemberAvatarRendition): string {
  const bytes = Uint8Array.from(rendition.bytes)
  return URL.createObjectURL(new Blob([bytes], { type: rendition.mediaType }))
}

export function managedAvatarObjectUrl(
  avatarRef: string,
  rendition: ManagedAvatarRenditionKind,
  read: ManagedAvatarRead = window.rovai.memberAvatars.read
): Promise<string | null> {
  const key = cacheKey(avatarRef, rendition)
  const cached = managedAvatarCache.get(key)
  if (cached) return cached.promise

  const token = {}
  const promise = read(avatarRef, rendition)
    .then((result) => {
      if (!result) return null
      const objectUrl = renditionObjectUrl(result)
      if (managedAvatarCache.get(key)?.token !== token) {
        URL.revokeObjectURL(objectUrl)
        return null
      }
      return objectUrl
    })
    .catch(() => null)
  managedAvatarCache.set(key, { token, promise })
  return promise
}

export async function invalidateManagedAvatarObjectUrl(
  avatarRef: string,
  rendition?: ManagedAvatarRenditionKind
): Promise<void> {
  const keys = rendition
    ? [cacheKey(avatarRef, rendition)]
    : [
        cacheKey(avatarRef, 'icon'),
        cacheKey(avatarRef, 'portrait')
      ]
  const entries = keys.flatMap((key) => {
    const entry = managedAvatarCache.get(key)
    managedAvatarCache.delete(key)
    return entry ? [entry] : []
  })
  const objectUrls = await Promise.all(entries.map((entry) => entry.promise))
  for (const objectUrl of objectUrls) {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

export async function clearManagedAvatarObjectUrlCache(): Promise<void> {
  const entries = [...managedAvatarCache.values()]
  managedAvatarCache.clear()
  const objectUrls = await Promise.all(entries.map((entry) => entry.promise))
  for (const objectUrl of objectUrls) {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}
