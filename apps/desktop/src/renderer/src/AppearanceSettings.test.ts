import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppearanceSettings } from './AppearanceSettings'

describe('appearance settings', () => {
  it('renders the global three-way preference without Camp-specific controls', () => {
    const markup = renderToStaticMarkup(createElement(AppearanceSettings, {
      appearance: { preference: 'system', resolvedTheme: 'night' },
      disabled: false,
      onChange: () => undefined
    }))

    expect(markup).toContain('跟随系统')
    expect(markup).toContain('Porcelain Day')
    expect(markup).toContain('Night · Reserved')
    expect(markup).not.toContain('当前视觉语言')
    expect(markup).not.toContain('Steel Strong')
    expect(markup).not.toContain('Camp 主题')
  })
})
