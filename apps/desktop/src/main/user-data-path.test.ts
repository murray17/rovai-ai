import { describe, expect, it } from 'vitest'
import { legacyUserDataPath } from './user-data-path'

describe('legacyUserDataPath', () => {
  it('keeps the existing Rovai-ai data directory after the display name changes to Rovai AI', () => {
    const existing = new Set(['/application-support/Rovai-ai'])
    expect(
      legacyUserDataPath(
        '/application-support',
        'Rovai AI',
        false,
        (path) => existing.has(path)
      )
    ).toBe('/application-support/Rovai-ai')
  })

  it('prefers the most recent existing Horizonward userData directory', () => {
    const existing = new Set([
      '/application-support/Horizonward',
      '/application-support/Lumen AI'
    ])
    expect(
      legacyUserDataPath(
        '/application-support',
        'Rovai-ai',
        false,
        (path) => existing.has(path)
      )
    ).toBe('/application-support/Horizonward')
  })

  it('keeps an existing Lumen userData directory when Rovai-ai has none', () => {
    const existing = new Set(['/application-support/Lumen AI'])
    expect(
      legacyUserDataPath(
        '/application-support',
        'Rovai-ai',
        false,
        (path) => existing.has(path)
      )
    ).toBe('/application-support/Lumen AI')
  })

  it('prefers the Rovai-ai directory once it exists', () => {
    const existing = new Set([
      '/application-support/Rovai-ai',
      '/application-support/Horizonward',
      '/application-support/Lumen AI'
    ])
    expect(
      legacyUserDataPath(
        '/application-support',
        'Rovai-ai',
        false,
        (path) => existing.has(path)
      )
    ).toBeNull()
  })

  it('does not override an explicit userData directory', () => {
    expect(
      legacyUserDataPath('/application-support', 'Rovai-ai', true, () => true)
    ).toBeNull()
  })
})
