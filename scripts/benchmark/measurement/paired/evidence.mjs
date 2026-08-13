import { canonicalJson, digestJson } from '../../protocol/canonical.mjs'

export function derivePreDispatchPairedContext({ caseRecord, toolPack }) {
  const manifest = caseRecord?.contract?.manifest
  const components = caseRecord?.contract?.components
  const fixture = caseRecord?.contract?.fixture
  if (!manifest || !components || !fixture || !toolPack?.admission || !toolPack?.spec) {
    throw new TypeError('paired pre-dispatch authorities are incomplete')
  }
  return {
    bindings: {
      case: {
        id: manifest.id,
        version: manifest.version,
        digest: stripPairedDigest(caseRecord.seal)
      },
      toolMeasurement: {
        id: toolPack.spec.specificationId,
        version: toolPack.spec.schemaVersion,
        digest: stripPairedDigest(toolPack.admission.admissionDigest)
      },
      verifier: {
        id: 'withheld-verifier',
        version: '1.0.0',
        digest: stripPairedDigest(components.verifierDigest)
      }
    },
    staticFactors: {
      requestDigest: stripPairedDigest(components.promptDigest),
      workspaceFixtureDigest: stripPairedDigest(fixture.digest),
      budgetContractDigest: digestJson(normalizedBudget(manifest.budget))
    }
  }
}

export function assertPreDispatchPairedDefinition(definition, observed) {
  if (canonicalJson(observed.bindings) !== canonicalJson(definition.bindings)) {
    throw new Error('paired Definition bindings differ from the admitted Case, Tool Pack, or verifier')
  }
  for (const [key, value] of Object.entries(observed.staticFactors)) {
    if (definition.commonFactors[key] !== value) {
      throw new Error(`paired Definition common factor ${key} differs before dispatch`)
    }
  }
  return true
}

export function deriveObservedPairedExecution({
  qualificationCase,
  verifierObservation,
  environmentManifest,
  toolMeasurementBinding
}) {
  const casePayload = qualificationCase?.payload
  const verifierPayload = verifierObservation?.payload
  const environmentPayload = environmentManifest?.payload
  const lead = environmentPayload?.runtimes?.find((runtime) => runtime.memberId === 'agent_1')
  if (!casePayload || !verifierPayload || !environmentPayload || !lead) {
    throw new TypeError('paired normalized execution authorities are incomplete')
  }
  return {
    bindings: {
      case: {
        id: casePayload.caseId,
        version: casePayload.caseVersion,
        digest: stripPairedDigest(casePayload.caseSeal)
      },
      toolMeasurement: structuredClone(toolMeasurementBinding),
      verifier: {
        id: 'withheld-verifier',
        version: '1.0.0',
        digest: stripPairedDigest(verifierPayload.verifierDigest)
      }
    },
    commonFactors: {
      requestDigest: stripPairedDigest(casePayload.requestDigest),
      workspaceFixtureDigest: stripPairedDigest(casePayload.fixtureDigest),
      budgetContractDigest: digestJson(casePayload.executionBudget),
      leadRuntimeModelPermissionsDigest: digestJson(lead),
      ordinaryToolAvailabilityDigest: digestJson({
        builtinToolContractVersion: environmentPayload.core.builtinToolContractVersion,
        builtinToolIpcProtocolVersion: environmentPayload.core.builtinToolIpcProtocolVersion,
        builtinToolCatalogDigest: environmentPayload.core.builtinToolCatalogDigest,
        leadCapabilityDigest: lead.capabilityDigest
      }),
      isolationProfileDigest: stripPairedDigest(casePayload.isolationProfile.digest)
    }
  }
}

export function stripPairedDigest(value) {
  const normalized = String(value ?? '').replace(/^sha256:/u, '')
  if (!/^[a-f0-9]{64}$/u.test(normalized)) throw new Error('paired evidence digest is invalid')
  return normalized
}

function normalizedBudget(budget) {
  if (!budget || typeof budget !== 'object') throw new TypeError('paired budget is unavailable')
  return {
    elapsedSeconds: budget.elapsedSeconds,
    maxAgentRunResponsibilities: budget.maxAgentRuns,
    maxAcceptedA2A: budget.maxAcceptedA2a
  }
}
