import { useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { CampSnapshot, StructuredCampMessageContent, MessageQuoteSnapshot, MessageQuoteSelection } from '@contracts'
import { MessageQuotes, MessageQuoteSelectionToolbar } from '../../../apps/desktop/src/renderer/src/MessageQuotes'
import { quoteProjectionDigest, revealMessageQuote } from '../../../apps/desktop/src/renderer/src/message-quote-reveal'
import { SafeMarkdown } from '../../../apps/desktop/src/renderer/src/SafeMarkdown'
import { projectQuoteBody, quoteDomOffset, readMessageQuoteSelection } from '../../../apps/desktop/src/renderer/src/message-quote-selection'
import { AgentMessageMarkdownBody, StructuredMessageBody } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import { CurrentUserProfileContext } from '../../../apps/desktop/src/renderer/src/CurrentUserProfile'
import cases from '../../../packages/contracts/fixtures/message-quote-projection-v1.json'
import '../../../apps/desktop/src/renderer/src/styles.css'

const lineSourceIndex = cases.length
const messages = cases.map((entry, index) => ({ id: `source-${index}`, authorType: entry.authorType ?? 'agent', body: entry.source }))
messages.push({ id: `source-${lineSourceIndex}`, authorType: 'agent', body: 'Before the code.\n\n```ts\nconst first = 1;\nconst second = 2;\nconst third = 3;\nconst fourth = 4;\n```\n\nsame text\n\nsame text' })
const errors: string[] = []
window.addEventListener('error', event => errors.push(String(event.error ?? event.message)))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
let fail = false
let latest: MessageQuoteSnapshot[] = []
const trash = new Map<string, MessageQuoteSnapshot>()
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
// macOS may give another integration window OS focus. Keep DOM focus semantics deterministic.
const focus = (element: HTMLElement) => {
  element.focus()
  if (!document.hasFocus()) element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
}
const check = (value: unknown, reason: string) => { if (!value) throw new Error(reason) }
const root = (index: number) => document.querySelector<HTMLElement>(`[data-message-quote-body="source-${index}"]`)!
function select(index: number, start = 0, end?: number) {
  const projection = projectQuoteBody(root(index))
  const first = projection.positions.find(position => position.end > start)!
  const last = projection.positions.find(position => position.end >= (end ?? Array.from(projection.text).length))!
  const range = document.createRange()
  range.setStart(first.node, quoteDomOffset(first.node.data, start - first.start))
  range.setEnd(last.node, quoteDomOffset(last.node.data, (end ?? last.end) - last.start))
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  return range
}
function messageBody(index: number): ReactNode {
  const entry = cases[index]
  if (entry?.authorType === 'user') return entry.source
  if (!entry?.content) return <SafeMarkdown>{messages[index].body}</SafeMarkdown>
  const content = entry.content as StructuredCampMessageContent
  const members = [{ agentId: 'agent_a', displayName: '芝士*' }] as CampSnapshot['members']
  const body = content.some(part => part.kind === 'current_user_mention')
    ? <StructuredMessageBody body={entry.source} content={content} members={members} renderLeadingCurrentUserMarkdown />
    : <AgentMessageMarkdownBody body={entry.source} content={content} members={members} onActivateMemberMention={() => undefined} />
  return entry.currentUserName ? <CurrentUserProfileContext.Provider value={{ profile: { displayName: entry.currentUserName, avatarDataUrl: null }, ready: true, error: null, reload: () => undefined, save: async profile => profile }}>{body}</CurrentUserProfileContext.Provider> : body
}
function Fixture() {
  const [quotes, setQuotes] = useState<MessageQuoteSnapshot[]>([])
  latest = quotes
  const add = async (selection: MessageQuoteSelection) => {
    if (fail) throw { kind: 'infrastructure_failure', code: 'CORE_REQUEST_FAILED', message: 'quote.limit_exceeded', retryable: false, generation: 1, details: {} }
    const locator = { projectionVersion: 1 as const, startScalar: selection.startScalar, endScalar: selection.endScalar, projectionDigest: await quoteProjectionDigest(projectQuoteBody(root(Number(selection.messageId.split('-')[1]))).text) }
    setQuotes(current => [...current, { locator, version: 1, quoteId: crypto.randomUUID(),
      source: { scope: 'camp', campId: 'fixture', messageId: selection.messageId }, authorAtCapture: { type: 'agent', agentId: 'agent_1', displayName: '叮叮' },
      text: selection.text, format: 'plain_text', capturedAt: '2026-09-09T00:00:00Z', sourceContentDigest: 'fixture', snapshotDigest: 'fixture' }])
  }
  return <main style={{ maxWidth: 780, margin: '24px auto', padding: 20 }}>
    <div className="conversation-timeline" style={{ maxHeight: 410, overflow: 'auto' }}>
      <div className="single-chat-transcript" style={{ display: 'block', padding: 0 }}>
        {messages.map((message, index) => <section key={message.id}>
          <div className="final-copy" data-message-quote-body={message.id} data-quote-owner="camp:fixture">
            {messageBody(index)}
          </div>
          {index === 0 && <div data-quote-exclude>文件卡片 <button>复制文件</button></div>}
        </section>)}
      </div>
    </div>
    <MessageQuoteSelectionToolbar ownerKey="camp:fixture" messages={messages} onAdd={add} disabled={false} />
    <div style={{ marginTop: 12 }}><MessageQuotes history quotes={quotes} onReveal={quote => revealMessageQuote(quote, root(Number(quote.source.messageId.split('-')[1])))} /></div>
    <div className="composer-box" style={{ marginTop: 18 }}>
      <div style={{ padding: '8px 12px' }}>回复 叮叮</div>
      <MessageQuotes quotes={quotes} onReveal={quote => revealMessageQuote(quote, root(Number(quote.source.messageId.split('-')[1])))} onMutate={async action => {
        if (action.type === 'remove') { trash.set(action.quoteId, latest.find(quote => quote.quoteId === action.quoteId)!); setQuotes(latest.filter(quote => quote.quoteId !== action.quoteId)) }
        if (action.type === 'restore') setQuotes([...latest, trash.get(action.quoteId)!])
      }} />
      <textarea aria-label="本次问题" defaultValue="这几处如何一起调整？" style={{ width: '100%', minHeight: 64, background: 'transparent', border: 0, padding: 12, color: 'inherit' }} />
    </div>
    <div id="excluded-test" data-message-quote-body="source-0" data-quote-owner="camp:fixture"><span>First</span><button data-quote-exclude>卡片</button><span>code.</span></div>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
Object.assign(window, { quoteTest: {
  async run() {
    await frames()
    for (const [index, entry] of cases.entries()) {
      check(projectQuoteBody(root(index)).text === entry.text, `projection: ${entry.name}: ${JSON.stringify(projectQuoteBody(root(index)).text)}`)
      select(index)
      const candidate = readMessageQuoteSelection(window.getSelection(), 'camp:fixture', id => messages.find(message => message.id === id))
      check(candidate?.selection.text === entry.text, `selection: ${entry.name}`)
      if (entry.currentUserName) check(candidate?.selection.currentUserDisplayName === entry.currentUserName, 'capture only the displayed local-user token name')
      check(!readMessageQuoteSelection(window.getSelection(), 'camp:other', id => messages.find(message => message.id === id)), 'cross owner')
    }
    const range = select(0)
    const final = projectQuoteBody(root(1)).positions.at(-1)!
    range.setEnd(final.node, final.node.length)
    check(!readMessageQuoteSelection(window.getSelection(), 'camp:fixture', id => messages.find(message => message.id === id)), 'cross message')
    const excluded = document.getElementById('excluded-test')!
    range.selectNodeContents(excluded)
    check(!readMessageQuoteSelection(window.getSelection(), 'camp:fixture', id => messages.find(message => message.id === id)), 'card between endpoints')
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
    document.querySelector<HTMLButtonElement>('.message-quote-selection-toolbar button')!.click(); await frames()
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
    document.querySelector<HTMLButtonElement>('.message-quote-remove')!.click(); await frames()
    check(latest.length === 2, 'individual remove')
    document.querySelector<HTMLButtonElement>('.message-quotes-popover .message-quotes-undo')!.click(); await frames()
    check(latest.length === 3, 'undo')
    document.querySelector<HTMLButtonElement>('.message-quote-jump')!.click(); await pause(35); await frames()
    check(!document.querySelector('.message-quotes-popover') && root(0).dataset.quoteLocated === 'true', 'whole row jumps to source')
    const history = document.querySelector<HTMLButtonElement>('.is-history .message-quotes-trigger')!
    focus(history); history.click(); await frames()
    check(document.querySelectorAll('.message-quote-full-text').length === 3 && !document.querySelector('.message-quote-remove'), 'history full text rows are read only')
    history.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await frames()

    // Save a partial selection of two code rows, deserialize it, and use the same production locator.
    fail = false
    const codeText = projectQuoteBody(root(lineSourceIndex)).text
    const start = Array.from(codeText.slice(0, codeText.indexOf('second') + 3)).length
    const end = Array.from(codeText.slice(0, codeText.indexOf('third') + 3)).length
    root(lineSourceIndex).scrollIntoView(); select(lineSourceIndex, start, end); await frames()
    document.querySelector<HTMLButtonElement>('.message-quote-selection-toolbar button')!.click(); await pause(30); await frames()
    const saved: MessageQuoteSnapshot = JSON.parse(JSON.stringify(latest.at(-1)))
    await revealMessageQuote(saved, root(lineSourceIndex)); await frames()
    const band = root(lineSourceIndex).querySelector<HTMLElement>('.message-quote-line-band')!
    const code = root(lineSourceIndex).querySelector('pre')!
    const height = Number.parseFloat(getComputedStyle(code.querySelector('code')!).lineHeight)
    check(band?.dataset.lines === '2' && Math.abs(band.getBoundingClientRect().height - 2 * height) < 2, 'only two complete code rows')
    check(band.getBoundingClientRect().top > code.getBoundingClientRect().top + height, 'first code row untouched')
    check(Math.abs(band.getBoundingClientRect().width - code.clientWidth) < 2, 'whole row width')
    select(lineSourceIndex, start, end)
    check(readMessageQuoteSelection(window.getSelection(), 'camp:fixture', id => messages.find(message => message.id === id)), 'highlight decorations preserve native selection')
    document.querySelector<HTMLElement>('main')!.style.maxWidth = '520px'; await pause(60)
    check(Math.abs(root(lineSourceIndex).querySelector('.message-quote-line-band')!.getBoundingClientRect().width - code.clientWidth) < 2, 'line bands track reflow')
    document.querySelector<HTMLElement>('main')!.style.maxWidth = '780px'; await frames()
    const duplicateText = 'same text'
    const secondStart = Array.from(codeText.slice(0, codeText.lastIndexOf(duplicateText))).length
    const repeated: MessageQuoteSnapshot = { ...saved, text: duplicateText, locator: { ...saved.locator!, startScalar: secondStart, endScalar: secondStart + duplicateText.length } }
    await revealMessageQuote(repeated, root(lineSourceIndex)); await frames()
    check(root(lineSourceIndex).querySelector('p:last-child .message-quote-line-band'), 'saved offsets distinguish repeated excerpts')
    const legacy = { ...repeated, locator: undefined }
    await revealMessageQuote(legacy, root(lineSourceIndex)).then(() => { throw new Error('ambiguous legacy must fail') }, error => check(String(error).includes('selection_unavailable'), 'ambiguous excerpt fails closed'))
    check(!document.querySelector('.message-quote-line-band'), 'ambiguous text receives no false highlight')
    const multiText = Array.from(codeText).slice(0, end).join('')
    await revealMessageQuote({ ...saved, text: multiText, locator: { ...saved.locator!, startScalar: 0 } }, root(lineSourceIndex)); await frames()
    check(root(lineSourceIndex).querySelector('p .message-quote-line-band') && root(lineSourceIndex).querySelector('pre .message-quote-line-band'), 'multi-block selection covers involved blocks')
    // A changed source cannot reuse valid-looking offsets at another occurrence.
    await revealMessageQuote({ ...saved, locator: { ...saved.locator!, projectionDigest: 'changed' } }, root(lineSourceIndex)).then(() => { throw new Error('stale anchor must fail') }, error => check(String(error).includes('selection_unavailable'), 'stale digest'))
    check(!document.querySelector('.message-quote-line-band'), 'stale source is unhighlighted')
    trigger.scrollIntoView(); await frames()
    // Single Chat has a scrolling viewport outside its non-scrolling transcript.
    const viewport = document.querySelector<HTMLElement>('.conversation-timeline')!
    viewport.className = 'single-chat-viewport'
    viewport.scrollTop = 0
    await revealMessageQuote(saved, root(lineSourceIndex)); await pause(400); await frames()
    const located = root(lineSourceIndex).querySelector('.message-quote-line-band')!.getBoundingClientRect()
    const visible = viewport.getBoundingClientRect()
    check(viewport.scrollTop > 0 && located.top >= visible.top && located.bottom <= visible.bottom, 'private jump scrolls the actual viewport into view')
    const clippedRange = select(lineSourceIndex, start + 1, end)
    viewport.scrollTop += clippedRange.getBoundingClientRect().top - (visible.bottom + 20)
    document.dispatchEvent(new Event('scroll')); await frames()
    check(!document.querySelector('.message-quote-selection-toolbar'), 'clipped private selection has no floating toolbar outside the viewport')
    viewport.className = 'conversation-timeline'
    trigger.click(); await frames()
    while (latest.length) {
      document.querySelector<HTMLButtonElement>('.message-quote-remove')!.click(); await frames()
    }
    const emptyBubble = document.querySelector('.message-quotes-popover')!
    check(trigger.isConnected && trigger.getAttribute('aria-expanded') === 'true', 'removing the final quote preserves the bubble anchor')
    check(Math.abs(emptyBubble.getBoundingClientRect().left - trigger.getBoundingClientRect().left) < 20, 'empty bubble stays at its trigger')
    document.querySelector<HTMLButtonElement>('.message-quotes-popover .message-quotes-undo')!.click(); await frames()
    check(latest.length === 1, 'restore the last excerpt from the empty bubble')
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await frames()
    check(!errors.length, errors.join('\n'))
    return { ok: true, verified: ['shared projection', 'Unicode and code', 'cross message and cards', 'multiple compact quotes', 'failure retention', 'stale copy selection', 'hover and keyboard disclosure', 'full row navigation and undo', 'persisted code-line anchors', 'duplicate and stale source', 'reflow and multi-block highlights'] }
  },
  async linePreview() {
    await revealMessageQuote(latest.at(-1)!, root(lineSourceIndex)); await frames()
  },
  hoverTarget() {
    ;(document.activeElement as HTMLElement)?.blur()
    const rect = document.querySelector('.message-quotes:not(.is-history) .message-quotes-trigger')!.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  },
  hoverState() {
    const popup = document.querySelector('.message-quotes-popover')
    const rect = popup?.getBoundingClientRect()
    return { open: !!popup, triggerFocused: document.activeElement?.classList.contains('message-quotes-trigger'), x: rect ? rect.x + 20 : 0, y: rect ? rect.y + 20 : 0 }
  },
  async theme(value: string) {
    document.documentElement.dataset.theme = value
    await frames()
    await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished))
    await frames()
    return document.documentElement.scrollWidth <= innerWidth
  }
} })
