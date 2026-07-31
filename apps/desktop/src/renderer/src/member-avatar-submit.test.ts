import { describe, expect, it, vi } from 'vitest'
import {
  submitMemberAvatar,
  type PendingMemberAvatarSource
} from './member-avatar-submit'

const source: PendingMemberAvatarSource = {
  sourcePng: Uint8Array.from([1]),
  width: 512,
  height: 512,
  crop: { centerX: 0.5, centerY: 0.5, size: 0.72 },
  needsSave: true
}

describe('member avatar submission', () => {
  it('persists the immutable asset before committing the independent Profile avatar reference', async () => {
    const order: string[] = []
    const commit = vi.fn(async (avatarRef: string | null) => {
      order.push(`profile:${avatarRef}`)
    })
    const result = await submitMemberAvatar(
      null,
      source,
      async () => {
        order.push('asset')
        return {
          avatarRef:
            'rovai://member-avatar/managed/123e4567-e89b-12d3-a456-426614174000',
          crop: source.crop
        }
      },
      commit,
      () => {
        order.push('draft')
      }
    )

    expect(order).toEqual([
      'asset',
      'draft',
      'profile:rovai://member-avatar/managed/123e4567-e89b-12d3-a456-426614174000'
    ])
    expect(result.avatarRef).toBe('rovai://member-avatar/managed/123e4567-e89b-12d3-a456-426614174000')
    expect(result.source?.needsSave).toBe(false)
  })

  it('publishes the persisted draft before surfacing a Profile conflict for retry', async () => {
    const retry: {
      avatarRef: string | null
      source: PendingMemberAvatarSource | null
    } = { avatarRef: null, source: null }
    await expect(
      submitMemberAvatar(
        null,
        source,
        async () => ({
          avatarRef:
            'rovai://member-avatar/managed/123e4567-e89b-12d3-a456-426614174000',
          crop: source.crop
        }),
        async () => {
          throw new Error('agent_profile.version_conflict')
        },
        (avatarRef, nextSource) => {
          retry.avatarRef = avatarRef
          retry.source = nextSource
        }
      )
    ).rejects.toThrow('version_conflict')

    expect(retry.avatarRef).toBe('rovai://member-avatar/managed/123e4567-e89b-12d3-a456-426614174000')
    expect(retry.source?.needsSave).toBe(false)
  })

  it('does not create another asset when retrying an already persisted draft', async () => {
    const persist = vi.fn()
    const commit = vi.fn(async () => undefined)
    await submitMemberAvatar(
      'rovai://member-avatar/managed/123e4567-e89b-12d3-a456-426614174000',
      { ...source, needsSave: false },
      persist,
      commit,
      () => undefined
    )
    expect(persist).not.toHaveBeenCalled()
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
