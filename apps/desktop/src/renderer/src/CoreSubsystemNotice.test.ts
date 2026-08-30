import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CoreSubsystemNotice } from './CoreSubsystemNotice'

describe('Core feature degradation notice', () => {
  it('does not add a notice for healthy or still initializing features', () => {
    expect(renderToStaticMarkup(createElement(CoreSubsystemNotice, { subsystems: [
      { id: 'skills', state: 'ready', error: null },
      { id: 'mcp', state: 'initializing', error: null }
    ] }))).toBe('')
  })

  it('shows a retry and the real feature error without claiming the workspace is unavailable', () => {
    const markup = renderToStaticMarkup(createElement(CoreSubsystemNotice, { subsystems: [{
      id: 'skills', state: 'degraded',
      error: { code: 'subsystem_initialization_failed', message: 'Staging is not a directory', retryable: true, details: {} }
    }] }))
    expect(markup).toContain('工作区记录仍可使用')
    expect(markup).toContain('Skill Library')
    expect(markup).toContain('Staging is not a directory')
    expect(markup).toContain('重试受影响功能')
    expect(markup).not.toContain('disabled')
  })
})
