import { describe, expect, it } from 'vitest'
import {
  applyAppearanceSnapshot,
  identityColorIndex,
  identityColorToken,
  initialAppearanceSnapshot,
  resolvedThemeFromDocument,
  THEME_OPTIONS
} from './theme'

function rootWithTheme(theme?: string): HTMLElement {
  return {
    dataset: theme ? { theme } : {},
    style: {}
  } as unknown as HTMLElement
}

describe('renderer theme model', () => {
  it('exposes the three stable settings options', () => {
    expect(THEME_OPTIONS.map((option) => option.value)).toEqual(['system', 'day', 'night'])
  })

  it('resolves the first-paint theme from the document without reviving obsolete themes', () => {
    expect(resolvedThemeFromDocument(rootWithTheme('night'))).toBe('night')
    expect(initialAppearanceSnapshot(rootWithTheme('night'))).toEqual({
      preference: 'system',
      resolvedTheme: 'night'
    })
    expect(resolvedThemeFromDocument(rootWithTheme('day'))).toBe('day')
    expect(resolvedThemeFromDocument(rootWithTheme('obsolete'))).toBe('day')
  })

  it('applies a snapshot without replacing the root element', () => {
    const root = rootWithTheme('day')
    applyAppearanceSnapshot(root, { preference: 'night', resolvedTheme: 'night' })
    expect(root.dataset.theme).toBe('night')
    expect(root.style.colorScheme).toBe('dark')

    applyAppearanceSnapshot(root, { preference: 'day', resolvedTheme: 'day' })
    expect(root.dataset.theme).toBe('day')
    expect(root.style.colorScheme).toBe('light')
  })

  it('maps a stable AgentProfile id to one of the shared identity tokens', () => {
    const first = identityColorIndex('agent_2')
    expect(first).toBeGreaterThanOrEqual(1)
    expect(first).toBeLessThanOrEqual(8)
    expect(identityColorIndex('agent_2')).toBe(first)
    expect(identityColorToken('agent_2')).toBe(`var(--identity-${first})`)
  })
})
