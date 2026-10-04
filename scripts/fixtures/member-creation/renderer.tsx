import React from 'react'
import { createRoot } from 'react-dom/client'
import { BusinessApp } from '../../../apps/desktop/src/renderer/src/BusinessApp'
import { ThreadClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { CurrentUserProfileContext } from '../../../apps/desktop/src/renderer/src/CurrentUserProfile'
import { createReviewModel } from '../host-web-parity/model'
import { initial, agents, installations, message, navigation, now, availability, run as fixtureRun } from '../host-web-parity/data'
import { DEFAULT_GENERAL_PREFERENCES } from '../../../apps/desktop/src/shared/general-preferences-model'
import { DEFAULT_APPEARANCE } from '../../../apps/desktop/src/shared/appearance'
import { applyAppearanceSnapshot } from '../../../apps/desktop/src/renderer/src/theme'
import { changeInterfaceLanguage } from '../../../apps/desktop/src/renderer/src/interface-language'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/desktop/src/renderer/src/member-editor.css'
import '../../../apps/web/src/mobile.css'

// Production UI with deterministic in-memory transport; never a Core or real model.
const model = createReviewModel('web', 'camp')
const profiles = structuredClone(agents)
const calls: Array<{ method: string; params: any }> = []
const events = new Set<(event: any) => void>()
const pendingMode = new URLSearchParams(location.search).get('flow') === 'pending'
const checkpoint = pendingMode ? JSON.parse(localStorage.getItem('pending-fixture') ?? 'null') : null
const threads = new Map<string, any>(checkpoint?.threads ?? [])
const pendingPresence = new Set<string>(checkpoint?.presence ?? [])
let unavailable = false, rejectSend = false, lastHelper: string | null = profiles[1].agentId
let sequence = checkpoint?.sequence ?? 1
const appearance = { ...DEFAULT_APPEARANCE, preference: 'day', resolvedTheme: 'day' } as const
applyAppearanceSnapshot(document.documentElement, appearance)
const prefs = { ...DEFAULT_GENERAL_PREFERENCES, oneClickNewConversationEnabled: pendingMode, newConversationDefaults: { memberAgentIds: [profiles[0].agentId], defaultLeadAgentId: profiles[0].agentId } }
const navPrefs = { schemaVersion: 4, pins: [], removedProjects: [], projectOrder: [], projectNames: {}, threadReadStates: {} }
const applied = (payload = {}) => ({ status: 'applied', code: 'ok', payload, resultEntity: null })
const nav = () => {
  const rows = [...threads.values()].filter((thread) => (thread.thread.activationState === 'active' || pendingPresence.has(thread.thread.id))).map((thread) => navigation(thread).quickChat.recentThreads[0])
  return { schemaVersion: 3, throughGlobalSequence: sequence, projects: [], quickChat: { totalCount: rows.length, recentThreads: rows } }
}
const invalidate = (threadId: string) => events.forEach((fn) => fn({ method: 'thread.memberCreated', params: { threadId } }))
const projection = (thread: any) => {
  const coverage = (count: number) => ({ totalCount: count, loadedCount: count, omittedCount: 0, complete: true })
  return { ...structuredClone(thread), schemaVersion: 8, throughGlobalSequence: sequence,
    coverage: { tasks: coverage(0), messages: { ...coverage(thread.messages.length), hasEarlier: false,
      oldestLoadedSequence: thread.messages[0]?.sequence ?? null, newestLoadedSequence: thread.messages.at(-1)?.sequence ?? null },
    messageDeliveries: coverage(0), turns: coverage(0), agentRuns: coverage(thread.agentRuns.length), approvals: coverage(0) } }
}
const client = { ...model.client, onInvalidated: undefined,
  onEvent: (fn: any) => { events.add(fn); return () => events.delete(fn) },
  request: async (method: string, params: any = {}) => {
    calls.push({ method, params: structuredClone(params) })
    const command = params.command ?? params
    const thread = threads.get(command.threadId)
    if (method === 'members.list') return structuredClone(profiles)
    if (method === 'members.get') return structuredClone(profiles.find((member) => member.agentId === command.agentId))
    if (method === 'runtime.installations.list') return installations
    if (method === 'health.check') return { runtimeAvailability: availability, hostPlatform: 'darwin', runtimePlatformAdmission: [] }
    if (['memory.hearthReviewItems.list', 'missions.list', 'missions.cleanup.list'].includes(method)) return []
    if (method === 'navigation.snapshot') return nav()
    if (method === 'navigation.threads') return { throughGlobalSequence: sequence, groupKeys: ['quick-chat'], threads: nav().quickChat.recentThreads }
    if (method === 'navigation.findThread') return thread && (thread.thread.activationState === 'active' || pendingPresence.has(thread.thread.id)) ? navigation(thread).quickChat.recentThreads[0] : null
    if (method === 'threads.pendingDraft.setPresence') {
      if (!thread || thread.thread.activationState !== 'pending') throw new Error('pending draft unavailable')
      const changed = pendingPresence.has(command.threadId) !== command.present
      if (command.present) pendingPresence.add(command.threadId); else pendingPresence.delete(command.threadId)
      if (changed) events.forEach(fn => fn({ method: 'navigation.invalidated', params: { scope: 'group', threadId: command.threadId, groupKeys: ['quick-chat'] } }))
      return { changed }
    }
    if (method === 'threads.exists') return !!thread
    if (method === 'threads.creationPreflight') return { admissible: true, blockers: [], initialLeadAgentId: profiles[0].agentId,
      lastMemberCreationHelperAgentId: lastHelper, presentMembers: profiles.filter((member) => member.presence === 'present').map((member) => ({
        agentId: member.agentId, displayName: member.displayName, memberOrder: member.memberOrder,
        runtimeConfigured: !unavailable, runtimeReadiness: unavailable ? 'runtime_not_configured' : 'ready' })) }
    if (method === 'threads.create') {
      const id = `rvcamp_fixture_${++sequence}`
      const snapshot = structuredClone(initial)
      snapshot.thread = { ...snapshot.thread, id, title: command.name || '未命名对话', projectBindingKind: 'quick_chat', projectPath: '', defaultLeadAgentId: command.defaultLeadAgentId, activationState: command.activationState }
      snapshot.messages = []
      snapshot.members = snapshot.members.filter((member) => command.memberAgentIds.includes(member.agentId)).map((member) => ({ ...member, isDefaultLead: true }))
      threads.set(id, snapshot)
      return applied({ threadId: id })
    }
    if (method === 'threads.open' || method === 'threads.enter') return projection(thread)
    if (method === 'threads.discardPending') { if (thread?.thread.activationState === 'pending' && !pendingPresence.has(command.threadId)) threads.delete(command.threadId); return applied() }
    if (method === 'navigation.threadViewed') return { threadId: command.threadId, lastSeenGlobalSequence: command.throughGlobalSequence, changed: false, navigation: { throughGlobalSequence: sequence, groupKeys: [], threads: [] } }
    if (method === 'thread.pendingInputs.get') return { threadId: command.threadId, executionActive: false, items: [], editSession: null, submissionOutcomes: [] }
    if (method === 'thread.messages.send') {
      if (rejectSend) { rejectSend = false; return { commandResult: { status: 'rejected', code: 'fixture.send_rejected', payload: { message: 'Fixture rejected send' } } } }
      const content = command.content.segments ?? command.content
      const body = content.map((segment: any) => segment.text ?? '').join('')
      const item = { ...message(thread.messages.length + 1, body, 'user'), addressedAgentIds: [thread.thread.defaultLeadAgentId], createdAt: new Date().toISOString() }
      pendingPresence.delete(command.threadId); thread.thread.activationState = 'active'; thread.thread.title = body.split('\n')[0]; thread.messages.push(item); sequence++
      return { commandResult: applied({ threadMessageId: item.id, sequence: item.sequence, deliveryIds: [], agentRunIds: [], addressedAgentIds: [thread.thread.defaultLeadAgentId] }) }
    }
    if (method === 'events.subscribe') return { schemaVersion: 9, events: [], nextGlobalSequence: sequence, throughGlobalSequence: sequence, resetRequired: false }
    if (method === 'notifications.inbox') return { schemaVersion: 8, items: [], unreadCount: 0, throughChangeSequence: 0, nextCursor: null }
    if (method === 'notifications.preference.get') return { version: 1, updatedAt: now, headsUpEnabled: false }
    if (method === 'notifications.changesSince') return { schemaVersion: 8, changes: [], nextChangeSequence: 0, throughChangeSequence: 0, retainedFloorChangeSequence: 0, resetRequired: false, hasMore: false }
    if (method === 'notifications.acknowledgeVisibleSources') return applied()
    if (method === 'members.reorder') { const next = command.orderedAgentIds.map((id: string, memberOrder: number) => ({ ...profiles.find((member) => member.agentId === id)!, memberOrder })); profiles.splice(0, profiles.length, ...next); return applied() }
    return model.client.request(method as any, params)
  }
}
const preferences: any = { appearance: { get: async () => appearance, onChanged: () => () => {} },
  generalPreferences: new Proxy({}, { get: (_, key) => async (...args: any[]) => { if (key === 'setInterfaceLanguage') prefs.interfaceLanguage = args[0]; return prefs } }),
  navigationPreferences: new Proxy({}, { get: () => async () => navPrefs }) }
const environment: any = { client, files: { ...model.fileApi, bindThread: async () => {} }, preferences,
  navigationHistory: { initial: { entries: [pendingMode ? { kind: 'quick_chat' } : { kind: 'members', agentId: profiles[0].agentId, tab: 'identity' }], index: 0 }, write: (state: any) => state, go: async () => false, listen: () => () => {} } }
;(window as any).memberCreationQA = { calls, threads, profiles, pendingPresence, errors: [],
  checkpoint: () => localStorage.setItem('pending-fixture', JSON.stringify({ threads: [...threads].filter(([id, t]) => t.thread.activationState === 'active' || pendingPresence.has(id)), presence: [...pendingPresence], sequence })),
  unavailable: (value: boolean) => { unavailable = value },
  rejectSend: () => { rejectSend = true },
  lastHelper: (id: string | null) => { lastHelper = id },
  language: (language: any) => changeInterfaceLanguage(preferences.generalPreferences, language),
  theme: (theme: 'night' | 'day') => applyAppearanceSnapshot(document.documentElement, { ...appearance, preference: theme, resolvedTheme: theme }),
  join: (threadId: string) => {
    const thread = threads.get(threadId), helper = profiles.find((member) => member.agentId === thread.thread.defaultLeadAgentId)!
    const member = { ...structuredClone(profiles[0]), agentId: 'new-teammate', displayName: 'Nova', teamRole: 'Research partner', avatarRef: null,
      professionalResponsibilities: 'Compare evidence and explain uncertainty.', personalityTraits: ['Curious', 'Precise'], runtimeConfiguration: null }
    if (!profiles.some((profile) => profile.agentId === member.agentId)) profiles.push(member)
    const createdAt = new Date().toISOString(), runId = `creator-${threadId}`
    thread.agentRuns = [{ ...fixtureRun, id: runId, agentId: helper.agentId, threadTurnId: `turn-${threadId}`,
      executionEvidenceCount: 0, createdAt, startedAt: createdAt, updatedAt: createdAt }]
    thread.memberCreations = [{ ...member, creationId: 'fixture-creation', sourceAgentRunId: runId,
      creatorAgentId: helper.agentId, creatorDisplayName: helper.displayName, createdAt }]
    thread.messages.push({ ...message(thread.messages.length + 1, 'Nova 已创建，正在整理本次结果。', 'agent'),
      authorId: helper.agentId, sourceAgentRunId: runId, createdAt })
    events.forEach((fn) => fn({ method: 'members.invalidated', params: {} })); invalidate(threadId)
  },
  finish: (threadId: string) => {
    const thread = threads.get(threadId), run = thread.agentRuns[0], completedAt = new Date().toISOString()
    Object.assign(run, { status: 'succeeded', endedAt: completedAt, updatedAt: completedAt, version: 2 })
    thread.messages.push({ ...message(thread.messages.length + 1, 'Nova 已加入队伍，可以前往队员页配置智能体。', 'agent'),
      authorId: run.agentId, sourceAgentRunId: run.id, createdAt: completedAt })
    thread.agentRunFileChanges = [{ schemaVersion: 2, agentRunId: run.id, executionEpoch: 1,
      fileCount: 1, operationCount: 1, completedAt,
      files: [{ evidenceFileId: 'fixture-file', path: 'notes/nova.md', changeKind: 'create', presentationKind: 'operation_history', operationCount: 1 }] }]
    invalidate(threadId)
  },
  away: () => { const member = profiles.find((item) => item.agentId === 'new-teammate')!; member.displayName = 'Nova renamed'; member.presence = 'away'; events.forEach((fn) => fn({ method: 'members.invalidated', params: {} })) }
}
window.addEventListener('error', (event) => (window as any).memberCreationQA.errors.push(String(event.error?.stack ?? event.message)))
window.addEventListener('unhandledrejection', (event) => (window as any).memberCreationQA.errors.push(String(event.reason)))
createRoot(document.getElementById('root')!).render(<ThreadClientProvider client={client as any}><CurrentUserProfileContext.Provider value={{ profile: { displayName: '', avatarDataUrl: null }, update: async () => {} } as any}><BusinessApp environment={environment} /></CurrentUserProfileContext.Provider></ThreadClientProvider>)
