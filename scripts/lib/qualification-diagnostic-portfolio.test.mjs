import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  appendDiagnosticPortfolioEvent,
  buildHardOutcomeFingerprint,
  completeDiagnosticPortfolio,
  createDiagnosticPortfolioDefinition,
  inspectDiagnosticNonLeakageArtifacts,
  loadDiagnosticPortfolioLedger,
  rebuildDiagnosticPortfolioStatus,
  retainDiagnosticPortfolioDefinition,
  verifyDiagnosticTrialConfiguration,
  verifyDiagnosticPortfolioCompletion
} from './qualification-diagnostic-portfolio.mjs'
import { digestFile, digestJson, materializeJsonArtifact } from './qualification-common.mjs'

test('persisted JSON materialization removes undefined fields before identity hashing', () => {
  const source = { stable: true, omitted: undefined, nested: { value: 1, omitted: undefined } }
  const materialized = materializeJsonArtifact(source)
  assert.deepEqual(materialized, { stable: true, nested: { value: 1 } })
  assert.equal(digestJson(materialized), digestJson(JSON.parse(JSON.stringify(source))))
})

test('Diagnostic Portfolio derives eight slots, stable outcomes, disagreement, and one completion', async () => {
  const root = await temporaryRoot('rovai-portfolio-complete-')
  try {
    const definition = fixtureDefinition()
    await retainDiagnosticPortfolioDefinition(root, definition)
    assert.equal(JSON.stringify(definition).includes(root), false)

    for (const slot of definition.slots) {
      const hardOutcome = slot.caseId === 'DC-002' ? 'fail' : 'pass'
      const canonicalPayloadDigest = digest(
        slot.caseId === 'DC-004' ? `different-${slot.repeatOrdinal}` : `same-${slot.caseId}`
      )
      await appendTerminalSlot(root, definition, slot, { hardOutcome, canonicalPayloadDigest })
    }

    const status = await rebuildDiagnosticPortfolioStatus(root)
    assert.equal(status.completion, 'ready')
    assert.equal(status.slots.length, 8)
    assert.ok(status.slots.every((slot) => slot.state === 'valid_complete'))

    const { completion, publicReport } = await completeDiagnosticPortfolio(root)
    assert.equal(completion.slots.length, 8)
    assert.equal(completion.cases.find((item) => item.case.caseId === 'DC-001').stability, 'stable_pass')
    assert.equal(completion.cases.find((item) => item.case.caseId === 'DC-002').stability, 'stable_fail')
    assert.equal(
      completion.cases.find((item) => item.case.caseId === 'DC-004').stability,
      'investigation_required'
    )
    assert.equal(
      completion.cases.find((item) => item.case.caseId === 'DC-004').formalPromotionEligible,
      false
    )
    assert.equal(publicReport.passAtK, undefined)
    assert.equal((await verifyDiagnosticPortfolioCompletion(root)).ok, true)
    assert.deepEqual((await completeDiagnosticPortfolio(root)).completion, completion)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Diagnostic Portfolio replacement is pre-dispatch only and partial state cannot complete', async () => {
  const root = await temporaryRoot('rovai-portfolio-replacement-')
  try {
    const definition = fixtureDefinition()
    await retainDiagnosticPortfolioDefinition(root, definition)
    const slot = definition.slots[0]
    const first = attemptId(slot, 1)
    const replacement = attemptId(slot, 2)
    await append(root, definition, slot, first, 'attempt_started', {
      configurationDigest: definition.executionFingerprints.configurationDigest
    })
    await append(root, definition, slot, first, 'preflight_invalid', {
      reasonCode: 'preflight.synthetic_invalid'
    })
    await appendDiagnosticPortfolioEvent(root, {
      slotId: slot.slotId,
      attemptId: replacement,
      relatedAttemptId: first,
      eventType: 'replacement_linked',
      payload: { configurationDigest: definition.executionFingerprints.configurationDigest }
    })
    await append(root, definition, slot, replacement, 'attempt_started', {
      configurationDigest: definition.executionFingerprints.configurationDigest
    })
    await assert.rejects(
      append(root, definition, slot, first, 'dispatch_accepted', {
        configurationDigest: definition.executionFingerprints.configurationDigest,
        dispatchBoundaryDigest: digest('old-attempt-dispatch')
      }),
      /invalid Diagnostic Portfolio transition/
    )
    await append(root, definition, slot, replacement, 'dispatch_accepted', {
      configurationDigest: definition.executionFingerprints.configurationDigest,
      dispatchBoundaryDigest: digest('replacement-dispatch')
    })
    await assert.rejects(
      appendDiagnosticPortfolioEvent(root, {
        slotId: slot.slotId,
        attemptId: attemptId(slot, 3),
        relatedAttemptId: replacement,
        eventType: 'replacement_linked',
        payload: { configurationDigest: definition.executionFingerprints.configurationDigest }
      }),
      /invalid Diagnostic Portfolio transition/
    )
    await assert.rejects(completeDiagnosticPortfolio(root), /all eight slots valid complete/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Diagnostic non-leakage inspection detects sealed material and makes an accepted slot incomplete', async () => {
  const evidenceRoot = await temporaryRoot('rovai-portfolio-leak-')
  const portfolioRoot = await temporaryRoot('rovai-portfolio-leak-ledger-')
  try {
    const syntheticCanary = 'SCM-SYNTHETIC-0123456789abcdefghijklmnop'
    await writeFile(
      join(evidenceRoot, 'artifact.txt'),
      `unexpected ${syntheticCanary}\n`,
      { mode: 0o600 }
    )
    const observation = await inspectDiagnosticNonLeakageArtifacts(evidenceRoot, {
      packRoot: '/private/synthetic-pack',
      packBasename: 'synthetic-pack',
      privateLocators: ['sealed/verifier.mjs'],
      canaries: [{ materialId: 'synthetic-verifier', token: syntheticCanary }]
    })
    assert.equal(observation.findings.some((finding) => (
      finding.matchType === 'sealed_canary'
    )), true)

    const definition = fixtureDefinition()
    await retainDiagnosticPortfolioDefinition(portfolioRoot, definition)
    const slot = definition.slots[0]
    const attempt = attemptId(slot, 1)
    await append(portfolioRoot, definition, slot, attempt, 'attempt_started', {
      configurationDigest: definition.executionFingerprints.configurationDigest
    })
    await append(portfolioRoot, definition, slot, attempt, 'dispatch_accepted', {
      configurationDigest: definition.executionFingerprints.configurationDigest,
      dispatchBoundaryDigest: digest('leak-dispatch')
    })
    await append(portfolioRoot, definition, slot, attempt, 'evidence_verified', {
      trialId: 'trial-leak',
      evidenceBundleDigest: digest('leak-bundle'),
      hardOutcomeFingerprintDigest: digest('leak-fingerprint'),
      canonicalPayloadDigest: digest('leak-payload'),
      hardOutcome: 'fail'
    })
    await append(portfolioRoot, definition, slot, attempt, 'non_leakage_failed', {
      nonLeakageReportDigest: digest('leak-report'),
      reasonCode: 'non_leakage.sealed_or_private_material_detected'
    })
    const status = await rebuildDiagnosticPortfolioStatus(portfolioRoot)
    assert.equal(status.completion, 'incomplete')
    assert.equal(status.slots[0].state, 'incomplete')
    await assert.rejects(completeDiagnosticPortfolio(portfolioRoot), /all eight slots valid complete/)
  } finally {
    await rm(evidenceRoot, { recursive: true, force: true })
    await rm(portfolioRoot, { recursive: true, force: true })
  }
})

test('Diagnostic Portfolio Ledger rejects byte tampering and an undeclared third repeat', async () => {
  const root = await temporaryRoot('rovai-portfolio-tamper-')
  try {
    const definition = fixtureDefinition()
    await retainDiagnosticPortfolioDefinition(root, definition)
    const slot = definition.slots[0]
    await append(root, definition, slot, attemptId(slot, 1), 'attempt_started', {
      configurationDigest: definition.executionFingerprints.configurationDigest
    })
    await assert.rejects(
      appendDiagnosticPortfolioEvent(root, {
        slotId: 'SLOT-DC001-R3',
        attemptId: 'ATTEMPT-DC001-R3-01',
        eventType: 'attempt_started',
        payload: { configurationDigest: definition.executionFingerprints.configurationDigest }
      })
    )
    const ledgerName = (await import('node:fs/promises')).readdir(join(root, 'ledger'))
      .then((names) => names[0])
    const path = join(root, 'ledger', await ledgerName)
    const retained = JSON.parse(await readFile(path, 'utf8'))
    retained.payload.configurationDigest = digest('tampered')
    await writeFile(path, `${JSON.stringify(retained, null, 2)}\n`, { mode: 0o600 })
    await chmod(path, 0o600)
    await assert.rejects(loadDiagnosticPortfolioLedger(root), /digest|chain/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Hard Outcome Fingerprint excludes diagnostics and preserves six requirement verdicts', () => {
  const definition = fixtureDefinition()
  const slot = definition.slots[0]
  const result = trialResult(slot)
  const fingerprint = buildHardOutcomeFingerprint({
    definition,
    slotId: slot.slotId,
    result,
    bundleVerification: { ok: true, trialId: result.trialId }
  })
  assert.equal(fingerprint.requirements.length, 6)
  assert.deepEqual(fingerprint.categories, {
    build: 'passed',
    regression: 'passed',
    changeBoundary: 'passed'
  })
  assert.equal(JSON.stringify(fingerprint).includes('failureFacts'), false)
  assert.equal(JSON.stringify(fingerprint).includes('semantic'), false)
})

test('Diagnostic Trial configuration gate binds exact identity, budget, members, and executables', async () => {
  const executableDigest = await digestFile(process.execPath)
  const memberInputs = [
    configurationMember('agent_1', 'codex-cli', 'gpt-5.6-sol'),
    configurationMember('agent_2', 'codex-cli', 'gpt-5.6-sol'),
    configurationMember('agent_3', 'opencode-cli', 'opencode/big-pickle'),
    configurationMember('agent_4', 'antigravity-app', 'gemini-3.6-flash-high')
  ]
  const definition = createDiagnosticPortfolioDefinition({
    caseRecords: fixtureCaseRecords(),
    teamMembers: memberInputs.map(({ member }) => member),
    executionFingerprints: {
      core: { componentId: 'rovai-core', version: '0.36.0', digest: executableDigest },
      runner: { componentId: 'qualification-runner', version: '0.36.0', digest: executableDigest },
      node: { componentId: 'node', version: process.version, digest: executableDigest },
      runtimes: memberInputs.map(({ member }) => ({
        agentProfileId: member.agentProfileId,
        adapterKind: member.adapterKind,
        declaredModelId: member.modelId,
        executableDigest
      })),
      schemaCatalogs: fixtureSchemaCatalogs()
    },
    producerCodeDigest: rawDigest('portfolio-producer')
  })
  const slot = definition.slots[0]
  const result = {
    ...trialResult(slot),
    mode: 'diagnostic',
    suiteId: definition.portfolioId,
    plannedSlotId: slot.slotId,
    budget: { contract: structuredClone(definition.budget) }
  }
  const environmentManifest = {
    mode: 'diagnostic',
    case: { id: slot.caseId, version: slot.caseVersion, seal: slot.caseSeal },
    runnerVersion: definition.executionFingerprints.runner.version,
    runnerDigest: definition.executionFingerprints.runner.digest,
    releaseCore: {
      version: definition.executionFingerprints.core.version,
      digest: definition.executionFingerprints.core.digest
    },
    toolchain: [{
      name: 'node',
      version: definition.executionFingerprints.node.version,
      outputDigest: definition.executionFingerprints.node.digest
    }],
    team: memberInputs.map(({ member, model, permissions }) => ({
      id: member.agentProfileId,
      runtimeSelection: { adapterKind: member.adapterKind },
      runtimePreference: { model, permissions }
    })),
    runtimeInstallations: ['codex-cli', 'opencode-cli', 'antigravity-app'].map(
      (adapterKind) => ({ adapterKind, executablePath: process.execPath })
    )
  }
  result.environmentManifestDigest = digestJson(environmentManifest)

  assert.equal((await verifyDiagnosticTrialConfiguration({
    definition,
    slotId: slot.slotId,
    result,
    environmentManifest
  })).ok, true)

  const drifted = structuredClone(environmentManifest)
  drifted.team[0].runtimePreference.model.options.reasoning_effort = 'high'
  const driftedResult = {
    ...result,
    environmentManifestDigest: digestJson(drifted)
  }
  await assert.rejects(
    verifyDiagnosticTrialConfiguration({
      definition,
      slotId: slot.slotId,
      result: driftedResult,
      environmentManifest: drifted
    }),
    /member configuration drifted/
  )
})

async function appendTerminalSlot(root, definition, slot, {
  hardOutcome,
  canonicalPayloadDigest
}) {
  const attempt = attemptId(slot, 1)
  const evidence = {
    trialId: `trial-${slot.slotId.toLowerCase()}`,
    evidenceBundleDigest: digest(`bundle-${slot.slotId}`),
    hardOutcomeFingerprintDigest: digest(`fingerprint-${slot.slotId}`),
    canonicalPayloadDigest,
    hardOutcome
  }
  await append(root, definition, slot, attempt, 'attempt_started', {
    configurationDigest: definition.executionFingerprints.configurationDigest
  })
  await append(root, definition, slot, attempt, 'dispatch_accepted', {
    configurationDigest: definition.executionFingerprints.configurationDigest,
    dispatchBoundaryDigest: digest(`dispatch-${slot.slotId}`)
  })
  await append(root, definition, slot, attempt, 'evidence_verified', evidence)
  const nonLeakageReportDigest = digest(`non-leakage-${slot.slotId}`)
  await append(root, definition, slot, attempt, 'non_leakage_passed', {
    nonLeakageReportDigest
  })
  await append(root, definition, slot, attempt, 'valid_complete', {
    ...evidence,
    nonLeakageReportDigest
  })
}

function append(root, definition, slot, attempt, eventType, payload) {
  return appendDiagnosticPortfolioEvent(root, {
    slotId: slot.slotId,
    attemptId: attempt,
    eventType,
    payload,
    producer: definition.producer
  })
}

function fixtureDefinition() {
  return createDiagnosticPortfolioDefinition({
    caseRecords: fixtureCaseRecords(),
    teamMembers: [
      member('agent_1', 'codex-cli', 'gpt-5.6-sol'),
      member('agent_2', 'codex-cli', 'gpt-5.6-sol'),
      member('agent_3', 'opencode-cli', 'opencode/big-pickle'),
      member('agent_4', 'antigravity-app', 'gemini-3.6-flash-high')
    ],
    executionFingerprints: {
      core: binary('rovai-core'),
      runner: binary('qualification-runner'),
      node: binary('node'),
      runtimes: [
        runtime('agent_1', 'codex-cli', 'gpt-5.6-sol'),
        runtime('agent_2', 'codex-cli', 'gpt-5.6-sol'),
        runtime('agent_3', 'opencode-cli', 'opencode/big-pickle'),
        runtime('agent_4', 'antigravity-app', 'gemini-3.6-flash-high')
      ],
      schemaCatalogs: fixtureSchemaCatalogs()
    },
    producerCodeDigest: rawDigest('portfolio-producer')
  })
}

function fixtureCaseRecords() {
  return ['DC-001', 'DC-002', 'DC-003', 'DC-004'].map((id, index) => ({
    contract: { manifest: { schemaVersion: 3, id, version: '1.0.0' } },
    admission: { schemaVersion: 3 },
    seal: rawDigest(`case-${index + 1}`)
  }))
}

function configurationMember(agentProfileId, adapterKind, modelId) {
  const model = {
    modelId,
    options: adapterKind === 'codex-cli' ? { reasoning_effort: 'medium' } : {}
  }
  const permissions = { adapterKind, values: { mode: 'test' } }
  return {
    member: {
      agentProfileId,
      adapterKind,
      modelId,
      modelOptionsDigest: digestJson(model.options),
      modelConfigurationDigest: digestJson(model),
      permissionProfileDigest: digestJson(permissions)
    },
    model,
    permissions
  }
}

function member(agentProfileId, adapterKind, modelId) {
  const model = { mode: 'explicit', modelId, options: {} }
  return {
    agentProfileId,
    adapterKind,
    modelId,
    modelOptionsDigest: digest(`model-options-${agentProfileId}`),
    modelConfigurationDigest: digestJson(model),
    permissionProfileDigest: digest(`permissions-${agentProfileId}`)
  }
}

function binary(componentId) {
  return { componentId, version: '1.0.0', digest: digest(`binary-${componentId}`) }
}

function runtime(agentProfileId, adapterKind, declaredModelId) {
  return {
    agentProfileId,
    adapterKind,
    declaredModelId,
    executableDigest: digest(`runtime-${agentProfileId}`)
  }
}

function fixtureSchemaCatalogs() {
  return [
    { componentId: 'v0.34-artifact-schemas', version: '1.3.0', digest: digest('schemas-v034') },
    { componentId: 'v0.36-diagnostic-schemas', version: '1.0.0', digest: digest('schemas-v036') }
  ]
}

function trialResult(slot) {
  const requirements = [
    'workstream_a',
    'workstream_b',
    'workstream_c',
    'integration',
    'regression',
    'change_boundary'
  ].map((categoryId, index) => ({
    requirementId: `REQ-${slot.caseId.replace('-', '')}-R${index + 1}`,
    categoryId,
    status: 'passed'
  }))
  return {
    trialId: 'trial-fingerprint-fixture',
    case: { id: slot.caseId, version: slot.caseVersion, seal: slot.caseSeal },
    validity: 'valid',
    evaluationState: 'complete',
    verifiedDelivery: 'pass',
    orchestrationConvergence: 'pass',
    postDispatchHumanIntervention: 'absent',
    overall: 'pass',
    hardLayer: {
      convergenceFacts: {
        runTree: 'settled',
        conversationInputs: 'settled',
        approvals: 'settled',
        budget: 'compliant',
        runtimeExit: 'complete',
        externalEffects: 'settled'
      }
    },
    verifier: { validationState: 'valid' },
    publicCheckOutcomes: Array.from({ length: 5 }, () => ({ processStatus: 'completed' })),
    deliveryLayer: {
      requirements,
      categories: requirements.map(({ categoryId }) => ({ categoryId, status: 'passed' })),
      failureFacts: [{ classification: 'diagnostic-not-fingerprinted' }]
    },
    semanticEngineeringReview: { status: 'unavailable' }
  }
}

function attemptId(slot, ordinal) {
  return `ATTEMPT-${slot.caseId.replace('-', '')}-R${slot.repeatOrdinal}-${String(ordinal).padStart(2, '0')}`
}

async function temporaryRoot(prefix) {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  await chmod(root, 0o700)
  return root
}

function digest(value) {
  return `sha256:${rawDigest(value)}`
}

function rawDigest(value) {
  return (awaitlessHash(value))
}

function awaitlessHash(value) {
  let output = ''
  for (let index = 0; index < 64; index += 1) {
    output += (value.charCodeAt(index % value.length) % 16).toString(16)
  }
  return output
}
