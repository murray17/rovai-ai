import { DEFAULT_APPEARANCE } from '../../shared/appearance'
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
    style: { setProperty(key: string, value: string) { (this as unknown as Record<string, string>)[key] = value }, getPropertyValue(key: string) { return (this as unknown as Record<string, string>)[key] ?? '' } }
  } as unknown as HTMLElement
}

describe('renderer theme model', () => {
  it('exposes the three stable settings options', () => {
    expect(THEME_OPTIONS.map((option) => option.value)).toEqual(['system', 'day', 'night'])
  })

  it('resolves the first-paint theme from the document without reviving obsolete themes', () => {
    expect(resolvedThemeFromDocument(rootWithTheme('night'))).toBe('night')
    expect(initialAppearanceSnapshot(rootWithTheme('night'))).toEqual({
      ...DEFAULT_APPEARANCE,
      preference: 'system',
      resolvedTheme: 'night'
    })
    expect(resolvedThemeFromDocument(rootWithTheme('day'))).toBe('day')
    expect(resolvedThemeFromDocument(rootWithTheme('obsolete'))).toBe('day')
  })

  it('applies a snapshot without replacing the root element', () => {
    const root = rootWithTheme('day')
    applyAppearanceSnapshot(root, { ...DEFAULT_APPEARANCE, preference: 'night', resolvedTheme: 'night' })
    expect(root.dataset.theme).toBe('night')
    expect(root.style.colorScheme).toBe('dark')

    applyAppearanceSnapshot(root, { ...DEFAULT_APPEARANCE, preference: 'day', resolvedTheme: 'day' })
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


it('applies independent reading preferences while retaining unrelated document state', () => {
  const root = rootWithTheme('day')
  root.dataset.activeCamp = 'camp-fixture'
  applyAppearanceSnapshot(root, { ...DEFAULT_APPEARANCE, resolvedTheme: 'day', chatFontSize: 20, documentFontSize: 18, codeFontSize: 24, readingDensity: 'relaxed', motionPreference: 'reduce' })
  expect(root.style.getPropertyValue('--chat-font-size')).toBe('20px')
  expect(root.style.getPropertyValue('--document-preview-font-size')).toBe('18px')
  expect(root.style.getPropertyValue('--code-preview-font-size')).toBe('24px')
  expect(root.dataset.readingDensity).toBe('relaxed')
  expect(root.dataset.motionPreference).toBe('reduce')
  expect(root.dataset.activeCamp).toBe('camp-fixture')
  applyAppearanceSnapshot(root, { ...DEFAULT_APPEARANCE, resolvedTheme: 'day' })
  expect(root.dataset.motionPreference).toBe('system')
  expect(root.style.getPropertyValue('--chat-font-size')).toBe('13px')
})
