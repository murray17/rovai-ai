import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

function styleBlock(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? null
}

describe('execution console layout', () => {
  it.each([
    '.camp-detail-popover[data-detail="execution"]',
    '.run-pulse',
    '.run-pulse-inspector',
    '.run-pulse-chip',
    '.execution-drawer',
    '.execution-process-card',
    '.execution-process-node'
  ])('uses the conversation surface for the execution canvas: %s', (selector) => {
    expect(styleBlock(selector)).toMatch(/background:\s*var\(--conversation-surface\)/)
  })

  it('shares the approved execution fill between running Run cards and their action bar without changing view buttons', () => {
    expect(styleBlock('.camp-conversation-view-controls button[aria-pressed="true"]')).toMatch(
      /background:\s*var\(--brand-soft\)/
    )
    expect(styleBlock('.execution-drawer')).not.toMatch(
      /--execution-running-surface:/
    )
    expect(styleBlock('.execution-drawer-header')).toMatch(
      /background:\s*var\(--execution-running-surface\)/
    )
    expect(styleBlock('.execution-process-stage.status-running .execution-process-card')).toMatch(
      /background:\s*var\(--execution-running-surface\)/
    )
    expect(styleBlock('.execution-process-stage.is-focused .execution-process-card')).not.toMatch(
      /background:/
    )
    expect(styleBlock('.execution-process-stage.is-focused.status-running .execution-process-card')).not.toMatch(
      /background:/
    )
  })

  it.each([
    '.execution-drawer-header',
    '.execution-process-stage.status-running .execution-process-card'
  ])('keeps secondary text readable on the execution fill: %s', (selector) => {
    expect(styleBlock(selector)).toMatch(/--faint:\s*var\(--muted\)/)
    expect(styleBlock('.execution-drawer')).not.toMatch(/--faint:/)
  })

  it('blends the avatar rail status backplates and overflow fades into the execution canvas', () => {
    const status = styleBlock('.run-pulse-avatar-rail .run-pulse-chip-state')
    expect(status).toMatch(/border:\s*2px solid var\(--conversation-surface\)/)
    expect(status).toMatch(/background:\s*var\(--conversation-surface\)/)
    expect(styleBlock('.run-pulse-avatar-scroll.is-left')).toMatch(
      /background:\s*linear-gradient\(to right, var\(--conversation-surface\) 54%, transparent\)/
    )
    expect(styleBlock('.run-pulse-avatar-scroll.is-right')).toMatch(
      /background:\s*linear-gradient\(to left, var\(--conversation-surface\) 54%, transparent\)/
    )
  })

  it('preserves the other detail popovers and semantic selection backgrounds', () => {
    expect(styleBlock('.camp-detail-popover')).toMatch(/background:\s*var\(--inspector-surface\)/)
    expect(styleBlock('.run-pulse-chip.is-selected')).toMatch(/background:\s*var\(--brand-soft\)/)
    expect(styleBlock('.run-pulse-inspector .run-pulse-chip.is-selected')).toMatch(
      /background:\s*var\(--brand-soft\)/
    )
  })

  it('keeps the existing avatar-to-name spacing in the bottom dock', () => {
    expect(styleBlock('.run-pulse-chip')).toMatch(/(?:^|;)\s*gap:\s*6px/)
    expect(styleBlock('.run-pulse-chip-copy')).toMatch(/margin-inline-start:\s*4px/)
  })

  it('uses immediate drawer scrolling while JavaScript owns latest-position restoration', () => {
    expect(styleBlock('.execution-drawer-body')).toMatch(/scroll-behavior:\s*auto/)
    expect(styleBlock('.execution-drawer-body')).not.toMatch(/scroll-behavior:\s*smooth/)
  })

  it('keeps the Tool group operation count visible in the right sidecar', () => {
    expect(styles).not.toMatch(
      /\.execution-drawer-inspector \.tool-group-count\s*\{[^}]*display:\s*none/
    )
  })

  it('places the Tool group icon and copy on one shared 16px center line', () => {
    expect(styleBlock('.tool-group-icon')).toMatch(/height:\s*16px/)
    expect(styleBlock('.tool-group-icon')).toMatch(/align-self:\s*center/)
    expect(styleBlock('.tool-group-copy')).toMatch(/display:\s*flex/)
    expect(styleBlock('.tool-group-copy')).toMatch(/min-height:\s*16px/)
    expect(styleBlock('.tool-group-copy')).toMatch(/align-items:\s*center/)
    expect(styleBlock('.tool-group-line')).toMatch(/align-items:\s*center/)
    expect(styleBlock('.tool-group-line')).toMatch(/line-height:\s*16px/)
  })
})
