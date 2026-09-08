import { DEFAULT_APPEARANCE } from '../../shared/appearance'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  AdapterInstallation,
  HealthStatus,
  OnboardingSnapshot,
  ProductRuntimeAvailability,
  RuntimePlatformAdmission,
  RuntimeModelCatalogView
} from '@contracts'
import {
  OnboardingFlow,
  onboardingHasUsableRuntime,
  onboardingRuntimeCanContinue,
  onboardingRuntimeSelectionFor
} from './OnboardingFlow'

type InProgress = Extract<OnboardingSnapshot, { status: 'in_progress' }>

describe('first-run onboarding flow', () => {
  it('renders a mandatory welcome without skip or decorative progress navigation', () => {
    const markup = renderOnboarding(snapshot('welcome'))
    expect(markup).toContain('欢迎来到 Rovai')
    expect(markup).toContain('选择队员')
    expect(markup).not.toContain('跳过')
    expect(markup).not.toContain('onboarding-step')
  })

  it('uses one selected portrait and a four-row text roster', () => {
    const markup = renderOnboarding({
      ...snapshot('member'),
      selectedMemberRole: 'muwa'
    })
    expect(markup.match(/onboarding-selected-portrait/g)).toHaveLength(1)
    expect(markup.match(/class="onboarding-member-row"/g)).toHaveLength(4)
    expect(markup).not.toContain('onboarding-member-row-portrait')
    expect(markup).toContain('下一步')
  })

  it('describes discovery without promising login or model validation', () => {
    const markup = renderOnboarding({
      ...snapshot('runtime'),
      selectedMemberRole: 'luoke'
    }, 'checking')
    expect(markup).toContain('查找安装入口')
    expect(markup).toContain('确认运行时身份')
    expect(markup).toContain('读取运行配置')
    expect(markup).not.toContain('检查登录与版本')
    expect(markup).not.toContain('读取模型目录')
    expect(markup).not.toContain('跳过')
  })

  it('shows the deferred Runtime page when a completed scan has no usable Runtime', () => {
    const markup = renderOnboarding({
      ...snapshot('runtime'),
      selectedMemberRole: 'luoke'
    }, 'ready', emptyHealth())
    expect(markup).toContain('暂未找到可用的运行时')
    expect(markup).toContain('查看安装引导')
    expect(markup).toContain('重新扫描')
    expect(markup).toContain('稍后配置')
    expect(markup).toContain('Codex CLI')
    expect(markup).toContain('Claude Code')
    expect(markup).toContain('Antigravity')
    expect(markup).toContain('https://code.claude.com/docs/en/setup')
    expect(markup).not.toContain('onboarding-runtime-list')
    expect(markup).not.toContain('onboarding-model-panel')
  })

  it('keeps the normal Runtime selection when at least one Runtime can continue', () => {
    const installation = codexInstallation()
    const health = healthWithRuntime(readyAvailability(), qualifiedAdmission())
    const markup = renderOnboarding({
      ...snapshot('runtime'),
      selectedMemberRole: 'luoke'
    }, 'ready', health, [installation])
    expect(markup).toContain('onboarding-runtime-list')
    expect(markup).toContain('onboarding-model-panel')
    expect(markup).not.toContain('暂未找到可用的运行时')
    expect(markup).not.toContain('Cursor Agent')
    expect(onboardingHasUsableRuntime('ready', health, [installation])).toBe(true)
    expect(onboardingHasUsableRuntime('error', health, [installation])).toBe(false)
    expect(onboardingHasUsableRuntime('ready', emptyHealth(), [])).toBe(false)
  })

  it.each(['ready', 'light_ready'] as const)('keeps experimental admission visible for a %s Runtime', (status) => {
    const health = healthWithRuntime({ ...readyAvailability(), status }, previewAdmission())
    const markup = renderOnboarding(snapshot('runtime'), 'ready', health, [codexInstallation()])
    expect(onboardingHasUsableRuntime('ready', health, [codexInstallation()])).toBe(true)
    expect(markup).toContain('<small>实验性开放；当前平台尚未完成正式资格验证')
  })

  it('keeps a failed scan distinct from a completed scan even with stale usable health', () => {
    const markup = renderOnboarding(snapshot('runtime'), 'error',
      healthWithRuntime(readyAvailability(), qualifiedAdmission()), [codexInstallation()])
    expect(markup).toContain('这次扫描未完成')
    expect(markup).toContain('重新扫描')
    expect(markup).toContain('稍后配置')
    expect(markup).not.toContain('暂未找到可用的运行时')
    expect(markup).not.toContain('onboarding-model-panel')
  })

  it('continues only with a usable Runtime, a model, and matching adapter defaults', () => {
    const installation = codexInstallation()
    const selection = onboardingRuntimeSelectionFor('codex-cli', [installation])
    expect(selection).toEqual({ adapterKind: 'codex-cli', model: { mode: 'runtime_default' } })
    expect(onboardingRuntimeCanContinue('ready', selection, readyAvailability(), installation)).toBe(true)
    expect(onboardingRuntimeCanContinue('checking', selection, readyAvailability(), installation)).toBe(false)
    expect(onboardingRuntimeCanContinue('ready', { ...selection, model: null }, readyAvailability(), installation)).toBe(false)
    expect(onboardingRuntimeCanContinue('ready', {
      adapterKind: 'codex-cli',
      model: { mode: 'explicit', modelId: 'missing-model', options: {} }
    }, readyAvailability(), installation)).toBe(false)
    expect(onboardingRuntimeCanContinue('ready', selection, readyAvailability(), {
      ...installation,
      installationClass: 'custom'
    })).toBe(false)
    expect(onboardingRuntimeCanContinue(
      'ready',
      selection,
      readyAvailability(),
      installation,
      windowsNotQualifiedAdmission()
    )).toBe(false)
    expect(onboardingRuntimeCanContinue(
      'ready',
      selection,
      readyAvailability(),
      installation,
      previewAdmission()
    )).toBe(true)
    expect(onboardingRuntimeCanContinue('ready', selection, {
      ...readyAvailability(),
      status: 'installed_unverified'
    }, installation)).toBe(false)
  })
})

function windowsNotQualifiedAdmission(): RuntimePlatformAdmission {
  return {
    runtimeKind: 'codex-cli',
    platform: 'windows-x64',
    status: 'not_qualified',
    reasonCode: 'runtime_platform.qualification_evidence_missing',
    evidenceRevision: null
  }
}

function previewAdmission(): RuntimePlatformAdmission {
  return {
    runtimeKind: 'codex-cli',
    platform: 'macos-arm64',
    status: 'preview',
    reasonCode: 'runtime_platform.qualification_evidence_missing',
    evidenceRevision: null
  }
}

function renderOnboarding(
  value: InProgress,
  runtimePhase: 'idle' | 'discovering' | 'checking' | 'models' | 'ready' | 'error' = 'idle',
  health: HealthStatus | null = null,
  installations: AdapterInstallation[] = []
): string {
  return renderToStaticMarkup(createElement(OnboardingFlow, {
    snapshot: value,
    appearance: {
      ...DEFAULT_APPEARANCE,
      preference: 'system',
      resolvedTheme: 'day'
    },
    health,
    installations,
    runtimePhase,
    busy: false,
    error: null,
    onThemeChange: () => undefined,
    onShowWelcome: () => undefined,
    onCompleteWelcome: () => undefined,
    onSelectMember: () => undefined,
    onShowMemberSelection: () => undefined,
    onCompleteMemberSelection: () => undefined,
    onRefreshRuntime: () => undefined,
    onOpenModelCatalog: async (): Promise<RuntimeModelCatalogView> => ({
      runtimeKind: 'codex-cli',
      cache: {
        status: 'unavailable',
        observedAt: null,
        revalidateAfter: null,
        expiresAt: null
      },
      models: [],
      refreshStatus: 'failed',
      diagnosticCode: null
    }),
    onRuntimeSelectionChange: () => undefined,
    onDeferRuntime: () => undefined,
    onComplete: () => undefined
  }))
}

function snapshot(step: InProgress['step']): InProgress {
  return {
    schemaVersion: 2,
    status: 'in_progress',
    step,
    selectedMemberRole: step === 'welcome' ? null : 'luoke',
    runtimeSelection: null,
    provisioning: null
  }
}

function emptyHealth(): HealthStatus {
  return healthWithRuntime(null, null)
}

function healthWithRuntime(
  availability: ProductRuntimeAvailability | null,
  admission: RuntimePlatformAdmission | null
): HealthStatus {
  return {
    core: { ok: true, version: 'test', dataDir: '/tmp/rovai' },
    database: { ok: true, path: '/tmp/rovai/rovai.sqlite' },
    git: { installed: false, version: null },
    hostPlatform: 'macos-arm64',
    runtimeCatalog: [],
    runtimePlatformAdmission: admission ? [admission] : [],
    runtimeAvailability: availability ? [availability] : [],
    searchEnvironment: {
      generation: 1,
      createdAt: '2026-08-23T00:00:00.000Z',
      pathEntryCount: 0,
      shell: {
        status: 'captured',
        interactive: true,
        shellName: 'zsh',
        entryCount: 0,
        elapsedMillis: 0
      }
    }
  }
}

function qualifiedAdmission(): RuntimePlatformAdmission {
  return {
    runtimeKind: 'codex-cli',
    platform: 'macos-arm64',
    status: 'qualified',
    reasonCode: null,
    evidenceRevision: 'test'
  }
}

function codexInstallation(): AdapterInstallation {
  return {
    id: 'managed-codex',
    adapterKind: 'codex-cli',
    executablePath: '/usr/local/bin/codex',
    commandName: 'codex',
    installationClass: 'managed_default',
    source: 'inherited_path',
    authScope: 'default',
    enabled: true,
    generation: 1,
    pathState: 'valid',
    version: 1,
    referencedProfileCount: 0,
    snapshot: null,
    modelCatalog: {
      status: 'unavailable', observedAt: null, revalidateAfter: null, expiresAt: null
    },
    memberRuntimeDefaults: {
      adapterKind: 'codex-cli',
      model: { mode: 'runtime_default' },
      permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: {} }
    },
    lastProbeAttempt: null,
    relocationHistory: [],
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z'
  }
}

function readyAvailability(): ProductRuntimeAvailability {
  return {
    runtimeKind: 'codex-cli',
    status: 'ready',
    checking: false,
    discovery: {
      runtimeKind: 'codex-cli',
      discoveryStatus: 'found',
      executablePath: '/usr/local/bin/codex',
      source: 'inherited_path',
      reportedVersion: '1.0.0',
      executableFingerprint: 'fingerprint',
      searchPathSource: 'inherited_path',
      entrypointKind: 'native_executable',
      candidateExtension: 'native',
      resolvedNativeTarget: false,
      versionProbeSucceeded: true,
      searchGeneration: 1,
      observedAt: '2026-08-17T00:00:00.000Z',
      diagnosticCode: null
    },
    installationId: 'managed-codex',
    reportedVersion: '1.0.0',
    diagnosticCode: null,
    failure: null
  }
}
