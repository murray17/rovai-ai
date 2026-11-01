import { createRoot } from 'react-dom/client'
import { ToolActivityGroup } from '../../../apps/desktop/src/renderer/src/ExecutionToolGroup'
import { buildLiveExecutionProgress, selectCompleteExecutionEvidence } from '../../../apps/desktop/src/shared/execution-presentation'
import type { AgentRunExecutionEvidenceView, CanonicalRuntimeActivityView } from '@contracts'
import '../../../apps/desktop/src/renderer/src/styles.css'

const command = `rovai memory write --body '正文首行\n  ${'正文与空格 '.repeat(700)}END_OF_BODY'`
const output = JSON.stringify({ password: 'TEST_PASSWORD', result: Array.from({ length: 8_100 }, (_, i) => `line-${i}`) }, null, 2)
const expected = `$ ${command}\n${output}`
const canonical = (id: string, shell: boolean): CanonicalRuntimeActivityView => ({
  operationId: id, classifierVersion: 'activity-v4', activityDomain: shell ? 'shell' : 'tool',
  semanticKind: shell ? 'shell.execute' : 'tool.call', toolName: shell ? 'commandExecution' : 'memory.write',
  presentationHint: shell ? '运行命令' : 'memory.write', phase: 'terminal', outcome: 'succeeded',
  sourceAuthority: shell ? 'runtime' : 'core', credibility: shell ? 'runtime_structured' : 'core_verified',
  coverageLevel: 'fine_grained', sourceEvidenceIds: [], firstEvidenceSequence: shell ? 1 : 2,
  lastEvidenceSequence: shell ? 1 : 2, revision: 1
})
const evidence: AgentRunExecutionEvidenceView[] = [true, false].map(shell => ({
  id: shell ? 'shell-evidence' : 'core-evidence', agentRunId: 'fixture-run', sequence: shell ? 1 : 2,
  executionEpoch: 1, kind: shell ? 'command' : 'tool_result', phase: 'completed',
  eventType: shell ? 'activity.completed' : 'runtime.action', canonical: canonical(shell ? 'shell-1' : 'core-1', shell),
  payload: shell ? { item: { type: 'commandExecution', command, status: 'completed' }, executionWindowBuiltinOperation: 'memory.write' }
    : { status: 'completed', sourceAuthority: 'core', canonicalTool: 'memory.write', operationProjection: { operation: 'memory.write', canonicalInput: {} } },
  contentBlobId: null, contentByteCount: expected.length, isTruncated: true, occurredAt: '2026-09-12T00:00:00Z'
}))
const progress = buildLiveExecutionProgress(evidence.map(item => ({ ...item, createdAt: item.occurredAt })), 'fixture-run', { includePublicResults: false })
const items = progress.items.filter(item => item.kind === 'tool')
const reads: string[] = []
let fail = true
let agentRevision = 0
let showAgent = false
const pendingAgentReads = new Map<number, () => void>()
const agentInput = JSON.stringify({ description: '读取文件并返回报告', prompt: 'Read fixture.txt', run_in_background: false }, null, 2)
const agentOutput = (revision: number): string => Array.from({ length: 80 }, (_, i) => `report line ${i}`).join('\n') + `\nREPORT_REVISION_${revision}`
function agentEvidence(): AgentRunExecutionEvidenceView {
  return { ...evidence[0], id: 'agent-evidence', eventType: 'runtime.action', kind: 'tool_result',
    revision: agentRevision, changeSequence: agentRevision, canonical: {
      ...canonical('agent-call', false), classifierVersion: 'activity-v5', sourceAuthority: 'runtime',
      credibility: 'runtime_structured', semanticKind: 'tool.agent', toolName: 'Agent', presentationHint: 'Agent', revision: agentRevision
    }, payload: { toolName: 'Agent', kind: 'other', status: 'completed', input: agentInput,
      ...(agentRevision === 0 ? { output: agentOutput(0) } : {}) } }
}
window.rovai = {
  request: async (method: string, params: { evidenceId: string }) => {
    if (method === 'agentRunEvidence.getContent' && params.evidenceId === 'agent-evidence') {
      const revision = agentRevision
      reads.push(`${params.evidenceId}:${revision}`)
      if (revision === 1 || revision === 2) await new Promise<void>(resolve => pendingAgentReads.set(revision, resolve))
      return { payload: { ...agentEvidence().payload as object, output: agentOutput(revision) } }
    }
    if (method !== 'agentRunEvidence.getContent' || params.evidenceId !== 'shell-evidence') throw new Error('Wrong evidence source')
    reads.push(params.evidenceId)
    if (fail) { fail = false; throw new Error('fixture read failure') }
    return { payload: { item: { type: 'commandExecution', command, aggregatedOutput: output } } }
  }
} as unknown as typeof window.rovai
const root = createRoot(document.getElementById('root')!)
function render(theme = 'day'): void {
  document.documentElement.dataset.theme = theme
  const displayedEvidence = showAgent ? [agentEvidence()] : evidence
  const displayedItems = showAgent
    ? buildLiveExecutionProgress(displayedEvidence.map(item => ({ ...item, createdAt: item.occurredAt })), 'fixture-run', { includePublicResults: false }).items.filter(item => item.kind === 'tool')
    : items
  root.render(<main style={{ padding: 24, maxWidth: 760, margin: 'auto' }}>
    <p>模拟数据 · Command View 隔离验收</p>
    <ToolActivityGroup key={showAgent ? 'agent' : 'shell'} threadId="fixture-camp" runId="fixture-run" runStatus="succeeded"
      liveTail={false} cancelling={false} items={displayedItems}
      completeEvidence={selectCompleteExecutionEvidence(showAgent && agentRevision === 0 ? [] : displayedEvidence)}
      onFileOpenError={message => { throw new Error(message) }} />
  </main>)
}
Object.assign(window, { commandViewFixture: { expected, reads, render,
  showAgent: () => { showAgent = true; render() },
  updateAgent: (revision: number) => { agentRevision = revision; render() },
  pendingAgentReads,
  agentExpected: (revision: number) => `${agentInput}\n${agentOutput(revision)}`
} })
render()
