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

  it('uses the first-paint document theme as the initial resolved value', () => {
    expect(resolvedThemeFromDocument(rootWithTheme('night'))).toBe('night')
    expect(initialAppearanceSnapshot(rootWithTheme('night'))).toEqual({
      preference: 'system',
      resolvedTheme: 'night'
    })
    expect(resolvedThemeFromDocument(rootWithTheme('obsolete'))).toBe('day')
  })

  it('applies a snapshot without replacing the root element', () => {
    const root = rootWithTheme('day')
    applyAppearanceSnapshot(root, { preference: 'night', resolvedTheme: 'night' })
    expect(root.dataset.theme).toBe('night')
    expect(root.style.colorScheme).toBe('dark')
  })

  it('maps a stable AgentProfile id to one of the shared identity tokens', () => {
    const first = identityColorIndex('agent-muwa')
    expect(first).toBeGreaterThanOrEqual(1)
    expect(first).toBeLessThanOrEqual(8)
    expect(identityColorIndex('agent-muwa')).toBe(first)
    expect(identityColorToken('agent-muwa')).toBe(`var(--identity-${first})`)
  })
})
