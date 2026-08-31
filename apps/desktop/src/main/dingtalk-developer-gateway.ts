import type { ElectronDingTalkDeveloperSessionService, ExpectedDingTalkIdentity } from './dingtalk-developer-session'
import { DingTalkConsoleError, isDingTalkAvatarPng, type DingTalkWebSession } from './dingtalk-web-session'

export type DingTalkDeveloperOperation =
  | 'app.create' | 'app.get' | 'app.update' | 'app.avatar.upload' | 'app.credentials.get'
  | 'app.robot.get' | 'app.robot.config' | 'app.robot.enable'
  | 'app.permission.list' | 'app.permission.add' | 'app.event.list' | 'app.event.subscribe'
  | 'app.version.create' | 'app.version.configure' | 'app.version.checkApproval' | 'app.version.publish' | 'app.version.status'

export type DingTalkDeveloperRequest = {
  operation: DingTalkDeveloperOperation
  expectedIdentity: ExpectedDingTalkIdentity
  values?: Readonly<Record<string, string | boolean | readonly string[] | undefined>>
  image?: Uint8Array
  signal?: AbortSignal
  timeoutMs?: number
}

export interface DingTalkDeveloperBackend {
  execute(request: DingTalkDeveloperRequest): Promise<unknown>
}

export class DingTalkDeveloperApiError extends Error {
  readonly definitelyRejected: boolean
  constructor(code: string, options: { definitelyRejected?: boolean } = {}) {
    super(code)
    this.name = 'DingTalkDeveloperApiError'
    this.definitelyRejected = options.definitelyRejected ?? false
  }
}

/** Developer console adapter. App-only OpenAPI and Stream remain separate. */
export class DingTalkDeveloperGateway implements DingTalkDeveloperBackend {
  readonly #session: Pick<ElectronDingTalkDeveloperSessionService, 'withConsoleSession'>

  constructor(options: { session: Pick<ElectronDingTalkDeveloperSessionService, 'withConsoleSession'> }) {
    this.#session = options.session
  }

  async execute(request: DingTalkDeveloperRequest): Promise<unknown> {
    validateRequest(request)
    try {
      return await this.#session.withConsoleSession(request.expectedIdentity, request.signal,
        (web) => executeConsoleOperation(web, request))
    } catch (error) {
      if (error instanceof DingTalkDeveloperApiError) throw error
      if (error instanceof DingTalkConsoleError) {
        throw new DingTalkDeveloperApiError(error.message, { definitelyRejected: error.definitelyRejected })
      }
      throw new DingTalkDeveloperApiError('dingtalk_open_platform_unavailable')
    }
  }
}

async function executeConsoleOperation(
  web: Pick<DingTalkWebSession, 'request'>,
  request: DingTalkDeveloperRequest
): Promise<unknown> {
  const values = request.values ?? {}
  const options = { signal: request.signal, timeoutMs: request.timeoutMs }
  const id = request.operation === 'app.create' ? '' : requiredString(values, 'unifiedAppId')
  const root = `/openapp/unifiedapp/${id}`
  switch (request.operation) {
    case 'app.create': {
      const presentation = dingTalkApplicationPresentation(
        requiredString(values, 'appName'), requiredString(values, 'description')
      )
      const created = record(await web.request('/openapp/unifiedapp/create', {
        ...options, method: 'POST', body: {
          appType: 2, appName: presentation.name, appDesc: presentation.description
        }
      }))
      if (!created || !identifier(created.unifiedAppId)) {
        throw new DingTalkDeveloperApiError('dingtalk_app_create_response_invalid')
      }
      return { unifiedAppId: created.unifiedAppId }
    }
    case 'app.get': {
      const app = await readApp(web, id, options)
      return { unifiedAppId: id, appName: app.appName, appDescription: app.appDesc,
        iconMediaId: app.appIcon, iconUrl: app.iconUrl }
    }
    case 'app.credentials.get': {
      const app = await readApp(web, id, options)
      const credential = record(await web.request(`${root}/getClientCredentials`, options))
      const current = record(credential?.currentSecrets)
      if (!secret(app.clientId) || credential?.clientId !== app.clientId
        || current?.secretStatus !== 'ENABLED' || !secret(current.clientSecret)) {
        throw new DingTalkDeveloperApiError('dingtalk_app_credentials_invalid')
      }
      return { appKey: app.clientId, appSecret: current.clientSecret }
    }
    case 'app.avatar.upload': {
      await readApp(web, id, options)
      const uploaded = record(await web.request('/microapp/uploadPic/logo.json', {
        ...options, method: 'POST', image: request.image
      }))
      if (!canonical(uploaded?.logoImg) || !imageUrl(uploaded.logoImgUrl)) {
        throw new DingTalkDeveloperApiError('dingtalk_app_avatar_upload_invalid')
      }
      return { iconMediaId: uploaded.logoImg, iconUrl: uploaded.logoImgUrl }
    }
    case 'app.update': {
      const app = await readApp(web, id, options)
      const iconMediaId = requiredString(values, 'iconMediaId')
      const iconUrl = requiredString(values, 'iconUrl')
      if (!imageUrl(iconUrl) || !canonical(app.appName) || !canonical(app.appDesc)) throw rejectedArgument()
      mutationSucceeded(await web.request(`${root}/update`, {
        ...options, method: 'POST', body: {
          unifiedAppId: id, appName: app.appName, appDesc: app.appDesc,
          appIcon: iconMediaId, iconUrl
        }
      }))
      const updated = await readApp(web, id, options)
      if (updated.appIcon !== iconMediaId || updated.iconUrl !== iconUrl) {
        throw new DingTalkDeveloperApiError('dingtalk_app_avatar_verification_failed')
      }
      return { success: true }
    }
    case 'app.robot.enable': {
      await readApp(web, id, options)
      const read = async (): Promise<boolean> => {
        const abilities = await web.request(`${root}/abilityList`, options)
        if (!Array.isArray(abilities)) throw protocolUnverified()
        const bots = abilities.filter((item) => record(item)?.code === 'bot')
        if (bots.length !== 1 || typeof bots[0].enabled !== 'boolean') throw protocolUnverified()
        return bots[0].enabled
      }
      if (!await read()) {
        mutationSucceeded(await web.request(`${root}/ability/enable`, {
          ...options, method: 'POST', body: { unifiedAppId: id, abilityTypes: ['bot'] }
        }))
        if (!await read()) throw new DingTalkDeveloperApiError('dingtalk_robot_enable_verification_failed')
      }
      return { success: true }
    }
    case 'app.robot.get': {
      const context = await readRobotContext(web, id, options)
      return robotView(context)
    }
    case 'app.robot.config': {
      if (values.mode !== 'STREAM') throw rejectedArgument()
      const context = await readRobotContext(web, id, options)
      const { app, inner, robot } = context
      const iconMediaId = requiredString(values, 'iconMediaId')
      if (!canonical(app.appName) || !canonical(app.appDesc) || app.appIcon !== iconMediaId) {
        throw new DingTalkDeveloperApiError('dingtalk_robot_configuration_invalid')
      }
      const body = {
        appId: app.providerAppId, appKey: app.clientId,
        name: app.appName, brief: [...app.appName].slice(0, 10).join(''),
        description: app.appDesc, iconMediaId, previewMediaId: iconMediaId,
        mode: 1, requestType: 'json', i18nName: {}, i18nBrief: {}, i18nDescription: {}
      }
      if (Object.keys(robot).length === 0 && canonical(inner.robotCode)) {
        throw new DingTalkDeveloperApiError('dingtalk_robot_identity_mismatch')
      }
      if (Object.keys(robot).length > 0) {
        robotView(context)
        if (robot.mode === 1 && robot.name === body.name && robot.iconMediaId === iconMediaId
          && robot.status === 2) return { success: true }
      }
      // Re-read before choosing create/update. A lost robot-create response can
      // only reconcile this app's robot; it never creates another application.
      mutationSucceeded(await web.request(`/openapp/inner/robot/${Object.keys(robot).length ? 'update' : 'create'}`, {
        ...options, method: 'POST', body
      }))
      const verified = robotView(await readRobotContext(web, id, options))
      if (verified.mode !== 'STREAM' || verified.status !== 'ONLINE' || verified.name !== body.name
        || verified.iconMediaId !== iconMediaId) {
        throw new DingTalkDeveloperApiError('dingtalk_robot_configuration_verification_failed')
      }
      return { success: true }
    }
    case 'app.permission.list': {
      const items = await readScopes(web, root, options)
      return { items: items.filter((item) => values.scopeValue === undefined || item.scopeValue === values.scopeValue) }
    }
    case 'app.permission.add': {
      const wanted = stringList(values, 'scopeValues')
      const catalog = await readScopes(web, root, options)
      const missing = wanted.filter((scopeValue) => {
        const rows = catalog.filter((item) => item.scopeValue === scopeValue)
        if (rows.length !== 1) throw new DingTalkDeveloperApiError('dingtalk_permission_verification_failed')
        const row = rows[0]!
        if (row.authed) return false
        if (!row.canEdit || typeof row.requiredApproval !== 'boolean' || row.sensitivityInvolved !== 0) {
          throw new DingTalkDeveloperApiError('dingtalk_permission_manual_review_required', { definitelyRejected: true })
        }
        return true
      })
      if (missing.length) {
        mutationSucceeded(await web.request(`${root}/scope/authScope`, {
          ...options, method: 'POST',
          body: { scopeValue: JSON.stringify(missing), isIsvScope: false, from: '' }
        }))
        const verified = await readScopes(web, root, options)
        if (!wanted.every((name) => verified.some((item) => item.scopeValue === name && item.authed))) {
          throw new DingTalkDeveloperApiError('dingtalk_permission_verification_failed')
        }
      }
      return { success: true }
    }
    case 'app.version.create': {
      const app = await readApp(web, id, options)
      if (!identifier(app.versionId)) throw new DingTalkDeveloperApiError('dingtalk_version_identity_invalid')
      const version = await readVersion(web, id, app.versionId, options)
      if (version.status !== 'INIT' || version.version !== '' || version.maxVersion) {
        throw new DingTalkDeveloperApiError('dingtalk_version_draft_conflict')
      }
      // Creation already allocated a draft. Return its identity for the Core
      // checkpoint BEFORE commitVersion, rather than committing an unfrozen ID.
      return { versionId: app.versionId }
    }
    case 'app.version.configure': {
      const versionId = requiredString(values, 'versionId')
      const version = await readVersion(web, id, versionId, options)
      const description = dingTalkApplicationPresentation('Rovai', requiredString(values, 'versionDescription')).description
      if (version.status !== 'INIT') throw new DingTalkDeveloperApiError('dingtalk_version_draft_conflict')
      if (version.version) {
        requirePreparedVersion(version, request.expectedIdentity.userId, description)
        return { success: true }
      }
      if (version.maxVersion) throw new DingTalkDeveloperApiError('dingtalk_version_draft_conflict')
      const uid = ownerScopeUid(version, request.expectedIdentity.userId)
      mutationSucceeded(await web.request(`${root}/commitVersion`, {
        ...options, method: 'POST', body: {
          unifiedAppId: id, versionId, version: '1.0.0', description,
          scopeVO: { deptId: '', uid, roleId: '', dynamicGroup: '', isHidden: false },
          scopeSelf: true, relatedAbility: {}
        }
      }))
      requirePreparedVersion(await readVersion(web, id, versionId, options), request.expectedIdentity.userId, description)
      return { success: true }
    }
    case 'app.version.status':
      return readVersion(web, id, requiredString(values, 'versionId'), options)
    case 'app.version.checkApproval': {
      const version = await readVersion(web, id, requiredString(values, 'versionId'), options)
      requirePreparedVersion(version, request.expectedIdentity.userId)
      return readApproval(web, version, options)
    }
    case 'app.version.publish': {
      const versionId = requiredString(values, 'versionId')
      const version = await readVersion(web, id, versionId, options)
      if (version.status === 'RELEASE' || version.status === 'AUDIT') return version
      requirePreparedVersion(version, request.expectedIdentity.userId)
      if (version.status !== 'INIT' || values.confirmedSensitive !== false) throw rejectedArgument()
      const approval = await readApproval(web, version, options)
      let approvers: string[] | undefined
      if (approval.approvalMode === 'SELECT_APPROVER') {
        const selected = requiredString(values, 'approverUserId')
        if (!approval.approvalCandidates?.some((item) => item.userId === selected)) {
          throw new DingTalkDeveloperApiError('dingtalk_approver_selection_invalid', { definitelyRejected: true })
        }
        approvers = [selected]
      } else if (values.approverUserId !== undefined) {
        throw new DingTalkDeveloperApiError('dingtalk_approver_selection_invalid', { definitelyRejected: true })
      }
      mutationSucceeded(await web.request(`${root}/publishVersion`, {
        ...options, method: 'POST', body: {
          unifiedAppId: id, versionId, confirmedSensitive: false, ...(approvers ? { approvers } : {})
        }
      }))
      // HTTP success can have no data. The provisioner always reads back the
      // FROZEN version; the app's current version may already be a fresh INIT.
      return { success: true }
    }
    default:
      // Robot/Card callbacks use Stream. No unverified business-event API,
      // OAuth client, DWS, or arbitrary request fallback is admitted here.
      throw protocolUnverified()
  }
}

type Console = Pick<DingTalkWebSession, 'request'>
type RequestOptions = { signal?: AbortSignal; timeoutMs?: number }

async function readApp(
  web: Console,
  id: string,
  options: RequestOptions
): Promise<Record<string, unknown>> {
  const app = record(await web.request(`/openapp/unifiedapp/${encodeURIComponent(id)}/get`, options))
  if (!app || app.unifiedAppId !== id || app.appType !== 2) {
    throw new DingTalkDeveloperApiError('dingtalk_app_identity_mismatch', { definitelyRejected: true })
  }
  return app
}

async function readRobotContext(web: Console, id: string, options: RequestOptions) {
  const app = await readApp(web, id, options)
  if (!numericId(app.providerAppId) || !secret(app.clientId)) throw protocolUnverified()
  const inner = record(await web.request('/app/inner/get', { ...options, query: { id: String(app.providerAppId) } }))
  if (!inner || inner.unifiedAppId !== id || numericId(inner.id) !== numericId(app.providerAppId)
    || inner.appKey !== app.clientId) {
    throw new DingTalkDeveloperApiError('dingtalk_app_identity_mismatch')
  }
  const robot = record(await web.request('/openapp/inner/robot/get', {
    ...options, query: { appId: String(app.providerAppId) }
  }))
  if (!robot) throw protocolUnverified()
  return { app, inner, robot }
}

function robotView({ app, inner, robot }: Awaited<ReturnType<typeof readRobotContext>>) {
  if (numericId(robot.appId) !== numericId(app.providerAppId) || robot.appKey !== app.clientId
    || !canonical(robot.robotCode) || (inner.robotCode !== undefined && inner.robotCode !== robot.robotCode)) {
    throw new DingTalkDeveloperApiError('dingtalk_robot_identity_mismatch')
  }
  return {
    robotCode: robot.robotCode, name: robot.name, iconMediaId: robot.iconMediaId,
    mode: robot.mode === 1 ? 'STREAM' : robot.mode === 0 ? 'HTTPS' : 'UNKNOWN',
    status: robot.status === 2 ? 'ONLINE' : robot.status === 1 ? 'OFFLINE' : 'UNKNOWN'
  }
}

async function readScopes(web: Console, root: string, options: RequestOptions) {
  const groups = await web.request(`${root}/scope/list`, options)
  if (!Array.isArray(groups) || !groups.every((group) => Array.isArray(record(group)?.scopeList))) {
    throw protocolUnverified()
  }
  return groups.flatMap((group) => (group.scopeList as unknown[]).flatMap((value) => {
    const row = record(value)
    const scopeValue = record(row?.openApiScopeVO)?.value
    if (!canonical(scopeValue) || typeof row?.authed !== 'boolean') return []
    return [{ scopeValue, authed: row.authed, canEdit: row.canEdit === true,
      requiredApproval: row.requiredApproval, sensitivityInvolved: row.sensitivityInvolved }]
  }))
}

async function readVersion(web: Console, id: string, versionId: string, options: RequestOptions) {
  const version = record(await web.request(`/openapp/unifiedapp/${id}/getVersion`, {
    ...options, query: { unifiedAppId: id, versionId }
  }))
  if (!version || version.unifiedAppId !== id || version.versionId !== versionId || !canonical(version.status)) {
    throw new DingTalkDeveloperApiError('dingtalk_version_identity_mismatch')
  }
  return version
}

function ownerScopeUid(version: Record<string, unknown>, userId: string): string {
  const rows = Array.isArray(version.visibleScopes) ? version.visibleScopes.map(record) : []
  const owners = rows.filter((item) => item?.staffId === userId && numericId(item.uid))
  if (owners.length !== 1) throw new DingTalkDeveloperApiError('dingtalk_owner_scope_unavailable')
  return numericId(owners[0]!.uid)!
}

function requirePreparedVersion(version: Record<string, unknown>, userId: string, description?: string): void {
  const uid = ownerScopeUid(version, userId)
  const rows = (version.visibleScopes as unknown[]).map(record)
  const ownerOnly = rows.every((row) => row && (
    (row.staffId === userId && numericId(row.uid) === uid && !row.deptId && !row.roleId && !row.dynamicGroup)
    || (Object.keys(row).length === 1 && row.isHidden === false)
  ))
  if (version.version !== '1.0.0' || version.scopeSelf !== true || !ownerOnly
    || (description !== undefined && version.description !== description)) {
    throw new DingTalkDeveloperApiError('dingtalk_version_configuration_verification_failed')
  }
}

async function readApproval(web: Console, version: Record<string, unknown>, options: RequestOptions): Promise<{
  approvalMode: 'NO_APPROVAL' | 'SELECT_APPROVER' | 'AUTO'
  approvalCandidates?: Array<{ userId: string; displayName: string }>
}> {
  if (version.containsSensitivePermissions === true
    || (Array.isArray(version.sensitiveScopeList) && version.sensitiveScopeList.length > 0)) {
    throw new DingTalkDeveloperApiError('dingtalk_permission_manual_review_required', { definitelyRejected: true })
  }
  if (version.enterpriseSelfBuiltAudit === true || version.approvalMode === 'ENTERPRISE_SELF_BUILT') {
    return { approvalMode: 'AUTO' }
  }
  if (version.approvalMode !== 'DING_BPMS' || typeof version.requiredApproval !== 'boolean') {
    throw new DingTalkDeveloperApiError('dingtalk_approval_mode_invalid')
  }
  if (!version.requiredApproval) return { approvalMode: 'NO_APPROVAL' }
  const members = await web.request('/openapp/unifiedapp/permission/member', {
    ...options, query: { publishFlag: true }
  })
  if (!Array.isArray(members) || !members.length
    || members.some((item) => !canonical(record(item)?.staffId))) throw protocolUnverified()
  const seen = new Set<string>()
  const approvalCandidates = members.flatMap((item) => {
    if (seen.has(item.staffId)) return []
    seen.add(item.staffId)
    return [{ userId: item.staffId as string,
      displayName: [...(canonical(item.name) ? item.name : canonical(item.nick) ? item.nick : item.staffId)]
        .slice(0, 128).join('') }]
  }).slice(0, 50)
  return { approvalMode: 'SELECT_APPROVER', approvalCandidates }
}

function mutationSucceeded(value: unknown): void {
  if (value === false || record(value)?.success === false) {
    throw new DingTalkDeveloperApiError('dingtalk_open_platform_operation_failed')
  }
  if (value !== undefined && value !== null && value !== true && !record(value)) throw protocolUnverified()
}

/** The console rejects the middle dot/semicolon in Rovai's normal descriptions. */
export function dingTalkApplicationPresentation(name: string, description: string): { name: string; description: string } {
  let safeName = [...name.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_#*+\-]/gu, '')].slice(0, 20).join('')
  if (!safeName) safeName = 'RovaiBot'
  else if ([...safeName].length < 2) safeName += 'Bot'
  let safeDescription = description.replace(/[^\u4e00-\u9fa5a-zA-Z0-9,.!:\-，。！：、 ]/gu, ' ')
    .replace(/ +/gu, ' ').trim().slice(0, 200)
  if (safeDescription.length < 4) safeDescription = 'Rovai AI Member'
  return { name: safeName, description: safeDescription }
}

const fields: Readonly<Record<DingTalkDeveloperOperation, readonly string[]>> = {
  'app.create': ['appName', 'description'], 'app.get': ['unifiedAppId'],
  'app.update': ['unifiedAppId', 'iconMediaId', 'iconUrl'], 'app.avatar.upload': ['unifiedAppId'],
  'app.credentials.get': ['unifiedAppId'],
  'app.robot.get': ['unifiedAppId'],
  'app.robot.config': ['unifiedAppId', 'iconMediaId', 'mode'],
  'app.robot.enable': ['unifiedAppId'],
  'app.permission.list': ['unifiedAppId', 'scopeValue', 'authStatus', 'pageSize'],
  'app.permission.add': ['unifiedAppId', 'scopeValues'],
  'app.event.list': ['unifiedAppId', 'keyword', 'pageSize'],
  'app.event.subscribe': ['unifiedAppId', 'eventCodes'],
  'app.version.create': ['unifiedAppId', 'versionDescription'],
  'app.version.configure': ['unifiedAppId', 'versionId', 'versionDescription'],
  'app.version.checkApproval': ['unifiedAppId', 'versionId'],
  'app.version.publish': ['unifiedAppId', 'versionId', 'approverUserId', 'confirmedSensitive'],
  'app.version.status': ['unifiedAppId', 'versionId']
}

function validateRequest(request: DingTalkDeveloperRequest): void {
  if (!Object.hasOwn(fields, request.operation)) throw rejectedArgument()
  if (!request.expectedIdentity || !canonical(request.expectedIdentity.corpId)
    || !canonical(request.expectedIdentity.userId)) throw rejectedArgument()
  const values = request.values ?? {}
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    if (!fields[request.operation].includes(key)) throw rejectedArgument()
    if (Array.isArray(value)) {
      if (value.length === 0 || value.length > 256 || !value.every(canonical)) throw rejectedArgument()
    } else if (typeof value !== 'boolean' && !canonical(value)) throw rejectedArgument()
  }
  if (request.operation !== 'app.create' && !identifier(requiredString(values, 'unifiedAppId'))) throw rejectedArgument()
  if (values.versionId !== undefined && !identifier(values.versionId)) throw rejectedArgument()
  const required: Partial<Record<DingTalkDeveloperOperation, string[]>> = {
    'app.create': ['appName', 'description'],
    'app.update': ['iconMediaId', 'iconUrl'],
    'app.robot.config': ['iconMediaId', 'mode'],
    'app.version.configure': ['versionId', 'versionDescription'],
    'app.version.checkApproval': ['versionId'], 'app.version.publish': ['versionId'],
    'app.version.status': ['versionId']
  }
  for (const key of required[request.operation] ?? []) requiredString(values, key)
  if (request.operation === 'app.permission.add') stringList(values, 'scopeValues')
  if (request.operation === 'app.update' && !imageUrl(values.iconUrl)) throw rejectedArgument()
  if (request.operation === 'app.avatar.upload' ? !isDingTalkAvatarPng(request.image) : request.image !== undefined) {
    throw rejectedArgument()
  }
}

function requiredString(values: NonNullable<DingTalkDeveloperRequest['values']>, key: string): string {
  const value = values[key]
  if (!canonical(value)) throw rejectedArgument()
  return value
}

function canonical(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0
    && value.length <= 4096 && !value.includes('\0')
}

function secret(value: unknown): value is string {
  return canonical(value) && !value.includes('*')
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(value)
}

function numericId(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  return typeof value === 'string' && /^[1-9]\d{0,39}$/u.test(value) ? value : null
}

function stringList(values: NonNullable<DingTalkDeveloperRequest['values']>, key: string): string[] {
  const value = values[key]
  if (!Array.isArray(value) || !value.length || !value.every(canonical)) throw rejectedArgument()
  return [...new Set(value)]
}

function imageUrl(value: unknown): value is string {
  if (!canonical(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['dingtalk.com', 'alicdn.com', 'lw.aliimg.com']
        .some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
  } catch { return false }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function rejectedArgument(): DingTalkDeveloperApiError {
  return new DingTalkDeveloperApiError('dingtalk_developer_argument_rejected', { definitelyRejected: true })
}

function protocolUnverified(): DingTalkDeveloperApiError {
  return new DingTalkDeveloperApiError('dingtalk_console_protocol_unverified', { definitelyRejected: true })
}
