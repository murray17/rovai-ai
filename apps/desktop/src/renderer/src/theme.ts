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
    description: '随系统外观自动使用瓷灰日间或 Steel Night。'
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
    preference: 'system',
    resolvedTheme: resolvedThemeFromDocument(root)
  }
}

export function applyAppearanceSnapshot(
  root: HTMLElement,
  snapshot: AppearanceSnapshot
): void {
  root.dataset.theme = snapshot.resolvedTheme
  root.style.colorScheme = snapshot.resolvedTheme === 'night' ? 'dark' : 'light'
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
