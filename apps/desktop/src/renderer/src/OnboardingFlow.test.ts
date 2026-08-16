import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AdapterInstallation, OnboardingSnapshot, ProductRuntimeAvailability } from '@contracts'
import {
  OnboardingFlow,
  onboardingRuntimeCanContinue,
  onboardingRuntimeSelectionFor
} from './OnboardingFlow'

type InProgress = Extract<OnboardingSnapshot, { status: 'in_progress' }>

describe('first-run onboarding flow', () => {
  it('renders a mandatory welcome without skip or decorative progress navigation', () => {
    const markup = renderOnboarding(snapshot('welcome'))
    expect(markup).toContain('欢迎来到 Rovai')
    expect(markup).toContain('开始旅程')
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
    expect(markup).toContain('和芝士一起开始')
  })

  it('shows the three actual discovery phases before Runtime selection', () => {
    const markup = renderOnboarding({
      ...snapshot('runtime'),
      selectedMemberRole: 'luoke'
    }, 'checking')
    expect(markup).toContain('查找已安装的 Agent 运行时')
    expect(markup).toContain('检查登录与版本')
    expect(markup).toContain('读取模型目录')
    expect(markup).not.toContain('跳过')
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
  })
})

function renderOnboarding(
  value: InProgress,
  runtimePhase: 'idle' | 'discovering' | 'checking' | 'models' | 'ready' | 'error' = 'idle'
): string {
  return renderToStaticMarkup(createElement(OnboardingFlow, {
    snapshot: value,
    appearance: {
      preference: 'system',
      resolvedTheme: 'day'
    },
    health: null,
    installations: [],
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
    onRuntimeSelectionChange: () => undefined,
    onComplete: () => undefined
  }))
}

function snapshot(step: InProgress['step']): InProgress {
  return {
    schemaVersion: 1,
    status: 'in_progress',
    step,
    selectedMemberRole: step === 'welcome' ? null : 'luoke',
    runtimeSelection: null,
    provisioning: null
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
      searchGeneration: 1,
      observedAt: '2026-08-17T00:00:00.000Z',
      diagnosticCode: null
    },
    installationId: 'managed-codex',
    reportedVersion: '1.0.0',
    diagnosticCode: null
  }
}
