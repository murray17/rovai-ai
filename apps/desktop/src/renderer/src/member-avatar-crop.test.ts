import { describe, expect, it } from 'vitest'
import {
  MAX_AVATAR_CROP_SIZE,
  MIN_AVATAR_CROP_SIZE,
  avatarCropSizeFromZoomPercent,
  avatarCropToPixels,
  avatarCropToStageTransform,
  avatarCropZoomPercent,
  clampAvatarCrop,
  defaultAvatarCrop,
  moveAvatarCropFromStageDrag
} from './member-avatar-crop'

describe('member avatar crop model', () => {
  it('clamps square, landscape and portrait crops into source bounds', () => {
    for (const [width, height] of [
      [1024, 1024],
      [2048, 512],
      [512, 2048]
    ]) {
      const crop = clampAvatarCrop(
        { centerX: -2, centerY: 3, size: 4 },
        width,
        height
      )
      const pixels = avatarCropToPixels(crop, width, height)
      expect(crop.size).toBe(MAX_AVATAR_CROP_SIZE)
      expect(pixels.x).toBeGreaterThanOrEqual(0)
      expect(pixels.y).toBeGreaterThanOrEqual(0)
      expect(pixels.x + pixels.size).toBeLessThanOrEqual(width)
      expect(pixels.y + pixels.size).toBeLessThanOrEqual(height)
    }
  })

  it('rejects non-finite crop values and dimensions', () => {
    expect(() =>
      clampAvatarCrop({ centerX: Number.NaN, centerY: 0.5, size: 0.5 }, 100, 100)
    ).toThrow('finite')
    expect(() =>
      clampAvatarCrop({ centerX: 0.5, centerY: 0.5, size: Number.POSITIVE_INFINITY }, 100, 100)
    ).toThrow('finite')
    expect(() => defaultAvatarCrop(0, 100)).toThrow('positive')
    expect(() =>
      avatarCropToStageTransform(defaultAvatarCrop(100, 100), 100, 100, -1)
    ).toThrow('positive')
  })

  it('keeps zoom conversion stable at both ends', () => {
    expect(avatarCropSizeFromZoomPercent(0)).toBe(MAX_AVATAR_CROP_SIZE)
    expect(avatarCropSizeFromZoomPercent(100)).toBe(MIN_AVATAR_CROP_SIZE)
    expect(
      avatarCropZoomPercent({ centerX: 0.5, centerY: 0.5, size: MAX_AVATAR_CROP_SIZE })
    ).toBe(0)
    expect(
      avatarCropZoomPercent({ centerX: 0.5, centerY: 0.5, size: MIN_AVATAR_CROP_SIZE })
    ).toBe(100)
  })

  it('uses the measured stage size for pointer movement', () => {
    const crop = defaultAvatarCrop(1600, 1000)
    const narrow = moveAvatarCropFromStageDrag(crop, 20, 0, 1600, 1000, 280)
    const wide = moveAvatarCropFromStageDrag(crop, 20, 0, 1600, 1000, 336)
    expect(narrow.centerX).toBeLessThan(crop.centerX)
    expect(wide.centerX).toBeLessThan(crop.centerX)
    expect(Math.abs(narrow.centerX - crop.centerX)).toBeGreaterThan(
      Math.abs(wide.centerX - crop.centerX)
    )
  })

  it('never emits an out-of-bounds pixel crop across 100,000 deterministic cases', () => {
    let state = 0x6d2b79f5
    const random = (): number => {
      state = Math.imul(state ^ (state >>> 15), 1 | state)
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state)
      return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296
    }
    for (let index = 0; index < 100_000; index += 1) {
      const width = 1 + random() * 8191
      const height = 1 + random() * 8191
      const crop = clampAvatarCrop(
        {
          centerX: random() * 4 - 1.5,
          centerY: random() * 4 - 1.5,
          size: random() * 2 - 0.5
        },
        width,
        height
      )
      const pixels = avatarCropToPixels(crop, width, height)
      if (
        pixels.size <= 0
        || pixels.x < -1e-9
        || pixels.y < -1e-9
        || pixels.x + pixels.size > width + 1e-9
        || pixels.y + pixels.size > height + 1e-9
      ) {
        throw new Error(`out-of-bounds crop at deterministic case ${index}`)
      }
    }
  })
})
