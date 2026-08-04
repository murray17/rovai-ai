import { randomUUID } from 'node:crypto'
import {
  lstat,
  readFile,
  readdir,
  realpath,
  stat
} from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import {
  acquireExclusiveFile,
  atomicWriteJson,
  canonicalJson,
  digestFile,
  digestJson,
  ensurePrivateDirectory,
  sha256,
  verifyStoredCaseSeal,
  writePrivateJsonExclusive
} from './qualification-common.mjs'
import { verifyQualificationEvidenceBundle } from './qualification-bundle-verifier.mjs'
import {
  V3_NON_LEAKAGE_POLICY,
  readV3SealedMaterialIndex
} from './qualification-case-v3.mjs'
import { loadQualificationResultHistory } from './qualification-recovery.mjs'
import { validateV036Schema } from './qualification-v036-schema-validation.mjs'

export const DIAGNOSTIC_PORTFOLIO_PRODUCER = Object.freeze({
  name: 'rovai-diagnostic-portfolio',
  version: '0.36.0'
})

const PORTFOLIO_BUDGET = Object.freeze({
  elapsedSeconds: 900,
  maxAgentRuns: 8,
  maxAcceptedA2a: 7
})
const JUDGE_POLICY = Object.freeze({
  status: 'unavailable',
  reasonCode: 'semantic_judge.real_tool_disabled_provider_unavailable',
  fixtureAttachment: 'forbidden'
})
const REPEAT_POLICY = Object.freeze({
  repeatsPerCase: 2,
  tieBreaker: 'forbidden',
  selection: 'forbidden'
})
const REQUIRED_CASE_IDS = Object.freeze(['DC-001', 'DC-002', 'DC-003', 'DC-004'])
const REQUIRED_EVENT_PAYLOAD_FIELDS = Object.freeze({
  attempt_started: ['configurationDigest'],
  preflight_invalid: ['reasonCode'],
  replacement_linked: ['configurationDigest'],
  dispatch_accepted: ['configurationDigest', 'dispatchBoundaryDigest'],
  evaluation_pending: ['evaluationIdentityDigest', 'reasonCode'],
  evaluation_resumed: ['evaluationIdentityDigest'],
  evidence_verified: [
    'trialId',
    'evidenceBundleDigest',
    'hardOutcomeFingerprintDigest',
    'canonicalPayloadDigest',
    'hardOutcome'
  ],
  non_leakage_passed: ['nonLeakageReportDigest'],
  non_leakage_failed: ['nonLeakageReportDigest', 'reasonCode'],
  valid_complete: [
    'trialId',
    'evidenceBundleDigest',
    'hardOutcomeFingerprintDigest',
    'canonicalPayloadDigest',
    'nonLeakageReportDigest',
    'hardOutcome'
  ],
  irrecoverable: ['reasonCode']
})
const FORBIDDEN_PUBLIC_FIELDS = new Set([
  'locator',
  'credentials',
  'credential',
  'environmentValues',
  'command',
  'body',
  'hiddenReasoning',
  'referenceImplementation',
  'sealedPackLocator',
  'challengeManifest',
  'mutants',
  'canary',
  'compositeScore',
  'overallScore',
  'rank',
  'passAtK'
])
const MAX_SCAN_FILE_BYTES = 16 * 1024 * 1024
const MAX_SCAN_TOTAL_BYTES = 256 * 1024 * 1024

export function createDiagnosticPortfolioDefinition({
  caseRecords,
  teamMembers,
  executionFingerprints,
  producerCodeDigest,
  portfolioId = 'DCP-001',
  portfolioVersion = '1.0.1'
}) {
  if (!Array.isArray(caseRecords) || caseRecords.length !== 4) {
    throw new Error('Diagnostic Portfolio requires exactly four admitted Case records')
  }
  const cases = caseRecords.map((record) => {
    if (record?.contract?.manifest?.schemaVersion !== 3 || record?.admission?.schemaVersion !== 3) {
      throw new Error('Diagnostic Portfolio accepts only admitted Case v3 records')
    }
    return {
      caseId: record.contract.manifest.id,
      caseVersion: record.contract.manifest.version,
      caseSeal: asDigest(record.seal)
    }
  }).sort(compareCase)
  if (!sameValues(cases.map((item) => item.caseId), REQUIRED_CASE_IDS)) {
    throw new Error('Diagnostic Portfolio Case set must be exactly DC-001 through DC-004')
  }
  const members = normalizeTeamMembers(teamMembers)
  const teamConfiguration = {
    members,
    configurationDigest: asDigest(digestJson(members))
  }
  const fingerprintsWithoutConfiguration = normalizeExecutionFingerprints(executionFingerprints)
  validateExecutionBindings(members, fingerprintsWithoutConfiguration)
  const configurationDigest = asDigest(digestJson({
    cases,
    teamConfiguration,
    budget: PORTFOLIO_BUDGET,
    executionFingerprints: fingerprintsWithoutConfiguration,
    judgePolicy: JUDGE_POLICY,
    repeatPolicy: REPEAT_POLICY,
    nonLeakagePolicy: V3_NON_LEAKAGE_POLICY
  }))
  const normalizedFingerprints = {
    ...fingerprintsWithoutConfiguration,
    configurationDigest
  }
  const slots = cases.flatMap((caseBinding) => [1, 2].map((repeatOrdinal) => ({
    slotId: `SLOT-${caseBinding.caseId.replace('-', '')}-R${repeatOrdinal}`,
    ...caseBinding,
    repeatOrdinal
  })))
  const definitionWithoutDigest = {
    schemaVersion: 1,
    portfolioId,
    portfolioVersion,
    cases,
    slots,
    teamConfiguration,
    budget: structuredClone(PORTFOLIO_BUDGET),
    executionFingerprints: normalizedFingerprints,
    judgePolicy: structuredClone(JUDGE_POLICY),
    repeatPolicy: structuredClone(REPEAT_POLICY),
    nonLeakagePolicyDigest: asDigest(digestJson(V3_NON_LEAKAGE_POLICY)),
    producer: producer(producerCodeDigest)
  }
  const definition = {
    ...definitionWithoutDigest,
    definitionDigest: asDigest(digestJson(definitionWithoutDigest))
  }
  validateV036Schema('diagnostic-portfolio-definition.schema.json', definition)
  return definition
}

export async function retainDiagnosticPortfolioDefinition(portfolioDirectory, definition) {
  validateDefinitionDigest(definition)
  const root = await ensurePrivateDirectory(resolve(portfolioDirectory))
  await writeImmutableOrVerify(join(root, 'portfolio-definition.json'), definition)
  await ensurePrivateDirectory(join(root, 'ledger'))
  await atomicWriteJson(join(root, 'portfolio-status.json'), rebuildStatus(definition, []))
  return { root, definition }
}

export async function loadDiagnosticPortfolioDefinition(portfolioDirectory) {
  const root = await realpath(resolve(portfolioDirectory))
  const definition = JSON.parse(await readFile(join(root, 'portfolio-definition.json'), 'utf8'))
  validateDefinitionDigest(definition)
  return { root, definition }
}

export async function appendDiagnosticPortfolioEvent(portfolioDirectory, input) {
  const { root, definition } = await loadDiagnosticPortfolioDefinition(portfolioDirectory)
  const lock = await acquireExclusiveFile(join(root, '.ledger-active'))
  try {
    const events = await loadDiagnosticPortfolioLedger(root, definition)
    const sequence = events.length + 1
    const payload = structuredClone(input.payload ?? {})
    validateEventPayload(input.eventType, payload)
    const eventWithoutDigests = {
      schemaVersion: 1,
      eventId: input.eventId ?? eventId(sequence),
      portfolio: portfolioBinding(definition),
      sequence,
      previousEventDigest: events.length === 0 ? null : events.at(-1).eventDigest,
      eventType: input.eventType,
      slotId: input.slotId,
      attemptId: input.attemptId,
      relatedAttemptId: input.relatedAttemptId ?? null,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      producer: input.producer ?? definition.producer,
      payload,
      payloadDigest: asDigest(digestJson(payload))
    }
    const event = {
      ...eventWithoutDigests,
      eventDigest: asDigest(digestJson(eventWithoutDigests))
    }
    validateV036Schema('diagnostic-portfolio-ledger-event.schema.json', event)
    rebuildStatus(definition, [...events, event])
    const filename = `${String(sequence).padStart(8, '0')}-${event.eventId}.json`
    await writePrivateJsonExclusive(join(root, 'ledger', filename), event)
    const status = rebuildStatus(definition, [...events, event])
    await atomicWriteJson(join(root, 'portfolio-status.json'), status)
    return { event, status }
  } finally {
    await lock.release()
  }
}

export async function loadDiagnosticPortfolioLedger(portfolioDirectory, suppliedDefinition = null) {
  const loaded = suppliedDefinition
    ? { root: await realpath(resolve(portfolioDirectory)), definition: suppliedDefinition }
    : await loadDiagnosticPortfolioDefinition(portfolioDirectory)
  const names = (await readdir(join(loaded.root, 'ledger')))
    .filter((name) => name.endsWith('.json'))
    .sort()
  const events = []
  for (const name of names) {
    const event = JSON.parse(await readFile(join(loaded.root, 'ledger', name), 'utf8'))
    validateV036Schema('diagnostic-portfolio-ledger-event.schema.json', event)
    const expectedSequence = events.length + 1
    const expectedPrefix = `${String(expectedSequence).padStart(8, '0')}-`
    if (!name.startsWith(expectedPrefix)
        || name !== `${expectedPrefix}${event.eventId}.json`
        || event.sequence !== expectedSequence
        || event.previousEventDigest !== (events.at(-1)?.eventDigest ?? null)
        || canonicalJson(event.portfolio) !== canonicalJson(portfolioBinding(loaded.definition))
        || event.payloadDigest !== asDigest(digestJson(event.payload))
        || event.eventDigest !== asDigest(digestJson(withoutKey(event, 'eventDigest')))) {
      throw new Error('Diagnostic Portfolio Ledger chain is invalid')
    }
    events.push(event)
  }
  rebuildStatus(loaded.definition, events)
  return events
}

export async function rebuildDiagnosticPortfolioStatus(portfolioDirectory) {
  const { root, definition } = await loadDiagnosticPortfolioDefinition(portfolioDirectory)
  const events = await loadDiagnosticPortfolioLedger(root, definition)
  const status = rebuildStatus(definition, events)
  await atomicWriteJson(join(root, 'portfolio-status.json'), status)
  return status
}

export function buildHardOutcomeFingerprint({
  definition,
  slotId,
  result,
  bundleVerification
}) {
  validateDefinitionDigest(definition)
  if (bundleVerification?.ok !== true
      || bundleVerification.trialId !== result?.trialId
      || result?.validity !== 'valid'
      || result?.evaluationState !== 'complete'
      || !['pass', 'fail'].includes(result?.overall)) {
    throw new Error('Hard Outcome Fingerprint requires a bundle-verified valid complete Trial')
  }
  const slot = definition.slots.find((candidate) => candidate.slotId === slotId)
  if (!slot
      || result.case?.id !== slot.caseId
      || result.case?.version !== slot.caseVersion
      || asDigest(result.case?.seal) !== slot.caseSeal) {
    throw new Error('Hard Outcome Fingerprint Trial does not match the frozen slot')
  }
  const requirements = [...(result.deliveryLayer?.requirements ?? [])]
    .map((requirement) => ({
      requirementId: requirement.requirementId,
      categoryId: requirement.categoryId,
      verdict: requireScorableVerdict(requirement.status, requirement.requirementId)
    }))
    .sort((left, right) => left.requirementId.localeCompare(right.requirementId))
  if (requirements.length !== 6) throw new Error('Hard Outcome Fingerprint requires exactly six requirements')
  const categoryById = new Map((result.deliveryLayer?.categories ?? []).map((item) => [item.categoryId, item.status]))
  const buildPassed = result.verifier?.validationState === 'valid'
    && (result.publicCheckOutcomes ?? []).every((outcome) => outcome.processStatus === 'completed')
  const categories = {
    build: buildPassed ? 'passed' : 'failed',
    regression: requireScorableVerdict(categoryById.get('regression'), 'regression'),
    changeBoundary: requireScorableVerdict(categoryById.get('change_boundary'), 'change_boundary')
  }
  const hardOutcome = {
    validity: result.validity,
    evaluationState: result.evaluationState,
    verifiedDelivery: result.verifiedDelivery,
    orchestrationConvergence: result.orchestrationConvergence,
    postDispatchHumanIntervention: result.postDispatchHumanIntervention,
    overall: result.overall,
    convergenceFacts: structuredClone(result.hardLayer?.convergenceFacts)
  }
  const canonicalPayload = {
    case: { caseId: slot.caseId, caseVersion: slot.caseVersion, caseSeal: slot.caseSeal },
    configurationDigest: definition.executionFingerprints.configurationDigest,
    hardOutcome,
    requirements,
    categories
  }
  const recordWithoutFingerprintDigest = {
    schemaVersion: 1,
    fingerprintId: `hard-outcome:${slotId}:${result.trialId}`,
    portfolio: portfolioBinding(definition),
    slotId,
    trialId: result.trialId,
    ...canonicalPayload,
    canonicalPayloadDigest: asDigest(digestJson(canonicalPayload))
  }
  const fingerprint = {
    ...recordWithoutFingerprintDigest,
    fingerprintDigest: asDigest(digestJson(recordWithoutFingerprintDigest))
  }
  validateV036Schema('hard-outcome-fingerprint.schema.json', fingerprint)
  return fingerprint
}

export async function verifyDiagnosticTrialConfiguration({
  definition,
  slotId,
  result,
  environmentManifest
}) {
  validateDefinitionDigest(definition)
  const slot = definition.slots.find((candidate) => candidate.slotId === slotId)
  if (!slot
      || result?.mode !== 'diagnostic'
      || result?.suiteId !== definition.portfolioId
      || result?.plannedSlotId !== slotId
      || result?.case?.id !== slot.caseId
      || result?.case?.version !== slot.caseVersion
      || asDigest(result?.case?.seal) !== slot.caseSeal
      || canonicalJson(result?.budget?.contract) !== canonicalJson(definition.budget)
      || asDigest(result?.environmentManifestDigest) !== asDigest(digestJson(environmentManifest))
      || environmentManifest?.mode !== 'diagnostic'
      || environmentManifest?.case?.id !== slot.caseId
      || environmentManifest?.case?.version !== slot.caseVersion
      || asDigest(environmentManifest?.case?.seal) !== slot.caseSeal) {
    throw new Error('Diagnostic Trial identity or budget drifted from its frozen slot')
  }
  const fingerprints = definition.executionFingerprints
  if (environmentManifest.runnerVersion !== fingerprints.runner.version
      || asDigest(environmentManifest.runnerDigest) !== fingerprints.runner.digest
      || environmentManifest.releaseCore?.version !== fingerprints.core.version
      || asDigest(environmentManifest.releaseCore?.digest) !== fingerprints.core.digest) {
    throw new Error('Diagnostic Trial Core or Runner fingerprint drifted')
  }
  const node = environmentManifest.toolchain?.find((tool) => tool.name === 'node')
  if (environmentManifest.toolchain?.length !== 1
      || node?.version !== fingerprints.node.version
      || asDigest(node?.outputDigest) !== fingerprints.node.digest) {
    throw new Error('Diagnostic Trial Node fingerprint drifted')
  }
  const expectedMembers = new Map(definition.teamConfiguration.members.map((member) => [
    member.agentProfileId,
    member
  ]))
  const observedMemberIds = (environmentManifest.team ?? []).map((member) => member.id)
  if (observedMemberIds.length !== expectedMembers.size
      || new Set(observedMemberIds).size !== expectedMembers.size
      || observedMemberIds.some((memberId) => !expectedMembers.has(memberId))) {
    throw new Error('Diagnostic Trial team membership drifted')
  }
  for (const observed of environmentManifest.team) {
    const expected = expectedMembers.get(observed.id)
    const model = observed.runtimePreference?.model
    const permissions = observed.runtimePreference?.permissions
    if (!expected
        || observed.runtimeSelection?.adapterKind !== expected.adapterKind
        || model?.modelId !== expected.modelId
        || asDigest(digestJson(model?.options ?? {})) !== expected.modelOptionsDigest
        || asDigest(digestJson(model)) !== expected.modelConfigurationDigest
        || asDigest(digestJson(permissions)) !== expected.permissionProfileDigest) {
      throw new Error(`Diagnostic Trial member configuration drifted: ${observed.id ?? 'unknown'}`)
    }
  }
  const installations = new Map((environmentManifest.runtimeInstallations ?? []).map((installation) => [
    installation.adapterKind,
    installation
  ]))
  const expectedAdapterKinds = new Set(definition.teamConfiguration.members.map(
    (member) => member.adapterKind
  ))
  if (installations.size !== expectedAdapterKinds.size
      || environmentManifest.runtimeInstallations?.length !== expectedAdapterKinds.size
      || [...installations.keys()].some((adapterKind) => !expectedAdapterKinds.has(adapterKind))) {
    throw new Error('Diagnostic Trial Runtime installation set drifted')
  }
  for (const runtime of fingerprints.runtimes) {
    const installation = installations.get(runtime.adapterKind)
    if (!installation?.executablePath
        || runtime.declaredModelId !== expectedMembers.get(runtime.agentProfileId)?.modelId
        || asDigest(await digestFile(installation.executablePath)) !== runtime.executableDigest) {
      throw new Error(`Diagnostic Trial Runtime fingerprint drifted: ${runtime.agentProfileId}`)
    }
  }
  return { ok: true, configurationDigest: fingerprints.configurationDigest }
}

export async function scanDiagnosticTrialNonLeakage({
  definition,
  slotId,
  attemptId,
  evidenceDirectory,
  sealedMaterialIndex
}) {
  validateDefinitionDigest(definition)
  const root = await realpath(resolve(evidenceDirectory))
  const tokens = sealedMaterialIndex.canaries.map((item) => item.token)
  await verifyQualificationEvidenceBundle(root, { deferSafeProjectionChecks: true })
  const { scannedArtifacts, findings } = await observeNonLeakageArtifacts(
    root,
    sealedMaterialIndex
  )
  const reportWithoutDigest = {
    schemaVersion: 1,
    reportId: `non-leakage:${slotId}:${attemptId}`,
    portfolio: portfolioBinding(definition),
    slotId,
    attemptId,
    policyDigest: definition.nonLeakagePolicyDigest,
    coverage: 'complete_observable_artifacts',
    scannedArtifacts,
    outcome: findings.length === 0 ? 'no_observed_leak' : 'leak_detected',
    findings,
    limitation: 'A clean scan proves no leak in observed artifacts; it is not Formal Isolation or proof that a same-user Runtime could not read private files.'
  }
  const report = { ...reportWithoutDigest, payloadDigest: asDigest(digestJson(reportWithoutDigest)) }
  validateV036Schema('non-leakage-report.schema.json', report)
  await writePrivateJsonExclusive(
    join(root, `non-leakage-report-${slotId}-${attemptId}.json`),
    report
  )
  if (report.outcome === 'no_observed_leak') {
    await verifyQualificationEvidenceBundle(root, { forbiddenCanaries: tokens })
  }
  return report
}

export async function inspectDiagnosticNonLeakageArtifacts(
  evidenceDirectory,
  sealedMaterialIndex
) {
  return observeNonLeakageArtifacts(
    await realpath(resolve(evidenceDirectory)),
    sealedMaterialIndex
  )
}

export async function verifyDiagnosticPortfolioEvidence(portfolioDirectory, evidenceMap) {
  const { root, definition } = await loadDiagnosticPortfolioDefinition(portfolioDirectory)
  const events = await loadDiagnosticPortfolioLedger(root, definition)
  const status = rebuildStatus(definition, events)
  if (!status.slots.every((slot) => slot.state === 'valid_complete')) {
    throw new Error('Diagnostic Portfolio evidence verification requires eight terminal slots')
  }
  const resolutions = normalizeEvidenceMap(evidenceMap, definition)
  const verifiedSlots = []
  for (const slotStatus of status.slots) {
    const slot = definition.slots.find((candidate) => candidate.slotId === slotStatus.slotId)
    const resolution = resolutions.get(slot.slotId)
    const caseRecord = await verifyStoredCaseSeal(resolution.caseDirectory)
    if (caseRecord.contract.manifest.id !== slot.caseId
        || caseRecord.contract.manifest.version !== slot.caseVersion
        || asDigest(caseRecord.seal) !== slot.caseSeal) {
      throw new Error(`Diagnostic Portfolio evidence Case resolution drifted: ${slot.slotId}`)
    }
    const evidenceRoot = await realpath(resolve(resolution.evidenceDirectory))
    const result = JSON.parse(await readFile(join(evidenceRoot, 'result.json'), 'utf8'))
    const resultHistory = await loadQualificationResultHistory(evidenceRoot)
    if (canonicalJson(resultHistory.current) !== canonicalJson(result)) {
      throw new Error(`Diagnostic Portfolio Trial projection drifted: ${slot.slotId}`)
    }
    const environmentManifest = JSON.parse(await readFile(
      join(evidenceRoot, 'environment-manifest.json'),
      'utf8'
    ))
    await verifyDiagnosticTrialConfiguration({
      definition,
      slotId: slot.slotId,
      result,
      environmentManifest
    })
    const bundleVerification = await verifyQualificationEvidenceBundle(evidenceRoot)
    const fingerprint = buildHardOutcomeFingerprint({
      definition,
      slotId: slot.slotId,
      result,
      bundleVerification
    })
    const retainedFingerprint = JSON.parse(await readFile(
      join(evidenceRoot, `hard-outcome-fingerprint-${slot.slotId}.json`),
      'utf8'
    ))
    if (canonicalJson(retainedFingerprint) !== canonicalJson(fingerprint)
        || result.trialId !== slotStatus.terminal.trialId
        || bundleVerification.manifestDigest !== slotStatus.terminal.evidenceBundleDigest
        || fingerprint.fingerprintDigest !== slotStatus.terminal.hardOutcomeFingerprintDigest
        || fingerprint.canonicalPayloadDigest !== slotStatus.terminal.canonicalPayloadDigest
        || result.overall !== slotStatus.terminal.hardOutcome) {
      throw new Error(`Diagnostic Portfolio retained evidence drifted: ${slot.slotId}`)
    }
    const nonLeakageReport = await verifyRetainedNonLeakageReport({
      definition,
      slot,
      slotStatus,
      evidenceRoot,
      sealedMaterialIndex: await readV3SealedMaterialIndex(caseRecord.contract)
    })
    verifiedSlots.push({
      slotId: slot.slotId,
      trialId: result.trialId,
      evidenceBundleDigest: bundleVerification.manifestDigest,
      hardOutcomeFingerprintDigest: fingerprint.fingerprintDigest,
      nonLeakageReportDigest: nonLeakageReport.payloadDigest
    })
  }
  return {
    ok: true,
    portfolio: portfolioBinding(definition),
    ledgerHeadDigest: events.at(-1)?.eventDigest ?? null,
    slots: verifiedSlots
  }
}

export async function completeVerifiedDiagnosticPortfolio(portfolioDirectory, evidenceMap) {
  await verifyDiagnosticPortfolioEvidence(portfolioDirectory, evidenceMap)
  return completeDiagnosticPortfolio(portfolioDirectory)
}

export async function verifyVerifiedDiagnosticPortfolioCompletion(portfolioDirectory, evidenceMap) {
  const completion = await verifyDiagnosticPortfolioCompletion(portfolioDirectory)
  const evidence = await verifyDiagnosticPortfolioEvidence(portfolioDirectory, evidenceMap)
  if (completion.ledgerHeadDigest !== evidence.ledgerHeadDigest) {
    throw new Error('Diagnostic Portfolio Completion and verified evidence Ledger heads differ')
  }
  return { ...completion, evidenceVerified: true }
}

async function observeNonLeakageArtifacts(root, sealedMaterialIndex, excludedLocators = []) {
  const matchers = [
    ...sealedMaterialIndex.canaries.map((item) => ({
      matchType: 'sealed_canary',
      materialId: item.materialId,
      value: item.token
    })),
    { matchType: 'private_pack_path', materialId: 'pack-root', value: sealedMaterialIndex.packRoot },
    { matchType: 'private_pack_basename', materialId: 'pack-root', value: sealedMaterialIndex.packBasename },
    ...sealedMaterialIndex.privateLocators.map((value, index) => ({
      matchType: 'private_locator',
      materialId: `private-locator-${index + 1}`,
      value
    }))
  ].filter((matcher) => typeof matcher.value === 'string' && matcher.value !== '')
  const scannedArtifacts = []
  const findings = []
  let totalBytes = 0
  const files = await regularFiles(root)
  for (const path of files) {
    const metadata = await stat(path)
    totalBytes += metadata.size
    if (metadata.size > MAX_SCAN_FILE_BYTES || totalBytes > MAX_SCAN_TOTAL_BYTES) {
      throw new Error('Diagnostic non-leakage scan exceeded its frozen byte bound')
    }
    const bytes = await readFile(path)
    const locator = relative(root, path)
    if (excludedLocators.includes(locator)) continue
    const role = `file:${sha256(locator).slice(0, 24)}`
    scannedArtifacts.push({
      role,
      artifactDigest: asDigest(sha256(bytes)),
      bytes: bytes.length
    })
    const text = bytes.toString('utf8')
    for (const matcher of matchers) {
      if (text.includes(matcher.value)) addFinding(matcher.matchType, role, matcher.materialId)
    }
    for (const credential of credentialMatches(text)) {
      addFinding('credential_pattern', role, `credential-${sha256(credential).slice(0, 16)}`)
    }
    if (isStrictPublicProjection(locator)) {
      if (/(?:\/Users|\/private|\/var\/folders|\/tmp)\//.test(text)) {
        addFinding('private_pack_path', role, 'strict-public-private-locator')
      }
      try {
        const value = JSON.parse(text)
        for (const field of forbiddenFields(value)) {
          addFinding('forbidden_field', role, `field-${field}`)
        }
      } catch {
        // The bundle verifier owns JSON validity. Non-JSON regular files in an
        // evidence directory remain covered by byte-pattern scanning.
      }
    }
  }
  return { scannedArtifacts, findings }

  function addFinding(matchType, artifactRole, materialId) {
    const identity = `${matchType}\u0000${artifactRole}\u0000${materialId}`
    if (findings.some((finding) => finding.findingId === `finding:${sha256(identity).slice(0, 32)}`)) return
    findings.push({
      findingId: `finding:${sha256(identity).slice(0, 32)}`,
      matchType,
      artifactRole,
      materialId
    })
  }
}

async function verifyRetainedNonLeakageReport({
  definition,
  slot,
  slotStatus,
  evidenceRoot,
  sealedMaterialIndex
}) {
  const locator = `non-leakage-report-${slot.slotId}-${slotStatus.attemptId}.json`
  const report = JSON.parse(await readFile(join(evidenceRoot, locator), 'utf8'))
  validateV036Schema('non-leakage-report.schema.json', report)
  const observation = await observeNonLeakageArtifacts(
    evidenceRoot,
    sealedMaterialIndex,
    [locator]
  )
  if (report.reportId !== `non-leakage:${slot.slotId}:${slotStatus.attemptId}`
      || canonicalJson(report.portfolio) !== canonicalJson(portfolioBinding(definition))
      || report.policyDigest !== definition.nonLeakagePolicyDigest
      || report.outcome !== 'no_observed_leak'
      || report.findings.length !== 0
      || canonicalJson(report.scannedArtifacts) !== canonicalJson(observation.scannedArtifacts)
      || observation.findings.length !== 0
      || report.payloadDigest !== asDigest(digestJson(withoutKey(report, 'payloadDigest')))
      || report.payloadDigest !== slotStatus.terminal.nonLeakageReportDigest) {
    throw new Error(`Diagnostic Portfolio retained non-leakage evidence drifted: ${slot.slotId}`)
  }
  await verifyQualificationEvidenceBundle(evidenceRoot, {
    forbiddenCanaries: sealedMaterialIndex.canaries.map((item) => item.token)
  })
  return report
}

export async function completeDiagnosticPortfolio(portfolioDirectory) {
  const { root, definition } = await loadDiagnosticPortfolioDefinition(portfolioDirectory)
  const events = await loadDiagnosticPortfolioLedger(root, definition)
  const status = rebuildStatus(definition, events)
  if (!status.slots.every((slot) => slot.state === 'valid_complete')) {
    throw new Error('Diagnostic Portfolio Completion requires all eight slots valid complete')
  }
  const slots = status.slots.map((slot) => {
    const binding = definition.slots.find((candidate) => candidate.slotId === slot.slotId)
    return {
      slotId: slot.slotId,
      attemptId: slot.attemptId,
      trialId: slot.terminal.trialId,
      case: {
        caseId: binding.caseId,
        caseVersion: binding.caseVersion,
        caseSeal: binding.caseSeal
      },
      hardOutcome: slot.terminal.hardOutcome,
      evidenceBundleDigest: slot.terminal.evidenceBundleDigest,
      hardOutcomeFingerprintDigest: slot.terminal.hardOutcomeFingerprintDigest,
      nonLeakageReportDigest: slot.terminal.nonLeakageReportDigest
    }
  })
  const cases = deriveCaseStabilities(definition, status)
  const completionAuthority = {
    portfolio: portfolioBinding(definition),
    ledgerHeadDigest: events.at(-1).eventDigest,
    slots,
    cases,
    nonLeakagePolicyDigest: definition.nonLeakagePolicyDigest
  }
  const completionWithoutDigest = {
    schemaVersion: 1,
    completionId: `portfolio-completion:${definition.portfolioId}:${definition.portfolioVersion}`,
    ...completionAuthority,
    producer: definition.producer,
    payloadDigest: asDigest(digestJson(completionAuthority))
  }
  const completion = {
    ...completionWithoutDigest,
    completionDigest: asDigest(digestJson(completionWithoutDigest))
  }
  validateV036Schema('diagnostic-portfolio-completion.schema.json', completion)
  const publicReportWithoutDigest = {
    schemaVersion: 1,
    portfolioId: definition.portfolioId,
    portfolioVersion: definition.portfolioVersion,
    configurationDigest: definition.executionFingerprints.configurationDigest,
    status: 'complete',
    cases: cases.map((item) => ({
      ...item.case,
      stability: item.stability,
      formalPromotionEligible: item.formalPromotionEligible
    })),
    slots: slots.map((slot) => ({
      slotId: slot.slotId,
      caseId: slot.case.caseId,
      repeatOrdinal: definition.slots.find((item) => item.slotId === slot.slotId).repeatOrdinal,
      validity: 'valid',
      evaluationState: 'complete',
      hardOutcome: slot.hardOutcome,
      hardOutcomeFingerprintDigest: slot.hardOutcomeFingerprintDigest
    })),
    semanticReview: {
      status: 'unavailable',
      reasonCode: 'semantic_judge.real_tool_disabled_provider_unavailable',
      fixtureAttached: false
    },
    nonLeakage: {
      coverage: 'complete_observable_artifacts',
      outcome: 'no_observed_leak',
      formalIsolationClaim: false
    },
    limitations: [
      'This is an outcome-only diagnostic portfolio, not a team ranking or Formal Qualification Suite.',
      'Two repeats describe case stability; they are not Pass@k, selection, or a statistical significance claim.',
      'A clean observable-artifact scan is not Formal Isolation, and remote provider weight revisions remain unobservable.'
    ]
  }
  const publicReport = {
    ...publicReportWithoutDigest,
    payloadDigest: asDigest(digestJson(publicReportWithoutDigest))
  }
  validateV036Schema('diagnostic-portfolio-public-report.schema.json', publicReport)
  await writeImmutableOrVerify(join(root, 'portfolio-completion.json'), completion)
  await writeImmutableOrVerify(join(root, 'portfolio-public-report.json'), publicReport)
  await atomicWriteJson(join(root, 'portfolio-status.json'), { ...status, completion: 'complete' })
  return { completion, publicReport }
}

export async function verifyDiagnosticPortfolioCompletion(portfolioDirectory) {
  const { root, definition } = await loadDiagnosticPortfolioDefinition(portfolioDirectory)
  const events = await loadDiagnosticPortfolioLedger(root, definition)
  const status = rebuildStatus(definition, events)
  const completion = JSON.parse(await readFile(join(root, 'portfolio-completion.json'), 'utf8'))
  const publicReport = JSON.parse(await readFile(join(root, 'portfolio-public-report.json'), 'utf8'))
  validateV036Schema('diagnostic-portfolio-completion.schema.json', completion)
  validateV036Schema('diagnostic-portfolio-public-report.schema.json', publicReport)
  const expectedSlots = status.slots.map((slot) => {
    const binding = definition.slots.find((candidate) => candidate.slotId === slot.slotId)
    return {
      slotId: slot.slotId,
      attemptId: slot.attemptId,
      trialId: slot.terminal?.trialId,
      case: {
        caseId: binding.caseId,
        caseVersion: binding.caseVersion,
        caseSeal: binding.caseSeal
      },
      hardOutcome: slot.terminal?.hardOutcome,
      evidenceBundleDigest: slot.terminal?.evidenceBundleDigest,
      hardOutcomeFingerprintDigest: slot.terminal?.hardOutcomeFingerprintDigest,
      nonLeakageReportDigest: slot.terminal?.nonLeakageReportDigest
    }
  })
  const expectedCases = deriveCaseStabilities(definition, status)
  const expectedPublicCases = expectedCases.map((item) => ({
    ...item.case,
    stability: item.stability,
    formalPromotionEligible: item.formalPromotionEligible
  }))
  const expectedPublicSlots = expectedSlots.map((slot) => ({
    slotId: slot.slotId,
    caseId: slot.case.caseId,
    repeatOrdinal: definition.slots.find((item) => item.slotId === slot.slotId).repeatOrdinal,
    validity: 'valid',
    evaluationState: 'complete',
    hardOutcome: slot.hardOutcome,
    hardOutcomeFingerprintDigest: slot.hardOutcomeFingerprintDigest
  }))
  if (completion.ledgerHeadDigest !== events.at(-1)?.eventDigest
      || completion.completionId !== `portfolio-completion:${definition.portfolioId}:${definition.portfolioVersion}`
      || canonicalJson(completion.portfolio) !== canonicalJson(portfolioBinding(definition))
      || canonicalJson(completion.producer) !== canonicalJson(definition.producer)
      || canonicalJson(completion.slots) !== canonicalJson(expectedSlots)
      || canonicalJson(completion.cases) !== canonicalJson(expectedCases)
      || canonicalJson(publicReport.cases) !== canonicalJson(expectedPublicCases)
      || canonicalJson(publicReport.slots) !== canonicalJson(expectedPublicSlots)
      || completion.payloadDigest !== asDigest(digestJson({
        portfolio: completion.portfolio,
        ledgerHeadDigest: completion.ledgerHeadDigest,
        slots: completion.slots,
        cases: completion.cases,
        nonLeakagePolicyDigest: completion.nonLeakagePolicyDigest
      }))
      || completion.completionDigest !== asDigest(digestJson(withoutKey(completion, 'completionDigest')))
      || !status.slots.every((slot) => slot.state === 'valid_complete')
      || publicReport.payloadDigest !== asDigest(digestJson(withoutKey(publicReport, 'payloadDigest')))) {
    throw new Error('Diagnostic Portfolio Completion does not match Definition and Ledger authority')
  }
  return { ok: true, completionDigest: completion.completionDigest, ledgerHeadDigest: completion.ledgerHeadDigest }
}

function deriveCaseStabilities(definition, status) {
  return definition.cases.map((caseBinding) => {
    const repeats = status.slots.filter((slot) => slot.caseId === caseBinding.caseId)
    if (repeats.length !== 2 || repeats.some((slot) => !slot.terminal)) {
      throw new Error('Diagnostic Portfolio Case does not have two terminal repeats')
    }
    const samePayload = repeats[0].terminal.canonicalPayloadDigest
      === repeats[1].terminal.canonicalPayloadDigest
    const sameOutcome = repeats[0].terminal.hardOutcome === repeats[1].terminal.hardOutcome
    const stability = samePayload && sameOutcome
      ? repeats[0].terminal.hardOutcome === 'pass' ? 'stable_pass' : 'stable_fail'
      : 'investigation_required'
    return {
      case: structuredClone(caseBinding),
      slotIds: repeats.map((slot) => slot.slotId),
      fingerprintDigests: repeats.map((slot) => slot.terminal.hardOutcomeFingerprintDigest),
      stability,
      formalPromotionEligible: stability !== 'investigation_required'
    }
  })
}

function rebuildStatus(definition, events) {
  const slots = new Map(definition.slots.map((slot) => [slot.slotId, {
    slotId: slot.slotId,
    caseId: slot.caseId,
    repeatOrdinal: slot.repeatOrdinal,
    state: 'planned',
    attemptId: null,
    accepted: false,
    evidence: null,
    nonLeakage: null,
    terminal: null
  }]))
  for (const event of events) applyTransition(definition, slots, event)
  return {
    schemaVersion: 1,
    portfolio: portfolioBinding(definition),
    ledgerEvents: events.length,
    ledgerHeadDigest: events.at(-1)?.eventDigest ?? null,
    slots: [...slots.values()],
    completion: [...slots.values()].every((slot) => slot.state === 'valid_complete')
      ? 'ready'
      : [...slots.values()].some((slot) => slot.state === 'incomplete')
        ? 'incomplete'
        : 'in_progress'
  }
}

function applyTransition(definition, slots, event) {
  const slot = slots.get(event.slotId)
  if (!slot) throw new Error(`Diagnostic Portfolio event references unknown slot ${event.slotId}`)
  const expectedAttemptPrefix = `ATTEMPT-${slot.caseId.replace('-', '')}-R${slot.repeatOrdinal}-`
  if (!event.attemptId.startsWith(expectedAttemptPrefix)) {
    throw new Error('Diagnostic Portfolio attempt identity does not match its slot')
  }
  validateEventPayload(event.eventType, event.payload)
  switch (event.eventType) {
    case 'attempt_started':
      if (!['planned', 'replacement_ready'].includes(slot.state)
          || (slot.state === 'replacement_ready' && slot.attemptId !== event.attemptId)) invalidTransition(slot, event)
      slot.state = 'attempting'
      slot.attemptId = event.attemptId
      break
    case 'preflight_invalid':
      requireCurrent(slot, event, ['attempting'])
      slot.state = 'preflight_invalid'
      break
    case 'replacement_linked':
      requireCurrent(slot, { ...event, attemptId: event.relatedAttemptId }, ['preflight_invalid'])
      if (event.relatedAttemptId === null
          || event.attemptId === event.relatedAttemptId
          || event.payload.configurationDigest !== definition.executionFingerprints.configurationDigest) invalidTransition(slot, event)
      slot.state = 'replacement_ready'
      slot.attemptId = event.attemptId
      break
    case 'dispatch_accepted':
      requireCurrent(slot, event, ['attempting'])
      if (event.payload.configurationDigest !== definition.executionFingerprints.configurationDigest) invalidTransition(slot, event)
      slot.state = 'dispatch_accepted'
      slot.accepted = true
      break
    case 'evaluation_pending':
      requireCurrent(slot, event, ['dispatch_accepted', 'evaluation_resumed'])
      slot.state = 'evaluation_pending'
      break
    case 'evaluation_resumed':
      requireCurrent(slot, event, ['evaluation_pending'])
      slot.state = 'evaluation_resumed'
      break
    case 'evidence_verified':
      requireCurrent(slot, event, ['dispatch_accepted', 'evaluation_resumed'])
      slot.state = 'evidence_verified'
      slot.evidence = structuredClone(event.payload)
      break
    case 'non_leakage_passed':
      requireCurrent(slot, event, ['evidence_verified'])
      slot.state = 'non_leakage_passed'
      slot.nonLeakage = event.payload.nonLeakageReportDigest
      break
    case 'non_leakage_failed':
      requireCurrent(slot, event, ['evidence_verified'])
      slot.state = 'incomplete'
      slot.nonLeakage = event.payload.nonLeakageReportDigest
      break
    case 'valid_complete':
      requireCurrent(slot, event, ['non_leakage_passed'])
      if (!sameTerminalEvidence(slot, event.payload)) invalidTransition(slot, event)
      slot.state = 'valid_complete'
      slot.terminal = structuredClone(event.payload)
      break
    case 'irrecoverable':
      requireCurrent(slot, event, [
        'dispatch_accepted',
        'evaluation_pending',
        'evaluation_resumed',
        'evidence_verified'
      ])
      slot.state = 'incomplete'
      break
    default:
      throw new Error(`unsupported Diagnostic Portfolio event type ${event.eventType}`)
  }
}

function sameTerminalEvidence(slot, payload) {
  return slot.nonLeakage === payload.nonLeakageReportDigest
    && ['trialId', 'evidenceBundleDigest', 'hardOutcomeFingerprintDigest', 'canonicalPayloadDigest', 'hardOutcome']
      .every((field) => slot.evidence?.[field] === payload[field])
}

function requireCurrent(slot, event, states) {
  if (!states.includes(slot.state) || slot.attemptId !== event.attemptId) invalidTransition(slot, event)
}

function invalidTransition(slot, event) {
  throw new Error(`invalid Diagnostic Portfolio transition ${slot.state} -> ${event.eventType}`)
}

function validateEventPayload(eventType, payload) {
  const fields = REQUIRED_EVENT_PAYLOAD_FIELDS[eventType]
  if (!fields) throw new Error(`unknown Diagnostic Portfolio event type ${eventType}`)
  const actual = Object.keys(payload).sort()
  if (!sameValues(actual, [...fields].sort())) {
    throw new Error(`Diagnostic Portfolio ${eventType} payload is not exact`)
  }
}

function validateDefinitionDigest(definition) {
  validateV036Schema('diagnostic-portfolio-definition.schema.json', definition)
  if (definition.definitionDigest !== asDigest(digestJson(withoutKey(definition, 'definitionDigest')))) {
    throw new Error('Diagnostic Portfolio Definition digest mismatch')
  }
}

function normalizeTeamMembers(members) {
  if (!Array.isArray(members) || members.length !== 4) {
    throw new Error('Diagnostic Portfolio requires exactly four frozen team members')
  }
  const normalized = members.map((member) => ({
    agentProfileId: member.agentProfileId,
    adapterKind: member.adapterKind,
    modelId: member.modelId,
    modelOptionsDigest: asDigest(member.modelOptionsDigest),
    modelConfigurationDigest: asDigest(member.modelConfigurationDigest),
    permissionProfileDigest: asDigest(member.permissionProfileDigest)
  })).sort((left, right) => left.agentProfileId.localeCompare(right.agentProfileId))
  if (new Set(normalized.map((member) => member.agentProfileId)).size !== 4) {
    throw new Error('Diagnostic Portfolio team members must be unique')
  }
  return normalized
}

function normalizeExecutionFingerprints(value) {
  if (!value?.core || !value?.runner || !value?.node || !Array.isArray(value.runtimes)
      || !Array.isArray(value.schemaCatalogs) || value.schemaCatalogs.length !== 2) {
    throw new Error('Diagnostic Portfolio execution fingerprints are incomplete')
  }
  const schemaCatalogs = value.schemaCatalogs.map(normalizeBinary)
    .sort((left, right) => left.componentId.localeCompare(right.componentId))
  if (new Set(schemaCatalogs.map((catalog) => catalog.componentId)).size !== 2) {
    throw new Error('Diagnostic Portfolio schema catalog fingerprints must be unique')
  }
  return {
    core: normalizeBinary(value.core),
    runner: normalizeBinary(value.runner),
    node: normalizeBinary(value.node),
    runtimes: value.runtimes.map((runtime) => ({
      agentProfileId: runtime.agentProfileId,
      adapterKind: runtime.adapterKind,
      declaredModelId: runtime.declaredModelId,
      executableDigest: asDigest(runtime.executableDigest)
    })).sort((left, right) => left.agentProfileId.localeCompare(right.agentProfileId)),
    schemaCatalogs,
    opaqueProviderLimitation: 'Declared model identity does not attest unpublished remote provider weight revisions.'
  }
}

function validateExecutionBindings(members, fingerprints) {
  if (fingerprints.runtimes.length !== members.length) {
    throw new Error('Diagnostic Portfolio requires one Runtime fingerprint per team member')
  }
  const memberById = new Map(members.map((member) => [member.agentProfileId, member]))
  const runtimeAgentIds = fingerprints.runtimes.map((runtime) => runtime.agentProfileId)
  if (new Set(runtimeAgentIds).size !== members.length
      || runtimeAgentIds.some((agentProfileId) => !memberById.has(agentProfileId))) {
    throw new Error('Diagnostic Portfolio Runtime fingerprints must bind the exact team member set')
  }
  for (const runtime of fingerprints.runtimes) {
    const member = memberById.get(runtime.agentProfileId)
    if (runtime.adapterKind !== member.adapterKind
        || runtime.declaredModelId !== member.modelId) {
      throw new Error(`Diagnostic Portfolio Runtime binding drifted: ${runtime.agentProfileId}`)
    }
  }
}

function normalizeBinary(value) {
  return { componentId: value.componentId, version: value.version, digest: asDigest(value.digest) }
}

function normalizeEvidenceMap(value, definition) {
  const entries = Array.isArray(value) ? value : value?.slots
  if (!Array.isArray(entries) || entries.length !== definition.slots.length) {
    throw new Error('Diagnostic Portfolio Evidence Map must resolve exactly eight slots')
  }
  const resolutions = new Map()
  for (const entry of entries) {
    if (!entry || typeof entry.slotId !== 'string'
        || canonicalJson(Object.keys(entry).sort()) !== canonicalJson([
          'caseDirectory',
          'evidenceDirectory',
          'slotId'
        ])
        || typeof entry.evidenceDirectory !== 'string'
        || typeof entry.caseDirectory !== 'string'
        || resolutions.has(entry.slotId)
        || !definition.slots.some((slot) => slot.slotId === entry.slotId)) {
      throw new Error('Diagnostic Portfolio Evidence Map entry is invalid')
    }
    resolutions.set(entry.slotId, {
      evidenceDirectory: entry.evidenceDirectory,
      caseDirectory: entry.caseDirectory
    })
  }
  return resolutions
}

function producer(codeDigest) {
  return { ...DIAGNOSTIC_PORTFOLIO_PRODUCER, codeDigest: asDigest(codeDigest) }
}

function portfolioBinding(definition) {
  return {
    portfolioId: definition.portfolioId,
    portfolioVersion: definition.portfolioVersion,
    definitionDigest: definition.definitionDigest
  }
}

function eventId(sequence) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `DPE-${date}-${String(sequence).padStart(4, '0')}-${randomUUID().slice(0, 8).toUpperCase()}`
}

function requireScorableVerdict(value, label) {
  if (!['passed', 'failed'].includes(value)) throw new Error(`Hard Outcome Fingerprint ${label} is unavailable`)
  return value
}

async function regularFiles(root) {
  const files = []
  await walk(root)
  return files.sort()
  async function walk(directory) {
    const names = (await readdir(directory)).sort()
    for (const name of names) {
      const path = join(directory, name)
      const metadata = await lstat(path)
      if (metadata.isDirectory()) await walk(path)
      else if (metadata.isFile()) files.push(path)
    }
  }
}

function credentialMatches(text) {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g,
    /\bAKIA[A-Z0-9]{16}\b/g
  ]
  return patterns.flatMap((pattern) => text.match(pattern) ?? [])
}

function isStrictPublicProjection(locator) {
  return locator === 'public-report.json'
    || locator === 'judge-evidence-pack.json'
    || locator.startsWith(`public-reports${sep}`)
}

function forbiddenFields(value) {
  const found = new Set()
  visit(value)
  return [...found].sort()
  function visit(item) {
    if (Array.isArray(item)) return item.forEach(visit)
    if (!item || typeof item !== 'object') return
    for (const [key, child] of Object.entries(item)) {
      if (FORBIDDEN_PUBLIC_FIELDS.has(key)) found.add(key)
      visit(child)
    }
  }
}

function compareCase(left, right) {
  return left.caseId.localeCompare(right.caseId)
}

function sameValues(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

function asDigest(value) {
  if (typeof value !== 'string' || value === '') throw new Error('sha256 digest is required')
  return value.startsWith('sha256:') ? value : `sha256:${value}`
}

function withoutKey(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([field]) => field !== key))
}

async function writeImmutableOrVerify(path, value) {
  try {
    await writePrivateJsonExclusive(path, value)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const retained = JSON.parse(await readFile(path, 'utf8'))
    if (canonicalJson(retained) !== canonicalJson(value)) {
      throw new Error('immutable Diagnostic Portfolio artifact identity collision')
    }
  }
}
