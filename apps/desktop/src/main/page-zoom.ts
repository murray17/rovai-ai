export interface PageZoomKeyboardInput {
  type: string
  key: string
  code: string
  isComposing: boolean
  control: boolean
  alt: boolean
  meta: boolean
}

export type PageZoomAction = 'in' | 'out' | 'reset'

export const PAGE_ZOOM_STEP_PERCENTAGE = 10
export const MIN_PAGE_ZOOM_PERCENTAGE = 10
export const MAX_PAGE_ZOOM_PERCENTAGE = 500

export function pageZoomAction(
  input: PageZoomKeyboardInput,
  platform: NodeJS.Platform
): PageZoomAction | null {
  if (input.type !== 'keyDown' || input.isComposing || input.alt) return null
  const primaryModifier = platform === 'darwin' ? input.meta : input.control
  const secondaryModifier = platform === 'darwin' ? input.control : input.meta
  if (!primaryModifier || secondaryModifier) return null

  if (input.key === '-' || input.code === 'Minus' || input.code === 'NumpadSubtract') {
    return 'out'
  }
  if (input.key === '=' || input.key === '+' || input.code === 'Equal' || input.code === 'NumpadAdd') {
    return 'in'
  }
  if (input.key === '0' || input.code === 'Digit0' || input.code === 'Numpad0') {
    return 'reset'
  }
  return null
}

export function pageZoomPercentage(zoomFactor: number): number | null {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) return null
  return Math.round(zoomFactor * 100)
}

export function nextPageZoomPercentage(
  currentZoomFactor: number,
  action: PageZoomAction
): number | null {
  const currentPercentage = pageZoomPercentage(currentZoomFactor)
  if (currentPercentage === null) return null
  if (action === 'reset') return 100

  if (action === 'in') {
    if (currentPercentage >= MAX_PAGE_ZOOM_PERCENTAGE) return currentPercentage
    return Math.min(
      currentPercentage + PAGE_ZOOM_STEP_PERCENTAGE,
      MAX_PAGE_ZOOM_PERCENTAGE
    )
  }

  if (currentPercentage <= MIN_PAGE_ZOOM_PERCENTAGE) return currentPercentage
  return Math.max(
    currentPercentage - PAGE_ZOOM_STEP_PERCENTAGE,
    MIN_PAGE_ZOOM_PERCENTAGE
  )
}
