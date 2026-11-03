import { renderMermaid } from '../../../apps/desktop/src/renderer/src/mermaid-renderer'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { SafeMarkdown } from '../../../apps/desktop/src/renderer/src/SafeMarkdown'
import { MessageMarkdown } from '../../../apps/desktop/src/renderer/src/MessageMarkdown'
import { MarkdownFilePreview } from '../../../apps/desktop/src/renderer/src/MarkdownFilePreview'
import { createFileFindDomIndex } from '../../../apps/desktop/src/renderer/src/file-find-dom'
import '../../../apps/desktop/src/renderer/src/styles.css'

import { samples, fence, document } from './samples.mjs'

function Fixture(): React.JSX.Element {
  const [source, setSource] = useState('普通文档，无图表。')
  const [theme, setTheme] = useState<'day' | 'night'>('day')
  const [message, setMessage] = useState(false)
  const [chat, setChat] = useState(false)
  const [contentComplete, setContentComplete] = useState(false)
  const [inlineMention, setInlineMention] = useState(false)
  const [mounted, setMounted] = useState(true)
  Object.assign(window, { mermaidFixture: { render: renderMermaid, samples, document, fence,
    setSource: (value: string) => flushSync(() => setSource(value)),
    setMessage: (value: boolean) => flushSync(() => setMessage(value)),
    setChat: (value: boolean) => flushSync(() => setChat(value)),
    setComplete: (value: boolean) => flushSync(() => setContentComplete(value)),
    setInlineMention: (value: boolean) => flushSync(() => setInlineMention(value)),
    setMounted: (value: boolean) => flushSync(() => setMounted(value)),
    findText: () => createFileFindDomIndex(window.document.querySelector('main')!).text,
    setTheme(value: 'day' | 'night') { window.document.documentElement.dataset.theme = value; flushSync(() => setTheme(value)) } } })
  return <main className="file-preview-markdown" style={{ width: 'min(880px, 100%)', margin: 'auto', overflow: 'auto', height: '100vh' }}>
    {mounted && (chat ? <MessageMarkdown theme={theme} contentComplete={contentComplete}
      inlineContent={inlineMention ? { MENTION: <button type="button">当前用户</button> } : undefined}>{source}</MessageMarkdown>
      : message ? <SafeMarkdown theme={theme}>{source}</SafeMarkdown> : <MarkdownFilePreview source={source} theme={theme} />)}
  </main>
}

createRoot(window.document.getElementById('root')!).render(<Fixture />)
