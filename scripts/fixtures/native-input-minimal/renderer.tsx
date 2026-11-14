import { createRoot } from 'react-dom/client'
import { useRef } from 'react'
import { StructuredMentionComposer, type StructuredMentionComposerHandle } from '../../../apps/desktop/src/renderer/src/StructuredMentionComposer'
import { ThreadClientProvider, type ThreadClient } from '../../../apps/desktop/src/renderer/src/camp-client'
import '../../../apps/desktop/src/renderer/src/styles.css'

const client = { request: async (method: string) => {
  if (method === 'preferences.tasks.get') return { enabled: false, headsUpAfterSequence: 0, observedThroughChangeSequence: 0 }
  throw new Error(`Unexpected minimal-input request: ${method}`)
} } as ThreadClient
const empty = { version: 2 as const, segments: [] }
function MinimalInput() {
  const editor = useRef<StructuredMentionComposerHandle>(null)
  return <ThreadClientProvider client={client}>
    <p style={{ padding: 24 }}>Rovai 原生输入最小对照 · 生产编辑器与原有插件 · 无历史或执行流</p>
    <div style={{ position: 'absolute', left: 335, right: 65, bottom: 24 }}>
      <StructuredMentionComposer ref={editor} id="native-minimal-editor" draftIdentity="native-minimal"
        document={empty} members={[]} skills={[]} skillCatalogStatus="ready"
        ariaLabel="原生输入最小对照" placeholder="直接使用系统输入法输入"
        onSubmit={async () => { await editor.current?.flush() }} />
    </div>
  </ThreadClientProvider>
}
createRoot(document.getElementById('root')!).render(<MinimalInput />)
