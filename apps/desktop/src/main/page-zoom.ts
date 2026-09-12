import { APPEARANCE_ZOOM_FACTORS, APPEARANCE_ZOOM_OPTIONS } from '../shared/appearance'

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

// Saved preferences still accept legacy values below the first Chrome preset.
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

export function pageZoomFactor(percentage: number): number {
  const index = APPEARANCE_ZOOM_OPTIONS.indexOf(percentage)
  return index === -1 ? percentage / 100 : APPEARANCE_ZOOM_FACTORS[index]
}

export function nextPageZoomPercentage(
  currentZoomFactor: number,
  action: PageZoomAction
): number | null {
  const currentPercentage = pageZoomPercentage(currentZoomFactor)
  if (currentPercentage === null) return null
  if (action === 'reset') return 100

  if (action === 'in') {
    return APPEARANCE_ZOOM_OPTIONS.find((percentage) => percentage > currentPercentage)
      ?? currentPercentage
  }

  return APPEARANCE_ZOOM_OPTIONS.findLast((percentage) => percentage < currentPercentage)
    ?? currentPercentage
}
