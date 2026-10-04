import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/desktop/src/renderer/src/member-editor.css'
import '../../../apps/web/src/styles.css'
import '../../../apps/web/src/mobile.css'
import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MembersView } from '../../../apps/desktop/src/renderer/src/MemberManagement'
import { CurrentUserProfileProvider } from '../../../apps/desktop/src/renderer/src/CurrentUserProfile'
import { ThreadClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { NavigationShell } from '../../../apps/desktop/src/renderer/src/NavigationShell'
import { ThreadNavigation } from '../../../apps/desktop/src/renderer/src/ThreadNavigation'
import { MobileLayoutProvider, MobilePageHeader, useMobileViewport } from '../../../apps/desktop/src/renderer/src/MobileLayout'
import { changeInterfaceLanguage, uiAttribute, useInterfaceLanguage } from '../../../apps/desktop/src/renderer/src/interface-language'
import { initialMembers, defaultRuntime, installations, availability, navigation, clone } from '../member-editor/data'

const seed = () => initialMembers().map((member, index) => ({
  ...member,
  runtimeConfiguration: index === 0 ? { ...defaultRuntime('codex-cli'), model: { mode: 'explicit', modelId: 'gpt-5.4', options: { reasoning_effort: 'high' } } } : index === 2 ? defaultRuntime('claude-code-cli') : null,
  runtimeReadiness: { status: index === 0 || index === 2 ? 'ready' : 'runtime_not_configured', blockers: [] }
}))
let members = seed(), reload, failure = null, held = null, release = null, failRead = false, failReload = false
const calls = []
const client = {
  platform: 'darwin', onEvent: () => () => {}, channels: null,
  memberAvatars: { read: async () => null, selectSource: async () => null },
  request: async (method, payload) => {
    if (method === 'members.list') {
      if (failRead) throw new Error('Fixture read failure')
      return clone(members)
    }
    if (method === 'runtime.modelCatalog.open') {
      const installation = installations.find(item => item.adapterKind === payload.runtimeKind)
      return { runtimeKind: payload.runtimeKind, cache: installation.modelCatalog, models: installation.snapshot.models, refreshStatus: 'not_required', diagnosticCode: null }
    }
    const command = payload.command
    calls.push({ method, ...clone(payload) })
    if (held === command.agentId) { held = null; await new Promise(resolve => { release = resolve }) }
    await new Promise(resolve => setTimeout(resolve, 35))
    const member = members.find(item => item.agentId === command.agentId)
    if (!member || member.presence === 'removed') return { status: 'rejected', code: 'agent_profile.removed', payload: {} }
    if (member.version !== command.expectedVersion) return { status: 'rejected', code: 'agent_profile.version_conflict', payload: { version: member.version } }
    const mode = failure?.id === member.agentId ? failure.mode : null
    if (mode) failure = null
    if (mode === 'reject') return { status: 'rejected', code: 'runtime_configuration_unavailable', payload: {} }
    if (mode === 'unknown-uncommitted') throw new Error('Fixture lost request')
    const next = { ...member, version: member.version + 1 }
    if (method === 'members.runtime.set') {
      const { adapterKind, model, permissions } = command
      next.runtimeConfiguration = { adapterKind, model, permissions }
      next.runtimeReadiness = { status: 'ready', blockers: [] }
    } else if (method === 'members.runtime.clear') next.runtimeConfiguration = null
    else if (method === 'members.update') {
      const { agentId, expectedVersion, ...identity } = command
      Object.assign(next, identity)
    } else throw new Error('Unexpected fixture command: ' + method)
    members = members.map(item => item.agentId === next.agentId ? next : item)
    if (mode === 'unknown-committed') throw new Error('Fixture lost receipt')
    return { status: 'applied', payload: { agentId: next.agentId, version: next.version } }
  }
}
const profileApi = { get: async () => ({ displayName: '', avatarDataUrl: null }), save: async value => value }
function Fixture() {
  useInterfaceLanguage()
  const mobile = useMobileViewport(true)
  const [agents, setAgents] = useState(clone(members))
  const [selected, setSelected] = useState(members[0].agentId)
  const [epoch, setEpoch] = useState(0)
  const [tab, setTab] = useState('runtime')
  const [left, setLeft] = useState(false)
  const ref = useRef(null)
  reload = async () => { if (failReload) throw new Error('Fixture reload failure'); setAgents(clone(members)) }
  window.applyFixture = {
    calls, profiles: () => clone(members),
    reset: (scenario = 'normal') => {
      members = seed()
      if (scenario === 'empty') members = members.slice(0, 1)
      if (scenario === 'same') members = members.map(member => ({ ...member, runtimeConfiguration: clone(members[0].runtimeConfiguration) }))
      if (scenario === 'many') members.push(...Array.from({ length: 10 }, (_, index) => ({ ...clone(members[1]), agentId: 'extra-' + index, displayName: 'Long teammate name ' + index + ' ' + 'W'.repeat(55), memberOrder: index + 4 })))
      failure = null; failRead = false; failReload = false; calls.length = 0
      setAgents(clone(members)); setSelected(members[0].agentId); setTab('runtime'); setLeft(false); setEpoch(value => value + 1)
    },
    select: index => { setSelected(members[index].agentId); setTab('runtime') },
    fail: (index, mode) => { failure = { id: members[index].agentId, mode } },
    readFailure: value => { failRead = value }, reloadFailure: value => { failReload = value },
    hold: index => { held = members[index].agentId }, release: () => { release?.(); release = null },
    change: (index, config, publish = true) => { members[index] = { ...members[index], version: members[index].version + 1, runtimeConfiguration: config }; if (publish) void reload() },
    leave: () => ref.current.requestTransition(() => setLeft(true)),
    language: value => changeInterfaceLanguage({ setInterfaceLanguage: async interfaceLanguage => ({ interfaceLanguage }) }, value)
  }
  return <MobileLayoutProvider value={mobile}><NavigationShell platform="darwin" browser data-mobile-view={mobile ? 'members' : undefined}>
    <ThreadNavigation navigationId="global-navigation" view="members" state="ready" navigation={navigation} activeThreadId={null} currentProjectKey="fixture"
      pendingMemoryCount={0} onNewConversation={() => {}} onMembers={() => {}} onAutomations={() => {}} onMissions={() => {}} onMemory={() => {}} onSettings={() => {}}
      onOpenProject={() => {}} onThread={() => {}} onCreateInProject={() => {}} onRemoveProject={async () => {}} onRename={async () => {}} onDelete={async () => {}} onError={() => {}}/>
    {mobile && <MobilePageHeader title={uiAttribute('队员')} onOpenMenu={() => {}} menuOpen={false}/>}
    <main className="content members-content"><div className="members-workspace">{left ? <div data-left/> : <MembersView key={epoch} ref={ref} agents={agents} installations={installations}
      runtimeAvailability={availability} runtimeDiscoveryPending={false} selectedAgentId={selected} activeTab={tab} runtimeFocusRequest={0}
      onSelectedAgentChange={(id, nextTab) => { setSelected(id); setTab(nextTab) }} onTabChange={setTab} onReload={reload}
      onProfileCommitted={profile => setAgents(current => current.map(member => member.agentId === profile.agentId && member.version < profile.version ? profile : member))}
      onOpenRuntimeSettings={() => {}}/>}</div></main>
  </NavigationShell></MobileLayoutProvider>
}
createRoot(document.getElementById('root')).render(<ThreadClientProvider client={client}><CurrentUserProfileProvider api={profileApi}><Fixture/></CurrentUserProfileProvider></ThreadClientProvider>)
