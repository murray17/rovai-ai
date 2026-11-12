import { languageTestApi } from '../../../apps/desktop/src/renderer/src/interface-language-test-api'
import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AgentProfile, MemoryRecord, HearthReviewItem } from '@contracts'
import { MemoryLibrary } from '../../../apps/desktop/src/renderer/src/MemoryLibrary'
import { MemoryChangeNotice } from '../../../apps/desktop/src/renderer/src/MemoryChangeNotice'
import { collectMemoryChanges, memoryChangeText } from '../../../apps/desktop/src/renderer/src/memory-change-notice'
import { ThreadClientProvider, type ThreadClient } from '../../../apps/desktop/src/renderer/src/camp-client'
import { NavigationShell } from '../../../apps/desktop/src/renderer/src/NavigationShell'
import { WindowDragStrip } from '../../../apps/desktop/src/renderer/src/BusinessApp'
import { WindowsApplicationMenu } from '../../../apps/desktop/src/renderer/src/WindowsApplicationMenu'
import { ThreadNavigation } from '../../../apps/desktop/src/renderer/src/ThreadNavigation'
import { MobileLayoutProvider, useMobileViewport } from '../../../apps/desktop/src/renderer/src/MobileLayout'
import { changeInterfaceLanguage } from '../../../apps/desktop/src/renderer/src/interface-language'
import type { MemoryNavigationTarget } from '../../../apps/desktop/src/renderer/src/desktop-navigation'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/web/src/mobile.css'

// Only the transport/data are synthetic. All memory, dialog and rail UI is production code.
const date = '2026-10-19T07:00:00Z'
const agents = [{ agentId: 'member-a', displayName: '林', avatarRef: null }, { agentId: 'member-b', displayName: '舟', avatarRef: null }] as AgentProfile[]
function memory(id: string, scope: MemoryRecord['scope'], body: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  const revision = { id: `${id}-r1`, body, bodyUtf8Bytes: new TextEncoder().encode(body).length, retrievalKeys: ['表达偏好'], actorKind: 'user' as const, actorId: 'owner', sourceThreadId: null, sourceAgentRunId: null, sourceExecutionEpoch: null, createdFromHearthReviewItemId: null, createdAt: date, clearedAt: null }
  return { id, scope, kind: scope === 'relationship' ? 'agreement' : 'preference', creationOrigin: 'user', companionAgentId: scope === 'companion' ? 'member-a' : null, relationshipAgentIds: scope === 'relationship' ? ['member-a', 'member-b'] : [], direction: scope === 'relationship' ? 'mutual' : null, directedActorAgentId: null, lifecycle: 'active', currentRevisionId: revision.id, currentBody: body, currentBodyUtf8Bytes: revision.bodyUtf8Bytes, currentRetrievalKeys: revision.retrievalKeys, reviewAfter: null, reviewDue: false, outgoingSuccessorIds: [], incomingPredecessorIds: [], version: 1, createdAt: date, updatedAt: date, retiredAt: null, forgottenAt: null, revisions: [revision], ...extra }
}
const longBody = '先说明结论，再补充必要的依据。\n\n细节可以展开查看，重要的限制应保留在正文中。'
let memories = [memory('shared-1', 'hearth', longBody), memory('member-1', 'companion', '发送结果时附上可直接打开的文件。', { creationOrigin: 'agent' }), memory('pair-1', 'relationship', '开始修改前明确各自负责的文件。', { creationOrigin: 'agent', reviewDue: true, reviewAfter: '2026-01-01T00:00:00Z' }), memory('shared-2', 'hearth', '工作完成后同步远端分支。', { creationOrigin: 'agent' }), memory('member-2', 'companion', '遇到不确定事实时先检查证据。', { creationOrigin: 'agent' }), memory('pair-2', 'relationship', '交接时保留未解决的问题。'), memory('retired-1', 'hearth', '曾经采用的写作约定。', { lifecycle: 'retired', retiredAt: date })]
let reviews: HearthReviewItem[] = [{ reviewItemId: 'review-1', requestedAction: 'add', status: 'pending', stale: false, version: 1, candidateKind: 'agreement', candidateBody: '提交结果时说明验证方法。', candidateRetrievalKeys: ['结果说明'], targetMemoryId: null, baseRevisionId: null, sourceAgentId: 'member-a', sourceThreadId: 'thread-demo', sourceAgentRunId: 'run-demo', sourceExecutionEpoch: 1, acceptedMemoryId: null, acceptedRevisionId: null, resolvedByUserId: null, invalidationReason: null, editedBeforeAcceptance: null, createdAt: date, resolvedAt: null }]
let failNext = false
let failedReads = 0
let failAfterReview = false
let heldReview: Promise<void> | null = null
let releaseReview: (() => void) | null = null
const clearCandidate = (item: HearthReviewItem): void => {
  item.candidateBody = null; item.candidateRetrievalKeys = null; item.candidateKind = null; item.resolvedAt = date
}
let memoryCapability = { enabled: true, headsUpAfterGlobalSequence: 0, observedThroughChangeSequence: 0, observedThroughGlobalSequence: 0 }
let capabilityReadFailures = 0
let capabilitySaveFailures = 0
let capabilitySaves = 0
let heldCapabilitySave: Promise<void> | null = null
let releaseCapabilitySave: (() => void) | null = null
let memoryBusinessReads = 0
const capabilityListeners = new Set<(event: any) => void>()
let heldCapabilityRead: Promise<void> | null = null
let releaseCapabilityRead: (() => void) | null = null
let heldMemoryRead: Promise<void> | null = null
let releaseMemoryRead: (() => void) | null = null
let capabilityReadWaiting = false
let memoryReadWaiting = false
let heldMutationReceipt: Promise<void> | null = null
let releaseMutationReceipt: (() => void) | null = null
let mutationReceiptWaiting = false
const invalidateCapability = () => capabilityListeners.forEach(listener => listener({ method: 'preferences.memory_changed', params: {} }))
const setMemoryEnabled = (enabled: boolean) => {
  if (memoryCapability.enabled !== enabled) memoryCapability = { ...memoryCapability, enabled, observedThroughChangeSequence: memoryCapability.observedThroughChangeSequence + 1 }
  invalidateCapability()
}
const calls: Array<{ method: string; command: any }> = []
const client = { platform: 'darwin', async request(method: string, params: any = {}) {
  if (method === 'preferences.memory.get') {
    if (capabilityReadFailures > 0) { capabilityReadFailures--; throw new Error('capability read unavailable') }
    const reply = structuredClone(memoryCapability)
    if (heldCapabilityRead) { const held = heldCapabilityRead; heldCapabilityRead = null; capabilityReadWaiting = true; await held; capabilityReadWaiting = false }
    return reply
  }
  if (method === 'preferences.memory.set') {
    capabilitySaves++
    if (heldCapabilitySave) { const held = heldCapabilitySave; heldCapabilitySave = null; await held }
    if (capabilitySaveFailures > 0) { capabilitySaveFailures--; throw new Error('Setting save unavailable') }
    setMemoryEnabled(params.enabled)
    return structuredClone(memoryCapability)
  }
  if (method.startsWith('memory.')) {
    memoryBusinessReads++
    if (!memoryCapability.enabled) throw new Error('memory.feature_disabled')
  }
  if (method === 'preferences.tasks.get') return { enabled: false, headsUpAfterSequence: 0, observedThroughChangeSequence: 0 }
  if (method === 'memory.list' && failedReads > 0) { failedReads--; throw new Error('演示刷新失败。') }
  if (method === 'memory.list') {
    const reply = structuredClone({ memories, capacities: [] })
    if (heldMemoryRead) { const held = heldMemoryRead; heldMemoryRead = null; memoryReadWaiting = true; await held; memoryReadWaiting = false }
    return reply
  }
  if (method === 'memory.hearthReviewItems.list') return structuredClone(reviews)
  if (method === 'memory.get') return structuredClone(memories.find(m => m.id === params.memoryId))
  const c = params.command
  if (!c) throw new Error(`Unexpected fixture request: ${method}`)
  calls.push({ method, command: structuredClone(c) })
  if (failNext) { failNext = false; throw new Error('演示连接中断，请重试。') }
  const current = memories.find(m => m.id === c.memoryId)
  if (current && (current.version !== c.expectedVersion || c.baseRevisionId && current.currentRevisionId !== c.baseRevisionId)) return { status: 'rejected', code: 'memory.version_conflict', payload: { message: '版本已变化' } }
  let memoryId = current?.id
  if (method === 'memory.create') { memoryId = `created-${memories.length}`; memories.unshift(memory(memoryId, c.scope, c.body, { ...c, currentRetrievalKeys: c.retrievalKeys })); }
  else if (method === 'memory.revise' && current) {
    current.version++; current.currentRevisionId = `${current.id}-r${current.version}`; current.currentBody = c.body; current.currentRetrievalKeys = c.retrievalKeys
    current.revisions.unshift({ ...current.revisions[0], id: current.currentRevisionId, body: c.body, retrievalKeys: c.retrievalKeys })
  } else if (method === 'memory.review.schedule' && current) { current.reviewAfter = c.reviewAfter; current.reviewDue = false; current.version++ }
  else if (method === 'memory.retire' && current) { current.lifecycle = 'retired'; current.version++ }
  else if (method === 'memory.reactivate' && current) { current.lifecycle = 'active'; current.version++ }
  else if (method === 'memory.forget' && current) { current.lifecycle = 'forgotten'; current.currentBody = null; current.currentRetrievalKeys = []; current.revisions = []; current.version++ }
  else if (method.startsWith('memory.hearthReviewItems.')) {
    if (heldReview) await heldReview
    const item = reviews.find(r => r.reviewItemId === c.reviewItemId)!
    if (item.status !== 'pending' || item.version !== c.expectedReviewItemVersion) return { status: 'rejected', code: 'memory.review_version_conflict', payload: {} }
    if (method.endsWith('.accept') && item.stale) return { status: 'rejected', code: 'memory.review_stale', payload: {} }
    item.status = method.endsWith('.accept') ? 'accepted' : 'rejected'; item.version++
    if (item.status === 'accepted') {
      const body = c.finalBody ?? item.candidateBody!
      const keys = c.finalRetrievalKeys ?? item.candidateRetrievalKeys!
      let target = memories.find(m => m.id === item.targetMemoryId)
      if (item.requestedAction === 'revise' && target) {
        target.version++; target.currentBody = body; target.currentRetrievalKeys = keys; target.currentRevisionId = `${target.id}-r${target.version}`
        target.revisions.unshift({ ...target.revisions[0], id: target.currentRevisionId, body, retrievalKeys: keys })
      } else {
        target = memory(`accepted-${item.reviewItemId}`, 'hearth', body, { creationOrigin: 'accepted_hearth_review', currentRetrievalKeys: keys })
        memories.unshift(target)
      }
      item.acceptedMemoryId = target.id; item.acceptedRevisionId = target.currentRevisionId
      item.editedBeforeAcceptance = c.finalBody !== undefined || c.finalRetrievalKeys !== undefined
    }
    clearCandidate(item)
    if (failAfterReview) { failedReads++; failAfterReview = false }
  } else throw new Error(`Unexpected fixture mutation: ${method}`)
  if (heldMutationReceipt) { const held = heldMutationReceipt; heldMutationReceipt = null; mutationReceiptWaiting = true; await held; mutationReceiptWaiting = false }
  return { status: 'applied', code: 'ok', payload: { memoryId } }
}, onEvent(listener: (event: any) => void) { capabilityListeners.add(listener); return () => { capabilityListeners.delete(listener) } } } as ThreadClient
const noop = () => {}
const asyncNoop = async () => {}

function Fixture() {
  const [platform, setPlatform] = useState<'darwin' | 'win32'>('darwin')
  const mobile = useMobileViewport(platform !== 'win32')
  const platformClient = useMemo(() => ({ ...client, platform }), [platform])
  const [target, setTarget] = useState<MemoryNavigationTarget>({ kind: 'memory', memoryId: null })
  const [pending, setPending] = useState(1)
  const [notice, setNotice] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [theme, setTheme] = useState('day')
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { document.documentElement.dataset.rovaiPlatform = platform; document.documentElement.dataset.platform = platform }, [platform])
  useEffect(() => { (window as any).__memoryFixture = {
    setMemoryEnabled, refreshCapability: invalidateCapability,
    failCapabilitySave: () => { capabilitySaveFailures++ },
    holdCapabilitySave: () => { heldCapabilitySave = new Promise(resolve => { releaseCapabilitySave = resolve }) },
    releaseCapabilitySave: () => { releaseCapabilitySave?.(); releaseCapabilitySave = null },
    holdMutationReceipt: () => { heldMutationReceipt = new Promise(resolve => { releaseMutationReceipt = resolve }) },
    releaseMutationReceipt: () => { releaseMutationReceipt?.(); releaseMutationReceipt = null },
    failCapabilityRead: () => { capabilityReadFailures++; invalidateCapability() },
    holdCapabilityRead: () => { heldCapabilityRead = new Promise(resolve => { releaseCapabilityRead = resolve }); invalidateCapability() },
    releaseCapabilityRead: () => { releaseCapabilityRead?.(); releaseCapabilityRead = null },
    holdMemoryRead: () => { heldMemoryRead = new Promise(resolve => { releaseMemoryRead = resolve }); setRefresh(n => n + 1) },
    releaseMemoryRead: () => { releaseMemoryRead?.(); releaseMemoryRead = null },
    capabilityStats: () => ({ memoryBusinessReads, capabilitySaves, capabilityReadWaiting, memoryReadWaiting, mutationReceiptWaiting, enabled: memoryCapability.enabled }),
    navigate: setTarget, setTheme, setNotice, setPlatform, setLanguage: (language: 'en' | 'zh-CN') => changeInterfaceLanguage(languageTestApi, language),
    failNext: () => { failNext = true },
    failReads: () => { failedReads++ },
    failReviewRefresh: () => { failAfterReview = true },
    holdReview: () => { heldReview = new Promise<void>(resolve => { releaseReview = resolve }) },
    releaseReview: () => { releaseReview?.(); heldReview = null; releaseReview = null },
    conflictReview: (id: string) => { reviews.find(item => item.reviewItemId === id)!.version++ },
    invalidateReview: (id: string) => { const item = reviews.find(item => item.reviewItemId === id)!; item.status = 'invalidated'; item.invalidationReason = 'target_forgotten'; item.version++; clearCandidate(item); setRefresh(n => n + 1) },
    seedReviews: () => {
      const source = reviews[0]
      const target = memories.find(m => m.id === 'shared-2')!
      reviews = [
        { ...source, reviewItemId: 'review-2', status: 'pending', version: 1, candidateKind: 'agreement', candidateBody: '新增候选正文。', candidateRetrievalKeys: ['新增候选'], acceptedMemoryId: null, acceptedRevisionId: null, resolvedAt: null },
        { ...source, reviewItemId: 'review-3', status: 'pending', version: 1, requestedAction: 'revise', candidateKind: 'agreement', candidateBody: '修订候选正文。', candidateRetrievalKeys: ['修订候选'], targetMemoryId: target.id, baseRevisionId: target.currentRevisionId, acceptedMemoryId: null, acceptedRevisionId: null, resolvedAt: null },
        { ...source, reviewItemId: 'review-4', status: 'pending', version: 1, requestedAction: 'revise', stale: true, candidateKind: 'agreement', candidateBody: '已过时的候选正文。', candidateRetrievalKeys: ['过时候选'], targetMemoryId: target.id, baseRevisionId: 'old-revision', acceptedMemoryId: null, acceptedRevisionId: null, resolvedAt: null }
      ] as HearthReviewItem[]
      setRefresh(n => n + 1)
    },
    conflict: () => { const m = memories.find(m => m.id === target.memoryId)!; m.version++; m.currentRevisionId = `${m.id}-external`; m.currentBody = '来自另一操作的最新正文。' },
    stale: () => { reviews[0].stale = true; setRefresh(n => n + 1) },
    get: () => ({ target, memories, reviews, calls, longBody })
  } }, [target])
  const changes = collectMemoryChanges([], [{ eventType: 'memory.agent_revised', globalSequence: 1, entityType: 'memory', entityId: 'member-1', actorType: 'agent', actorId: 'member-a', payload: { scope: 'companion' } } as any])
  return <ThreadClientProvider client={platformClient}><MobileLayoutProvider value={mobile}>{platform === 'win32' && <WindowsApplicationMenu />}<NavigationShell platform={platform} browser={mobile}>
    {!mobile && <ThreadNavigation view="memory" state="ready" navigation={null} activeThreadId={null} pendingMemoryCount={pending} onNewConversation={noop} onMembers={noop} onMemory={noop} onSettings={noop} onOpenProject={noop} onThread={noop} onRemoveProject={asyncNoop} onRename={asyncNoop} onDelete={asyncNoop} onError={noop} />}
    {!mobile && <WindowDragStrip page="memory" />}
    <main className="content memory-content"><MemoryLibrary agents={agents} navigationTarget={target} onNavigate={setTarget} onPendingCountChange={setPending} refreshSignal={refresh} topNotices={notice && <MemoryChangeNotice onClose={() => setNotice(false)} onOpen={() => { setTarget({ kind: 'memory', memoryId: 'member-1' }); setNotice(false) }}>{memoryChangeText(changes, '林')}</MemoryChangeNotice>} /></main>
  </NavigationShell></MobileLayoutProvider></ThreadClientProvider>
}
document.documentElement.dataset.platform = 'darwin'
document.documentElement.dataset.rovaiPlatform = 'darwin'
document.documentElement.dataset.rovaiSurface = 'desktop'
createRoot(document.getElementById('root')!).render(<Fixture />)
