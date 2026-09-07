import { DEFAULT_APPEARANCE } from '../../shared/appearance'
import { APPEARANCE_READING_CHANGED } from './reduced-motion'
import type { AppearanceSnapshot, ResolvedTheme, ThemePreference } from '@contracts'

export const THEME_OPTIONS: ReadonlyArray<{
  value: ThemePreference
  label: string
  englishLabel: string
  description: string
}> = [
  {
    value: 'system',
    label: '跟随系统',
    englishLabel: 'System',
    description: ''
  },
  {
    value: 'day',
    label: '日间',
    englishLabel: 'Porcelain Day',
    description: ''
  },
  {
    value: 'night',
    label: '夜间',
    englishLabel: 'Steel Night',
    description: ''
  }
]

export function resolvedThemeFromDocument(root: HTMLElement): ResolvedTheme {
  return root.dataset.theme === 'night' ? 'night' : 'day'
}

export function initialAppearanceSnapshot(root: HTMLElement): AppearanceSnapshot {
  return {
    ...DEFAULT_APPEARANCE,
    resolvedTheme: resolvedThemeFromDocument(root)
  }
}

export function applyAppearanceSnapshot(
  root: HTMLElement,
  snapshot: AppearanceSnapshot
): void {
  const previousReading = [root.style.getPropertyValue('--chat-font-size'), root.style.getPropertyValue('--document-preview-font-size'), root.style.getPropertyValue('--code-preview-font-size'), root.dataset.readingDensity, root.dataset.motionPreference].join(':')
  root.style.setProperty('--chat-font-size', `${snapshot.chatFontSize}px`)
  root.style.setProperty('--document-preview-font-size', `${snapshot.documentFontSize}px`)
  root.style.setProperty('--code-preview-font-size', `${snapshot.codeFontSize}px`)
  root.dataset.readingDensity = snapshot.readingDensity
  root.dataset.motionPreference = snapshot.motionPreference
  root.dataset.theme = snapshot.resolvedTheme
  root.style.colorScheme = snapshot.resolvedTheme === 'night' ? 'dark' : 'light'
  const currentReading = [`${snapshot.chatFontSize}px`, `${snapshot.documentFontSize}px`, `${snapshot.codeFontSize}px`, snapshot.readingDensity, snapshot.motionPreference].join(':')
  const view = root.ownerDocument?.defaultView
  if (previousReading !== currentReading && view) {
    root.ownerDocument.dispatchEvent(new view.Event(APPEARANCE_READING_CHANGED))
  }
}

const IDENTITY_COLOR_COUNT = 8

export function identityColorIndex(agentId: string): number {
  let hash = 0x811c9dc5
  for (const character of agentId) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % IDENTITY_COLOR_COUNT + 1
}

export function identityColorToken(agentId: string): string {
  return `var(--identity-${identityColorIndex(agentId)})`
}
