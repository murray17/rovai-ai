import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PageZoomIndicator } from './PageZoomFeedback'

describe('page zoom feedback', () => {
  it('renders the current percentage as polite, atomic status feedback', () => {
    const markup = renderToStaticMarkup(createElement(PageZoomIndicator, { percentage: 90 }))

    expect(markup).toContain('class="page-zoom-indicator"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('aria-atomic="true"')
    expect(markup).toContain('页面缩放')
    expect(markup).toContain('<strong>90%</strong>')
  })
})
