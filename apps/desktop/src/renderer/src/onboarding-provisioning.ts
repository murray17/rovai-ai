import type {
  AdapterInstallation,
  AdapterPermissionConfig,
  AgentProfile,
  CoreMethod,
  OnboardingApi,
  OnboardingSnapshot,
  RestorableLocation,
  StoredCommandResult
} from '@contracts'
import {
  runtimeEditorInstallation,
  runtimeModelSelectionAvailable
} from './MemberRuntimeParameters'
import { BUILTIN_MEMBER_PRESETS } from './member-presets'

export const FIRST_RUN_CAMP_TITLE = '初次集结'

type InProgressOnboarding = Extract<OnboardingSnapshot, { status: 'in_progress' }>
type CompletedOnboarding = Extract<OnboardingSnapshot, { status: 'completed' }>

export interface OnboardingProvisioningApi {
  request<T>(method: CoreMethod, params?: unknown): Promise<T>
  onboarding: Pick<OnboardingApi,
    | 'beginProvisioning'
    | 'recordProvisionedMember'
    | 'recordProvisionedRuntime'
    | 'recordProvisionedCamp'
    | 'complete'
  >
  desktopSession: {
    commitRestorableLocation(location: RestorableLocation): Promise<void>
  }
}

export interface OnboardingProvisioningResult {
  snapshot: CompletedOnboarding
  memberAgentId: string
  quickChatCampId: string
}

export async function provisionFirstRun(
  api: OnboardingProvisioningApi,
  initialSnapshot: InProgressOnboarding,
  installations: AdapterInstallation[],
  onCheckpoint: (snapshot: OnboardingSnapshot) => void = () => undefined
): Promise<OnboardingProvisioningResult> {
  if (initialSnapshot.step !== 'runtime' || !initialSnapshot.selectedMemberRole) {
    throw new Error('首次引导还没有准备好初始化。')
  }
  if (!initialSnapshot.runtimeSelection?.model) {
    throw new Error('请先完成 Agent 运行时与模型配置。')
  }
  const preset = BUILTIN_MEMBER_PRESETS.find(
    (candidate) => candidate.role === initialSnapshot.selectedMemberRole
  )
  if (!preset) throw new Error('所选队员预设已不可用。')

  let runtimePermissions: AdapterPermissionConfig
  if (initialSnapshot.provisioning) {
    runtimePermissions = initialSnapshot.provisioning.runtimePermissions
    if (runtimePermissions.adapterKind !== initialSnapshot.runtimeSelection.adapterKind) {
      throw new Error('已保存的 Agent 运行时与权限配置不匹配。')
    }
  } else {
    const installation = runtimeEditorInstallation(
      installations,
      initialSnapshot.runtimeSelection.adapterKind
    )
    if (!installation?.memberRuntimeDefaults) {
      throw new Error('当前 Agent 运行时没有可用的默认权限配置。')
    }
    if (
      installation.memberRuntimeDefaults.adapterKind !== initialSnapshot.runtimeSelection.adapterKind
      || installation.memberRuntimeDefaults.permissions.adapterKind
        !== initialSnapshot.runtimeSelection.adapterKind
    ) {
      throw new Error('Agent 运行时与权限配置不匹配。')
    }
    if (!runtimeModelSelectionAvailable(installation, initialSnapshot.runtimeSelection.model)) {
      throw new Error('已选模型不在当前 Agent 运行时的可用目录中。')
    }
    runtimePermissions = installation.memberRuntimeDefaults.permissions
  }

  let current = requireProvisioningSnapshot(
    await api.onboarding.beginProvisioning(initialSnapshot.runtimeSelection, runtimePermissions)
  )
  onCheckpoint(current)

  if (!current.provisioning.memberAgentId) {
    const existingMembers = await api.request<AgentProfile[]>('members.list')
    const retained = existingMembers.find((member) =>
      member.avatarRef === preset.avatarRef
      && member.presence !== 'removed'
      && member.removedAt === null
    ) ?? null
    let memberAgentId = retained?.agentId ?? null
    let version = retained?.version ?? null
    if (!memberAgentId || version === null) {
      const result = await api.request<StoredCommandResult>('members.create', {
        commandId: current.provisioning.memberCommandId,
        command: {
          displayName: preset.displayName,
          teamRole: preset.teamRole,
          professionalResponsibilities: preset.professionalResponsibilities,
          personalityTraits: preset.personalityTraits,
          workingPrinciples: preset.workingPrinciples,
          growthTopic: preset.growthTopic,
          avatarRef: preset.avatarRef
        }
      })
      assertApplied(result, '创建首位队员')
      memberAgentId = result.resultEntity?.entityId ?? stringField(result.payload, 'agentId')
      version = positiveVersion(result.payload.version)
      if (!memberAgentId || version === null) {
        throw new Error('队员已创建，但返回的检查点不完整。')
      }
    }
    current = requireProvisioningSnapshot(
      await api.onboarding.recordProvisionedMember(memberAgentId, version)
    )
    onCheckpoint(current)
  }

  const memberAgentId = current.provisioning.memberAgentId
  const memberVersionBeforeRuntime = current.provisioning.memberVersionBeforeRuntime
  if (!memberAgentId || memberVersionBeforeRuntime === null) {
    throw new Error('队员创建检查点不完整。')
  }

  if (current.provisioning.memberVersionAfterRuntime === null) {
    const selection = current.runtimeSelection
    if (!selection?.model) throw new Error('已保存的模型选择不完整。')
    const result = await api.request<StoredCommandResult>('members.runtime.set', {
      commandId: current.provisioning.runtimeCommandId,
      command: {
        agentId: memberAgentId,
        expectedVersion: memberVersionBeforeRuntime,
        adapterKind: selection.adapterKind,
        model: selection.model,
        permissions: current.provisioning.runtimePermissions
      }
    })
    assertApplied(result, '保存队员运行配置')
    const version = positiveVersion(result.payload.version)
    if (version === null) {
      throw new Error('运行配置已保存，但返回的检查点不完整。')
    }
    current = requireProvisioningSnapshot(
      await api.onboarding.recordProvisionedRuntime(version)
    )
    onCheckpoint(current)
  }

  if (!current.provisioning.quickChatCampId) {
    const result = await api.request<StoredCommandResult>('camps.create', {
      commandId: current.provisioning.campCommandId,
      name: FIRST_RUN_CAMP_TITLE,
      workspace: null,
      memberAgentIds: [memberAgentId],
      defaultLeadAgentId: memberAgentId,
      collaborationMode: 'peer',
      activationState: 'active'
    })
    assertApplied(result, '创建首次快速对话')
    const campId = result.resultEntity?.entityId ?? stringField(result.payload, 'campId')
    if (!campId) throw new Error('快速对话已创建，但返回的 Camp ID 不完整。')
    current = requireProvisioningSnapshot(
      await api.onboarding.recordProvisionedCamp(campId)
    )
    onCheckpoint(current)
  }

  const quickChatCampId = current.provisioning.quickChatCampId
  if (!quickChatCampId) throw new Error('快速对话检查点不完整。')

  // The fourth page is optional. Persist its real Core location before marking
  // the mandatory training complete so a restart always has a durable place to resume.
  await api.desktopSession.commitRestorableLocation({ kind: 'camp', campId: quickChatCampId })
  const completed = await api.onboarding.complete()
  if (completed.status !== 'completed' || completed.origin !== 'onboarding') {
    throw new Error('首次引导完成状态不完整。')
  }
  onCheckpoint(completed)
  return { snapshot: completed, memberAgentId, quickChatCampId }
}

function requireProvisioningSnapshot(snapshot: OnboardingSnapshot): InProgressOnboarding & {
  provisioning: NonNullable<InProgressOnboarding['provisioning']>
} {
  if (snapshot.status !== 'in_progress' || snapshot.step !== 'runtime' || !snapshot.provisioning) {
    throw new Error('首次引导初始化检查点不完整。')
  }
  return snapshot as InProgressOnboarding & {
    provisioning: NonNullable<InProgressOnboarding['provisioning']>
  }
}

function assertApplied(result: StoredCommandResult, action: string): void {
  if (result.status === 'applied') return
  const message = stringField(result.payload, 'message')
  throw new Error(message ?? `${action}未完成：${result.code}`)
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' && value[key] ? value[key] as string : null
}

function positiveVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}
