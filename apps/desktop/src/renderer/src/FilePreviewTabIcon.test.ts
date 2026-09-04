import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResourceReferenceIcon } from './FilePreviewTabIcon'
import type { ResourceReferenceVisualKind } from './file-reference-presentation'

const approvedGlyphMarkers: ReadonlyArray<readonly [ResourceReferenceVisualKind, string]> = [
  ['web', 'r="8.25"'],
  ['folder', 'M3.75 8.75'],
  ['markdown', 'M8 14.8V9.2'],
  ['html', 'm9.2 9.25-2 2 2 2'],
  ['code', 'm9 8.5-3 3.5 3 3.5'],
  ['config', 'M6.75 5.75h8.5'],
  ['text', 'M6.8 5.5h10.4'],
  ['image', 'm7 16 3.2-3.4'],
  ['svg', 'm9 15 2.5-5.5'],
  ['patch', 'M8 6.5h8'],
  ['pdf', 'M8.2 15.2v-4.4'],
  ['document', 'M8.4 11h6.4'],
  ['spreadsheet', 'M9.7 5.8v12.4'],
  ['presentation', 'M12 16.5v2.7'],
  ['notebook', 'M8 5.5h8.3'],
  ['archive', 'M10.4 5.5h3.2'],
  ['audio', 'M9.2 16.5a1.9'],
  ['video', 'm16.75 10.2 2.7-1.5'],
  ['database', 'rx="5.8" ry="2.35"'],
  ['executable', 'm16.4 7.9 1.4 1.4'],
  ['file', 'M7 5.5h7.7']
]

describe('resource reference glyphs', () => {
  it.each(approvedGlyphMarkers)('renders the approved %s geometry', (kind, marker) => {
    const markup = renderToStaticMarkup(createElement(ResourceReferenceIcon, {
      kind,
      className: 'resource-icon'
    }))

    expect(markup).toContain(`data-resource-type="${kind}"`)
    expect(markup).toContain(marker)
    expect(markup).toContain('viewBox="0 0 24 24"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('focusable="false"')
  })

  it('keeps every visual type distinct', () => {
    const glyphs = approvedGlyphMarkers.map(([kind]) => renderToStaticMarkup(createElement(
      ResourceReferenceIcon,
      { kind, className: 'resource-icon' }
    )).replace(/ data-resource-type="[^"]+"/u, ''))

    expect(new Set(glyphs).size).toBe(approvedGlyphMarkers.length)
  })
})
