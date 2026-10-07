import { uiAttribute } from './interface-language'
import type {
  AdapterInstallation,
  AdapterPermissionConfig,
  AgentProfile,
  AgentProfileIdentityInput,
  CoreMethod,
  InterfaceLanguage,
  OnboardingApi,
  OnboardingSnapshot,
  RestorableLocation,
  StoredCommandResult
} from '@contracts'
import {
  runtimeEditorInstallation,
  runtimeModelSelectionAvailable
} from './MemberRuntimeParameters'
import { builtinMemberPresetsForLanguage, type BuiltinMemberPreset } from './member-presets'
import { FIRST_RUN_CAMP_TITLE } from './camp-title'

export { FIRST_RUN_CAMP_TITLE } from './camp-title'

type InProgressOnboarding = Extract<OnboardingSnapshot, { status: 'in_progress' }>
type CompletedOnboarding = Extract<OnboardingSnapshot, { status: 'completed' }>

export interface OnboardingProvisioningApi {
  request<T>(method: CoreMethod, params?: unknown): Promise<T>
  onboarding: Pick<OnboardingApi,
    | 'beginProvisioning'
    | 'recordProvisionedMember'
    | 'recordProvisionedRuntime'
    | 'prepareRuntimeCopies'
    | 'recordRuntimeCopy'
    | 'recordProvisionedThread'
    | 'complete'
  >
  desktopSession: {
    commitRestorableLocation(location: RestorableLocation): Promise<void>
  }
}

export interface OnboardingProvisioningResult {
  snapshot: CompletedOnboarding
  memberAgentId: string
  quickChatThreadId: string
}

export async function provisionFirstRun(
  api: OnboardingProvisioningApi,
  initialSnapshot: InProgressOnboarding,
  installations: AdapterInstallation[],
  onCheckpoint: (snapshot: OnboardingSnapshot) => void = () => undefined,
  language: InterfaceLanguage = 'zh-CN'
): Promise<OnboardingProvisioningResult> {
  if (initialSnapshot.step !== 'runtime' || !initialSnapshot.selectedMemberRole) {
    throw new Error(uiAttribute('首次引导还没有准备好初始化。'))
  }
  if (!initialSnapshot.runtimeSelection?.model) {
    throw new Error(uiAttribute('请先完成智能体与模型配置。'))
  }
  const presets = builtinMemberPresetsForLanguage(language)
  const preset = presets.find(
    (candidate) => candidate.role === initialSnapshot.selectedMemberRole
  )
  if (!preset) throw new Error(uiAttribute('所选队员预设已不可用。'))
  const identity = presetIdentity(preset)

  let runtimePermissions: AdapterPermissionConfig
  if (initialSnapshot.provisioning) {
    runtimePermissions = initialSnapshot.provisioning.runtimePermissions
    if (runtimePermissions.adapterKind !== initialSnapshot.runtimeSelection.adapterKind) {
      throw new Error(uiAttribute('已保存的智能体与权限配置不匹配。'))
    }
  } else {
    const installation = runtimeEditorInstallation(
      installations,
      initialSnapshot.runtimeSelection.adapterKind
    )
    if (!installation?.memberRuntimeDefaults) {
      throw new Error(uiAttribute('当前智能体没有可用的默认权限配置。'))
    }
    if (
      installation.memberRuntimeDefaults.adapterKind !== initialSnapshot.runtimeSelection.adapterKind
      || installation.memberRuntimeDefaults.permissions.adapterKind
        !== initialSnapshot.runtimeSelection.adapterKind
    ) {
      throw new Error(uiAttribute('智能体与权限配置不匹配。'))
    }
    if (!runtimeModelSelectionAvailable(installation, initialSnapshot.runtimeSelection.model)) {
      throw new Error(uiAttribute('已选模型不在当前智能体的可用目录中。'))
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
    const seedPresets = language === 'en' ? builtinMemberPresetsForLanguage('zh-CN') : []
    // Core seeds Chinese profiles before onboarding. Initialize only untouched,
    // unconfigured seed text; customized or configured identities remain user data.
    for (const seedPreset of seedPresets) {
      const member = existingMembers.find((candidate) => candidate.avatarRef === seedPreset.avatarRef
        && candidate.presence !== 'removed' && candidate.removedAt === null)
      if (!member || member.runtimeConfiguration !== null || !hasPresetIdentity(member, seedPreset)) continue
      const englishPreset = presets.find((candidate) => candidate.role === seedPreset.role)!
      const result = await api.request<StoredCommandResult>('members.update', {
        commandId: member.agentId === memberAgentId
          ? current.provisioning.memberCommandId
          : `${current.provisioning.memberCommandId}:seed:${member.agentId}`,
        command: { ...presetIdentity(englishPreset), agentId: member.agentId, expectedVersion: member.version }
      })
      assertApplied(result, uiAttribute('保存队员信息'))
      const updatedVersion = positiveVersion(result.payload.version)
      if (updatedVersion === null) {
        throw new Error(uiAttribute('已收到保存回执，但无法确认最新版本，请重新载入。'))
      }
      if (member.agentId === memberAgentId) version = updatedVersion
    }
    if (!memberAgentId || version === null) {
      const result = await api.request<StoredCommandResult>('members.create', {
        commandId: current.provisioning.memberCommandId,
        command: {
          ...identity,
          avatarRef: preset.avatarRef
        }
      })
      assertApplied(result, uiAttribute('创建首位队员'))
      memberAgentId = result.resultEntity?.entityId ?? stringField(result.payload, 'agentId')
      version = positiveVersion(result.payload.version)
      if (!memberAgentId || version === null) {
        throw new Error(uiAttribute('队员已创建，但返回的检查点不完整。'))
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
    throw new Error(uiAttribute('队员创建检查点不完整。'))
  }

  if (current.provisioning.memberVersionAfterRuntime === null) {
    const selection = current.runtimeSelection
    if (!selection?.model) throw new Error(uiAttribute('已保存的模型选择不完整。'))
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
    assertApplied(result, uiAttribute('保存队员运行配置'))
    const version = positiveVersion(result.payload.version)
    if (version === null) {
      throw new Error(uiAttribute('运行配置已保存，但返回的检查点不完整。'))
    }
    current = requireProvisioningSnapshot(
      await api.onboarding.recordProvisionedRuntime(version)
    )
    onCheckpoint(current)
  }

  if (current.provisioning.runtimeCopies === null) {
    // Read after identity initialization so English seeds use their current versions.
    const members = await api.request<AgentProfile[]>('members.list')
    const targets = presets.flatMap((seed) => {
      const member = members.find((candidate) => candidate.avatarRef === seed.avatarRef
        && candidate.presence !== 'removed' && candidate.removedAt === null)
      return member && member.agentId !== memberAgentId && member.runtimeConfiguration === null
        ? [{ agentId: member.agentId, expectedVersion: member.version }]
        : []
    })
    current = requireProvisioningSnapshot(await api.onboarding.prepareRuntimeCopies(targets))
    onCheckpoint(current)
  }

  for (const target of current.provisioning.runtimeCopies!) {
    if (target.status !== 'pending') continue
    const selection = current.runtimeSelection!
    // Replay the exact durable command after an unknown outcome. Never refresh
    // expectedVersion: a later user edit must win over this initial default.
    const result = await api.request<StoredCommandResult>('members.runtime.set', {
      commandId: target.commandId,
      command: {
        agentId: target.agentId,
        expectedVersion: target.expectedVersion,
        adapterKind: selection.adapterKind,
        model: selection.model,
        permissions: current.provisioning.runtimePermissions
      }
    })
    const changed = result.status === 'rejected' && [
      'agent_profile.version_conflict', 'version_conflict',
      'agent_profile.removed', 'agent_profile.not_found'
    ].includes(result.code)
    if (result.status !== 'rejected') {
      assertApplied(result, uiAttribute('保存队员运行配置'))
      if (result.payload.version !== target.expectedVersion + 1) {
        throw new Error(uiAttribute('运行配置已保存，但返回的检查点不完整。'))
      }
    }
    current = requireProvisioningSnapshot(await api.onboarding.recordRuntimeCopy(
      target.agentId, target.commandId,
      changed ? 'skipped' : result.status === 'rejected' ? 'retry' : 'applied'
    ))
    onCheckpoint(current)
    // Rejected commands are durably replayed by Core. Rotate only a known
    // rejection before exposing retry; transport failures retain the old ID.
    if (!changed) assertApplied(result, uiAttribute('保存队员运行配置'))
  }

  if (!current.provisioning.quickChatThreadId) {
    const result = await api.request<StoredCommandResult>('threads.create', {
      commandId: current.provisioning.campCommandId,
      name: FIRST_RUN_CAMP_TITLE,
      workspace: null,
      memberAgentIds: [memberAgentId],
      defaultLeadAgentId: memberAgentId,
      collaborationMode: 'peer',
      activationState: 'active'
    })
    assertApplied(result, uiAttribute('创建首次快速对话'))
    const threadId = result.resultEntity?.entityId ?? stringField(result.payload, 'threadId')
    if (!threadId) throw new Error(uiAttribute('快速对话已创建，但返回的 Thread ID 不完整。'))
    current = requireProvisioningSnapshot(
      await api.onboarding.recordProvisionedThread(threadId)
    )
    onCheckpoint(current)
  }

  const quickChatThreadId = current.provisioning.quickChatThreadId
  if (!quickChatThreadId) throw new Error(uiAttribute('快速对话检查点不完整。'))

  // The fourth page is optional. Persist its real Core location before marking
  // the mandatory training complete so a restart always has a durable place to resume.
  await api.desktopSession.commitRestorableLocation({ kind: 'camp', threadId: quickChatThreadId })
  const completed = await api.onboarding.complete()
  if (completed.status !== 'completed' || completed.origin !== 'onboarding') {
    throw new Error(uiAttribute('首次引导完成状态不完整。'))
  }
  onCheckpoint(completed)
  return { snapshot: completed, memberAgentId, quickChatThreadId }
}

function presetIdentity(preset: BuiltinMemberPreset): AgentProfileIdentityInput {
  return {
    displayName: preset.displayName,
    teamRole: preset.teamRole,
    professionalResponsibilities: preset.professionalResponsibilities,
    personalityTraits: preset.personalityTraits,
    workingPrinciples: preset.workingPrinciples,
    growthTopic: preset.growthTopic
  }
}

function hasPresetIdentity(member: AgentProfile, preset: BuiltinMemberPreset): boolean {
  return member.displayName === preset.displayName
    && member.teamRole === preset.teamRole
    && member.professionalResponsibilities === preset.professionalResponsibilities
    && member.workingPrinciples === preset.workingPrinciples
    && member.growthTopic === preset.growthTopic
    && member.personalityTraits.length === preset.personalityTraits.length
    && member.personalityTraits.every((trait, index) => trait === preset.personalityTraits[index])
}

function requireProvisioningSnapshot(snapshot: OnboardingSnapshot): InProgressOnboarding & {
  provisioning: NonNullable<InProgressOnboarding['provisioning']>
} {
  if (snapshot.status !== 'in_progress' || snapshot.step !== 'runtime' || !snapshot.provisioning) {
    throw new Error(uiAttribute('首次引导初始化检查点不完整。'))
  }
  return snapshot as InProgressOnboarding & {
    provisioning: NonNullable<InProgressOnboarding['provisioning']>
  }
}

function assertApplied(result: StoredCommandResult, action: string): void {
  if (result.status === 'applied') return
  const message = stringField(result.payload, 'message')
  throw new Error(message ?? uiAttribute('{0}未完成：{1}', action, result.code))
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' && value[key] ? value[key] as string : null
}

function positiveVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}
