import { FileReferenceText } from '../../../apps/desktop/src/renderer/src/FileReferenceLink'
import { SafeMarkdown } from '../../../apps/desktop/src/renderer/src/SafeMarkdown'
import { readMessageQuoteSelection } from '../../../apps/desktop/src/renderer/src/message-quote-selection'
import { ThreadClientProvider, type ThreadClient } from '../../../apps/desktop/src/renderer/src/camp-client'
import type { ComposerDocument } from '@contracts'
import { useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { $getRoot, $getSelection, $isNodeSelection, $isRangeSelection, getNearestEditorFromDOMNode } from 'lexical'
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


const webTarget = new URLSearchParams(location.search).get('url') ?? 'http://localhost:8766/a?x=1&y=2#part'
const webMessage = '前 [标题](' + webTarget + ') 后'
const copiedLinks: string[] = []
Object.assign(window, { rovai: { platform: navigator.platform.includes('Mac') ? 'darwin' : 'linux',
  clipboard: { write: async ({ text }: { text: string }) => { copiedLinks.push(text) } } } })
function textPoint(needle: string, offset = 1, selector = '#composer') {
  const root = document.querySelector(selector)!
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const start = (node.textContent ?? '').indexOf(needle)
    if (start >= 0) {
      const range = document.createRange()
      range.setStart(node, start + offset); range.setEnd(node, start + offset + 1)
      const rect = range.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    }
    node = walker.nextNode()
  }
  throw new Error('Missing text point: ' + needle)
}

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
const outsideMember: StructuredMentionMember = {
  agentId: 'agent-outside',
  displayName: '爱丽丝',
  teamRole: '五号街卖花女',
  mentionable: true,
  inThread: false
}

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
  hasAllMembers: false,
  hasUnavailableAtom: false,
  memberAgentIds: [] as string[]
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
  const [sentDocument, setSentDocument] = useState<ComposerDocument | null>(null)
  const captureSend = useRef(false)
  const composerRef = useRef<StructuredMentionComposerHandle>(null)
  const [draftIdentity, setDraftIdentity] = useState('fixture-thread:draft-0')
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
        webPoint: textPoint,
        webState() {
          return { highlights: [...(CSS.highlights?.get('rovai-composer-web-link') ?? [])].map(range => range.toString()),
            popup: document.querySelector('.composer-web-link-address')?.textContent ?? null,
            copied: [...copiedLinks], error: document.querySelector('.app-toast')?.textContent ?? null,
            sent: sentDocument, history: document.querySelector('#web-history')?.textContent }
        },
        quoteWebSelection() {
          return readMessageQuoteSelection(window.getSelection(), 'web-fixture', () => ({ id: 'web-user', body: webMessage, authorType: 'user' }))?.selection ?? null
        },
        comparePartialWebQuotes() {
          const linked = document.querySelector<HTMLElement>('#web-user')!
          const plain = linked.cloneNode(false) as HTMLElement
          plain.removeAttribute('id')
          plain.textContent = webMessage
          linked.after(plain)
          const quote = (root: HTMLElement, start: number, end: number) => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
            const range = document.createRange()
            let offset = 0
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const length = node.textContent!.length
              if (start >= offset && start < offset + length) range.setStart(node, start - offset)
              if (end > offset && end <= offset + length) range.setEnd(node, end - offset)
              offset += length
            }
            const selection = window.getSelection()!
            selection.removeAllRanges(); selection.addRange(range)
            return readMessageQuoteSelection(selection, 'web-fixture', () => ({ id: 'web-user', body: webMessage, authorType: 'user' }))?.selection
          }
          try {
            const start = webMessage.indexOf(webTarget)
            return [[0, start + 12], [start + 7, webMessage.length], [start + 7, start + 22]].map(([from, to]) => ({
              linked: quote(linked, from, to), plain: quote(plain, from, to), expected: webMessage.slice(from, to)
            }))
          } finally { plain.remove(); window.getSelection()?.removeAllRanges() }
        },
        restoreSaved() { setInitialDocument(JSON.parse(localStorage.getItem('web-fixture-draft')!)); setDraftIdentity(value => value + '-restored') },
        captureNextSend() { captureSend.current = true },

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
          setDraftIdentity((current) => `${current}:next`)
        },
        rerender() { setPropRevision((value) => value + 1) },
        setMembers,
        includeOutsideMember() { setMembers([...initialMembers, outsideMember]) },
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
        setSkills,
        setSkillCatalogStatus,
        setDisabled,
        setInteractionLocked(locked: boolean) {
          composerRef.current?.setInteractionLocked(locked)
        },
        focusEnd() { composerRef.current?.focus('end') },
        focusStart() { composerRef.current?.focus('start') },
        selectText,
        replaceText(needle: string, replacement: string) {
          getNearestEditorFromDOMNode(editor()).update(() => {
            const node = $getRoot().getAllTextNodes().find(node => node.getTextContent().includes(needle))
            if (!node) throw new Error('Missing text to replace: ' + needle)
            node.setTextContent(node.getTextContent().replace(needle, replacement))
          }, { discrete: true })
        },
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
        copySelection() {
          const element = editor()
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
          const scroller = menu?.classList.contains('ref-options') ? menu : menu?.closest<HTMLElement>('.mention-menu') ?? menu
          const selected = menu?.querySelector<HTMLElement>('[aria-selected="true"]')
          const options = [...(menu?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
          return {
            selectionKind: getNearestEditorFromDOMNode(element).getEditorState().read(() => {
              const current = $getSelection()
              return $isNodeSelection(current) ? 'node' : $isRangeSelection(current) ? 'range' : 'none'
            }),
            caret: (() => {
              const selection = window.getSelection()
              return {
                count: selection?.rangeCount,
                collapsed: selection?.isCollapsed,
                insideEditor: Boolean(selection?.anchorNode && element.contains(selection.anchorNode)),
                insideAtom: Boolean(selection?.anchorNode?.parentElement?.closest('[data-composer-atom]')),
                color: getComputedStyle(element).caretColor
              }
            })(),
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
            activeDescendantMatches: Boolean(selected?.id)
              && element.getAttribute('aria-activedescendant') === selected?.id,
            activeVisible: Boolean(selected && scroller
              && selected.getBoundingClientRect().top >= scroller.getBoundingClientRect().top
              && selected.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().bottom),
            menuOverflows: Boolean(scroller && scroller.scrollHeight > scroller.clientHeight),
            menuScrollTop: scroller?.scrollTop ?? 0,
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

  return <>
    <div style={{ margin: 24 }}>
      <div id="web-user" style={{ userSelect: 'text' }} data-message-quote-body="web-user" data-quote-owner="web-fixture"><FileReferenceText text={webMessage} /></div>
      <div id="web-agent"><SafeMarkdown>{'Agent ' + webTarget + '，后续 www.example.com'}</SafeMarkdown></div>
      <div id="web-history"><FileReferenceText text={sentDocument?.segments.map(segment => segment.kind === 'text' ? segment.text : '').join('') ?? ''} /></div>
    </div>
    <div style={{ position: 'absolute', left: 24, right: 24, bottom: 24 }}>
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
        localStorage.setItem('web-fixture-draft', JSON.stringify(document))
      }}
      onLocalStatusChange={(status) => { localStatus = status }}
      onDirtyChange={(value) => { dirty = value }}
      onSubmit={async () => {
        submitCount += 1
        if (captureSend.current) { captureSend.current = false; setSentDocument((await composerRef.current!.flush()).document) }
      }}
      onBackspaceAtStart={() => { backspaceAtStartCount += 1 }}
      onPasteFiles={(files) => { pastedFileCount += files.length }}
      onActivateMemberMention={(member) => { activatedAtom = `member:${member.agentId}` }}
      onActivateAllMembersMention={() => { activatedAtom = 'all_members' }}
      onActivateSkillMention={(skillId) => { activatedAtom = `skill:${skillId}` }}
    />
  </div></>
}

// The fixture has no Core or managed avatars; formal shared components still receive an explicit client.
const fixtureClient = new Proxy({} as ThreadClient, { get: (_target, key) => {
  if (key === 'editingRecovery' || key === 'onEvent' || key === 'onInvalidated') return undefined
  if (key === 'request') return async (method: string) => {
    if (method === 'preferences.tasks.get') return { enabled: false, headsUpAfterSequence: 0, observedThroughChangeSequence: 0 }
    throw new Error(`Unexpected fixture request: ${method}`)
  }
  throw new Error(`Unexpected fixture capability: ${String(key)}`)
} })
createRoot(document.getElementById('root')!).render(<ThreadClientProvider client={fixtureClient}><Harness /></ThreadClientProvider>)
