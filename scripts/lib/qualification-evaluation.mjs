const REQUIREMENT_ID = /^REQ-[A-Z0-9][A-Z0-9._-]*$/
const CHECK_ID = /^CHK-[A-Z0-9][A-Z0-9._-]*$/
const CRITICALITIES = new Set(['critical', 'non_critical'])
const CHECK_KINDS = new Set(['hard', 'diagnostic'])
const OBSERVATION_AUTHORITIES = new Set(['verifier', 'runner'])
const DISCLOSURES = new Set(['public', 'withheld'])
const VERIFIER_STATUSES = new Set([
  'passed',
  'failed',
  'blocked',
  'indeterminate',
  'not_applicable'
])
const VERIFIER_RESULT_FIELDS = new Set(['schemaVersion', 'checks'])
const VERIFIER_CHECK_FIELDS = new Set(['checkId', 'status', 'evidence'])
const VERIFIER_EVIDENCE_FIELDS = new Set(['code', 'summary'])
const REQUIREMENT_FIELDS = new Set(['requirementId', 'criticality', 'categoryId', 'statement'])
const CATALOG_CHECK_FIELDS = new Set([
  'checkId',
  'kind',
  'observationAuthority',
  'runnerCheck',
  'categoryId',
  'requirementIds',
  'disclosure',
  'prerequisiteCheckIds'
])
const PUBLIC_CHECK_FIELDS_V2 = new Set(['checkId', 'command'])
const PUBLIC_CHECK_FIELDS_V3 = new Set(['checkId', 'initialExpectation', 'command'])

export const QUALIFICATION_CASE_SCHEMA_VERSION = 3
export const QUALIFICATION_CASE_SCHEMA_V2 = 2
export const SUPPORTED_QUALIFICATION_CASE_SCHEMA_VERSIONS = Object.freeze([2, 3])
export const QUALIFICATION_VERIFIER_SCHEMA_VERSION = 2
export const QUALIFICATION_TRIAL_SCHEMA_VERSION = 2
export const QUALIFICATION_SUITE_SCHEMA_VERSION = 2

export function normalizeQualificationTrialForImport(result) {
  if (result?.schemaVersion === QUALIFICATION_TRIAL_SCHEMA_VERSION) {
    if (result.hardOutcome !== result.overall
        || result.hardLayer?.overall !== result.overall
        || result.hardLayer?.verifiedDelivery !== result.verifiedDelivery
        || result.hardLayer?.orchestrationConvergence !== result.orchestrationConvergence
        || result.hardLayer?.postDispatchHumanIntervention !== result.postDispatchHumanIntervention) {
      throw new Error('Qualification Trial v2 Hard Outcome fields are inconsistent')
    }
    return {
      validity: result.validity,
      evaluationState: result.evaluationState,
      overall: result.hardOutcome,
      verifiedDelivery: result.verifiedDelivery,
      orchestrationConvergence: result.orchestrationConvergence,
      postDispatchHumanIntervention: result.postDispatchHumanIntervention
    }
  }
  if (result?.schemaVersion === 1) {
    return {
      validity: result.validity,
      evaluationState: result.validity === 'valid' ? 'complete' : 'pending',
      overall: result.overall,
      verifiedDelivery: result.verifiedDelivery === true ? 'pass' : 'fail',
      orchestrationConvergence: result.orchestrationConvergence === true ? 'pass' : 'fail',
      postDispatchHumanIntervention: result.postDispatchHumanIntervention === true ? 'present' : 'absent'
    }
  }
  throw new Error(`unsupported Qualification Trial schema: ${result?.schemaVersion}`)
}

export function validateEvaluationContract(manifest) {
  if (!SUPPORTED_QUALIFICATION_CASE_SCHEMA_VERSIONS.includes(manifest?.schemaVersion)) {
    throw new Error('qualification case manifest schemaVersion must be 2 or 3')
  }
  const caseSchemaVersion = manifest.schemaVersion
  if (!Array.isArray(manifest.requirements) || manifest.requirements.length === 0) {
    throw new Error('qualification requirements must be a non-empty array')
  }
  if (!Array.isArray(manifest.verificationCatalog) || manifest.verificationCatalog.length === 0) {
    throw new Error('qualification verification catalog must be a non-empty array')
  }

  const requirementIds = new Set()
  const requirements = manifest.requirements.map((requirement) => {
    if (!isPlainObject(requirement)
        || Object.keys(requirement).some((field) => !REQUIREMENT_FIELDS.has(field))
        || !REQUIREMENT_ID.test(requirement.requirementId ?? '')
        || !CRITICALITIES.has(requirement.criticality)
        || !isStableLabel(requirement.categoryId)
        || typeof requirement.statement !== 'string'
        || requirement.statement.trim() === ''
        || requirement.statement.length > 2_000) {
      throw new Error('qualification requirement is invalid')
    }
    if (requirementIds.has(requirement.requirementId)) {
      throw new Error(`duplicate qualification requirement ID: ${requirement.requirementId}`)
    }
    requirementIds.add(requirement.requirementId)
    return {
      requirementId: requirement.requirementId,
      criticality: requirement.criticality,
      categoryId: requirement.categoryId,
      statement: requirement.statement
    }
  })

  const checkIds = new Set()
  const verificationCatalog = manifest.verificationCatalog.map((check) => {
    if (!isPlainObject(check)
        || Object.keys(check).some((field) => !CATALOG_CHECK_FIELDS.has(field))
        || !CHECK_ID.test(check.checkId ?? '')
        || !CHECK_KINDS.has(check.kind)
        || !OBSERVATION_AUTHORITIES.has(check.observationAuthority)
        || !isStableLabel(check.categoryId)
        || !DISCLOSURES.has(check.disclosure)
        || !Array.isArray(check.requirementIds)
        || !Array.isArray(check.prerequisiteCheckIds)) {
      throw new Error('qualification Verification Catalog check is invalid')
    }
    if (checkIds.has(check.checkId)) {
      throw new Error(`duplicate qualification check ID: ${check.checkId}`)
    }
    checkIds.add(check.checkId)
    if (new Set(check.requirementIds).size !== check.requirementIds.length
        || check.requirementIds.some((requirementId) => !REQUIREMENT_ID.test(requirementId))) {
      throw new Error(`qualification check ${check.checkId} has invalid requirement references`)
    }
    for (const requirementId of check.requirementIds) {
      if (!requirementIds.has(requirementId)) {
        throw new Error(`qualification check ${check.checkId} references unknown requirement ${requirementId}`)
      }
    }
    if (check.kind === 'hard' && check.requirementIds.length === 0) {
      throw new Error(`qualification Hard Check ${check.checkId} has no disclosed requirement`)
    }
    const supportedRunnerChecks = caseSchemaVersion === 3
      ? new Set(['change_boundary', 'public_check'])
      : new Set(['change_boundary'])
    if (check.observationAuthority === 'runner' && !supportedRunnerChecks.has(check.runnerCheck)) {
      throw new Error(`qualification Runner Check ${check.checkId} has an unsupported runnerCheck`)
    }
    if (check.observationAuthority === 'verifier' && check.runnerCheck !== null) {
      throw new Error(`qualification Verifier Check ${check.checkId} cannot declare runnerCheck`)
    }
    return {
      checkId: check.checkId,
      kind: check.kind,
      observationAuthority: check.observationAuthority,
      runnerCheck: check.runnerCheck,
      categoryId: check.categoryId,
      requirementIds: [...check.requirementIds],
      disclosure: check.disclosure,
      prerequisiteCheckIds: [...check.prerequisiteCheckIds]
    }
  })

  for (const check of verificationCatalog) {
    if (new Set(check.prerequisiteCheckIds).size !== check.prerequisiteCheckIds.length
        || check.prerequisiteCheckIds.some((checkId) => !checkIds.has(checkId) || checkId === check.checkId)) {
      throw new Error(`qualification check ${check.checkId} has invalid prerequisites`)
    }
  }
  assertAcyclicCatalog(verificationCatalog)
  for (const requirement of requirements) {
    if (!verificationCatalog.some((check) => (
      check.kind === 'hard' && check.requirementIds.includes(requirement.requirementId)
    ))) {
      throw new Error(`qualification requirement ${requirement.requirementId} has no Hard Check`)
    }
  }

  if (!Array.isArray(manifest.publicChecks)) {
    throw new Error('qualification publicChecks must be an array')
  }
  const publicCheckIds = new Set()
  for (const publicCheck of manifest.publicChecks) {
    const allowedFields = caseSchemaVersion === 3 ? PUBLIC_CHECK_FIELDS_V3 : PUBLIC_CHECK_FIELDS_V2
    if (!isPlainObject(publicCheck)
        || Object.keys(publicCheck).some((field) => !allowedFields.has(field))
        || !CHECK_ID.test(publicCheck.checkId ?? '')
        || publicCheckIds.has(publicCheck.checkId)
        || !Array.isArray(publicCheck.command)
        || publicCheck.command.length === 0
        || publicCheck.command.some((part) => typeof part !== 'string' || part === '')
        || (caseSchemaVersion === 3 && !['fail', 'pass'].includes(publicCheck.initialExpectation))) {
      throw new Error('qualification public check is invalid')
    }
    publicCheckIds.add(publicCheck.checkId)
    const catalogCheck = verificationCatalog.find((check) => check.checkId === publicCheck.checkId)
    if (!catalogCheck
        || (caseSchemaVersion === 2 && catalogCheck.observationAuthority !== 'verifier')
        || (caseSchemaVersion === 3
          && (catalogCheck.observationAuthority !== 'runner' || catalogCheck.runnerCheck !== 'public_check'))
        || catalogCheck.disclosure !== 'public') {
      throw new Error(`qualification public check ${publicCheck.checkId} has no matching public Check authority`)
    }
  }

  if (!Array.isArray(manifest.expectedInitialFailureCheckIds)
      || manifest.expectedInitialFailureCheckIds.length === 0
      || new Set(manifest.expectedInitialFailureCheckIds).size !== manifest.expectedInitialFailureCheckIds.length) {
    throw new Error('qualification expected initial failure checks are invalid')
  }
  for (const checkId of manifest.expectedInitialFailureCheckIds) {
    const check = verificationCatalog.find((candidate) => candidate.checkId === checkId)
    if (!check || check.kind !== 'hard'
        || (caseSchemaVersion === 2 && check.observationAuthority !== 'verifier')) {
      throw new Error(`qualification expected initial failure check is invalid: ${checkId}`)
    }
  }

  if (caseSchemaVersion === 3) {
    validateV3EvaluationTopology({
      manifest,
      requirements,
      verificationCatalog,
      publicCheckIds
    })
  }

  return {
    caseSchemaVersion,
    requirements,
    verificationCatalog,
    expectedInitialFailureCheckIds: [...manifest.expectedInitialFailureCheckIds]
  }
}

function validateV3EvaluationTopology({ manifest, requirements, verificationCatalog, publicCheckIds }) {
  if (manifest.collaboration !== undefined) {
    throw new Error('qualification Case v3 forbids a collaboration contract')
  }
  if (requirements.length !== 6 || manifest.publicChecks.length !== 5) {
    throw new Error('qualification Case v3 requires exactly six requirements and five public checks')
  }
  const caseStem = manifest.id?.replace('-', '')
  const expectedCategories = [
    'workstream_a',
    'workstream_b',
    'workstream_c',
    'integration',
    'regression',
    'change_boundary'
  ]
  for (let index = 0; index < requirements.length; index += 1) {
    const requirement = requirements[index]
    if (requirement.requirementId !== `REQ-${caseStem}-R${index + 1}`
        || requirement.categoryId !== expectedCategories[index]
        || requirement.criticality !== (index === 5 ? 'non_critical' : 'critical')) {
      throw new Error(`qualification Case v3 requirement R${index + 1} has an invalid fixed identity`)
    }
  }

  const hardChecksFor = (requirementId) => verificationCatalog.filter((check) => (
    check.kind === 'hard' && check.requirementIds.includes(requirementId)
  ))
  const expectedInitialFailures = []
  for (let index = 0; index < 4; index += 1) {
    const requirement = requirements[index]
    const hardChecks = hardChecksFor(requirement.requirementId)
    const publicChecks = hardChecks.filter((check) => (
      check.observationAuthority === 'runner'
      && check.runnerCheck === 'public_check'
      && check.disclosure === 'public'
    ))
    const withheldChecks = hardChecks.filter((check) => (
      check.observationAuthority === 'verifier' && check.disclosure === 'withheld'
    ))
    if (publicChecks.length !== 1 || withheldChecks.length < 1 || hardChecks.length !== 1 + withheldChecks.length) {
      throw new Error(`qualification Case v3 ${requirement.requirementId} lacks its public/withheld pair`)
    }
    const publicEntry = manifest.publicChecks.find((check) => check.checkId === publicChecks[0].checkId)
    if (publicEntry?.initialExpectation !== 'fail') {
      throw new Error(`qualification Case v3 ${requirement.requirementId} public check must initially fail`)
    }
    if (publicChecks.some((check) => check.categoryId !== requirement.categoryId)
        || withheldChecks.some((check) => check.categoryId !== requirement.categoryId)) {
      throw new Error(`qualification Case v3 ${requirement.requirementId} check category mismatch`)
    }
    expectedInitialFailures.push(...hardChecks.map((check) => check.checkId))
  }

  const regression = requirements[4]
  const regressionChecks = hardChecksFor(regression.requirementId)
  if (regressionChecks.length !== 1
      || regressionChecks[0].observationAuthority !== 'runner'
      || regressionChecks[0].runnerCheck !== 'public_check'
      || regressionChecks[0].disclosure !== 'public'
      || regressionChecks[0].categoryId !== regression.categoryId
      || manifest.publicChecks.find((check) => check.checkId === regressionChecks[0].checkId)?.initialExpectation !== 'pass') {
    throw new Error('qualification Case v3 R5 must have exactly one initial-pass public regression check')
  }

  const boundary = requirements[5]
  const boundaryChecks = hardChecksFor(boundary.requirementId)
  if (boundaryChecks.length !== 1
      || boundaryChecks[0].observationAuthority !== 'runner'
      || boundaryChecks[0].runnerCheck !== 'change_boundary'
      || boundaryChecks[0].disclosure !== 'public'
      || boundaryChecks[0].categoryId !== boundary.categoryId
      || publicCheckIds.has(boundaryChecks[0].checkId)) {
    throw new Error('qualification Case v3 R6 must have exactly one Runner-owned change-boundary check')
  }

  const catalogPublicCheckIds = verificationCatalog
    .filter((check) => check.kind === 'hard'
      && check.observationAuthority === 'runner'
      && check.runnerCheck === 'public_check'
      && check.disclosure === 'public')
    .map((check) => check.checkId)
    .sort()
  if (!arraysEqual([...publicCheckIds].sort(), catalogPublicCheckIds)) {
    throw new Error('qualification Case v3 public check set is not exact')
  }
  if (!arraysEqual([...manifest.expectedInitialFailureCheckIds].sort(), expectedInitialFailures.sort())) {
    throw new Error('qualification Case v3 expected initial failure set is not exact')
  }

  for (const [index, publicCheck] of manifest.publicChecks.entries()) {
    const requirementId = requirements[index].requirementId
    const requirementPublicCheck = hardChecksFor(requirementId).find((check) => (
      check.observationAuthority === 'runner' && check.runnerCheck === 'public_check'
    ))
    if (publicCheck.checkId !== requirementPublicCheck?.checkId) {
      throw new Error(`qualification Case v3 public check order does not match R${index + 1}`)
    }
    if (publicCheck.command[0] !== 'node'
        || publicCheck.command[1] !== '--test'
        || !publicCheck.command.includes('--test-concurrency=1')
        || publicCheck.command.some((part) => /[;&|`$<>]/.test(part))) {
      throw new Error(`qualification Case v3 public check ${publicCheck.checkId} is not a direct serial Node test`)
    }
    const locators = publicCheck.command.filter((part) => part.startsWith('tests/'))
    if (locators.length === 0
        || locators.some((locator) => locator.includes('..')
          || (!locator.startsWith('tests/public/') && locator !== 'tests/agent/**/*.test.mjs'))) {
      throw new Error(`qualification Case v3 public check ${publicCheck.checkId} has an invalid test locator`)
    }
    const hasAgentTests = locators.includes('tests/agent/**/*.test.mjs')
    if ((index === 4) !== hasAgentTests) {
      throw new Error('qualification Case v3 only R5 may discover Agent-authored tests')
    }
  }
}

export function validateVerifierObservation(observation, verificationCatalog) {
  const errors = []
  const process = observation?.process
  if (!isPlainObject(process)) {
    errors.push(reason('verifier.process_missing'))
  } else if (process.timedOut === true) {
    errors.push(reason('verifier.process_timeout'))
  } else if (process.signal !== null && process.signal !== undefined) {
    errors.push(reason('verifier.process_signaled', String(process.signal)))
  } else if (process.code !== 0) {
    errors.push(reason('verifier.process_nonzero', String(process.code)))
  }
  if (observation?.parseError) {
    errors.push(reason('verifier.invalid_json', observation.parseError.message ?? String(observation.parseError)))
  }

  const output = observation?.output
  if (!isPlainObject(output)) {
    errors.push(reason('verifier.result_missing'))
    return invalidVerifierObservation(process, errors)
  }
  const unknownResultField = Object.keys(output).find((field) => !VERIFIER_RESULT_FIELDS.has(field))
  if (unknownResultField) {
    errors.push(reason('verifier.unknown_result_field', unknownResultField))
  }
  if (output.schemaVersion !== QUALIFICATION_VERIFIER_SCHEMA_VERSION) {
    errors.push(reason('verifier.unsupported_schema', String(output.schemaVersion)))
  }
  if (!Array.isArray(output.checks)) {
    errors.push(reason('verifier.checks_missing'))
    return invalidVerifierObservation(process, errors)
  }

  const seen = new Set()
  const rawById = new Map()
  for (const rawCheck of output.checks) {
    if (!isPlainObject(rawCheck) || !CHECK_ID.test(rawCheck.checkId ?? '')) {
      errors.push(reason('verifier.invalid_check'))
      continue
    }
    if (seen.has(rawCheck.checkId)) {
      errors.push(reason('verifier.duplicate_check_id', rawCheck.checkId))
      continue
    }
    seen.add(rawCheck.checkId)
    rawById.set(rawCheck.checkId, rawCheck)
    const unknownCheckField = Object.keys(rawCheck).find((field) => !VERIFIER_CHECK_FIELDS.has(field))
    if (unknownCheckField) {
      errors.push(reason('verifier.unknown_check_field', `${rawCheck.checkId}:${unknownCheckField}`))
    }
    if (!VERIFIER_STATUSES.has(rawCheck.status)) {
      errors.push(reason('verifier.invalid_check_status', rawCheck.checkId))
    }
    if (!Array.isArray(rawCheck.evidence) || rawCheck.evidence.length === 0) {
      errors.push(reason('verifier.missing_check_evidence', rawCheck.checkId))
    } else {
      for (const evidence of rawCheck.evidence) {
        if (!isPlainObject(evidence)
            || Object.keys(evidence).some((field) => !VERIFIER_EVIDENCE_FIELDS.has(field))
            || !isStableLabel(evidence.code)
            || typeof evidence.summary !== 'string'
            || evidence.summary.trim() === ''
            || evidence.summary.length > 1_200) {
          errors.push(reason('verifier.invalid_check_evidence', rawCheck.checkId))
          break
        }
      }
    }
  }

  const expectedChecks = verificationCatalog
    .filter((check) => check.observationAuthority === 'verifier')
    .sort(compareCheckId)
  const expectedIds = expectedChecks.map((check) => check.checkId)
  const observedIds = [...rawById.keys()].sort()
  if (!arraysEqual(expectedIds, observedIds)) {
    errors.push(reason(
      'verifier.check_set_mismatch',
      `expected=${expectedIds.join(',')};observed=${observedIds.join(',')}`
    ))
  }

  for (const check of expectedChecks) {
    if (check.kind === 'hard' && rawById.get(check.checkId)?.status === 'not_applicable') {
      errors.push(reason('verifier.hard_check_not_applicable', check.checkId))
    }
    const status = rawById.get(check.checkId)?.status
    const prerequisiteStatuses = check.prerequisiteCheckIds
      .filter((checkId) => rawById.has(checkId))
      .map((checkId) => rawById.get(checkId).status)
    if (status === 'passed' && prerequisiteStatuses.some((value) => value !== 'passed')) {
      errors.push(reason('verifier.passed_with_unmet_prerequisite', check.checkId))
    }
    if (status === 'blocked'
        && prerequisiteStatuses.length > 0
        && prerequisiteStatuses.every((value) => value === 'passed')) {
      errors.push(reason('verifier.unjustified_blocked_check', check.checkId))
    }
  }
  if (errors.length > 0) return invalidVerifierObservation(process, uniqueReasons(errors))

  const checkResults = expectedChecks.map((check) => ({
    ...check,
    status: rawById.get(check.checkId).status,
    evidence: rawById.get(check.checkId).evidence.map((evidence) => ({ ...evidence }))
  }))
  return {
    validationState: 'valid',
    validationErrors: [],
    process: sanitizeVerifierProcess(process),
    checkResults
  }
}

export function buildRunnerCheckResults(verificationCatalog, observations) {
  return verificationCatalog
    .filter((check) => check.observationAuthority === 'runner')
    .sort(compareCheckId)
    .map((check) => {
      if (check.runnerCheck === 'public_check') {
        const observed = observations?.publicChecks?.find((item) => item.checkId === check.checkId)
        if (!observed || !['pass', 'fail'].includes(observed.observed)) {
          return {
            ...check,
            status: 'indeterminate',
            evidence: [{ code: 'runner.public_check_unavailable', summary: 'Public Check evidence is unavailable.' }]
          }
        }
        return {
          ...check,
          status: observed.observed === 'pass' ? 'passed' : 'failed',
          evidence: [{
            code: observed.observed === 'pass'
              ? 'runner.public_check_passed'
              : 'runner.public_check_failed',
            summary: `Public Check ${check.checkId} ${observed.observed === 'pass' ? 'passed' : 'failed'}.`
          }]
        }
      }
      if (check.runnerCheck !== 'change_boundary') {
        return {
          ...check,
          status: 'indeterminate',
          evidence: [{ code: 'runner.unsupported_check', summary: `Unsupported Runner Check ${check.runnerCheck}` }]
        }
      }
      const boundary = observations?.changeBoundary
      if (typeof boundary?.passed !== 'boolean' || !Array.isArray(boundary.violations)) {
        return {
          ...check,
          status: 'indeterminate',
          evidence: [{ code: 'runner.change_boundary_unavailable', summary: 'Change-boundary evidence is unavailable.' }]
        }
      }
      return {
        ...check,
        status: boundary.passed ? 'passed' : 'failed',
        evidence: [{
          code: boundary.passed ? 'runner.change_boundary_passed' : 'runner.change_boundary_failed',
          summary: boundary.passed
            ? 'Delivered workspace stayed within the disclosed change boundary.'
            : `Observed ${boundary.violations.length} change-boundary violation(s).`
        }]
      }
    })
}

export function deriveDeliveryEvidence(contract, verifierObservation, runnerCheckResults) {
  const evaluationIssues = [...(verifierObservation?.validationErrors ?? [])]
  const resultById = new Map()
  if (verifierObservation?.validationState === 'valid') {
    for (const result of verifierObservation.checkResults) addResult(resultById, result, evaluationIssues)
  } else if (evaluationIssues.length === 0) {
    evaluationIssues.push(reason('verifier.observation_unavailable'))
  }
  for (const result of runnerCheckResults ?? []) addResult(resultById, result, evaluationIssues)

  const expectedRunnerIds = contract.verificationCatalog
    .filter((check) => check.observationAuthority === 'runner')
    .map((check) => check.checkId)
    .sort()
  const observedRunnerIds = (runnerCheckResults ?? []).map((check) => check.checkId).sort()
  if (!arraysEqual(expectedRunnerIds, observedRunnerIds)) {
    evaluationIssues.push(reason(
      'runner.check_set_mismatch',
      `expected=${expectedRunnerIds.join(',')};observed=${observedRunnerIds.join(',')}`
    ))
  }

  const checkResults = contract.verificationCatalog.map((check) => {
    const result = resultById.get(check.checkId)
    if (!result) {
      evaluationIssues.push(reason('evaluation.missing_check_result', check.checkId))
      return { ...check, status: 'unavailable', evidence: [] }
    }
    if (!sameCheckIdentity(check, result)) {
      evaluationIssues.push(reason('evaluation.check_identity_mismatch', check.checkId))
      return { ...check, status: 'unavailable', evidence: [] }
    }
    if (check.kind === 'hard' && ['indeterminate', 'not_applicable', 'unavailable'].includes(result.status)) {
      evaluationIssues.push(reason('evaluation.hard_check_unavailable', check.checkId))
    }
    return {
      ...check,
      status: result.status,
      evidence: Array.isArray(result.evidence) ? result.evidence.map((item) => ({ ...item })) : []
    }
  })

  const combinedById = new Map(checkResults.map((check) => [check.checkId, check]))
  for (const check of checkResults) {
    const prerequisiteStatuses = check.prerequisiteCheckIds.map((checkId) => combinedById.get(checkId)?.status)
    if (check.status === 'passed' && prerequisiteStatuses.some((status) => status !== 'passed')) {
      evaluationIssues.push(reason('evaluation.passed_with_unmet_prerequisite', check.checkId))
    }
    if (check.status === 'blocked'
        && prerequisiteStatuses.length > 0
        && prerequisiteStatuses.every((status) => status === 'passed')) {
      evaluationIssues.push(reason('evaluation.unjustified_blocked_check', check.checkId))
    }
  }

  const uniqueIssues = uniqueReasons(evaluationIssues)
  const requirements = contract.requirements.map((requirement) => {
    const hardChecks = checkResults.filter((check) => (
      check.kind === 'hard' && check.requirementIds.includes(requirement.requirementId)
    ))
    const status = hardChecks.some((check) => isUnavailableStatus(check.status))
      ? 'unavailable'
      : hardChecks.some((check) => ['failed', 'blocked'].includes(check.status))
        ? 'failed'
        : 'passed'
    return {
      ...requirement,
      status,
      checkIds: hardChecks.map((check) => check.checkId)
    }
  })
  const categories = [...new Set(checkResults.map((check) => check.categoryId))].sort().map((categoryId) => {
    const checks = checkResults.filter((check) => check.categoryId === categoryId)
    const hardChecks = checks.filter((check) => check.kind === 'hard')
    let status
    if (hardChecks.some((check) => isUnavailableStatus(check.status))) status = 'unavailable'
    else if (hardChecks.some((check) => ['failed', 'blocked'].includes(check.status))) status = 'failed'
    else if (checks.some((check) => ['failed', 'blocked', 'indeterminate'].includes(check.status))) status = 'indeterminate'
    else status = 'passed'
    return { categoryId, status, checkIds: checks.map((check) => check.checkId) }
  })
  const failedRequirementIds = requirements
    .filter((requirement) => requirement.status === 'failed')
    .map((requirement) => requirement.requirementId)
  const counts = {
    passed: requirements.filter((requirement) => requirement.status === 'passed').length,
    failed: failedRequirementIds.length,
    unavailable: requirements.filter((requirement) => requirement.status === 'unavailable').length,
    total: requirements.length
  }
  const verifiedDelivery = uniqueIssues.length > 0
    ? 'unavailable'
    : failedRequirementIds.length > 0
      ? 'fail'
      : 'pass'
  return {
    verifiedDelivery,
    counts,
    requirements,
    categories,
    failedRequirementIds,
    checkResults,
    evaluationIssues: uniqueIssues
  }
}

export function buildDeliveryLayer({
  deliveryEvidence,
  workspaceDiff,
  changeBoundary,
  verifierObservation,
  convergence,
  humanIntervention,
  budgetEvent,
  postDispatchError,
  finalResponseReferences = []
}) {
  const failureFacts = []
  const addFailure = (stage, classification, detail = null) => {
    failureFacts.push({
      failureFactId: `FAIL-${String(failureFacts.length + 1).padStart(3, '0')}`,
      stage,
      classification,
      detail
    })
  }
  for (const requirementId of deliveryEvidence.failedRequirementIds) {
    addFailure('verification', 'requirement_failed', requirementId)
  }
  for (const violation of changeBoundary.violations) {
    addFailure('verification', 'change_boundary_violation', violation)
  }
  if (budgetEvent) addFailure('budget', 'execution_budget_exhausted', budgetEvent.reason)
  for (const [fact, state] of Object.entries(convergence.facts)) {
    if (['unsettled', 'exhausted', 'incomplete'].includes(state)) {
      addFailure('convergence', `${fact}_not_settled`, state)
    }
  }
  if (humanIntervention.status === 'present') {
    addFailure('human_intervention', 'post_dispatch_human_intervention')
  }
  if (verifierObservation.validationState !== 'valid') {
    addFailure('verification', 'verifier_observation_invalid', verifierObservation.validationErrors)
  }
  if (postDispatchError) addFailure('execution', 'runner_post_dispatch_error', postDispatchError.name)
  const primaryFailureStage = budgetEvent
    ? 'budget'
    : !workspaceDiff
      ? 'freeze_barrier'
      : verifierObservation.validationState !== 'valid'
        ? 'verification'
        : deliveryEvidence.verifiedDelivery === 'fail'
          ? 'verification'
          : convergence.status === 'fail'
            ? 'convergence'
            : humanIntervention.status === 'present'
              ? 'human_intervention'
              : null
  return {
    ...deliveryEvidence,
    primaryFailureStage,
    failureFacts,
    workspaceChangeSummary: summarizeWorkspaceDiff(workspaceDiff),
    finalResponseEvidence: finalResponseReferences,
    finalResponseAssessment: {
      status: 'indeterminate',
      reason: { code: 'final_response.semantic_review_not_run' }
    }
  }
}

export function summarizeWorkspaceDiff(diff) {
  if (!diff) {
    return {
      coverage: 'unavailable',
      created: null,
      modified: null,
      deleted: null,
      renamed: null,
      changedPaths: []
    }
  }
  const created = diff.changed.filter((change) => !change.before && change.after).length
  const deleted = diff.changed.filter((change) => change.before && !change.after).length
  const modified = diff.changed.length - created - deleted
  return {
    coverage: 'complete',
    created,
    modified,
    deleted,
    renamed: 0,
    changedPaths: diff.changed.map((change) => change.path)
  }
}

export function redactQualificationResult(result) {
  const hardOutcomeLayer = {
    validity: result.validity,
    evaluationState: result.evaluationState,
    dispatchAccepted: result.dispatchAccepted,
    verifiedDelivery: result.verifiedDelivery,
    orchestrationConvergence: result.orchestrationConvergence,
    postDispatchHumanIntervention: result.postDispatchHumanIntervention,
    overall: result.overall,
    convergenceFacts: result.hardLayer?.convergenceFacts ?? null
  }
  const deliveryEvidenceLayer = result.deliveryLayer ? {
    counts: result.deliveryLayer.counts,
    requirements: result.deliveryLayer.requirements,
    categories: result.deliveryLayer.categories.filter((category) => (
      result.deliveryLayer.requirements.some((requirement) => (
        requirement.categoryId === category.categoryId
      ))
    )),
    failedRequirementIds: result.deliveryLayer.failedRequirementIds,
    primaryFailureStage: result.deliveryLayer.primaryFailureStage,
    failureFacts: result.deliveryLayer.failureFacts.map(({ detail, ...fact }) => fact),
    workspaceChangeSummary: result.deliveryLayer.workspaceChangeSummary,
    finalResponseEvidence: result.deliveryLayer.finalResponseEvidence,
    finalResponseAssessment: result.deliveryLayer.finalResponseAssessment,
    evaluationIssues: result.deliveryLayer.evaluationIssues.map((issue) => ({ code: issue.code }))
  } : null
  const collaborationEvidenceLayer = result.collaborationEvidence ? {
    status: result.collaborationEvidence.status,
    members: result.collaborationEvidence.members,
    runCount: result.collaborationEvidence.runGraph?.length,
    observedDurableA2aEffects: result.collaborationEvidence.a2a?.length,
    metrics: result.collaborationEvidence.metrics,
    pollingViolationCount: result.collaborationEvidence.pollingViolations?.length ?? null,
    semanticAttribution: result.collaborationEvidence.semanticAttribution,
    audit: result.collaborationAudit ?? null
  } : {
    status: 'unavailable',
    reason: { code: 'collaboration_evidence.unavailable' },
    audit: result.collaborationAudit ?? null
  }
  const toolEvidenceLayer = result.toolEvidence ? {
    status: result.toolEvidence.status,
    coverage: result.toolEvidence.coverage ?? {
      state: 'unavailable',
      reason: result.toolEvidence.reason ?? { code: 'tool_ledger.unavailable' }
    },
    observed: result.toolEvidence.summary?.observed ?? null,
    authoritativeTotals: result.toolEvidence.summary?.authoritativeTotals ?? null,
    latencyCoverage: result.toolEvidence.summary?.latencyCoverage ?? null,
    mutationVerification: result.toolEvidence.summary?.mutationVerification ?? 'indeterminate',
    directToolFailureCausality: result.toolEvidence.summary?.directToolFailureCausality
      ?? 'indeterminate'
  } : {
    status: 'unavailable',
    coverage: {
      state: 'unavailable',
      reason: { code: 'tool_ledger.unavailable' }
    },
    observed: null,
    authoritativeTotals: null,
    latencyCoverage: null,
    mutationVerification: 'indeterminate',
    directToolFailureCausality: 'indeterminate'
  }
  const semanticReviewSource = result.semanticEngineeringReview
  const semanticReviewLayer = semanticReviewSource ? {
    status: semanticReviewSource.status,
    artifactId: semanticReviewSource.artifactId ?? null,
    schemaVersion: semanticReviewSource.schemaVersion ?? null,
    payloadDigest: semanticReviewSource.payloadDigest ?? null,
    reason: semanticReviewSource.reason?.code
      ? { code: semanticReviewSource.reason.code }
      : null,
    items: (semanticReviewSource.items ?? []).map((item) => ({
      checklistItem: item.checklistItem,
      state: item.state,
      verdict: item.verdict ?? null,
      replicaVerdicts: item.replicaVerdicts,
      evidenceReferences: item.evidenceReferences ?? [],
      reason: item.reason
    })),
    views: (semanticReviewSource.views ?? []).map((view) => ({
      view: view.view,
      state: view.state,
      items: (view.items ?? []).map((item) => ({
        checklistItem: item.checklistItem,
        state: item.state,
        verdict: item.verdict ?? null,
        replicaVerdicts: item.replicaVerdicts,
        evidenceReferences: item.evidenceReferences ?? [],
        reason: item.reason
      }))
    }))
  } : {
    status: 'unavailable',
    artifactId: null,
    schemaVersion: null,
    payloadDigest: null,
    reason: { code: 'semantic_judge.not_invoked' },
    items: [],
    views: []
  }
  const isolationProfile = result.isolationProfile ? {
    status: result.isolationProfile.status,
    schemaVersion: result.isolationProfile.schemaVersion ?? null,
    profileVersion: result.isolationProfile.profileVersion ?? null,
    executionIsolation: result.isolationProfile.executionIsolation ?? null,
    overallCoverage: sanitizeCoverage(result.isolationProfile.overallCoverage),
    formalAdmissible: result.isolationProfile.formalAdmissible ?? null,
    reason: result.isolationProfile.reason?.code
      ? { code: result.isolationProfile.reason.code }
      : null
  } : {
    status: 'unavailable',
    schemaVersion: null,
    profileVersion: null,
    executionIsolation: null,
    overallCoverage: null,
    formalAdmissible: null,
    reason: { code: 'intervention_isolation.profile_unavailable' }
  }
  const isolationContinuity = result.interventionIsolationContinuity ? {
    state: result.interventionIsolationContinuity.state,
    reason: result.interventionIsolationContinuity.reason?.code
      ? { code: result.interventionIsolationContinuity.reason.code }
      : null
  } : {
    state: 'unavailable',
    reason: { code: 'intervention_isolation.continuity_unavailable' }
  }
  const humanInterventionEvidence = result.humanInterventionEvidence ? {
    status: result.humanInterventionEvidence.status,
    coverage: result.humanInterventionEvidence.coverage,
    evidenceCodes: [...new Set((result.humanInterventionEvidence.evidence ?? [])
      .map((item) => item.code)
      .filter((code) => typeof code === 'string'))].sort(),
    reason: result.humanInterventionEvidence.reason?.code
      ? { code: result.humanInterventionEvidence.reason.code }
      : null
  } : {
    status: 'indeterminate',
    coverage: 'unavailable',
    evidenceCodes: [],
    reason: { code: 'human_intervention.evidence_unavailable' }
  }
  const evidenceIndex = result.evidenceIndex ? {
    artifactId: result.evidenceIndex.artifactId,
    schemaId: result.evidenceIndex.schemaId,
    schemaVersion: result.evidenceIndex.schemaVersion,
    payloadDigest: result.evidenceIndex.payloadDigest,
    recordCount: result.evidenceIndex.recordCount,
    sourceBoundaries: (result.evidenceIndex.sourceBoundaries ?? []).map((boundary) => ({
      authorityClass: boundary.authorityClass,
      sourceId: boundary.sourceId,
      coverage: sanitizeCoverage(boundary.coverage)
    }))
  } : null
  const collaborationLedger = result.collaborationLedger ? {
    artifactId: result.collaborationLedger.artifactId,
    schemaId: result.collaborationLedger.schemaId,
    schemaVersion: result.collaborationLedger.schemaVersion,
    payloadDigest: result.collaborationLedger.payloadDigest,
    callCount: result.collaborationLedger.callCount,
    routeFactCount: result.collaborationLedger.routeFactCount,
    metrics: result.collaborationLedger.metrics
  } : null
  const toolCallLedger = result.toolCallLedger ? {
    artifactId: result.toolCallLedger.artifactId,
    schemaId: result.toolCallLedger.schemaId,
    schemaVersion: result.toolCallLedger.schemaVersion,
    payloadDigest: result.toolCallLedger.payloadDigest,
    recordCount: result.toolCallLedger.recordCount,
    summary: result.toolCallLedger.summary
  } : null
  const workspaceMutationLedger = result.workspaceMutationLedger ? {
    artifactId: result.workspaceMutationLedger.artifactId,
    schemaId: result.workspaceMutationLedger.schemaId,
    schemaVersion: result.workspaceMutationLedger.schemaVersion,
    payloadDigest: result.workspaceMutationLedger.payloadDigest,
    recordCount: result.workspaceMutationLedger.recordCount,
    overlapFactCount: result.workspaceMutationLedger.overlapFactCount,
    coverage: sanitizeCoverage(result.workspaceMutationLedger.coverage),
    verification: result.workspaceMutationLedger.verification
  } : null
  return {
    schemaVersion: QUALIFICATION_TRIAL_SCHEMA_VERSION,
    runnerVersion: result.runnerVersion,
    trialId: result.trialId,
    suiteId: result.suiteId ?? null,
    plannedSlotId: result.plannedSlotId,
    mode: result.mode,
    case: result.case ? { id: result.case.id, version: result.case.version, seal: result.case.seal } : null,
    validity: result.validity,
    evaluationState: result.evaluationState,
    dispatchAccepted: result.dispatchAccepted,
    verifiedDelivery: result.verifiedDelivery,
    orchestrationConvergence: result.orchestrationConvergence,
    postDispatchHumanIntervention: result.postDispatchHumanIntervention,
    overall: result.overall,
    hardOutcome: result.hardOutcome,
    invalidReason: result.invalidationReason
      ? { code: result.invalidationReason.code }
      : result.preDispatchError
        ? { code: result.preDispatchError.code
            ? safeErrorCode(result.preDispatchError.code)
            : `preflight.${safeErrorCode(result.preDispatchError.name)}` }
        : null,
    convergenceFacts: hardOutcomeLayer.convergenceFacts,
    delivery: deliveryEvidenceLayer,
    budget: result.budget ? {
      contract: result.budget.contract,
      triggered: result.budget.event?.reason ?? null,
      observedAgentRuns: result.budget.observedAgentRuns,
      observedAcceptedA2a: result.budget.observedAcceptedA2a,
      observedDurableA2aEffects: result.budget.observedDurableA2aEffects,
      acceptedA2aAuthority: result.budget.acceptedA2aAuthority
    } : null,
    collaboration: collaborationEvidenceLayer,
    collaborationAudit: result.collaborationAudit ?? null,
    toolEvidence: toolEvidenceLayer,
    semanticEngineeringReview: semanticReviewLayer,
    layers: {
      hardOutcome: hardOutcomeLayer,
      deliveryEvidence: deliveryEvidenceLayer,
      collaborationEvidence: collaborationEvidenceLayer,
      toolEvidence: toolEvidenceLayer,
      semanticEngineeringReview: semanticReviewLayer
    },
    environmentManifestDigest: result.environmentManifestDigest,
    resultRevision: result.resultRevision ?? null,
    ambientMcpIsolation: result.ambientMcpIsolation ?? 'unavailable',
    isolationProfile,
    interventionIsolationContinuity: isolationContinuity,
    humanInterventionEvidence,
    evidenceIndex,
    collaborationLedger,
    toolCallLedger,
    workspaceMutationLedger,
    limitations: [
      semanticReviewLayer.status === 'unavailable'
        ? 'Semantic Review is unavailable; no composite score is used.'
        : 'Semantic Review is advisory and cannot change Hard Outcome; no composite score is used.',
      'Withheld verifier details and private case locators are not exported.',
      'Isolation policy digests, execution identities, and raw intervention evidence IDs are not exported.'
    ]
  }
}

function sanitizeCoverage(coverage) {
  if (!coverage || typeof coverage.state !== 'string') return null
  return {
    state: coverage.state,
    reason: coverage.reason?.code ? { code: coverage.reason.code } : null
  }
}

export function deriveHumanInterventionEvidence(snapshot, dispatchBoundary, context) {
  const normalizedContext = typeof context === 'string' ? { mode: context } : (context ?? {})
  if (!snapshot || !dispatchBoundary) {
    return {
      status: 'indeterminate',
      evidence: [],
      coverage: 'unavailable',
      reason: { code: 'human_intervention.observation_unavailable' }
    }
  }
  const userMessages = snapshot.messages.filter((message) => message.authorType === 'user')
  const expectedRootMessage = typeof dispatchBoundary.rootCampMessageId === 'string'
    ? userMessages.find((message) => message.id === dispatchBoundary.rootCampMessageId)
    : null
  const additionalUserMessages = expectedRootMessage
    ? userMessages.filter((message) => message.id !== expectedRootMessage.id)
    : userMessages.length === 1 && ['demo', 'diagnostic'].includes(normalizedContext.mode)
      ? []
      : userMessages
  const userResolvedApprovals = snapshot.approvals.filter((approval) => (
    approval.resolvedByType === 'user'
  ))
  const unattributedResolvedApprovals = snapshot.approvals.filter((approval) => (
    ['approved', 'denied', 'cancelled', 'expired'].includes(approval.status)
    && approval.resolvedByType !== 'user'
    && approval.resolvedByType !== 'system'
  ))
  const unexpectedUserEvents = postDispatchUserEvents(snapshot, dispatchBoundary)
  const evidence = []
  if (additionalUserMessages.length > 0) {
    evidence.push({
      code: 'human_intervention.additional_user_message',
      messageIds: additionalUserMessages.map((message) => message.id).sort()
    })
  }
  if (userResolvedApprovals.length > 0) {
    evidence.push({
      code: 'human_intervention.approval_resolution',
      approvalIds: userResolvedApprovals.map((approval) => approval.id).sort()
    })
  }
  if (unexpectedUserEvents.length > 0) {
    evidence.push({
      code: 'human_intervention.core_control',
      eventIds: unexpectedUserEvents.map((event) => event.eventId).filter(Boolean).sort()
    })
  }
  if (evidence.length > 0) {
    return { status: 'present', evidence, coverage: 'observable_core_channels', reason: null }
  }
  const missingRootIdentity = normalizedContext.mode === 'formal'
    && (!dispatchBoundary.rootCampMessageId || !expectedRootMessage)
  const missingEventBoundary = normalizedContext.mode === 'formal'
    && (!Number.isSafeInteger(dispatchBoundary.preDispatchThroughGlobalSequence)
      || !Array.isArray(dispatchBoundary.rootAgentRunIds))
  if (unattributedResolvedApprovals.length > 0 || missingRootIdentity || missingEventBoundary) {
    return {
      status: 'indeterminate',
      evidence: [],
      coverage: 'partial',
      reason: { code: 'human_intervention.core_control_attribution_incomplete' }
    }
  }
  if (normalizedContext.mode === 'formal') {
    if (normalizedContext.isolationProfileAdmission?.status !== 'admitted') {
      return {
        status: 'indeterminate',
        evidence: [],
        coverage: 'unavailable',
        reason: { code: 'human_intervention.formal_isolation_profile_unavailable' }
      }
    }
    if (normalizedContext.continuityCoverage !== 'complete') {
      return {
        status: 'indeterminate',
        evidence: [],
        coverage: 'partial',
        reason: { code: 'human_intervention.isolation_continuity_unavailable' }
      }
    }
    return {
      status: 'absent',
      evidence: [],
      coverage: 'formal_isolation_complete',
      reason: null
    }
  }
  return {
    status: 'absent',
    evidence: [],
    coverage: normalizedContext.mode === 'diagnostic'
      ? 'diagnostic_shared_host'
      : 'public_demo',
    reason: null
  }
}

function postDispatchUserEvents(snapshot, dispatchBoundary) {
  if (!Number.isSafeInteger(dispatchBoundary.preDispatchThroughGlobalSequence)) return []
  const rootRunIds = new Set(dispatchBoundary.rootAgentRunIds ?? [])
  return (snapshot.timeline ?? []).filter((event) => {
    if (event.globalSequence <= dispatchBoundary.preDispatchThroughGlobalSequence
        || event.actorType !== 'user') return false
    if (event.eventType === 'camp_message.sent'
        && event.entityId === dispatchBoundary.rootCampMessageId) return false
    if (event.eventType === 'agent_run.queued' && rootRunIds.has(event.entityId)) return false
    if (event.eventType === 'command.result'
        && event.entityId === dispatchBoundary.campTurnId) return false
    return true
  })
}

export function deriveConvergenceEvidence({
  snapshot,
  dispatchBoundary,
  budgetEvent,
  termination,
  isolation = null
}) {
  const indeterminateFacts = {
    runTree: 'indeterminate',
    conversationInputs: 'indeterminate',
    approvals: 'indeterminate',
    budget: budgetEvent ? 'exhausted' : 'indeterminate',
    runtimeExit: termination ? (termination.converged ? 'complete' : 'incomplete') : 'indeterminate',
    externalEffects: 'indeterminate'
  }
  if (!snapshot || !dispatchBoundary) {
    return { status: 'unavailable', facts: indeterminateFacts, failureRecoveryFacts: [] }
  }
  const turn = snapshot.turns.find((candidate) => candidate.id === dispatchBoundary.campTurnId)
  const runs = snapshot.agentRuns.filter((run) => run.campTurnId === dispatchBoundary.campTurnId)
  const currentPublicA2a = isCurrentPublicA2aSnapshot(snapshot)
  const inputs = Array.isArray(snapshot.conversationInputs)
    ? snapshot.conversationInputs.filter((input) => input.campTurnId === dispatchBoundary.campTurnId)
    : []
  const deliveries = Array.isArray(snapshot.messageDeliveries)
    ? snapshot.messageDeliveries.filter((delivery) => delivery.campTurnId === dispatchBoundary.campTurnId)
    : []
  const conversationInputFact = currentPublicA2a
    ? deriveCurrentMessageDeliverySettlement(snapshot, turn, deliveries)
    : !Array.isArray(snapshot.conversationInputs)
      ? 'indeterminate'
      : inputs.every((input) => ['materialized', 'failed', 'cancelled'].includes(input.status))
        ? 'settled'
        : inputs.some((input) => input.status === 'pending')
          ? 'unsettled'
          : 'indeterminate'
  const facts = {
    runTree: turn
      && isTurnTerminal(turn.status)
      && runs.some((run) => run.id === dispatchBoundary.rootAgentRunId)
      && runs.every((run) => isRunTerminal(run.status))
      ? 'settled'
      : 'unsettled',
    conversationInputs: conversationInputFact,
    approvals: snapshot.approvals.some((approval) => approval.status === 'pending')
      ? 'unsettled'
      : 'settled',
    budget: budgetEvent ? 'exhausted' : 'compliant',
    runtimeExit: termination ? (termination.converged ? 'complete' : 'incomplete') : 'indeterminate',
    externalEffects: deriveExternalEffectSettlement(runs, isolation)
  }
  const failureRecoveryFacts = runs
    .filter((run) => ['failed', 'cancelled'].includes(run.status))
    .map((run) => ({
      agentRunId: run.id,
      terminalStatus: run.status,
      responsibilitySettled: facts.runTree === 'settled'
    }))
  const values = Object.values(facts)
  const hasIndeterminate = values.some((value) => value === 'indeterminate')
  const hasFailure = values.some((value) => (
    ['unsettled', 'exhausted', 'incomplete'].includes(value)
  ))
  return {
    status: hasIndeterminate ? 'unavailable' : hasFailure ? 'fail' : 'pass',
    facts,
    failureRecoveryFacts
  }
}

function deriveExternalEffectSettlement(runs, isolation) {
  if (runs.some((run) => run.hasUnsettledExternalEffects === true)) return 'unsettled'
  if (isolation?.mode === 'formal') {
    if (isolation.profileAdmission?.status !== 'admitted'
        || isolation.continuityCoverage !== 'complete') return 'indeterminate'
    const channels = isolation.profileAdmission.channels
    if (!channels) return 'indeterminate'
    const mutationChannels = [
      channels.networkMutation,
      channels.gitRemoteMutation,
      channels.externalMcpMutation
    ]
    if (mutationChannels.every((channel) => channel?.state === 'disabled')) return 'settled'
    return 'indeterminate'
  }
  return runs.every((run) => typeof run.hasUnsettledExternalEffects === 'boolean')
    ? 'settled'
    : 'indeterminate'
}

export function observedDurableMemberCallEffects(snapshot, campTurnId) {
  if (!snapshot || !campTurnId) return []
  const runIds = new Set(snapshot.agentRuns
    .filter((run) => run.campTurnId === campTurnId)
    .map((run) => run.id))
  if (isCurrentPublicA2aSnapshot(snapshot)) {
    const seen = new Set()
    return (Array.isArray(snapshot.messageDeliveries) ? snapshot.messageDeliveries : []).filter((delivery) => {
      if (delivery.campTurnId !== campTurnId || seen.has(delivery.id)) return false
      seen.add(delivery.id)
      return true
    })
  }
  const seen = new Set()
  return (Array.isArray(snapshot.inboxMessages) ? snapshot.inboxMessages : []).filter((message) => {
    if (!runIds.has(message.sourceAgentRunId) || seen.has(message.id)) return false
    seen.add(message.id)
    return true
  })
}

function isCurrentPublicA2aSnapshot(snapshot) {
  return Number.isInteger(snapshot?.schemaVersion) && snapshot.schemaVersion >= 28
}

function deriveCurrentMessageDeliverySettlement(snapshot, turn, deliveries) {
  if (!Array.isArray(snapshot.messageDeliveries)) return 'indeterminate'
  const expected = turn?.executionBudget?.acceptedA2a
  if (!Number.isInteger(expected) || expected < 0 || expected !== deliveries.length) {
    return 'indeterminate'
  }
  if (deliveries.some((delivery) => ['pending', 'running'].includes(delivery.status))) {
    return 'unsettled'
  }
  if (deliveries.every((delivery) => (
    ['settled', 'failed', 'cancelled', 'interrupted_before_dispatch'].includes(delivery.status)
  ))) {
    return 'settled'
  }
  return 'indeterminate'
}

export async function collectCampEventPages(request, campId, state) {
  while (true) {
    const page = await request('events.subscribe', {
      campId,
      afterGlobalSequence: state.afterGlobalSequence,
      limit: 2_000
    }, 60_000)
    if (page.resetRequired) {
      return { complete: false, reason: 'event_coverage.reset_required' }
    }
    for (const event of page.events ?? []) {
      const eventIdentity = event.eventId ?? `global-sequence:${event.globalSequence}`
      if (!state.eventIds.has(eventIdentity)) {
        state.eventIds.add(eventIdentity)
        state.events.push(event)
      }
    }
    state.events.sort((left, right) => left.globalSequence - right.globalSequence)
    if (!page.hasMore) {
      state.afterGlobalSequence = page.throughGlobalSequence
      return { complete: true, reason: null }
    }
    if (!Number.isInteger(page.nextGlobalSequence)
        || page.nextGlobalSequence <= state.afterGlobalSequence) {
      return { complete: false, reason: 'event_coverage.cursor_stalled' }
    }
    state.afterGlobalSequence = page.nextGlobalSequence
  }
}

export function inspectFrozenExecutionBudget(value, contract) {
  const issues = []
  const addIssue = (code, detail) => issues.push({ code, detail })
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    addIssue('execution_budget.frozen_contract_missing', 'dispatch result omitted the frozen Core budget')
    return { budget: null, issues }
  }
  const budget = {
    schemaVersion: value.schemaVersion,
    acceptedAt: value.acceptedAt,
    deadlineAt: value.deadlineAt,
    elapsedSeconds: value.elapsedSeconds,
    maxAgentRunResponsibilities: value.maxAgentRunResponsibilities,
    maxAcceptedA2a: value.maxAcceptedA2a,
    rootAgentRunResponsibilities: value.rootAgentRunResponsibilities
  }
  const acceptedAtMs = Date.parse(budget.acceptedAt)
  const deadlineAtMs = Date.parse(budget.deadlineAt)
  if (budget.schemaVersion !== 1
      || !Number.isFinite(acceptedAtMs)
      || !Number.isFinite(deadlineAtMs)
      || !Number.isInteger(budget.elapsedSeconds)
      || !Number.isInteger(budget.maxAgentRunResponsibilities)
      || !Number.isInteger(budget.maxAcceptedA2a)
      || !Number.isInteger(budget.rootAgentRunResponsibilities)) {
    addIssue('execution_budget.frozen_contract_invalid', 'dispatch result contains an invalid frozen Core budget')
  }
  if (Number.isFinite(acceptedAtMs)
      && Number.isFinite(deadlineAtMs)
      && deadlineAtMs - acceptedAtMs !== budget.elapsedSeconds * 1000) {
    addIssue('execution_budget.deadline_derivation_mismatch', 'Core deadline does not equal acceptedAt plus elapsedSeconds')
  }
  if (budget.elapsedSeconds !== contract.elapsedSeconds
      || budget.maxAgentRunResponsibilities !== contract.maxAgentRuns
      || budget.maxAcceptedA2a !== contract.maxAcceptedA2a) {
    addIssue('execution_budget.case_projection_mismatch', 'Core effective budget differs from the sealed Case budget')
  }
  if (budget.rootAgentRunResponsibilities !== 1) {
    addIssue('execution_budget.root_responsibility_mismatch', 'Qualification dispatch did not freeze exactly one root responsibility')
  }
  return { budget, issues }
}

export function deriveHardOutcome({
  dispatchAccepted,
  validity,
  verifiedDelivery,
  orchestrationConvergence,
  postDispatchHumanIntervention,
  evaluationIssues = []
}) {
  if (typeof dispatchAccepted !== 'boolean') throw new Error('Dispatch acceptance state is invalid')
  assertEnum(validity, ['valid', 'invalid'], 'Trial validity')
  if (validity === 'valid' && !dispatchAccepted) {
    throw new Error('A valid Trial must have an accepted dispatch')
  }
  if (!dispatchAccepted || validity === 'invalid') {
    return {
      validity: 'invalid',
      evaluationState: 'pending',
      verifiedDelivery: 'unavailable',
      orchestrationConvergence: 'unavailable',
      postDispatchHumanIntervention: 'indeterminate',
      hardOutcome: 'unavailable',
      overall: 'unavailable'
    }
  }
  assertEnum(verifiedDelivery, ['pass', 'fail', 'unavailable'], 'Verified Delivery')
  assertEnum(orchestrationConvergence, ['pass', 'fail', 'unavailable'], 'Orchestration Convergence')
  assertEnum(postDispatchHumanIntervention, ['absent', 'present', 'indeterminate'], 'Post-Dispatch Human Intervention')
  const pending = evaluationIssues.length > 0
    || verifiedDelivery === 'unavailable'
    || orchestrationConvergence === 'unavailable'
    || postDispatchHumanIntervention === 'indeterminate'
  if (pending) {
    return {
      validity: 'valid',
      evaluationState: 'pending',
      verifiedDelivery,
      orchestrationConvergence,
      postDispatchHumanIntervention,
      hardOutcome: 'unavailable',
      overall: 'unavailable'
    }
  }
  const hardOutcome = verifiedDelivery === 'pass'
    && orchestrationConvergence === 'pass'
    && postDispatchHumanIntervention === 'absent'
    ? 'pass'
    : 'fail'
  return {
    validity: 'valid',
    evaluationState: 'complete',
    verifiedDelivery,
    orchestrationConvergence,
    postDispatchHumanIntervention,
    hardOutcome,
    overall: hardOutcome
  }
}

export function buildSuiteProgress(plannedSlotIds, outcomes) {
  if (!Array.isArray(plannedSlotIds)
      || plannedSlotIds.length === 0
      || plannedSlotIds.some((slotId) => !isStableLabel(slotId))
      || new Set(plannedSlotIds).size !== plannedSlotIds.length) {
    throw new Error('Qualification Suite planned slots are invalid')
  }
  if (!Array.isArray(outcomes)) throw new Error('Qualification Suite outcomes must be an array')
  const planned = new Set(plannedSlotIds)
  const bySlot = new Map()
  for (const outcome of outcomes) {
    if (!planned.has(outcome?.plannedSlotId)) {
      throw new Error(`Qualification Suite outcome references unknown slot ${outcome?.plannedSlotId}`)
    }
    if (bySlot.has(outcome.plannedSlotId)) {
      throw new Error(`Qualification Suite contains duplicate outcome for ${outcome.plannedSlotId}`)
    }
    if (typeof outcome.dispatchAccepted !== 'boolean'
        || !['valid', 'invalid'].includes(outcome.validity)
        || !['pending', 'complete'].includes(outcome.evaluationState)
        || !['unavailable', 'pass', 'fail'].includes(outcome.hardOutcome)) {
      throw new Error(`Qualification Suite outcome fields are invalid for ${outcome.plannedSlotId}`)
    }
    if (outcome.validity === 'invalid'
        && (outcome.evaluationState !== 'pending' || outcome.hardOutcome !== 'unavailable')) {
      throw new Error(`Qualification Suite invalid outcome is inconsistent for ${outcome.plannedSlotId}`)
    }
    if (outcome.validity === 'valid' && !outcome.dispatchAccepted) {
      throw new Error(`Qualification Suite valid outcome has no accepted dispatch for ${outcome.plannedSlotId}`)
    }
    if (outcome.validity === 'valid'
        && ((outcome.evaluationState === 'pending') !== (outcome.hardOutcome === 'unavailable'))) {
      throw new Error(`Qualification Suite valid outcome is inconsistent for ${outcome.plannedSlotId}`)
    }
    bySlot.set(outcome.plannedSlotId, outcome)
  }
  const plannedSlots = plannedSlotIds.map((plannedSlotId) => {
    const outcome = bySlot.get(plannedSlotId)
    if (!outcome) return { plannedSlotId, state: 'not_started', hardOutcome: null }
    if (outcome.validity === 'invalid') {
      return {
        plannedSlotId,
        state: outcome.dispatchAccepted ? 'invalid_post_dispatch' : 'invalid_pre_dispatch',
        hardOutcome: null
      }
    }
    if (outcome.evaluationState === 'pending' || outcome.hardOutcome === 'unavailable') {
      return { plannedSlotId, state: 'pending', hardOutcome: null }
    }
    if (outcome.evaluationState !== 'complete' || !['pass', 'fail'].includes(outcome.hardOutcome)) {
      throw new Error(`Qualification Suite outcome is inconsistent for ${plannedSlotId}`)
    }
    return {
      plannedSlotId,
      state: outcome.hardOutcome === 'pass' ? 'scorable_pass' : 'scorable_fail',
      hardOutcome: outcome.hardOutcome
    }
  })
  const counts = {
    planned: plannedSlots.length,
    notStarted: plannedSlots.filter((slot) => slot.state === 'not_started').length,
    pending: plannedSlots.filter((slot) => slot.state === 'pending').length,
    invalid: plannedSlots.filter((slot) => slot.state.startsWith('invalid_')).length,
    scorable: plannedSlots.filter((slot) => slot.state.startsWith('scorable_')).length,
    passes: plannedSlots.filter((slot) => slot.state === 'scorable_pass').length,
    fails: plannedSlots.filter((slot) => slot.state === 'scorable_fail').length
  }
  const hasPostDispatchInvalid = plannedSlots.some((slot) => slot.state === 'invalid_post_dispatch')
  const publicationState = hasPostDispatchInvalid
    ? 'unpublishable'
    : counts.scorable === counts.planned
      ? 'complete'
      : 'in_progress'
  return {
    plannedSlots,
    counts,
    publicationState,
    finalPassRate: publicationState === 'complete' ? counts.passes / counts.planned : null,
    unpublishableReason: publicationState === 'unpublishable'
      ? reason('suite.accepted_execution_invalid')
      : null
  }
}

function invalidVerifierObservation(process, errors) {
  return {
    validationState: 'invalid',
    validationErrors: uniqueReasons(errors),
    process: sanitizeVerifierProcess(process),
    checkResults: []
  }
}

function assertAcyclicCatalog(catalog) {
  const byId = new Map(catalog.map((check) => [check.checkId, check]))
  const visiting = new Set()
  const visited = new Set()
  const visit = (checkId) => {
    if (visiting.has(checkId)) throw new Error(`qualification Verification Catalog contains a prerequisite cycle at ${checkId}`)
    if (visited.has(checkId)) return
    visiting.add(checkId)
    for (const prerequisiteId of byId.get(checkId).prerequisiteCheckIds) visit(prerequisiteId)
    visiting.delete(checkId)
    visited.add(checkId)
  }
  for (const check of catalog) visit(check.checkId)
}

function sanitizeVerifierProcess(process) {
  return {
    code: Number.isInteger(process?.code) ? process.code : null,
    signal: typeof process?.signal === 'string' ? process.signal : null,
    timedOut: process?.timedOut === true,
    stdoutDigest: typeof process?.stdoutDigest === 'string' ? process.stdoutDigest : null,
    stderrDigest: typeof process?.stderrDigest === 'string' ? process.stderrDigest : null
  }
}

function addResult(resultById, result, issues) {
  if (!result || typeof result.checkId !== 'string') {
    issues.push(reason('evaluation.invalid_check_result'))
    return
  }
  if (resultById.has(result.checkId)) {
    issues.push(reason('evaluation.duplicate_check_result', result.checkId))
    return
  }
  resultById.set(result.checkId, result)
}

function sameCheckIdentity(expected, observed) {
  return expected.checkId === observed.checkId
    && expected.kind === observed.kind
    && expected.observationAuthority === observed.observationAuthority
    && expected.runnerCheck === observed.runnerCheck
    && expected.categoryId === observed.categoryId
    && expected.disclosure === observed.disclosure
    && arraysEqual(expected.requirementIds, observed.requirementIds)
    && arraysEqual(expected.prerequisiteCheckIds, observed.prerequisiteCheckIds)
}

function isUnavailableStatus(status) {
  return ['unavailable', 'indeterminate', 'not_applicable'].includes(status)
}

function uniqueReasons(reasons) {
  const seen = new Set()
  return reasons.filter((item) => {
    const key = `${item.code}:${item.detail ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function reason(code, detail = undefined) {
  return detail === undefined ? { code } : { code, detail: String(detail).slice(0, 1_200) }
}

function compareCheckId(left, right) {
  return left.checkId.localeCompare(right.checkId)
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isStableLabel(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    && value.length <= 160
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeErrorCode(value) {
  return String(value ?? 'error').replace(/[^A-Za-z0-9._-]/g, '_').toLowerCase()
}

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} is invalid: ${value}`)
}

function isRunTerminal(status) {
  return ['succeeded', 'failed', 'cancelled'].includes(status)
}

function isTurnTerminal(status) {
  return ['completed', 'failed', 'cancelled'].includes(status)
}
