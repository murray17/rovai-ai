import { describe, expect, it } from 'vitest'
import {
  rememberedCampTimelineReadingPosition,
  rememberCampTimelineReadingPosition
} from './CampWorkspace'

describe('Camp timeline reading position memory', () => {
  it('stores copies and retains only the 50 most recently written Camps', () => {
    const campId = (index: number): string => `timeline-memory-test-${index}`

    for (let index = 0; index < 50; index += 1) {
      rememberCampTimelineReadingPosition(campId(index), {
        scrollTop: index * 10,
        followingLatest: false
      })
    }

    const remembered = rememberedCampTimelineReadingPosition(campId(0))
    expect(remembered).toEqual({ scrollTop: 0, followingLatest: false })
    if (remembered) remembered.scrollTop = 999
    expect(rememberedCampTimelineReadingPosition(campId(0))).toEqual({
      scrollTop: 0,
      followingLatest: false
    })

    rememberCampTimelineReadingPosition(campId(0), {
      scrollTop: 720,
      followingLatest: true
    })
    rememberCampTimelineReadingPosition(campId(50), {
      scrollTop: -20,
      followingLatest: false
    })

    expect(rememberedCampTimelineReadingPosition(campId(1))).toBeNull()
    expect(rememberedCampTimelineReadingPosition(campId(0))).toEqual({
      scrollTop: 720,
      followingLatest: true
    })
    expect(rememberedCampTimelineReadingPosition(campId(50))).toEqual({
      scrollTop: 0,
      followingLatest: false
    })

    rememberCampTimelineReadingPosition(campId(50), {
      scrollTop: Number.NaN,
      followingLatest: true
    })
    expect(rememberedCampTimelineReadingPosition(campId(50))).toEqual({
      scrollTop: 0,
      followingLatest: true
    })
  })
})
