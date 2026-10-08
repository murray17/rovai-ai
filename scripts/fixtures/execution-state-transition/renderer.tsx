import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AdapterInstallation, CoreEvent, ThreadOpenProjection, ThreadSnapshot, ExecutionConsolePlacement } from '@contracts'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/AppHeader'
import { ThreadWorkspace, type ThreadInspectorTab } from '../../../apps/desktop/src/renderer/src/ThreadWorkspace'
import { ThreadClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { MobileLayoutProvider, useMobileViewport } from '../../../apps/desktop/src/renderer/src/MobileLayout'
import { createReviewModel } from '../host-web-parity/model'
import { agents, initial, initialDraft, installations, now, run } from '../host-web-parity/data'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/web/src/mobile.css'

type Phase = 'connecting' | 'thinking' | 'body' | 'tools' | 'body-thinking' | 'tools-thinking'
declare global {
  interface Window {
    executionTransition: {
      setPhase(phase: Phase): void; resolveWindow(latestOnly?: boolean): void; windowReady(): boolean
      setRuntimeSnapshot(title?: string | null): void
      emitRuntimePhase(title: string | null, epoch?: number): void
      invalidateRuntimePhase(): void
      hasEventTransport(): boolean
      windowReadRequested(): boolean
      runInputs(): unknown
    }
  }
}
const params = new URL(location.href).searchParams
const mode = params.get('mode') ?? 'bottom'
const windowed = params.get('windowed') === '1'
document.documentElement.dataset.theme = params.get('theme') ?? 'day'
const model = createReviewModel('web', 'running')
let executionWindowReady = false
let executionWindowRequested = false
const resolveExecutionWindows: Array<() => void> = []
const phaseListeners = new Set<(event: CoreEvent) => void>()
const invalidationListeners = new Set<() => void>()
let runtimeSnapshot: { runtimePhase?: 'thinking' | 'executing'; runtimeThinkingTitle?: string | null } =
  windowed ? { runtimePhase: 'thinking', runtimeThinkingTitle: null } : {}
const fixtureClient = {
  ...model.client,
  onEvent: params.get('transport') === 'invalidation' ? undefined
    : (listener: (event: CoreEvent) => void) => { phaseListeners.add(listener); return () => { phaseListeners.delete(listener) } },
  onInvalidated: (listener: () => void) => { invalidationListeners.add(listener); return () => { invalidationListeners.delete(listener) } },
  request: (async (method: string, input?: unknown): Promise<unknown> => {
    const request = (input ?? {}) as { beforeSequence?: number | null; afterSequence?: number; limit?: number }
    if (method === 'agentRunExecution.page') {
      if (request.limit !== 1) executionWindowRequested = true
      const phaseAtRequest = { ...runtimeSnapshot }
      await new Promise<void>(resolve => { resolveExecutionWindows.push(resolve) })
      executionWindowReady = true
      return {
        ...phaseAtRequest,
        schemaVersion: 3,
        threadId: initial.thread.id,
        agentRunId: run.id,
        requestedBeforeSequence: request.beforeSequence ?? null,
        nextBeforeSequence: null,
        throughSequence: 0,
        throughChangeSequence: 0,
        hasMore: false,
        blocks: []
      }
    }
    if (method === 'agentRunExecution.changes') {
      return {
        ...runtimeSnapshot,
        schemaVersion: 3,
        threadId: initial.thread.id,
        agentRunId: run.id,
        requestedAfterChangeSequence: 0,
        nextAfterChangeSequence: 0,
        throughSequence: 0,
        throughChangeSequence: 0,
        hasMore: false,
        blocks: [],
        refreshedBlocks: []
      }
    }
    return model.client.request(method as never, input as never)
  }) as typeof model.client.request
}
const completeCoverage = { loadedCount: 0, totalCount: 0, omittedCount: 0, complete: true }
const openCoverage = {
  tasks: completeCoverage,
  messages: {
    ...completeCoverage,
    hasEarlier: false,
    oldestLoadedSequence: null,
    newestLoadedSequence: null
  },
  messageDeliveries: completeCoverage,
  turns: completeCoverage,
  agentRuns: completeCoverage,
  executionEvidence: completeCoverage,
  approvals: completeCoverage
} satisfies ThreadOpenProjection['coverage']

function Fixture() {
  const mobile = useMobileViewport(mode === 'mobile')
  const [phase, setPhase] = useState<Phase>('connecting')
  const [placement, setPlacement] = useState<ExecutionConsolePlacement>(mode === 'bottom' ? 'bottom' : 'inspector')
  const [inspector, setInspector] = useState<ThreadInspectorTab | null>(null)
  const [entry, setEntry] = useState<HTMLElement | null>(null)
  const snapshot = useMemo<ThreadSnapshot>(() => ({
    ...initial,
    agentRuns: [{
      ...run, status: 'running',
      startedAt: now,
      executionEvidenceChangeSequence: 0,
      executionEvidenceCount: phase.startsWith('body') ? 1 : phase.startsWith('tools') ? 3 : 0
    }],
    executionEvidence: phase.startsWith('body') ? [{
      ...model.get().snapshot.executionEvidence[0],
      payload: { itemId: 'first-narration', delta: '开始检查。' }
    }] : phase.startsWith('tools') ? model.get().snapshot.executionEvidence : []
  }), [phase])
  useEffect(() => {
    window.executionTransition = {
      setPhase,
      resolveWindow: latestOnly => latestOnly ? resolveExecutionWindows.pop()?.()
        : resolveExecutionWindows.splice(0).forEach(resolve => resolve()),
      windowReady: () => executionWindowReady,
      setRuntimeSnapshot: title => { runtimeSnapshot = title === undefined ? {}
        : { runtimePhase: title !== null ? 'thinking' : 'executing', runtimeThinkingTitle: title || null } },
      emitRuntimePhase: (title, epoch = run.executionEpoch) => phaseListeners.forEach(listener => listener({
        method: 'agent_run.runtime_phase_changed', params: {
          agentRunId: run.id, executionEpoch: epoch, phase: title ? 'thinking' : 'executing', thinkingTitle: title
        }
      })),
      invalidateRuntimePhase: () => invalidationListeners.forEach(listener => listener()),
      hasEventTransport: () => typeof fixtureClient.onEvent === 'function',
      windowReadRequested: () => executionWindowRequested,
      runInputs: () => ({ updatedAt: snapshot.agentRuns[0].updatedAt,
        executionEpoch: snapshot.agentRuns[0].executionEpoch,
        evidenceSequence: snapshot.agentRuns[0].executionEvidenceChangeSequence,
        evidenceCount: snapshot.agentRuns[0].executionEvidenceCount })
    }
  }, [snapshot])
  return <MobileLayoutProvider value={mobile}><ThreadClientProvider client={windowed ? fixtureClient : model.client}>
    <div className="app-shell app-shell-camp" data-mobile-view={mobile ? 'camp' : undefined}>
      <aside className="unified-sidebar" aria-label="Fixture sidebar" />
      <AppHeader threadTitle={snapshot.thread.title} contextLabel="Fixture" thread={snapshot} detailEntryHostRef={setEntry} onFocusApprovals={() => {}} />
      <main className="content task-content camp-content">
        <ThreadWorkspace snapshot={snapshot} projectName="Fixture" agents={agents} installations={installations as AdapterInstallation[]}
          liveRuntimeEvents={phase.includes('thinking') ? [{
            id: 'current-thinking', agentRunId: run.id, executionEpoch: run.executionEpoch,
            eventType: 'agent_run.runtime_phase_changed', createdAt: now,
            payload: { phase: 'thinking', thinkingTitle: phase.includes('-') ? '检查调用链与状态同步' : null }
          }] : []}
          openCoverage={windowed ? openCoverage : null}
          initialComposerDraft={initialDraft} busy={false} onSend={model.send} onChangeLead={async () => {}}
          onTasksChanged={async () => {}} onResolveApproval={() => {}} stopping={false} onStop={() => {}}
          onCancelAgentRun={async () => {}} executionPlacement={placement}
          onExecutionPlacementChange={async next => { setPlacement(next); return next }}
          worldMapEnabled={false} inspectorVisible={inspector !== null} inspectorTab={inspector ?? 'members'}
          detailEntryHost={entry} onOpenInspector={setInspector} onCloseInspector={() => setInspector(null)}
          onInspectorTabChange={setInspector} onOpenSingleChat={() => {}} onConfigureRuntime={() => {}}
          onNotify={() => {}} onNotifyError={message => { throw Error(message) }} />
      </main>
    </div>
  </ThreadClientProvider></MobileLayoutProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
