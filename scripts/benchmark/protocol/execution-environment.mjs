import { platform, release } from 'node:os'
import { BENCHMARK_RUNNER_VERSION } from './v3.mjs'
import { digestJson } from './canonical.mjs'

export function buildExecutionEnvironment({
  teamRuntimeCompatibilityDigest,
  teamConfiguration,
  runtimeModelPermissions,
  isolationProfile,
  caseHermeticVerificationProfile
}) {
  const teamConfigurationDigest = digestJson(teamConfiguration)
  const runtimeModelPermissionsDigest = digestJson(runtimeModelPermissions)
  const isolationProfileDigest = digestJson(isolationProfile)
  const caseHermeticVerificationProfileDigest = digestJson(caseHermeticVerificationProfile)
  const compatibilityEnvelope = {
    benchmarkRunnerVersion: BENCHMARK_RUNNER_VERSION,
    nodeVersion: process.version,
    platformClass: `${platform()}-${process.arch}`,
    platformReleaseClass: majorReleaseClass(release()),
    teamRuntimeCompatibilityDigest,
    teamConfigurationDigest,
    runtimeModelPermissionsDigest,
    isolationProfileDigest,
    caseHermeticVerificationProfileDigest
  }
  return {
    ...compatibilityEnvelope,
    compatibilityEnvelopeDigest: digestJson(compatibilityEnvelope),
    summaries: {
      team: summarizeTeam(teamConfiguration),
      runtimeModelPermissions: runtimeModelPermissions.summary,
      isolation: isolationProfile.id,
      hermeticVerification: caseHermeticVerificationProfile.id
    }
  }
}

function summarizeTeam(team) {
  const members = Array.isArray(team.members) ? team.members : []
  return {
    memberCount: members.length,
    adapterKinds: [...new Set(members.map((member) => member.adapterKind).filter(Boolean))].sort()
  }
}

function majorReleaseClass(value) {
  const major = /^\d+/u.exec(value)?.[0] ?? 'unknown'
  return `${platform()}-${major}`
}
