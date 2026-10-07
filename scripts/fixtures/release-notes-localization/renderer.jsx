import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AboutUpdatesSettingsView } from '@renderer/AboutUpdatesSettings'
import { changeInterfaceLanguage, useInterfaceLanguage } from '@renderer/interface-language'
import { ThreadNavigation } from '@renderer/ThreadNavigation'
import { ThreadClientProvider } from '@renderer/camp-client'
import '@renderer/styles.css'
import '../../../apps/web/src/mobile.css'

const notes = (version, label) => `# Rovai AI v${version}

<!-- lang:en -->

## What's new

${label} English notes

[Guide][docs]

<!-- lang:zh-CN -->

## 更新内容

${label} 中文说明

[指南][docs]

[docs]: https://example.com/guide
`
const base = {
  currentVersion: '0.0.2', status: 'available',
  currentRelease: { version: '0.0.2', releaseName: 'Rovai AI v0.0.2', releaseDate: null, releaseNotes: notes('0.0.2', 'Installed') },
  availableRelease: { version: '0.0.3', releaseName: 'Rovai AI v0.0.3', releaseDate: null, releaseNotes: notes('0.0.3', 'Candidate') },
  lastCheckSource: null, checkedAt: null, lastSuccessfulCheckAt: null,
  downloadPercent: null, transferredBytes: null, totalBytes: null, bytesPerSecond: null,
  failureReason: null, pendingPrompt: null
}
const requests = []
const api = { setInterfaceLanguage: async interfaceLanguage => ({ interfaceLanguage }) }
let updateSnapshot, updateShell
const noop = () => undefined
const client = {}
function Fixture() {
  const [snapshot, setSnapshot] = useState(base)
  const [shell, setShell] = useState({ mode: null, width: 270 })
  updateSnapshot = setSnapshot
  updateShell = setShell
  useInterfaceLanguage()
  return <ThreadClientProvider client={client}>
    <div style={{ display: 'flex', height: '100vh', minWidth: 0 }}>
      {shell.mode && <div data-test-sidebar style={{ width: shell.width, flexShrink: 0, display: 'grid' }}>
        <ThreadNavigation view={shell.mode === 'settings' ? 'settings' : 'compose'} state="ready"
          navigation={null} activeThreadId={null} pendingMemoryCount={0}
          settingsSection="about" updateSnapshot={snapshot}
          onNewConversation={noop} onMembers={noop} onMemory={noop} onSettings={noop}
          onOpenUpdates={noop} onOpenProject={noop} onThread={noop} onRemoveProject={noop}
          onRename={noop} onDelete={noop} onError={noop} />
      </div>}
      <div className="settings-panel settings-panel-about" style={{ flex: 1, overflow: 'auto' }}><AboutUpdatesSettingsView
    snapshot={snapshot} canUpdate loading={false} loadError={false} actionError={null}
    onCheck={() => requests.push('check')} onDownload={() => requests.push('download')}
    onInstall={() => requests.push('install')} /></div>
    </div>
  </ThreadClientProvider>
}
window.releaseNotesTest = {
  requests,
  snapshot: patch => updateSnapshot({ ...base, ...patch }),
  sidebar: (mode, width = 270) => updateShell({ mode, width }),
  language: language => changeInterfaceLanguage(api, language),
  source: () => base,
  notes: source => updateSnapshot({ ...base, availableRelease: { ...base.availableRelease, releaseNotes: source } }),
  settle: async () => { await new Promise(resolve => setTimeout(resolve, 50)); await new Promise(requestAnimationFrame) }
}
createRoot(document.getElementById('root')).render(<Fixture />)
