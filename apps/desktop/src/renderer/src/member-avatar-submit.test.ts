import { describe, expect, it, vi } from 'vitest'
import {
  submitMemberIdentityWithAvatar,
  type PendingMemberAvatarSource
} from './member-avatar-submit'

const source: PendingMemberAvatarSource = {
  sourcePng: Uint8Array.from([1]),
  width: 512,
  height: 512,
  crop: { centerX: 0.5, centerY: 0.5, size: 0.72 },
  needsSave: true
}

describe('member identity avatar submission', () => {
  it('persists the immutable asset before committing the Profile reference', async () => {
    const order: string[] = []
    const commit = vi.fn(async (draft: { avatarRef: string | null }) => {
      order.push(`profile:${draft.avatarRef}`)
    })
    const result = await submitMemberIdentityWithAvatar(
      { avatarRef: null },
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
    expect(result.source?.needsSave).toBe(false)
  })

  it('publishes the persisted draft before surfacing a Profile conflict for retry', async () => {
    const retry: {
      draft: { avatarRef: string | null } | null
      source: PendingMemberAvatarSource | null
    } = { draft: null, source: null }
    await expect(
      submitMemberIdentityWithAvatar(
        { avatarRef: null },
        source,
        async () => ({
          avatarRef:
            'rovai://member-avatar/managed/123e4567-e89b-12d3-a456-426614174000',
          crop: source.crop
        }),
        async () => {
          throw new Error('agent_profile.version_conflict')
        },
        (draft, nextSource) => {
          retry.draft = draft
          retry.source = nextSource
        }
      )
    ).rejects.toThrow('version_conflict')

    expect(retry.draft).toEqual({
      avatarRef:
        'rovai://member-avatar/managed/123e4567-e89b-12d3-a456-426614174000'
    })
    expect(retry.source?.needsSave).toBe(false)
  })

  it('does not create another asset when retrying an already persisted draft', async () => {
    const persist = vi.fn()
    const commit = vi.fn(async () => undefined)
    await submitMemberIdentityWithAvatar(
      {
        avatarRef:
          'rovai://member-avatar/managed/123e4567-e89b-12d3-a456-426614174000'
      },
      { ...source, needsSave: false },
      persist,
      commit,
      () => undefined
    )
    expect(persist).not.toHaveBeenCalled()
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
