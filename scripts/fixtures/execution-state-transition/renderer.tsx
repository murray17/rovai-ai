import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AdapterInstallation, ThreadOpenProjection, ThreadSnapshot, ExecutionConsolePlacement } from '@contracts'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/AppHeader'
import { ThreadWorkspace, type ThreadInspectorTab } from '../../../apps/desktop/src/renderer/src/ThreadWorkspace'
import { ThreadClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { MobileLayoutProvider, useMobileViewport } from '../../../apps/desktop/src/renderer/src/MobileLayout'
import { createReviewModel } from '../host-web-parity/model'
import { agents, initial, initialDraft, installations, now, run } from '../host-web-parity/data'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/web/src/mobile.css'

type Phase = 'connecting' | 'thinking' | 'body' | 'tools'
declare global {
  interface Window {
    executionTransition: { setPhase(phase: Phase): void; resolveWindow(): void; windowReady(): boolean }
  }
}
const params = new URL(location.href).searchParams
const mode = params.get('mode') ?? 'bottom'
const windowed = params.get('windowed') === '1'
document.documentElement.dataset.theme = params.get('theme') ?? 'day'
const model = createReviewModel('web', 'running')
let executionWindowReady = false
let resolveExecutionWindow: (() => void) | null = null
const fixtureClient = {
  ...model.client,
  request: (async (method: string, input?: unknown): Promise<unknown> => {
    const request = (input ?? {}) as { beforeSequence?: number | null; afterSequence?: number; limit?: number }
    if (method === 'agentRunExecution.page') {
      await new Promise<void>(resolve => { resolveExecutionWindow = resolve })
      resolveExecutionWindow = null
      executionWindowReady = true
      return {
        schemaVersion: 1,
        threadId: initial.thread.id,
        agentRunId: run.id,
        requestedBeforeSequence: request.beforeSequence ?? null,
        nextBeforeSequence: null,
        throughSequence: 0,
        hasMore: false,
        evidence: []
      }
    }
    if (method === 'agentRunExecution.changes') {
      return {
        schemaVersion: 1,
        threadId: initial.thread.id,
        agentRunId: run.id,
        requestedAfterSequence: request.afterSequence ?? 0,
        nextAfterSequence: request.afterSequence ?? 0,
        throughSequence: 0,
        hasMore: false,
        evidence: [],
        refreshedEvidence: []
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
  useEffect(() => {
    window.executionTransition = {
      setPhase,
      resolveWindow: () => resolveExecutionWindow?.(),
      windowReady: () => executionWindowReady
    }
  }, [])
  const snapshot = useMemo<ThreadSnapshot>(() => ({
    ...initial,
    agentRuns: [{
      ...run, status: 'running',
      startedAt: now,
      executionEvidenceCount: phase === 'body' ? 1 : phase === 'tools' ? 3 : 0
    }],
    executionEvidence: phase === 'body' ? [{
      ...model.get().snapshot.executionEvidence[0],
      payload: { itemId: 'first-narration', delta: '开始检查。' }
    }] : phase === 'tools' ? model.get().snapshot.executionEvidence : []
  }), [phase])
  return <MobileLayoutProvider value={mobile}><ThreadClientProvider client={windowed ? fixtureClient : model.client}>
    <div className="app-shell app-shell-camp" data-mobile-view={mobile ? 'camp' : undefined}>
      <aside className="unified-sidebar" aria-label="Fixture sidebar" />
      <AppHeader threadTitle={snapshot.thread.title} contextLabel="Fixture" thread={snapshot} detailEntryHostRef={setEntry} onFocusApprovals={() => {}} />
      <main className="content task-content camp-content">
        <ThreadWorkspace snapshot={snapshot} projectName="Fixture" agents={agents} installations={installations as AdapterInstallation[]}
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
