import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AboutUpdatesSettingsView } from '@renderer/AboutUpdatesSettings'
import { changeInterfaceLanguage, useInterfaceLanguage } from '@renderer/interface-language'
import '@renderer/styles.css'

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
let updateSnapshot
function Fixture() {
  const [snapshot, setSnapshot] = useState(base)
  updateSnapshot = setSnapshot
  useInterfaceLanguage()
  return <div className="settings-panel"><AboutUpdatesSettingsView
    snapshot={snapshot} canUpdate loading={false} loadError={false} actionError={null}
    onCheck={() => requests.push('check')} onDownload={() => requests.push('download')}
    onInstall={() => requests.push('install')} /></div>
}
window.releaseNotesTest = {
  requests,
  language: language => changeInterfaceLanguage(api, language),
  source: () => base,
  notes: source => updateSnapshot({ ...base, availableRelease: { ...base.availableRelease, releaseNotes: source } }),
  settle: async () => { await new Promise(resolve => setTimeout(resolve, 50)); await new Promise(requestAnimationFrame) }
}
createRoot(document.getElementById('root')).render(<Fixture />)
