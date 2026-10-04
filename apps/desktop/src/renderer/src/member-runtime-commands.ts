import type { AdapterKind, StoredCommandResult } from '@contracts'
import { newCommandId } from '../../shared/command-id'
import { desktopThreadClient } from './desktop-camp-client'
import { openRuntimeModelCatalog } from './runtime-check'
import { uiAttribute } from './interface-language'

// Local to member Runtime saving: one explicit rejection, one awaited catalog
// refresh, one resubmission. The original command (and expectedVersion) is frozen.
export async function submitMemberRuntimeConfiguration(
  command: { adapterKind: AdapterKind },
  request: import('@contracts').RovaiApi['request'] = desktopThreadClient.request
): Promise<StoredCommandResult> {
  const submit = async (): Promise<StoredCommandResult> => {
    try {
      return await request<StoredCommandResult>('members.runtime.set', { commandId: newCommandId(), command })
    } catch (error) {
      console.warn('[member-runtime] submission outcome unknown', error)
      throw new MemberRuntimeCommandError('runtime_save_outcome_unknown')
    }
  }
  const result = await submit()
  if (result.status !== 'rejected' || result.code !== 'runtime_model_catalog_refresh_required') return result
  try {
    const catalog = await openRuntimeModelCatalog(command.adapterKind, request, true)
    if ((catalog.refreshStatus !== 'completed' && catalog.refreshStatus !== 'not_required')
      || (catalog.cache.status !== 'fresh' && catalog.cache.status !== 'stale')) {
      throw new MemberRuntimeCommandError('runtime_model_catalog_refresh_required')
    }
  } catch {
    console.warn('[member-runtime] runtime_model_catalog_refresh_required: refresh did not complete')
    throw new MemberRuntimeCommandError('runtime_model_catalog_refresh_required')
  }
  return submit()
}

export class MemberRuntimeCommandError extends Error {
  constructor(readonly code: string, payload?: StoredCommandResult['payload']) {
    const option = payload ? stringField(payload, 'option') : null
    const label = option && ({ reasoning_effort: '推理强度', effort: '推理强度', thinking_level: '思考深度' } as Record<string, string>)[option]
    super(label && (code === 'runtime_model_option_invalid' || code === 'runtime_model_option_unknown')
      ? uiAttribute("所选模型不支持当前「{0}」设置，请调整该参数。填写内容已保留。", uiAttribute(label))
      : commandCodeLabel(code))
  }
}

export function assertApplied(result: StoredCommandResult): void {
  if (result.status !== 'rejected') return
  if (result.code.startsWith('runtime_') || result.code === 'agent_profile.version_conflict' || result.code === 'version_conflict') {
    console.warn('[member-runtime] command rejected', result.code)
    throw new MemberRuntimeCommandError(result.code, result.payload)
  }
  const detail =
    stringField(result.payload, 'message') ??
    stringField(result.payload, 'detail')
  throw new Error(
    detail
      ? `${commandCodeLabel(result.code)}：${detail}`
      : commandCodeLabel(result.code)
  )
}

export function commandCodeLabel(code: string): string {
  return uiAttribute(
    (
      {
        'agent_profile.display_name_conflict': '该名称已被其他队员使用',
        'agent_profile.version_conflict': '配置已被其他操作更新，请重新载入后确认修改。填写内容已保留。',
        version_conflict: '配置已被其他操作更新，请重新载入后确认修改。填写内容已保留。',
        runtime_model_catalog_refresh_required: '暂时无法验证所选模型，本次修改尚未保存，填写内容已保留。',
        runtime_save_outcome_unknown: '暂时无法确认保存结果，请重新载入后核对配置。填写内容已保留。',
        runtime_model_requires_verification: '运行环境尚未完成验证，请先检查智能体。填写内容已保留。',
        runtime_configuration_unavailable: '当前运行环境不可用，请检查智能体。填写内容已保留。',
        runtime_model_unavailable: '所选模型已不在当前可选列表中，请调整模型选择。填写内容已保留。',
        runtime_model_options_invalid: '所选模型的参数格式无效，请调整模型参数。填写内容已保留。',
        runtime_model_option_unknown: '所选模型不支持此参数，请调整模型参数。填写内容已保留。',
        runtime_model_option_invalid: '所选模型不支持当前参数值，请调整推理强度等模型参数。填写内容已保留。',
        runtime_permission_adapter_mismatch: '权限配置与运行环境不匹配，请重新选择权限。填写内容已保留。',
        runtime_permission_schema_mismatch: '运行环境的权限选项已变化，请重新确认权限。填写内容已保留。',
        runtime_permission_values_invalid: '权限配置格式无效，请重新确认权限。填写内容已保留。',
        runtime_permission_option_unknown: '运行环境不支持此权限选项，请调整权限。填写内容已保留。',
        runtime_permission_option_unsupported: '运行环境不支持此权限选项，请调整权限。填写内容已保留。',
        runtime_permission_option_invalid: '权限选项值无效，请调整权限。填写内容已保留。',
        runtime_permission_value_invalid: '权限选项值无效，请调整权限。填写内容已保留。',
        'agent_profile.default_lead_successor_required':
          '该队员仍是某个会话的默认负责人，请先在对应会话中指定继任者',
        'adapter_installation.already_exists': '这个智能体已经存在',
        'adapter_installation.version_conflict':
          '智能体已被更新，请刷新后重试'
      } as Record<string, string>
    )[code] ?? uiAttribute('操作未完成，请稍后重试；详细原因可在诊断中查看。')
  )
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' ? value[key] as string : null
}
