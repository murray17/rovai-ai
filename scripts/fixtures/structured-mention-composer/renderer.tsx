import type { ComposerDocument } from '@contracts'
import { useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  StructuredMentionComposer,
  type StructuredMentionComposerHandle,
  type StructuredMentionMember
} from '../../../apps/desktop/src/renderer/src/StructuredMentionComposer'
import {
  ROVAI_COMPOSER_CLIPBOARD_MIME,
  cloneComposerDocument,
  composerDocumentFromText
} from '../../../apps/desktop/src/renderer/src/composer-document'
import type { ComposerSkillOption } from '../../../apps/desktop/src/renderer/src/composer-skill-picker'
import '../../../apps/desktop/src/renderer/src/styles.css'

const fixtureSkills: ComposerSkillOption[] = [
  { id: 'skill-worktree', name: 'worktree', description: '管理并行工作树', origin: 'official' },
  { id: 'skill-analyze', name: 'analyze-agent-codebase', description: '分析 Agent 代码', origin: 'official' },
  ...Array.from({ length: 16 }, (_, index): ComposerSkillOption => ({
    id: `skill-fixture-${index}`,
    name: `fixture-${index}`,
    description: `候选项 ${index}`,
    origin: 'imported'
  }))
]

const initialMembers: StructuredMentionMember[] = [{
  agentId: 'agent-a',
  displayName: '队员甲',
  teamRole: '系统架构师',
  mentionable: true
}]

const errors: string[] = []
window.addEventListener('error', (event) => errors.push(String(event.error?.stack ?? event.message)))
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)))

let capturedEditor: HTMLElement | null = null
let savedDocuments: ComposerDocument[] = []
let submitCount = 0
let backspaceAtStartCount = 0
let activatedAtom: string | null = null
let pastedFileCount = 0
let localStatus = {
  hasContent: false,
  hasExplicitRecipient: false,
  hasUnavailableAtom: false
}
let dirty = false

function editor(): HTMLElement {
  const element = document.getElementById('composer')
  if (!element) throw new Error('The Composer disappeared')
  return element
}

function selectText(needle: string, anchor: number, focus = anchor): void {
  const element = editor()
  element.focus()
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const value = node.textContent ?? ''
    const start = value.indexOf(needle)
    if (start >= 0 && !node.parentElement?.closest('[data-composer-atom]')) {
      window.getSelection()?.setBaseAndExtent(
        node,
        start + anchor,
        node,
        start + focus
      )
      return
    }
    node = walker.nextNode()
  }
  throw new Error(`Missing editable text: ${needle}`)
}

function normalizeInput(value: string | ComposerDocument): ComposerDocument {
  return typeof value === 'string'
    ? composerDocumentFromText(value)
    : cloneComposerDocument(value)
}

function Harness() {
  const composerRef = useRef<StructuredMentionComposerHandle>(null)
  const [draftIdentity, setDraftIdentity] = useState('fixture-camp:draft-0')
  const [initialDocument, setInitialDocument] = useState<ComposerDocument>(
    composerDocumentFromText('')
  )
  const [members, setMembers] = useState(initialMembers)
  const [skills, setSkills] = useState(fixtureSkills)
  const [skillCatalogStatus, setSkillCatalogStatus] = useState<'loading' | 'ready' | 'error'>('ready')
  const [disabled, setDisabled] = useState(false)
  const [propRevision, setPropRevision] = useState(0)

  useLayoutEffect(() => {
    Object.assign(window, {
      composerTest: {
        reset(value: string | ComposerDocument) {
          errors.length = 0
          savedDocuments = []
          submitCount = 0
          backspaceAtStartCount = 0
          activatedAtom = null
          pastedFileCount = 0
          setMembers(initialMembers)
          setSkills(fixtureSkills)
          setSkillCatalogStatus('ready')
          setDisabled(false)
          composerRef.current?.replaceDocument(normalizeInput(value), 'end')
          composerRef.current?.focus('end')
        },
        setDocument(value: string | ComposerDocument, boundary: 'start' | 'end' = 'end') {
          composerRef.current?.setDocument(normalizeInput(value), boundary)
        },
        switchDraft(value: string | ComposerDocument) {
          setInitialDocument(normalizeInput(value))
          setDraftIdentity((current) => `${current.split(':')[0]}:draft-${Number(current.split('-').at(-1)) + 1}`)
        },
        rerender() { setPropRevision((value) => value + 1) },
        setMembers,
        renameMember(displayName: string) {
          setMembers((current) => current.map((member) => ({ ...member, displayName })))
        },
        setMemberAvailable(available: boolean) {
          setMembers((current) => current.map((member) => ({
            ...member,
            mentionable: available
          })))
        },
        limitSkills(count: number) { setSkills(fixtureSkills.slice(0, count)) },
        setSkillCatalogStatus,
        setDisabled,
        setInteractionLocked(locked: boolean) {
          composerRef.current?.setInteractionLocked(locked)
        },
        focusEnd() { composerRef.current?.focus('end') },
        focusStart() { composerRef.current?.focus('start') },
        selectText,
        captureEditor() { capturedEditor = editor() },
        paste(text: string, structured = '', html = '') {
          const clipboardData = new DataTransfer()
          clipboardData.setData('text/plain', text)
          if (structured) clipboardData.setData(ROVAI_COMPOSER_CLIPBOARD_MIME, structured)
          if (html) clipboardData.setData('text/html', html)
          editor().dispatchEvent(new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData
          }))
        },
        pasteFile() {
          const clipboardData = new DataTransfer()
          clipboardData.items.add(new File(['fixture'], 'fixture.txt', { type: 'text/plain' }))
          clipboardData.setData('text/plain', 'must-not-enter-editor')
          editor().dispatchEvent(new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData
          }))
        },
        async copyAll() {
          const element = editor()
          element.focus()
          const range = document.createRange()
          range.selectNodeContents(element)
          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
          document.dispatchEvent(new Event('selectionchange'))
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          const clipboardData = new DataTransfer()
          element.dispatchEvent(new ClipboardEvent('copy', {
            bubbles: true,
            cancelable: true,
            clipboardData
          }))
          return {
            plain: clipboardData.getData('text/plain'),
            structured: clipboardData.getData(ROVAI_COMPOSER_CLIPBOARD_MIME),
            html: clipboardData.getData('text/html')
          }
        },
        compositionStart() {
          editor().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        },
        compositionEnd(data = '') {
          editor().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data }))
        },
        clickFirstAtom() {
          const atom = editor().querySelector<HTMLElement>('[data-composer-atom]')
          atom?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        },
        async state(flush = true) {
          const flushed = flush ? await composerRef.current?.flush() : null
          const element = editor()
          const menu = document.getElementById(element.getAttribute('aria-controls') ?? '')
          const selected = menu?.querySelector<HTMLElement>('[aria-selected="true"]')
          const options = [...(menu?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
          return {
            content: flushed?.document ?? null,
            text: element.innerText.replaceAll('\u200B', ''),
            errors: [...errors],
            focused: document.activeElement === element,
            sameEditor: capturedEditor === element,
            linkCount: element.querySelectorAll('a').length,
            headingCount: element.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
            listCount: element.querySelectorAll('ul,ol').length,
            boldCount: element.querySelectorAll('strong,b').length,
            paragraphCount: element.querySelectorAll(':scope > p').length,
            lineBreakCount: element.querySelectorAll('br').length,
            atomTypes: [...element.querySelectorAll<HTMLElement>('[data-composer-atom]')]
              .map((atom) => atom.dataset.composerAtom),
            atomLabels: [...element.querySelectorAll<HTMLElement>('[data-composer-atom]')]
              .map((atom) => atom.innerText),
            ariaControls: element.getAttribute('aria-controls'),
            menus: [...document.querySelectorAll<HTMLElement>('.structured-mention-menu')]
              .map((candidate) => ({ id: candidate.id, className: candidate.className })),
            menuKind: menu
              ? options.some((option) => option.dataset.skillName) ? 'skill' : 'mention'
              : null,
            options: options
              .map((option) => option.dataset.skillName ?? option.innerText),
            activeOption: selected?.dataset.skillName ?? selected?.innerText ?? null,
            localVersion: composerRef.current?.getLocalVersion() ?? -1,
            dirty,
            localStatus,
            saveCount: savedDocuments.length,
            savedDocuments: savedDocuments.map(cloneComposerDocument),
            submitCount,
            backspaceAtStartCount,
            activatedAtom,
            pastedFileCount,
            disabled: element.getAttribute('contenteditable') !== 'true',
            propRevision
          }
        }
      }
    })
  })

  return <div style={{ position: 'absolute', left: 24, right: 24, bottom: 24 }}>
    <StructuredMentionComposer
      ref={composerRef}
      id="composer"
      draftIdentity={draftIdentity}
      document={initialDocument}
      members={members}
      skills={skills}
      skillCatalogStatus={skillCatalogStatus}
      ariaLabel="Native Composer regression"
      placeholder={`结构化纯文本 ${propRevision}`}
      disabled={disabled}
      persistDocument={async (document) => {
        savedDocuments.push(cloneComposerDocument(document))
      }}
      onLocalStatusChange={(status) => { localStatus = status }}
      onDirtyChange={(value) => { dirty = value }}
      onSubmit={() => { submitCount += 1 }}
      onBackspaceAtStart={() => { backspaceAtStartCount += 1 }}
      onPasteFiles={(files) => { pastedFileCount += files.length }}
      onActivateMemberMention={(member) => { activatedAtom = `member:${member.agentId}` }}
      onActivateAllMembersMention={() => { activatedAtom = 'all_members' }}
      onActivateSkillMention={(skillId) => { activatedAtom = `skill:${skillId}` }}
    />
  </div>
}

createRoot(document.getElementById('root')!).render(<Harness />)
