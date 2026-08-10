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
    description: '当前统一使用瓷灰日间主题。'
  },
  {
    value: 'day',
    label: '日间',
    englishLabel: 'Porcelain Day',
    description: '冷瓷灰与克制的 Steel 强调，适合长期协作。'
  },
  {
    value: 'night',
    label: '夜间',
    englishLabel: 'Night · Reserved',
    description: '偏好会保留；当前仍显示瓷灰日间主题。'
  }
]

export function resolvedThemeFromDocument(root: HTMLElement): ResolvedTheme {
  void root
  return 'day'
}

export function initialAppearanceSnapshot(root: HTMLElement): AppearanceSnapshot {
  return {
    preference: 'system',
    resolvedTheme: resolvedThemeFromDocument(root)
  }
}

export function applyAppearanceSnapshot(
  root: HTMLElement,
  _snapshot: AppearanceSnapshot
): void {
  root.dataset.theme = 'day'
  root.style.colorScheme = 'light'
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
