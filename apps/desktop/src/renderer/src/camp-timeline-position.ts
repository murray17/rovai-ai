export type CampTimelineReadingPosition = {
  scrollTop: number
  followingLatest: boolean
}

export type CampTimelineViewportGeometry = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export type CampTimelineContentMarker = {
  itemId: string | null
  itemCount: number
}

export const CAMP_TIMELINE_BOTTOM_THRESHOLD = 48

export function campTimelineIsNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = CAMP_TIMELINE_BOTTOM_THRESHOLD
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}

export function campTimelineFollowingLatestAfterScroll(
  previousPosition: CampTimelineReadingPosition | null,
  previousGeometry: CampTimelineViewportGeometry | null,
  currentGeometry: CampTimelineViewportGeometry
): boolean {
  if (campTimelineIsNearBottom(
    currentGeometry.scrollTop,
    currentGeometry.scrollHeight,
    currentGeometry.clientHeight
  )) return true
  if (previousPosition?.followingLatest !== true || !previousGeometry) return false
  return previousGeometry.scrollHeight !== currentGeometry.scrollHeight
    || previousGeometry.clientHeight !== currentGeometry.clientHeight
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
