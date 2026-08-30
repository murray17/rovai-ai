import { randomUUID } from 'node:crypto'

const DINGTALK_DEVELOPER_ENDPOINT = 'https://mcp-gw.dingtalk.com/server/op-app'
const DINGTALK_CONTACT_ENDPOINT =
  'https://mcp-gw.dingtalk.com/server/db4b26cb38ea6a8739ad55d1997fa1da608cd36b33a6cf0f77884f70c49382fe'
const DINGTALK_CURRENT_USER_ENDPOINT = 'https://api.dingtalk.com/v1.0/contact/users/me'
const MAX_RESPONSE_BYTES = 2_000_000

export type DingTalkDeveloperOperation =
  | 'app.create'
  | 'app.get'
  | 'app.update'
  | 'app.credentials.get'
  | 'app.robot.get'
  | 'app.robot.config'
  | 'app.robot.enable'
  | 'app.permission.list'
  | 'app.permission.add'
  | 'app.event.list'
  | 'app.event.subscribe'
  | 'app.version.create'
  | 'app.version.checkApproval'
  | 'app.version.publish'
  | 'app.version.status'

export type DingTalkDeveloperRequest = {
  operation: DingTalkDeveloperOperation
  values?: Readonly<Record<string, string | boolean | readonly string[] | undefined>>
  signal?: AbortSignal
  timeoutMs?: number
}

export interface DingTalkDeveloperBackend {
  execute(request: DingTalkDeveloperRequest): Promise<unknown>
}

export interface DingTalkUserAccessTokenProvider {
  accessToken(signal?: AbortSignal): Promise<string>
}

export type DingTalkDeveloperIdentityRecord = {
  corpId: string
  corpName: string
  userId: string
  userName: string
}

export class DingTalkDeveloperApiError extends Error {
  readonly definitelyRejected: boolean

  constructor(code: string, options: { definitelyRejected?: boolean } = {}) {
    super(code)
    this.name = 'DingTalkDeveloperApiError'
    this.definitelyRejected = options.definitelyRejected ?? false
  }
}

type FetchLike = typeof globalThis.fetch

export class DingTalkDeveloperApiTransport {
  readonly #fetch: FetchLike
  readonly #developerEndpoint: string
  readonly #contactEndpoint: string
  readonly #currentUserEndpoint: string

  constructor(options: {
    fetchImpl?: FetchLike
    developerEndpoint?: string
    contactEndpoint?: string
    currentUserEndpoint?: string
  } = {}) {
    this.#fetch = options.fetchImpl ?? globalThis.fetch
    this.#developerEndpoint = requireDingTalkEndpoint(
      options.developerEndpoint ?? DINGTALK_DEVELOPER_ENDPOINT,
      DINGTALK_DEVELOPER_ENDPOINT
    )
    this.#contactEndpoint = requireDingTalkEndpoint(
      options.contactEndpoint ?? DINGTALK_CONTACT_ENDPOINT,
      DINGTALK_CONTACT_ENDPOINT
    )
    this.#currentUserEndpoint = requireDingTalkEndpoint(
      options.currentUserEndpoint ?? DINGTALK_CURRENT_USER_ENDPOINT,
      DINGTALK_CURRENT_USER_ENDPOINT
    )
  }

  async callDeveloperTool(input: {
    accessToken: string
    tool: string
    arguments: Readonly<Record<string, unknown>>
    signal?: AbortSignal
    timeoutMs?: number
  }): Promise<unknown> {
    return this.#callTool({
      endpoint: this.#developerEndpoint,
      ...input
    })
  }

  async resolveCurrentUser(input: {
    accessToken: string
    expectedCorpId?: string
    signal?: AbortSignal
  }): Promise<DingTalkDeveloperIdentityRecord> {
    const direct = await this.#readCurrentUser(input).catch(() => null)
    const directIdentity = findIdentity(direct, input.expectedCorpId)
    if (directIdentity) return directIdentity

    const profile = await this.#callTool({
      endpoint: this.#contactEndpoint,
      accessToken: input.accessToken,
      tool: 'get_current_user_profile',
      arguments: {},
      signal: input.signal,
      timeoutMs: 45_000
    })
    const identity = findIdentity(profile, input.expectedCorpId)
    if (!identity) throw new DingTalkDeveloperApiError('dingtalk_login_identity_unavailable')
    return identity
  }

  async #readCurrentUser(input: {
    accessToken: string
    signal?: AbortSignal
  }): Promise<unknown> {
    const accessToken = requireSecret(input.accessToken, 'accessToken')
    const bounded = boundedSignal(input.signal, 30_000)
    try {
      const response = await this.#fetch(this.#currentUserEndpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-acs-dingtalk-access-token': accessToken
        },
        redirect: 'error',
        signal: bounded.signal
      })
      if (!response.ok) throw developerApiHttpError(response.status)
      return readBoundedJson(response)
    } catch (error) {
      throw normalizeTransportError(error, bounded.timedOut())
    } finally {
      bounded.dispose()
    }
  }

  async #callTool(input: {
    endpoint: string
    accessToken: string
    tool: string
    arguments: Readonly<Record<string, unknown>>
    signal?: AbortSignal
    timeoutMs?: number
  }): Promise<unknown> {
    const accessToken = requireSecret(input.accessToken, 'accessToken')
    if (!/^[a-z][a-z0-9_]{1,127}$/u.test(input.tool)) {
      throw new DingTalkDeveloperApiError('dingtalk_developer_operation_rejected')
    }
    const bounded = boundedSignal(input.signal, input.timeoutMs ?? 45_000)
    let response: Response
    try {
      response = await this.#fetch(input.endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Cli-Source': 'rovai-desktop',
          'X-Cli-Execution-Id': randomUUID(),
          'x-user-access-token': accessToken
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: input.tool,
            arguments: input.arguments
          }
        }),
        redirect: 'error',
        signal: bounded.signal
      })
    } catch (error) {
      bounded.dispose()
      throw normalizeTransportError(error, bounded.timedOut())
    }
    try {
      if (!response.ok) throw developerApiHttpError(response.status)
      const envelope = asRecord(await readBoundedJson(response))
      if (!envelope) {
        throw new DingTalkDeveloperApiError('dingtalk_open_platform_response_invalid')
      }
      if (envelope.error !== undefined && envelope.error !== null) {
        throw new DingTalkDeveloperApiError('dingtalk_open_platform_operation_failed', {
          definitelyRejected: true
        })
      }
      const result = asRecord(envelope.result)
      if (!result) {
        throw new DingTalkDeveloperApiError('dingtalk_open_platform_response_invalid')
      }
      if (result.isError === true) {
        throw new DingTalkDeveloperApiError('dingtalk_open_platform_operation_failed', {
          definitelyRejected: true
        })
      }
      const payload = toolPayload(result)
      if (containsBusinessFailure(payload, new Set(), 0)) {
        throw new DingTalkDeveloperApiError('dingtalk_open_platform_operation_failed', {
          definitelyRejected: true
        })
      }
      return payload
    } catch (error) {
      if (error instanceof DingTalkDeveloperApiError) throw error
      throw normalizeTransportError(error, bounded.timedOut())
    } finally {
      bounded.dispose()
    }
  }
}

export class DingTalkDeveloperGateway implements DingTalkDeveloperBackend {
  readonly #tokenProvider: DingTalkUserAccessTokenProvider
  readonly #transport: DingTalkDeveloperApiTransport

  constructor(options: {
    tokenProvider: DingTalkUserAccessTokenProvider
    transport?: DingTalkDeveloperApiTransport
  }) {
    this.#tokenProvider = options.tokenProvider
    this.#transport = options.transport ?? new DingTalkDeveloperApiTransport()
  }

  async execute(request: DingTalkDeveloperRequest): Promise<unknown> {
    const invocation = buildDingTalkDeveloperInvocation(request)
    const accessToken = await this.#tokenProvider.accessToken(request.signal)
    return this.#transport.callDeveloperTool({
      accessToken,
      tool: invocation.tool,
      arguments: invocation.arguments,
      signal: request.signal,
      timeoutMs: request.timeoutMs ?? (request.operation === 'app.create' ? 120_000 : 45_000)
    })
  }
}

type OperationSpec = {
  tool: string
  fields: Readonly<Record<string, { target: string; kind?: 'string' | 'boolean' | 'list' | 'integer' }>>
  required: readonly string[]
  constants?: Readonly<Record<string, unknown>>
}

const OPERATION_SPECS: Readonly<Record<DingTalkDeveloperOperation, OperationSpec>> = {
  'app.create': {
    tool: 'create_dev_app',
    fields: {
      appName: { target: 'name' },
      description: { target: 'desc' }
    },
    required: ['appName']
  },
  'app.get': {
    tool: 'get_dev_app',
    fields: { unifiedAppId: { target: 'unifiedAppId' } },
    required: ['unifiedAppId']
  },
  'app.update': {
    tool: 'update_dev_app',
    fields: {
      unifiedAppId: { target: 'unifiedAppId' },
      iconMediaId: { target: 'iconMediaId' }
    },
    required: ['unifiedAppId', 'iconMediaId']
  },
  'app.credentials.get': {
    tool: 'get_dev_app_credentials',
    fields: { unifiedAppId: { target: 'unifiedAppId' } },
    required: ['unifiedAppId']
  },
  'app.robot.get': {
    tool: 'get_extension_robot_config',
    fields: { unifiedAppId: { target: 'unifiedAppId' } },
    required: ['unifiedAppId']
  },
  'app.robot.config': {
    tool: 'set_extension_robot_config',
    fields: {
      unifiedAppId: { target: 'unifiedAppId' },
      robotName: { target: 'name' },
      robotBrief: { target: 'brief' },
      robotDescription: { target: 'desc' },
      iconMediaId: { target: 'iconMediaId' },
      mode: { target: 'mode' },
      addScope: { target: 'addScope', kind: 'boolean' }
    },
    required: ['unifiedAppId', 'robotName', 'mode']
  },
  'app.robot.enable': {
    tool: 'enable_dev_app_robot',
    fields: { unifiedAppId: { target: 'unifiedAppId' } },
    required: ['unifiedAppId']
  },
  'app.permission.list': {
    tool: 'list_dev_app_permissions',
    fields: {
      unifiedAppId: { target: 'unifiedAppId' },
      scopeValue: { target: 'scopeValue' },
      authStatus: { target: 'authStatus' },
      pageSize: { target: 'pageSize', kind: 'integer' }
    },
    required: ['unifiedAppId']
  },
  'app.permission.add': {
    tool: 'apply_dev_app_permissions',
    fields: {
      unifiedAppId: { target: 'unifiedAppId' },
      scopeValues: { target: 'scopeValues', kind: 'list' }
    },
    required: ['unifiedAppId', 'scopeValues']
  },
  'app.event.list': {
    tool: 'list_dev_app_events',
    fields: {
      unifiedAppId: { target: 'unifiedAppId' },
      keyword: { target: 'keyword' },
      pageSize: { target: 'pageSize', kind: 'integer' }
    },
    required: ['unifiedAppId']
  },
  'app.event.subscribe': {
    tool: 'subscribe_dev_app_events',
    fields: {
      unifiedAppId: { target: 'unifiedAppId' },
      eventCodes: { target: 'eventCodes', kind: 'list' }
    },
    required: ['unifiedAppId', 'eventCodes']
  },
  'app.version.create': {
    tool: 'create_dev_app_version',
    fields: {
      unifiedAppId: { target: 'unifiedAppId' },
      versionDescription: { target: 'desc' }
    },
    required: ['unifiedAppId']
  },
  'app.version.checkApproval': {
    tool: 'publish_dev_app_version',
    fields: {
      unifiedAppId: { target: 'unifiedAppId' },
      versionId: { target: 'versionId' }
    },
    required: ['unifiedAppId', 'versionId'],
    constants: { precheckOnly: true }
  },
  'app.version.publish': {
    tool: 'publish_dev_app_version',
    fields: {
      unifiedAppId: { target: 'unifiedAppId' },
      versionId: { target: 'versionId' },
      approverUserId: { target: 'approverUserId' },
      confirmedSensitive: { target: 'confirmedSensitive', kind: 'boolean' }
    },
    required: ['unifiedAppId', 'versionId'],
    constants: { precheckOnly: false }
  },
  'app.version.status': {
    tool: 'get_dev_app_version_status',
    fields: {
      unifiedAppId: { target: 'unifiedAppId' },
      versionId: { target: 'versionId' }
    },
    required: ['unifiedAppId', 'versionId']
  }
}

export function buildDingTalkDeveloperInvocation(
  request: Pick<DingTalkDeveloperRequest, 'operation' | 'values'>
): { tool: string; arguments: Record<string, unknown> } {
  const spec = OPERATION_SPECS[request.operation]
  if (!spec) throw new DingTalkDeveloperApiError('dingtalk_developer_operation_rejected')
  const values = request.values ?? {}
  const arguments_: Record<string, unknown> = { ...spec.constants }
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    const field = spec.fields[key]
    if (!field) {
      throw new DingTalkDeveloperApiError(`dingtalk_developer_argument_rejected:${key}`)
    }
    arguments_[field.target] = normalizeArgument(key, value, field.kind ?? 'string')
  }
  for (const required of spec.required) {
    if (values[required] === undefined) {
      throw new DingTalkDeveloperApiError(`dingtalk_developer_argument_missing:${required}`)
    }
  }
  return { tool: spec.tool, arguments: arguments_ }
}

function normalizeArgument(
  key: string,
  value: string | boolean | readonly string[],
  kind: 'string' | 'boolean' | 'list' | 'integer'
): unknown {
  if (kind === 'boolean') {
    if (typeof value !== 'boolean') invalidArgument(key)
    return value
  }
  if (kind === 'list') {
    if (!Array.isArray(value) || value.length === 0 || value.length > 256) invalidArgument(key)
    const items = [...new Set(value.map((item) => {
      if (!canonicalArgument(item)) invalidArgument(key)
      return item
    }))]
    if (items.length === 0) invalidArgument(key)
    return items
  }
  if (typeof value !== 'string' || !canonicalArgument(value)) invalidArgument(key)
  if (kind === 'integer') {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) invalidArgument(key)
    return parsed
  }
  return value
}

function invalidArgument(key: string): never {
  throw new DingTalkDeveloperApiError(`dingtalk_developer_argument_invalid:${key}`)
}

function canonicalArgument(value: string): boolean {
  return value.trim() === value && value.length > 0 && value.length <= 4_096 && !value.includes('\0')
}

function toolPayload(result: Record<string, unknown>): unknown {
  if (asRecord(result.structuredContent)) return result.structuredContent
  const content = result.content
  if (asRecord(content)) return content
  if (Array.isArray(content)) {
    for (const block of content) {
      const record = asRecord(block)
      if (!record || record.type !== 'text' || typeof record.text !== 'string') continue
      try {
        return JSON.parse(record.text) as unknown
      } catch {
        continue
      }
    }
  }
  return {}
}

function containsBusinessFailure(value: unknown, seen: Set<unknown>, depth: number): boolean {
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

function findIdentity(value: unknown, expectedCorpId?: string): DingTalkDeveloperIdentityRecord | null {
  const candidates: DingTalkDeveloperIdentityRecord[] = []
  visitRecords(value, (record) => {
    const source = asRecord(record.orgEmployeeModel) ?? record
    const corpId = firstString(source, 'corpId', 'corp_id')
    const corpName = firstString(source, 'orgName', 'corpName', 'corp_name')
    const userId = firstString(source, 'userId', 'userid', 'orgUserId', 'staffId')
    const userName = firstString(source, 'orgUserName', 'userName', 'name', 'nick')
    if (corpId && corpName && userId && userName) {
      candidates.push({ corpId, corpName, userId, userName })
    }
  }, new Set(), 0)
  const unique = [...new Map(candidates.map((candidate) => [
    `${candidate.corpId}\0${candidate.userId}`,
    candidate
  ])).values()]
  const expected = expectedCorpId?.trim()
  if (expected) return unique.find((candidate) => candidate.corpId === expected) ?? null
  return unique.length === 1 ? unique[0]! : null
}

function visitRecords(
  value: unknown,
  visitor: (value: Record<string, unknown>) => void,
  seen: Set<unknown>,
  depth: number
): void {
  if (!value || typeof value !== 'object' || seen.has(value) || depth > 10) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) visitRecords(item, visitor, seen, depth + 1)
    return
  }
  const record = value as Record<string, unknown>
  visitor(record)
  for (const nested of Object.values(record)) visitRecords(nested, visitor, seen, depth + 1)
}

function firstString(value: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    throw new DingTalkDeveloperApiError('dingtalk_open_platform_response_too_large')
  }
  const bytes = await readBoundedBytes(response, MAX_RESPONSE_BYTES, () => (
    new DingTalkDeveloperApiError('dingtalk_open_platform_response_too_large')
  ))
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw new DingTalkDeveloperApiError('dingtalk_open_platform_response_invalid')
  }
}

async function readBoundedBytes(
  response: Response,
  limit: number,
  tooLarge: () => Error
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) {
        await reader.cancel().catch(() => undefined)
        throw tooLarge()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function developerApiHttpError(status: number): DingTalkDeveloperApiError {
  if (status === 401) {
    return new DingTalkDeveloperApiError('dingtalk_oauth_expired', {
      definitelyRejected: true
    })
  }
  if (status === 403) {
    return new DingTalkDeveloperApiError('dingtalk_open_platform_access_denied', {
      definitelyRejected: true
    })
  }
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return new DingTalkDeveloperApiError('dingtalk_open_platform_operation_failed', {
      definitelyRejected: true
    })
  }
  return new DingTalkDeveloperApiError('dingtalk_open_platform_unavailable')
}

function normalizeTransportError(error: unknown, timedOut: boolean): DingTalkDeveloperApiError {
  if (error instanceof DingTalkDeveloperApiError) return error
  if (timedOut) return new DingTalkDeveloperApiError('dingtalk_open_platform_timeout')
  if (isAbortError(error)) return new DingTalkDeveloperApiError('dingtalk_operation_cancelled')
  return new DingTalkDeveloperApiError('dingtalk_open_platform_unavailable')
}

function boundedSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal
  timedOut(): boolean
  dispose(): void
} {
  const controller = new AbortController()
  let timeout = false
  const onAbort = (): void => controller.abort(parent?.reason)
  if (parent?.aborted) controller.abort(parent.reason)
  else parent?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timeout = true
    controller.abort()
  }, timeoutMs)
  timer.unref?.()
  return {
    signal: controller.signal,
    timedOut: () => timeout,
    dispose: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onAbort)
    }
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError'
}

function requireSecret(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 16_384 || normalized.includes('\0')) {
    throw new DingTalkDeveloperApiError(`dingtalk_developer_argument_invalid:${field}`)
  }
  return normalized
}

function requireDingTalkEndpoint(value: string, productionValue: string): string {
  if (value === productionValue) return value
  const parsed = new URL(value)
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new DingTalkDeveloperApiError('dingtalk_developer_endpoint_rejected')
  }
  return parsed.toString()
}
