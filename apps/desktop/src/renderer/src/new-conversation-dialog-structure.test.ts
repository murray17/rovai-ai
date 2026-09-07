import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const component = readFileSync(new URL('./NewConversationDialog.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

describe('New Conversation dialog presentation contract', () => {
  it('keeps a single title and a collapsed, focusable optional name editor', () => {
    expect(component).not.toContain('new-camp-dialog-header-icon')
    expect(component).toContain('setOptionalOpen(false)')
    expect(component).toContain('aria-expanded={optionalOpen}')
    expect(component).toContain('aria-controls="new-camp-optional-panel"')
    expect(component).toContain('placeholder="输入名称..."')
    expect(component).toContain('nameInputRef.current?.focus()')
    expect(component).toContain("{busy ? '正在新建…' : '新建'}")
  })

  it('uses an avatar radio menu whose candidates remain the currently selected available members', () => {
    expect(component).not.toMatch(/<select[\s>]/)
    expect(component).toContain('<DropdownMenu.RadioGroup value={leadId} onValueChange={setLeadId}>')
    expect(component).toContain('{selectedAvailableMembers.map((member) => {')
    expect(component).toContain('aria-labelledby="new-camp-lead-label new-camp-lead-value"')
    expect(component).toContain('aria-label="选择负责人"')
    expect(component).toContain('<DropdownMenu.RadioItem className="compact-option"')
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

  it('uses paired light field boundaries without losing focus and contrast support', () => {
    expect(styles).toMatch(/\.compact-picker\s*\{[^}]*border:\s*1px solid var\(--dialog-field-line\)/s)
    expect(styles).toContain('--dialog-field-label: #707070;')
    expect(styles).toContain('--dialog-field-label: #a6abb2;')
    expect(styles).toContain('prefers-contrast: more')
    expect(styles).toContain('outline:2px solid var(--focus)')
  })
})
