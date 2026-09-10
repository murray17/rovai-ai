// A metric is admitted only with an observable object and a responsible view.
// These contracts describe coverage, not a proof of every possible behaviour.
import { digestJson } from './qualification-common.mjs'

export const METRIC_CONTRACT_VERSION = 'observable-task-metrics-v1'
const entry = (view, sources, scope) => ({ view, sources, scope })
export const METRIC_CONTRACTS = Object.freeze({
  'SER.requirements.understanding': entry('outcome', ['acceptance', 'artifacts', 'verification'], 'Achieved, disclosed task goals; an observed missing required artifact is failure, not missing evaluator evidence.'),
  'SER.design.solution_fit': entry('outcome', ['acceptance', 'artifacts'], 'Fit of the delivered approach to the disclosed task; do not require a unique solution or internal reasoning.'),
  'SER.implementation.quality': entry('outcome', ['acceptance', 'artifacts', 'verification'], 'Correctness and robustness of the delivered artifact within disclosed input and output requirements.'),
  'SER.testing.strategy': entry('outcome', ['acceptance', 'artifacts', 'verification', 'verification_receipts'], 'Coverage of disclosed behaviour by supplied checks. Distinguish evaluator checks from observed agent checks; do not infer execution of an unobserved command.'),
  'SER.scope.discipline': entry('outcome', ['acceptance', 'artifacts', 'delivery'], 'Instruction and information scope of delivered content only. Operational boundaries have separate rule owners.'),
  'SER.response.claim_accuracy': entry('outcome', ['acceptance', 'artifacts', 'delivery', 'verification', 'verification_receipts'], 'Consistency of delivered factual conclusions, artifact/completion claims and the results of supplied verification receipts. Process provenance, retrieval mechanics and global absence claims are outside this metric and must not create additional scored requirements.'),
  'SER.response.limitations': entry('outcome', ['acceptance', 'artifacts', 'delivery', 'verification'], 'Disclosure of material result limitations visible in supplied task evidence; evaluator-only export omissions are not agent omissions.'),
  'SER.collaboration.delegation': entry('process', ['acceptance', 'interactions', 'participant_messages', 'task_context'], 'Appropriate observable division of work; explicit required collaboration is necessary for this Case. Repeated substantive independent review is not automatically redundant; cite a concrete unnecessary handoff to penalize.'),
  'SER.collaboration.handoff_clarity': entry('process', ['acceptance', 'interactions', 'participant_messages', 'task_context'], 'Whether the recipient had the goal, constraints, relevant context and expected output, including referenced retained Task context.'),
  'SER.collaboration.contribution_value': entry('process', ['acceptance', 'participant_messages', 'artifacts'], 'Concrete task-relevant contribution in member replies, including useful findings even if the Lead failed to act.'),
  'SER.collaboration.feedback_absorption': entry('process', ['participant_messages', 'delivery', 'artifacts', 'verification'], 'Whether actionable feedback is resolved in the later delivered artifact or explicitly rejected with a task-grounded reason; no inference about internal causality.'),
  'SER.collaboration.lead_integration': entry('process', ['participant_messages', 'delivery', 'artifacts', 'verification'], 'Whether the final delivery reconciles available contributions and meets the assigned delivery phase, without requiring courtesy acknowledgements.'),
  'boundary.workspace': entry('check', ['workspace_boundary_check'], 'Writes inside the captured workspace satisfy the declared path boundary; this is not a host-wide filesystem audit.'),
  'boundary.a2a': entry('rule', ['collaboration_ledger'], 'Accepted A2A count is within the frozen bound; proving an upper bound requires complete ledger coverage.'),
  'boundary.memory': entry('rule', ['memory_before', 'memory_after'], 'Frozen observable Memory identities, revisions and candidate states are unchanged between snapshots; does not prove no transient write occurred.')
})

export function metricContract(item) {
  const contract = METRIC_CONTRACTS[item.checklistItem ?? item.id]
  if (!contract || contract.view !== (item.source ?? 'process')) throw new Error(`Metric has no observable evidence owner: ${item.id ?? item.checklistItem}`)
  return { version: METRIC_CONTRACT_VERSION, ...structuredClone(contract) }
}

export function validateMetricContract(item) {
  const expected = metricContract(item)
  if (!item.verification || digestJson(item.verification) !== digestJson(expected)) throw new Error(`Metric evidence contract is absent or changed: ${item.id ?? item.checklistItem}`)
}
