import { createConfiguredCampAndSend } from './create-configured-camp.mjs'
import { executeSqlite, querySqliteRows } from './sqlite.mjs'

// Opt-in real Runtime extension of the existing isolated packaged shutdown owner.
export async function acceptExecutionText({ request, workspace, databasePath, waitFor, frames }) {
  executeSqlite(databasePath, `
    CREATE TABLE execution_text_accept_writes(run_id TEXT, operation TEXT, event_type TEXT);
    CREATE TRIGGER execution_text_accept_insert AFTER INSERT ON agent_run_execution_evidence
      BEGIN INSERT INTO execution_text_accept_writes VALUES(NEW.agent_run_id,'insert',NEW.event_type); END;
    CREATE TRIGGER execution_text_accept_update AFTER UPDATE ON agent_run_execution_evidence
      BEGIN INSERT INTO execution_text_accept_writes VALUES(NEW.agent_run_id,'update',NEW.event_type); END;
  `)
  const sent = await createConfiguredCampAndSend(request, {
    commandId: crypto.randomUUID(), name: 'Text block write-volume acceptance', workspace,
    memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1',
    body: [
      'Run this small local acceptance in exactly this order:',
      'All three commentary markers A, B and C are mandatory. Your first commentary must start with ROVAI_BODY_A; do not skip it or combine it with a tool call.',
      '1. Emit a commentary paragraph beginning ROVAI_BODY_A about checking the fixture.',
      '2. Use one local shell/read tool to read README.md.',
      '3. Emit a separate commentary paragraph beginning ROVAI_BODY_B describing the result.',
      '4. Use another local shell/read tool to count the bytes in README.md.',
      '5. Emit a separate commentary paragraph beginning ROVAI_BODY_C explaining completion.',
      'Each commentary paragraph should be about 150 words, and must be actual narration, not a tool argument.',
      'Do not alter files, use the network, delegate, or contact other Camps/members.',
      'Then send the short final public answer "Local text-block acceptance finished" to this Camp using the normal Rovai publication route.'
    ].join(' '), purpose: 'Verify every narration block, tool ordering and fresh-run SQLite write volume.'
  })
  const campId = sent.payload?.campId
  const runId = sent.payload?.agentRunIds?.[0]
  if (!campId || !runId) throw new Error('Text acceptance Run not admitted')
  let observedStreamingCharacters = 0
  const final = await waitFor(async () => {
    const snapshot = await request('camps.snapshot', { campId })
    for (const item of snapshot.executionEvidence) {
      if (item.agentRunId === runId && item.eventType === 'agent.text.block'
        && item.payload.status === 'streaming') {
        observedStreamingCharacters = Math.max(observedStreamingCharacters, item.payload.text?.length ?? 0)
      }
    }
    const run = snapshot.agentRuns.find((item) => item.id === runId)
    return ['succeeded', 'failed', 'cancelled'].includes(run?.status) ? snapshot : null
  }, 'real multi-block Runtime completion', 240_000, 120)
  const run = final.agentRuns.find((item) => item.id === runId)
  if (run.status !== 'succeeded') throw new Error(`Text acceptance did not succeed: ${run.status} ${run.lastErrorCode ?? ''}`)
  const evidence = []
  let afterSequence = 0
  for (;;) {
    const page = await request('agentRunEvidence.list', { campId, agentRunId: runId, afterSequence, limit: 200 })
    evidence.push(...page.evidence)
    if (!page.hasMore) break
    afterSequence = page.nextAfterSequence
  }
  const bodies = []
  for (const item of evidence.filter((item) => item.eventType === 'agent.text.block')) {
    const payload = item.isTruncated
      ? (await request('agentRunEvidence.getContent', { campId, evidenceId: item.id })).payload
      : item.payload
    bodies.push({ ...item, payload })
  }
  const markers = ['ROVAI_BODY_A', 'ROVAI_BODY_B', 'ROVAI_BODY_C'].map((marker) => {
    // A paragraph may refer to another step's marker; its own identity is the prefix.
    const found = bodies.filter((item) => item.payload.text?.trimStart().startsWith(marker))
    if (found.length !== 1) throw new Error(`Expected exactly one full block for ${marker}, found ${found.length}`)
    return found[0]
  })
  if (new Set(markers.map((item) => item.id)).size !== 3) throw new Error('Independent narration blocks were mixed')
  for (let i = 0; i < 2; i++) {
    if (!evidence.some((item) => ['activity.started', 'activity.completed', 'runtime.action'].includes(item.eventType)
      && item.sequence > markers[i].sequence && item.sequence < markers[i + 1].sequence)) {
      throw new Error('Narration/tool timeline order was not preserved')
    }
  }
  if (evidence.some((item) => ['agent.text.delta', 'agent.thought.delta', 'agent.reasoning.summary.delta'].includes(item.eventType))) {
    throw new Error('Fresh execution still persisted text deltas')
  }
  const writeCounts = querySqliteRows(databasePath, `
    SELECT operation,event_type,count(*) AS count FROM execution_text_accept_writes
    WHERE run_id='${runId.replaceAll("'", "''")}' GROUP BY operation,event_type
  `)
  return { runId, campId, status: run.status, evidenceRows: evidence.length,
    narrationBlocks: bodies.length, markerSequences: markers.map((item) => item.sequence),
    observedStreamingCharacters, liveFrames: await frames(runId), writeCounts }
}
