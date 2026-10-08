export const USER_ANCHOR_MIN_COUNT = 4
export const USER_ANCHOR_MIN_WIDTH = 760
export const USER_ANCHOR_ROW_HEIGHT = 10
export const USER_ANCHOR_MAX_HEIGHT = 360

export interface UserMessageAnchor {
  id: string
  title: string
}

export function userAnchorStackHeight(count: number, stageHeight: number): number {
  const cap = Math.max(0, Math.min(USER_ANCHOR_MAX_HEIGHT, stageHeight * .7, stageHeight - 24))
  return Math.min(count, Math.floor(cap / USER_ANCHOR_ROW_HEIGHT)) * USER_ANCHOR_ROW_HEIGHT
}

export function userAnchorKeyIndex(key: string, index: number, count: number, height: number): number | null {
  const page = Math.max(1, Math.floor(height / USER_ANCHOR_ROW_HEIGHT) - 1)
  const next = key === 'ArrowDown' ? index + 1 : key === 'ArrowUp' ? index - 1
    : key === 'PageDown' ? index + page : key === 'PageUp' ? index - page
      : key === 'Home' ? 0 : key === 'End' ? count - 1 : null
  return next === null ? null : Math.max(0, Math.min(count - 1, next))
}
