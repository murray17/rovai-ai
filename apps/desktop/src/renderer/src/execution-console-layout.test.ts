import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const mobileStyles = readFileSync(new URL('../../../../web/src/mobile.css', import.meta.url), 'utf8')
const workspaceSource = readFileSync(new URL('./CampWorkspace.tsx', import.meta.url), 'utf8')

function styleBlock(selector: string, source = styles): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? null
}

describe('execution console layout', () => {
  it.each([
    '.camp-detail-popover[data-detail="execution"]',
    '.run-pulse',
    '.run-pulse-inspector',
    '.run-pulse-chip',
    '.execution-drawer',
    '.execution-process-card',
    '.execution-run-card-header',
    '.execution-process-node'
  ])('uses the conversation surface for the execution canvas: %s', (selector) => {
    expect(styleBlock(selector)).toMatch(/background:\s*var\(--conversation-surface\)/)
  })

  it('keeps all Run states on the conversation surface without a running fill override', () => {
    expect(styleBlock('.camp-conversation-view-controls button[aria-pressed="true"]')).toMatch(
      /background:\s*var\(--brand-soft\)/
    )
    expect(styleBlock('.execution-drawer')).not.toMatch(
      /--execution-running-surface:/
    )
    expect(styleBlock('.execution-drawer-header')).toMatch(
      /background:\s*var\(--conversation-surface\)/
    )
    expect(styleBlock('.execution-process-stage.status-running .execution-process-card')).not.toMatch(/background:/)
    expect(styleBlock('.execution-process-stage.is-focused .execution-process-card') ?? '').not.toMatch(
      /background:/
    )
    expect(styleBlock('.execution-process-stage.is-focused.status-running .execution-process-card') ?? '').not.toMatch(
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
    expect(styleBlock('.run-pulse-chip.is-selected')).toMatch(/background:\s*var\(--surface-selected\)/)
    expect(styleBlock('.run-pulse-inspector .run-pulse-chip.is-selected')).toMatch(
      /background:\s*var\(--surface-selected\)/
    )
  })

  it('keeps the existing avatar-to-name spacing in the bottom dock', () => {
    expect(styleBlock('.run-pulse-chip')).toMatch(/(?:^|;)\s*gap:\s*6px/)
    expect(styleBlock('.run-pulse-chip-copy')).toMatch(/margin-inline-start:\s*4px/)
  })

  it('restores the bottom rail and keeps its member controls on one compact row', () => {
    expect(styleBlock('.run-pulse-bottom')).toMatch(/display:\s*flex/)
    expect(styleBlock('.run-pulse-bottom')).toMatch(/min-height:\s*55px/)
    expect(styleBlock('.run-pulse-bottom .run-pulse-chip')).toMatch(/height:\s*34px/)
    expect(styleBlock('.run-pulse-bottom .run-pulse-list')).toMatch(/scrollbar-width:\s*none/)
    expect(styleBlock('.execution-drawer-bottom .execution-drawer-title-line')).toMatch(
      /display:\s*flex/
    )
    expect(styleBlock('.execution-drawer-bottom .execution-drawer-title-line')).toMatch(
      /flex-wrap:\s*nowrap/
    )
  })

  it('aligns the floating and right rails with the placement control on one row', () => {
    expect(styleBlock('.run-pulse-inspector')).toMatch(/display:\s*flex/)
    expect(styleBlock('.run-pulse-inspector')).toMatch(/align-items:\s*center/)
    expect(styleBlock('.run-pulse-avatar-rail')).toMatch(/flex:\s*1 1 auto/)
    expect(styleBlock('.run-pulse-inspector .execution-placement-control')).toMatch(
      /align-self:\s*center/
    )
  })

  it('matches the compact Run card controls from the interaction prototype', () => {
    expect(styleBlock('.execution-run-operations button')).toMatch(/width:\s*26px/)
    expect(styleBlock('.execution-run-operations button')).toMatch(/height:\s*25px/)
    expect(styleBlock('.execution-run-trailing')).toMatch(/padding-right:\s*9px/)
    expect(styleBlock('.execution-run-operations')).not.toMatch(/opacity:\s*0|pointer-events:\s*none/)
    expect(styleBlock('.execution-run-operations button')).toMatch(/border:\s*1px solid var\(--line\)/)
    expect(styleBlock('.execution-run-operations button')).toMatch(/background:\s*var\(--surface-raised\)/)
    expect(styleBlock('.execution-run-operations button.is-danger')).toMatch(/color:\s*var\(--danger\)/)
    expect(styleBlock('.execution-run-operations button.is-danger')).toMatch(
      /background:\s*var\(--danger-soft\)/
    )
    expect(styleBlock('.execution-batch-count')).toMatch(/height:\s*26px/)
    expect(styleBlock('.execution-batch-count')).toMatch(/cursor:\s*pointer/)
    expect(styleBlock('.execution-batch-count')).toMatch(/font:\s*10\.5px\/1/)
    expect(styleBlock('.execution-batch-count svg')).toMatch(/stroke-width:\s*1\.5/)
    expect(styleBlock('.execution-run-card-header')).toMatch(/position:\s*sticky/)
    expect(styleBlock('.execution-run-card-header')).toMatch(/top:\s*0/)
    expect(styleBlock('.execution-run-summary')).toMatch(/font-weight:\s*600/)
    expect(styleBlock('.execution-drawer-body')).toMatch(/scroll-padding-block:\s*60px 16px/)
  })

  it('uses the confirmed 8px Run rhythm on Desktop and Web without changing Mobile', () => {
    expect(styleBlock(':root:not([data-mobile-web="true"]) .execution-process-timeline::before'))
      .toMatch(/bottom:\s*18px/)
    expect(styleBlock(':root:not([data-mobile-web="true"]) .execution-process-stage'))
      .toMatch(/padding-bottom:\s*8px/)
    expect(styleBlock('.execution-process-card > [id^="execution-run-content-"]'))
      .toMatch(/padding:\s*12px 10px 10px/)
    expect(styleBlock(':root:not([data-mobile-web="true"]) .execution-process-card > [id^="execution-run-content-"]'))
      .toMatch(/padding:\s*8px 10px/)
    expect(styleBlock(':root:not([data-mobile-web="true"]) .execution-process-card > [id^="execution-run-content-"] > .execution-disclosure'))
      .toMatch(/margin:\s*0/)
    expect(styleBlock(':root:not([data-mobile-web="true"]) .execution-process-card .process-content'))
      .toMatch(/--process-item-gap:\s*8px;\s*padding:\s*0/)
    expect(workspaceSource).toMatch(/const processItemGap = mobile \? 14 : 8/)
    expect(workspaceSource).toMatch(/enabled=\{windowedEvidence\} gap=\{processItemGap\}/)
    expect(workspaceSource).toMatch(/\? 4 : processItemGap/)

    expect(styleBlock('html[data-mobile-web="true"] .execution-process-stage', mobileStyles))
      .toMatch(/padding-bottom:\s*8px/)
    expect(styleBlock('html[data-mobile-web="true"] .execution-drawer .process-content', mobileStyles))
      .toMatch(/--process-item-gap:\s*4px;[^}]*padding:\s*4px 0 2px/)
    expect(styleBlock('html[data-mobile-web="true"] .execution-disclosure > summary', mobileStyles))
      .toMatch(/min-height:\s*44px/)
    expect(styleBlock('html[data-mobile-web="true"] .execution-drawer :is(.tool-call-summary, .tool-group-summary)', mobileStyles))
      .toMatch(/min-height:\s*32px/)
  })

  it('swaps live elapsed time only on title hover or visible keyboard focus in a fixed slot', () => {
    expect(styleBlock('.execution-process-stage.status-running .execution-run-trailing')).toMatch(/width:\s*77px/)
    expect(styleBlock('.execution-process-stage.status-running .execution-run-operations')).toMatch(/opacity:\s*0/)
    expect(styleBlock('.execution-process-stage.status-running .execution-run-operations')).toMatch(/right:\s*9px/)
    const activeTitle = '.execution-process-stage.status-running .execution-run-card-header:is(:hover, :has(:focus-visible))'
    expect(styleBlock(`${activeTitle} .execution-run-operations`)).toMatch(/opacity:\s*1/)
    expect(styleBlock(`${activeTitle} .execution-run-metric`)).toMatch(/opacity:\s*0/)
    expect(styles).not.toMatch(/(?:^|\n)\s*\.execution-run-metric\.is-live\s*\{[^}]*display:\s*none/)
    expect(styleBlock('.execution-process-stage.status-waiting .execution-run-metric.is-live')).toMatch(/display:\s*none/)
    expect(styles).not.toMatch(/\.execution-process-card:(?:hover|focus-within)[^{]*\.execution-run-operations/)
    expect(styles).toMatch(/@media \(hover: none\), \(pointer: coarse\)[\s\S]*?\.execution-run-operations\s*\{[^}]*position:\s*static;\s*opacity:\s*1/)
  })

  it('centers the status rail on the 46px title and keeps overview avatars square', () => {
    expect(styleBlock('.execution-run-card-header')).toMatch(/min-height:\s*46px/)
    expect(styleBlock('.execution-process-timeline::before')).toMatch(/top:\s*24px/)
    expect(styleBlock('.execution-process-timeline::before')).toMatch(/bottom:\s*23px/)
    expect(styleBlock('.execution-process-node')).toMatch(/margin-top:\s*17px/)
    expect(styleBlock('.execution-run-toggle .member-avatar')).toMatch(/width:\s*20px/)
    expect(styleBlock('.execution-run-toggle .member-avatar')).toMatch(/height:\s*20px/)
    expect(workspaceSource.match(/overview && <MemberAvatar[\s\S]{0,180}?size="execution"/g))
      .toHaveLength(3)
  })

  it('keeps the user receipt and message actions on one footer row', () => {
    expect(styleBlock('.message-action-line')).toMatch(/display:\s*flex/)
    expect(styleBlock('.message-action-line')).toMatch(/align-items:\s*center/)
    expect(styleBlock('.message-action-line')).toMatch(/justify-content:\s*flex-end/)
    expect(styleBlock('.message-action-line > .user-message-receipt-row,\n.message-action-line > .message-actions'))
      .toMatch(/transform:\s*none/)
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

  it('keeps empty and deferred Tool result states on the Shell result canvas', () => {
    expect(styleBlock('.tool-result-state')).toMatch(/color:\s*var\(--evidence-muted\)/)
    expect(styleBlock('.tool-result-state')).toMatch(/background:\s*var\(--shell-result-canvas\)/)
    expect(styleBlock('.tool-result-spinner')).toMatch(/border-top-color:\s*var\(--evidence-muted\)/)
    expect(styleBlock('.tool-result-spinner')).not.toMatch(/var\(--(?:brand|info|success|attention)\)/)
  })
})
