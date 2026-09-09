import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { MessageQuoteSnapshot, MessageQuoteSelection } from '@contracts'
import { MessageQuotes, MessageQuoteSelectionToolbar } from '../../../apps/desktop/src/renderer/src/MessageQuotes'
import { SafeMarkdown } from '../../../apps/desktop/src/renderer/src/SafeMarkdown'
import { projectQuoteBody, readMessageQuoteSelection } from '../../../apps/desktop/src/renderer/src/message-quote-selection'
import cases from '../../../packages/contracts/fixtures/message-quote-projection-v1.json'
import '../../../apps/desktop/src/renderer/src/styles.css'

const messages = cases.map((entry, index) => ({ id: `source-${index}`, authorType: 'agent', body: entry.source }))
const errors: string[] = []
window.addEventListener('error', event => errors.push(String(event.error ?? event.message)))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
let fail = false
let latest: MessageQuoteSnapshot[] = []
const trash = new Map<string, MessageQuoteSnapshot>()
const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const check = (value: unknown, reason: string) => { if (!value) throw new Error(reason) }
const root = (index: number) => document.querySelector<HTMLElement>(`[data-message-quote-body="source-${index}"]`)!
function select(index: number, start = 0, end?: number) {
  const projection = projectQuoteBody(root(index))
  const first = projection.positions.find(position => position.end > start)!
  const last = projection.positions.find(position => position.end >= (end ?? Array.from(projection.text).length))!
  const range = document.createRange()
  range.setStart(first.node, Array.from(first.node.data).slice(0, start - first.start).join('').length)
  range.setEnd(last.node, Array.from(last.node.data).slice(0, (end ?? last.end) - last.start).join('').length)
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  return range
}
function Fixture() {
  const [quotes, setQuotes] = useState<MessageQuoteSnapshot[]>([])
  latest = quotes
  const add = async (selection: MessageQuoteSelection) => {
    if (fail) throw new Error('quote.limit_exceeded')
    setQuotes(current => [...current, { version: 1, quoteId: crypto.randomUUID(),
      source: { scope: 'camp', campId: 'fixture', messageId: selection.messageId }, authorAtCapture: { type: 'agent', agentId: 'agent_1', displayName: '叮叮' },
      text: selection.text, format: 'plain_text', capturedAt: '2026-09-09T00:00:00Z', sourceContentDigest: 'fixture', snapshotDigest: 'fixture' }])
  }
  return <main style={{ maxWidth: 780, margin: '24px auto', padding: 20 }}>
    <div className="conversation-timeline" style={{ maxHeight: 410, overflow: 'auto' }}>
      {messages.map((message, index) => <section key={message.id}>
        <div className="final-copy" data-message-quote-body={message.id} data-quote-owner="camp:fixture">
          <SafeMarkdown>{message.body}</SafeMarkdown>
        </div>
        {index === 0 && <div data-quote-exclude>文件卡片 <button>复制文件</button></div>}
      </section>)}
    </div>
    <MessageQuoteSelectionToolbar ownerKey="camp:fixture" messages={messages} onAdd={add} />
    <div style={{ marginTop: 12 }}><MessageQuotes history quotes={quotes} onReveal={quote => root(Number(quote.source.messageId.split('-')[1])).scrollIntoView()} /></div>
    <div className="composer-box" style={{ marginTop: 18 }}>
      <div style={{ padding: '8px 12px' }}>回复 叮叮</div>
      <MessageQuotes quotes={quotes} onReveal={quote => root(Number(quote.source.messageId.split('-')[1])).scrollIntoView()} onMutate={async action => {
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
      check(button, 'valid selection toolbar'); button!.click(); await frames()
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
    document.dispatchEvent(new Event('copy')); await frames()
    check(!document.querySelector('.message-quote-selection-toolbar'), 'copy dismisses')
    document.dispatchEvent(new Event('scroll')); await frames()
    check(!document.querySelector('.message-quote-selection-toolbar'), 'scroll does not revive copied selection')
    const trigger = document.querySelector<HTMLButtonElement>('.message-quotes:not(.is-history) .message-quotes-trigger')!
    trigger.focus(); trigger.click(); await frames()
    document.querySelector<HTMLButtonElement>('.message-quote-detail-excerpt')!.click(); await frames()
    check(document.querySelector('.message-quote-full-text')?.textContent === latest[0].text, 'full excerpt')
    document.querySelector<HTMLButtonElement>('.message-quotes-close')!.click(); await frames()
    check(document.activeElement === trigger, 'dialog returns focus to collapsed label')
    trigger.click(); await frames()
    document.querySelector<HTMLButtonElement>('.message-quotes-remove-detail')!.click(); await frames()
    check(latest.length === 2, 'individual remove')
    document.querySelector<HTMLButtonElement>('.message-quotes-dialog .message-quotes-undo')!.click(); await frames()
    check(latest.length === 3, 'undo')
    document.querySelector<HTMLButtonElement>('.message-quotes-close')!.click(); await frames()
    document.querySelector<HTMLButtonElement>('.is-history .message-quotes-trigger')!.click(); await frames()
    document.querySelector<HTMLButtonElement>('.message-quote-detail-excerpt')!.click(); await frames()
    check(document.querySelector('.message-quote-full-text')?.textContent === latest[0].text, 'history reveals complete text on demand')
    document.querySelector<HTMLButtonElement>('.message-quotes-close')!.click(); await frames()
    check(!errors.length, errors.join('\n'))
    return { ok: true, verified: ['shared projection', 'Unicode and code', 'cross message and cards', 'multiple compact quotes', 'failure retention', 'stale copy selection', 'full text and undo'] }
  },
  async theme(value: string) {
    document.documentElement.dataset.theme = value
    await frames()
    await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished))
    await frames()
    return document.documentElement.scrollWidth <= innerWidth
  }
} })
