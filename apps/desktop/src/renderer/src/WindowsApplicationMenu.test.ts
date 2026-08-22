import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  WindowsApplicationMenu,
  windowsApplicationMenuFocusIndex
} from './WindowsApplicationMenu'

describe('Windows application menu', () => {
  it('renders only the requested top-level application menu labels', () => {
    const markup = renderToStaticMarkup(createElement(WindowsApplicationMenu))
    expect(markup).toContain('role="menubar"')
    expect(markup).toContain('>File<')
    expect(markup).toContain('>Edit<')
    expect(markup).toContain('>View<')
    expect(markup).toContain('>Window<')
    expect(markup).toContain('accessKey="f"')
    expect(markup).toContain('accessKey="w"')
    expect(markup).not.toContain('Rovai AI')
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('<svg')
  })

  it('supports horizontal roving focus with Home and End boundaries', () => {
    expect(windowsApplicationMenuFocusIndex(3, 'ArrowRight')).toBe(0)
    expect(windowsApplicationMenuFocusIndex(0, 'ArrowLeft')).toBe(3)
    expect(windowsApplicationMenuFocusIndex(2, 'Home')).toBe(0)
    expect(windowsApplicationMenuFocusIndex(2, 'End')).toBe(3)
    expect(windowsApplicationMenuFocusIndex(2, 'ArrowDown')).toBeNull()
  })
})
