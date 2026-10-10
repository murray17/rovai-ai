import type { AdapterInstallation, AgentProfile, ThreadMessageRuntimeModelView } from '@contracts'
import { uiAttribute } from './interface-language'

export function runtimeAdapterLabel(kind: string): string {
  return ({
    'codex-cli': 'Codex CLI',
    pi: 'Pi Coding Agent',
    'opencode-cli': 'OpenCode',
    'copilot-cli': 'GitHub Copilot',
    'claude-code-cli': 'Claude Code',
    'kiro-cli': 'Kiro',
    'qoder-cli': 'Qoder',
    'codebuddy-cli': 'CodeBuddy',
    'qwen-code': 'Qwen Code',
    'trae-cn-cli': 'TRAE CLI',
    'cursor-agent': 'Cursor Agent',
    'kimi-code-cli': 'Kimi Code',
    'grok-build': 'Grok Build',
    'deepseek-harness': 'DeepSeek Harness',
    'cline-cli': 'Cline',
    'command-code-cli': 'Command Code',
    'zcode-app': 'ZCode',
    'antigravity-app': 'Antigravity'
  } as Record<string, string>)[kind] ?? kind
}

export type MemberRuntimeConfigurationPresentation = {
  model: string
  effort: { label: string; value: string } | null
  strategy: string
  summary: string
}

export function memberRuntimeConfigurationPresentation(
  configuration: NonNullable<AgentProfile['runtimeConfiguration']>,
  installation: AdapterInstallation | null
): MemberRuntimeConfigurationPresentation {
  const modelSelection = configuration.model
  if (modelSelection.mode === 'runtime_default') {
    return {
      model: uiAttribute('智能体默认'),
      effort: null,
      strategy: uiAttribute('跟随智能体默认'),
      summary:uiAttribute("智能体默认")
    }
  }

  const modelDescriptor = installation?.snapshot?.models.find(
    (model) => model.id === modelSelection.modelId
  ) ?? null
  const model = modelDescriptor?.displayName.trim() || modelSelection.modelId
  const effortKey = configuration.adapterKind === 'claude-code-cli'
    ? 'effort'
    : 'reasoning_effort'
  const effortDescriptor = modelDescriptor?.options.find((option) => option.key === effortKey) ?? null
  const rawEffort = modelSelection.options[effortKey]
  const effort = effortDescriptor || typeof rawEffort === 'string'
    ? {
        label: configuration.adapterKind === 'claude-code-cli'
          ? uiAttribute('思考强度')
          : uiAttribute('推理强度'),
        value: typeof rawEffort === 'string' && rawEffort
          ? runtimeEffortValueLabel(rawEffort, effortDescriptor?.values ?? [])
          :uiAttribute("跟随模型默认值")
      }
    : null

  return {
    model,
    effort,
    strategy: uiAttribute('固定模型'),
    summary: effort ? `${model} · ${effort.label} ${effort.value}` : model
  }
}

function runtimeEffortValueLabel(
  value: string,
  choices: Array<{ value: string; label: string }>
): string {
  return choices.find((choice) => choice.value === value)?.label ?? value
}

/** History has no profile fallback: even a missing Run record must stay missing. */
export function messageRuntimeModelPresentation(
  model: ThreadMessageRuntimeModelView | null | undefined,
  installation: AdapterInstallation | null
): Pick<MemberRuntimeConfigurationPresentation, 'model' | 'effort'> | null {
  if (!model) return null
  const descriptor = installation?.adapterKind === model.adapterKind
    ? installation.snapshot?.models.find(candidate => candidate.id === model.modelId)
    : null
  const effortKey = model.adapterKind === 'claude-code-cli' ? 'effort' : 'reasoning_effort'
  const choices = descriptor?.options.find(option => option.key === effortKey)?.values ?? []
  return {
    model: descriptor?.displayName.trim() || model.modelId || uiAttribute('智能体默认'),
    effort: model.reasoningEffort ? {
      label: model.adapterKind === 'claude-code-cli' ? uiAttribute('思考强度') : uiAttribute('推理强度'),
      value: runtimeEffortValueLabel(model.reasoningEffort, choices)
    } : null
  }
}

export function modelSummary(presentation: Pick<MemberRuntimeConfigurationPresentation, 'model' | 'effort'>): string {
  return presentation.effort ? `${presentation.model} · ${presentation.effort.value}` : presentation.model
}
