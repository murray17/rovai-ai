import assert from 'node:assert/strict'
import test from 'node:test'
import { digestJson } from './qualification-common.mjs'
import {
  buildWorkspaceMutationLedger,
  validateWorkspaceMutationLedger
} from './qualification-workspace-mutation-ledger.mjs'

test('Workspace Mutation Ledger records only proven net changes without inventing writers', () => {
  const evidenceIndex = indexFixture(['created.txt', 'deleted.txt', 'metadata.txt', 'modified.txt'])
  const artifact = buildWorkspaceMutationLedger({
    ...identityFixture(),
    workspaceDiff: workspaceDiffFixture(),
    observedAt: '2026-08-04T01:00:00.000Z',
    evidenceIndex,
    evidenceReferences: referenceFixture(evidenceIndex)
  })

  assert.equal(artifact.payloadDigest, `sha256:${digestJson(artifact.payload)}`)
  assert.deepEqual(artifact.payload.records.map((record) => record.operation), [
    'create',
    'delete',
    'metadata',
    'modify'
  ])
  assert.equal(artifact.payload.records.every((record) => (
    record.writerAttribution.state === 'indeterminate'
    && record.writerAttribution.agentRunId === null
    && record.toolCallIds.length === 0
  )), true)
  assert.equal(artifact.payload.records[0].beforeDigest, null)
  assert.equal(artifact.payload.records[1].afterDigest, null)
  assert.deepEqual(artifact.payload.records[3].verificationRelations, [{
    kind: 'diff',
    state: 'verified',
    evidenceReference: ref(evidenceIndex.artifactId, workspaceEvidenceId('modified.txt'))
  }])
  assert.deepEqual(artifact.payload.coverage, {
    state: 'partial',
    reason: { code: 'workspace_mutation_ledger.net_diff_only' }
  })
  assert.deepEqual(artifact.payload.overlapFacts, [])
})

test('Workspace Mutation Ledger omits changes with unresolved evidence and reports partial coverage', () => {
  const evidenceIndex = indexFixture(['created.txt'])
  const references = referenceFixture(evidenceIndex)
  delete references.workspaceChanges['created.txt']
  const artifact = buildWorkspaceMutationLedger({
    ...identityFixture(),
    workspaceDiff: { schemaVersion: 1, digest: 'x', changed: [workspaceDiffFixture().changed[0]] },
    observedAt: '2026-08-04T01:00:00.000Z',
    evidenceIndex,
    evidenceReferences: references
  })

  assert.equal(artifact.payload.records.length, 0)
  assert.deepEqual(artifact.payload.coverage, {
    state: 'partial',
    reason: { code: 'workspace_mutation_ledger.evidence_reference_coverage_incomplete' }
  })
})

test('Workspace Mutation Ledger rejects unresolved evidence, invented writers, overlap inflation, and unknown tools', () => {
  const evidenceIndex = indexFixture(['created.txt', 'deleted.txt', 'metadata.txt', 'modified.txt'])
  const artifact = buildWorkspaceMutationLedger({
    ...identityFixture(),
    workspaceDiff: workspaceDiffFixture(),
    observedAt: '2026-08-04T01:00:00.000Z',
    evidenceIndex,
    evidenceReferences: referenceFixture(evidenceIndex)
  })

  const unresolved = structuredClone(artifact)
  unresolved.payload.records[0].evidenceReferences[0].evidenceId = 'missing'
  redigest(unresolved)
  assert.throws(
    () => validateWorkspaceMutationLedger(unresolved, evidenceIndex),
    /unresolved Evidence Reference/
  )

  const inventedWriter = structuredClone(artifact)
  inventedWriter.payload.records[0].writerAttribution.agentRunId = 'run-1'
  redigest(inventedWriter)
  assert.throws(
    () => validateWorkspaceMutationLedger(inventedWriter, evidenceIndex),
    /invented writer attribution/
  )

  const inflatedOverlap = structuredClone(artifact)
  inflatedOverlap.payload.overlapFacts.push({
    overlapFactId: 'overlap:one',
    kind: 'overlap',
    mutationIds: inflatedOverlap.payload.records.slice(0, 2).map((record) => record.mutationId),
    coverage: { state: 'complete', reason: null },
    evidenceReferences: inflatedOverlap.payload.records[0].evidenceReferences
  })
  redigest(inflatedOverlap)
  assert.throws(
    () => validateWorkspaceMutationLedger(inflatedOverlap, evidenceIndex),
    /overlap without complete writer coverage/
  )

  const unknownTool = structuredClone(artifact)
  unknownTool.payload.records[0].toolCallIds = ['tool-call:missing']
  redigest(unknownTool)
  assert.throws(
    () => validateWorkspaceMutationLedger(unknownTool, evidenceIndex),
    /unknown Tool Call/
  )
})

function identityFixture() {
  return {
    trialId: 'trial-1',
    evaluationAttemptId: 'attempt-1',
    plannedSlotId: 'slot-1',
    suiteId: 'suite-1',
    caseId: 'CASE-1',
    caseSeal: 'a'.repeat(64),
    producerDigest: 'b'.repeat(64)
  }
}

function workspaceDiffFixture() {
  const sameDigest = 'c'.repeat(64)
  return {
    schemaVersion: 1,
    digest: 'fixture',
    changed: [
      change('created.txt', null, entry('created.txt', 'd'.repeat(64))),
      change('deleted.txt', entry('deleted.txt', 'e'.repeat(64)), null),
      change('metadata.txt', entry('metadata.txt', sameDigest, 0o644), entry('metadata.txt', sameDigest, 0o600)),
      change('modified.txt', entry('modified.txt', 'f'.repeat(64)), entry('modified.txt', '1'.repeat(64)))
    ]
  }
}

function change(path, before, after) {
  return { path, before, after }
}

function entry(path, digest, mode = 0o644) {
  return { path, type: 'file', mode, bytes: 10, digest }
}

function indexFixture(paths) {
  return {
    artifactId: 'evidence-index:index-1',
    sourceBoundaries: [{
      authorityClass: 'runner',
      sourceId: 'runner.workspace',
      digest: `sha256:${'2'.repeat(64)}`,
      throughSequence: null,
      declaredTotal: null,
      clockDomain: null,
      coverage: { state: 'complete', reason: null }
    }],
    payload: {
      records: paths.map((path) => ({
        evidenceId: workspaceEvidenceId(path),
        sourceId: 'runner.workspace'
      }))
    }
  }
}

function referenceFixture(evidenceIndex) {
  return {
    workspaceChanges: Object.fromEntries(evidenceIndex.payload.records.map((record) => [
      pathForEvidenceId(record.evidenceId),
      ref(evidenceIndex.artifactId, record.evidenceId)
    ]))
  }
}

function workspaceEvidenceId(path) {
  const ids = {
    'created.txt': 'runner.workspace-change:created',
    'deleted.txt': 'runner.workspace-change:deleted',
    'metadata.txt': 'runner.workspace-change:metadata',
    'modified.txt': 'runner.workspace-change:modified'
  }
  return ids[path]
}

function pathForEvidenceId(evidenceId) {
  return `${evidenceId.split(':').at(-1)}.txt`
}

function ref(artifactId, evidenceId) {
  return { artifactId, evidenceId }
}

function redigest(artifact) {
  artifact.payloadDigest = `sha256:${digestJson(artifact.payload)}`
}
