import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  filePreviewDragWidth,
  filePreviewRatioForWidth,
  filePreviewRatioFromStoredValue,
  filePreviewWidthForRatio
} from './file-preview-layout'

describe('File preview split geometry', () => {
  it('starts at 44/56 while protecting the conversation and preview reading widths', () => {
    expect(filePreviewWidthForRatio(1_200, .56)).toBeCloseTo(672)
    expect(filePreviewWidthForRatio(841, .56)).toBe(421)
    expect(filePreviewWidthForRatio(1_200, .1)).toBe(420)
    expect(filePreviewWidthForRatio(1_200, .9)).toBe(780)
  })

  it('allows transient closing widths but only commits stable split ratios', () => {
    expect(filePreviewDragWidth(1_200, 319)).toBe(319)
    expect(filePreviewDragWidth(1_200, -20)).toBe(0)
    expect(filePreviewDragWidth(1_200, 900)).toBe(780)
    expect(filePreviewRatioForWidth(1_200, 350)).toBe(.35)
    expect(filePreviewRatioForWidth(1_200, 900)).toBe(.65)
    expect(filePreviewRatioForWidth(1_200, Number.NaN)).toBeNull()
  })

  it('uses one reading plane below the split threshold without producing a replacement preference', () => {
    expect(filePreviewWidthForRatio(840, .56)).toBe(840)
    expect(filePreviewRatioForWidth(840, 700)).toBeNull()
    const preferredRatio = .65
    expect(filePreviewWidthForRatio(1_000, preferredRatio)).toBe(580)
    expect(filePreviewWidthForRatio(2_000, preferredRatio)).toBe(1_300)
  })

  it('recovers from invalid storage and accepts stable ratios from very wide workspaces', () => {
    for (const stored of [null, '', 'NaN', 'Infinity', '0', '1', '-.2', '900px']) {
      expect(filePreviewRatioFromStoredValue(stored)).toBe(.56)
    }
    expect(filePreviewRatioFromStoredValue('.9')).toBe(.9)
  })
})

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const rules = Array.from(styles.matchAll(/([^{}]+)\{([^{}]*)\}/g), ([, selectors, declarations]) => ({
  selectors: selectors.trim().split(/\s*,\s*/),
  declarations
}))

function declarations(selector: string): string[] {
  return rules.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.declarations)
}

function gridTracks(selector: string): string[] {
  return declarations(selector).flatMap((rule) => {
    const value = rule.match(/grid-template-columns:\s*([^;]+);/)
    return value ? [value[1]] : []
  })
}

describe('File preview reading planes', () => {
  it('shares the conversation surface across the preview base and all viewer canvases', () => {
    for (const selector of [
      '.file-preview-pane',
      '.file-preview-path-row',
      '.file-preview-code',
      '.file-preview-html',
      '.file-preview-image-stage',
      '.file-preview-patch',
      '.file-preview-patch-outline',
      '.file-preview-page-controls'
    ]) {
      expect(declarations(selector)[0], selector).toContain('background: var(--conversation-surface);')
    }
    expect(declarations('.file-preview-image-stage')[0]).not.toContain('background-image:')
    expect(declarations('.file-preview-image-stage img')[0]).toContain('background-image:')
  })

  it('keeps header and body tracks equal without reserving a column for Camp details', () => {
    expect(gridTracks('.camp-topbar.has-file-preview')).toEqual([
      'minmax(0, 1fr) var(--file-preview-width, 56%)'
    ])
    expect(gridTracks('.camp-topbar.has-file-preview')).toEqual(
      gridTracks('.workspace-grid.file-preview-open.inspector-collapsed')
    )
    expect(gridTracks('.camp-topbar.has-file-preview.file-preview-compact')).toEqual(['minmax(0, 1fr)'])
    expect(gridTracks('.camp-topbar.has-file-preview.file-preview-compact')).toEqual(
      gridTracks('.workspace-grid.file-preview-open.inspector-collapsed.file-preview-compact')
    )
  })

  it('uses the full preview tab strip without reserving an obsolete inspector toggle', () => {
    expect(declarations('.camp-topbar')[0]).toContain('position: relative;')
    expect(declarations('.file-preview-tabs')[0]).toContain(
      'padding: 5px var(--file-preview-tabs-end-padding, 6px) 5px 6px;'
    )
    const padding = declarations('.camp-topbar.has-file-preview')
      .filter((rule) => rule.includes('--file-preview-tabs-end-padding:'))
    expect(padding).toHaveLength(1)
    expect(padding[0]).toContain('--file-preview-tabs-end-padding: 6px;')
    expect(declarations('.camp-detail-popover')[0]).toContain('position: absolute;')
  })
})

describe('File preview tab interaction styles', () => {
  it('always shows the selected close control while reserving the same space for every tab', () => {
    const inactive = declarations('.file-preview-tab-close')[0]
    expect(inactive).toContain('width: 24px;')
    expect(inactive).toContain('flex: 0 0 24px;')
    expect(inactive).toContain('opacity: 0;')
    expect(inactive).toContain('pointer-events: none;')
    for (const selector of [
      '.file-preview-tab.is-active .file-preview-tab-close',
      '.file-preview-tab:hover .file-preview-tab-close',
      '.file-preview-tab:focus-within .file-preview-tab-close'
    ]) {
      expect(declarations(selector)[0]).toContain('opacity: 1;')
      expect(declarations(selector)[0]).toContain('pointer-events: auto;')
    }
  })

  it('keeps arrival motion on the label and the repeat feedback clear of all hit targets', () => {
    expect(declarations('.file-preview-tab')[0]).not.toContain('animation:')
    expect(declarations('.file-preview-tab.is-arriving .file-preview-tab-activate > span:first-child')[0])
      .toContain('animation: file-preview-tab-arrive 200ms')
    const feedback = declarations('.file-preview-tab-open-feedback')[0]
    expect(feedback).toContain('position: absolute;')
    expect(feedback).toContain('pointer-events: none;')
    expect(feedback).toContain('opacity: 0;')
    expect(feedback).toContain('animation: file-preview-tab-open-feedback 300ms')
    const arrival = styles.match(/@keyframes file-preview-tab-arrive\s*\{([\s\S]*?)\n\}/)?.[1]
    expect(arrival).toContain('translateX(6px)')
    expect(arrival).not.toMatch(/(?:width|height|margin|left|top):/)
  })

  it('disables both entry movement and feedback flashing for reduced motion', () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.file-preview-tab\.is-arriving \.file-preview-tab-activate > span:first-child,\s*\.file-preview-tab-open-feedback \{ animation: none; \}/)
  })
})
