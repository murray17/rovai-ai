import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/desktop/src/renderer/src/member-editor.css'
import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MembersView } from '../../../apps/desktop/src/renderer/src/MemberManagement'
import { CampNavigation } from '../../../apps/desktop/src/renderer/src/CampNavigation'
import {
  availability,
  initialMembers,
  installations,
  navigation,
  clone
} from './data'
let members = initialMembers()
const calls = []
let reload,
  failMethod = null,
  failReload = false,
  openSettings
const assets = new Map()
let selectedSource = null
window.rovai = {
  platform: 'darwin',
  memberAvatars: {
    read: async (ref, rendition) => {
      const source = assets.get(ref)
      return source
        ? {
            bytes: Array.from(
              rendition === 'portrait' ? source.sourcePng : source.iconPng
            ),
            width: rendition === 'portrait' ? source.sourceWidth : 192,
            height: rendition === 'portrait' ? source.sourceHeight : 192,
            crop: source.crop
          }
        : null
    },
    selectSource: async () => selectedSource,
    save: async (source) => {
      const avatarRef = `rovai://member-avatar/managed/${crypto.randomUUID()}`
      assets.set(avatarRef, source)
      return { avatarRef, crop: source.crop }
    }
  },
  request: async (method, payload) => {
    if (method === 'runtime.modelCatalog') {
      const installation = installations.find(
        (item) => item.adapterKind === payload.runtimeKind
      )
      return {
        runtimeKind: payload.runtimeKind,
        cache: installation.modelCatalog,
        models: installation.snapshot.models,
        refreshStatus: 'completed',
        diagnosticCode: null
      }
    }
    if (method === 'members.list') return clone(members)
    const command = payload.command ?? payload
    calls.push({ method, command: clone(command) })
    await new Promise((resolve) => setTimeout(resolve, 70))
    if (failMethod === method) {
      failMethod = null
      throw new Error('验收模拟保存失败，修改仍保留。')
    }
    const member = members.find((item) => item.agentId === command.agentId)
    if (method === 'members.removalPreview')
      return {
        agentId: member.agentId,
        version: member.version,
        removable: true,
        currentCampMembershipCount: 0,
        openAssignedTaskCount: 0,
        defaultLeadCampCount: 0,
        nonTerminalAgentRunCount: 0
      }
    if (method === 'members.reorder') {
      members = command.orderedAgentIds.map((id) =>
        members.find((item) => item.agentId === id)
      )
      return { status: 'applied', payload: {}, resultEntity: null }
    }
    if (member && member.version !== command.expectedVersion)
      return {
        status: 'rejected',
        code: 'agent_profile.version_conflict',
        payload: { version: member.version }
      }
    let next
    if (method === 'members.create') {
      next = {
        ...initialMembers()[0],
        ...command,
        agentId: `agent_${members.length + 1}`,
        runtimeConfiguration: null,
        runtimeReadiness: { status: 'runtime_not_configured', blockers: [] },
        version: 1
      }
      members.push(next)
    } else {
      next = { ...member, version: member.version + 1 }
      if (method === 'members.update') {
        const { agentId, expectedVersion, ...identity } = command
        Object.assign(next, identity)
      }
      if (method === 'members.avatar.set') next.avatarRef = command.avatarRef
      if (method === 'members.runtime.set') {
        const { adapterKind, model, permissions } = command
        next.runtimeConfiguration = { adapterKind, model, permissions }
      }
      if (method === 'members.runtime.clear') next.runtimeConfiguration = null
      if (method === 'members.presence.set') next.presence = command.presence
      if (method === 'members.remove') {
        next.presence = 'removed'
        next.removedAt = new Date().toISOString()
      }
      members = members.map((item) =>
        item.agentId === next.agentId ? next : item
      )
    }
    return {
      status: 'applied',
      code: method,
      payload: { agentId: next.agentId, version: next.version },
      resultEntity: { entityId: next.agentId }
    }
  }
}
window.memberFixture = {
  calls,
  profiles: () => clone(members),
  installations,
  fail: (method) => {
    failMethod = method
  },
  failReload: (value) => {
    failReload = value
  },
  change: (id, patch) => {
    members = members.map((member) =>
      member.agentId === id
        ? { ...member, ...patch, version: member.version + 1 }
        : member
    )
    reload()
  },
  source: (value) => {
    selectedSource = value
  },
  theme: (theme) => {
    document.documentElement.dataset.theme = theme
  },
  leave: () => openSettings(),
  reset: () => {
    members = initialMembers()
    reload()
    calls.splice(0)
  }
}
function Fixture() {
  const [agents, setAgents] = useState(members)
  const [selected, setSelected] = useState(members[0].agentId)
  const [tab, setTab] = useState('identity')
  const [view, setView] = useState('members')
  const ref = useRef(null)
  reload = () => {
    if (failReload) return Promise.reject(new Error('验收模拟读取失败'))
    setAgents(clone(members))
    return Promise.resolve()
  }
  openSettings = () => ref.current.requestTransition(() => setView('settings'))
  const noop = () => {}
  return (
    <div className="app-shell">
      <CampNavigation
        view="members"
        state="ready"
        navigation={navigation}
        activeCampId={null}
        currentProjectKey="prototype-project"
        pendingMemoryCount={0}
        onNewConversation={noop}
        onMembers={() => setView('members')}
        onAutomations={noop}
        onMemory={noop}
        onSettings={openSettings}
        onOpenProject={noop}
        onCamp={noop}
        onCreateInProject={noop}
        onRemoveProject={async () => {}}
        onRename={async () => {}}
        onDelete={async () => {}}
        onError={noop}
      />
      <div
        className="window-drag-strip window-drag-strip-members"
        aria-hidden="true"
      />
      <main className="content members-content">
        {view === 'members' ? (
          <div className="members-workspace">
            <MembersView
              ref={ref}
              agents={agents}
              installations={installations}
              runtimeAvailability={availability}
              runtimeDiscoveryPending={false}
              selectedAgentId={selected}
              activeTab={tab}
              runtimeFocusRequest={0}
              onSelectedAgentChange={(id, tab) => {
                setSelected(id)
                setTab(tab)
              }}
              onTabChange={setTab}
              onReload={reload}
              onProfileCommitted={(profile) =>
                setAgents((current) =>
                  current.some((member) => member.agentId === profile.agentId)
                    ? current.map((member) =>
                        member.agentId === profile.agentId ? profile : member
                      )
                    : [...current, profile]
                )
              }
              onOpenRuntimeSettings={openSettings}
            />
          </div>
        ) : (
          <button onClick={() => setView('members')}>返回队员</button>
        )}
      </main>
    </div>
  )
}
createRoot(document.getElementById('root')).render(<Fixture />)
