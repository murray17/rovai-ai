import { describe, expect, it } from 'vitest'
import { builtinMemberAvatarRef } from '@contracts'
import {
  BUILTIN_MEMBER_AVATAR_ASSETS,
  builtinMemberAvatarAssets
} from './member-avatar-registry'

describe('member avatar registry', () => {
  it('resolves every canonical builtin reference to its five renditions', () => {
    for (const role of ['luoke', 'muwa', 'mianzhi', 'qilu'] as const) {
      const assets = builtinMemberAvatarAssets(builtinMemberAvatarRef(role))
      expect(assets).toEqual(BUILTIN_MEMBER_AVATAR_ASSETS[role])
      expect(Object.values(assets ?? {})).toHaveLength(5)
      expect(assets?.bust).not.toBe(assets?.glyphDay)
      expect(assets?.bust).not.toBe(assets?.glyphNight)
    }
  })

  it('does not treat managed, malformed, or legacy values as builtin assets', () => {
    expect(builtinMemberAvatarAssets(null)).toBeNull()
    expect(builtinMemberAvatarAssets('rovai://member-avatar/builtin/luoke/v2')).toBeNull()
    expect(
      builtinMemberAvatarAssets(
        'rovai://member-avatar/managed/123e4567-e89b-12d3-a456-426614174000'
      )
    ).toBeNull()
    expect(builtinMemberAvatarAssets('https://example.com/avatar.png')).toBeNull()
  })
})
