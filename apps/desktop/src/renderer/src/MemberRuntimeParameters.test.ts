import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  AdapterInstallation,
  AdapterKind,
  PermissionOptionDescriptor,
  RuntimeModelCatalogView
} from '@contracts'
import {
  MemberModelParameters,
  MemberRuntimeParameters,
  draftFromDefaults,
  displayableInstallationModels,
  explicitSelection,
  liveCatalogIsAtLeastAsRecent,
  modelCatalogCanValidateOptions,
  modelCatalogStatusCopy,
  runtimeDraftForMember,
  runtimeModelSelectionAvailable,
  runtimeEditorInstallation
} from './MemberRuntimeParameters'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

describe('runtime model catalog source', () => {
  it('keeps expired same-environment history displayable without accepting invalidated history', () => {
    const installation = runtimeInstallation('codex-cli')
    installation.modelCatalog.status = 'expired'
    expect(displayableInstallationModels(installation)).toEqual(installation.snapshot!.models)
    installation.modelCatalog.status = 'invalidated'
    expect(displayableInstallationModels(installation)).toEqual([])
    installation.modelCatalog.status = 'expired'
    installation.snapshot!.probeStatus = 'light_ready'
    expect(displayableInstallationModels(installation)).toEqual([])
  })
  const installation = runtimeInstallation('copilot-cli')
  const cached: RuntimeModelCatalogView = {
    runtimeKind: 'copilot-cli',
    cache: { ...installation.modelCatalog, status: 'stale' },
    models: installation.snapshot!.models,
    refreshStatus: 'scheduled',
    diagnosticCode: null
  }
  const refreshed: RuntimeModelCatalogView = {
    ...cached,
    cache: { ...cached.cache, status: 'fresh', observedAt: '2026-07-31T00:02:00Z' },
    refreshStatus: 'completed'
  }

  it('lets a background installation update replace the cached response', () => {
    expect(liveCatalogIsAtLeastAsRecent(cached, cached.cache)).toBe(true)
    expect(liveCatalogIsAtLeastAsRecent(cached, refreshed.cache)).toBe(false)
  })

  it('uses a newer response before the installation update arrives', () => {
    expect(liveCatalogIsAtLeastAsRecent(refreshed, cached.cache)).toBe(true)
  })

  it('does not let a late older response replace an already refreshed installation', () => {
    expect(liveCatalogIsAtLeastAsRecent(refreshed, refreshed.cache)).toBe(true)
    expect(liveCatalogIsAtLeastAsRecent(cached, refreshed.cache)).toBe(false)
  })

  it.each(['scheduled', 'joined', 'deferred'] as const)(
    'keeps the live %s status when observations are equal',
    (refreshStatus) => {
      expect(liveCatalogIsAtLeastAsRecent({ ...cached, refreshStatus }, cached.cache)).toBe(true)
    }
  )

  it('uses the installation until a live response exists and handles missing observations', () => {
    const unavailableCache = { ...cached.cache, status: 'unavailable' as const, observedAt: null }
    const unavailable = { ...cached, cache: unavailableCache }
    expect(liveCatalogIsAtLeastAsRecent(null, cached.cache)).toBe(false)
    expect(liveCatalogIsAtLeastAsRecent(unavailable, cached.cache)).toBe(false)
    expect(liveCatalogIsAtLeastAsRecent(refreshed, unavailableCache)).toBe(true)
    expect(liveCatalogIsAtLeastAsRecent(unavailable, unavailableCache)).toBe(true)
  })

  it('does not let a local status validate an observation Core has expired', () => {
    const expiredCache = { ...cached.cache, status: 'expired' as const }
    expect(liveCatalogIsAtLeastAsRecent(cached, expiredCache)).toBe(true)
    expect(modelCatalogCanValidateOptions(expiredCache, cached)).toBe(false)
    expect(modelCatalogCanValidateOptions(expiredCache, { ...cached, cache: { ...cached.cache, status: 'fresh' } })).toBe(false)
    expect(modelCatalogCanValidateOptions(expiredCache, refreshed)).toBe(true)
    expect(modelCatalogCanValidateOptions(cached.cache, refreshed)).toBe(true)
    expect(modelCatalogCanValidateOptions(refreshed.cache, cached)).toBe(true)
  })
})

describe('explicit model changes', () => {
  const installation = runtimeInstallation('codex-cli')
  const model = {
    ...installation.snapshot!.models[0],
    id: 'runtime/next',
    options: [{
      ...installation.snapshot!.models[0].options[0],
      values: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }],
      defaultValue: 'low'
    }]
  }

  it('carries only explicit key and value pairs supported by the new model', () => {
    expect(explicitSelection(model, {
      mode: 'explicit', modelId: 'runtime/model', options: { reasoning_effort: 'high' }
    }, true)).toEqual({ mode: 'explicit', modelId: 'runtime/next', options: { reasoning_effort: 'high' } })
    expect(explicitSelection(model, {
      mode: 'explicit', modelId: 'runtime/model', options: { reasoning_effort: 'xhigh' }
    }, true)).toEqual({ mode: 'explicit', modelId: 'runtime/next', options: {} })
    expect(explicitSelection({ ...model, options: [] }, {
      mode: 'explicit', modelId: 'runtime/model', options: { reasoning_effort: 'high' }
    }, true)).toEqual({ mode: 'explicit', modelId: 'runtime/next', options: {} })
    expect(explicitSelection(model, {
      mode: 'explicit', modelId: 'runtime/model', options: { effort: 'high' }
    }, true)).toEqual({ mode: 'explicit', modelId: 'runtime/next', options: {} })
    expect(explicitSelection(model, { mode: 'runtime_default' }, true)).toEqual({
      mode: 'explicit', modelId: 'runtime/next', options: {}
    })
  })

  it('retains an explicit value while an expired historical catalog cannot verify the new model', () => {
    expect(explicitSelection({ ...model, options: [] }, {
      mode: 'explicit', modelId: 'runtime/model', options: { reasoning_effort: 'high' }
    }, false)).toEqual({
      mode: 'explicit', modelId: 'runtime/next', options: { reasoning_effort: 'high' }
    })
  })
})

describe('member runtime parameters', () => {
  it('presents a superseded refresh as a temporary Runtime update, not a failure', () => {
    const cache = runtimeInstallation('copilot-cli').modelCatalog

    expect(modelCatalogStatusCopy(cache, {
      loading: false,
      refreshFailed: false,
      servingCachedModels: true,
      refreshStatus: 'deferred'
    })).toBe('运行环境正在更新，继续显示上次成功结果')
    expect(modelCatalogStatusCopy(cache, {
      loading: false,
      refreshFailed: false,
      servingCachedModels: false,
      refreshStatus: 'deferred'
    })).toBe('运行环境正在更新，稍后重新获取')
  })

  it('keeps onboarding limited to model fields while permissions come from adapter defaults', () => {
    const installation = runtimeInstallation('codex-cli')
    const markup = renderToStaticMarkup(createElement(MemberModelParameters, {
      adapterKind: 'codex-cli',
      installation,
      model: { mode: 'runtime_default' },
      disabled: false,
      onChange: () => undefined
    }))

    expect(markup).toContain('onboarding-model-parameter-form')
    expect(markup).toContain('<span>模型</span>')
    expect(markup).not.toContain('文件系统访问')
    expect(markup).not.toContain('审批策略')
    expect(markup).not.toContain('danger-full-access')
  })

  it('uses Core-provided defaults and keeps the parameters visible by default', () => {
    const installation = runtimeInstallation('codex-cli')
    const markup = renderToStaticMarkup(createElement(MemberRuntimeParameters, {
      adapterKind: 'codex-cli',
      installation,
      draft: draftFromDefaults(installation.memberRuntimeDefaults!),
      disabled: false,
      onChange: () => undefined
    }))

    expect(markup).toContain('<section class="member-runtime-parameters"')
    expect(markup).toContain('运行参数')
    expect(markup).not.toContain('<details')
    expect(markup).toContain('member-runtime-parameters-heading')
    expect(markup).toContain('模型，默认')
    expect(markup).toContain('文件系统访问')
    expect(markup).toContain('审批策略')
    expect(markup).toContain('danger-full-access')
    expect(markup).toContain('never')
    expect(markup).not.toContain('推理强度')
    expect(markup).not.toContain('危险')
    expect(markup).not.toContain('高风险')
  })

  it('keeps DSH native permission names primary and adds concise explanations', () => {
    const installation = runtimeInstallation('deepseek-harness')
    const markup = renderToStaticMarkup(createElement(MemberRuntimeParameters, {
      adapterKind: 'deepseek-harness',
      installation,
      draft: {
        model: { mode: 'runtime_default' },
        permissions: {
          adapterKind: 'deepseek-harness',
          schemaVersion: 1,
          values: { sandbox_mode: 'workspace-write', approval_policy: 'ask' }
        }
      },
      disabled: false,
      onChange: () => undefined
    }))

    expect(markup).toContain('>sandbox_mode</label>')
    expect(markup).toContain('>workspace-write</strong>')
    expect(markup).toContain('允许写入当前工作区')
    expect(markup).toContain('aria-label="sandbox_mode，workspace-write，允许写入当前工作区"')
    expect(markup).toContain('>approval_policy</label>')
    expect(markup).toContain('>ask</strong>')
    expect(markup).toContain('需要确认时由 DSH 发起询问')
    expect(markup).not.toContain('文件系统访问')
    expect(markup).not.toContain('审批策略')
  })

  it('shows model-specific parameters only for an explicit model', () => {
    const installation = runtimeInstallation('codex-cli')
    const markup = renderToStaticMarkup(createElement(MemberRuntimeParameters, {
      adapterKind: 'codex-cli',
      installation,
      draft: {
        model: {
          mode: 'explicit',
          modelId: 'runtime/model',
          options: { reasoning_effort: 'high' }
        },
        permissions: installation.memberRuntimeDefaults!.permissions
      },
      disabled: false,
      onChange: () => undefined
    }))

    expect(markup).not.toContain('打开后重新获取')
    expect(markup).toContain('Runtime Model')
    expect(markup).toContain('推理强度')
    expect(markup).toContain('推理强度，High')
  })

  it.each(['copilot-cli', 'claude-code-cli'] as const)('marks a saved unknown model as unverified when no serviceable catalog exists (%s)', (adapterKind) => {
    const installation = runtimeInstallation(adapterKind)
    installation.modelCatalog = {
      status: 'unavailable',
      observedAt: null,
      revalidateAfter: null,
      expiresAt: null
    }
    const saved = {
      mode: 'explicit' as const,
      modelId: 'claude-opus-5',
      options: { effort: 'future-level' }
    }
    const draft = draftFromDefaults({
      ...installation.memberRuntimeDefaults!, model: saved
    })
    expect(draft.model).toEqual(saved)
    expect(runtimeModelSelectionAvailable(installation, draft.model)).toBe(true)
    expect(runtimeModelSelectionAvailable(installation, { mode: 'runtime_default' })).toBe(true)
    const markup = renderToStaticMarkup(createElement(MemberRuntimeParameters, {
      adapterKind,
      installation,
      draft,
      disabled: false,
      onChange: () => undefined
    }))

    expect(markup).toContain('模型，claude-opus-5')
    if (adapterKind === 'claude-code-cli') expect(markup).toContain('future-level')
    expect(draft.model).toEqual(saved)
    expect(markup).not.toContain('已失效')
  })

  it.each(['copilot-cli', 'claude-code-cli'] as const)('keeps a stale last-known-good catalog visible after a newer refresh failure (%s)', (adapterKind) => {
    const installation = runtimeInstallation(adapterKind)
    installation.modelCatalog.status = 'stale'
    installation.lastProbeAttempt = {
      id: 'attempt-refresh-failed',
      installationId: installation.id,
      status: 'failed',
      failureClass: 'transient',
      diagnosticCode: 'runtime_check_timed_out',
      candidatePath: installation.executablePath,
      executableFingerprint: 'sha256:test',
      attemptedAt: '2026-07-31T00:02:00Z',
      retryAfter: null,
      failure: null
    }
    const markup = renderToStaticMarkup(createElement(MemberRuntimeParameters, {
      adapterKind,
      installation,
      draft: {
        model: { mode: 'explicit', modelId: 'runtime/model', options: {} },
        permissions: installation.memberRuntimeDefaults!.permissions
      },
      disabled: false,
      onChange: () => undefined
    }))

    expect(markup).toContain('Runtime Model')
    expect(modelCatalogStatusCopy(installation.modelCatalog, {
      loading: false, refreshFailed: true, servingCachedModels: true, refreshStatus: 'failed'
    })).toBe('暂时无法更新模型列表，已保留上次结果。')
  })

  it.each([
    ['opencode-cli', '工具权限', 'allow'],
    ['claude-code-cli', '权限模式', 'bypassPermissions'],
    ['qoder-cli', '权限模式', 'bypass_permissions'],
    ['codebuddy-cli', '权限模式', 'bypassPermissions'],
    ['qwen-code', '审批模式', 'yolo'],
    ['trae-cn-cli', '权限模式', 'bypass_permissions'],
    ['kimi-code-cli', '权限模式', 'yolo'],
    ['cline-cli', '执行模式', 'act'],
    ['command-code-cli', '权限模式', 'bypass'],
    ['grok-build', '权限模式', 'bypassPermissions']
  ] as const)('renders %s with its native permission value', (kind, label, value) => {
    const installation = runtimeInstallation(kind)
    const markup = renderToStaticMarkup(createElement(MemberRuntimeParameters, {
      adapterKind: kind,
      installation,
      draft: draftFromDefaults(installation.memberRuntimeDefaults!),
      disabled: false,
      onChange: () => undefined
    }))

    expect(markup).toContain(label)
    expect(markup).toContain(`aria-label="${label}，${value}，推荐"`)
  })

  it('does not present an approval mode for native Pi tool execution', () => {
    const installation = runtimeInstallation('pi')
    const markup = renderToStaticMarkup(createElement(MemberRuntimeParameters, {
      adapterKind: 'pi',
      installation,
      draft: draftFromDefaults(installation.memberRuntimeDefaults!),
      disabled: false,
      onChange: () => undefined
    }))

    expect(markup).toContain('模型、模型参数与智能体原生权限。')
    expect(markup).toContain('<span>模型</span>')
    expect(markup).not.toContain('审批模式')
    expect(markup).not.toContain('partial_managed')
  })

  it('uses switches for native on/off and boolean-string permission fields', () => {
    for (const kind of ['copilot-cli', 'kiro-cli', 'antigravity-app', 'cline-cli'] as const) {
      const installation = runtimeInstallation(kind)
      const markup = renderToStaticMarkup(createElement(MemberRuntimeParameters, {
        adapterKind: kind,
        installation,
        draft: draftFromDefaults(installation.memberRuntimeDefaults!),
        disabled: false,
        onChange: () => undefined
      }))
      expect(markup).toContain('type="checkbox"')
      expect(markup).toContain('checked=""')
      expect(markup).toContain('field-label runtime-parameter-switch-field')
      expect(markup).toContain('class="runtime-parameter-switch-state" aria-hidden="true">开启')
      if (kind === 'cline-cli') {
        const draft = draftFromDefaults(installation.memberRuntimeDefaults!)
        draft.permissions.values.auto_approve = 'false'
        const disabledMarkup = renderToStaticMarkup(createElement(MemberRuntimeParameters, {
          adapterKind: kind, installation, draft, disabled: false, onChange: () => undefined
        }))
        expect(disabledMarkup).toContain('aria-label="自动通过权限请求"')
        expect(disabledMarkup).not.toContain('checked=""')
      }
    }
    expect(styles).toContain('.runtime-parameter-switch input:checked { border-color: var(--conversation-action); background: var(--conversation-action); }')
    expect(styles).toContain('.runtime-parameter-switch input:checked::after { background: var(--conversation-action-contrast);')
  })

  it('keeps model, select, and switch control faces on one 44px height contract', () => {
    expect(styles).toContain('--runtime-parameter-control-height: 44px')
    const controlContract = styles.match(
      /\.member-runtime-parameters \.runtime-model-picker-trigger,[\s\S]*?\.member-runtime-parameters \.runtime-parameter-switch \{[\s\S]*?\n\}/
    )?.[0]

    expect(controlContract).toContain('height: var(--runtime-parameter-control-height)')
    expect(controlContract).toContain('min-height: var(--runtime-parameter-control-height)')
  })

  it('shows Kiro model selection and native trust-all permission', () => {
    const installation = runtimeInstallation('kiro-cli')
    const markup = renderToStaticMarkup(createElement(MemberRuntimeParameters, {
      adapterKind: 'kiro-cli',
      installation,
      draft: {
        model: { mode: 'explicit', modelId: 'runtime/model', options: {} },
        permissions: installation.memberRuntimeDefaults!.permissions
      },
      disabled: false,
      onChange: () => undefined
    }))

    expect(markup).toContain('<span>模型</span>')
    expect(markup).toContain('Runtime Model')
    expect(markup).not.toContain('推理强度')
    expect(markup).toContain('自动允许全部工具')
    expect(markup).toContain('checked=""')
  })

  it('prefers saved member values until the user switches Runtime', () => {
    const codex = runtimeInstallation('codex-cli')
    const agent = {
      agentId: 'agent-test',
      displayName: '测试队员',
      avatarRef: null,
      accent: null,
      teamRole: '',
      professionalResponsibilities: '测试',
      personalityTraits: [],
      workingPrinciples: '',
      growthTopic: '',
      defaultCapabilities: [],
      presence: 'present' as const,
      runtimeConfiguration: {
        adapterKind: 'codex-cli' as const,
        model: { mode: 'runtime_default' as const },
        permissions: {
          adapterKind: 'codex-cli' as const,
          schemaVersion: 1,
          values: {
            sandbox_mode: 'workspace-write',
            approval_policy: 'on-request'
          }
        }
      },
      runtimeReadiness: { status: 'ready' as const, blockers: [] },
      memberOrder: 0,
      version: 1,
      createdAt: '2026-07-31T00:00:00Z',
      updatedAt: '2026-07-31T00:00:00Z',
      removedAt: null
    }

    expect(runtimeEditorInstallation([codex], 'codex-cli')?.id).toBe(codex.id)
    expect(runtimeDraftForMember(agent, 'codex-cli', codex, true)?.permissions.values).toEqual({
      sandbox_mode: 'workspace-write',
      approval_policy: 'on-request'
    })
    expect(runtimeDraftForMember(agent, 'codex-cli', codex, false)?.permissions.values).toEqual({
      sandbox_mode: 'danger-full-access',
      approval_policy: 'never'
    })
  })
})

function runtimeInstallation(kind: AdapterKind): AdapterInstallation {
  const permissionOptions = runtimePermissionOptions(kind)
  const defaults = runtimePermissionDefaults(kind)
  return {
    id: `managed-${kind}`,
    adapterKind: kind,
    executablePath: `/private/${kind}`,
    commandName: kind,
    installationClass: 'managed_default',
    source: 'inherited_path',
    authScope: 'default',
    enabled: true,
    generation: 1,
    pathState: 'valid',
    version: 1,
    referencedProfileCount: 0,
    snapshot: {
      reportedVersion: 'test',
      executableFingerprint: 'sha256:test',
      authenticationStatus: 'authenticated',
      probeStatus: 'ready',
      permissionSchemaVersion: 1,
      permissionSchemaDigest: 'sha256:permissions',
      capabilities: [],
      protocols: [],
      models: [{
        id: 'runtime/model',
        displayName: 'Runtime Model',
        isDefault: true,
        hidden: false,
        deprecated: false,
        options: kind === 'kiro-cli' || kind === 'antigravity-app'
          ? []
          : [{
              key: kind === 'claude-code-cli' ? 'effort' : 'reasoning_effort',
              label: 'Effort',
              valueType: 'enum',
              values: [{ value: 'high', label: 'High' }],
              defaultValue: 'high',
              scope: 'run'
            }]
      }],
      permissionOptions,
      observedAt: '2026-07-31T00:00:00Z',
      lastAttemptedAt: '2026-07-31T00:00:00Z',
      lastSuccessfulProbeAt: '2026-07-31T00:00:00Z',
      staleAt: null,
      lastError: null,
      nativeSessionCompatibilityKey: null
    },
    modelCatalog: {
      status: 'fresh',
      observedAt: '2026-07-31T00:00:00Z',
      revalidateAfter: '2026-07-31T00:01:00Z',
      expiresAt: '2026-08-01T00:00:00Z'
    },
    memberRuntimeDefaults: {
      adapterKind: kind,
      model: { mode: 'runtime_default' },
      permissions: {
        adapterKind: kind,
        schemaVersion: 1,
        values: defaults
      }
    },
    lastProbeAttempt: null,
    relocationHistory: [],
    createdAt: '2026-07-31T00:00:00Z',
    updatedAt: '2026-07-31T00:00:00Z'
  }
}

function runtimePermissionDefaults(kind: AdapterKind): Record<string, unknown> {
  switch (kind) {
    case 'codex-cli':
    case 'deepseek-harness':
      return { sandbox_mode: 'danger-full-access', approval_policy: 'never' }
    case 'command-code-cli':
      return { permission_mode: 'bypass' }
    case 'cline-cli':
      return { mode: 'act', auto_approve: 'true' }
    case 'pi':
      return {}
    case 'opencode-cli':
      return { permission: 'allow' }
    case 'copilot-cli':
      return { allow_all: 'on' }
    case 'claude-code-cli':
      return { permission_mode: 'bypassPermissions' }
    case 'kiro-cli':
      return { trust_all_tools: 'on' }
    case 'qoder-cli':
      return { permission_mode: 'bypass_permissions' }
    case 'codebuddy-cli':
      return { permission_mode: 'bypassPermissions' }
    case 'qwen-code':
      return { approval_mode: 'yolo' }
    case 'trae-cn-cli':
      return { permission_mode: 'bypass_permissions' }
    case 'cursor-agent':
      return { execution_mode: 'agent', approval_policy: 'force' }
    case 'kimi-code-cli':
      return { permission_mode: 'yolo' }
    case 'zcode-app':
      return { permission_mode: 'yolo' }
    case 'grok-build':
      return { permission_mode: 'bypassPermissions' }
    case 'antigravity-app':
      return {
        mode: 'accept-edits',
        sandbox: 'off',
        dangerously_skip_permissions: 'on'
      }
  }
}

function runtimePermissionOptions(kind: AdapterKind): PermissionOptionDescriptor[] {
  const defaults = runtimePermissionDefaults(kind)
  return Object.entries(defaults).map(([key, value]) => ({
    key,
    label: key,
    description: '',
    valueType: 'enum',
    choices: kind === 'deepseek-harness'
      ? (key === 'sandbox_mode'
          ? ['read-only', 'workspace-write', 'danger-full-access']
          : ['ask', 'never']).map(value => ({ value, label: value }))
      : key === 'auto_approve'
        ? [{ value: 'false', label: 'false' }, { value: 'true', label: 'true' }]
      : key === 'allow_all' || key === 'trust_all_tools' || key === 'dangerously_skip_permissions'
        ? [{ value: 'off', label: 'off' }, { value: 'on', label: 'on' }]
        : [{ value: String(value), label: String(value) }],
    recommendedValue: value,
    scope: 'run',
    risk: 'elevated',
    supported: true,
    required: true,
    unsupportedReason: null
  }))
}
