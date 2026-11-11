import { MEMBER_AVATAR_LIMITS, inspectMemberAvatarUpload, type MemberAvatarRendition, type MemberAvatarsApi } from '@contracts'
import { HttpRequestError, type ConsoleClient } from './client'

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}

export function browserMemberAvatars(transport: ConsoleClient): MemberAvatarsApi {
  // Avatar reads share the Host's four upload slots. Leave one for a save or
  // attachment instead of dispatching the entire roster at once.
  let activeReads = 0
  const waitingReads: Array<() => void> = []
  return {
    selectSource: async () => {
      const file = await new Promise<File | null>(resolve => {
        const input = document.createElement('input')
        input.type = 'file'; input.accept = 'image/png,image/jpeg,image/gif'
        input.addEventListener('change', () => { resolve(input.files?.[0] ?? null); input.remove() }, { once: true })
        input.addEventListener('cancel', () => { resolve(null); input.remove() }, { once: true })
        input.hidden = true; document.body.append(input); input.click()
      })
      if (!file) return null
      if (file.size > MEMBER_AVATAR_LIMITS.selectedFileBytes) throw new Error('头像不能超过 10 MiB')
      const { inspection, bytes } = inspectMemberAvatarUpload(new Uint8Array(await file.arrayBuffer()))
      return {
        displayName: file.name, mediaType: inspection.mediaType, bytes,
        inspectedWidth: inspection.width, inspectedHeight: inspection.height, byteLength: bytes.byteLength,
        frameCount: inspection.mediaType === 'image/gif' ? inspection.frameCount : undefined,
        loopCount: inspection.mediaType === 'image/gif' ? inspection.loopCount : undefined
      }
    },
    save: input => {
      if (input.kind === 'image') {
        return transport.avatar('save', {
          kind: 'image', sourceBase64: base64(input.source),
          sourceWidth: input.sourceWidth, sourceHeight: input.sourceHeight, crop: input.crop
        })
      }
      if (input.kind === 'recrop') {
        return transport.avatar('save', { kind: 'recrop', avatarRef: input.avatarRef, crop: input.crop })
      }
      if (input.kind === 'gif') {
        return transport.avatar('save', {
          kind: 'gif', sourceGifBase64: base64(input.sourceGif),
          sourceWidth: input.sourceWidth, sourceHeight: input.sourceHeight, crop: input.crop
        })
      }
      return transport.avatar('save', {
        sourceBase64: base64(input.sourcePng), iconBase64: base64(input.iconPng),
        sourceWidth: input.sourceWidth, sourceHeight: input.sourceHeight, crop: input.crop
      })
    },
    read: async (avatarRef, rendition) => {
      const scope = transport.editingScope
      if (activeReads < 3) activeReads++
      else await new Promise<void>(resolve => waitingReads.push(resolve))
      try {
        for (let attempt = 0; ; attempt++) {
          if (transport.editingScope !== scope) throw new DOMException('Avatar scope replaced', 'AbortError')
          try {
            const image = await transport.avatar<Omit<MemberAvatarRendition, 'bytes'> & { base64: string } | null>('read', { avatarRef, rendition })
            return image ? { ...image, bytes: Uint8Array.from(atob(image.base64), char => char.charCodeAt(0)) } : null
          } catch (error) {
            // Another browser/upload may occupy the shared slots. Reads are
            // safe to retry; saves must retain their existing failure behavior.
            if (!(error instanceof HttpRequestError) || !['resource_capacity', 'avatar_unavailable'].includes(error.code)) throw error
            if (error.code === 'avatar_unavailable' || attempt >= 2) throw Object.assign(error, { retryable: true })
            await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt))
          }
        }
      } finally {
        const next = waitingReads.shift()
        if (next) next()
        else activeReads--
      }
    }
  }
}
