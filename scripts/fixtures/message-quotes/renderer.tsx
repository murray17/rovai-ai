import { useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { ThreadSnapshot, StructuredThreadMessageContent, MessageQuoteSnapshot, MessageQuoteSelection } from '@contracts'
import { MessageQuotes, MessageQuoteSelectionToolbar } from '../../../apps/desktop/src/renderer/src/MessageQuotes'
import { revealMessageQuote } from '../../../apps/desktop/src/renderer/src/message-quote-reveal'
import { SafeMarkdown } from '../../../apps/desktop/src/renderer/src/SafeMarkdown'
import { FileReferenceText } from '../../../apps/desktop/src/renderer/src/FileReferenceLink'
import { readMessageQuoteText, readMessageQuoteSelection } from '../../../apps/desktop/src/renderer/src/message-quote-selection'
import { AgentMessageMarkdownBody, StructuredMessageBody, TruncatedStructuredMessageBody } from '../../../apps/desktop/src/renderer/src/ThreadWorkspace'
import { CurrentUserProfileContext } from '../../../apps/desktop/src/renderer/src/CurrentUserProfile'
import cases from './selection-cases.json'
import '../../../apps/desktop/src/renderer/src/styles.css'

const lineSourceIndex = cases.length
const messages = cases.map((entry, index) => ({ id: `source-${index}`, authorType: entry.authorType ?? 'agent', body: entry.source }))
messages.push({ id: `source-${lineSourceIndex}`, authorType: 'agent', body: 'Before the code.\n\n```ts\nconst first = 1;\nconst second = 2;\nconst third = 3;\nconst fourth = 4;\n```\n\nsame text\n\nsame text' })
messages.push({ id: `source-${lineSourceIndex + 1}`, authorType: 'agent', body: 'A following message.' })
const longUserSourceIndex = messages.length
const longUserText = [
  '\n**这份批复大部分是正确的架构校正。**',
  '',
  '主线仍然坚持：**保留原目标，重新构建当前动态上下文。** 🌸',
  '',
  ...Array.from({ length: 6 }, (_, index) => [
    `## ${index + 1}. 需要讨论的边界`,
    '',
    '> 提供已有证据，不要求平台先证明全部业务效果。',
    '',
    '- 复用当前 `Run` 的相关事实。',
    ''
  ].join('\n')),
  '**最后一段也应该能够引用。**'
].join('\n')
const longUserBody = `@芝士*${longUserText}`
messages.push({ id: `source-${longUserSourceIndex}`, authorType: 'user', body: longUserBody })
const errors: string[] = []
window.addEventListener('error', event => errors.push(String(event.error ?? event.message)))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
let fail = false
let failRemoval = false
let missingSource = false
let latest: MessageQuoteSnapshot[] = []
let setFixtureQuotes: (quotes: MessageQuoteSnapshot[]) => void
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
async function waitFor(condition: () => boolean, reason: string) {
  const deadline = performance.now() + 2000
  while (!condition() && performance.now() < deadline) await frames()
  check(condition(), reason)
}
// macOS may give another integration window OS focus. Keep DOM focus semantics deterministic.
const focus = (element: HTMLElement) => {
  element.focus()
  if (!document.hasFocus()) element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
}
const check = (value: unknown, reason: string) => { if (!value) throw new Error(reason) }
const root = (index: number) => document.querySelector<HTMLElement>(`[data-message-quote-body="source-${index}"]`)!
function click(selector: string, step: string) {
  const button = document.querySelector<HTMLButtonElement>(selector)
  check(button, `${step}: missing ${selector}`)
  button!.click()
}
const textNodes = (index: number) => {
  const walker = document.createTreeWalker(root(index), NodeFilter.SHOW_TEXT, { acceptNode(node) {
    return node.parentElement?.closest('[data-quote-exclude], [aria-hidden="true"], button:not(.message-mention-token)') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  } })
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  return nodes
}
function select(index: number, excerpt: number | string = 0, end?: number) {
  const nodes = textNodes(index)
  const nativeText = nodes.map(node => node.data).join('')
  if (typeof excerpt === 'string' && !nativeText.includes(excerpt)) excerpt = excerpt.replace(/\n/gu, '\r\n')
  let start = typeof excerpt === 'string' ? nativeText.indexOf(excerpt) : excerpt
  check(start >= 0, `missing native excerpt: ${excerpt}`)
  let finish = typeof excerpt === 'string' ? start + excerpt.length : end ?? nativeText.length
  const range = document.createRange()
  if (!nodes.length) range.selectNodeContents(root(index))
  else {
    let offset = 0, started = false
    for (const node of nodes) {
      if (!started && offset + node.length > start) { range.setStart(node, start - offset); started = true }
      if (started && offset + node.length >= finish) { range.setEnd(node, finish - offset); break }
      offset += node.length
    }
  }
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  return range
}
function messageBody(index: number): ReactNode {
  if (index === longUserSourceIndex) return <TruncatedStructuredMessageBody
    body={longUserBody}
    content={[{ kind: 'member_mention', agentId: 'agent_a' }, { kind: 'text', text: longUserText }]}
    members={[{ agentId: 'agent_a', displayName: '芝士*' }] as ThreadSnapshot['members']}
    truncate forceExpanded={false}
  />
  const entry = cases[index]
  if (entry?.authorType === 'user') return entry.content
    ? <StructuredMessageBody body={entry.source} content={entry.content as StructuredThreadMessageContent}
      members={[{ agentId: 'agent_a', displayName: '芝士*' }] as ThreadSnapshot['members']} /> : <FileReferenceText text={entry.source} />
  if (!entry?.content) return <SafeMarkdown>{messages[index].body}</SafeMarkdown>
  const content = entry.content as StructuredThreadMessageContent
  const members = [{ agentId: 'agent_a', displayName: '芝士*' }] as ThreadSnapshot['members']
  const body = content.some(part => part.kind === 'current_user_mention')
    ? <StructuredMessageBody body={entry.source} content={content} members={members} renderLeadingCurrentUserMarkdown />
    : <AgentMessageMarkdownBody body={entry.source} content={content} members={members} onActivateMemberMention={() => undefined} />
  return entry.currentUserName ? <CurrentUserProfileContext.Provider value={{ profile: { displayName: entry.currentUserName, avatarDataUrl: null }, ready: true, error: null, reload: () => undefined, save: async profile => profile }}>{body}</CurrentUserProfileContext.Provider> : body
}
function Fixture() {
  const [quotes, setQuotes] = useState<MessageQuoteSnapshot[]>([])
  setFixtureQuotes = setQuotes
  const composer = useRef<HTMLTextAreaElement>(null)
  latest = quotes
  const add = async (selection: MessageQuoteSelection) => {
    if (fail) throw { kind: 'infrastructure_failure', code: 'CORE_REQUEST_FAILED', message: 'quote.limit_exceeded', retryable: false, generation: 1, details: {} }
    setQuotes(current => [...current, { version: 1, quoteId: crypto.randomUUID(),
      ...(selection.messageId ? { source: { scope: 'camp' as const, campId: 'fixture', messageId: selection.messageId } } : {}),
      authorAtCapture: { type: 'agent', agentId: 'agent_1', displayName: '叮叮' },
      text: selection.text, format: 'plain_text', capturedAt: '2026-10-29T00:00:00Z' }])
  }
  return <main style={{ maxWidth: 780, margin: '24px auto', padding: 20 }}>
    <div className="conversation-timeline" style={{ maxHeight: 410, overflow: 'auto' }}>
      <div className="single-chat-transcript" style={{ display: 'block', padding: 0 }}>
        {messages.map((message, index) => <section key={message.id}>
          <div className="final-copy" data-message-quote-body={message.id} data-quote-owner="thread:fixture">
            {messageBody(index)}
          </div>
          {index === 0 && <div data-quote-exclude>文件卡片 <button>复制文件</button></div>}
        </section>)}
      </div>
    </div>
    <MessageQuoteSelectionToolbar ownerKey="thread:fixture" messages={messages} onAdd={add} disabled={false} />
    <div style={{ marginTop: 12 }}><MessageQuotes history quotes={quotes} onReveal={quote => { if (missingSource) throw new Error('quote.source_unavailable'); if (quote.source) revealMessageQuote(root(Number(quote.source.messageId.split('-')[1]))) }} /></div>
    <div className="composer-box" style={{ marginTop: 18 }}>
      <div style={{ padding: '8px 12px' }}>回复 叮叮</div>
      <MessageQuotes quotes={quotes} onEmptyFocus={() => composer.current?.focus()} onReveal={quote => { if (missingSource) throw new Error('quote.source_unavailable'); if (quote.source) revealMessageQuote(root(Number(quote.source.messageId.split('-')[1]))) }} onMutate={async action => {
        if (failRemoval) throw new Error('quote.draft_changed')
        if (action.type === 'remove') setQuotes(latest.filter(quote => quote.quoteId !== action.quoteId))
      }} />
      <textarea ref={composer} aria-label="本次问题" defaultValue="这几处如何一起调整？" style={{ width: '100%', minHeight: 64, background: 'transparent', border: 0, padding: 12, color: 'inherit' }} />
    </div>
    <div id="excluded-test" data-message-quote-body="source-0" data-quote-owner="thread:fixture"><span>First</span><button data-quote-exclude>卡片</button><span>code.</span></div>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
Object.assign(window, { quoteTest: {
  async run() {
    await frames()
    const longRoot = root(longUserSourceIndex)
    const longToggle = longRoot.querySelector<HTMLButtonElement>('.message-long-toggle')!
    for (const expanded of [false, true, false]) {
      if (longToggle.getAttribute('aria-expanded') !== String(expanded)) { longToggle.click(); await frames() }
      check(longToggle.getAttribute('aria-expanded') === String(expanded), 'long user message expand state')
      const excerpt = expanded ? '**最后一段也应该能够引用。**' : '主线仍然坚持：**保留原目标，重新构建当前动态上下文。** 🌸'
      const range = select(longUserSourceIndex, excerpt)
      range.startContainer.parentElement!.scrollIntoView({ block: 'end' })
      // Keep the chosen line inside the viewport even when its text node contains many lines.
      const viewport = document.querySelector<HTMLElement>('.conversation-timeline')!
      viewport.scrollTop += range.getBoundingClientRect().bottom - viewport.getBoundingClientRect().bottom + 45
      document.dispatchEvent(new Event('scroll')); await frames()
      const candidate = readMessageQuoteSelection(window.getSelection(), 'thread:fixture', id => messages.find(message => message.id === id))
      check(candidate?.selection.text === excerpt, `long user ${expanded ? 'expanded' : 'collapsed'} selection excludes folding announcements`)
      check(Object.keys(candidate.selection).sort().join(',') === 'messageId,text', 'capture sends only selected text and optional source')
      check(document.querySelector('.message-quote-selection-toolbar button'), 'long user selection exposes quote action')
      const announcement = longRoot.querySelector('.sr-only')!
      check(announcement.getAttribute('aria-live') === 'polite' && announcement.textContent?.includes(expanded ? '全文已展开' : '其余内容已收起'),
        'folding continues to announce its state to screen readers')
      // Selecting the body together with its controls is still outside the quote boundary.
      range.selectNodeContents(longRoot)
      check(!readMessageQuoteSelection(window.getSelection(), 'thread:fixture', id => messages.find(message => message.id === id)),
        'long user selection cannot include expand controls or announcements')
      window.getSelection()!.removeAllRanges(); await frames()
    }
    const mismatches = cases.flatMap((entry, index) => { const actual = readMessageQuoteText(root(index)); return actual === entry.text ? [] : [{ name: entry.name, expected: entry.text, actual }] })
    check(!mismatches.length, JSON.stringify(mismatches))
    for (const [index, entry] of cases.entries()) {
      check(readMessageQuoteText(root(index)) === entry.text, `visible text: ${entry.name}: ${JSON.stringify(readMessageQuoteText(root(index)))}`)
      if (entry.strong) check(JSON.stringify([...root(index).querySelectorAll('strong')].map(node => node.textContent)) === JSON.stringify(entry.strong), `strong markup: ${entry.name}`)
      select(index)
      const candidate = readMessageQuoteSelection(window.getSelection(), 'thread:fixture', id => messages.find(message => message.id === id))
      check(entry.text ? candidate?.selection.text === entry.text : !candidate, `selection: ${entry.name}: ${JSON.stringify(candidate?.selection.text)}`)
      for (const excerpt of entry.selections ?? []) {
        select(index, excerpt)
        const selected = readMessageQuoteSelection(window.getSelection(), 'thread:fixture', id => messages.find(message => message.id === id))
        check(selected?.selection.text === excerpt, `reference excerpt: ${entry.name}: ${excerpt}`)
      }
      check(!readMessageQuoteSelection(window.getSelection(), 'thread:other', id => messages.find(message => message.id === id)), 'cross owner')
    }
    const foldedCodeIndex = cases.findIndex(entry => entry.name === 'collapsed code controls do not block visible selection')
    const details = root(foldedCodeIndex).querySelector('details')!
    const controls = details.querySelector<HTMLElement>('.markdown-code-corner')!
    check(controls?.querySelector('.markdown-code-copy'), 'folded fixture uses the real code copy controls')
    const codeFrame = controls.parentElement!
    details.open = true
    select(foldedCodeIndex)
    check(!readMessageQuoteSelection(window.getSelection(), 'thread:fixture', () => undefined), 'expanded code controls still exclude the range')
    details.open = false
    details.querySelector('summary')!.appendChild(controls)
    select(foldedCodeIndex)
    check(!readMessageQuoteSelection(window.getSelection(), 'thread:fixture', () => undefined), 'visible summary controls still exclude the range')
    codeFrame.appendChild(controls)
    const range = select(0)
    const final = textNodes(1).at(-1)!
    range.setEnd(final, final.length)
    check(!readMessageQuoteSelection(window.getSelection(), 'thread:fixture', id => messages.find(message => message.id === id)), 'cross message')
    range.selectNodeContents(document.getElementById('excluded-test')!)
    check(!readMessageQuoteSelection(window.getSelection(), 'thread:fixture', id => messages.find(message => message.id === id)), 'card between endpoints')
    check(!document.querySelector('[data-message-quote-body] script, [data-message-quote-body] img[onerror]'), 'default sanitizer removes executable HTML')

    const htmlIndex = cases.findIndex(entry => entry.name === 'HTML table line breaks')
    root(htmlIndex).scrollIntoView(); select(htmlIndex); await frames()
    const selected = readMessageQuoteSelection(window.getSelection(), 'thread:fixture', () => undefined)
    check(selected?.selection.text === cases[htmlIndex].text && !selected.selection.messageId, 'missing source does not block visible HTML selection')
    // Streaming can update the source between selection and capture.
    const oldBody = messages[htmlIndex].body
    messages[htmlIndex].body = 'The source has continued streaming.'
    click('.message-quote-selection-toolbar button', 'capture HTML after source changes'); await pause(30); await frames()
    check(latest[0].text === cases[htmlIndex].text, 'capture uses the saved selection after source changes')
    messages[htmlIndex].body = oldBody
    const saved: MessageQuoteSnapshot = JSON.parse(JSON.stringify(latest[0]))
    missingSource = true
    const quoteTrigger = document.querySelector<HTMLButtonElement>('.message-quotes:not(.is-history) .message-quotes-trigger')!
    quoteTrigger.click(); await frames()
    click('.message-quote-jump', 'missing source'); await pause(30); await frames()
    check(document.querySelector('.message-quote-full-text')?.textContent === saved.text && document.querySelector('[role="alert"]')?.textContent?.includes('已保留引用选文'), 'jump failure retains saved text')
    missingSource = false
    const { source, authorAtCapture, ...withoutSource } = saved
    setFixtureQuotes([withoutSource]); await frames()
    check(document.querySelector('.message-quote-full-text')?.textContent === saved.text && document.querySelector('.message-quote-jump')?.getAttribute('aria-disabled') === 'true', 'source-free quote remains readable and removable')
    click('.message-quote-remove', 'finish HTML fixture'); await pause(30); await frames()
    for (let index = 0; index < 3; index++) {
      root(0).scrollIntoView(); select(0, index, 14 + index); await frames()
      const button = document.querySelector<HTMLButtonElement>('.message-quote-selection-toolbar button')
      check(button, 'valid selection toolbar'); button!.click(); await pause(30); await frames()
    }
    check(latest.length === 3 && document.querySelectorAll('.message-quotes-trigger').length === 2, 'one collapsed label per surface')
    for (const label of document.querySelectorAll('.message-quotes-trigger')) {
      check(label.textContent === '引用 3 段叮叮', 'count and author only')
      check(!label.textContent.includes(latest[0].text), 'no excerpt in composer or history')
    }
    check(document.querySelector('textarea')!.value === '这几处如何一起调整？', 'question preserved')
    check(document.querySelector('.message-quotes-row')!.getBoundingClientRect().height <= 36, 'compact height')
    fail = true; select(0, 0, 12); await frames()
    click('.message-quote-selection-toolbar button', 'quote error retention'); await pause(30); await frames()
    check(latest.length === 3 && !!document.querySelector('[role="alert"]') && !window.getSelection()!.isCollapsed, 'failure retains quotes and selection')
    check(document.querySelector('[role="alert"]')?.textContent?.includes('12,000'), 'contextBridge failure objects retain actionable quote errors')
    document.dispatchEvent(new Event('copy')); await frames()
    check(!document.querySelector('.message-quote-selection-toolbar'), 'copy dismisses')
    document.dispatchEvent(new Event('scroll')); await frames()
    check(!document.querySelector('.message-quote-selection-toolbar'), 'scroll does not revive copied selection')
    const trigger = document.querySelector<HTMLButtonElement>('.message-quotes:not(.is-history) .message-quotes-trigger')!
    focus(trigger); await frames()
    check(document.querySelector('.message-quote-full-text')?.textContent === latest[0].text, 'focus opens full text without a nested modal')
    check(!document.querySelector('.message-quotes-overlay'), 'no modal overlay')
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await frames()
    check(document.activeElement?.classList.contains('message-quote-jump'), 'keyboard enters rows')
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await frames()
    check(document.activeElement === trigger && !document.querySelector('.message-quotes-popover'), 'escape dismisses and restores trigger')
    trigger.click(); await frames()
    failRemoval = true
    click('.message-quote-remove', 'failed individual removal'); await pause(30); await frames()
    check(latest.length === 3 && document.querySelector('[role="alert"]')?.textContent?.includes('草稿已更新'), 'failed removal keeps quotes and reports the failure')
    failRemoval = false
    const remainingIds = latest.slice(1).map(quote => quote.quoteId)
    click('.message-quote-remove', 'successful individual removal'); await pause(30); await frames()
    check(latest.length === 2 && latest.every((quote, index) => quote.quoteId === remainingIds[index]), 'individual removal preserves remaining order')
    check(document.activeElement?.classList.contains('message-quote-jump') && trigger.textContent === '引用 2 段叮叮', 'keyboard removal focuses the remaining row and updates the count')
    check(!document.querySelector('.message-quotes-undo') && !document.body.textContent?.includes('撤销移除'), 'no undo control in the bubble or composer')
    click('.message-quote-jump', 'reveal quote source'); await pause(35); await frames()
    check(!document.querySelector('.message-quotes-popover') && document.activeElement === root(0), 'whole row jumps to source')
    const history = document.querySelector<HTMLButtonElement>('.is-history .message-quotes-trigger')!
    focus(history); history.click(); await frames()
    check(document.querySelectorAll('.message-quote-full-text').length === 2 && !document.querySelector('.message-quote-remove'), 'history full text rows are read only')
    history.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await frames()

    fail = false
    const excerpt = 'second = 2;\nconst third'
    root(lineSourceIndex).scrollIntoView(); select(lineSourceIndex, excerpt); await frames()
    click('.message-quote-selection-toolbar button', 'capture code excerpt'); await pause(30); await frames()
    check(latest.at(-1)?.text === excerpt, 'code selection preserves line breaks')
    const frozen = JSON.stringify(latest.at(-1))
    root(lineSourceIndex).querySelector('code')!.textContent = 'The original code has changed.'
    revealMessageQuote(root(lineSourceIndex)); await frames()
    check(document.activeElement === root(lineSourceIndex) && JSON.stringify(latest.at(-1)) === frozen, 'source changes never rewrite saved text or prevent a message jump')
    const viewport = document.querySelector<HTMLElement>('.conversation-timeline')!
    viewport.className = 'single-chat-viewport'
    viewport.scrollTop = 0
    await frames()
    revealMessageQuote(root(lineSourceIndex))
    await waitFor(() => viewport.scrollTop > 0, 'private jump scrolls the actual viewport')
    const clippedRange = select(lineSourceIndex, 'same text')
    viewport.scrollTop += clippedRange.getBoundingClientRect().top - (viewport.getBoundingClientRect().bottom + 20)
    document.dispatchEvent(new Event('scroll')); await frames()
    check(!document.querySelector('.message-quote-selection-toolbar'), 'clipped private selection has no floating toolbar outside the viewport')
    viewport.className = 'conversation-timeline'
    trigger.click(); await frames()
    while (latest.length) {
      click('.message-quote-remove', 'clear remaining quotes'); await pause(30); await frames()
    }
    await pause(250)
    check(!document.querySelector('.message-quotes') && !document.querySelector('.message-quotes-popover'), 'last removal closes the bubble and leaves no empty metadata row')
    check(document.activeElement === document.querySelector('textarea') && document.querySelector('textarea')!.value === '这几处如何一起调整？', 'last keyboard removal returns to the unchanged question')
    // A new drag starts a fresh selection, including an excerpt dismissed earlier.
    // Selectionchange alone must not revive the old selection after copy/focus.
    root(lineSourceIndex).scrollIntoView()
    root(lineSourceIndex).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }))
    select(lineSourceIndex, 'same text')
    root(lineSourceIndex).dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0 }))
    await frames()
    click('.message-quote-selection-toolbar button', 'add excerpt after clearing'); await pause(30); await frames()
    check(latest.length === 1 && !document.querySelector('.message-quotes-popover'), 'new selection after clearing starts with a collapsed label')
    check(!errors.length, errors.join('\n'))
    return { ok: true, selectionCases: cases.length, verified: ['visible HTML and table line breaks', 'literal code and escaped tags', 'CJK and Unicode', 'trusted Mention and references', 'source-free selection', 'streaming source changes', 'missing-source retention', 'compact quotes', 'copy and code whitespace', 'keyboard removal and focus', 'message jumps'] }
  },
  async linePreview() {
    revealMessageQuote(root(lineSourceIndex)); await frames()
  },
  async htmlPreview() {
    window.getSelection()?.removeAllRanges()
    root(cases.findIndex(entry => entry.name === 'HTML table line breaks')).scrollIntoView({ block: 'center', behavior: 'instant' })
    await frames()
  },
  async cjkPreview() {
    window.getSelection()?.removeAllRanges()
    root(cases.findIndex(entry => entry.name === 'CJK original conflict reply')).scrollIntoView({ block: 'start', behavior: 'instant' })
    await frames()
  },
  async literalPreview() {
    window.getSelection()?.removeAllRanges()
    root(cases.findIndex(entry => entry.name === 'code and escaped placeholders')).scrollIntoView({ block: 'start', behavior: 'instant' })
    await frames()
  },
  async hoverTarget() {
    ;(document.activeElement as HTMLElement)?.blur()
    const trigger = document.querySelector<HTMLElement>('.message-quotes:not(.is-history) .message-quotes-trigger')!
    trigger.scrollIntoView({ block: 'center', behavior: 'instant' }); await frames()
    const rect = trigger.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  },
  hoverState() {
    const popup = document.querySelector('.message-quotes-popover')
    const rect = popup?.getBoundingClientRect()
    return { open: !!popup, triggerFocused: document.activeElement?.classList.contains('message-quotes-trigger'), x: rect ? rect.x + 20 : 0, y: rect ? rect.y + 20 : 0 }
  },
  async lastLineTarget() {
    const paragraph = root(lineSourceIndex).querySelector<HTMLElement>('p:last-child')!
    paragraph.scrollIntoView({ block: 'center' }); await frames()
    const rect = paragraph.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  },
  lastLineState() {
    const selection = window.getSelection()
    const candidate = readMessageQuoteSelection(selection, 'thread:fixture', id => messages.find(message => message.id === id))
    return {
      text: selection?.toString().trim(),
      toolbar: !!document.querySelector('.message-quote-selection-toolbar'),
      candidate: !!candidate
    }
  },
  async clearSelection() {
    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange')); await frames()
  },
  async theme(value: string) {
    document.documentElement.dataset.theme = value
    await frames()
    await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished))
    await frames()
    return document.documentElement.scrollWidth <= innerWidth
  }
} })
