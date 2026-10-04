export type ThreadTimelineReadingPosition = {
  scrollTop: number
  followingLatest: boolean
}

export type ThreadTimelineViewportGeometry = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export type ThreadTimelineContentMarker = {
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
  previousPosition: ThreadTimelineReadingPosition | null,
  previousGeometry: ThreadTimelineViewportGeometry | null,
  currentGeometry: ThreadTimelineViewportGeometry
): boolean {
  if (campTimelineIsNearBottom(
    currentGeometry.scrollTop,
    currentGeometry.scrollHeight,
    currentGeometry.clientHeight
  )) return true
  if (previousPosition?.followingLatest !== true || !previousGeometry) return false
  return Math.abs(previousPosition.scrollTop - currentGeometry.scrollTop) <= 1
    || previousGeometry.scrollHeight !== currentGeometry.scrollHeight
    || previousGeometry.clientHeight !== currentGeometry.clientHeight
}

export function followLatestThreadTimeline(
  scroll: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>
): ThreadTimelineReadingPosition {
  const scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
  scroll.scrollTop = scrollTop
  return { scrollTop, followingLatest: true }
}

export function campTimelineContentChanged(
  previous: ThreadTimelineContentMarker,
  next: ThreadTimelineContentMarker
): boolean {
  return previous.itemId !== next.itemId || previous.itemCount !== next.itemCount
}

export function restoredThreadTimelineScrollTop(
  position: ThreadTimelineReadingPosition | null,
  scrollHeight: number,
  clientHeight: number
): number {
  const maximum = Math.max(0, scrollHeight - clientHeight)
  if (!position || position.followingLatest) return maximum
  return Math.min(maximum, Math.max(0, position.scrollTop))
}
