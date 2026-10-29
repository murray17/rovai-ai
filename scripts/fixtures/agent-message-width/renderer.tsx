import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AgentMessageContent } from '../../../apps/desktop/src/renderer/src/AgentMessageContent'
import { SafeMarkdown } from '../../../apps/desktop/src/renderer/src/SafeMarkdown'
import { MessageQuotePreview } from '../../../apps/desktop/src/renderer/src/MessageQuotePreview'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/desktop/src/renderer/src/reply-details.css'

const prose = '目录和文件预览可以共用变化来源，但需要分别管理订阅生命周期；关闭浏览面板时，仍然打开的文件应继续接收更新。'.repeat(3)
const examples = {
  prose,
  short: '收到，我会先核对现有布局。',
  smallTable: prose + '\n\n| 项目 | 状态 |\n| --- | --- |\n| 浏览 | 已核对 |',
  wideTable: prose + '\n\n| 模块 | 当前实现 | 统一后的责任边界 | 生命周期 | 失败后的处理方式 | 验收场景 |\n| --- | --- | --- | --- | --- | --- |\n| 目录浏览 | Desktop_Main_RootWatchRegistry | Rust_Host_DirectoryService | 跟随浏览面板订阅 | 返回可重试错误并保留当前列表 | 展开后新增与删除文件 |',
  hugeTable: prose + '\n\n| 模块 | 文件 | 标识 |\n| --- | --- | --- |\n| 预览 | ' + '/workspace/projects/'.repeat(20) + ' | ' + 'directory_subscription_'.repeat(15) + ' |',
  shortCode: prose + '\n\n```ts\nrefreshDirectory(revision);\n```',
  longCode: prose + '\n\n```ts\nconst subscription = await directoryService.subscribe({ root: workspace.canonicalPath, generation: workspace.generation, includeHidden: false, signal: abortController.signal });\n```'
}
function App() {
  const [middle, setMiddle] = useState<keyof typeof examples>('prose')
  const [quote, setQuote] = useState(false)
  const [mention, setMention] = useState(false)
  const [attachments, setAttachments] = useState(false)
  Object.assign(window, { widthFixture: { setMiddle, setQuote, setMention, setAttachments } })
  return <main className="timeline-scroll" style={{ width: 'var(--fixture-pane-width, 100%)', maxWidth: '100%', height: '100vh', margin: 'auto' }}><div className="timeline-track">
    {['before', 'middle', 'after'].map(id => <article key={id} data-fixture-id={id} className="timeline-node conversation-bubble agent public-agent-message">
      <span className="local-message-avatar" aria-hidden="true">爱</span>
      <div className="message-body"><div className="bubble-meta"><strong>爱丽丝</strong></div><div className="public-message-readout"><div className="message-surface">
        <AgentMessageContent className={mention && id === 'middle' ? 'message-bubble' : 'final-copy'}>
          {quote && id === 'middle' && <MessageQuotePreview authorLabel="Murray" body={'请检查这条很长的回复引用。'.repeat(30)} />}
          <SafeMarkdown>{id === 'middle' ? examples[middle] : prose}</SafeMarkdown>
        </AgentMessageContent>
        {attachments && id === 'middle' && <div className="message-attachments agent-message-outputs">独立附件轨道</div>}
      </div></div></div>
    </article>)}
  </div></main>
}
createRoot(document.getElementById('root')!).render(<App />)
