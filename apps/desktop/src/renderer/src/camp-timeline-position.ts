export type CampTimelineReadingPosition = {
  scrollTop: number
  followingLatest: boolean
}

export type CampTimelineContentMarker = {
  itemId: string | null
  itemCount: number
}

type StoredCampTimelineReadingPosition = CampTimelineReadingPosition & {
  campId: string
  updatedAt: number
}

type StoredCampTimelineReadingPositions = {
  version: 1
  entries: StoredCampTimelineReadingPosition[]
}

export const CAMP_TIMELINE_READING_POSITIONS_STORAGE_KEY =
  'rovai.camp-timeline-reading-positions.v1'
export const CAMP_TIMELINE_BOTTOM_THRESHOLD = 48
const CAMP_TIMELINE_READING_POSITION_LIMIT = 50

function storedPositionsFromValue(value: string | null): StoredCampTimelineReadingPosition[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as Partial<StoredCampTimelineReadingPositions>
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return []
    return parsed.entries.filter((entry): entry is StoredCampTimelineReadingPosition =>
      Boolean(entry)
      && typeof entry.campId === 'string'
      && entry.campId.length > 0
      && typeof entry.scrollTop === 'number'
      && Number.isFinite(entry.scrollTop)
      && entry.scrollTop >= 0
      && typeof entry.followingLatest === 'boolean'
      && typeof entry.updatedAt === 'number'
      && Number.isFinite(entry.updatedAt)
      && entry.updatedAt >= 0
    )
  } catch {
    return []
  }
}

export function campTimelineReadingPositionFromStoredValue(
  value: string | null,
  campId: string
): CampTimelineReadingPosition | null {
  const entry = storedPositionsFromValue(value)
    .filter((candidate) => candidate.campId === campId)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]
  return entry
    ? { scrollTop: entry.scrollTop, followingLatest: entry.followingLatest }
    : null
}

export function storedCampTimelineReadingPositionsWithUpdate(
  value: string | null,
  campId: string,
  position: CampTimelineReadingPosition,
  updatedAt = Date.now(),
  limit = CAMP_TIMELINE_READING_POSITION_LIMIT
): string {
  const boundedLimit = Math.max(1, Math.floor(limit))
  const nextEntry: StoredCampTimelineReadingPosition = {
    campId,
    scrollTop: Math.max(0, Number.isFinite(position.scrollTop) ? position.scrollTop : 0),
    followingLatest: position.followingLatest,
    updatedAt: Math.max(0, Number.isFinite(updatedAt) ? updatedAt : 0)
  }
  const entries = storedPositionsFromValue(value)
    .filter((entry) => entry.campId !== campId)
    .concat(nextEntry)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, boundedLimit)
  return JSON.stringify({ version: 1, entries } satisfies StoredCampTimelineReadingPositions)
}

export function campTimelineIsNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = CAMP_TIMELINE_BOTTOM_THRESHOLD
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}

export function followLatestCampTimeline(
  scroll: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>
): CampTimelineReadingPosition {
  const scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
  scroll.scrollTop = scrollTop
  return { scrollTop, followingLatest: true }
}

export function campTimelineContentChanged(
  previous: CampTimelineContentMarker,
  next: CampTimelineContentMarker
): boolean {
  return previous.itemId !== next.itemId || previous.itemCount !== next.itemCount
}

export function restoredCampTimelineScrollTop(
  position: CampTimelineReadingPosition | null,
  scrollHeight: number,
  clientHeight: number
): number {
  const maximum = Math.max(0, scrollHeight - clientHeight)
  if (!position || position.followingLatest) return maximum
  return Math.min(maximum, Math.max(0, position.scrollTop))
}
