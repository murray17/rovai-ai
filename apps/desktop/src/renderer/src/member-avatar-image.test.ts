import { describe, expect, it } from 'vitest'
import {
  isMemberAvatarSourceLowQuality,
  normalizedMemberAvatarDimensions,
  validateDecodedMemberAvatarDimensions
} from './member-avatar-image'

describe('member avatar image limits', () => {
  it('normalizes without upsampling and caps the longest edge', () => {
    expect(normalizedMemberAvatarDimensions(1024, 1600)).toEqual({
      width: 1024,
      height: 1600
    })
    expect(normalizedMemberAvatarDimensions(4000, 3000)).toEqual({
      width: 2048,
      height: 1536
    })
    expect(normalizedMemberAvatarDimensions(3000, 4000)).toEqual({
      width: 1536,
      height: 2048
    })
  })

  it('rejects invalid, tiny, oversized and excessive-area dimensions', () => {
    for (const [width, height] of [
      [0, 512],
      [Number.NaN, 512],
      [255, 1024],
      [1024, 255],
      [8193, 512],
      [512, 8193],
      [8000, 5000]
    ]) {
      expect(() => validateDecodedMemberAvatarDimensions(width, height)).toThrow()
    }
  })

  it('warns below 512px without rejecting the 256px hard minimum', () => {
    expect(isMemberAvatarSourceLowQuality(256, 1024)).toBe(true)
    expect(isMemberAvatarSourceLowQuality(511, 800)).toBe(true)
    expect(isMemberAvatarSourceLowQuality(512, 512)).toBe(false)
  })
})
