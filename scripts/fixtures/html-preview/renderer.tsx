import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { FilePreviewApi } from '../../../packages/contracts/src/index'
import { FilePreviewProvider, useFilePreview } from '../../../apps/desktop/src/renderer/src/FilePreviewContext'
import { FilePreviewTabs } from '../../../apps/desktop/src/renderer/src/FilePreviewTabs'
import { FilePreviewPane } from '../../../apps/desktop/src/renderer/src/FilePreviewPane'
import '../../../apps/desktop/src/renderer/src/styles.css'

const bridge = (window as unknown as { previewFixture: { call(method: string, args: unknown): Promise<unknown> } }).previewFixture
const api = Object.fromEntries(['updateRetention', 'bindThread', 'open', 'restore', 'reopen', 'readText', 'readPage', 'resolveLine', 'readBinary', 'prepareHtml', 'prepareHtmlSite', 'releaseHtmlSite', 'reload', 'release', 'openInSystem', 'revealInFolder', 'copyPath', 'chooseAuthorizedRoot'].map(method => [method, (args: unknown) => bridge.call(method, args)])) as unknown as FilePreviewApi
api.onExternalUpdate = () => () => {}
Object.assign(window, { rovai: { filePreview: api, windowControls: { onCloseTabRequested: () => () => {} } } })
function Fixture(): React.JSX.Element {
  const preview = useFilePreview()
  useEffect(() => { Object.assign(window, { previewAcceptance: preview }) }, [preview])
  return <div id="preview-fixture" style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column' }}><style>{'.file-preview-anchor{width:100%;min-height:0;flex:1}'}</style><FilePreviewTabs /><FilePreviewPane /></div>
}
createRoot(document.getElementById('root')!).render(<FilePreviewProvider threadId="preview-test" resolvedTheme="day"><Fixture /></FilePreviewProvider>)
