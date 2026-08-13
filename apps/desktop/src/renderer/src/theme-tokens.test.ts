import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const requiredTokens = [
  '--canvas',
  '--surface',
  '--surface-raised',
  '--surface-subtle',
  '--surface-muted',
  '--surface-selected',
  '--conversation-surface',
  '--inspector-surface',
  '--conversation-inspector-line',
  '--home-surface',
  '--ink',
  '--muted',
  '--faint',
  '--line',
  '--line-strong',
  '--control-line',
  '--brand',
  '--brand-hover',
  '--brand-contrast',
  '--brand-soft',
  '--brand-ink',
  '--mention-ink',
  '--mention-ink-hover',
  '--rail',
  '--rail-ink',
  '--rail-line',
  '--rail-logo',
  '--success',
  '--success-soft',
  '--attention',
  '--attention-soft',
  '--danger',
  '--danger-soft',
  '--info',
  '--info-soft',
  '--neutral',
  '--neutral-soft',
  '--focus',
  '--overlay',
  '--evidence-canvas',
  '--evidence-surface',
  '--evidence-ink',
  '--evidence-muted',
  '--evidence-line',
  '--diff-add',
  '--diff-add-soft',
  '--diff-remove',
  '--diff-remove-soft'
] as const

function tokenBlock(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match?.[1]) throw new Error(`Missing CSS block: ${selector}`)
  return Object.fromEntries(
    [...match[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)]
      .map((entry) => [entry[1], entry[2].trim()])
  )
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(left: string, right: string): number {
  const leftLuminance = luminance(left)
  const rightLuminance = luminance(right)
  return (Math.max(leftLuminance, rightLuminance) + 0.05)
    / (Math.min(leftLuminance, rightLuminance) + 0.05)
}

function expectTextContrast(tokens: Record<string, string>): void {
  const pairs = [
    ['--ink', '--surface'],
    ['--muted', '--surface'],
    ['--faint', '--surface'],
    ['--brand-contrast', '--brand'],
    ['--success', '--success-soft'],
    ['--attention', '--attention-soft'],
    ['--danger', '--danger-soft'],
    ['--info', '--info-soft'],
    ['--neutral', '--neutral-soft'],
    ['--evidence-ink', '--evidence-surface'],
    ['--evidence-muted', '--evidence-surface'],
    ['--diff-add', '--diff-add-soft'],
    ['--diff-remove', '--diff-remove-soft']
  ] as const
  for (const [foreground, background] of pairs) {
    expect(
      contrast(tokens[foreground], tokens[background]),
      `${foreground} on ${background}`
    ).toBeGreaterThanOrEqual(4.5)
  }
  for (let index = 1; index <= 8; index += 1) {
    const token = `--identity-${index}`
    expect(
      contrast(tokens[token], tokens['--surface']),
      `${token} on --surface`
    ).toBeGreaterThanOrEqual(4.5)
  }
}

describe('Porcelain Day + Steel Night theme tokens', () => {
  const day = tokenBlock(':root')
  const night = tokenBlock(':root[data-theme="night"]')

  it('defines the complete canonical Day token contract', () => {
    for (const token of requiredTokens) {
      expect(day[token], `Day ${token}`).toBeTruthy()
    }
    for (let index = 1; index <= 8; index += 1) {
      expect(day[`--identity-${index}`]).toBeTruthy()
    }
  })

  it('defines the complete canonical Night token contract', () => {
    for (const token of requiredTokens) {
      expect(night[token], `Night ${token}`).toBeTruthy()
    }
    for (let index = 1; index <= 8; index += 1) {
      expect(night[`--identity-${index}`]).toBeTruthy()
    }
  })

  it('keeps normal text and semantic labels at WCAG AA contrast', () => {
    expectTextContrast(day)
    expectTextContrast(night)
  })

  it('scopes the approved porcelain surfaces and Steel emphasis', () => {
    expect(day['--canvas']).toBe('#eceeef')
    expect(day['--conversation-surface']).toBe('#ffffff')
    expect(day['--inspector-surface']).toBe('#ffffff')
    expect(day['--conversation-inspector-line']).toBe('#c7cfd6')
    expect(day['--home-surface']).toBe('#ffffff')
    expect(day['--surface']).toBe('#fbfbfa')
    expect(day['--surface-subtle']).toBe('#f0f2f4')
    expect(day['--line']).toBe('#dfe4e8')
    expect(day['--brand']).toBe('#526f88')
    expect(day['--brand-soft']).toBe('#e9eef3')
    expect(day['--brand-ink']).toBe('#405f7e')
    expect(day['--rail']).toBe('#f3f4f4')
    expect(day['--rail-line']).toBe('#dadde0')
    expect(day['--rail-logo']).toBe('#526f88')
    expect(day['--mention-ink']).toBe('#2f61c8')
    expect(contrast(day['--mention-ink'], day['--surface'])).toBeGreaterThanOrEqual(4.5)
    expect(css).toContain('.camp-workspace { background: var(--conversation-surface); }')
    expect(css).toContain('border-left: 1px solid var(--conversation-inspector-line)')
    expect(css).toContain('background: var(--inspector-surface)')
    expect(css).toContain('.new-conversation-workspace { background: var(--home-surface); }')
    expect(css).toContain('background: var(--brand-soft)')
    expect(css).toMatch(/\.final-copy\s*\{[^}]*color: var\(--ink\)[^}]*\}/)
    expect(css).not.toMatch(/\.final-copy\s*\{[^}]*background:/)
  })

  it('uses the independently designed Steel Night palette without collapsing semantic colors', () => {
    expect(night['--canvas']).toBe('#0d1114')
    expect(night['--conversation-surface']).toBe('#181d21')
    expect(night['--inspector-surface']).toBe('#171d21')
    expect(night['--surface']).toBe('#151a1e')
    expect(night['--surface-raised']).toBe('#1b2227')
    expect(night['--brand']).toBe('#7897ae')
    expect(night['--brand-soft']).toBe('#22303a')
    expect(night['--mention-ink']).toBe('#9cc7e2')
    expect(night['--success']).not.toBe(night['--brand'])
    expect(night['--attention']).not.toBe(night['--brand'])
    expect(night['--danger']).not.toBe(night['--brand'])
    expect(night['--info']).not.toBe(night['--brand'])
    expect(contrast(night['--mention-ink'], night['--surface'])).toBeGreaterThanOrEqual(4.5)
  })

  it('preserves stable identity colors for Skill, MCP, and member marks in both themes', () => {
    expect(new Set(Array.from({ length: 8 }, (_, index) => day[`--identity-${index + 1}`])).size).toBe(8)
    expect(new Set(Array.from({ length: 8 }, (_, index) => night[`--identity-${index + 1}`])).size).toBe(8)
    expect(css).toMatch(/\.skill-card-mark\s*\{[^}]*color:\s*var\(--skill-identity\)/)
    expect(css).toMatch(/\.mcp-assignment-option-mark, \.mcp-server-mark\s*\{[^}]*color:\s*var\(--mcp-identity\)/)
  })

  it('uses quiet selected backgrounds for the active Camp and current Project', () => {
    expect(css).toMatch(/\.camp-nav-row\.selected\s*\{[^}]*background: var\(--surface-selected\)/)
    expect(css).toMatch(/\.project-heading-row\.current-project\s*\{[^}]*background: var\(--surface-selected\)/)
  })

  it('lets the Members and Memory workspaces own the window top edge', () => {
    expect(css).toContain(`.content.compose-content,
.content.settings-content,
.content.members-content,
.content.memory-content { grid-row: 1 / -1; }`)
    expect(css).not.toContain('.window-drag-strip-members')
    expect(css).not.toContain('.window-drag-strip-memory')
    expect(css).toMatch(/\.memory-library\s*\{[^}]*padding: 30px 28px 24px/)
    expect(css).toMatch(/\.memory-library-header\s*\{[^}]*align-items: flex-end[^}]*padding: 0 0 19px/)
    expect(css).toContain('.memory-page-kicker')
    expect(css).toMatch(/\.member-detail-scroll\s*\{[^}]*padding: 30px 26px 48px/)
    expect(css).toMatch(/\.member-detail-header\s*\{[^}]*-webkit-app-region: drag/)
  })

  it('keeps user and Agent narrative on one open surface and widens only work artifacts at 2K', () => {
    expect(css).toMatch(/\.conversation-bubble\.agent\s*\{[^}]*--agent-accent: var\(--identity-1\)/)
    expect(css).not.toMatch(/\.conversation-bubble\.agent\s*\{[^}]*background:/)
    expect(css).not.toMatch(/\.conversation-bubble\.agent\s+\.final-copy\s*\{[^}]*background:/)
    expect(css).toMatch(/\.final-copy\s*\{[^}]*color: var\(--ink\)[^}]*\}/)
    expect(css).toMatch(/\.message-bubble\s*\{[^}]*max-width: min\(var\(--conversation-prose-width\), 100%\)[^}]*background: transparent/)
    expect(css).not.toMatch(/\.message-bubble\s*\{[^}]*background: var\(--brand-soft\)/)
    expect(css).toContain('.conversation-bubble:is(.user, .agent):hover::before')
    expect(css).toMatch(/\.message-body\s*\{[^}]*position: relative[^}]*padding-right: 30px/)
    expect(css).toMatch(/\.message-surface\s*\{[^}]*position: static/)
    expect(css).toContain('.conversation-bubble:hover .message-copy-button')
    expect(css).not.toContain('.message-surface.has-delivery .message-copy-button')
    expect(css).toMatch(
      /@media\s*\(min-width:\s*1800px\)[\s\S]*?\.timeline-track\s*\{[^}]*width:\s*min\(var\(--conversation-wide-width\), 100%\)/
    )
    expect(css).toMatch(
      /\.conversation-bubble\.agent \.safe-markdown > :where\(pre, table\)\s*\{[^}]*width:\s*min\(var\(--conversation-artifact-width\), 100%\)/
    )
    expect(css).toMatch(
      /@media\s*\(min-width:\s*1800px\)[\s\S]*?\.timeline-event-card\s*\{[^}]*width:\s*min\(var\(--conversation-artifact-width\), 100%\)/
    )
    expect(css).toMatch(
      /@media\s*\(min-width:\s*1800px\)[\s\S]*?\.approval-dock, \.runtime-recovery-dock\s*\{[^}]*width:\s*min\(var\(--conversation-wide-width\), calc\(100% - 54px\)\)/
    )
  })

  it('keeps long Tool output copy as a light icon inside the existing evidence preview', () => {
    expect(css).toMatch(/\.tool-call-detail\s*\{[^}]*position:\s*relative[^}]*margin:\s*7px 0 0 24px/)
    expect(css).toMatch(/\.tool-output-copy-button\s*\{[^}]*position:\s*absolute[^}]*width:\s*25px[^}]*height:\s*25px[^}]*border:\s*0/)
    expect(css).toMatch(/\.tool-call-detail\.is-truncated > pre\s*\{[^}]*padding-right:\s*36px/)
    expect(css).not.toContain('.tool-output-copy-button {\n  border: 1px')
  })

  it('widens the 2K composer and keeps the Enter keycap beside Send', () => {
    expect(css).toMatch(
      /@media\s*\(min-width:\s*1800px\)\s*\{\s*\.composer-box\s*\{[^}]*width:\s*min\(1040px,\s*100%\)/
    )
    expect(css).toMatch(/\.composer-actions\s*\{[^}]*gap:\s*5px[^}]*align-items:\s*center/)
    expect(css).toMatch(/\.composer-hint\s*\{[^}]*border:\s*1px solid var\(--line\)[^}]*white-space:\s*nowrap/)
    expect(css).toMatch(/\.composer-send\s*\{[^}]*min-height:\s*28px/)
  })

  it('uses a focused Task and Team Inspector without legacy Context or Approval cards', () => {
    expect(css).toMatch(/\.task-action-row\s*\{[^}]*position:\s*sticky[^}]*min-height:\s*42px/)
    expect(css).toMatch(/\.task-action-button\s*\{[^}]*width:\s*100%[^}]*background:\s*transparent/)
    expect(css).toMatch(/\.task-action-button > span\s*\{[^}]*background:\s*var\(--brand-soft\)/)
    expect(css).toMatch(/\.task-list-row\s*\{[^}]*grid-template-columns:\s*4px minmax\(0, 1fr\) auto/)
    expect(css).toMatch(/\.task-state-dot\.state-in_progress\s*\{[^}]*background:\s*var\(--brand\)/)
    expect(css).toMatch(/\.camp-members-summary\s*\{[^}]*position:\s*sticky/)
    expect(css).toMatch(/\.camp-lead-picker\s*\{[^}]*grid-template-columns:\s*28px minmax\(0, 1fr\) 16px/)
    expect(css).toMatch(/\.camp-lead-menu-item\[data-disabled\]\s*\{[^}]*cursor:\s*not-allowed/)
    expect(css).not.toContain('.context-card {')
    expect(css).not.toContain('.approval-card {')
    expect(css).not.toContain('.task-panel-toolbar {')
  })

  it('keeps the Composer Skill picker in the accepted native Steel dropdown', () => {
    expect(css).toMatch(/\.skill-picker-menu\s*\{[^}]*max-height:\s*310px/)
    expect(css).toMatch(/\.skill-picker-menu button\s*\{[^}]*min-height:\s*46px[^}]*grid-template-columns:\s*28px minmax\(0, 1fr\) auto/)
    expect(css).toMatch(/\.skill-picker-glyph\s*\{[^}]*width:\s*28px[^}]*height:\s*28px[^}]*color:\s*var\(--brand-hover\)/)
    expect(css).toMatch(/\.skill-picker-enter\s*\{[^}]*color:\s*var\(--faint\)/)
  })

  it('renders A2A recipients as blue interactive mentions', () => {
    expect(css).toMatch(/\.message-delivery-recipient-name\s*\{[^}]*color: var\(--mention-ink\)/)
    expect(css).toMatch(/\.message-mention-token\.is-interactive\s*\{[^}]*cursor:\s*pointer/)
  })

  it('shows General question-mark help only while the mark is hovered', () => {
    expect(css).toContain('.general-help-mark:hover + .general-help-popover')
    expect(css).not.toContain('.general-help-mark:focus')
    expect(css).not.toContain('.skill-import-help')
  })

  it('uses readable identity-colored Skill rows and a bounded MCP workbench', () => {
    expect(css).toMatch(/\.skill-card-grid\s*\{[^}]*max-width:\s*940px[^}]*border-top:/)
    expect(css).toMatch(/\.skill-card\s*\{[^}]*--skill-identity:\s*var\(--identity-1\)/)
    expect(css).toMatch(/\.skill-library-columns, \.skill-card-primary\s*\{[^}]*grid-template-columns:\s*42px minmax\(0, 1fr\) var\(--skill-actions-width\)/)
    expect(css).toMatch(/\.skill-library-columns > div, \.skill-card-controls\s*\{[^}]*grid-template-columns:\s*138px 62px 66px/)
    expect(css).toMatch(/\.skill-card-mark\s*\{[^}]*width:\s*38px[^}]*height:\s*38px[^}]*color:\s*var\(--skill-identity\)/)
    expect(css).toMatch(/\.skill-card-title > strong\s*\{[^}]*font-size:\s*14px/)
    expect(css).toMatch(/\.skill-card-heading > p\s*\{[^}]*font-size:\s*12\.5px/)
    expect(css).toMatch(/\.skill-source\s*\{[^}]*font-size:\s*10\.5px/)
    expect(css).toMatch(/\.skill-toggle\s*\{[^}]*width:\s*34px[^}]*height:\s*20px/)
    expect(css).toMatch(/\.skill-toggle\[aria-checked="true"\]\s*\{[^}]*background:\s*var\(--brand-soft\)/)
    expect(css).toMatch(/\.skill-source\.source-third-party\s*\{[^}]*background:\s*var\(--surface-muted\)/)
    expect(css).toMatch(/\.skill-card-details\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/)
    expect(css).toMatch(/\.skill-detail-source\s*\{[^}]*grid-column:\s*span 2/)
    expect(css).toMatch(/\.mcp-assignment-workbench\s*\{[^}]*height:\s*clamp\(370px, 46vh, 430px\)[^}]*grid-template-columns:\s*230px minmax\(0, 1fr\)/)
    expect(css).toMatch(/\.mcp-member-roster\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto[^}]*scrollbar-gutter:\s*stable/)
    expect(css.match(/\.mcp-member-roster-heading\s*\{[^}]*\}/)?.[0]).not.toContain('border-bottom')
    expect(css).toMatch(/\.mcp-member-roster-row\.is-selected\s*\{[^}]*background:\s*var\(--brand-soft\)/)
    expect(css).toMatch(/\.mcp-member-roster-row\.is-selected::before\s*\{[^}]*width:\s*2px[^}]*background:\s*var\(--brand\)/)
    expect(css).toMatch(/\.mcp-assignment-chooser-heading\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(230px, 310px\)/)
    expect(css).toMatch(/\.mcp-assignment-options\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)[^}]*overflow-y:\s*auto/)
    expect(css).toMatch(/\.mcp-assignment-option\s*\{[^}]*grid-template-columns:\s*31px minmax\(0, 1fr\) 17px/)
    expect(css).not.toContain('.mcp-assignment-scope')
    expect(css).not.toContain('.mcp-assignment-option-state')
    expect(css).not.toContain('.mcp-risk-badge')
    expect(css).toMatch(/\.mcp-server-list\s*\{[^}]*border-top:\s*1px solid var\(--line\)/)
    expect(css).toMatch(/\.mcp-server-row\s*\{[^}]*--mcp-identity:\s*var\(--identity-1\)[^}]*border-bottom:/)
    expect(css).toMatch(/\.mcp-server-mark\s*\{[^}]*width:\s*38px[^}]*height:\s*38px/)
  })

  it('keeps raw color literals inside the canonical token block', () => {
    const componentCss = css.replace(/:root(?:\[data-theme="night"\])?\s*\{[\s\S]*?\n\}/g, '')

    expect(componentCss).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(componentCss).not.toMatch(/\brgba?\(/i)
  })

  it('ships Night as a token-only theme override rather than component color branches', () => {
    expect(css).toContain(':root[data-theme="night"]')
    expect(css).not.toMatch(/\[data-theme="night"\][^{]*\.(?:skill|mcp|member|camp|memory|settings)-/)
  })

  it('does not reference undeclared custom properties', () => {
    const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]))
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/gi)].map((match) => match[1]))
    const runtimeOwned = new Set([
      '--radix-dropdown-menu-trigger-width'
    ])
    expect([...used].filter((token) => !declared.has(token) && !runtimeOwned.has(token))).toEqual([])
  })
})
