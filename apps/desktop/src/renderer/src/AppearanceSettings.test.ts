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
    expect(markup).toContain('Steel Night')
    expect(markup).toContain('随系统外观自动使用瓷灰日间或 Steel Night')
    expect(markup).not.toContain('冷瓷灰与克制的 Steel 强调')
    expect(markup).not.toContain('冷石墨表面')
    expect(markup).not.toContain('选择偏好不会生成对话事件、消息或审计记录')
    expect(markup).not.toContain('Reserved')
    expect(markup).not.toContain('当前视觉语言')
    expect(markup).not.toContain('Steel Strong')
    expect(markup).not.toContain('Camp 主题')
  })
})
