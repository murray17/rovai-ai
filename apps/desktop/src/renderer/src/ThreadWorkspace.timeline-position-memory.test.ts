import { describe, expect, it } from 'vitest'
import {
  rememberedThreadTimelineReadingPosition,
  rememberThreadTimelineReadingPosition
} from './ThreadWorkspace'

describe('Thread timeline reading position memory', () => {
  it('stores copies and retains only the 50 most recently written Threads', () => {
    const threadId = (index: number): string => `timeline-memory-test-${index}`

    for (let index = 0; index < 50; index += 1) {
      rememberThreadTimelineReadingPosition(threadId(index), {
        scrollTop: index * 10,
        followingLatest: false
      })
    }

    const remembered = rememberedThreadTimelineReadingPosition(threadId(0))
    expect(remembered).toEqual({ scrollTop: 0, followingLatest: false })
    if (remembered) remembered.scrollTop = 999
    expect(rememberedThreadTimelineReadingPosition(threadId(0))).toEqual({
      scrollTop: 0,
      followingLatest: false
    })

    rememberThreadTimelineReadingPosition(threadId(0), {
      scrollTop: 720,
      followingLatest: true
    })
    rememberThreadTimelineReadingPosition(threadId(50), {
      scrollTop: -20,
      followingLatest: false
    })

    expect(rememberedThreadTimelineReadingPosition(threadId(1))).toBeNull()
    expect(rememberedThreadTimelineReadingPosition(threadId(0))).toEqual({
      scrollTop: 720,
      followingLatest: true
    })
    expect(rememberedThreadTimelineReadingPosition(threadId(50))).toEqual({
      scrollTop: 0,
      followingLatest: false
    })

    rememberThreadTimelineReadingPosition(threadId(50), {
      scrollTop: Number.NaN,
      followingLatest: true
    })
    expect(rememberedThreadTimelineReadingPosition(threadId(50))).toEqual({
      scrollTop: 0,
      followingLatest: true
    })
  })
})
