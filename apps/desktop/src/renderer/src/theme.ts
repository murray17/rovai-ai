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
    description: '随 macOS 外观自动切换。'
  },
  {
    value: 'day',
    label: '晨线',
    englishLabel: 'Meridian Day',
    description: '清晰、安定，适合日常规划与长期协作。'
  },
  {
    value: 'night',
    label: '夜航',
    englishLabel: 'Meridian Night',
    description: '低眩光、专注，适合执行、审批与夜间工作。'
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

export function identityColorIndex(agentProfileId: string): number {
  let hash = 0x811c9dc5
  for (const character of agentProfileId) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % IDENTITY_COLOR_COUNT + 1
}

export function identityColorToken(agentProfileId: string): string {
  return `var(--identity-${identityColorIndex(agentProfileId)})`
}
