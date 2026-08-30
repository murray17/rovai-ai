import type { ElectronDingTalkDeveloperSessionService, ExpectedDingTalkIdentity } from './dingtalk-developer-session'
import { DingTalkConsoleError, type DingTalkWebSession } from './dingtalk-web-session'

export type DingTalkDeveloperOperation =
  | 'app.create' | 'app.get' | 'app.update' | 'app.credentials.get'
  | 'app.robot.get' | 'app.robot.config' | 'app.robot.enable'
  | 'app.permission.list' | 'app.permission.add' | 'app.event.list' | 'app.event.subscribe'
  | 'app.version.create' | 'app.version.checkApproval' | 'app.version.publish' | 'app.version.status'

export type DingTalkDeveloperRequest = {
  operation: DingTalkDeveloperOperation
  expectedIdentity: ExpectedDingTalkIdentity
  values?: Readonly<Record<string, string | boolean | readonly string[] | undefined>>
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
  switch (request.operation) {
    case 'app.create':
      return web.request('/openapp/unifiedapp/create', {
        ...options, method: 'POST', body: {
          appType: 2, appName: requiredString(values, 'appName'),
          appDesc: requiredString(values, 'description')
        }
      })
    case 'app.get':
      return readApp(web, requiredString(values, 'unifiedAppId'), options)
    case 'app.credentials.get': {
      const app = await readApp(web, requiredString(values, 'unifiedAppId'), options)
      // The legacy credential endpoint is usable only with a proven agentId
      // from this exact unified app. A unifiedAppId is never guessed as agentId.
      if (typeof app.agentId !== 'string' && typeof app.agentId !== 'number') {
        throw protocolUnverified()
      }
      const credential = record(await web.request('/innerApp/getAppAccount', {
        ...options, query: { agentId: String(app.agentId) }
      }))
      if (!credential || !secret(credential.appKey) || !secret(credential.appSecret)) {
        throw new DingTalkDeveloperApiError('dingtalk_app_credentials_invalid')
      }
      return { appKey: credential.appKey, appSecret: credential.appSecret }
    }
    default:
      // Intentionally closed during the Web Session rollout. Modern console
      // robot/scope/version payloads must be captured and verified in an isolated
      // tenant before admitting those operations. Never fall back to OAuth/MCP.
      throw protocolUnverified()
  }
}

async function readApp(
  web: Pick<DingTalkWebSession, 'request'>,
  id: string,
  options: { signal?: AbortSignal; timeoutMs?: number }
): Promise<Record<string, unknown>> {
  const app = record(await web.request(`/openapp/unifiedapp/${encodeURIComponent(id)}/get`, options))
  if (!app || app.unifiedAppId !== id) {
    throw new DingTalkDeveloperApiError('dingtalk_app_identity_mismatch', { definitelyRejected: true })
  }
  return app
}

const fields: Readonly<Record<DingTalkDeveloperOperation, readonly string[]>> = {
  'app.create': ['appName', 'description'], 'app.get': ['unifiedAppId'],
  'app.update': ['unifiedAppId', 'iconMediaId'], 'app.credentials.get': ['unifiedAppId'],
  'app.robot.get': ['unifiedAppId'],
  'app.robot.config': ['unifiedAppId', 'robotName', 'robotBrief', 'robotDescription', 'iconMediaId', 'mode', 'addScope'],
  'app.robot.enable': ['unifiedAppId'],
  'app.permission.list': ['unifiedAppId', 'scopeValue', 'authStatus', 'pageSize'],
  'app.permission.add': ['unifiedAppId', 'scopeValues'],
  'app.event.list': ['unifiedAppId', 'keyword', 'pageSize'],
  'app.event.subscribe': ['unifiedAppId', 'eventCodes'],
  'app.version.create': ['unifiedAppId', 'versionDescription'],
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
  if (request.operation !== 'app.create') requiredString(values, 'unifiedAppId')
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
  return canonical(value) && !/^\*+$/u.test(value)
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
