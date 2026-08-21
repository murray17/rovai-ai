import { isAbsolute, join, posix } from 'node:path'
import {
  QUALIFICATION_RUNNER_VERSION,
  artifactFileName,
  atomicWriteJson,
  digestJson,
  sha256,
  writePrivateJsonExclusive
} from './qualification-common.mjs'
import { validateQualificationArtifactSchema } from './qualification-schema-validation.mjs'

export const WORKSPACE_MUTATION_LEDGER_SCHEMA_ID = 'rovai.qualification.workspace-mutation-ledger'
export const WORKSPACE_MUTATION_LEDGER_SCHEMA_VERSION = '1.0.0'

export function buildWorkspaceMutationLedger({
  trialId,
  evaluationAttemptId = null,
  plannedSlotId,
  suiteId = null,
  caseId,
  caseSeal,
  producerDigest,
  workspaceDiff,
  observedAt,
  evidenceIndex,
  evidenceReferences,
  toolCallLedger = null
}) {
  const artifactId = `workspace-mutation-ledger:${sha256(
    `${trialId}:${evaluationAttemptId ?? 'capture'}`
  ).slice(0, 32)}`
  if (!validTimestamp(observedAt)) throw new Error('Workspace Mutation Ledger observedAt is invalid')
  const evidenceIds = new Set(evidenceIndex.payload.records.map((record) => record.evidenceId))
  let incompleteRecords = 0
  const records = []
  for (const change of workspaceDiff?.changed ?? []) {
    const reference = evidenceReferences?.workspaceChanges?.[change.path] ?? null
    const contentReference = evidenceReferences?.workspaceContents?.[change.path] ?? null
    if (!reference
        || reference.artifactId !== evidenceIndex.artifactId
        || !evidenceIds.has(reference.evidenceId)) {
      incompleteRecords += 1
      continue
    }
    const operation = mutationOperation(change)
    records.push({
      mutationId: `workspace-mutation:${sha256(`${change.path}:${operation}`).slice(0, 32)}`,
      operation,
      paths: [canonicalWorkspacePath(change.path)],
      writerAttribution: {
        state: 'indeterminate',
        agentRunId: null,
        processIdentity: null,
        reason: { code: 'workspace_mutation_ledger.writer_attribution_unavailable' }
      },
      beforeDigest: entryDigest(change.before),
      afterDigest: entryDigest(change.after),
      observedAt,
      toolCallIds: [],
      verificationRelations: [{
        kind: 'diff',
        state: 'verified',
        evidenceReference: reference
      }],
      evidenceReferences: [reference, contentReference].filter(Boolean)
    })
  }
  records.sort((left, right) => (
    left.paths[0].localeCompare(right.paths[0])
    || left.mutationId.localeCompare(right.mutationId)
  ))
  const coverage = !workspaceDiff
    ? unavailable('workspace_mutation_ledger.workspace_diff_unavailable')
    : incompleteRecords > 0
      ? partial('workspace_mutation_ledger.evidence_reference_coverage_incomplete')
      : partial('workspace_mutation_ledger.net_diff_only')
  const payload = {
    coverage,
    records,
    overlapFacts: []
  }
  const artifact = {
    artifactId,
    schemaId: WORKSPACE_MUTATION_LEDGER_SCHEMA_ID,
    schemaVersion: WORKSPACE_MUTATION_LEDGER_SCHEMA_VERSION,
    producer: {
      id: 'rovai-qualification-runner',
      version: QUALIFICATION_RUNNER_VERSION,
      digest: withSha256Prefix(producerDigest)
    },
    binding: compactObject({
      suiteId,
      plannedSlotId,
      trialId,
      caseId,
      caseSeal: withSha256Prefix(caseSeal)
    }),
    sourceBoundaries: evidenceIndex.sourceBoundaries
      .filter((boundary) => boundary.sourceId === 'runner.workspace')
      .map((boundary) => structuredClone(boundary)),
    payloadDigest: digest(payload),
    payload
  }
  validateWorkspaceMutationLedger(artifact, evidenceIndex, toolCallLedger)
  validateQualificationArtifactSchema('workspace-mutation-ledger.schema.json', artifact)
  return artifact
}

export async function retainWorkspaceMutationLedgerArtifact(
  evidenceDirectory,
  artifact,
  evidenceIndex,
  toolCallLedger = null
) {
  validateWorkspaceMutationLedger(artifact, evidenceIndex, toolCallLedger)
  const locator = join('workspace-mutation-ledgers', artifactFileName(artifact.artifactId))
  await writePrivateJsonExclusive(join(evidenceDirectory, locator), artifact)
  await atomicWriteJson(join(evidenceDirectory, 'workspace-mutation-ledger.json'), artifact)
  const verification = artifact.payload.records.flatMap((record) => record.verificationRelations)
  return {
    artifactId: artifact.artifactId,
    schemaId: artifact.schemaId,
    schemaVersion: artifact.schemaVersion,
    payloadDigest: artifact.payloadDigest,
    locator,
    recordCount: artifact.payload.records.length,
    overlapFactCount: artifact.payload.overlapFacts.length,
    coverage: artifact.payload.coverage,
    verification: {
      total: verification.length,
      verified: verification.filter((relation) => relation.state === 'verified').length,
      failed: verification.filter((relation) => relation.state === 'failed').length,
      indeterminate: verification.filter((relation) => relation.state === 'indeterminate').length
    }
  }
}

export function validateWorkspaceMutationLedger(artifact, evidenceIndex, toolCallLedger = null) {
  if (artifact?.schemaId !== WORKSPACE_MUTATION_LEDGER_SCHEMA_ID
      || artifact.schemaVersion !== WORKSPACE_MUTATION_LEDGER_SCHEMA_VERSION
      || artifact.payloadDigest !== digest(artifact.payload)) {
    throw new Error('Workspace Mutation Ledger envelope identity is invalid')
  }
  if (!['complete', 'partial', 'unavailable', 'not_applicable'].includes(
    artifact.payload?.coverage?.state
  )) {
    throw new Error('Workspace Mutation Ledger coverage is invalid')
  }
  const evidenceIds = new Set(evidenceIndex?.payload?.records?.map((record) => record.evidenceId) ?? [])
  const knownToolCallIds = new Set(toolCallLedger?.payload?.records?.map((record) => record.toolCallId) ?? [])
  const mutationIds = new Set()
  for (const record of artifact.payload.records) {
    if (mutationIds.has(record.mutationId)) {
      throw new Error('Workspace Mutation Ledger mutation IDs are not unique')
    }
    mutationIds.add(record.mutationId)
    if (!Array.isArray(record.paths)
        || record.paths.length < 1
        || record.paths.length > 2
        || record.paths.some((path) => canonicalWorkspacePath(path) !== path)) {
      throw new Error('Workspace Mutation Ledger path is not canonical')
    }
    if (record.writerAttribution.state !== 'attributed'
        && (record.writerAttribution.agentRunId !== null
          || record.writerAttribution.processIdentity !== null)) {
      throw new Error('Workspace Mutation Ledger invented writer attribution')
    }
    if (record.writerAttribution.state === 'attributed'
        && record.writerAttribution.agentRunId === null
        && record.writerAttribution.processIdentity === null) {
      throw new Error('Workspace Mutation Ledger attributed writer has no identity')
    }
    if (record.operation === 'create' && record.beforeDigest !== null) {
      throw new Error('Workspace Mutation Ledger create has a before digest')
    }
    if (record.operation === 'delete' && record.afterDigest !== null) {
      throw new Error('Workspace Mutation Ledger delete has an after digest')
    }
    if (record.toolCallIds.some((toolCallId) => !knownToolCallIds.has(toolCallId))) {
      throw new Error('Workspace Mutation Ledger references an unknown Tool Call')
    }
    for (const reference of [
      ...record.evidenceReferences,
      ...record.verificationRelations.map((relation) => relation.evidenceReference)
    ]) {
      assertResolvedReference(reference, evidenceIndex, evidenceIds)
    }
  }
  for (const fact of artifact.payload.overlapFacts) {
    if (fact.coverage?.state !== 'complete' || artifact.payload.coverage.state !== 'complete') {
      throw new Error('Workspace Mutation Ledger published overlap without complete writer coverage')
    }
    if (fact.mutationIds.some((mutationId) => !mutationIds.has(mutationId))) {
      throw new Error('Workspace Mutation Ledger overlap references an unknown mutation')
    }
    for (const reference of fact.evidenceReferences) {
      assertResolvedReference(reference, evidenceIndex, evidenceIds)
    }
  }
  validateQualificationArtifactSchema('workspace-mutation-ledger.schema.json', artifact)
  return artifact
}

function mutationOperation(change) {
  if (!change.before && change.after) return 'create'
  if (change.before && !change.after) return 'delete'
  const beforeContent = entryDigest(change.before)
  const afterContent = entryDigest(change.after)
  if (beforeContent !== null && beforeContent === afterContent) return 'metadata'
  return 'modify'
}

function entryDigest(entry) {
  const value = entry?.digest
  if (typeof value !== 'string') return null
  if (/^sha256:[a-f0-9]{64}$/.test(value)) return value
  return /^[a-f0-9]{64}$/.test(value) ? `sha256:${value}` : null
}

function canonicalWorkspacePath(value) {
  if (typeof value !== 'string'
      || value.length === 0
      || value.length > 1024
      || isAbsolute(value)
      || value.includes('\\')) {
    throw new Error('Workspace Mutation Ledger path is invalid')
  }
  const normalized = posix.normalize(value)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized !== value) {
    throw new Error('Workspace Mutation Ledger path escapes the workspace')
  }
  return normalized
}

function assertResolvedReference(reference, evidenceIndex, evidenceIds) {
  if (reference?.artifactId !== evidenceIndex.artifactId || !evidenceIds.has(reference.evidenceId)) {
    throw new Error('Workspace Mutation Ledger has an unresolved Evidence Reference')
  }
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function partial(code) {
  return { state: 'partial', reason: { code } }
}

function unavailable(code) {
  return { state: 'unavailable', reason: { code } }
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined))
}

function withSha256Prefix(value) {
  if (typeof value !== 'string') throw new Error('sha256 identity is required')
  return value.startsWith('sha256:') ? value : `sha256:${value}`
}

function digest(value) {
  return `sha256:${digestJson(value)}`
}
