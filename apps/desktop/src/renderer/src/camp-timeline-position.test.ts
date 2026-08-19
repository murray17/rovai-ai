import { describe, expect, it } from 'vitest'
import {
  campTimelineContentChanged,
  campTimelineFollowingLatestAfterScroll,
  campTimelineIsNearBottom,
  campTimelineReadingPositionFromStoredValue,
  followLatestCampTimeline,
  restoredCampTimelineScrollTop,
  storedCampTimelineReadingPositionsWithUpdate
} from './camp-timeline-position'

const CAMP_IDS = [
  'rvcamp_01h47kvsy5fk1shh6w1g60eec0',
  'rvcamp_01h47kvsy5fk1shh6w1g60eec1',
  'rvcamp_01h47kvsy5fk1shh6w1g60eec2',
  'rvcamp_01h47kvsy5fk1shh6w1g60eec3',
] as const

describe('Camp timeline reading positions', () => {
  it('round-trips one position and replaces the same Camp entry', () => {
    const first = storedCampTimelineReadingPositionsWithUpdate(
      null,
      CAMP_IDS[0],
      { scrollTop: 240, followingLatest: false },
      10
    )
    expect(campTimelineReadingPositionFromStoredValue(first, CAMP_IDS[0])).toEqual({
      scrollTop: 240,
      followingLatest: false
    })

    const second = storedCampTimelineReadingPositionsWithUpdate(
      first,
      CAMP_IDS[0],
      { scrollTop: 720, followingLatest: true },
      20
    )
    expect(campTimelineReadingPositionFromStoredValue(second, CAMP_IDS[0])).toEqual({
      scrollTop: 720,
      followingLatest: true
    })
    expect((JSON.parse(second) as { entries: unknown[] }).entries).toHaveLength(1)
  })

  it('rejects corrupt data and keeps only the newest bounded Camps', () => {
    expect(campTimelineReadingPositionFromStoredValue('{broken', CAMP_IDS[0])).toBeNull()
    let stored: string | null = null
    for (let index = 1; index <= 4; index += 1) {
      stored = storedCampTimelineReadingPositionsWithUpdate(
        stored,
        CAMP_IDS[index - 1],
        { scrollTop: index * 10, followingLatest: false },
        index,
        3
      )
    }
    expect(campTimelineReadingPositionFromStoredValue(stored, CAMP_IDS[0])).toBeNull()
    expect(campTimelineReadingPositionFromStoredValue(stored, CAMP_IDS[3])).toEqual({
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

  it('detects inserted timeline content even when a later tail item keeps the same id', () => {
    expect(campTimelineContentChanged(
      { itemId: 'stop:latest', itemCount: 2 },
      { itemId: 'stop:latest', itemCount: 3 }
    )).toBe(true)
    expect(campTimelineContentChanged(
      { itemId: 'stop:latest', itemCount: 3 },
      { itemId: 'stop:latest', itemCount: 3 }
    )).toBe(false)
  })

  it('moves to the new bottom when the visible timeline height shrinks', () => {
    const scroll = { scrollTop: 700, scrollHeight: 1_000, clientHeight: 180 }

    expect(followLatestCampTimeline(scroll)).toEqual({
      scrollTop: 820,
      followingLatest: true
    })
    expect(scroll.scrollTop).toBe(820)
  })

  it('keeps follow-latest through a viewport resize before the observer restores the bottom', () => {
    expect(campTimelineFollowingLatestAfterScroll(
      { scrollTop: 700, followingLatest: true },
      { scrollTop: 700, scrollHeight: 1_000, clientHeight: 300 },
      { scrollTop: 700, scrollHeight: 1_000, clientHeight: 180 }
    )).toBe(true)
  })

  it('stops following after user scrolls within unchanged timeline geometry', () => {
    expect(campTimelineFollowingLatestAfterScroll(
      { scrollTop: 700, followingLatest: true },
      { scrollTop: 700, scrollHeight: 1_000, clientHeight: 300 },
      { scrollTop: 500, scrollHeight: 1_000, clientHeight: 300 }
    )).toBe(false)
    expect(campTimelineFollowingLatestAfterScroll(
      { scrollTop: 500, followingLatest: false },
      { scrollTop: 500, scrollHeight: 1_000, clientHeight: 300 },
      { scrollTop: 500, scrollHeight: 1_000, clientHeight: 180 }
    )).toBe(false)
  })
})
