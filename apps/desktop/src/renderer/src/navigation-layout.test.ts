import { describe, expect, it } from 'vitest'
import { clampNavigationWidth, navigationDragLayout, navigationMaxWidth, parseNavigationLayout } from './navigation-layout'

describe('navigation layout preferences and collapse threshold', () => {
  it('recovers from corrupt storage and keeps a saved expanded width while collapsed', () => {
    for (const raw of [null, '{', 'null', 'false', '{"width":"300","collapsed":"true"}']) expect(parseNavigationLayout(raw)).toEqual({ width: 300, collapsed: false })
    expect(parseNavigationLayout('{"width":1e999}').width).toBe(300)
    expect(parseNavigationLayout('{"width":350,"collapsed":true}')).toEqual({ width: 350, collapsed: true })
    expect(parseNavigationLayout('{"width":0}').width).toBe(248)
    expect(parseNavigationLayout('{"width":900}').width).toBe(468)
  })
  it('uses the readable minimum as a snap threshold without erasing the pre-gesture width', () => {
    const before = { width: 350, collapsed: false }
    expect(navigationDragLayout(248, before, 468)).toEqual({ width: 248, collapsed: false })
    expect(navigationDragLayout(247, before, 468)).toEqual({ width: 350, collapsed: true })
    expect(navigationDragLayout(-10, before, 468)).toEqual({ width: 350, collapsed: true })
    expect(navigationDragLayout(260, { ...before, collapsed: true }, 468)).toEqual({ width: 260, collapsed: false })
    expect(navigationDragLayout(600, before, 300)).toEqual({ width: 300, collapsed: false })
  })
  it('reserves content space as a display constraint without changing the preference', () => {
    const saved = parseNavigationLayout('{"width":410}')
    expect(clampNavigationWidth(saved.width, navigationMaxWidth(900))).toBe(300)
    expect(clampNavigationWidth(saved.width, navigationMaxWidth(1440))).toBe(410)
    expect(navigationMaxWidth(520)).toBe(248)
  })
})
