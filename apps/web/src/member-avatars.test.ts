import { afterEach, expect, it, vi } from 'vitest'
import { ConsoleClient, HttpRequestError } from './client'
import { browserMemberAvatars } from './member-avatars'

const image = { mediaType: 'image/png', base64: btoa('png'), width: 192, height: 192 }
const transport = (avatar: ReturnType<typeof vi.fn>) => ({ avatar }) as unknown as ConsoleClient
afterEach(() => vi.useRealTimers())

it('loads a full roster without exhausting the Host shared four-resource quota', async () => {
  let active = 0
  const avatar = vi.fn(async () => {
    if (active >= 4) throw new HttpRequestError(429, 'resource_capacity')
    active++
    await new Promise(resolve => setTimeout(resolve, 0))
    active--
    return image
  })
  const api = browserMemberAvatars(transport(avatar))
  const images = await Promise.all(Array.from({ length: 24 }, (_, i) => api.read(`avatar-${i}`, 'icon')))
  expect(images).toHaveLength(24)
  expect(images.every(value => value?.bytes.length === 3)).toBe(true)
  expect(avatar).toHaveBeenCalledTimes(24)
})

it('retries only read capacity failures with a bounded backoff', async () => {
  vi.useFakeTimers()
  const avatar = vi.fn().mockRejectedValueOnce(new HttpRequestError(429, 'resource_capacity'))
    .mockRejectedValueOnce(new HttpRequestError(429, 'resource_capacity')).mockResolvedValue(image)
  const api = browserMemberAvatars(transport(avatar))
  const result = api.read('avatar', 'icon').then(value => ({ value }), error => ({ error }))
  await vi.runAllTimersAsync()
  expect(await result).toMatchObject({ value: { bytes: Uint8Array.from([112, 110, 103]) } })
  expect(avatar).toHaveBeenCalledTimes(3)

  avatar.mockReset().mockRejectedValue(new HttpRequestError(429, 'resource_capacity'))
  const failed = api.read('avatar', 'portrait').catch(error => error)
  await vi.runAllTimersAsync()
  expect(await failed).toMatchObject({ code: 'resource_capacity', retryable: true })
  expect(avatar).toHaveBeenCalledTimes(3)

  avatar.mockReset().mockRejectedValue(new HttpRequestError(503, 'avatar_unavailable'))
  await expect(api.read('avatar', 'icon')).rejects.toMatchObject({ code: 'avatar_unavailable', retryable: true })
  expect(avatar).toHaveBeenCalledTimes(1)
})

it('releases the read queue after a failure and never retries an avatar save', async () => {
  const avatar = vi.fn().mockRejectedValueOnce(new HttpRequestError(400, 'invalid_avatar')).mockResolvedValue(image)
  const api = browserMemberAvatars(transport(avatar))
  const reads = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => api.read(`avatar-${i}`, 'icon')))
  expect(reads[0].status).toBe('rejected')
  expect(reads.slice(1).every(result => result.status === 'fulfilled')).toBe(true)
  expect(avatar).toHaveBeenCalledTimes(8)

  avatar.mockReset().mockRejectedValue(new HttpRequestError(429, 'resource_capacity'))
  await expect(api.save({ kind: 'recrop', avatarRef: 'avatar', crop: { centerX: 0.5, centerY: 0.5, size: 1 } }))
    .rejects.toMatchObject({ code: 'resource_capacity' })
  expect(avatar).toHaveBeenCalledTimes(1)
})

it('does not dispatch queued reads into a replacement authenticated scope', async () => {
  let scope = 'original'
  const releases: Array<() => void> = []
  const avatar = vi.fn(() => new Promise(resolve => releases.push(() => resolve(image))))
  const api = browserMemberAvatars({ avatar, get editingScope() { return scope } } as unknown as ConsoleClient)
  const reads = Promise.allSettled(Array.from({ length: 4 }, (_, i) => api.read(`avatar-${i}`, 'icon')))
  expect(avatar).toHaveBeenCalledTimes(3)
  scope = 'replacement'
  releases.forEach(resolve => resolve())
  const results = await reads
  expect(results.slice(0, 3).every(result => result.status === 'fulfilled')).toBe(true)
  expect(results[3]).toMatchObject({ status: 'rejected', reason: { name: 'AbortError' } })
  expect(avatar).toHaveBeenCalledTimes(3)
})
