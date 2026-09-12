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
  lastEvidenceSequence: shell ? 4 : 3, revision: 1
})
const evidence: AgentRunExecutionEvidenceView[] = [false, true].map(shell => ({
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
window.rovai = {
  request: async (method: string, params: { evidenceId: string }) => {
    if (method !== 'agentRunEvidence.getContent' || params.evidenceId !== 'shell-evidence') throw new Error('Wrong evidence source')
    reads.push(params.evidenceId)
    if (fail) { fail = false; throw new Error('fixture read failure') }
    return { payload: { item: { type: 'commandExecution', command, aggregatedOutput: output } } }
  }
} as unknown as typeof window.rovai
const root = createRoot(document.getElementById('root')!)
function render(theme = 'day', partial = false): void {
  document.documentElement.dataset.theme = theme
  root.render(<main style={{ padding: 24, maxWidth: 760, margin: 'auto' }}>
    <p>模拟数据 · Command View 隔离验收</p>
    <ToolActivityGroup campId="fixture-camp" runId="fixture-run" runStatus="succeeded" partial={partial}
      liveTail={false} cancelling={false} items={items} completeEvidence={selectCompleteExecutionEvidence(evidence)}
      onFileOpenError={message => { throw new Error(message) }} />
  </main>)
}
Object.assign(window, { commandViewFixture: { expected, reads, render } })
render()
