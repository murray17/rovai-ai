// This opt-in profile changes evaluation evidence, never the product's context.
// Legacy Judge Views keep their original prompt and projection when absent.
export const TASK_JUDGE_PROFILE = 'generic-task-v2'
export const RECEIPT_TASK_JUDGE_PROFILE = 'generic-task-v4'
export const usesTaskEvidence = profile => [EVIDENCE_TASK_JUDGE_PROFILE, RECEIPT_TASK_JUDGE_PROFILE].includes(profile)
export const EVIDENCE_TASK_JUDGE_PROFILE = 'generic-task-v3'
export const TASK_OUTCOME_RUBRIC = Object.freeze({
  'SER.requirements.understanding': 'Assess the delivered goals and subgoals specified in case.acceptance. Method requirements such as delegation, history retrieval and tool use are checked separately; do not infer their execution from the final output. A prescribed escalation or honest blocked result can fulfill a task; refusing a normally achievable task cannot.',
  'SER.design.solution_fit': 'Assess whether the chosen approach and output structure fit this task and its constraints. Do not require a software design for a non-code task.',
  'SER.implementation.quality': 'Assess the actual delivered artifact against this Case: implementation for code, facts/fields/sections/conclusions for analysis and reports. The historical checklist ID does not require code.',
  'SER.testing.strategy': 'Assess the verification appropriate to this Case using supplied facts. Non-code work does not require code or a test suite. Missing evaluator evidence is indeterminate; honest task uncertainty is not itself a failure.',
  'SER.scope.discipline': 'Assess instruction and information applicability in the delivered content only. Do not infer unseen tool, permission, network, or memory behavior; those boundaries have separate rule checks.',
  'SER.response.claim_accuracy': 'Compare final claims with the actual delivered artifacts and supplied verification facts. Self-consistent prose alone is not corroboration.',
  'SER.response.limitations': 'Assess honest disclosure of material limitations and uncertainty supported by supplied evidence. Never invent missing limitations.'
})
export const TASK_PROCESS_IDS = Object.freeze(['delegation', 'handoff_clarity', 'contribution_value', 'feedback_absorption', 'lead_integration'].map(id => `SER.collaboration.${id}`))
export const TASK_OUTCOME_IDS = Object.freeze(Object.keys(TASK_OUTCOME_RUBRIC))

// Frozen separately: old reports continue to replay with their original rubric.
export const EVIDENCE_OUTCOME_RUBRIC = Object.freeze({
  ...TASK_OUTCOME_RUBRIC,
  'SER.requirements.understanding': `${TASK_OUTCOME_RUBRIC['SER.requirements.understanding']} Understanding or describing a required repair does not fulfill it. Judge achieved outcomes, not stated intentions.`,
  'SER.testing.strategy': `${TASK_OUTCOME_RUBRIC['SER.testing.strategy']} Separate evaluator verification from agent-reported verification. A passing verifier proves the checked artifact behavior, not that the agent ran the claimed command.`,
  'SER.response.claim_accuracy': 'Check each material completion, factual and verification claim against the supplied evidence. Satisfied: all material claims are supported. Partially satisfied: an evidenced, noncritical discrepancy exists. Not satisfied: an evidenced material false completion or verification claim exists. Indeterminate: a material claim cannot be checked because its source or execution record is missing. Missing corroboration alone is never a discrepancy and must not be converted into a half score. An explicitly completed review is not a claim that repairs are complete; missing repairs are assessed under goal attainment. Do not use final-response prose to corroborate itself.',
  'SER.response.limitations': `${TASK_OUTCOME_RUBRIC['SER.response.limitations']} Do not require the agent to disclose gaps created only by the evaluator export. Do not demand generic caveats when the task is bounded and the supplied evidence shows no material limitation.`
})
export const EVIDENCE_PROCESS_RUBRIC = Object.freeze({
  delegation: 'Assess necessity and suitable division of work for the disclosed task; more calls never imply quality.',
  handoff_clarity: 'Assess whether goals, constraints, available evidence and expected result are sufficiently communicated, without requiring a fixed template.',
  contribution_value: 'Assess actual task-relevant member contributions. Missing member content is indeterminate; an observed empty or irrelevant response is not satisfied.',
  feedback_absorption: 'Compare concrete member feedback with later delivery: resolved findings or an explained, justified rejection support absorption. Unresolved required feedback supports failure. Use observable content and reply relations, not claims about internal causality. Do not require a ceremonial acknowledgement.',
  lead_integration: 'Assess whether available contributions are selected and reconciled into a coherent final delivery. Compare their concrete substance and the delivered result; do not demand proof of the model internal causal process or a courtesy callback. Missing contributions or final delivery evidence is indeterminate.'
})

export const RECEIPT_OUTCOME_RUBRIC = Object.freeze({
  ...EVIDENCE_OUTCOME_RUBRIC,
  'SER.response.claim_accuracy': `${EVIDENCE_OUTCOME_RUBRIC['SER.response.claim_accuracy']} Verification receipts contain observed command, status, exit code and bounded output. They corroborate only that execution and its returned bytes, not every task requirement or unobserved command. Treat delivery_message segments as parts of the user-facing delivery, even when a later final-response merely acknowledges completion. Do not require a receipt for ordinary artifact facts that are directly checkable in the supplied files.`,
  'SER.testing.strategy': `${EVIDENCE_OUTCOME_RUBRIC['SER.testing.strategy']} Observed verification receipts can substantiate agent-executed checks; an explicit failed receipt is a failure of that command, not missing evidence. Assess the adequacy of checks for the disclosed task, not an imagined larger product.`
})
export const RECEIPT_PROCESS_RUBRIC = Object.freeze({
  ...EVIDENCE_PROCESS_RUBRIC,
  handoff_clarity: `${EVIDENCE_PROCESS_RUBRIC.handoff_clarity} Task context segments contain retained Task descriptions and acceptance criteria; a concise handoff may refer to that existing task context. Do not require all details to be repeated verbatim in the handoff message.`
})

export function validateTaskJudgeProfile(profile, view) {
  if (profile === undefined || profile === null) return null
  const ids = view === 'process' ? TASK_PROCESS_IDS : TASK_OUTCOME_IDS
  if (![TASK_JUDGE_PROFILE, EVIDENCE_TASK_JUDGE_PROFILE, RECEIPT_TASK_JUDGE_PROFILE].includes(profile.version) || !Array.isArray(profile.items)
      || profile.items.length !== ids.length || new Set(profile.items.map(item => item.checklistItem)).size !== ids.length
      || profile.items.some(item => !ids.includes(item.checklistItem) || typeof item.applicable !== 'boolean'
        || typeof item.criterion !== 'string' || !item.criterion.trim() || item.criterion.length > 4000
        || Object.keys(item).some(key => !['checklistItem', 'applicable', 'criterion'].includes(key)))) throw new Error('Invalid frozen task Judge profile')
  return profile
}

export function taskJudgeProfile(caseEvaluation, view) {
  const items = view === 'process' ? caseEvaluation.collaboration : caseEvaluation.quality.filter(item => item.source === 'outcome')
  return validateTaskJudgeProfile({ version: caseEvaluation.judgeProfile ?? TASK_JUDGE_PROFILE, items: items.map(({ checklistItem, applicable, criterion }) => ({ checklistItem, applicable, criterion })) }, view)
}
