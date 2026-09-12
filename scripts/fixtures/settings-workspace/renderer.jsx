import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CampNavigation } from '@renderer/CampNavigation'
import { WindowDragStrip } from '@renderer/App'
import { GeneralSettings } from '@renderer/GeneralSettings'
import { AppearanceSettings } from '@renderer/AppearanceSettings'
import { NotificationSettings } from '@renderer/NotificationSettings'
import { RuntimeInstallationsPanel } from '@renderer/MemberManagement'
import { ChannelSettings } from '@renderer/ChannelSettings'
import { RuntimeMonitoring } from '@renderer/RuntimeMonitoring'
import { DiagnosticsCenter } from '@renderer/DiagnosticsCenter'
import { AboutUpdatesSettingsView } from '@renderer/AboutUpdatesSettings'
import * as fixture from './data'
import '@renderer/styles.css'
import '@renderer/member-editor.css'

const ignore = () => {}
const clone = structuredClone
const requests = []
let releaseHostStatus
let hostTokenGeneration = 0
const state = {
  hostWeb: { enabled: false }, holdHostStatus: false, loseHostStartReply: false,
  preferences: fixture.preferences(), notifications: fixture.notifications(),
  channels: fixture.channelsSnapshot(), executionWeb: fixture.executionWeb(),
  diagnostics: fixture.diagnosticsSnapshot(), scenario: 'normal', failure: null
}
state.preferences.newConversationDefaults.memberAgentIds = fixture.largeRoster.slice(0, 12).map(a => a.agentId)
const channelListeners = new Set(), webListeners = new Set()
async function request(method, params) {
  requests.push({ method, params: clone(params) })
  if (state.failure === method) {
    state.failure = null
    throw new Error('隔离测试：暂时无法完成，请重试。')
  }
}
const savePreference = key => async value => {
  await request(key, value)
  state.preferences[key] = clone(value)
  return clone(state.preferences)
}
Object.assign(window, { rovai: {
  platform: 'darwin', onEvent: () => () => {},
  hostWeb: {
    status: async () => {
      await request('hostWeb.status')
      const snapshot = clone(state.hostWeb)
      if (state.holdHostStatus) {
        state.holdHostStatus = false
        return new Promise(resolve => { releaseHostStatus = () => resolve(snapshot) })
      }
      return snapshot
    },
    start: async params => {
      await request('hostWeb.start', params)
      state.hostWeb = { enabled: true, origin: 'http://127.0.0.1:4317', sessions: 0 }
      if (state.loseHostStartReply) { state.loseHostStartReply = false; throw new Error('启动结果未知') }
      return { ...clone(state.hostWeb), administratorToken: `fixture-token-${++hostTokenGeneration}` }
    },
    rotate: async () => { await request('hostWeb.rotate'); return { ...clone(state.hostWeb), administratorToken: `fixture-token-${++hostTokenGeneration}` } },
    stop: async () => { await request('hostWeb.stop'); state.hostWeb = { enabled: false }; return clone(state.hostWeb) }
  },
  generalPreferences: {
    get: async () => clone(state.preferences),
    setStartupLocationMode: savePreference('startupLocationMode'),
    setNewConversationDefaults: savePreference('newConversationDefaults'),
    setOneClickNewConversationEnabled: savePreference('oneClickNewConversationEnabled'),
    setWorldMapEnabled: savePreference('worldMapEnabled')
  },
  windowControls: { getResetCapability: async () => ({ canReset: true, reason: null }), resetBounds: async () => ({ performed: true }) },
  channels: {
    get: async () => clone(state.channels), onChanged: fn => { channelListeners.add(fn); return () => channelListeners.delete(fn) },
    getExecutionWebSettings: async () => clone(state.executionWeb),
    onExecutionWebSettingsChanged: fn => { webListeners.add(fn); return () => webListeners.delete(fn) },
    setExecutionWebSettings: async value => {
      await request('executionWeb', value)
      state.executionWeb = { ...state.executionWeb, ...value }
      webListeners.forEach(fn => fn(clone(state.executionWeb)))
      return clone(state.executionWeb)
    }
  },
  exportMonitoring: async () => null, exportDiagnostics: async () => null,
  request: async (method, params = {}) => {
    await request(method, params)
    if (method === 'notifications.preference.get') return clone(state.notifications)
    if (method === 'notifications.preference.update') {
      state.notifications = { ...state.notifications, ...params.command, version: state.notifications.version + 1 }
      return { status: 'applied', payload: clone(state.notifications) }
    }
    if (method === 'monitoring.snapshot') return fixture.monitoringSnapshot(params, state.scenario)
    if (method === 'diagnostics.check') return clone(state.diagnostics)
    if (method === 'mcp.config.repairPermissions') {
      const item = state.diagnostics.checks.find(item => item.id === 'mcp-config')
      item.status = 'ok'; item.code = 'mcp_config_valid'
      state.diagnostics.summary.attention--; state.diagnostics.summary.ok++
      return { status: 'applied' }
    }
    throw new Error('Unimplemented isolated fixture method: ' + method)
  }
} })

function Fixture() {
  const [page, setPage] = useState('general')
  const [generation, setGeneration] = useState(0)
  const [roster, setRoster] = useState(fixture.largeRoster)
  const [appearance, setAppearance] = useState(fixture.appearance)
  const [updateError, setUpdateError] = useState(null)
  Object.assign(window.settingsTest, {
    navigate: (value, scenario = 'normal') => {
      state.scenario = scenario; setPage(value); setGeneration(n => n + 1)
    },
    unavailableLead: () => {
      const id = state.preferences.newConversationDefaults.defaultLeadAgentId
      setRoster(fixture.largeRoster.map(agent => agent.agentId === id ? { ...agent, presence: 'away' } : agent))
    },
    updateError: () => setUpdateError('download'),
    resetZoom: value => setAppearance(a => ({ ...a, zoomPercentage: value }))
  })
  return <div className="app-shell">
    <WindowDragStrip page="settings" />
    <CampNavigation navigation={fixture.navigation} view="settings" state="ready" activeCampId={null} pendingMemoryCount={0}
      settingsSection={page} onSettingsSectionChange={setPage} onSettingsBack={() => {}} onNewConversation={() => {}}
      onMembers={() => {}} onMemory={() => {}} onSettings={() => {}} onOpenProject={() => {}} onCamp={() => {}}
      onRemoveProject={async () => {}} onRename={async () => {}} onDelete={async () => {}} onError={error => { throw error }} />
    <main className="content settings-content">
      <div className="settings-workbench"><div className={`settings-panel settings-panel-${page}`} key={`${page}-${generation}`}>
        {page === 'general' && <GeneralSettings agents={roster} initialPreferences={state.preferences} currentProjectLabel="rovai-ai" onPreferencesChange={ignore} />}
        {page === 'appearance' && <AppearanceSettings appearance={appearance} disabled={false} onChange={async value => { setAppearance(value); return value }} />}
        {page === 'notifications' && <NotificationSettings />}
        {page === 'runtime' && <RuntimeInstallationsPanel health={fixture.healthSnapshot()} installations={[]} onReload={async () => {}} />}
        {page === 'channels' && <ChannelSettings agents={fixture.agents} />}
        {page === 'monitoring' && <RuntimeMonitoring />}
        {page === 'diagnostics' && <DiagnosticsCenter onNavigate={setPage} />}
        {page === 'about' && <AboutUpdatesSettingsView snapshot={fixture.updateSnapshot()} canUpdate loading={false}
          loadError={false} actionError={updateError} onCheck={() => {}} onDownload={() => setUpdateError('download')} onInstall={() => {}} />}
      </div></div>
    </main>
  </div>
}
window.settingsTest = {
  requests, state,
  releaseHostStatus: () => releaseHostStatus?.(),
  fail: method => { state.failure = method },
  settle: () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 35))))
}
createRoot(document.getElementById('root')).render(<Fixture />)
