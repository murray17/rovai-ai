import type {
  AgentProfile, HostPlatformKey, MemberRuntimeConfiguration, RovaiApi,
  RuntimePlatformAdmission, StoredCommandResult
} from '@contracts'
import { persistedRuntimeConfigurationKey } from './member-runtime-conflict'
import { MemberRuntimeCommandError, submitMemberRuntimeConfiguration } from './member-runtime-commands'
import { runtimePlatformAdmissionAllowsUse, runtimePlatformAdmissionFor } from './runtime-status'

export type RuntimeApplyEditorState = { runtimeDirty: boolean; busy: boolean }
export type RuntimeApplyEnvironment = {
  hostPlatform: HostPlatformKey | null
  admissions: RuntimePlatformAdmission[]
}
export type RuntimeApplyEligibility = 'available' | 'same' | 'draft' | 'busy' | 'locked' | 'removed'
export type RuntimeApplyResult = {
  member: AgentProfile
  status: 'waiting' | 'applying' | 'applied' | 'matched' | 'failed' | 'conflict' | 'unknown'
  code?: string
  payload?: StoredCommandResult['payload']
  version?: number
}

export function runtimeConfigurationsEqual(
  left: MemberRuntimeConfiguration | null,
  right: MemberRuntimeConfiguration | null
): boolean {
  return persistedRuntimeConfigurationKey(left) === persistedRuntimeConfigurationKey(right)
}

export function runtimeApplyEligibility(
  member: AgentProfile,
  configuration: MemberRuntimeConfiguration,
  editor: RuntimeApplyEditorState | undefined,
  environment: RuntimeApplyEnvironment
): RuntimeApplyEligibility {
  if (member.presence === 'removed' || member.removedAt !== null) return 'removed'
  if (editor?.busy) return 'busy'
  if (editor?.runtimeDirty) return 'draft'
  if (runtimeConfigurationsEqual(member.runtimeConfiguration, configuration)) return 'same'
  const kind = member.runtimeConfiguration?.adapterKind
  if (kind === 'cursor-agent' || (kind && environment.hostPlatform !== null &&
    !runtimePlatformAdmissionAllowsUse(runtimePlatformAdmissionFor(environment.hostPlatform, environment.admissions, kind)))) return 'locked'
  return 'available'
}

/** One exact-version save. Only the existing catalog rejection recovery may resubmit. */
export async function applyRuntimeToMember(
  member: AgentProfile,
  configuration: MemberRuntimeConfiguration,
  request: RovaiApi['request']
): Promise<RuntimeApplyResult> {
  try {
    const command = {
      agentId: member.agentId, expectedVersion: member.version, ...structuredClone(configuration)
    }
    const result = await submitMemberRuntimeConfiguration(command, request)
    if (result.status === 'rejected') return {
      member,
      status: ['agent_profile.version_conflict', 'version_conflict', 'agent_profile.removed', 'agent_profile.not_found'].includes(result.code) ? 'conflict' : 'failed',
      code: result.code, payload: result.payload
    }
    const version = result.payload.version
    if (result.status !== 'applied' || !Number.isSafeInteger(version) || (version as number) <= member.version) {
      return { member, status: 'unknown', code: 'runtime_save_outcome_unknown' }
    }
    return { member, status: 'applied', version: version as number }
  } catch (error) {
    const code = error instanceof MemberRuntimeCommandError ? error.code : 'runtime_save_outcome_unknown'
    return { member, status: code === 'runtime_save_outcome_unknown' ? 'unknown' : 'failed', code }
  }
}

/** Read-back establishes current state, never invents a successful lost receipt. */
export function reconcileUnknownRuntimeApply(
  result: RuntimeApplyResult,
  latest: AgentProfile | undefined,
  configuration: MemberRuntimeConfiguration
): RuntimeApplyResult {
  if (result.status !== 'unknown') return result
  if (!latest || latest.presence === 'removed' || latest.removedAt !== null) {
    return { ...result, status: 'conflict' }
  }
  if (runtimeConfigurationsEqual(latest.runtimeConfiguration, configuration)) {
    return { ...result, status: 'matched', version: latest.version }
  }
  // Keep the original expectedVersion. A delayed first write and an explicit retry
  // still compete through Core CAS instead of overwriting a later configuration.
  return { ...result, status: latest.version === result.member.version ? 'failed' : 'conflict', code: undefined }
}
