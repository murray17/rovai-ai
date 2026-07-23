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
    label: '家园晨光',
    englishLabel: 'Hearthlight Day',
    description: '清新、温暖，适合日常规划与长期协作。'
  },
  {
    value: 'night',
    label: '夜色营地',
    englishLabel: 'Night Camp',
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

