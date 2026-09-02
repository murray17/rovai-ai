import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CampDetailPopover } from './CampDetailPopover'

const source = readFileSync(new URL('./CampDetailPopover.tsx', import.meta.url), 'utf8')

describe('Camp detail popover dismissal', () => {
  it('stays open when pointer or focus moves outside', () => {
    expect(source).not.toContain("addEventListener('pointerdown'")
    expect(source).not.toContain("addEventListener('focusin'")
  })

  it('keeps Escape and the explicit close control available', () => {
    expect(source).toContain("addEventListener('keydown', dismissOnEscape)")

    const markup = renderToStaticMarkup(createElement(CampDetailPopover, {
      activeTab: 'tasks',
      visible: true,
      executionCount: 0,
      runningCount: 0,
      taskCount: 2,
      memberCount: 3,
      onOpen: () => undefined,
      onClose: () => undefined,
      children: createElement('div', null, '详情')
    }))

    expect(markup).toContain('aria-label="收起会话详情"')
    expect(markup).toContain('<kbd>Esc</kbd> 收起')
  })
})
