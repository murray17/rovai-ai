import { describe, expect, it } from 'vitest'
import {
  campTimelineIsNearBottom,
  campTimelineReadingPositionFromStoredValue,
  followLatestCampTimeline,
  restoredCampTimelineScrollTop,
  storedCampTimelineReadingPositionsWithUpdate
} from './camp-timeline-position'

describe('Camp timeline reading positions', () => {
  it('round-trips one position and replaces the same Camp entry', () => {
    const first = storedCampTimelineReadingPositionsWithUpdate(
      null,
      'camp-1',
      { scrollTop: 240, followingLatest: false },
      10
    )
    expect(campTimelineReadingPositionFromStoredValue(first, 'camp-1')).toEqual({
      scrollTop: 240,
      followingLatest: false
    })

    const second = storedCampTimelineReadingPositionsWithUpdate(
      first,
      'camp-1',
      { scrollTop: 720, followingLatest: true },
      20
    )
    expect(campTimelineReadingPositionFromStoredValue(second, 'camp-1')).toEqual({
      scrollTop: 720,
      followingLatest: true
    })
    expect((JSON.parse(second) as { entries: unknown[] }).entries).toHaveLength(1)
  })

  it('rejects corrupt data and keeps only the newest bounded Camps', () => {
    expect(campTimelineReadingPositionFromStoredValue('{broken', 'camp-1')).toBeNull()
    let stored: string | null = null
    for (let index = 1; index <= 4; index += 1) {
      stored = storedCampTimelineReadingPositionsWithUpdate(
        stored,
        `camp-${index}`,
        { scrollTop: index * 10, followingLatest: false },
        index,
        3
      )
    }
    expect(campTimelineReadingPositionFromStoredValue(stored, 'camp-1')).toBeNull()
    expect(campTimelineReadingPositionFromStoredValue(stored, 'camp-4')).toEqual({
      scrollTop: 40,
      followingLatest: false
    })
  })

  it('restores a reading offset unless the Camp was following the latest message', () => {
    expect(restoredCampTimelineScrollTop(null, 1_000, 300)).toBe(700)
    expect(restoredCampTimelineScrollTop(
      { scrollTop: 240, followingLatest: false },
      1_000,
      300
    )).toBe(240)
    expect(restoredCampTimelineScrollTop(
      { scrollTop: 900, followingLatest: false },
      1_000,
      300
    )).toBe(700)
    expect(restoredCampTimelineScrollTop(
      { scrollTop: 240, followingLatest: true },
      1_000,
      300
    )).toBe(700)
  })

  it('uses a small bottom tolerance for follow-latest behavior', () => {
    expect(campTimelineIsNearBottom(652, 1_000, 300)).toBe(true)
    expect(campTimelineIsNearBottom(651, 1_000, 300)).toBe(false)
  })

  it('moves an earlier reading position to the latest message after user submission', () => {
    const scroll = { scrollTop: 240, scrollHeight: 1_000, clientHeight: 300 }

    expect(followLatestCampTimeline(scroll)).toEqual({
      scrollTop: 700,
      followingLatest: true
    })
    expect(scroll.scrollTop).toBe(700)
  })
})
