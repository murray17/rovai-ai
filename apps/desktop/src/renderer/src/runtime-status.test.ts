import { describe, expect, it } from 'vitest'
import type {
  AdapterKind,
  AgentProfile,
  ProductRuntimeAvailability,
  ProductRuntimeAvailabilityStatus,
  RuntimePlatformAdmission
} from '@contracts'
import {
  memberRuntimePresentation,
  runtimePlatformAdmissionFor,
  runtimeAvailabilityPresentation,
  runtimeProductPresentation,
  runtimeReadinessLabel
} from './runtime-status'

describe('Runtime user status projection', () => {
  it.each([
    ['detecting', '正在检查…'],
    ['found_uninspected', '暂时无法确认'],
    ['light_ready', '可用'],
    ['installed_unverified', '已安装'],
    ['checking', '正在检查…'],
    ['ready', '可用'],
    ['authentication_required', '需要登录'],
    ['needs_attention', '需要处理'],
    ['missing', '未安装'],
    ['path_missing', '未安装'],
    ['incompatible', '版本不支持'],
    ['disabled', '不可用'],
    ['refresh_failed_using_last_success', '可用']
  ] satisfies Array<[ProductRuntimeAvailabilityStatus, string]>)(
    'maps %s to the actionable status %s',
    (status, label) => {
      expect(runtimeAvailabilityPresentation(availability(status)).label).toBe(label)
    }
  )

  it('keeps a cached ready result usable while Core refreshes it', () => {
    const result = runtimeAvailabilityPresentation({
      ...availability('ready'),
      checking: true
    })

    expect(result).toEqual({
      status: 'available',
      label: '可用',
      detail: '正在后台刷新最近一次检查结果。'
    })
  })

  it('does not project an uninspected executable as checking or light-ready', () => {
    const result = runtimeAvailabilityPresentation({
      ...availability('found_uninspected'),
      checking: false,
      diagnosticCode: 'runtime_probe_transient_failure'
    })

    expect(result).toEqual({
      status: 'unknown',
      label: '暂时无法确认',
      detail: '已找到可执行文件，但轻度启动验证尚未形成有效结果。'
    })
  })

  it('uses a safe public failure instead of the generic availability fallback', () => {
    const result = runtimeAvailabilityPresentation({
      ...availability('needs_attention', 'claude-code-cli'),
      failure: {
        runtimeKind: 'claude-code-cli',
        origin: 'runtime',
        phase: 'terminal',
        code: 'runtime_rate_limited',
        summary: '请求受到速率限制',
        detail: '请稍后重试。',
        retryable: true
      }
    })

    expect(result).toEqual({
      status: 'unavailable',
      label: '需要处理',
      detail: '请求受到速率限制\n请稍后重试。'
    })
    expect(result.detail).not.toContain('最近一次 Runtime 验证未完成')
  })

  it('keeps an unsaved editor selection in product availability state', () => {
    const agent = {
      ...profile({
        status: 'runtime_not_configured',
        blockers: [{ code: 'runtime_not_configured', detail: null }]
      }),
      runtimeConfiguration: null
    }

    expect(memberRuntimePresentation(
      agent,
      'kiro-cli',
      availability('ready')
    )).toEqual({
      status: 'available',
      label: '可用',
      detail: null
    })
  })

  it('uses the same outcome vocabulary for member list readiness', () => {
    expect(runtimeReadinessLabel('ready')).toBe('可用')
    expect(runtimeReadinessLabel('runtime_not_configured')).toBe('未配置 Agent 运行时')
    expect(runtimeReadinessLabel('needs_attention')).toBe('不可用')
    expect(runtimeReadinessLabel('light_ready')).toBe('可用')
    expect(runtimeReadinessLabel('installed_unverified')).toBe('已安装，待检查')
  })

  it('presents deferred TRAE verification without claiming readiness', () => {
    const traeAvailability = availability('installed_unverified', 'trae-cn-cli')
    const agent = {
      ...profile({
        status: 'installed_unverified',
        blockers: [{ code: 'runtime_verification_deferred', detail: null }]
      }),
      runtimeConfiguration: {
        adapterKind: 'trae-cn-cli' as const,
        model: { mode: 'runtime_default' as const },
        permissions: {
          adapterKind: 'trae-cn-cli' as const,
          schemaVersion: 1,
          values: { permission_mode: 'default' }
        }
      }
    }

    const result = memberRuntimePresentation(
      agent,
      'trae-cn-cli',
      traeAvailability
    )
    expect(result.status).toBe('installed_unverified')
    expect(result.label).toBe('已安装')
    expect(result.detail).toContain('请重新检测或检查可用性')
  })

  it('keeps Windows not-qualified distinct from machine availability', () => {
    const admission = windowsAdmission('kiro-cli')

    expect(runtimeProductPresentation(admission, null)).toEqual({
      status: 'not_qualified',
      label: 'Windows 尚未验证',
      detail: '该 Agent 运行时尚未完成 Windows 资格验证；这不是本机安装、登录或扫描故障。'
    })
    expect(runtimePlatformAdmissionFor(
      'windows-x64',
      [admission],
      'kiro-cli'
    )).toEqual(admission)
  })

  it('does not let persisted ready evidence override a denied platform row', () => {
    const result = memberRuntimePresentation(
      profile({ status: 'ready', blockers: [] }),
      'kiro-cli',
      availability('ready'),
      false,
      windowsAdmission('kiro-cli'),
      true
    )

    expect(result.status).toBe('not_qualified')
    expect(result.label).toBe('Windows 尚未验证')
  })
})

function windowsAdmission(runtimeKind: AdapterKind): RuntimePlatformAdmission {
  return {
    runtimeKind,
    platform: 'windows-x64',
    status: 'not_qualified',
    reasonCode: 'runtime_platform.qualification_evidence_missing',
    evidenceRevision: null
  }
}

function availability(
  status: ProductRuntimeAvailabilityStatus,
  runtimeKind: AdapterKind = 'kiro-cli'
): ProductRuntimeAvailability {
  const found = !['detecting', 'missing', 'path_missing'].includes(status)
  return {
    runtimeKind,
    status,
    checking: status === 'detecting' || status === 'checking',
    discovery: {
      runtimeKind,
      discoveryStatus: status === 'detecting' ? 'detecting' : found ? 'found' : 'missing',
      executablePath: found ? '/opt/homebrew/bin/kiro-cli' : null,
      source: found ? 'inherited_path' : null,
      reportedVersion: found ? 'kiro-cli 2.15.1' : null,
      executableFingerprint: found ? 'sha256:kiro' : null,
      searchGeneration: 1,
      observedAt: '2026-07-31T00:00:00Z',
      diagnosticCode: null
    },
    installationId: status === 'ready' ? 'installation-kiro' : null,
    reportedVersion: found ? 'kiro-cli 2.15.1' : null,
    diagnosticCode: null,
    failure: null
  }
}

function profile(
  runtimeReadiness: AgentProfile['runtimeReadiness']
): AgentProfile {
  return {
    agentId: 'agent-kiro',
    displayName: 'Kiro',
    avatarRef: null,
    accent: null,
    teamRole: '',
    professionalResponsibilities: 'Runtime status test',
    personalityTraits: [],
    workingPrinciples: '',
    growthTopic: '',
    defaultCapabilities: [],
    presence: 'present',
    runtimeConfiguration: {
      adapterKind: 'kiro-cli',
      model: { mode: 'runtime_default' },
      permissions: { adapterKind: 'kiro-cli', schemaVersion: 1, values: {} }
    },
    runtimeReadiness,
    memberOrder: 0,
    version: 1,
    createdAt: '2026-07-31T00:00:00Z',
    updatedAt: '2026-07-31T00:00:00Z',
    removedAt: null
  }
}
