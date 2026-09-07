import { useSyncExternalStore } from 'react'

export const APPEARANCE_READING_CHANGED = 'rovai:appearance-reading-changed'

export function prefersReducedMotion(): boolean {
  return typeof document !== 'undefined' && (
    document.documentElement.dataset.motionPreference === 'reduce'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function subscribe(listener: () => void): () => void {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  document.addEventListener(APPEARANCE_READING_CHANGED, listener)
  media.addEventListener('change', listener)
  return () => {
    document.removeEventListener(APPEARANCE_READING_CHANGED, listener)
    media.removeEventListener('change', listener)
  }
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false)
}
