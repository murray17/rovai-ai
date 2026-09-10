// This opt-in profile changes evaluation evidence, never the product's context.
// Legacy Judge Views keep their original prompt and projection when absent.
export const TASK_JUDGE_PROFILE = 'generic-task-v2'
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

export function validateTaskJudgeProfile(profile, view) {
  if (profile === undefined || profile === null) return null
  const ids = view === 'process' ? TASK_PROCESS_IDS : TASK_OUTCOME_IDS
  if (profile.version !== TASK_JUDGE_PROFILE || !Array.isArray(profile.items)
      || profile.items.length !== ids.length || new Set(profile.items.map(item => item.checklistItem)).size !== ids.length
      || profile.items.some(item => !ids.includes(item.checklistItem) || typeof item.applicable !== 'boolean'
        || typeof item.criterion !== 'string' || !item.criterion.trim() || item.criterion.length > 4000
        || Object.keys(item).some(key => !['checklistItem', 'applicable', 'criterion'].includes(key)))) throw new Error('Invalid frozen task Judge profile')
  return profile
}

export function taskJudgeProfile(caseEvaluation, view) {
  const items = view === 'process' ? caseEvaluation.collaboration : caseEvaluation.quality.filter(item => item.source === 'outcome')
  return validateTaskJudgeProfile({ version: TASK_JUDGE_PROFILE, items: items.map(({ checklistItem, applicable, criterion }) => ({ checklistItem, applicable, criterion })) }, view)
}
