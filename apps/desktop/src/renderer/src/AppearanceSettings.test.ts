import { DEFAULT_APPEARANCE } from '../../shared/appearance'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppearanceSettings } from './AppearanceSettings'

describe('appearance settings', () => {
  it('renders the global three-way preference without Camp-specific controls', () => {
    const markup = renderToStaticMarkup(createElement(AppearanceSettings, {
      appearance: { ...DEFAULT_APPEARANCE, preference: 'system', resolvedTheme: 'night' },
      disabled: false,
      onChange: async (preferences) => ({ ...preferences, resolvedTheme: 'night' })
    }))

    expect(markup).toContain('跟随系统')
    expect(markup).toContain('Porcelain Day')
    expect(markup).toContain('Steel Night')
    expect(markup).not.toContain('随系统外观自动使用瓷灰日间或 Steel Night')
    expect(markup).not.toContain('冷瓷灰与克制的 Steel 强调')
    expect(markup).not.toContain('冷石墨表面')
    expect(markup).not.toContain('选择偏好不会生成对话事件、消息或审计记录')
    expect(markup).not.toContain('Reserved')
    expect(markup).not.toContain('当前视觉语言')
    expect(markup).not.toContain('Steel Strong')
    expect(markup).not.toContain('Camp 主题')
  })
})


it('reports an unreadable preference source without claiming defaults were saved', () => {
  const markup = renderToStaticMarkup(createElement(AppearanceSettings, {
    appearance: { ...DEFAULT_APPEARANCE, resolvedTheme: 'day', degradation: { code: 'appearance_preferences_invalid', message: 'Invalid source', retryable: true, details: {} } },
    disabled: false,
    onChange: async (preferences) => ({ ...preferences, resolvedTheme: 'day' })
  }))
  expect(markup).toContain('无法读取已保存的外观设置，当前使用默认值。')
  expect(markup).toContain('保存当前设置')
  expect(markup).toContain('未保存')
  expect(markup).not.toContain('>已保存<')
})

it('keeps a shortcut zoom value outside the common choices representable', () => {
  const markup = renderToStaticMarkup(createElement(AppearanceSettings, {
    appearance: { ...DEFAULT_APPEARANCE, zoomPercentage: 250, resolvedTheme: 'day' },
    disabled: false,
    onChange: async (preferences) => ({ ...preferences, resolvedTheme: 'day' })
  }))
  expect(markup).toContain('<option value="250" selected="">250%</option>')
})
