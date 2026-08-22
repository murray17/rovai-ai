import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isCampId } from '@contracts'
import type {
  AdapterPermissionConfig,
  AdapterKind,
  BuiltinMemberAvatarRole,
  ModelSelection,
  OnboardingProvisioningOperation,
  OnboardingRuntimeSelection,
  OnboardingSnapshot,
  OnboardingStep
} from '@contracts'
import { writePrivateJson } from './general-preferences'

const MEMBER_ROLES = new Set<BuiltinMemberAvatarRole>(['luoke', 'muwa', 'mianzhi', 'qilu'])
const ADAPTER_KINDS = new Set<AdapterKind>([
  'codex-cli',
  'opencode-cli',
  'copilot-cli',
  'claude-code-cli',
  'kiro-cli',
  'qoder-cli',
  'codebuddy-cli',
  'qwen-code',
  'trae-cn-cli',
  'cursor-agent',
  'kimi-code-cli',
  'antigravity-app'
])
const STEPS = new Set<OnboardingStep>(['welcome', 'member', 'runtime'])
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const MAX_MODEL_OPTIONS_BYTES = 16_384

export const DEFAULT_ONBOARDING_SNAPSHOT: OnboardingSnapshot = {
  schemaVersion: 1,
  status: 'uninitialized'
}

export function parseOnboardingSnapshot(value: unknown): OnboardingSnapshot | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.status !== 'string') return null
  if (value.status === 'uninitialized') {
    return hasExactKeys(value, ['schemaVersion', 'status'])
      ? { ...DEFAULT_ONBOARDING_SNAPSHOT }
      : null
  }
  if (value.status === 'in_progress') {
    if (!hasExactKeys(value, [
      'schemaVersion',
      'status',
      'step',
      'selectedMemberRole',
      'runtimeSelection',
      'provisioning'
    ])) return null
    if (typeof value.step !== 'string' || !STEPS.has(value.step as OnboardingStep)) return null
    const selectedMemberRole = value.selectedMemberRole === null
      ? null
      : isMemberRole(value.selectedMemberRole) ? value.selectedMemberRole : undefined
    if (selectedMemberRole === undefined) return null
    const runtimeSelection = value.runtimeSelection === null
      ? null
      : parseRuntimeSelection(value.runtimeSelection)
    if (value.runtimeSelection !== null && runtimeSelection === null) return null
    const provisioning = value.provisioning === null
      ? null
      : parseProvisioning(value.provisioning)
    if (value.provisioning !== null && provisioning === null) return null
    if (value.step === 'runtime' && selectedMemberRole === null) return null
    if (provisioning && (
      value.step !== 'runtime'
      || !runtimeSelection?.model
      || provisioning.runtimePermissions.adapterKind !== runtimeSelection.adapterKind
    )) return null
    return {
      schemaVersion: 1,
      status: 'in_progress',
      step: value.step as OnboardingStep,
      selectedMemberRole,
      runtimeSelection,
      provisioning
    }
  }
  if (value.status === 'completed') {
    if (!hasExactKeys(value, [
      'schemaVersion',
      'status',
      'origin',
      'completedAt',
      'selectedMemberRole',
      'memberAgentId',
      'quickChatCampId'
    ])) return null
    if (value.origin !== 'onboarding' && value.origin !== 'existing_installation') return null
    if (!isTimestamp(value.completedAt)) return null
    if (value.selectedMemberRole !== null && !isMemberRole(value.selectedMemberRole)) return null
    if (value.memberAgentId !== null && !isStableId(value.memberAgentId)) return null
    if (value.quickChatCampId !== null && !isCampId(value.quickChatCampId)) return null
    if (value.origin === 'onboarding' && (
      value.selectedMemberRole === null
      || value.memberAgentId === null
      || value.quickChatCampId === null
    )) return null
    if (value.origin === 'existing_installation' && (
      value.selectedMemberRole !== null
      || value.memberAgentId !== null
      || value.quickChatCampId !== null
    )) return null
    return {
      schemaVersion: 1,
      status: 'completed',
      origin: value.origin,
      completedAt: value.completedAt,
      selectedMemberRole: value.selectedMemberRole,
      memberAgentId: value.memberAgentId,
      quickChatCampId: value.quickChatCampId
    }
  }
  return null
}

export async function readOnboardingSnapshot(filePath: string): Promise<OnboardingSnapshot> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    return parseOnboardingSnapshot(parsed) ?? { ...DEFAULT_ONBOARDING_SNAPSHOT }
  } catch {
    return { ...DEFAULT_ONBOARDING_SNAPSHOT }
  }
}

export class OnboardingStore {
  readonly #filePath: string
  #snapshot: OnboardingSnapshot
  #writeTail: Promise<void> = Promise.resolve()

  private constructor(filePath: string, snapshot: OnboardingSnapshot) {
    this.#filePath = filePath
    this.#snapshot = snapshot
  }

  static async load(filePath: string): Promise<OnboardingStore> {
    return new OnboardingStore(filePath, await readOnboardingSnapshot(filePath))
  }

  get(): OnboardingSnapshot {
    return structuredClone(this.#snapshot)
  }

  initialize(hasExistingProductData: boolean): Promise<OnboardingSnapshot> {
    return this.#enqueue(async () => {
      if (this.#snapshot.status !== 'uninitialized') return this.get()
      const next: OnboardingSnapshot = hasExistingProductData
        ? {
            schemaVersion: 1,
            status: 'completed',
            origin: 'existing_installation',
            completedAt: new Date().toISOString(),
            selectedMemberRole: null,
            memberAgentId: null,
            quickChatCampId: null
          }
        : inProgress('welcome')
      return this.#commit(next)
    })
  }

  showWelcome(): Promise<OnboardingSnapshot> {
    return this.#mutateInProgress((current) => {
      if (current.provisioning) throw new Error('首次引导初始化已经开始，不能返回欢迎页')
      if (current.step === 'welcome') return current
      if (current.step !== 'member') throw new Error('请先返回队员选择页')
      return { ...current, step: 'welcome' }
    })
  }

  completeWelcome(): Promise<OnboardingSnapshot> {
    return this.#mutateInProgress((current) => {
      if (current.step === 'member') return current
      if (current.step !== 'welcome') throw new Error('欢迎页已经完成')
      return {
        ...current,
        step: 'member',
        selectedMemberRole: current.selectedMemberRole ?? 'luoke'
      }
    })
  }

  selectMember(role: unknown): Promise<OnboardingSnapshot> {
    if (!isMemberRole(role)) return Promise.reject(new Error('Unsupported onboarding member role'))
    return this.#mutateInProgress((current) => {
      if (current.provisioning) throw new Error('首次引导初始化已经开始，不能更换队员')
      if (current.step !== 'member') throw new Error('当前不在队员选择页')
      const changed = current.selectedMemberRole !== role
      return {
        ...current,
        selectedMemberRole: role,
        runtimeSelection: changed ? null : current.runtimeSelection
      }
    })
  }

  showMemberSelection(): Promise<OnboardingSnapshot> {
    return this.#mutateInProgress((current) => {
      if (current.provisioning) throw new Error('首次引导初始化已经开始，不能返回队员选择')
      if (current.step === 'member') return current
      if (current.step !== 'runtime') throw new Error('请先完成欢迎页')
      return { ...current, step: 'member' }
    })
  }

  completeMemberSelection(): Promise<OnboardingSnapshot> {
    return this.#mutateInProgress((current) => {
      if (current.step === 'runtime') return current
      if (current.step !== 'member') throw new Error('请先完成欢迎页')
      if (!current.selectedMemberRole) throw new Error('请先选择一位队员')
      return { ...current, step: 'runtime' }
    })
  }

  setRuntimeSelection(selection: unknown): Promise<OnboardingSnapshot> {
    const parsed = selection === null ? null : parseRuntimeSelection(selection)
    if (selection !== null && !parsed) return Promise.reject(new Error('Invalid onboarding Runtime selection'))
    return this.#mutateInProgress((current) => {
      if (current.step !== 'runtime') throw new Error('当前不在 Agent 运行时配置页')
      if (current.provisioning) throw new Error('首次引导初始化已经开始，不能修改运行配置')
      return { ...current, runtimeSelection: parsed }
    })
  }

  beginProvisioning(
    selection: unknown,
    runtimePermissions: unknown
  ): Promise<OnboardingSnapshot> {
    const parsed = parseRuntimeSelection(selection)
    if (!parsed?.model) return Promise.reject(new Error('请先完成 Agent 运行时与模型配置'))
    const parsedPermissions = parseRuntimePermissions(runtimePermissions)
    if (!parsedPermissions || parsedPermissions.adapterKind !== parsed.adapterKind) {
      return Promise.reject(new Error('Agent 运行时默认权限与当前选择不匹配'))
    }
    return this.#mutateInProgress((current) => {
      if (current.step !== 'runtime' || !current.selectedMemberRole) {
        throw new Error('首次引导还没有准备好初始化')
      }
      if (current.provisioning) {
        if (
          JSON.stringify(current.runtimeSelection) !== JSON.stringify(parsed)
          || JSON.stringify(current.provisioning.runtimePermissions)
            !== JSON.stringify(parsedPermissions)
        ) {
          throw new Error('首次引导初始化已经开始，请重试当前配置')
        }
        return current
      }
      return {
        ...current,
        runtimeSelection: parsed,
        provisioning: {
          memberCommandId: randomUUID(),
          runtimeCommandId: randomUUID(),
          campCommandId: randomUUID(),
          runtimePermissions: parsedPermissions,
          memberAgentId: null,
          memberVersionBeforeRuntime: null,
          memberVersionAfterRuntime: null,
          quickChatCampId: null
        }
      }
    })
  }

  recordProvisionedMember(agentId: unknown, version: unknown): Promise<OnboardingSnapshot> {
    if (!isStableId(agentId) || !isPositiveVersion(version)) {
      return Promise.reject(new Error('Invalid provisioned member checkpoint'))
    }
    return this.#mutateProvisioning((operation) => {
      if (operation.memberAgentId && (
        operation.memberAgentId !== agentId
        || operation.memberVersionBeforeRuntime !== version
      )) throw new Error('首次引导队员检查点不一致')
      return {
        ...operation,
        memberAgentId: agentId,
        memberVersionBeforeRuntime: version
      }
    })
  }

  recordProvisionedRuntime(version: unknown): Promise<OnboardingSnapshot> {
    if (!isPositiveVersion(version)) return Promise.reject(new Error('Invalid Runtime checkpoint'))
    return this.#mutateProvisioning((operation) => {
      if (!operation.memberAgentId || operation.memberVersionBeforeRuntime === null) {
        throw new Error('首次引导队员尚未创建')
      }
      if (operation.memberVersionAfterRuntime !== null && operation.memberVersionAfterRuntime !== version) {
        throw new Error('首次引导 Runtime 检查点不一致')
      }
      return { ...operation, memberVersionAfterRuntime: version }
    })
  }

  recordProvisionedCamp(campId: unknown): Promise<OnboardingSnapshot> {
    if (!isCampId(campId)) return Promise.reject(new Error('Invalid provisioned Camp checkpoint'))
    return this.#mutateProvisioning((operation) => {
      if (operation.memberVersionAfterRuntime === null) {
        throw new Error('首次引导 Runtime 尚未保存')
      }
      if (operation.quickChatCampId && operation.quickChatCampId !== campId) {
        throw new Error('首次引导快速对话检查点不一致')
      }
      return { ...operation, quickChatCampId: campId }
    })
  }

  complete(): Promise<OnboardingSnapshot> {
    return this.#enqueue(async () => {
      const current = requireInProgress(this.#snapshot)
      const operation = current.provisioning
      if (
        !current.selectedMemberRole
        || !operation?.memberAgentId
        || operation.memberVersionAfterRuntime === null
        || !operation.quickChatCampId
      ) throw new Error('首次引导初始化尚未完成')
      return this.#commit({
        schemaVersion: 1,
        status: 'completed',
        origin: 'onboarding',
        completedAt: new Date().toISOString(),
        selectedMemberRole: current.selectedMemberRole,
        memberAgentId: operation.memberAgentId,
        quickChatCampId: operation.quickChatCampId
      })
    })
  }

  #mutateInProgress(
    mutate: (current: Extract<OnboardingSnapshot, { status: 'in_progress' }>) => Extract<OnboardingSnapshot, { status: 'in_progress' }>
  ): Promise<OnboardingSnapshot> {
    return this.#enqueue(async () => this.#commit(mutate(requireInProgress(this.#snapshot))))
  }

  #mutateProvisioning(
    mutate: (operation: OnboardingProvisioningOperation) => OnboardingProvisioningOperation
  ): Promise<OnboardingSnapshot> {
    return this.#mutateInProgress((current) => {
      if (!current.provisioning) throw new Error('首次引导初始化尚未开始')
      return { ...current, provisioning: mutate(current.provisioning) }
    })
  }

  async #commit(next: OnboardingSnapshot): Promise<OnboardingSnapshot> {
    await writePrivateJson(this.#filePath, next)
    this.#snapshot = next
    return this.get()
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writeTail.then(operation, operation)
    this.#writeTail = result.then(() => undefined, () => undefined)
    return result
  }
}

function inProgress(step: OnboardingStep): Extract<OnboardingSnapshot, { status: 'in_progress' }> {
  return {
    schemaVersion: 1,
    status: 'in_progress',
    step,
    selectedMemberRole: null,
    runtimeSelection: null,
    provisioning: null
  }
}

function requireInProgress(
  snapshot: OnboardingSnapshot
): Extract<OnboardingSnapshot, { status: 'in_progress' }> {
  if (snapshot.status !== 'in_progress') throw new Error('首次引导当前不可修改')
  return snapshot
}

function parseRuntimeSelection(value: unknown): OnboardingRuntimeSelection | null {
  if (!hasExactKeys(value, ['adapterKind', 'model'])) return null
  if (typeof value.adapterKind !== 'string' || !ADAPTER_KINDS.has(value.adapterKind as AdapterKind)) return null
  const model = value.model === null ? null : parseModelSelection(value.model)
  if (value.model !== null && model === null) return null
  return { adapterKind: value.adapterKind as AdapterKind, model }
}

function parseModelSelection(value: unknown): ModelSelection | null {
  if (!isRecord(value) || typeof value.mode !== 'string') return null
  if (value.mode === 'runtime_default') {
    return hasExactKeys(value, ['mode']) ? { mode: 'runtime_default' } : null
  }
  if (value.mode !== 'explicit' || !hasExactKeys(value, ['mode', 'modelId', 'options'])) return null
  if (typeof value.modelId !== 'string' || value.modelId.length < 1 || value.modelId.length > 256) return null
  const options = normalizedJsonObject(value.options)
  if (!options) return null
  if (Buffer.byteLength(JSON.stringify(options), 'utf8') > MAX_MODEL_OPTIONS_BYTES) return null
  return {
    mode: 'explicit',
    modelId: value.modelId,
    options
  }
}

function parseProvisioning(value: unknown): OnboardingProvisioningOperation | null {
  if (!hasExactKeys(value, [
    'memberCommandId',
    'runtimeCommandId',
    'campCommandId',
    'runtimePermissions',
    'memberAgentId',
    'memberVersionBeforeRuntime',
    'memberVersionAfterRuntime',
    'quickChatCampId'
  ])) return null
  if (!isUuid(value.memberCommandId) || !isUuid(value.runtimeCommandId) || !isUuid(value.campCommandId)) return null
  const runtimePermissions = parseRuntimePermissions(value.runtimePermissions)
  if (!runtimePermissions) return null
  if (value.memberAgentId !== null && !isStableId(value.memberAgentId)) return null
  if (value.memberVersionBeforeRuntime !== null && !isPositiveVersion(value.memberVersionBeforeRuntime)) return null
  if (value.memberVersionAfterRuntime !== null && !isPositiveVersion(value.memberVersionAfterRuntime)) return null
  if (value.quickChatCampId !== null && !isCampId(value.quickChatCampId)) return null
  if ((value.memberAgentId === null) !== (value.memberVersionBeforeRuntime === null)) return null
  if (value.memberVersionAfterRuntime !== null && value.memberVersionBeforeRuntime === null) return null
  if (value.quickChatCampId !== null && value.memberVersionAfterRuntime === null) return null
  return {
    memberCommandId: value.memberCommandId,
    runtimeCommandId: value.runtimeCommandId,
    campCommandId: value.campCommandId,
    runtimePermissions,
    memberAgentId: value.memberAgentId,
    memberVersionBeforeRuntime: value.memberVersionBeforeRuntime,
    memberVersionAfterRuntime: value.memberVersionAfterRuntime,
    quickChatCampId: value.quickChatCampId
  }
}

function parseRuntimePermissions(value: unknown): AdapterPermissionConfig | null {
  if (!hasExactKeys(value, ['adapterKind', 'schemaVersion', 'values'])) return null
  if (typeof value.adapterKind !== 'string' || !ADAPTER_KINDS.has(value.adapterKind as AdapterKind)) return null
  if (!isPositiveVersion(value.schemaVersion)) return null
  const values = normalizedJsonObject(value.values)
  if (!values || Buffer.byteLength(JSON.stringify(values), 'utf8') > MAX_MODEL_OPTIONS_BYTES) return null
  return {
    adapterKind: value.adapterKind as AdapterKind,
    schemaVersion: value.schemaVersion,
    values
  }
}

function hasExactKeys<T extends string>(
  value: unknown,
  keys: readonly T[]
): value is Record<T, unknown> {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizedJsonObject(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) return null
    const normalized = JSON.parse(serialized) as unknown
    return isRecord(normalized) ? normalized : null
  } catch {
    return null
  }
}

function isMemberRole(value: unknown): value is BuiltinMemberAvatarRole {
  return typeof value === 'string' && MEMBER_ROLES.has(value as BuiltinMemberAvatarRole)
}

function isStableId(value: unknown): value is string {
  return typeof value === 'string' && STABLE_ID.test(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isPositiveVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
