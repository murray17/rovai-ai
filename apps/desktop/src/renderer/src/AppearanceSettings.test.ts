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
    expect(markup).toContain('北极晨光')
    expect(markup).toContain('Night · Reserved')
    expect(markup).toContain('当前 · 北极晨光 Day')
    expect(markup).not.toContain('Camp 主题')
  })
})
