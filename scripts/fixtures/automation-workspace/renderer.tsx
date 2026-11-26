import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AgentProfile, AutomationRunSummary, AutomationView, CoreEvent, ProjectNavigationGroup, RovaiApi, ThemeId } from '@contracts'
import { AutomationWorkspace } from '../../../apps/desktop/src/renderer/src/AutomationWorkspace'
import { MobileLayoutProvider, useMobileViewport } from '../../../apps/desktop/src/renderer/src/MobileLayout'
import { ThreadNavigation } from '../../../apps/desktop/src/renderer/src/ThreadNavigation'
import { WindowDragStrip } from '../../../apps/desktop/src/renderer/src/App'
import { defaultThreadNaming } from '../../../apps/desktop/src/renderer/src/automation-thread-naming'
import { templates } from '../../../apps/desktop/src/renderer/src/automation-workspace-model'
import { applyAppearanceSnapshot } from '../../../apps/desktop/src/renderer/src/theme'
import { DEFAULT_APPEARANCE, THEME_MODES } from '../../../apps/desktop/src/shared/appearance'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/web/src/mobile.css'

// Production Renderer with deterministic, memory-only RPC responses. No Core, credentials or Runtime.
const params = new URLSearchParams(location.search)
const theme = params.get('theme') === 'night' ? 'night' : 'day'
applyAppearanceSnapshot(document.documentElement, { ...DEFAULT_APPEARANCE, preference: theme, resolvedTheme: theme })
const now = '2026-09-07T01:00:00Z'
const definitionTimestamp = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, 'Z')
const agents: AgentProfile[] = [
  ['luoke', '洛克', '工程实现'], ['mianzhi', '棉枝', '技术写作'], ['qilu', '祈露', '产品设计']
].map(([id, displayName, teamRole], memberOrder) => ({
  agentId: id, displayName, teamRole, avatarRef: `rovai://member-avatar/builtin/${id}/v1`, accent: null,
  professionalResponsibilities: '', personalityTraits: [], workingPrinciples: '', growthTopic: '', defaultCapabilities: [],
  presence: 'present', runtimeConfiguration: { adapterKind: 'codex-cli', model: { mode: 'explicit', modelId: 'gpt-5.4', options: {} }, permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: {} } },
  runtimeReadiness: { status: 'ready', blockers: [] }, memberOrder, version: 1, createdAt: now, updatedAt: now, removedAt: null
}))
const projects: ProjectNavigationGroup[] = [{ projectKey: '/workspace/rovai-ai', projectPath: '/workspace/rovai-ai', name: 'rovai-ai', lastActivityAt: now, lastActivityGlobalSequence: 0, totalCount: 0, recentThreads: [] }]
const history: Record<string, AutomationRunSummary[]> = {}
let automations: AutomationView[] = Object.entries(templates).map(([id, template], index) => {
  history[id] = Array.from({ length: 24 }, (_, position): AutomationRunSummary => {
    const status = position === 0 ? 'running' : position === 1 ? 'skipped' : position === 2 ? 'failed' : 'completed'
    const createdAt = new Date(Date.parse(now) - position * 86_400_000).toISOString()
    return { runId: `${id}-run-${position}`, status, reason: status === 'skipped' ? 'overlap' : status === 'failed' ? 'timeout' : null,
      threadId: status === 'skipped' ? null : `fixture-camp-${position}`, resultMessageId: status === 'completed' ? `message-${position}` : null,
      scheduledFor: createdAt, createdAt, endedAt: status === 'running' ? null : createdAt, notificationStatus: position === 3 ? 'failed' : 'none' }
  })
  return { automationId: id, version: 1, name: template.name, prompt: template.prompt, schedule: template.schedule, threadNaming: defaultThreadNaming(),
    enabled: index !== 2, memberId: agents[index].agentId, projectRef: { kind: 'directory', path: projects[0].projectPath }, notifyChannels: [],
    nextRunAt: index === 2 ? null : '2026-09-08T01:00:00Z', lastRun: history[id][0], createdAt: now,
    updatedAt: definitionTimestamp(new Date(Date.parse(now) - index * 1000)) }
})
if (params.has('list-cases')) {
  automations.push(
    { ...automations[0], automationId: 'paused', name: '暂停巡检', enabled: false, nextRunAt: null, lastRun: null, updatedAt: '2001-01-01T00:00:00.000Z' },
    { ...automations[0], automationId: 'ended', name: '单次复盘', schedule: { kind: 'once', date: '2000-01-01', at: '10:30' },
      enabled: false, nextRunAt: null, lastRun: null, updatedAt: '2000-01-01T00:00:00.000Z' })
}
if (params.has('empty')) automations = []
if (params.has('no-members')) agents.splice(0)
let failNextSave = params.has('save-failure')
let conflictNextSave = params.has('conflict')
let failNextList = params.has('load-failure')
const listeners = new Set<(event: CoreEvent) => void>()
const calls: Array<{ method: string; command: unknown }> = []
let heldSave: Promise<void> | null = null
let releaseSave: (() => void) | null = null
let heldList: Promise<void> | null = null
let releaseList: (() => void) | null = null
Object.assign(window, { automationWorkspaceFixture: {
  theme: (resolvedTheme: 'day' | 'night') => applyAppearanceSnapshot(document.documentElement, { ...DEFAULT_APPEARANCE, preference: resolvedTheme, resolvedTheme }),
  palette: (preference: ThemeId) => applyAppearanceSnapshot(document.documentElement, { ...DEFAULT_APPEARANCE, preference, resolvedTheme: THEME_MODES[preference] }),
  failSave: () => { failNextSave = true },
  holdSave: () => { heldSave = new Promise<void>(resolve => { releaseSave = resolve }) },
  releaseSave: () => { releaseSave?.(); heldSave = null; releaseSave = null },
  holdLists: () => { heldList = new Promise<void>(resolve => { releaseList = resolve }); changed() },
  releaseLists: () => { releaseList?.(); heldList = null; releaseList = null },
  commands: () => structuredClone(calls),
  definitions: () => structuredClone(automations),
  saveCount: () => calls.filter(call => call.method === 'automations.update').length
} })
const callListeners = new Set<() => void>()
function changed(): void {
  queueMicrotask(() => listeners.forEach(listener => listener({ method: 'automations.updated', params: {} } as CoreEvent)))
}
window.rovai = {
  platform: 'darwin',
  onEvent(listener: (event: CoreEvent) => void) { listeners.add(listener); return () => listeners.delete(listener) },
  channels: { get: async () => ({ channels: ['feishu', 'dingtalk'].map(kind => ({ kind, memberBots: agents.map(agent => ({ agentId: agent.agentId, publicationStatus: kind === 'feishu' ? 'published' : 'unpublished', botDisplayName: `${agent.displayName} Bot` })) })) }), onChanged: () => () => undefined },
  async request(method: string, args: Record<string, any> = {}) {
    const command = args.command ?? {}
    if (method === 'automations.list') {
      if (failNextList) { failNextList = false; throw new Error('测试：任务列表暂时无法读取') }
      const snapshot = structuredClone(automations).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.automationId.localeCompare(a.automationId))
      if (heldList) await heldList
      return { automations: snapshot, nextCursor: null, truncated: false }
    }
    if (method === 'automations.runs.list') {
      const offset = Number(args.cursor ?? 0)
      const records = history[args.automationId] ?? []
      const end = offset + args.limit
      return structuredClone({ runs: records.slice(offset, end), nextCursor: end < records.length ? String(end) : null, truncated: end < records.length })
    }
    calls.push({ method, command: structuredClone(command) })
    callListeners.forEach(listener => listener())
    const current = automations.find(item => item.automationId === command.automationId)
    if (method === 'automations.update' && heldSave) await heldSave
    if (method === 'automations.update' && failNextSave) { failNextSave = false; throw new Error('测试：保存失败，草稿应保留') }
    if (method === 'automations.update' && conflictNextSave && current) {
      conflictNextSave = false
      current.version += 1
      current.name = '其他位置修改的名称'
      return { status: 'rejected', code: 'command.version_conflict', payload: {} }
    }
    let result: unknown
    const updatedAt = definitionTimestamp(new Date())
    if (method === 'automations.create') {
      const created: AutomationView = { ...command, name: command.name.trim() || command.prompt.slice(0, 30), automationId: crypto.randomUUID(), version: 1, enabled: true, nextRunAt: null, lastRun: null, createdAt: updatedAt, updatedAt }
      automations.unshift(created)
      result = created
    } else if (current && method === 'automations.update') {
      if (command.expectedVersion !== current.version) return { status: 'rejected', code: 'command.version_conflict', payload: {} }
      const schedule = command.schedule ?? current.schedule
      if ((command.enabled ?? current.enabled) && schedule.kind === 'once') {
        const next = new Date(`${schedule.date}T${schedule.at}:00`)
        if (next.getTime() <= Date.now()) return { status: 'rejected', code: 'automation.schedule_in_past', payload: {} }
        current.nextRunAt = next.toISOString()
      }
      Object.assign(current, command, { version: current.version + 1, updatedAt })
      result = current
    } else if (current && method === 'automations.close') {
      Object.assign(current, { enabled: false, nextRunAt: null, version: current.version + 1, updatedAt })
      result = current
    } else if (current && method === 'automations.delete') {
      automations = automations.filter(item => item !== current)
      result = {}
    } else if (current && method === 'automations.run') {
      const run: AutomationRunSummary = { runId: crypto.randomUUID(), status: 'running', reason: null, scheduledFor: updatedAt,
        createdAt: updatedAt, endedAt: null, notificationStatus: 'none', threadId: null, resultMessageId: null }
      const runs = history[current.automationId] ??= []
      runs.unshift(run)
      current.lastRun = run
      result = { status: 'started', run }
    } else throw new Error(`Unexpected fixture RPC: ${method}`)
    changed()
    return structuredClone({ status: 'applied', code: 'ok', payload: result })
  }
} as unknown as RovaiApi

function Fixture(): React.JSX.Element {
  const mobile = useMobileViewport(params.has('mobile'))
  const [, setCallRevision] = useState(0)
  useEffect(() => {
    const update = (): void => setCallRevision(revision => revision + 1)
    callListeners.add(update)
    return () => { callListeners.delete(update) }
  }, [])
  const [notice, setNotice] = useState('')
  const [key, setKey] = useState(0)
  const idle = (): void => undefined
  return <MobileLayoutProvider value={mobile}><div className="app-shell">
    <WindowDragStrip page="automations" />
    <ThreadNavigation view="automations" state="ready" navigation={{ schemaVersion: 3, throughGlobalSequence: 0, quickChat: { totalCount: 0, recentThreads: [] }, projects }} activeThreadId={null}
      onNewConversation={idle} onMembers={idle} onAutomations={() => setKey(value => value + 1)} onMemory={idle} pendingMemoryCount={0} onSettings={idle}
      onOpenProject={idle} onThread={idle} onRemoveProject={async () => undefined} onRename={async () => undefined} onDelete={async () => undefined} onError={error => setNotice(String(error))} />
    <main className="content automation-content"><AutomationWorkspace key={key} agents={agents} projects={projects} defaultMemberId={agents[0]?.agentId ?? ''}
      onOpenThread={threadId => setNotice(`打开执行对话：${threadId}`)} /></main>
    {notice && <output role="status" style={{ position: 'fixed', bottom: 20, left: 290, padding: '10px 14px', color: 'var(--ink)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 7 }}>{notice}</output>}
    <details style={{ position: 'fixed', left: 10, bottom: 42, maxWidth: 245, fontSize: 10, color: 'var(--muted)' }}><summary>验收记录</summary><pre style={{ maxHeight: 220, overflow: 'auto' }}>{JSON.stringify(calls, null, 2)}</pre></details>
  </div></MobileLayoutProvider>
}
const root = createRoot(document.getElementById('root')!)
root.render(<Fixture />)
import.meta.hot?.dispose(() => root.unmount())
