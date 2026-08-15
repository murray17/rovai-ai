import { describe, expect, it } from 'vitest'
import type {
  AdapterKind,
  AgentProfile,
  ProductRuntimeAvailability,
  ProductRuntimeAvailabilityStatus
} from '@contracts'
import {
  memberRuntimePresentation,
  runtimeAvailabilityPresentation,
  runtimeReadinessLabel
} from './runtime-status'

describe('Runtime user status projection', () => {
  it.each([
    ['detecting', '正在检查…'],
    ['found_uninspected', '正在检查…'],
    ['installed_unverified', '已安装'],
    ['checking', '正在检查…'],
    ['ready', '可用'],
    ['authentication_required', '需要登录'],
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

  it('uses an unknown result for a failed unregistered check instead of exposing discovery state', () => {
    const result = runtimeAvailabilityPresentation({
      ...availability('found_uninspected'),
      checking: false,
      diagnosticCode: 'runtime_probe_transient_failure'
    })

    expect(result.label).toBe('暂时无法确认')
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
    expect(runtimeReadinessLabel('installed_unverified')).toBe('已安装，待首次运行验证')
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
    expect(result.detail).toContain('首次实际任务中验证')
  })
})

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
    diagnosticCode: null
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
