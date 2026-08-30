import {
  DingTalkDeveloperApiError,
  type DingTalkDeveloperBackend
} from './dingtalk-developer-gateway'
import type { DingTalkDeveloperSessionService } from './dingtalk-developer-session'

export type DingTalkPublicationStep =
  | 'account_verified'
  | 'app_created'
  | 'credentials_read'
  | 'avatar_configured'
  | 'robot_configured'
  | 'permissions_configured'
  | 'version_created'
  | 'awaiting_approver_selection'
  | 'awaiting_approval'
  | 'version_released'

export type DingTalkProvisioningFacts = {
  unifiedAppId?: string
  appKey?: string
  appSecret?: string
  robotCode?: string
  versionId?: string
  approvalMode?: 'NO_APPROVAL' | 'SELECT_APPROVER' | 'AUTO'
  approverUserId?: string
}

export type ProvisionedDingTalkMemberBot = Required<Pick<
  DingTalkProvisioningFacts,
  'unifiedAppId' | 'appKey' | 'appSecret' | 'robotCode' | 'versionId'
>>

export type DingTalkProvisioningInput = {
  appName: string
  description: string
  resolveIconMediaId(appKey: string, appSecret: string): Promise<string>
  expectedCorpId: string
  expectedUserId: string
  frozen?: Partial<ProvisionedDingTalkMemberBot>
  resumeState?: string
  frozenApprovalMode?: 'NO_APPROVAL' | 'SELECT_APPROVER' | 'AUTO'
  selectedApproverUserId?: string
  requiredScopeValues: readonly string[]
  requiredEventCodes: readonly string[]
  signal: AbortSignal
  onStep(step: DingTalkPublicationStep, facts: DingTalkProvisioningFacts): Promise<void>
}

export class DingTalkProvisioningError extends Error {
  readonly unknownRemoteState: boolean
  readonly facts: DingTalkProvisioningFacts

  constructor(
    code: string,
    input: { unknownRemoteState?: boolean; facts?: DingTalkProvisioningFacts } = {}
  ) {
    super(code)
    this.name = 'DingTalkProvisioningError'
    this.unknownRemoteState = input.unknownRemoteState ?? false
    this.facts = input.facts ?? {}
  }
}

export class DingTalkApproverSelectionRequired extends DingTalkProvisioningError {
  readonly candidates: Array<{ userId: string; displayName: string }>

  constructor(
    candidates: Array<{ userId: string; displayName: string }>,
    facts: DingTalkProvisioningFacts
  ) {
    super('dingtalk_approver_selection_required', { facts })
    this.candidates = candidates
  }
}

export class DingTalkApprovalPending extends DingTalkProvisioningError {
  constructor(facts: DingTalkProvisioningFacts) {
    super('dingtalk_version_under_review', { facts })
  }
}

export interface DingTalkMemberBotProvisioner {
  create(input: DingTalkProvisioningInput): Promise<ProvisionedDingTalkMemberBot>
}

export class DingTalkOpenPlatformMemberBotProvisioner implements DingTalkMemberBotProvisioner {
  readonly #developerApi: DingTalkDeveloperBackend
  readonly #developerSession: DingTalkDeveloperSessionService

  constructor(input: {
    developerApi: DingTalkDeveloperBackend
    developerSession: DingTalkDeveloperSessionService
  }) {
    this.#developerApi = input.developerApi
    this.#developerSession = input.developerSession
  }

  async create(input: DingTalkProvisioningInput): Promise<ProvisionedDingTalkMemberBot> {
    const resumeRank = provisioningRank(input.resumeState)
    const auth = await this.#developerSession.inspect(input.signal)
    if (
      !auth
      || auth.corpId !== input.expectedCorpId
      || auth.userId !== input.expectedUserId
    ) throw new DingTalkProvisioningError('dingtalk_account_identity_changed')
    await input.onStep('account_verified', {})

    let unifiedAppId = input.frozen?.unifiedAppId
    if (!unifiedAppId) {
      let created: Record<string, unknown>
      try {
        created = businessObject(await this.#developerApi.execute({
          operation: 'app.create',
          values: { appName: input.appName, description: input.description },
          signal: input.signal
        }))
      } catch (error) {
        if (
          (error instanceof DingTalkProvisioningError
            && error.message === 'dingtalk_open_platform_operation_failed')
          || (error instanceof DingTalkDeveloperApiError && error.definitelyRejected)
        ) throw error
        throw new DingTalkProvisioningError('dingtalk_app_create_unknown_remote_state', {
          unknownRemoteState: true
        })
      }
      unifiedAppId = firstString(created, 'unifiedAppId', 'unified_app_id') ?? undefined
      if (!unifiedAppId) {
        throw new DingTalkProvisioningError('dingtalk_app_create_response_invalid', {
          unknownRemoteState: true
        })
      }
      await input.onStep('app_created', { unifiedAppId })
    }
    const app = businessObject(await this.#developerApi.execute({
      operation: 'app.get',
      values: { unifiedAppId },
      signal: input.signal
    }))
    requireIdentity(app, 'unifiedAppId', unifiedAppId)

    const credential = businessObject(await this.#developerApi.execute({
      operation: 'app.credentials.get',
      values: { unifiedAppId },
      signal: input.signal
    }))
    const appKey = firstString(credential, 'appKey', 'clientId')
    const appSecret = firstString(credential, 'appSecret', 'clientSecret', 'secret')
    if (!appKey || !appSecret) throw new DingTalkProvisioningError('dingtalk_app_credentials_invalid')
    if (input.frozen?.appKey && input.frozen.appKey !== appKey) {
      throw new DingTalkProvisioningError('dingtalk_app_key_identity_mismatch')
    }
    await input.onStep('credentials_read', { unifiedAppId, appKey, appSecret })

    let iconMediaId: string | null = null
    if (resumeRank < provisioningRank('avatar_configured')) {
      iconMediaId = await input.resolveIconMediaId(appKey, appSecret)
      businessObject(await this.#developerApi.execute({
        operation: 'app.update',
        values: { unifiedAppId, iconMediaId },
        signal: input.signal
      }))
      const updatedApp = businessObject(await this.#developerApi.execute({
        operation: 'app.get',
        values: { unifiedAppId },
        signal: input.signal
      }))
      requireIdentity(updatedApp, 'unifiedAppId', unifiedAppId)
      requireOptionalMatch(
        updatedApp,
        ['iconMediaId', 'icon_media_id'],
        iconMediaId,
        'dingtalk_app_avatar_verification_failed'
      )
      await input.onStep('avatar_configured', { unifiedAppId, appKey })
    }

    let robotCode = input.frozen?.robotCode
    if (resumeRank < provisioningRank('robot_configured')) {
      iconMediaId ??= await input.resolveIconMediaId(appKey, appSecret)
      businessObject(await this.#developerApi.execute({
        operation: 'app.robot.config',
        values: {
          unifiedAppId,
          robotName: input.appName,
          robotBrief: input.description,
          robotDescription: input.description,
          iconMediaId,
          mode: 'STREAM',
          addScope: true
        },
        signal: input.signal
      }))
      businessObject(await this.#developerApi.execute({
        operation: 'app.robot.enable',
        values: { unifiedAppId },
        signal: input.signal
      }))
    }
    const robot = businessObject(await this.#developerApi.execute({
      operation: 'app.robot.get',
      values: { unifiedAppId },
      signal: input.signal
    }))
    const readRobotCode = firstString(robot, 'robotCode', 'robot_code') ?? appKey
    if (robotCode && robotCode !== readRobotCode) {
      throw new DingTalkProvisioningError('dingtalk_robot_identity_mismatch')
    }
    robotCode = readRobotCode
    requireMatch(
      robot,
      ['mode', 'callbackMode'],
      'STREAM',
      'dingtalk_robot_mode_verification_failed'
    )
    requireMatch(
      robot,
      ['name', 'robotName'],
      input.appName,
      'dingtalk_robot_name_verification_failed'
    )
    requireMatch(
      robot,
      ['robotStatus', 'status'],
      'ONLINE',
      'dingtalk_robot_status_verification_failed'
    )
    if (iconMediaId) {
      requireOptionalMatch(
        robot,
        ['iconMediaId', 'icon_media_id'],
        iconMediaId,
        'dingtalk_robot_avatar_verification_failed'
      )
    }
    if (resumeRank < provisioningRank('robot_configured')) {
      await input.onStep('robot_configured', { unifiedAppId, appKey, robotCode })
    }

    if (resumeRank < provisioningRank('permissions_configured')) {
      if (input.requiredScopeValues.length > 0) {
        businessObject(await this.#developerApi.execute({
          operation: 'app.permission.add',
          values: { unifiedAppId, scopeValues: input.requiredScopeValues },
          signal: input.signal
        }))
      }
      for (const scopeValue of input.requiredScopeValues) {
        const permissions = businessObject(await this.#developerApi.execute({
          operation: 'app.permission.list',
          values: { unifiedAppId, scopeValue, authStatus: 'AUTHED', pageSize: '1' },
          signal: input.signal
        }))
        requireAuthorizedPermission(permissions, scopeValue)
      }
      if (input.requiredEventCodes.length > 0) {
        businessObject(await this.#developerApi.execute({
          operation: 'app.event.subscribe',
          values: { unifiedAppId, eventCodes: input.requiredEventCodes },
          signal: input.signal
        }))
      }
      for (const eventCode of input.requiredEventCodes) {
        const events = businessObject(await this.#developerApi.execute({
          operation: 'app.event.list',
          values: { unifiedAppId, keyword: eventCode, pageSize: '50' },
          signal: input.signal
        }))
        requireSubscribedEvent(events, eventCode)
      }
      await input.onStep('permissions_configured', { unifiedAppId, appKey, robotCode })
    }

    let versionId = input.frozen?.versionId
    if (!versionId) {
      const version = businessObject(await this.#developerApi.execute({
        operation: 'app.version.create',
        values: { unifiedAppId, versionDescription: input.description },
        signal: input.signal
      }))
      versionId = firstString(version, 'versionId', 'version_id', 'id') ?? undefined
      if (!versionId) throw new DingTalkProvisioningError('dingtalk_version_create_response_invalid')
      await input.onStep('version_created', {
        unifiedAppId, appKey, robotCode, versionId
      })
    }

    // A previous publish attempt may have reached DingTalk even when the
    // network response was lost. Read the frozen version before issuing
    // another mutation so retry cannot resubmit a released/reviewing version.
    const existingStatus = businessObject(await this.#developerApi.execute({
      operation: 'app.version.status',
      values: { unifiedAppId, versionId },
      signal: input.signal
    }))
    if (released(existingStatus)) {
      await input.onStep('version_released', {
        unifiedAppId, appKey, robotCode, versionId
      })
      return { unifiedAppId, appKey, appSecret, robotCode, versionId }
    }
    if (approvalRejected(existingStatus)) {
      throw new DingTalkProvisioningError('dingtalk_version_approval_rejected')
    }
    if (approvalPending(existingStatus)) {
      const facts = {
        unifiedAppId, appKey, robotCode, versionId,
        approvalMode: input.frozenApprovalMode
      }
      await input.onStep('awaiting_approval', facts)
      throw new DingTalkApprovalPending(facts)
    }

    if (resumeRank >= provisioningRank('awaiting_approval')) {
      throw new DingTalkApprovalPending({
        unifiedAppId, appKey, robotCode, versionId,
        approvalMode: input.frozenApprovalMode
      })
    }

    const approval = businessObject(await this.#developerApi.execute({
      operation: 'app.version.checkApproval',
      values: { unifiedAppId, versionId },
      signal: input.signal
    }))
    const approvalMode = normalizeApprovalMode(firstString(
      approval,
      'approvalMode',
      'approval_mode',
      'mode'
    ))
    if (!approvalMode) {
      throw new DingTalkProvisioningError('dingtalk_approval_mode_invalid')
    }
    if (approvalMode === 'SELECT_APPROVER' && !input.selectedApproverUserId) {
      const facts = { unifiedAppId, appKey, robotCode, versionId, approvalMode } as const
      await input.onStep('awaiting_approver_selection', facts)
      throw new DingTalkApproverSelectionRequired(approvalCandidates(approval), facts)
    }
    let published: Record<string, unknown>
    try {
      published = businessObject(await this.#developerApi.execute({
        operation: 'app.version.publish',
        values: {
          unifiedAppId,
          versionId,
          approverUserId: input.selectedApproverUserId,
          confirmedSensitive: true
        },
        signal: input.signal
      }))
    } catch (publishError) {
      let recoveredStatus: Record<string, unknown>
      try {
        recoveredStatus = businessObject(await this.#developerApi.execute({
          operation: 'app.version.status',
          values: { unifiedAppId, versionId },
          signal: input.signal
        }))
      } catch {
        throw publishError
      }
      if (released(recoveredStatus)) {
        await input.onStep('version_released', {
          unifiedAppId,
          appKey,
          robotCode,
          versionId,
          approvalMode,
          approverUserId: input.selectedApproverUserId
        })
        return { unifiedAppId, appKey, appSecret, robotCode, versionId }
      }
      if (approvalRejected(recoveredStatus)) {
        throw new DingTalkProvisioningError('dingtalk_version_approval_rejected')
      }
      if (approvalPending(recoveredStatus)) {
        const facts = {
          unifiedAppId, appKey, robotCode, versionId, approvalMode,
          approverUserId: input.selectedApproverUserId
        }
        await input.onStep('awaiting_approval', facts)
        throw new DingTalkApprovalPending(facts)
      }
      throw publishError
    }
    const status = businessObject(await this.#developerApi.execute({
      operation: 'app.version.status',
      values: { unifiedAppId, versionId },
      signal: input.signal
    }))
    if (!released(published) && !released(status)) {
      if (approvalPending(published) || approvalPending(status)) {
        const facts = {
          unifiedAppId, appKey, robotCode, versionId, approvalMode,
          approverUserId: input.selectedApproverUserId
        }
        await input.onStep('awaiting_approval', facts)
        throw new DingTalkApprovalPending(facts)
      }
      throw new DingTalkProvisioningError('dingtalk_version_not_released')
    }
    await input.onStep('version_released', {
      unifiedAppId,
      appKey,
      robotCode,
      versionId,
      approvalMode,
      approverUserId: input.selectedApproverUserId
    })
    return { unifiedAppId, appKey, appSecret, robotCode, versionId }
  }
}

function businessObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DingTalkProvisioningError('dingtalk_open_platform_response_invalid')
  }
  const root = value as Record<string, unknown>
  if (containsBusinessFailure(root, new Set(), 0)) {
    throw new DingTalkProvisioningError('dingtalk_open_platform_operation_failed')
  }
  let current = root
  for (let depth = 0; depth < 8; depth += 1) {
    const nested = ['resource', 'result', 'data', 'content']
      .map((key) => current[key])
      .find((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate))
    if (!nested) break
    current = nested as Record<string, unknown>
  }
  return { ...root, ...current }
}

function containsBusinessFailure(
  value: unknown,
  seen: Set<unknown>,
  depth: number
): boolean {
  if (!value || typeof value !== 'object' || seen.has(value) || depth > 12) return false
  seen.add(value)
  if (Array.isArray(value)) {
    return value.some((item) => containsBusinessFailure(item, seen, depth + 1))
  }
  const record = value as Record<string, unknown>
  if (
    record.success === false
    || record.ok === false
    || (typeof record.outcome === 'string' && record.outcome.toLowerCase() === 'failure')
  ) return true
  return Object.values(record).some((item) => containsBusinessFailure(item, seen, depth + 1))
}

function firstString(value: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const result = stringAt(value, key)
    if (result) return result
  }
  return null
}

function stringAt(value: Record<string, unknown>, key: string): string | null {
  const result = value[key]
  return typeof result === 'string' && result.trim() ? result.trim() : null
}

function requireIdentity(value: Record<string, unknown>, key: string, expected: string): void {
  const actual = firstString(value, key, 'unified_app_id')
  if (actual !== expected) throw new DingTalkProvisioningError('dingtalk_app_identity_mismatch')
}

function requireOptionalMatch(
  value: Record<string, unknown>,
  keys: readonly string[],
  expected: string,
  code: string
): void {
  const actual = firstString(value, ...keys)
  if (actual !== null && actual.toUpperCase() !== expected.toUpperCase()) {
    throw new DingTalkProvisioningError(code)
  }
}

function requireMatch(
  value: Record<string, unknown>,
  keys: readonly string[],
  expected: string,
  code: string
): void {
  const actual = firstString(value, ...keys)
  if (actual === null || actual.toUpperCase() !== expected.toUpperCase()) {
    throw new DingTalkProvisioningError(code)
  }
}

function requireAuthorizedPermission(value: Record<string, unknown>, expected: string): void {
  const found = someRecord(value, (item) => (
    firstString(item, 'scopeValue', 'scope_value', 'permissionCode', 'code') === expected
    && (
      item.authed === true
      || firstString(item, 'authStatus', 'auth_status', 'status')?.toUpperCase() === 'AUTHED'
    )
  ), new Set())
  if (!found) throw new DingTalkProvisioningError('dingtalk_permission_verification_failed')
}

function requireSubscribedEvent(value: Record<string, unknown>, expected: string): void {
  const found = someRecord(value, (item) => {
    const status = firstString(
      item,
      'status',
      'subscribeStatus',
      'subscribe_status'
    )?.toUpperCase()
    const pushType = firstString(item, 'pushType', 'push_type')?.toUpperCase()
    return firstString(item, 'eventCode', 'event_code', 'code') === expected
      && (item.subscribed === true || ['ON', 'SUBSCRIBED', 'ENABLED', 'ACTIVE'].includes(status ?? ''))
      && (pushType === undefined || pushType === 'STREAM')
  }, new Set())
  if (!found) throw new DingTalkProvisioningError('dingtalk_event_verification_failed')
}

function someRecord(
  value: unknown,
  predicate: (value: Record<string, unknown>) => boolean,
  seen: Set<unknown>
): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) {
    return value.some((item) => someRecord(item, predicate, seen))
  }
  const record = value as Record<string, unknown>
  return predicate(record)
    || Object.values(record).some((item) => someRecord(item, predicate, seen))
}

function normalizeApprovalMode(
  value: string | null
): 'NO_APPROVAL' | 'SELECT_APPROVER' | 'AUTO' | null {
  const normalized = value?.toUpperCase()
  if (normalized === 'NO_APPROVAL') return normalized
  if (normalized === 'SELECT_APPROVER') return normalized
  if (
    normalized === 'AUTO'
    || normalized === 'AUTO_APPROVAL'
    || normalized === 'ENTERPRISE_SELF_BUILT'
  ) {
    return 'AUTO'
  }
  return null
}

function approvalCandidates(value: Record<string, unknown>): Array<{
  userId: string
  displayName: string
}> {
  const candidates = value.approvalCandidates ?? value.approvalOptions
    ?? value.candidates ?? value.approvers ?? value.approverList
  if (!Array.isArray(candidates)) return []
  const seen = new Set<string>()
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return []
    const item = candidate as Record<string, unknown>
    const userId = firstString(item, 'userId', 'userID', 'user_id', 'staffId')
    if (!userId || userId.length > 512 || userId.includes('\0') || seen.has(userId)) return []
    seen.add(userId)
    const displayName = firstString(item, 'label', 'name', 'displayName') ?? userId
    return [{ userId, displayName: [...displayName].slice(0, 128).join('') }]
  }).slice(0, 50)
}

function released(value: Record<string, unknown>): boolean {
  if (value.released === true || value.published === true) return true
  const status = firstString(
    value, 'status', 'versionStatus', 'releaseStatus', 'publishStatus'
  )?.toUpperCase()
  return ['RELEASE', 'RELEASED', 'PUBLISHED', 'ONLINE', 'SUCCESS'].includes(status ?? '')
}

function approvalPending(value: Record<string, unknown>): boolean {
  if (value.approvalSubmitted === true && value.published !== true) return true
  const status = firstString(
    value, 'status', 'versionStatus', 'processStatus', 'approvalStatus'
  )?.toUpperCase()
  return ['AUDIT', 'UNDER_REVIEW', 'WAITING', 'PENDING', 'PROCESSING'].includes(status ?? '')
}

function approvalRejected(value: Record<string, unknown>): boolean {
  const status = firstString(
    value, 'status', 'versionStatus', 'processStatus', 'approvalStatus'
  )?.toUpperCase()
  return [
    'REJECTED', 'REFUSED', 'CANCELLED', 'CANCEL', 'WITHDRAW',
    'EXPIRED', 'FAILED', 'FAIL', 'PUBLISH_FAILED'
  ].includes(status ?? '')
}

function provisioningRank(state: string | undefined): number {
  switch (state) {
    case 'account_verified': return 1
    case 'app_created': return 2
    case 'credentials_read': return 3
    case 'avatar_configured': return 4
    case 'robot_configured': return 5
    case 'permissions_configured': return 6
    case 'version_created': return 7
    case 'awaiting_approver_selection': return 8
    case 'awaiting_approval': return 9
    case 'version_released': return 10
    case 'stream_verified': return 11
    case 'card_verified': return 12
    case 'completed': return 13
    default: return 0
  }
}
