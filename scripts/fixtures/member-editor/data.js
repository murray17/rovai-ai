import { BUILTIN_MEMBER_PRESETS } from '../../../apps/desktop/src/renderer/src/member-presets'
import {
  VISIBLE_PRODUCT_RUNTIMES,
  adapterLabel
} from '../../../apps/desktop/src/renderer/src/runtime-products'
import {
  nativePermissions,
  memberPermissionDefaults
} from './native-permissions'

export const clone = (value) => structuredClone(value)
export const kinds = VISIBLE_PRODUCT_RUNTIMES
export const runtimeLabels = Object.fromEntries(
  kinds.map((kind) => [kind, adapterLabel(kind)])
)
const time = '2026-09-07T08:00:00Z'
const modelNames = {
  'codex-cli': ['gpt-5.4', 'gpt-5.4-mini'],
  'claude-code-cli': ['claude-sonnet-4-6', 'claude-opus-4-6'],
  'copilot-cli': ['gpt-5.4', 'claude-sonnet-4-6'],
  pi: ['claude-sonnet-4-6', 'gpt-5.4']
}
export const installations = kinds.map((kind) => ({
  id: `prototype-${kind}`,
  adapterKind: kind,
  executablePath: `/example/${kind}`,
  commandName: kind,
  installationClass: 'managed_default',
  source: 'inherited_path',
  authScope: 'default',
  enabled: true,
  generation: 1,
  pathState: 'valid',
  version: 1,
  referencedProfileCount: 1,
  snapshot: {
    reportedVersion: null,
    executableFingerprint: 'prototype',
    authenticationStatus: 'authenticated',
    probeStatus: 'ready',
    permissionSchemaVersion: 1,
    permissionSchemaDigest: 'prototype',
    capabilities: [],
    protocols: [],
    models: (modelNames[kind] ?? []).map((name, index) => ({
      id: name,
      displayName: name,
      isDefault: index === 0,
      hidden: false,
      deprecated: false,
      options: [
        {
          key: kind === 'claude-code-cli' ? 'effort' : 'reasoning_effort',
          label: '推理强度',
          valueType: 'enum',
          values: [
            { value: 'low', label: '低' },
            { value: 'medium', label: '中' },
            { value: 'high', label: '高' }
          ],
          defaultValue: 'medium',
          scope: 'run'
        }
      ]
    })),
    permissionOptions: nativePermissions[kind],
    observedAt: time,
    lastAttemptedAt: time,
    lastSuccessfulProbeAt: time,
    staleAt: null,
    lastError: null,
    nativeSessionCompatibilityKey: null
  },
  modelCatalog: {
    status: 'fresh',
    observedAt: time,
    revalidateAfter: '2027-01-01T00:00:00Z',
    expiresAt: '2027-01-02T00:00:00Z'
  },
  memberRuntimeDefaults: {
    adapterKind: kind,
    model: { mode: 'runtime_default' },
    permissions: {
      adapterKind: kind,
      schemaVersion: 1,
      values: clone(memberPermissionDefaults[kind])
    }
  },
  lastProbeAttempt: null,
  relocationHistory: [],
  createdAt: time,
  updatedAt: time
}))
export const defaultRuntime = (kind) =>
  kind
    ? clone(
        installations.find((item) => item.adapterKind === kind)
          .memberRuntimeDefaults
      )
    : null
export const availability = kinds.map((runtimeKind) => ({
  runtimeKind,
  status: 'ready',
  checking: false,
  installationId: `prototype-${runtimeKind}`,
  reportedVersion: null
}))
export const identityKeys = [
  'displayName',
  'teamRole',
  'professionalResponsibilities',
  'personalityTraits',
  'workingPrinciples',
  'growthTopic',
  'avatarRef'
]
export const identityOf = (member) =>
  Object.fromEntries(identityKeys.map((key) => [key, clone(member[key])]))
export const emptyIdentity = () => ({
  displayName: '',
  teamRole: '',
  professionalResponsibilities: '',
  personalityTraits: [],
  workingPrinciples: '',
  growthTopic: '',
  avatarRef: null
})
export function initialMembers() {
  return BUILTIN_MEMBER_PRESETS.map((preset, index) => ({
    ...clone(preset),
    agentId: `prototype-${preset.role}`,
    accent: null,
    defaultCapabilities: [],
    presence: 'present',
    runtimeConfiguration: defaultRuntime(
      ['codex-cli', 'claude-code-cli', 'copilot-cli', 'pi'][index]
    ),
    runtimeReadiness: { status: 'ready', blockers: [] },
    memberOrder: index,
    version: 1,
    createdAt: time,
    updatedAt: time,
    removedAt: null
  }))
}
export function draftFor(member) {
  return {
    identity: identityOf(member),
    runtime: clone(member.runtimeConfiguration),
    identityError: null,
    runtimeError: null,
    identityBusy: false,
    runtimeBusy: false,
    identitySaved: false,
    runtimeSaved: false,
    extraOpen: false,
    avatarOpen: false,
    traitInput: ''
  }
}
const camp = (id, title, projectBindingKind = 'project') => ({
  id,
  title,
  activationState: 'active',
  projectBindingKind,
  projectPath: '/Users/demo/Projects/rovai-ai',
  defaultLead: null,
  marker: 'idle',
  lastActivityAt: time,
  lastActivityGlobalSequence: 1,
  latestCompletionGlobalSequence: 0,
  version: 1
})
export const navigation = {
  schemaVersion: 3,
  throughGlobalSequence: 1,
  projects: [
    {
      projectKey: 'prototype-project',
      name: 'rovai-ai',
      projectPath: '/Users/demo/Projects/rovai-ai',
      lastActivityAt: time,
      lastActivityGlobalSequence: 1,
      totalCount: 3,
      recentCamps: [
        camp('demo-member', '队员配置页面'),
        camp('demo-dialog', '弹窗与浮层精简'),
        camp('demo-workspace', '会话工作区')
      ]
    }
  ],
  quickChat: {
    totalCount: 2,
    recentCamps: [
      camp('demo-ideas', '讨论产品想法', 'quick_chat'),
      camp('demo-code', '一次代码检查', 'quick_chat')
    ]
  }
}
