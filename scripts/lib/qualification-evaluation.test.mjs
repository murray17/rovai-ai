import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  captureDeliveredWorkspaceSnapshot,
  dispatchQualificationPrompt,
  runCaseVerifier
} from './qualification-common.mjs'
import {
  buildRunnerCheckResults,
  buildSuiteProgress,
  collectCampEventPages,
  deriveConvergenceEvidence,
  deriveDeliveryEvidence,
  deriveHardOutcome,
  deriveHumanInterventionEvidence,
  inspectFrozenExecutionBudget,
  normalizeQualificationTrialForImport,
  observedDurableMemberCallEffects,
  redactQualificationResult,
  validateEvaluationContract,
  validateVerifierObservation
} from './qualification-evaluation.mjs'

test('evaluation contract requires stable unique requirements and a complete check mapping', () => {
  const contract = validateEvaluationContract(caseManifest())
  assert.equal(contract.requirements.length, 3)
  assert.equal(contract.verificationCatalog.length, 4)

  const duplicateRequirement = caseManifest()
  duplicateRequirement.requirements.push({ ...duplicateRequirement.requirements[0] })
  assert.throws(
    () => validateEvaluationContract(duplicateRequirement),
    /duplicate qualification requirement ID/
  )

  const uncoveredRequirement = caseManifest()
  uncoveredRequirement.verificationCatalog = uncoveredRequirement.verificationCatalog.filter(
    (check) => check.checkId !== 'CHK-BOUNDARY'
  )
  assert.throws(
    () => validateEvaluationContract(uncoveredRequirement),
    /has no Hard Check/
  )

  const hiddenObligation = caseManifest()
  hiddenObligation.verificationCatalog[0].requirementIds = ['REQ-NOT-DISCLOSED']
  assert.throws(
    () => validateEvaluationContract(hiddenObligation),
    /unknown requirement/
  )

  const unknownField = caseManifest()
  unknownField.verificationCatalog[0].legacySummaryBoolean = true
  assert.throws(
    () => validateEvaluationContract(unknownField),
    /Verification Catalog check is invalid/
  )

  const prerequisiteCycle = caseManifest()
  prerequisiteCycle.verificationCatalog[0].prerequisiteCheckIds = ['CHK-BUILD']
  prerequisiteCycle.verificationCatalog[1].prerequisiteCheckIds = ['CHK-FUNCTION']
  assert.throws(
    () => validateEvaluationContract(prerequisiteCycle),
    /prerequisite cycle/
  )
})

test('verifier observation must be process-successful and contain the exact verifier-owned check set', () => {
  const catalog = validateEvaluationContract(caseManifest()).verificationCatalog
  const valid = validateVerifierObservation({
    process: successfulProcess(),
    output: passingVerifierOutput(),
    parseError: null
  }, catalog)
  assert.equal(valid.validationState, 'valid')
  assert.deepEqual(valid.validationErrors, [])
  assert.deepEqual(valid.checkResults.map((check) => check.checkId), [
    'CHK-BUILD',
    'CHK-DIAGNOSTIC',
    'CHK-FUNCTION'
  ])

  const missing = passingVerifierOutput()
  missing.checks.pop()
  assert.equal(validateVerifierObservation({
    process: successfulProcess(),
    output: missing,
    parseError: null
  }, catalog).validationErrors[0].code, 'verifier.check_set_mismatch')

  const duplicate = passingVerifierOutput()
  duplicate.checks.push({ ...duplicate.checks[0] })
  assert.equal(validateVerifierObservation({
    process: successfulProcess(),
    output: duplicate,
    parseError: null
  }, catalog).validationErrors[0].code, 'verifier.duplicate_check_id')

  const selfReportedBoolean = { ...passingVerifierOutput(), verifiedDelivery: true }
  assert.equal(validateVerifierObservation({
    process: successfulProcess(),
    output: selfReportedBoolean,
    parseError: null
  }, catalog).validationErrors[0].code, 'verifier.unknown_result_field')

  assert.equal(validateVerifierObservation({
    process: { ...successfulProcess(), code: 2 },
    output: passingVerifierOutput(),
    parseError: null
  }, catalog).validationErrors[0].code, 'verifier.process_nonzero')
})

test('Qualification dispatch consumes one persisted structured composer draft revision', async () => {
  const calls = []
  const request = async (method, params) => {
    calls.push({ method, params })
    if (method === 'camp.composerDraft.get') return { campId: 'camp-1', revision: 4 }
    if (method === 'camp.composerDraft.save') return { campId: 'camp-1', revision: 5 }
    return { commandResult: { status: 'accepted' } }
  }
  const execution = {
    taskId: null,
    purpose: 'Implement the disclosed task.',
    completionRole: 'required',
    budget: {
      elapsedSeconds: 900,
      maxAgentRunResponsibilities: 8,
      maxAcceptedA2a: 4
    }
  }
  const result = await dispatchQualificationPrompt(request, {
    commandId: 'command-1',
    campId: 'camp-1',
    prompt: 'Implement the task.',
    execution
  })
  assert.equal(result.commandResult.status, 'accepted')
  assert.deepEqual(calls, [
    {
      method: 'camp.composerDraft.get',
      params: { campId: 'camp-1' }
    },
    {
      method: 'camp.composerDraft.save',
      params: {
        campId: 'camp-1',
        expectedRevision: 4,
        content: [{ kind: 'text', text: 'Implement the task.' }]
      }
    },
    {
      method: 'camp.messages.send',
      params: {
        commandId: 'command-1',
        campId: 'camp-1',
        draftRevision: 5,
        execution
      }
    }
  ])
  assert.equal(Object.hasOwn(calls[2].params, 'body'), false)
  assert.equal(Object.hasOwn(calls[2].params, 'address'), false)
})

test('frozen Core budget preserves the sealed Case projection and exact deadline', () => {
  const contract = { elapsedSeconds: 900, maxAgentRuns: 8, maxAcceptedA2a: 4 }
  const frozen = {
    schemaVersion: 1,
    acceptedAt: '2026-08-03T00:00:00.000Z',
    deadlineAt: '2026-08-03T00:15:00.000Z',
    elapsedSeconds: 900,
    maxAgentRunResponsibilities: 8,
    maxAcceptedA2a: 4,
    rootAgentRunResponsibilities: 1
  }
  assert.deepEqual(inspectFrozenExecutionBudget(frozen, contract), {
    budget: frozen,
    issues: []
  })
  const mismatch = inspectFrozenExecutionBudget({
    ...frozen,
    deadlineAt: '2026-08-03T00:14:59.000Z',
    maxAcceptedA2a: 3
  }, contract)
  assert.deepEqual(mismatch.issues.map((issue) => issue.code), [
    'execution_budget.deadline_derivation_mismatch',
    'execution_budget.case_projection_mismatch'
  ])
})

test('Core event evidence is paged to completion with a monotonic non-duplicating cursor', async () => {
  const requests = []
  const event = (globalSequence, eventId = `event-${globalSequence}`) => ({
    globalSequence,
    eventId,
    eventType: 'member_call.accepted',
    payload: {}
  })
  const request = async (method, params, timeout) => {
    requests.push({ method, params, timeout })
    if (params.afterGlobalSequence === 0) {
      return {
        resetRequired: false,
        hasMore: true,
        nextGlobalSequence: 2,
        throughGlobalSequence: 4,
        events: [event(2), event(1)]
      }
    }
    return {
      resetRequired: false,
      hasMore: false,
      nextGlobalSequence: 4,
      throughGlobalSequence: 4,
      events: [event(2), event(4, null)]
    }
  }
  const state = { afterGlobalSequence: 0, events: [], eventIds: new Set() }
  assert.deepEqual(await collectCampEventPages(request, 'camp-1', state), {
    complete: true,
    reason: null
  })
  assert.deepEqual(state.events.map((item) => item.globalSequence), [1, 2, 4])
  assert.equal(state.afterGlobalSequence, 4)
  assert.deepEqual(requests.map((item) => item.params.afterGlobalSequence), [0, 2])
  assert.equal(requests.every((item) => item.method === 'events.subscribe'), true)
  assert.equal(requests.every((item) => item.timeout === 60_000), true)
})

test('verifier process and schema faults remain evaluation faults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-verifier-contract-'))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const catalog = validateEvaluationContract(caseManifest()).verificationCatalog
  try {
    const crashingVerifier = join(root, 'crash.mjs')
    await writeFile(crashingVerifier, 'process.exit(7)\n')
    const crash = await runCaseVerifier(crashingVerifier, workspace, { verificationCatalog: catalog })
    assert.equal(crash.validationState, 'invalid')
    assert.equal(crash.output, null)
    assert.equal(crash.validationErrors.some((error) => error.code === 'verifier.process_nonzero'), true)

    const malformedVerifier = join(root, 'malformed.mjs')
    await writeFile(malformedVerifier, 'console.log(JSON.stringify({ schemaVersion: 2, verifiedDelivery: true }))\n')
    const malformed = await runCaseVerifier(malformedVerifier, workspace, { verificationCatalog: catalog })
    assert.equal(malformed.validationState, 'invalid')
    assert.equal(malformed.output, null)
    assert.equal(malformed.validationErrors.some((error) => error.code === 'verifier.unknown_result_field'), true)
    assert.equal(malformed.validationErrors.some((error) => error.code === 'verifier.checks_missing'), true)

    const mutatingVerifier = join(root, 'mutating.mjs')
    await writeFile(mutatingVerifier, [
      "import { writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "writeFileSync(join(process.argv[2], 'verifier-side-effect.txt'), 'not allowed\\n')",
      `console.log(${JSON.stringify(JSON.stringify(passingVerifierOutput()))})`
    ].join('\n'))
    const mutated = await runCaseVerifier(mutatingVerifier, workspace, { verificationCatalog: catalog })
    assert.equal(mutated.validationState, 'invalid')
    assert.equal(mutated.validationErrors.some((error) => error.code === 'verifier.workspace_mutated'), true)

    const secretProbe = join(root, 'secret-probe.mjs')
    const secretProbeOutput = passingVerifierOutput()
    await writeFile(secretProbe, [
      `const output = ${JSON.stringify(secretProbeOutput)}`,
      "if (process.env.QUALIFICATION_SECRET_CANARY) output.checks[0].status = 'failed'",
      'console.log(JSON.stringify(output))'
    ].join('\n'))
    process.env.QUALIFICATION_SECRET_CANARY = 'must-not-reach-verifier'
    const isolated = await runCaseVerifier(secretProbe, workspace, { verificationCatalog: catalog })
    delete process.env.QUALIFICATION_SECRET_CANARY
    assert.equal(isolated.validationState, 'valid')
    assert.equal(isolated.checkResults.find((check) => check.checkId === 'CHK-FUNCTION').status, 'passed')
  } finally {
    delete process.env.QUALIFICATION_SECRET_CANARY
    await rm(root, { recursive: true, force: true })
  }
})

test('Delivered Workspace Snapshot excludes Runner projections and survives live-workspace mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-delivered-snapshot-'))
  const workspace = join(root, 'workspace')
  const evidence = join(root, 'evidence')
  await mkdir(join(workspace, 'src'), { recursive: true })
  await mkdir(join(workspace, '.agent'), { recursive: true })
  await mkdir(join(workspace, '.git'), { recursive: true })
  await mkdir(evidence)
  await writeFile(join(workspace, 'src', 'value.txt'), 'delivered\n')
  await writeFile(join(workspace, '.agent', 'projection.txt'), 'runner-owned\n')
  await writeFile(join(workspace, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  try {
    const first = await captureDeliveredWorkspaceSnapshot(workspace, evidence)
    await writeFile(join(workspace, 'src', 'value.txt'), 'mutated later\n')
    assert.equal(await readFile(join(first.path, 'src', 'value.txt'), 'utf8'), 'delivered\n')
    assert.equal(first.manifest.entries.some((entry) => entry.path.startsWith('.agent')), false)
    assert.equal(first.manifest.entries.some((entry) => entry.path.startsWith('.git')), false)

    await writeFile(join(workspace, 'src', 'value.txt'), 'delivered\n')
    const replay = await captureDeliveredWorkspaceSnapshot(workspace, evidence)
    assert.equal(replay.path, first.path)
    assert.equal(replay.manifest.digest, first.manifest.digest)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Delivered Workspace Snapshot rejects symlinks that escape the retained workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-delivered-symlink-'))
  const workspace = join(root, 'workspace')
  const evidence = join(root, 'evidence')
  await mkdir(workspace)
  await mkdir(evidence)
  const outside = join(root, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'private.txt'), 'private\n')
  await symlink(
    outside,
    join(workspace, 'leak'),
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  try {
    await assert.rejects(
      captureDeliveredWorkspaceSnapshot(workspace, evidence),
      /escaping symlink/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('all Delivery Requirements gate delivery while Diagnostic Checks never compensate or fail it', () => {
  const manifest = caseManifest()
  const contract = validateEvaluationContract(manifest)
  const observation = validateVerifierObservation({
    process: successfulProcess(),
    output: passingVerifierOutput({ diagnosticStatus: 'failed' }),
    parseError: null
  }, contract.verificationCatalog)
  const runnerChecks = buildRunnerCheckResults(contract.verificationCatalog, {
    changeBoundary: { passed: true, violations: [] }
  })
  const passing = deriveDeliveryEvidence(contract, observation, runnerChecks)
  assert.equal(passing.verifiedDelivery, 'pass')
  assert.deepEqual(passing.counts, { passed: 3, failed: 0, unavailable: 0, total: 3 })
  assert.deepEqual(passing.failedRequirementIds, [])
  assert.equal(
    passing.checkResults.find((check) => check.checkId === 'CHK-DIAGNOSTIC').status,
    'failed'
  )

  const boundaryFailure = deriveDeliveryEvidence(
    contract,
    observation,
    buildRunnerCheckResults(contract.verificationCatalog, {
      changeBoundary: {
        passed: false,
        violations: [{ path: 'package.json', reason: 'forbidden_path' }]
      }
    })
  )
  assert.equal(boundaryFailure.verifiedDelivery, 'fail')
  assert.deepEqual(boundaryFailure.failedRequirementIds, ['REQ-BOUNDARY'])
  assert.deepEqual(boundaryFailure.counts, { passed: 2, failed: 1, unavailable: 0, total: 3 })
  assert.equal(
    boundaryFailure.requirements.find((requirement) => requirement.requirementId === 'REQ-BOUNDARY').criticality,
    'non_critical'
  )
})

test('an indeterminate Hard Check creates Evaluation Pending instead of a delivery failure', () => {
  const contract = validateEvaluationContract(caseManifest())
  const output = passingVerifierOutput()
  output.checks.find((check) => check.checkId === 'CHK-FUNCTION').status = 'indeterminate'
  const observation = validateVerifierObservation({
    process: successfulProcess(),
    output,
    parseError: null
  }, contract.verificationCatalog)
  const delivery = deriveDeliveryEvidence(
    contract,
    observation,
    buildRunnerCheckResults(contract.verificationCatalog, {
      changeBoundary: { passed: true, violations: [] }
    })
  )
  assert.equal(delivery.verifiedDelivery, 'unavailable')
  assert.equal(
    delivery.requirements.find((requirement) => requirement.requirementId === 'REQ-FUNCTION').status,
    'unavailable'
  )
  assert.deepEqual(deriveHardOutcome({
    dispatchAccepted: true,
    validity: 'valid',
    verifiedDelivery: delivery.verifiedDelivery,
    orchestrationConvergence: 'pass',
    postDispatchHumanIntervention: 'absent',
    evaluationIssues: delivery.evaluationIssues
  }), {
    validity: 'valid',
    evaluationState: 'pending',
    verifiedDelivery: 'unavailable',
    orchestrationConvergence: 'pass',
    postDispatchHumanIntervention: 'absent',
    hardOutcome: 'unavailable',
    overall: 'unavailable'
  })
})

test('cross-authority prerequisite inconsistencies create Evaluation Pending', () => {
  const manifest = caseManifest()
  manifest.verificationCatalog.find((check) => (
    check.checkId === 'CHK-DIAGNOSTIC'
  )).prerequisiteCheckIds = ['CHK-BOUNDARY']
  const contract = validateEvaluationContract(manifest)
  const verifier = validateVerifierObservation({
    process: successfulProcess(),
    output: passingVerifierOutput(),
    parseError: null
  }, contract.verificationCatalog)
  const delivery = deriveDeliveryEvidence(
    contract,
    verifier,
    buildRunnerCheckResults(contract.verificationCatalog, {
      changeBoundary: {
        passed: false,
        violations: [{ path: 'package.json', reason: 'forbidden_path' }]
      }
    })
  )
  assert.equal(delivery.verifiedDelivery, 'unavailable')
  assert.equal(delivery.evaluationIssues.some((issue) => (
    issue.code === 'evaluation.passed_with_unmet_prerequisite'
  )), true)
})

test('Hard Outcome uses only delivery, convergence, and human intervention', () => {
  assert.deepEqual(deriveHardOutcome({
    dispatchAccepted: true,
    validity: 'valid',
    verifiedDelivery: 'pass',
    orchestrationConvergence: 'pass',
    postDispatchHumanIntervention: 'absent',
    evaluationIssues: []
  }), {
    validity: 'valid',
    evaluationState: 'complete',
    verifiedDelivery: 'pass',
    orchestrationConvergence: 'pass',
    postDispatchHumanIntervention: 'absent',
    hardOutcome: 'pass',
    overall: 'pass'
  })

  assert.equal(deriveHardOutcome({
    dispatchAccepted: true,
    validity: 'valid',
    verifiedDelivery: 'pass',
    orchestrationConvergence: 'pass',
    postDispatchHumanIntervention: 'present',
    evaluationIssues: []
  }).hardOutcome, 'fail')

  assert.deepEqual(deriveHardOutcome({
    dispatchAccepted: false,
    validity: 'invalid',
    verifiedDelivery: 'unavailable',
    orchestrationConvergence: 'unavailable',
    postDispatchHumanIntervention: 'indeterminate',
    evaluationIssues: [{ code: 'preflight.invalid' }]
  }), {
    validity: 'invalid',
    evaluationState: 'pending',
    verifiedDelivery: 'unavailable',
    orchestrationConvergence: 'unavailable',
    postDispatchHumanIntervention: 'indeterminate',
    hardOutcome: 'unavailable',
    overall: 'unavailable'
  })
})

test('Convergence uses settlement facts and does not fail merely because a Run failed', () => {
  const snapshot = hardEvidenceSnapshot()
  const settled = deriveConvergenceEvidence({
    snapshot,
    dispatchBoundary: { campTurnId: 'turn-1', rootAgentRunId: 'run-root' },
    budgetEvent: null,
    termination: { converged: true }
  })
  assert.equal(settled.status, 'pass')
  assert.deepEqual(settled.facts, {
    runTree: 'settled',
    conversationInputs: 'settled',
    approvals: 'settled',
    budget: 'compliant',
    runtimeExit: 'complete',
    externalEffects: 'settled'
  })
  assert.deepEqual(settled.failureRecoveryFacts, [{
    agentRunId: 'run-root',
    terminalStatus: 'failed',
    responsibilitySettled: true
  }])

  snapshot.conversationInputs.push({ campTurnId: 'turn-1', status: 'pending' })
  assert.equal(deriveConvergenceEvidence({
    snapshot,
    dispatchBoundary: { campTurnId: 'turn-1', rootAgentRunId: 'run-root' },
    budgetEvent: null,
    termination: { converged: true }
  }).status, 'fail')

  snapshot.agentRuns[0].hasUnsettledExternalEffects = undefined
  assert.equal(deriveConvergenceEvidence({
    snapshot,
    dispatchBoundary: { campTurnId: 'turn-1', rootAgentRunId: 'run-root' },
    budgetEvent: null,
    termination: { converged: true }
  }).status, 'unavailable')
})

test('current Message Delivery coverage, not a missing retired Conversation Input array, determines collaboration settlement', () => {
  const snapshot = hardEvidenceSnapshot()
  snapshot.schemaVersion = 28
  delete snapshot.conversationInputs
  delete snapshot.inboxMessages
  snapshot.turns[0].executionBudget = { acceptedA2a: 1 }

  const missingDelivery = deriveConvergenceEvidence({
    snapshot,
    dispatchBoundary: { campTurnId: 'turn-1', rootAgentRunId: 'run-root' },
    budgetEvent: null,
    termination: { converged: true }
  })
  assert.equal(missingDelivery.facts.conversationInputs, 'indeterminate')
  assert.equal(missingDelivery.status, 'unavailable')

  snapshot.messageDeliveries = [{
    id: 'delivery-1',
    campTurnId: 'turn-1',
    status: 'settled'
  }]
  const settled = deriveConvergenceEvidence({
    snapshot,
    dispatchBoundary: { campTurnId: 'turn-1', rootAgentRunId: 'run-root' },
    budgetEvent: null,
    termination: { converged: true }
  })
  assert.equal(settled.facts.conversationInputs, 'settled')
  assert.equal(settled.status, 'pass')

  snapshot.messageDeliveries[0].status = 'running'
  const running = deriveConvergenceEvidence({
    snapshot,
    dispatchBoundary: { campTurnId: 'turn-1', rootAgentRunId: 'run-root' },
    budgetEvent: null,
    termination: { converged: true }
  })
  assert.equal(running.facts.conversationInputs, 'unsettled')
  assert.equal(running.status, 'fail')
})

test('Human intervention and durable Member Call effect coverage stay explicit', () => {
  const snapshot = hardEvidenceSnapshot()
  const boundary = {
    campTurnId: 'turn-1',
    rootAgentRunId: 'run-root',
    rootAgentRunIds: ['run-root'],
    rootCampMessageId: 'message-1',
    preDispatchThroughGlobalSequence: 10
  }
  assert.equal(deriveHumanInterventionEvidence(snapshot, boundary, 'demo').status, 'absent')
  assert.equal(deriveHumanInterventionEvidence(snapshot, boundary, 'formal').status, 'indeterminate')
  assert.equal(deriveHumanInterventionEvidence(snapshot, boundary, {
    mode: 'formal',
    isolationProfileAdmission: formalIsolationAdmission(),
    continuityCoverage: 'unavailable'
  }).status, 'indeterminate')
  assert.equal(deriveHumanInterventionEvidence(snapshot, boundary, {
    mode: 'formal',
    isolationProfileAdmission: formalIsolationAdmission(),
    continuityCoverage: 'complete'
  }).status, 'absent')

  snapshot.messages.push({ id: 'message-2', authorType: 'user' })
  assert.equal(deriveHumanInterventionEvidence(snapshot, boundary, 'formal').status, 'present')

  snapshot.messages.pop()
  snapshot.approvals.push({
    id: 'approval-system',
    status: 'cancelled',
    resolvedByType: 'system'
  })
  assert.equal(deriveHumanInterventionEvidence(snapshot, boundary, {
    mode: 'formal',
    isolationProfileAdmission: formalIsolationAdmission(),
    continuityCoverage: 'complete'
  }).status, 'absent')
  snapshot.approvals.push({
    id: 'approval-user',
    status: 'approved',
    resolvedByType: 'user'
  })
  assert.equal(deriveHumanInterventionEvidence(snapshot, boundary, {
    mode: 'formal',
    isolationProfileAdmission: formalIsolationAdmission(),
    continuityCoverage: 'complete'
  }).status, 'present')

  snapshot.approvals.pop()
  snapshot.timeline.push({
    globalSequence: 14,
    eventId: 'event-user-runtime-control',
    eventType: 'camp_turn.cancel_requested',
    entityId: 'turn-1',
    actorType: 'user'
  })
  const controlled = deriveHumanInterventionEvidence(snapshot, boundary, {
    mode: 'formal',
    isolationProfileAdmission: formalIsolationAdmission(),
    continuityCoverage: 'complete'
  })
  assert.equal(controlled.status, 'present')
  assert.deepEqual(controlled.evidence.at(-1), {
    code: 'human_intervention.core_control',
    eventIds: ['event-user-runtime-control']
  })

  snapshot.inboxMessages.push(
    { id: 'receipt-1', sourceAgentRunId: 'run-root' },
    { id: 'receipt-1', sourceAgentRunId: 'run-root' },
    { id: 'not-this-turn', sourceAgentRunId: 'run-other' }
  )
  assert.deepEqual(
    observedDurableMemberCallEffects(snapshot, 'turn-1').map((receipt) => receipt.id),
    ['receipt-1']
  )
})

test('Formal External Effect Settlement requires continuous isolation and disabled mutation channels', () => {
  const snapshot = hardEvidenceSnapshot()
  const base = {
    snapshot,
    dispatchBoundary: { campTurnId: 'turn-1', rootAgentRunId: 'run-root' },
    budgetEvent: null,
    termination: { converged: true }
  }
  assert.equal(deriveConvergenceEvidence({
    ...base,
    isolation: {
      mode: 'formal',
      profileAdmission: formalIsolationAdmission(),
      continuityCoverage: 'unavailable'
    }
  }).facts.externalEffects, 'indeterminate')
  assert.equal(deriveConvergenceEvidence({
    ...base,
    isolation: {
      mode: 'formal',
      profileAdmission: formalIsolationAdmission(),
      continuityCoverage: 'complete'
    }
  }).facts.externalEffects, 'settled')

  const ledgered = formalIsolationAdmission()
  ledgered.channels.externalMcpMutation.state = 'ledgered'
  assert.equal(deriveConvergenceEvidence({
    ...base,
    isolation: {
      mode: 'formal',
      profileAdmission: ledgered,
      continuityCoverage: 'complete'
    }
  }).facts.externalEffects, 'indeterminate')

  snapshot.agentRuns[0].hasUnsettledExternalEffects = true
  assert.equal(deriveConvergenceEvidence({
    ...base,
    isolation: {
      mode: 'formal',
      profileAdmission: formalIsolationAdmission(),
      continuityCoverage: 'unavailable'
    }
  }).facts.externalEffects, 'unsettled')
})

test('public result projection explains isolation coverage without leaking private profile identities', () => {
  const redacted = redactQualificationResult({
    runnerVersion: '0.34.0',
    trialId: 'trial-1',
    plannedSlotId: 'slot-1',
    mode: 'formal',
    case: { id: 'CASE-1', version: '1.0.0', seal: 'public-seal' },
    validity: 'valid',
    evaluationState: 'complete',
    dispatchAccepted: true,
    verifiedDelivery: 'pass',
    orchestrationConvergence: 'pass',
    postDispatchHumanIntervention: 'absent',
    hardOutcome: 'pass',
    overall: 'pass',
    hardLayer: {
      overall: 'pass',
      verifiedDelivery: 'pass',
      orchestrationConvergence: 'pass',
      postDispatchHumanIntervention: 'absent',
      convergenceFacts: {}
    },
    ambientMcpIsolation: 'disabled',
    isolationProfile: {
      status: 'admitted',
      artifactId: 'private-artifact-id',
      artifactDigest: 'private-artifact-digest',
      payloadDigest: 'private-payload-digest',
      profileId: 'private-profile-id',
      schemaVersion: '1.0.0',
      profileVersion: '1.2.0',
      executionIsolation: 'dedicated_os_identity',
      dedicatedIdentityDigest: 'private-identity-digest',
      overallCoverage: { state: 'complete', reason: null },
      formalAdmissible: true
    },
    interventionIsolationContinuity: {
      state: 'complete',
      artifactDigest: 'private-final-artifact-digest',
      dedicatedIdentityDigest: 'private-final-identity-digest',
      reason: null
    },
    humanInterventionEvidence: {
      status: 'absent',
      coverage: 'formal_isolation_complete',
      evidence: [{ code: 'safe.code', eventIds: ['private-event-id'] }],
      reason: null
    },
    evidenceIndex: {
      artifactId: 'evidence-index:public-id',
      schemaId: 'rovai.qualification.evidence-index',
      schemaVersion: '1.0.0',
      payloadDigest: `sha256:${'c'.repeat(64)}`,
      locator: 'private/evidence-index.json',
      recordCount: 12,
      sourceBoundaries: [{
        authorityClass: 'core',
        sourceId: 'core.camp-snapshot',
        coverage: { state: 'complete', reason: null }
      }]
    },
    collaborationLedger: {
      artifactId: 'collaboration-ledger:public-id',
      schemaId: 'rovai.qualification.collaboration-ledger',
      schemaVersion: '1.0.0',
      payloadDigest: `sha256:${'d'.repeat(64)}`,
      locator: 'private/collaboration-ledger.json',
      callCount: 2,
      routeFactCount: 1,
      metrics: {
        coverage: { state: 'complete', reason: null },
        acceptedCalls: 2,
        settledCalls: 2,
        maximumDepth: 2
      }
    },
    toolCallLedger: {
      artifactId: 'tool-call-ledger:public-id',
      schemaId: 'rovai.qualification.tool-call-ledger',
      schemaVersion: '1.1.0',
      payloadDigest: `sha256:${'e'.repeat(64)}`,
      locator: 'private/tool-call-ledger.json',
      recordCount: 3,
      summary: {
        coverage: {
          state: 'partial',
          reason: { code: 'tool_evidence.runtime_telemetry_completeness_unattested' }
        },
        total: null,
        succeeded: null,
        failed: null,
        denied: null,
        retries: null,
        idempotentReplays: null,
        provenDuplicateEffects: null,
        mutationVerification: 'none_observed'
      }
    },
    workspaceMutationLedger: {
      artifactId: 'workspace-mutation-ledger:public-id',
      schemaId: 'rovai.qualification.workspace-mutation-ledger',
      schemaVersion: '1.0.0',
      payloadDigest: `sha256:${'f'.repeat(64)}`,
      locator: 'private/workspace-mutation-ledger.json',
      recordCount: 2,
      overlapFactCount: 0,
      coverage: {
        state: 'partial',
        reason: { code: 'workspace_mutation_ledger.net_diff_only' }
      },
      verification: { total: 2, verified: 2, failed: 0, indeterminate: 0 }
    }
  })

  assert.deepEqual(redacted.isolationProfile, {
    status: 'admitted',
    schemaVersion: '1.0.0',
    profileVersion: '1.2.0',
    executionIsolation: 'dedicated_os_identity',
    overallCoverage: { state: 'complete', reason: null },
    formalAdmissible: true,
    reason: null
  })
  assert.deepEqual(redacted.interventionIsolationContinuity, {
    state: 'complete',
    reason: null
  })
  assert.deepEqual(redacted.humanInterventionEvidence, {
    status: 'absent',
    coverage: 'formal_isolation_complete',
    evidenceCodes: ['safe.code'],
    reason: null
  })
  assert.deepEqual(redacted.evidenceIndex, {
    artifactId: 'evidence-index:public-id',
    schemaId: 'rovai.qualification.evidence-index',
    schemaVersion: '1.0.0',
    payloadDigest: `sha256:${'c'.repeat(64)}`,
    recordCount: 12,
    sourceBoundaries: [{
      authorityClass: 'core',
      sourceId: 'core.camp-snapshot',
      coverage: { state: 'complete', reason: null }
    }]
  })
  assert.deepEqual(redacted.collaborationLedger, {
    artifactId: 'collaboration-ledger:public-id',
    schemaId: 'rovai.qualification.collaboration-ledger',
    schemaVersion: '1.0.0',
    payloadDigest: `sha256:${'d'.repeat(64)}`,
    callCount: 2,
    routeFactCount: 1,
    metrics: {
      coverage: { state: 'complete', reason: null },
      acceptedCalls: 2,
      settledCalls: 2,
      maximumDepth: 2
    }
  })
  assert.deepEqual(redacted.toolCallLedger, {
    artifactId: 'tool-call-ledger:public-id',
    schemaId: 'rovai.qualification.tool-call-ledger',
    schemaVersion: '1.1.0',
    payloadDigest: `sha256:${'e'.repeat(64)}`,
    recordCount: 3,
    summary: {
      coverage: {
        state: 'partial',
        reason: { code: 'tool_evidence.runtime_telemetry_completeness_unattested' }
      },
      total: null,
      succeeded: null,
      failed: null,
      denied: null,
      retries: null,
      idempotentReplays: null,
      provenDuplicateEffects: null,
      mutationVerification: 'none_observed'
    }
  })
  assert.deepEqual(redacted.workspaceMutationLedger, {
    artifactId: 'workspace-mutation-ledger:public-id',
    schemaId: 'rovai.qualification.workspace-mutation-ledger',
    schemaVersion: '1.0.0',
    payloadDigest: `sha256:${'f'.repeat(64)}`,
    recordCount: 2,
    overlapFactCount: 0,
    coverage: {
      state: 'partial',
      reason: { code: 'workspace_mutation_ledger.net_diff_only' }
    },
    verification: { total: 2, verified: 2, failed: 0, indeterminate: 0 }
  })
  const publicBytes = JSON.stringify(redacted)
  for (const privateValue of [
    'private-artifact-id',
    'private-artifact-digest',
    'private-payload-digest',
    'private-profile-id',
    'private-identity-digest',
    'private-final-artifact-digest',
    'private-final-identity-digest',
    'private-event-id',
    'private/evidence-index.json',
    'private/collaboration-ledger.json',
    'private/tool-call-ledger.json',
    'private/workspace-mutation-ledger.json'
  ]) {
    assert.equal(publicBytes.includes(privateValue), false)
  }
})

test('Suite publishes a Pass Rate only after every planned Formal slot is scorable', () => {
  const plannedSlots = ['slot-1', 'slot-2', 'slot-3']
  const partial = buildSuiteProgress(plannedSlots, [trial('slot-1', 'pass')])
  assert.equal(partial.publicationState, 'in_progress')
  assert.equal(partial.finalPassRate, null)
  assert.deepEqual(partial.counts, {
    planned: 3,
    notStarted: 2,
    pending: 0,
    invalid: 0,
    scorable: 1,
    passes: 1,
    fails: 0
  })

  const complete = buildSuiteProgress(plannedSlots, [
    trial('slot-1', 'pass'),
    trial('slot-2', 'fail'),
    trial('slot-3', 'pass')
  ])
  assert.equal(complete.publicationState, 'complete')
  assert.equal(complete.finalPassRate, 2 / 3)

  const pending = buildSuiteProgress(plannedSlots, [
    trial('slot-1', 'pass'),
    {
      plannedSlotId: 'slot-2',
      dispatchAccepted: true,
      validity: 'valid',
      evaluationState: 'pending',
      hardOutcome: 'unavailable'
    }
  ])
  assert.equal(pending.publicationState, 'in_progress')
  assert.equal(pending.finalPassRate, null)

  const irrecoverable = buildSuiteProgress(plannedSlots, [
    trial('slot-1', 'pass'),
    {
      plannedSlotId: 'slot-2',
      dispatchAccepted: true,
      validity: 'invalid',
      evaluationState: 'pending',
      hardOutcome: 'unavailable'
    }
  ])
  assert.equal(irrecoverable.publicationState, 'unpublishable')
  assert.equal(irrecoverable.finalPassRate, null)

  assert.throws(() => buildSuiteProgress(plannedSlots, [{
    plannedSlotId: 'slot-1',
    dispatchAccepted: true,
    validity: 'valid',
    evaluationState: 'complete',
    hardOutcome: 'unavailable'
  }]), /valid outcome is inconsistent/)
})

test('historical Trial import preserves its recorded Overall instead of recomputing it', () => {
  const historical = normalizeQualificationTrialForImport({
    schemaVersion: 1,
    validity: 'valid',
    overall: 'pass',
    verifiedDelivery: false,
    orchestrationConvergence: false,
    postDispatchHumanIntervention: true
  })
  assert.equal(historical.overall, 'pass')
  assert.equal(historical.verifiedDelivery, 'fail')

  assert.throws(() => normalizeQualificationTrialForImport({
    schemaVersion: 2,
    validity: 'valid',
    evaluationState: 'complete',
    overall: 'pass',
    hardOutcome: 'fail',
    verifiedDelivery: 'pass',
    orchestrationConvergence: 'pass',
    postDispatchHumanIntervention: 'absent',
    hardLayer: {
      overall: 'pass',
      verifiedDelivery: 'pass',
      orchestrationConvergence: 'pass',
      postDispatchHumanIntervention: 'absent'
    }
  }), /fields are inconsistent/)
})

function caseManifest() {
  return {
    schemaVersion: 2,
    id: 'TQ001',
    version: '2.0.0',
    requirements: [
      {
        requirementId: 'REQ-FUNCTION',
        criticality: 'critical',
        categoryId: 'functional',
        statement: 'The requested behavior works for the disclosed input domain.'
      },
      {
        requirementId: 'REQ-BUILD',
        criticality: 'critical',
        categoryId: 'build',
        statement: 'The public build and tests succeed.'
      },
      {
        requirementId: 'REQ-BOUNDARY',
        criticality: 'non_critical',
        categoryId: 'change_boundary',
        statement: 'The delivered workspace stays within the disclosed change boundary.'
      }
    ],
    verificationCatalog: [
      {
        checkId: 'CHK-FUNCTION',
        kind: 'hard',
        observationAuthority: 'verifier',
        runnerCheck: null,
        categoryId: 'functional',
        requirementIds: ['REQ-FUNCTION'],
        disclosure: 'withheld',
        prerequisiteCheckIds: []
      },
      {
        checkId: 'CHK-BUILD',
        kind: 'hard',
        observationAuthority: 'verifier',
        runnerCheck: null,
        categoryId: 'build',
        requirementIds: ['REQ-BUILD'],
        disclosure: 'public',
        prerequisiteCheckIds: []
      },
      {
        checkId: 'CHK-BOUNDARY',
        kind: 'hard',
        observationAuthority: 'runner',
        runnerCheck: 'change_boundary',
        categoryId: 'change_boundary',
        requirementIds: ['REQ-BOUNDARY'],
        disclosure: 'public',
        prerequisiteCheckIds: []
      },
      {
        checkId: 'CHK-DIAGNOSTIC',
        kind: 'diagnostic',
        observationAuthority: 'verifier',
        runnerCheck: null,
        categoryId: 'quality_diagnostic',
        requirementIds: [],
        disclosure: 'public',
        prerequisiteCheckIds: []
      }
    ],
    publicChecks: [
      { checkId: 'CHK-BUILD', command: ['node', '--test'] }
    ],
    expectedInitialFailureCheckIds: ['CHK-FUNCTION']
  }
}

function passingVerifierOutput({ diagnosticStatus = 'passed' } = {}) {
  return {
    schemaVersion: 2,
    checks: [
      check('CHK-FUNCTION', 'passed'),
      check('CHK-BUILD', 'passed'),
      check('CHK-DIAGNOSTIC', diagnosticStatus)
    ]
  }
}

function check(checkId, status) {
  return {
    checkId,
    status,
    evidence: [{ code: 'verifier.observation', summary: `${checkId} ${status}` }]
  }
}

function successfulProcess() {
  return { code: 0, signal: null, timedOut: false }
}

function hardEvidenceSnapshot() {
  return {
    turns: [{ id: 'turn-1', status: 'completed' }],
    agentRuns: [{
      id: 'run-root',
      campTurnId: 'turn-1',
      status: 'failed',
      hasUnsettledExternalEffects: false
    }],
    conversationInputs: [],
    approvals: [],
    messages: [{ id: 'message-1', authorType: 'user' }],
    inboxMessages: [],
    timeline: [{
      globalSequence: 11,
      eventId: 'event-dispatch-message',
      eventType: 'camp_message.sent',
      entityId: 'message-1',
      actorType: 'user'
    }, {
      globalSequence: 12,
      eventId: 'event-dispatch-run',
      eventType: 'agent_run.queued',
      entityId: 'run-root',
      actorType: 'user'
    }, {
      globalSequence: 13,
      eventId: 'event-dispatch-result',
      eventType: 'command.result',
      entityId: 'turn-1',
      actorType: 'user'
    }]
  }
}

function formalIsolationAdmission() {
  return {
    status: 'admitted',
    channels: {
      networkMutation: { state: 'disabled' },
      gitRemoteMutation: { state: 'disabled' },
      externalMcpMutation: { state: 'disabled' }
    }
  }
}

function trial(plannedSlotId, hardOutcome) {
  return {
    plannedSlotId,
    dispatchAccepted: true,
    validity: 'valid',
    evaluationState: 'complete',
    hardOutcome
  }
}
