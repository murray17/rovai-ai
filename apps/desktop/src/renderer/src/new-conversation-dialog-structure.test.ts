import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const component = readFileSync(new URL('./NewConversationDialog.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

describe('New Conversation dialog presentation contract', () => {
  it('keeps the creation icon and the optional name editor collapsed with the exact placeholder', () => {
    expect(component).toContain('className="new-camp-dialog-header-icon"')
    expect(component).toContain('setOptionalOpen(false)')
    expect(component).toContain('placeholder="输入名称..."')
    expect(styles).toMatch(/\.new-camp-optional-panel\s*\{[^}]*margin:\s*0 10px 10px 42px/)
    expect(styles).toContain('.new-camp-optional-panel::before')
  })

  it('uses an avatar radio menu whose candidates remain the currently selected members', () => {
    expect(component).not.toMatch(/<select[\s>]/)
    expect(component).toContain('<DropdownMenu.RadioGroup value={leadId} onValueChange={setLeadId}>')
    expect(component).toContain('{selectedMembers.map((member) => {')
    expect(component).toContain('className="new-camp-lead-trigger"')
    expect(component).toContain('className="new-camp-lead-option"')
    expect(component).not.toContain('Agent 运行时')
  })

  it('distinguishes valid Git metadata from the neutral inspection state', () => {
    expect(styles).toMatch(/\.new-camp-git-metadata\s*\{[^}]*color:\s*var\(--success\);[^}]*background:\s*var\(--success-soft\);/s)
    expect(styles).toMatch(/\.new-camp-git-loading\s*\{[^}]*color:\s*var\(--muted\);[^}]*background:\s*var\(--surface-muted\);/s)
  })

  it('exposes the removed-Project authority wait as a neutral disabled workspace state', () => {
    expect(component).toContain("projectAccessReady: boolean")
    expect(component).toContain("aria-busy={!projectAccessReady}")
    expect(component).toContain("'正在载入项目…'")
    expect(component).toContain("'正在确认本机项目访问状态'")
    expect(component).toContain('disabled={projectActionsDisabled}')
    expect(component).toContain(': closeButtonRef.current')
  })

  it('scopes the selected porcelain picker colors to dropdown controls', () => {
    expect(styles).toMatch(/\.new-camp-picker-trigger\s*\{[^}]*border:\s*1px solid var\(--new-camp-picker-line-strong\)[^}]*background:\s*var\(--new-camp-picker-surface\)/s)
    expect(styles).toMatch(/\.new-camp-picker-menu\s*\{[^}]*border:\s*1px solid var\(--new-camp-picker-line-strong\)[^}]*background:\s*var\(--new-camp-picker-surface\)/s)
    expect(styles).toMatch(/\.new-camp-lead-trigger\s*\{[^}]*border:\s*1px solid var\(--new-camp-picker-line-strong\)[^}]*background:\s*var\(--new-camp-picker-surface\)/s)
    expect(styles).toMatch(/\.new-camp-lead-menu\s*\{[^}]*border:\s*1px solid var\(--new-camp-picker-line-strong\)[^}]*background:\s*var\(--new-camp-picker-surface\)/s)
    expect(styles).toMatch(/\.new-camp-optional-shell\s*\{[^}]*background:\s*var\(--surface\)/s)
    expect(styles).toMatch(/\.new-camp-optional-icon\s*\{[^}]*background:\s*var\(--surface-muted\)/s)
  })
})
