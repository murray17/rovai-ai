export const assurance = 'fixture'

export const capabilities = Object.freeze({
  tools: 'none',
  network: 'none',
  workspace: 'none'
})

const DIMENSIONS = {
  'SER.requirements.understanding': 'requirements',
  'SER.design.solution_fit': 'design',
  'SER.implementation.quality': 'implementation',
  'SER.testing.strategy': 'testing',
  'SER.scope.discipline': 'scope',
  'SER.collaboration.delegation': 'collaboration',
  'SER.collaboration.handoff_clarity': 'collaboration',
  'SER.collaboration.contribution_value': 'collaboration',
  'SER.collaboration.feedback_absorption': 'collaboration',
  'SER.collaboration.lead_integration': 'collaboration',
  'SER.response.claim_accuracy': 'response',
  'SER.response.limitations': 'response'
}

export async function invokeReplica(request) {
  if (JSON.stringify(request.capabilities) !== JSON.stringify(capabilities)) {
    throw new Error('fixture adapter received non-disabled capabilities')
  }
  const dualView = request.judgeView === 'process' || request.judgeView === 'outcome'
  const modelInput = dualView ? request.evidencePack : request.evidencePack.payload
  const coverage = new Map(modelInput.checklistCoverage.map((item) => [
    item.checklistItem,
    item
  ]))
  return {
    items: request.presentationOrder.map((checklistItem) => {
      const itemCoverage = coverage.get(checklistItem)
      const abstain = itemCoverage.coverage.state !== 'complete'
      return {
        checklistItem,
        dimension: DIMENSIONS[checklistItem],
        verdict: abstain
          ? itemCoverage.coverage.state === 'not_applicable'
            ? 'not_applicable'
            : 'indeterminate'
          : 'satisfied',
        confidence: abstain ? 'low' : 'high',
        ...(dualView
          ? { evidenceIds: itemCoverage.evidenceIds }
          : { evidenceReferences: itemCoverage.evidenceReferences }),
        reason: abstain
          ? 'The allowlisted fixture evidence does not support a categorical semantic judgment.'
          : 'The deterministic protocol fixture marks this evidence-covered item as satisfied.',
        abstainReason: abstain
          ? { code: `semantic_judge.fixture.${itemCoverage.coverage.state}` }
          : null
      }
    })
  }
}
