import type { StructuredCampMessageContent } from '@contracts'
import { useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { StructuredMentionComposer } from '../../../apps/desktop/src/renderer/src/StructuredMentionComposer'
import type { ComposerSkillOption } from '../../../apps/desktop/src/renderer/src/composer-skill-picker'
import '../../../apps/desktop/src/renderer/src/styles.css'

const fixtureSkills: ComposerSkillOption[] = [
  { id: 'skill-worktree', name: 'worktree', description: '管理并行工作树', origin: 'official' },
  { id: 'skill-analyze', name: 'analyze-agent-codebase', description: '分析 Agent 代码', origin: 'official' },
  ...Array.from({ length: 16 }, (_, index): ComposerSkillOption => ({
    id: `skill-fixture-${index}`, name: `fixture-${index}`, description: `候选项 ${index}`, origin: 'imported'
  }))
]

const errors: string[] = []
window.addEventListener('error', event => errors.push(String(event.error?.stack ?? event.message)))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
let capturedEditor: HTMLElement | null = null

function editor(): HTMLElement {
  const element = document.getElementById('composer')
  if (!element) throw new Error('The Composer disappeared')
  return element
}

function focusEnd(): void {
  const element = editor()
  element.focus()
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
}

function selectText(needle: string, anchor: number, focus = anchor): void {
  const element = editor()
  element.focus()
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if (node.textContent?.includes(needle) && !node.parentElement?.closest('[data-editor-segment="token"]')) {
      window.getSelection()?.setBaseAndExtent(node, anchor, node, focus)
      return
    }
    node = walker.nextNode()
  }
  throw new Error(`Missing editable text: ${needle}`)
}

function Harness() {
  const [content, setContent] = useState<StructuredCampMessageContent>([])
  const [skills, setSkills] = useState(fixtureSkills)
  const [generation, setGeneration] = useState(0)
  useLayoutEffect(() => {
    Object.assign(window, {
      composerTest: {
        reset(value: string | StructuredCampMessageContent) {
          errors.length = 0
          setContent(typeof value === 'string' ? (value ? [{ kind: 'text', text: value }] : []) : value)
          setSkills(fixtureSkills)
          setGeneration(value => value + 1)
        },
        refresh() { setContent([...content]) },
        replaceContent: setContent,
        limitSkills(count: number) { setSkills(fixtureSkills.slice(0, count)) },
        controlledInput(text: string) {
          // React's before-input plugin consumes textInput on Chromium. Supply
          // an InputEvent to exercise the controlled path without a DOM mutation.
          const event = new InputEvent('textInput', {
            bubbles: true, cancelable: true, inputType: 'insertText', data: text
          })
          editor().dispatchEvent(event)
          if (!event.defaultPrevented) throw new Error('The controlled before-input path was not handled')
        },
        nativeText(text: string, inputType: string) {
          editor().replaceChildren(document.createTextNode(text))
          focusEnd()
          editor().dispatchEvent(new InputEvent('input', { bubbles: true, inputType }))
        },
        paste(text: string) {
          const clipboardData = new DataTransfer()
          clipboardData.setData('text/plain', text)
          editor().dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
        },
        selectText,
        focusEnd,
        captureEditor() { capturedEditor = editor() },
        state() {
          const element = document.getElementById('composer')
          const menu = document.getElementById(element?.getAttribute('aria-controls') ?? '')
          const selected = menu?.querySelector<HTMLElement>('[aria-selected="true"]')
          const menuBounds = menu?.getBoundingClientRect()
          const selectedBounds = selected?.getBoundingClientRect()
          return {
            content,
            text: element?.innerText.replaceAll('\u200B', '') ?? null,
            errors: [...errors],
            focused: document.activeElement === element,
            sameEditor: capturedEditor === element,
            menuKind: menu ? (menu.classList.contains('skill-picker-menu') ? 'skill' : 'mention') : null,
            skillOptions: [...(menu?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
              .map(option => option.dataset.skillName),
            activeSkill: selected?.dataset.skillName ?? null,
            activeCount: menu?.querySelectorAll('[aria-selected="true"]').length ?? 0,
            activeId: element?.getAttribute('aria-activedescendant') ?? null,
            selectedId: selected?.id ?? null,
            activeVisible: Boolean(menuBounds && selectedBounds
              && selectedBounds.top >= menuBounds.top && selectedBounds.bottom <= menuBounds.bottom),
            menuScrollTop: menu?.scrollTop ?? 0
          }
        }
      }
    })
  })
  return <div style={{ position: 'absolute', left: 24, right: 24, bottom: 24 }}><StructuredMentionComposer
    key={generation}
    id="composer"
    value={content}
    members={[{ agentId: 'agent-a', displayName: '队员甲', mentionable: true }]}
    skills={skills}
    ariaLabel="Native Composer regression"
    onChange={setContent}
    onSubmit={() => { throw new Error('This fixture must never submit a message') }}
  /></div>
}

createRoot(document.getElementById('root')!).render(<Harness />)
