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
})
