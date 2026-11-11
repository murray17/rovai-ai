import type { AdapterInstallation, AgentProfile, ThreadMessageRuntimeModelView } from '@contracts'
import { uiAttribute } from './interface-language'

export function runtimeAdapterLabel(kind: string): string {
  return ({
    'codex-cli': 'Codex CLI',
    pi: 'Pi Coding Agent',
    'opencode-cli': 'OpenCode',
    'kilo-cli': 'Kilo',
    'copilot-cli': 'GitHub Copilot',
    'claude-code-cli': 'Claude Code',
    'kiro-cli': 'Kiro',
    'qoder-cli': 'Qoder',
    'codebuddy-cli': 'CodeBuddy',
    'qwen-code': 'Qwen Code',
    'trae-cn-cli': 'TRAE CLI',
    'cursor-agent': 'Cursor Agent',
    'kimi-code-cli': 'Kimi Code',
    'minimax-code-cli': 'MiniMax Code',
    'hermes-cli': 'Hermes Agent',
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

type RuntimeEffortOption = {
  key: 'reasoning_effort' | 'effort' | 'thinking_level' | 'thinkingEffort' | 'thought_level'
  label: string
}

export function runtimeEffortOption(adapterKind: string): RuntimeEffortOption {
  const [key, label] = ({
    'claude-code-cli': ['effort', '思考强度'],
    'command-code-cli': ['effort', '思考强度'],
    'kilo-cli': ['effort', '推理强度'],
    'minimax-code-cli': ['thinkingEffort', '思考强度'],
    pi: ['thinking_level', '思考强度'],
    'codebuddy-cli': ['thought_level', '推理强度']
  } as Record<string, [RuntimeEffortOption['key'], string]>)[adapterKind] ?? ['reasoning_effort', '推理强度']
  return { key, label: uiAttribute(label) }
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
  const { key: effortKey, label: effortLabel } = runtimeEffortOption(configuration.adapterKind)
  const effortDescriptor = modelDescriptor?.options.find((option) => option.key === effortKey) ?? null
  const rawEffort = modelSelection.options[effortKey]
  const effort = effortDescriptor || typeof rawEffort === 'string'
    ? {
        label: effortLabel,
        value: typeof rawEffort === 'string' && rawEffort
          ? runtimeEffortValueLabel(rawEffort, effortDescriptor?.values ?? [], configuration.adapterKind)
          : uiAttribute('跟随模型默认值')
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
  choices: Array<{ value: string; label: string }>,
  adapterKind?: string
): string {
  if (adapterKind === 'hermes-cli' && value === 'default') return uiAttribute('跟随模型默认值')
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
  const { key: effortKey, label: effortLabel } = runtimeEffortOption(model.adapterKind)
  const choices = descriptor?.options.find(option => option.key === effortKey)?.values ?? []
  return {
    model: descriptor?.displayName.trim() || model.modelId || uiAttribute('智能体默认'),
    effort: model.reasoningEffort ? {
      label: effortLabel,
      value: runtimeEffortValueLabel(model.reasoningEffort, choices, model.adapterKind)
    } : null
  }
}

export function modelSummary(presentation: Pick<MemberRuntimeConfigurationPresentation, 'model' | 'effort'>): string {
  return presentation.effort ? `${presentation.model} · ${presentation.effort.value}` : presentation.model
}
