import type { AdapterInstallation, AgentProfile } from '@contracts'
import { runtimeEditorInstallation } from './MemberRuntimeParameters'
import { memberRuntimeConfigurationPresentation, runtimeAdapterLabel } from './runtime-model-presentation'
import { uiAttribute } from './interface-language'

export function mentionCandidateRuntime(profile: AgentProfile | undefined, installations: AdapterInstallation[] = []): {
  runtimeKind?: NonNullable<AgentProfile['runtimeConfiguration']>['adapterKind']
  runtimeLabel: string
  modelLabel?: string
} {
  if (!profile) return { runtimeLabel: uiAttribute('智能体未载入') }
  const configuration = profile.runtimeConfiguration
  if (!configuration) return { runtimeLabel: uiAttribute('未配置智能体') }
  return {
    runtimeKind: configuration.adapterKind,
    runtimeLabel: runtimeAdapterLabel(configuration.adapterKind),
    modelLabel: memberRuntimeConfigurationPresentation(
      configuration, runtimeEditorInstallation(installations, configuration.adapterKind)
    ).model
  }
}
