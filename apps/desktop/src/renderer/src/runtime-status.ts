import { uiAttribute } from './interface-language'
import type {
  AdapterKind,
  AgentProfile,
  HostPlatformKey,
  ProductRuntimeAvailability,
  RuntimePlatformAdmission
} from '@contracts'

export type RuntimeUserStatus =
  | 'unconfigured'
  | 'checking'
  | 'available'
  | 'authentication_required'
  | 'not_installed'
  | 'version_unsupported'
  | 'unavailable'
  | 'not_qualified'
  | 'unsupported'
  | 'unknown'

export interface RuntimeStatusPresentation {
  status: RuntimeUserStatus
  label: string
  detail: string | null
}

function publicFailureDetail(
  availability: ProductRuntimeAvailability,
  fallback: string
): string {
  const failure = availability.failure
  if (!failure) return fallback
  const detail = failure.detail?.trim()
  return detail && detail !== failure.summary
    ? `${failure.summary}\n${detail}`
    : failure.summary
}

function incompatibleRuntimeDetail(availability: ProductRuntimeAvailability): string {
  const fallback = availability.reportedVersion
    ? uiAttribute('当前版本 {0} 不受支持，请更新后重试。', availability.reportedVersion)
    : uiAttribute('当前版本或必要能力不受支持，请更新后重试。')
  const detail = publicFailureDetail(availability, fallback)
  if (availability.runtimeKind !== 'deepseek-harness' || detail.includes('0.1.5-rc.2')) {
    return detail
  }
  return `${detail}\n${uiAttribute('DeepSeek Harness 需要 0.1.5-rc.2 或更高版本。')}`
}

const STATUS_LABELS: Record<RuntimeUserStatus, string> = {
  unconfigured: '未配置智能体',
  checking: '正在检查…',
  available: '可用',
  authentication_required: '需要登录',
  not_installed: '未检测到',
  version_unsupported: '版本不支持',
  unavailable: '不可用',
  not_qualified: '当前平台尚未验证',
  unsupported: '此平台不支持',
  unknown: '暂时无法确认'
}

function presentation(
  status: RuntimeUserStatus,
  detail: string | null = null
): RuntimeStatusPresentation {
  return { status, label: uiAttribute(STATUS_LABELS[status]), detail }
}

export function runtimeAvailabilityPresentation(
  availability: ProductRuntimeAvailability | null,
  pending = false
): RuntimeStatusPresentation {
  if (!availability) {
    return pending
      ? presentation('checking')
      : presentation('unknown', uiAttribute('尚无最近一次检查结果，系统将在后台继续确认。'))
  }

  switch (availability.status) {
    case 'detecting':
    case 'checking':
      return presentation('checking')
    case 'found_uninspected':
      return presentation(
        'unknown',
        uiAttribute('已找到可执行文件，但轻度启动验证尚未形成有效结果。')
      )
    case 'light_ready':
      return presentation(
        'available',
        uiAttribute('已通过轻度启动验证；登录、模型与运行能力将在检查或首次任务时确认。')
      )
    case 'installed_unverified':
      return presentation(
        'unknown',
        uiAttribute('旧安装尚未形成轻度启动证据；请重新检测或检查状态。')
      )
    case 'ready':
      if (availability.runtimeKind === 'zcode-app') {
        return presentation(
          'available',
          uiAttribute('已加载本机原生配置并连接成功；本次检查未调用模型，生成能力、余额和高级能力将在实际任务中确认。')
        )
      }
      return presentation(
        'available',
        availability.checking ? uiAttribute('正在后台刷新最近一次检查结果。') : null
      )
    case 'refresh_failed_using_last_success':
      return presentation(
        'available',
        uiAttribute('后台刷新失败，当前继续使用最近一次可用结果。')
      )
    case 'authentication_required':
      return presentation(
        'authentication_required',
        publicFailureDetail(availability, uiAttribute('请先完成该智能体的登录。'))
      )
    case 'needs_attention':
      return {
        status: 'unavailable',
        label: uiAttribute('需要处理'),
        detail: publicFailureDetail(
          availability,
          uiAttribute('最近一次智能体验证未完成，请重试扫描或检查，并按诊断提示处理。')
        )
      }
    case 'missing':
    case 'path_missing':
      return presentation(
        'not_installed',
        publicFailureDetail(availability, uiAttribute('本机未找到可用的智能体入口。'))
      )
    case 'incompatible':
      return presentation(
        'version_unsupported',
        incompatibleRuntimeDetail(availability)
      )
    case 'disabled':
      return presentation('unavailable', uiAttribute('该智能体已停用。'))
  }
}

export function runtimePlatformAdmissionFor(
  hostPlatform: HostPlatformKey | null,
  admissions: readonly RuntimePlatformAdmission[],
  runtimeKind: AdapterKind
): RuntimePlatformAdmission | null {
  if (!hostPlatform) return null
  return admissions.find((row) => (
    row.platform === hostPlatform && row.runtimeKind === runtimeKind
  )) ?? null
}

export function runtimePlatformAdmissionAllowsUse(
  admission: RuntimePlatformAdmission | null
): boolean {
  return admission?.status === 'qualified' || admission?.status === 'preview'
}

export function runtimeProductPresentation(
  admission: RuntimePlatformAdmission | null,
  availability: ProductRuntimeAvailability | null,
  pending = false
): RuntimeStatusPresentation {
  if (!admission) {
    return pending
      ? presentation('checking')
      : presentation('unknown', uiAttribute('尚无当前平台的智能体准入信息。'))
  }
  if (admission.status === 'not_qualified') {
    const windows = admission.platform === 'windows-x64'
    return {
      status: 'not_qualified',
      label: windows ? uiAttribute('Windows 尚未验证') : uiAttribute('当前平台尚未验证'),
      detail: windows
        ? uiAttribute('该智能体尚未完成 Windows 资格验证；这不是本机安装、登录或扫描故障。')
        : uiAttribute('该智能体尚未完成当前平台资格验证；这不是本机安装、登录或扫描故障。')
    }
  }
  if (admission.status === 'unsupported') {
    return presentation('unsupported', uiAttribute('该智能体不支持当前平台。'))
  }
  const availabilityPresentation = runtimeAvailabilityPresentation(availability, pending)
  if (admission.status !== 'preview') return availabilityPresentation
  const previewDetail = uiAttribute('当前平台已开放使用，完整的平台资格验证记录尚未齐备。')
  return {
    ...availabilityPresentation,
    detail: availabilityPresentation.detail
      ? `${previewDetail}\n${availabilityPresentation.detail}`
      : previewDetail
  }
}

export function memberRuntimePresentation(
  agent: AgentProfile,
  selectedRuntimeKind: AdapterKind | null,
  availability: ProductRuntimeAvailability | null,
  pending = false,
  admission: RuntimePlatformAdmission | null = null,
  platformAdmissionKnown = false
): RuntimeStatusPresentation {
  if (!selectedRuntimeKind) return presentation('unconfigured')

  const availabilityStatus = admission || platformAdmissionKnown
    ? runtimeProductPresentation(admission, availability, pending)
    : runtimeAvailabilityPresentation(availability, pending)
  const isPersistedSelection =
    selectedRuntimeKind === agent.runtimeConfiguration?.adapterKind

  if (!isPersistedSelection) return availabilityStatus

  if (agent.runtimeReadiness.status === 'ready') {
    if (
      availabilityStatus.status === 'authentication_required'
      || availabilityStatus.status === 'not_installed'
      || availabilityStatus.status === 'version_unsupported'
      || availabilityStatus.status === 'unavailable'
      || availabilityStatus.status === 'not_qualified'
      || availabilityStatus.status === 'unsupported'
    ) {
      return availabilityStatus
    }
    return presentation(
      'available',
      availabilityStatus.status === 'checking'
        ? uiAttribute('正在后台刷新最近一次检查结果。')
        : availabilityStatus.detail
    )
  }

  if (agent.runtimeReadiness.status === 'light_ready') {
    if (
      availabilityStatus.status === 'authentication_required'
      || availabilityStatus.status === 'not_installed'
      || availabilityStatus.status === 'version_unsupported'
      || availabilityStatus.status === 'unavailable'
      || availabilityStatus.status === 'not_qualified'
      || availabilityStatus.status === 'unsupported'
    ) {
      return availabilityStatus
    }
    return presentation(
      'available',
      uiAttribute('当前配置可用于发起任务；登录、模型与运行能力将在任务的执行前检查中确认。')
    )
  }

  const blockerCodes = new Set(
    agent.runtimeReadiness.blockers.map((blocker) => blocker.code)
  )
  if (
    agent.runtimeReadiness.status === 'installed_unverified'
    || blockerCodes.has('runtime_verification_deferred')
  ) {
    if (
      availabilityStatus.status === 'authentication_required'
      || availabilityStatus.status === 'not_installed'
      || availabilityStatus.status === 'version_unsupported'
      || availabilityStatus.status === 'unavailable'
      || availabilityStatus.status === 'not_qualified'
      || availabilityStatus.status === 'unsupported'
    ) {
      return availabilityStatus
    }
    return presentation(
      'unknown',
      uiAttribute('旧安装尚未形成轻度启动证据；请重新检测或检查状态。')
    )
  }
  if (blockerCodes.has('runtime_authentication_required')) {
    return presentation('authentication_required', uiAttribute('请先完成该智能体的登录。'))
  }

  if (agent.runtimeReadiness.status === 'needs_attention') {
    const environmentBlocker = [
      'runtime_probe_required',
      'runtime_snapshot_stale',
      'adapter_installation_missing',
      'adapter_installation_disabled'
    ].some((code) => blockerCodes.has(code))
    if (!environmentBlocker) {
      return presentation(
        'unavailable',
        uiAttribute('当前配置已失效，请检查模型、参数或权限后重新保存。')
      )
    }
  }

  if (
    availabilityStatus.status !== 'available'
    && availabilityStatus.status !== 'unknown'
  ) {
    return availabilityStatus
  }

  if (agent.runtimeReadiness.status === 'needs_attention') {
    return presentation(
      'unavailable',
      uiAttribute('当前配置已失效，请检查模型、参数或权限后重新保存。')
    )
  }
  return presentation('unavailable')
}

export function runtimeReadinessLabel(
  status: AgentProfile['runtimeReadiness']['status']
): string {
  return ({
    runtime_not_configured: uiAttribute('未配置智能体'),
    needs_attention: uiAttribute('不可用'),
    light_ready: uiAttribute('可用'),
    installed_unverified: uiAttribute('不可用，待检查'),
    ready: uiAttribute('可用')
  })[status]
}
