import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GeneralSettings, loginItemCanToggle, loginItemStatusMessage } from './GeneralSettings'

describe('General settings', () => {
  it('renders the complete General information architecture and native control semantics', () => {
    const markup = renderToStaticMarkup(createElement(GeneralSettings))
    expect(markup).toContain('Settings / General')
    expect(markup).toContain('<h1>通用</h1>')
    expect(markup).toContain('登录时启动 Rovai-ai')
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('<legend>启动后打开</legend>')
    expect(markup).toContain('type="radio"')
    expect(markup).toContain('上次使用的位置')
    expect(markup).toContain('快速对话')
    expect(markup).toContain('已有 Camp、草稿、任务、审批和运行记录')
    expect(markup).toContain('重置窗口大小与位置')
    expect(markup).not.toContain('记住窗口位置')
    expect(markup).not.toContain('隐藏启动')
  })

  it('makes development and missing services non-configurable', () => {
    expect(loginItemCanToggle({ status: 'development', checked: false, effective: false })).toBe(false)
    expect(loginItemCanToggle({ status: 'not-found', checked: false, effective: false })).toBe(false)
    expect(loginItemCanToggle({ status: 'requires-approval', checked: true, effective: false })).toBe(true)
    expect(loginItemStatusMessage({ status: 'development', checked: false, effective: false }))
      .toBe('仅在已安装的 Rovai-ai 应用中可配置')
    expect(loginItemStatusMessage({ status: 'requires-approval', checked: true, effective: false }))
      .toContain('当前尚未生效')
  })
})
