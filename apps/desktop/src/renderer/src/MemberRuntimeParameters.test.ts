import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  AdapterInstallation,
  AdapterKind,
  PermissionOptionDescriptor
} from '@contracts'
import {
  MemberModelParameters,
  MemberRuntimeParameters,
  draftFromDefaults,
  modelCatalogStatusCopy,
  runtimeDraftForMember,
  runtimeEditorInstallation
} from './MemberRuntimeParameters'

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
    expect(markup).toContain('模型策略')
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
    expect(markup).toContain('跟随 Agent 运行时默认')
    expect(markup).toContain('文件系统访问')
    expect(markup).toContain('审批策略')
    expect(markup).toContain('danger-full-access')
    expect(markup).toContain('never')
    expect(markup).not.toContain('推理强度')
    expect(markup).not.toContain('危险')
    expect(markup).not.toContain('高风险')
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

    expect(markup).toContain('固定模型')
    expect(markup).toContain('Runtime Model')
    expect(markup).toContain('推理强度')
    expect(markup).toContain('value="high" selected')
  })

  it('marks a saved unknown model as unverified when no serviceable catalog exists', () => {
    const installation = runtimeInstallation('copilot-cli')
    installation.modelCatalog = {
      status: 'unavailable',
      observedAt: null,
      revalidateAfter: null,
      expiresAt: null
    }
    const markup = renderToStaticMarkup(createElement(MemberRuntimeParameters, {
      adapterKind: 'copilot-cli',
      installation,
      draft: {
        model: {
          mode: 'explicit',
          modelId: 'claude-opus-5',
          options: {}
        },
        permissions: installation.memberRuntimeDefaults!.permissions
      },
      disabled: false,
      onChange: () => undefined
    }))

    expect(markup).toContain('尚未核对 · claude-opus-5')
    expect(markup).not.toContain('已失效')
  })

  it('keeps a stale last-known-good catalog visible after a newer refresh failure', () => {
    const installation = runtimeInstallation('copilot-cli')
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
      adapterKind: 'copilot-cli',
      installation,
      draft: {
        model: { mode: 'explicit', modelId: 'runtime/model', options: {} },
        permissions: installation.memberRuntimeDefaults!.permissions
      },
      disabled: false,
      onChange: () => undefined
    }))

    expect(markup).toContain('Runtime Model')
    expect(markup).toContain('刷新失败，继续显示上次成功结果')
  })

  it.each([
    ['opencode-cli', '工具权限', 'allow'],
    ['claude-code-cli', '权限模式', 'bypassPermissions'],
    ['qoder-cli', '权限模式', 'bypass_permissions'],
    ['codebuddy-cli', '权限模式', 'bypassPermissions'],
    ['qwen-code', '审批模式', 'yolo'],
    ['trae-cn-cli', '权限模式', 'bypass_permissions']
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
    expect(markup).toContain(`value="${value}" selected`)
  })

  it('uses switches for Copilot, Kiro, and Antigravity on/off fields', () => {
    for (const kind of ['copilot-cli', 'kiro-cli', 'antigravity-app'] as const) {
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
    }
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

    expect(markup).toContain('模型策略')
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
      return { sandbox_mode: 'danger-full-access', approval_policy: 'never' }
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
    choices: key === 'allow_all' || key === 'trust_all_tools' || key === 'dangerously_skip_permissions'
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
