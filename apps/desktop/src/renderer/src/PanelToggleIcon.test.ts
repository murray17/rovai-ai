import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PanelToggleIcon } from './PanelToggleIcon'

describe('PanelToggleIcon', () => {
  it.each([
    ['left', true, 'M5 4v12', 'm14.5 6-4 4 4 4'],
    ['left', false, 'M5 4v12', 'm10.5 6 4 4-4 4'],
    ['right', true, 'M15 4v12', 'm5.5 6 4 4-4 4'],
    ['right', false, 'M15 4v12', 'm9.5 6-4 4 4 4']
  ] as const)('mirrors the %s panel when visibility is %s', (side, visible, edge, arrow) => {
    const markup = renderToStaticMarkup(createElement(PanelToggleIcon, { side, visible }))

    expect(markup).toContain(`d="${edge}"`)
    expect(markup).toContain(`d="${arrow}"`)
    expect(markup).toContain('aria-hidden="true"')
  })
})
