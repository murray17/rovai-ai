export const NAVIGATION_DEFAULT_WIDTH = 300
export const NAVIGATION_MIN_WIDTH = 248
export const NAVIGATION_MAX_WIDTH = 468
export const NAVIGATION_ICON_RAIL_WIDTH = 48
export const NAVIGATION_LAYOUT_KEY = 'rovai.navigation-layout.v1'
export type NavigationLayout = { width: number; collapsed: boolean }

export function navigationMaxWidth(viewport: number): number {
  return Math.max(NAVIGATION_MIN_WIDTH, Math.min(NAVIGATION_MAX_WIDTH, viewport - 600))
}
export function clampNavigationWidth(width: number, maximum = NAVIGATION_MAX_WIDTH): number {
  return Math.round(Math.max(NAVIGATION_MIN_WIDTH, Math.min(maximum, width)))
}
export function parseNavigationLayout(raw: string | null): NavigationLayout {
  const fallback = { width: NAVIGATION_DEFAULT_WIDTH, collapsed: false }
  try {
    const saved = JSON.parse(raw ?? 'null') as Partial<NavigationLayout> | null
    if (!saved || typeof saved !== 'object') return fallback
    return {
      width: typeof saved.width === 'number' && Number.isFinite(saved.width) ? clampNavigationWidth(saved.width) : fallback.width,
      collapsed: saved.collapsed === true
    }
  } catch { return fallback }
}
export function navigationDragLayout(width: number, before: NavigationLayout, maximum: number): NavigationLayout {
  return width < NAVIGATION_MIN_WIDTH
    ? { ...before, collapsed: true }
    : { width: clampNavigationWidth(width, maximum), collapsed: false }
}
