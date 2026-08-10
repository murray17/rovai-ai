import { validateLegacyV034SuiteDefinition } from '../adapters/registry.mjs'
import { defineBenchmarkProfile } from '../execution/suite.mjs'

export function legacyV034Profile(suite) {
  validateLegacyV034SuiteDefinition(suite)
  return defineBenchmarkProfile({
    id: 'team-qualification-v034',
    version: '1.0.0',
    lane: 'team-qualification',
    hardOutcomeDefinition: {
      authority: 'qualification-v0.34',
      passWhen: [
        'verified_delivery_pass',
        'orchestration_convergence_pass',
        'post_dispatch_human_intervention_absent'
      ],
      semanticJudgeAuthority: 'advisory_only'
    },
    publicationPolicy: { publishOutcomeRate: true, requireAllSlots: true, passAtK: false },
    suite: {
      id: suite.id ?? 'legacy-v0.34-suite',
      version: suite.version,
      seed: suite.seed,
      shuffle: true,
      shuffleKeyMode: 'legacy_numeric_round',
      rounds: Array.from({ length: suite.rounds }, (_, index) => ({ id: `r${index + 1}`, ordinal: index + 1 })),
      cases: suite.cases.map((entry) => ({ id: entry.id, version: entry.version, seal: entry.seal }))
    }
  })
}
