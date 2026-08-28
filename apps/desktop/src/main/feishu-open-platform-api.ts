import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { FeishuOpenPlatformSession } from './feishu-developer-session'
import type { ProvisioningTimingRecorder } from './feishu-provisioning-timing'

export interface FeishuMemberBotConsoleConfiguration {
  appName: string
  appDescription: string
  avatarUrl: string
  tenantScopes: readonly string[]
  tenantEvents: readonly string[]
}

export interface FeishuMemberBotVerificationRequirements {
  avatarUrl?: string
  tenantScopes: readonly string[]
  tenantEvents: readonly string[]
}

export interface FeishuPublishedVersion {
  versionId: string
  status: number
}

export interface FeishuPublishedVersionSummary extends FeishuPublishedVersion {
  appVersion: string
}

export type FeishuMemberBotAppCreationMode = 'template' | 'self_build_fallback'

export interface FeishuCreatedMemberBotApp {
  appId: string
  avatarUrl: string
  creationMode: FeishuMemberBotAppCreationMode
}

export interface FeishuConfigurationMutationResult {
  changed: boolean
}

export interface FeishuMemberBotConfigurationMutations {
  scopesChanged: boolean
  eventModeChanged: boolean
  eventsChanged: boolean
  callbackModeChanged: boolean
  manifestChanged: boolean
}

export interface FeishuVerifiedConfigurationState {
  appId: string
  requirementsDigest: `sha256:${string}`
  observedAtMonotonicMs: number
  enabledTenantScopes: string[]
  eventMode: number
  appEvents: string[]
  callbackMode: number
  callbacks: string[]
}

export interface FeishuMemberBotConfigurationResult {
  changed: boolean
  mutations: FeishuMemberBotConfigurationMutations
  verified: FeishuVerifiedConfigurationState
}

export interface FeishuOpenPlatformEventState {
  eventMode: number | null
  events: string[]
  appEvents: string[]
  userEvents: string[]
}

export interface FeishuOpenPlatformCallbackState {
  callbackMode: number | null
  callbacks: string[]
}

export interface FeishuOpenPlatformScope {
  id: string
  name: string
  appStatus: number | null
  supportsAppIdentity: boolean
}

export class FeishuOpenPlatformApiError extends Error {
  readonly code: string
  readonly outcomeUnknown: boolean
  readonly httpStatus: number | null
  readonly remoteCode: string | null

  constructor(
    code: string,
    outcomeUnknown: boolean,
    details: { httpStatus?: number; remoteCode?: string } = {}
  ) {
    super(code)
    this.name = 'FeishuOpenPlatformApiError'
    this.code = code
    this.outcomeUnknown = outcomeUnknown
    this.httpStatus = details.httpStatus ?? null
    this.remoteCode = details.remoteCode ?? null
  }
}

type RequestOptions = {
  signal?: AbortSignal
  body?: Record<string, unknown>
  formData?: FormData
  mutation?: boolean
  requestFromDevelopPanel?: boolean
}

type ApiEnvelope = {
  code?: number | string
  data?: unknown
}

type ClientOptions = {
  publishPollIntervalMs?: number
  publishTimeoutMs?: number
  configurationPollIntervalMs?: number
  configurationTimeoutMs?: number
  delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
  timing?: ProvisioningTimingRecorder
}

const MANIFEST_SCHEMA_VERSION = '0.0.1'
export const FEISHU_MEMBER_BOT_TEMPLATE_ID = 'developer_console'
export const FEISHU_LONG_CONNECTION_MODE = 4
export const FEISHU_PROJECT_SELECTION_CALLBACK = 'card.action.trigger'
const FEISHU_SCOPE_STATUS_DISABLED = 0
const FEISHU_SCOPE_STATUS_ENABLED = 5
const FEISHU_APP_SCOPE_IDENTITY_TYPE = 2
const PUBLISHED_VERSION_STATUS = 2
const WAIT_PUBLISH_VERSION_STATUS = 5
const REJECTED_VERSION_STATUS = 3
const DEFAULT_PUBLISH_POLL_INTERVAL_MS = 1_000
const DEFAULT_PUBLISH_TIMEOUT_MS = 120_000
const DEFAULT_CONFIGURATION_POLL_INTERVAL_MS = 1_000
const DEFAULT_CONFIGURATION_TIMEOUT_MS = 120_000

export class OpenPlatformApiClient {
  readonly #session: FeishuOpenPlatformSession
  readonly #publishPollIntervalMs: number
  readonly #publishTimeoutMs: number
  readonly #configurationPollIntervalMs: number
  readonly #configurationTimeoutMs: number
  readonly #configurationPollAttempts: number
  readonly #delay: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  readonly #now: () => number
  readonly #timing?: ProvisioningTimingRecorder

  constructor(session: FeishuOpenPlatformSession, options: ClientOptions = {}) {
    this.#session = session
    this.#publishPollIntervalMs = options.publishPollIntervalMs
      ?? DEFAULT_PUBLISH_POLL_INTERVAL_MS
    this.#publishTimeoutMs = options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS
    this.#configurationPollIntervalMs = Math.max(
      1,
      options.configurationPollIntervalMs ?? DEFAULT_CONFIGURATION_POLL_INTERVAL_MS
    )
    this.#configurationTimeoutMs = Math.max(
      1,
      options.configurationTimeoutMs ?? DEFAULT_CONFIGURATION_TIMEOUT_MS
    )
    this.#configurationPollAttempts = Math.max(
      1,
      Math.ceil(this.#configurationTimeoutMs / this.#configurationPollIntervalMs) + 1
    )
    this.#delay = options.delay ?? abortableDelay
    this.#now = options.now ?? (() => performance.now())
    this.#timing = options.timing
  }

  async uploadAppIcon(input: {
    pngBytes: Uint8Array
    width: number
    height: number
    signal?: AbortSignal
  }): Promise<string> {
    if (input.pngBytes.byteLength === 0) {
      throw apiError('feishu_console_avatar_empty', false)
    }
    if (!isImageDimension(input.width) || !isImageDimension(input.height)) {
      throw apiError('feishu_console_avatar_dimensions_invalid', false)
    }
    const formData = new FormData()
    formData.append(
      'file',
      new Blob([new Uint8Array(input.pngBytes)], { type: 'image/png' }),
      'rovai-member-bot.png'
    )
    formData.append('uploadType', '4')
    formData.append('isIsv', 'false')
    formData.append('scale', JSON.stringify({ width: input.width, height: input.height }))
    const data = await this.#request('upload_avatar', '/developers/v1/app/upload/image', {
      formData,
      signal: input.signal
    })
    const record = requireRecord(data, 'feishu_console_avatar_response_invalid')
    const directUrl = normalizedString(record.url)
    const urls = Array.isArray(record.urls) ? record.urls : []
    const url = directUrl ?? urls.map(normalizedString).find(Boolean)
    if (!url || !isHttpsUrl(url)) {
      throw apiError('feishu_console_avatar_response_invalid', false)
    }
    return url
  }

  async createApp(input: {
    appName: string
    appDescription: string
    avatarUrl: string
    correlationId: string
    signal?: AbortSignal
  }): Promise<FeishuCreatedMemberBotApp> {
    requireLength(input.appName, 2, 64, 'feishu_console_app_name_invalid')
    requireLength(input.appDescription, 1, 240, 'feishu_console_app_description_invalid')
    if (!isHttpsUrl(input.avatarUrl)) throw apiError('feishu_console_avatar_url_invalid', false)
    requireResourceId(input.correlationId, 'feishu_console_correlation_id_invalid')
    try {
      const data = await this.#request(
        'create_app_from_template',
        '/developers/v1/manifest/upsert_by_template',
        {
          mutation: true,
          signal: input.signal,
          body: buildMemberBotTemplateCreatePayload(input)
        }
      )
      return createdMemberBotApp(data, input.avatarUrl, 'template')
    } catch (error) {
      if (!isDefiniteTemplateCreationRejection(error)) throw error
    }

    const data = await this.#request('create_app', '/developers/v1/app/create', {
      mutation: true,
      signal: input.signal,
      body: {
        appSceneType: 0,
        name: input.appName,
        desc: input.appDescription,
        avatar: input.avatarUrl,
        i18n: {
          zh_cn: {
            name: input.appName,
            description: input.appDescription
          }
        },
        primaryLang: 'zh_cn'
      }
    })
    return createdMemberBotApp(data, input.avatarUrl, 'self_build_fallback')
  }

  async readAppSecret(appId: string, signal?: AbortSignal): Promise<string> {
    const id = requireResourceId(appId, 'feishu_console_app_id_invalid')
    const data = await this.#request(
      'read_secret',
      `/developers/v1/secret/${encodeURIComponent(id)}`,
      { body: {}, signal }
    )
    const record = requireRecord(data, 'feishu_console_secret_response_invalid')
    const secret = firstString(record, ['secret', 'appSecret', 'client_secret'])
    if (!secret) throw apiError('feishu_console_secret_response_invalid', false)
    return secret
  }

  async enableBot(appId: string, signal?: AbortSignal): Promise<void> {
    const id = requireResourceId(appId, 'feishu_console_app_id_invalid')
    await this.#request(
      'enable_bot',
      `/developers/v1/robot/switch/${encodeURIComponent(id)}`,
      {
        body: { enable: true },
        mutation: true,
        signal
      }
    )
  }

  async requestEventLongConnection(
    appId: string,
    signal?: AbortSignal
  ): Promise<FeishuConfigurationMutationResult> {
    const id = requireResourceId(appId, 'feishu_console_app_id_invalid')
    await this.#request(
      'switch_event',
      `/developers/v1/event/switch/${encodeURIComponent(id)}`,
      {
        body: { clientId: id, eventMode: FEISHU_LONG_CONNECTION_MODE },
        mutation: true,
        signal
      }
    )
    return { changed: true }
  }

  async reconcileMemberBotManifest(
    appId: string,
    currentManifest: Record<string, unknown>,
    configuration: FeishuMemberBotConsoleConfiguration,
    signal?: AbortSignal
  ): Promise<FeishuConfigurationMutationResult> {
    const id = requireResourceId(appId, 'feishu_console_app_id_invalid')
    const desiredManifest = desiredMemberBotManifest(currentManifest, configuration)
    if (structuredValueEqual(currentManifest, desiredManifest)) return { changed: false }
    await this.#request(
      'configure_member_bot_manifest',
      '/developers/v1/manifest/upsert',
      {
        body: {
          clientID: id,
          appManifest: JSON.stringify(desiredManifest),
          HTTPHead: {}
        },
        mutation: true,
        signal
      }
    )
    return { changed: true }
  }

  async configureMemberBot(
    appId: string,
    configuration: FeishuMemberBotConsoleConfiguration,
    signal?: AbortSignal,
    onMutationsSubmitted?: () => void
  ): Promise<FeishuMemberBotConfigurationResult> {
    const id = requireResourceId(appId, 'feishu_console_app_id_invalid')
    const initialStartedAt = this.#now()
    const observe = async <T>(action: () => Promise<T>): Promise<ObservedRead<T>> => {
      const startedAt = this.#now()
      try {
        return {
          status: 'fulfilled',
          value: await action(),
          durationMs: this.#now() - startedAt
        }
      } catch (reason) {
        return {
          status: 'rejected',
          reason,
          durationMs: this.#now() - startedAt
        }
      }
    }
    const [scopeRead, eventRead, callbackRead, manifestRead] = await Promise.all([
      observe(() => this.readScopeCatalog(id, signal)),
      observe(() => this.readEventState(id, signal)),
      observe(() => this.readCallbackState(id, signal)),
      observe(() => this.readManifest(id, signal))
    ])
    const initialFailure = firstRejectedRead([
      scopeRead,
      eventRead,
      callbackRead,
      manifestRead
    ])
    if (initialFailure) {
      if (scopeRead.status === 'rejected') {
        this.#timing?.record(
          'scope_config_ms',
          scopeRead.durationMs,
          'failed',
          { failureCode: failureCode(scopeRead.reason) }
        )
      }
      if (eventRead.status === 'rejected') {
        this.#timing?.record(
          'event_convergence_ms',
          eventRead.durationMs,
          'failed',
          { failureCode: failureCode(eventRead.reason) }
        )
      }
      if (callbackRead.status === 'rejected') {
        this.#timing?.record(
          'callback_convergence_ms',
          callbackRead.durationMs,
          'failed',
          { failureCode: failureCode(callbackRead.reason) }
        )
      }
      if (manifestRead.status === 'rejected') {
        this.#timing?.record(
          'manifest_reconcile_ms',
          manifestRead.durationMs,
          'failed',
          { failureCode: failureCode(manifestRead.reason) }
        )
      }
      this.#timing?.record(
        'configuration_convergence_ms',
        this.#now() - initialStartedAt,
        'failed',
        { failureCode: failureCode(initialFailure.reason) }
      )
      throw initialFailure.reason
    }

    const initialScopes = fulfilledRead(scopeRead)
    const initialEvent = fulfilledRead(eventRead)
    const initialCallback = fulfilledRead(callbackRead)
    const initialManifest = fulfilledRead(manifestRead)
    let requiredScopes: FeishuOpenPlatformScope[]
    try {
      requiredScopes = resolveRequiredAppScopes(
        initialScopes,
        configuration.tenantScopes
      )
    } catch (error) {
      this.#timing?.record(
        'scope_config_ms',
        scopeRead.durationMs,
        'failed',
        { failureCode: failureCode(error) }
      )
      this.#timing?.record(
        'configuration_convergence_ms',
        this.#now() - initialStartedAt,
        'failed',
        { failureCode: failureCode(error), missingDimensions: ['scope'] }
      )
      throw error
    }
    const disabledScopes = requiredScopes.filter(
      (scope) => scope.appStatus === FEISHU_SCOPE_STATUS_DISABLED
    )
    const missingEvents = configuration.tenantEvents.filter(
      (event) => !initialEvent.appEvents.includes(event)
    )
    const desiredManifest = desiredMemberBotManifest(initialManifest, configuration)
    const mutations: FeishuMemberBotConfigurationMutations = {
      scopesChanged: disabledScopes.length > 0,
      eventModeChanged: initialEvent.eventMode !== FEISHU_LONG_CONNECTION_MODE,
      eventsChanged: missingEvents.length > 0,
      callbackModeChanged: initialCallback.callbackMode !== FEISHU_LONG_CONNECTION_MODE,
      manifestChanged: !structuredValueEqual(initialManifest, desiredManifest)
    }
    const changed = Object.values(mutations).some(Boolean)
    this.#timing?.setMutations({
      scopesChanged: mutations.scopesChanged,
      eventsChanged: mutations.eventModeChanged || mutations.eventsChanged,
      callbacksChanged: mutations.callbackModeChanged || (
        mutations.manifestChanged
        && !initialCallback.callbacks.includes(FEISHU_PROJECT_SELECTION_CALLBACK)
      ),
      manifestChanged: mutations.manifestChanged
    })

    let scopeTimingRecorded = false
    let manifestTimingRecorded = false
    let eventTimingRecorded = false
    let callbackTimingRecorded = false
    let configurationTimingRecorded = false
    let eventConvergenceStartedAt = initialStartedAt
    let callbackConvergenceStartedAt = initialStartedAt
    try {
      let scopeMutationDurationMs = 0
      if (mutations.scopesChanged) {
        const startedAt = this.#now()
        try {
          await this.#request(
            'configure_scopes',
            `/developers/v1/scope/update/${encodeURIComponent(id)}`,
            {
              body: {
                clientId: id,
                appScopeIDs: disabledScopes.map((scope) => scope.id),
                userScopeIDs: [],
                scopeIds: [],
                operation: 'add'
              },
              mutation: true,
              signal
            }
          )
        } catch (error) {
          this.#timing?.record(
            'scope_config_ms',
            scopeRead.durationMs + this.#now() - startedAt,
            'failed',
            { failureCode: failureCode(error) }
          )
          scopeTimingRecorded = true
          throw error
        }
        scopeMutationDurationMs = this.#now() - startedAt
      }
      this.#timing?.record(
        'scope_config_ms',
        scopeRead.durationMs + scopeMutationDurationMs,
        'ok'
      )
      scopeTimingRecorded = true

      if (mutations.eventModeChanged) {
        await this.#request(
          'switch_event',
          `/developers/v1/event/switch/${encodeURIComponent(id)}`,
          {
            body: { clientId: id, eventMode: FEISHU_LONG_CONNECTION_MODE },
            mutation: true,
            signal
          }
        )
      }
      if (mutations.eventsChanged) {
        await this.#request(
          'configure_events',
          `/developers/v1/event/update/${encodeURIComponent(id)}`,
          {
            body: {
              clientId: id,
              operation: 'add',
              events: [],
              appEvents: missingEvents,
              userEvents: [],
              eventMode: FEISHU_LONG_CONNECTION_MODE
            },
            mutation: true,
            signal
          }
        )
      }
      eventConvergenceStartedAt = this.#now()

      let manifestMutationDurationMs = 0
      if (mutations.manifestChanged) {
        const startedAt = this.#now()
        try {
          await this.reconcileMemberBotManifest(
            id,
            initialManifest,
            configuration,
            signal
          )
        } catch (error) {
          this.#timing?.record(
            'manifest_reconcile_ms',
            manifestRead.durationMs + this.#now() - startedAt,
            'failed',
            { failureCode: failureCode(error) }
          )
          manifestTimingRecorded = true
          throw error
        }
        manifestMutationDurationMs = this.#now() - startedAt
      }
      this.#timing?.record(
        'manifest_reconcile_ms',
        manifestRead.durationMs + manifestMutationDurationMs,
        'ok'
      )
      manifestTimingRecorded = true

      if (mutations.callbackModeChanged) {
        await this.#request(
          'switch_callback',
          `/developers/v1/callback/switch/${encodeURIComponent(id)}`,
          {
            body: { clientId: id, callbackMode: FEISHU_LONG_CONNECTION_MODE },
            mutation: true,
            signal
          }
        )
      }
      callbackConvergenceStartedAt = this.#now()
      const configurationConvergenceStartedAt = this.#now()
      onMutationsSubmitted?.()

      let latestScopes: FeishuOpenPlatformScope[] | null = changed ? null : initialScopes
      let latestEvent: FeishuOpenPlatformEventState | null = changed ? null : initialEvent
      let latestCallback: FeishuOpenPlatformCallbackState | null = changed
        ? null
        : initialCallback
      let scopeReady = latestScopes ? scopesReady(latestScopes, configuration) : false
      let eventReady = latestEvent ? eventStateReady(latestEvent, configuration) : false
      let callbackReady = latestCallback ? callbackStateReady(latestCallback) : false

      if (!changed) {
        if (eventReady) {
          this.#timing?.record('event_convergence_ms', eventRead.durationMs, 'ok')
          eventTimingRecorded = true
        }
        if (callbackReady) {
          this.#timing?.record('callback_convergence_ms', callbackRead.durationMs, 'ok')
          callbackTimingRecorded = true
        }
      }

      const deadline = configurationConvergenceStartedAt + this.#configurationTimeoutMs
      let attempts = 0
      while (!(scopeReady && eventReady && callbackReady)) {
        if (signal?.aborted) throw apiError('feishu_provisioning_cancelled', false)
        if (attempts >= this.#configurationPollAttempts || this.#now() > deadline) break
        attempts += 1
        const [scopeResult, eventResult, callbackResult] = await Promise.allSettled([
          this.readScopeCatalog(id, signal),
          this.readEventState(id, signal),
          this.readCallbackState(id, signal)
        ])
        if (scopeResult.status === 'fulfilled') latestScopes = scopeResult.value
        if (eventResult.status === 'fulfilled') latestEvent = eventResult.value
        if (callbackResult.status === 'fulfilled') latestCallback = callbackResult.value
        scopeReady = latestScopes ? scopesReady(latestScopes, configuration) : false
        eventReady = latestEvent ? eventStateReady(latestEvent, configuration) : false
        callbackReady = latestCallback ? callbackStateReady(latestCallback) : false
        const observedAt = this.#now()
        if (eventReady && !eventTimingRecorded) {
          this.#timing?.record(
            'event_convergence_ms',
            observedAt - eventConvergenceStartedAt,
            'ok'
          )
          eventTimingRecorded = true
        }
        if (callbackReady && !callbackTimingRecorded) {
          this.#timing?.record(
            'callback_convergence_ms',
            observedAt - callbackConvergenceStartedAt,
            'ok'
          )
          callbackTimingRecorded = true
        }
        if (scopeReady && eventReady && callbackReady) break
        const remainingMs = deadline - this.#now()
        if (remainingMs <= 0 || attempts >= this.#configurationPollAttempts) break
        await this.#delay(Math.min(this.#configurationPollIntervalMs, remainingMs), signal)
      }

      if (!scopeReady || !eventReady || !callbackReady || !latestScopes || !latestEvent || !latestCallback) {
        const missingDimensions = configurationMissingDimensions({
          scopeReady,
          eventReady,
          callbackReady
        })
        const error = apiError(configurationFailureCode(missingDimensions), true)
        const failedAt = this.#now()
        if (!eventReady && !eventTimingRecorded) {
          this.#timing?.record(
            'event_convergence_ms',
            failedAt - eventConvergenceStartedAt,
            'failed',
            { failureCode: error.code, missingDimensions }
          )
          eventTimingRecorded = true
        }
        if (!callbackReady && !callbackTimingRecorded) {
          this.#timing?.record(
            'callback_convergence_ms',
            failedAt - callbackConvergenceStartedAt,
            'failed',
            { failureCode: error.code, missingDimensions }
          )
          callbackTimingRecorded = true
        }
        this.#timing?.record(
          'configuration_convergence_ms',
          failedAt - configurationConvergenceStartedAt,
          'failed',
          { failureCode: error.code, missingDimensions }
        )
        configurationTimingRecorded = true
        throw error
      }

      const completedAt = this.#now()
      if (!eventTimingRecorded) {
        this.#timing?.record(
          'event_convergence_ms',
          completedAt - eventConvergenceStartedAt,
          'ok'
        )
      }
      if (!callbackTimingRecorded) {
        this.#timing?.record(
          'callback_convergence_ms',
          completedAt - callbackConvergenceStartedAt,
          'ok'
        )
      }
      this.#timing?.record(
        'configuration_convergence_ms',
        changed
          ? completedAt - configurationConvergenceStartedAt
          : completedAt - initialStartedAt,
        'ok'
      )
      configurationTimingRecorded = true
      return {
        changed,
        mutations,
        verified: verifiedConfigurationState(
          id,
          configuration,
          latestScopes,
          latestEvent,
          latestCallback,
          completedAt
        )
      }
    } catch (error) {
      const failedAt = this.#now()
      if (!scopeTimingRecorded && scopeRead.status === 'fulfilled') {
        this.#timing?.record(
          'scope_config_ms',
          failedAt - initialStartedAt,
          'failed',
          { failureCode: failureCode(error) }
        )
      }
      if (!manifestTimingRecorded && manifestRead.status === 'fulfilled') {
        this.#timing?.record(
          'manifest_reconcile_ms',
          failedAt - initialStartedAt,
          'failed',
          { failureCode: failureCode(error) }
        )
      }
      if (!configurationTimingRecorded) {
        this.#timing?.record(
          'configuration_convergence_ms',
          failedAt - initialStartedAt,
          'failed',
          { failureCode: failureCode(error) }
        )
      }
      throw error
    }
  }

  async readScopeCatalog(
    appId: string,
    signal?: AbortSignal
  ): Promise<FeishuOpenPlatformScope[]> {
    const id = requireResourceId(appId, 'feishu_console_app_id_invalid')
    const data = await this.#request(
      'read_scopes',
      `/developers/v1/scope/all/${encodeURIComponent(id)}`,
      { body: { clientId: id }, signal }
    )
    const record = requireRecord(data, 'feishu_console_scope_catalog_invalid')
    if (!Array.isArray(record.scopes)) {
      throw apiError('feishu_console_scope_catalog_invalid', false)
    }
    return record.scopes.flatMap((candidate) => {
      const scope = optionalRecord(candidate)
      const scopeId = firstString(scope, ['id', 'scopeId', 'scope_id'])
      const name = firstString(scope, ['name', 'scopeName', 'scope_name'])
      if (!scopeId || !isResourceId(scopeId) || !name) return []
      const identityStatus = optionalRecord(scope.scopeType2ScopeStatus)
      const appStatus = numericValue(
        identityStatus[String(FEISHU_APP_SCOPE_IDENTITY_TYPE)]
          ?? identityStatus.App
          ?? identityStatus.app
          ?? scope.status
      )
      const identityTypes = unionNumericArrays(
        scope.supportScopeIdentityTypes,
        scope.scopeType
      )
      const explicitIdentityType = numericValue(scope.scopeIdentityType)
      if (explicitIdentityType !== null) identityTypes.push(explicitIdentityType)
      const hasIdentityMetadata = identityTypes.length > 0
        || Object.keys(identityStatus).length > 0
      return [{
        id: scopeId,
        name,
        appStatus,
        supportsAppIdentity: !hasIdentityMetadata
          || identityTypes.includes(FEISHU_APP_SCOPE_IDENTITY_TYPE)
          || String(FEISHU_APP_SCOPE_IDENTITY_TYPE) in identityStatus
      }]
    })
  }

  async readEventState(
    appId: string,
    signal?: AbortSignal
  ): Promise<FeishuOpenPlatformEventState> {
    const id = requireResourceId(appId, 'feishu_console_app_id_invalid')
    const data = await this.#request(
      'read_event',
      `/developers/v1/event/${encodeURIComponent(id)}`,
      { body: { needEventDetail: true }, signal }
    )
    const record = requireRecord(data, 'feishu_console_event_response_invalid')
    return {
      eventMode: numericValue(record.eventMode),
      events: uniqueStrings([
        ...eventIdentifiers(record.events),
        ...eventIdentifiers(record.eventDetails)
      ]),
      appEvents: uniqueStrings([
        ...eventIdentifiers(record.appEvents),
        ...eventIdentifiers(record.appEventDetails)
      ]),
      userEvents: uniqueStrings([
        ...eventIdentifiers(record.userEvents),
        ...eventIdentifiers(record.userEventDetails)
      ])
    }
  }

  async readCallbackState(
    appId: string,
    signal?: AbortSignal
  ): Promise<FeishuOpenPlatformCallbackState> {
    const id = requireResourceId(appId, 'feishu_console_app_id_invalid')
    const data = await this.#request(
      'read_callback',
      `/developers/v1/callback/${encodeURIComponent(id)}`,
      { body: { clientId: id }, signal }
    )
    const record = requireRecord(data, 'feishu_console_callback_response_invalid')
    return {
      callbackMode: numericValue(record.callbackMode),
      callbacks: uniqueStrings([
        ...eventIdentifiers(record.callbacks),
        ...eventIdentifiers(record.callbackDetails)
      ])
    }
  }

  async readBotEnabled(appId: string, signal?: AbortSignal): Promise<boolean> {
    const id = requireResourceId(appId, 'feishu_console_app_id_invalid')
    const data = await this.#request(
      'read_bot',
      `/developers/v1/robot/${encodeURIComponent(id)}`,
      { body: { clientId: id }, signal }
    )
    const record = requireRecord(data, 'feishu_console_bot_response_invalid')
    if (typeof record.enable !== 'boolean') {
      throw apiError('feishu_console_bot_response_invalid', false)
    }
    return record.enable
  }

  async createVersion(input: {
    appId: string
    ownerUserId: string
    appVersion?: string
    remark?: string
    changeLog?: string
    reuseExisting?: boolean
    signal?: AbortSignal
  }): Promise<string> {
    const appId = requireResourceId(input.appId, 'feishu_console_app_id_invalid')
    const ownerUserId = requireResourceId(
      input.ownerUserId,
      'feishu_console_owner_user_id_invalid'
    )
    const appVersion = requireAppVersion(input.appVersion ?? '1.0.0')
    if (input.reuseExisting) {
      const existing = (await this.#listVersions(appId, input.signal))
        .find((version) => version.appVersion === appVersion)
      if (existing) return existing.versionId
    }
    const data = await this.#request(
      'create_version',
      `/developers/v1/app_version/create/${encodeURIComponent(appId)}`,
      {
        body: {
          autoPublish: false,
          remark: input.remark ?? 'Rovai AI 队员 Bot 首次发布',
          changeLog: input.changeLog ?? '由 Rovai AI 配置 Bot、权限、事件与长连接。',
          appVersion,
          visibleSuggest: {
            departments: [],
            members: [ownerUserId],
            groups: [],
            isAll: 0
          },
          blackVisibleSuggest: {
            departments: [],
            members: [],
            groups: [],
            isAll: 0
          },
          b2cShareSuggest: false,
          pcDefaultAbility: 'bot',
          mobileDefaultAbility: 'bot'
        },
        mutation: true,
        signal: input.signal
      }
    )
    const record = optionalRecord(data)
    const directVersionId = firstString(record, ['versionId', 'version_id', 'id'])
    if (directVersionId && isResourceId(directVersionId)) return directVersionId

    const versions = await this.#listVersions(appId, input.signal)
    const created = versions.find((version) => version.appVersion === appVersion)
    if (created) return created.versionId
    throw apiError('feishu_console_version_response_invalid', true)
  }

  async findPublishedVersion(
    appId: string,
    signal?: AbortSignal
  ): Promise<FeishuPublishedVersionSummary> {
    const normalizedAppId = requireResourceId(appId, 'feishu_console_app_id_invalid')
    const versions = (await this.#listVersions(normalizedAppId, signal))
      .filter((version): version is { versionId: string; appVersion: string } => (
        version.appVersion !== null && isAppVersion(version.appVersion)
      ))
      .sort((left, right) => compareAppVersions(right.appVersion, left.appVersion))
    for (const candidate of versions) {
      const version = await this.readVersion(normalizedAppId, candidate.versionId, signal)
      if (version.status === PUBLISHED_VERSION_STATUS) {
        return { ...version, appVersion: candidate.appVersion }
      }
    }
    throw apiError('feishu_console_published_version_not_found', false)
  }

  async findVersion(
    appId: string,
    appVersion: string,
    signal?: AbortSignal
  ): Promise<FeishuPublishedVersionSummary | null> {
    const normalizedAppId = requireResourceId(appId, 'feishu_console_app_id_invalid')
    const normalizedAppVersion = requireAppVersion(appVersion)
    const candidate = (await this.#listVersions(normalizedAppId, signal))
      .find((version) => version.appVersion === normalizedAppVersion)
    if (!candidate) return null
    return {
      ...(await this.readVersion(normalizedAppId, candidate.versionId, signal)),
      appVersion: normalizedAppVersion
    }
  }

  async publishVersion(
    appId: string,
    versionId: string,
    signal?: AbortSignal
  ): Promise<FeishuPublishedVersion> {
    const normalizedAppId = requireResourceId(appId, 'feishu_console_app_id_invalid')
    const normalizedVersionId = requireResourceId(
      versionId,
      'feishu_console_version_id_invalid'
    )
    const current = await this.readVersion(normalizedAppId, normalizedVersionId, signal)
    if (current.status === PUBLISHED_VERSION_STATUS) return current
    if (current.status === REJECTED_VERSION_STATUS) {
      throw apiError('feishu_console_version_rejected', false)
    }
    await this.#request(
      'commit_version',
      `/developers/v1/publish/commit/${encodeURIComponent(normalizedAppId)}/${encodeURIComponent(normalizedVersionId)}`,
      {
        body: {
          // Path parameters are consumed by the console client before it sends the JSON body.
        },
        mutation: true,
        requestFromDevelopPanel: true,
        signal
      }
    )

    const deadline = Date.now() + this.#publishTimeoutMs
    let releaseRequested = false
    let releaseFailure: FeishuOpenPlatformApiError | null = null
    while (Date.now() < deadline) {
      const version = await this.readVersion(normalizedAppId, normalizedVersionId, signal)
      if (version.status === PUBLISHED_VERSION_STATUS) return version
      if (version.status === REJECTED_VERSION_STATUS) {
        throw apiError('feishu_console_version_rejected', false)
      }
      if (version.status === WAIT_PUBLISH_VERSION_STATUS && !releaseRequested) {
        releaseRequested = true
        try {
          await this.#request(
            'release_version',
            `/developers/v1/publish/release/${encodeURIComponent(normalizedAppId)}/${encodeURIComponent(normalizedVersionId)}`,
            {
              body: {},
              mutation: true,
              signal
            }
          )
        } catch (error) {
          if (!isReconcilableReleaseFailure(error)) throw error
          releaseFailure = error
        }
      }
      await this.#delay(this.#publishPollIntervalMs, signal)
    }
    if (releaseFailure) throw releaseFailure
    throw apiError('feishu_console_publish_timeout', true)
  }

  async verifyMemberBot(input: {
    appId: string
    versionId: string
    configuration: FeishuMemberBotVerificationRequirements
    verifiedConfiguration?: FeishuVerifiedConfigurationState
    signal?: AbortSignal
  }): Promise<void> {
    const reusableConfiguration = reusableVerifiedConfiguration(
      input.verifiedConfiguration,
      input.appId,
      input.configuration
    )
    const [manifest, botEnabled, version, onlineConfiguration] = await Promise.all([
      input.configuration.avatarUrl
        ? this.readManifest(input.appId, input.signal)
        : Promise.resolve({} as Record<string, unknown>),
      this.readBotEnabled(input.appId, input.signal),
      this.readVersion(input.appId, input.versionId, input.signal),
      reusableConfiguration
        ? Promise.resolve(reusableConfiguration)
        : Promise.all([
          this.readScopeCatalog(input.appId, input.signal),
          this.readEventState(input.appId, input.signal),
          this.readCallbackState(input.appId, input.signal)
        ]).then(([scopes, event, callback]) => verifiedConfigurationState(
          input.appId,
          input.configuration,
          scopes,
          event,
          callback,
          this.#now()
        ))
    ])
    if (version.status !== PUBLISHED_VERSION_STATUS) {
      throw apiError('feishu_console_version_not_published', true)
    }
    if (
      input.configuration.avatarUrl
      && manifest.avatar_url !== input.configuration.avatarUrl
    ) throw apiError('feishu_console_avatar_verification_failed', true)
    if (!botEnabled) throw apiError('feishu_console_bot_verification_failed', true)
    if (!includesEvery(
      onlineConfiguration.enabledTenantScopes,
      input.configuration.tenantScopes
    )) {
      throw apiError('feishu_console_scope_verification_failed', true)
    }
    if (
      onlineConfiguration.eventMode !== FEISHU_LONG_CONNECTION_MODE
      || !includesEvery(onlineConfiguration.appEvents, input.configuration.tenantEvents)
    ) throw apiError('feishu_console_event_verification_failed', true)
    if (
      onlineConfiguration.callbackMode !== FEISHU_LONG_CONNECTION_MODE
      || !onlineConfiguration.callbacks.includes(FEISHU_PROJECT_SELECTION_CALLBACK)
    ) {
      throw apiError('feishu_console_callback_verification_failed', true)
    }
  }

  async readManifest(appId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const id = requireResourceId(appId, 'feishu_console_app_id_invalid')
    const data = await this.#request(
      'read_manifest',
      `/developers/v1/manifest/get/${encodeURIComponent(id)}`,
      {
        body: {
          schemaVersion: MANIFEST_SCHEMA_VERSION,
          HTTPHead: {}
        },
        signal
      }
    )
    const record = requireRecord(data, 'feishu_console_manifest_response_invalid')
    const serialized = normalizedString(record.appManifest)
    if (!serialized) return {}
    try {
      return requireRecord(
        JSON.parse(serialized),
        'feishu_console_manifest_response_invalid'
      )
    } catch (error) {
      if (error instanceof FeishuOpenPlatformApiError) throw error
      throw apiError('feishu_console_manifest_response_invalid', false)
    }
  }

  async readVersion(
    appId: string,
    versionId: string,
    signal?: AbortSignal
  ): Promise<FeishuPublishedVersion> {
    const normalizedAppId = requireResourceId(appId, 'feishu_console_app_id_invalid')
    const normalizedVersionId = requireResourceId(
      versionId,
      'feishu_console_version_id_invalid'
    )
    const data = await this.#request(
      'read_version',
      `/developers/v1/app_version/detail/${encodeURIComponent(normalizedAppId)}/${encodeURIComponent(normalizedVersionId)}`,
      {
        body: {},
        signal
      }
    )
    const record = requireRecord(data, 'feishu_console_version_detail_invalid')
    const status = numericValue(record.status ?? record.versionStatus)
    if (status === null) throw apiError('feishu_console_version_detail_invalid', false)
    return { versionId: normalizedVersionId, status }
  }

  async #listVersions(
    appId: string,
    signal?: AbortSignal
  ): Promise<Array<{ versionId: string; appVersion: string | null }>> {
    const normalizedAppId = requireResourceId(appId, 'feishu_console_app_id_invalid')
    const data = await this.#request(
      'list_versions',
      `/developers/v1/app_version/list/${encodeURIComponent(normalizedAppId)}`,
      { body: {}, signal }
    )
    const list = requireRecord(data, 'feishu_console_version_response_invalid')
    const versions = Array.isArray(list.versions) ? list.versions : []
    return versions.flatMap((candidate) => {
      const version = optionalRecord(candidate)
      const versionId = firstString(version, ['versionId', 'version_id', 'id'])
      if (!versionId || !isResourceId(versionId)) return []
      return [{
        versionId,
        appVersion: firstString(version, ['appVersion', 'app_version', 'version']) ?? null
      }]
    })
  }

  async #request(operation: string, path: string, options: RequestOptions): Promise<unknown> {
    if (options.signal?.aborted) throw apiError('feishu_provisioning_cancelled', false)
    const url = new URL(path, this.#session.apiOrigin)
    if (
      url.origin !== this.#session.apiOrigin
      || !url.pathname.startsWith('/developers/')
    ) throw apiError('feishu_console_api_url_rejected', false)
    const headers = new Headers({
      accept: 'application/json',
      'x-csrf-token': this.#session.csrfToken,
      'X-Timezone-Offset': String(new Date().getTimezoneOffset())
    })
    if (options.requestFromDevelopPanel) {
      headers.set('X-AppPlatform-RequestFrom', 'develop_panel')
    }
    let body: BodyInit | undefined
    if (options.formData) {
      body = options.formData
    } else if (options.body) {
      headers.set('content-type', 'application/json')
      body = JSON.stringify(options.body)
    }

    let response: Response
    try {
      response = await this.#session.fetch(url.toString(), {
        method: 'POST',
        headers,
        body,
        credentials: 'include',
        redirect: 'manual',
        signal: options.signal
      })
    } catch {
      if (options.signal?.aborted) throw apiError('feishu_provisioning_cancelled', false)
      throw apiError(`feishu_console_${operation}_transport_failed`, Boolean(options.mutation))
    }
    if (response.status === 401) {
      throw apiError('feishu_developer_session_expired', false)
    }
    if (response.status === 403) {
      throw apiError('feishu_connection_error', false)
    }
    if (isRedirectStatus(response.status)) {
      const location = response.headers.get('location')
      const target = redirectTarget(location, url)
      if (!target || isFeishuAccountLoginUrl(target)) {
        throw apiError('feishu_developer_session_expired', false)
      }
      if (
        target.origin === this.#session.apiOrigin
        && target.pathname === '/app'
        && operation !== 'upload_avatar'
        && operation !== 'create_app'
        && operation !== 'create_app_from_template'
      ) throw apiError('feishu_console_remote_app_unavailable', false)
      throw apiError(
        `feishu_console_${operation}_redirect_${response.status}`,
        Boolean(options.mutation)
      )
    }
    if (!response.ok) {
      throw apiError(
        `feishu_console_${operation}_http_${response.status}`,
        Boolean(options.mutation && isAmbiguousMutationStatus(response.status)),
        { httpStatus: response.status }
      )
    }

    let envelope: ApiEnvelope
    try {
      envelope = await response.json() as ApiEnvelope
    } catch {
      throw apiError(
        `feishu_console_${operation}_response_invalid`,
        Boolean(options.mutation)
      )
    }
    if (!envelope || (envelope.code !== 0 && envelope.code !== '0')) {
      const code = normalizedApiCode(envelope?.code)
      throw apiError(
        `feishu_console_${operation}_rejected_${code}`,
        Boolean(options.mutation && code === 'unknown'),
        { remoteCode: code }
      )
    }
    return envelope.data
  }
}

type ObservedRead<T> = {
  status: 'fulfilled'
  value: T
  durationMs: number
} | {
  status: 'rejected'
  reason: unknown
  durationMs: number
}

type RejectedObservedRead = Extract<ObservedRead<unknown>, { status: 'rejected' }>

function firstRejectedRead(
  reads: readonly ObservedRead<unknown>[]
): RejectedObservedRead | null {
  return reads.find((read): read is RejectedObservedRead => read.status === 'rejected') ?? null
}

function fulfilledRead<T>(read: ObservedRead<T>): T {
  if (read.status === 'fulfilled') return read.value
  throw read.reason
}

export function desiredMemberBotManifest(
  current: Record<string, unknown>,
  configuration: FeishuMemberBotConsoleConfiguration
): Record<string, unknown> {
  const manifest = mergeMemberBotManifestBase(current, configuration)
  const scopes = recordAt(manifest, 'scopes')
  const events = recordAt(manifest, 'events')
  const eventItems = recordAt(events, 'items')
  const callbacks = recordAt(manifest, 'callbacks')
  return {
    ...manifest,
    scopes: {
      ...scopes,
      tenant: unionStrings(scopes.tenant, configuration.tenantScopes),
      user: stringArray(scopes.user)
    },
    events: {
      ...events,
      items: {
        ...eventItems,
        tenant: unionStrings(eventItems.tenant, configuration.tenantEvents),
        user: stringArray(eventItems.user)
      },
      subscription_type: 'websocket'
    },
    callbacks: {
      ...callbacks,
      items: unionStrings(callbacks.items, [FEISHU_PROJECT_SELECTION_CALLBACK]),
      subscription_type: 'websocket'
    }
  }
}

function scopesReady(
  scopes: readonly FeishuOpenPlatformScope[],
  configuration: FeishuMemberBotVerificationRequirements
): boolean {
  try {
    return resolveRequiredAppScopes(scopes, configuration.tenantScopes)
      .every((scope) => scope.appStatus === FEISHU_SCOPE_STATUS_ENABLED)
  } catch {
    return false
  }
}

function eventStateReady(
  state: FeishuOpenPlatformEventState,
  configuration: FeishuMemberBotVerificationRequirements
): boolean {
  return state.eventMode === FEISHU_LONG_CONNECTION_MODE
    && includesEvery(state.appEvents, configuration.tenantEvents)
}

function callbackStateReady(state: FeishuOpenPlatformCallbackState): boolean {
  return state.callbackMode === FEISHU_LONG_CONNECTION_MODE
    && state.callbacks.includes(FEISHU_PROJECT_SELECTION_CALLBACK)
}

function verifiedConfigurationState(
  appId: string,
  configuration: FeishuMemberBotVerificationRequirements,
  scopes: readonly FeishuOpenPlatformScope[],
  event: FeishuOpenPlatformEventState,
  callback: FeishuOpenPlatformCallbackState,
  observedAtMonotonicMs: number
): FeishuVerifiedConfigurationState {
  const requiredScopes = resolveRequiredAppScopes(scopes, configuration.tenantScopes)
  if (requiredScopes.some((scope) => scope.appStatus !== FEISHU_SCOPE_STATUS_ENABLED)) {
    throw apiError('feishu_console_scope_verification_failed', true)
  }
  if (!eventStateReady(event, configuration)) {
    throw apiError('feishu_console_event_verification_failed', true)
  }
  if (!callbackStateReady(callback)) {
    throw apiError('feishu_console_callback_verification_failed', true)
  }
  return {
    appId,
    requirementsDigest: configurationRequirementsDigest(configuration),
    observedAtMonotonicMs,
    enabledTenantScopes: sortedUniqueStrings(requiredScopes.map((scope) => scope.name)),
    eventMode: FEISHU_LONG_CONNECTION_MODE,
    appEvents: sortedUniqueStrings(event.appEvents),
    callbackMode: FEISHU_LONG_CONNECTION_MODE,
    callbacks: sortedUniqueStrings(callback.callbacks)
  }
}

function reusableVerifiedConfiguration(
  state: FeishuVerifiedConfigurationState | undefined,
  appId: string,
  configuration: FeishuMemberBotVerificationRequirements
): FeishuVerifiedConfigurationState | null {
  if (!state) return null
  const normalizedAppId = requireResourceId(appId, 'feishu_console_app_id_invalid')
  return state.appId === normalizedAppId
    && state.requirementsDigest === configurationRequirementsDigest(configuration)
    ? state
    : null
}

function configurationRequirementsDigest(
  configuration: FeishuMemberBotVerificationRequirements
): `sha256:${string}` {
  const requirements = JSON.stringify({
    tenantScopes: sortedUniqueStrings(configuration.tenantScopes),
    tenantEvents: sortedUniqueStrings(configuration.tenantEvents),
    callbacks: [FEISHU_PROJECT_SELECTION_CALLBACK],
    connectionMode: FEISHU_LONG_CONNECTION_MODE
  })
  return `sha256:${createHash('sha256').update(requirements).digest('hex')}`
}

function sortedUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))
}

function configurationMissingDimensions(input: {
  scopeReady: boolean
  eventReady: boolean
  callbackReady: boolean
}): Array<'scope' | 'event' | 'callback'> {
  return [
    ...(input.scopeReady ? [] : ['scope' as const]),
    ...(input.eventReady ? [] : ['event' as const]),
    ...(input.callbackReady ? [] : ['callback' as const])
  ]
}

function configurationFailureCode(
  missingDimensions: readonly ('scope' | 'event' | 'callback')[]
): string {
  if (missingDimensions.includes('scope')) return 'feishu_console_scope_verification_failed'
  if (missingDimensions.includes('event')) return 'feishu_console_event_verification_failed'
  return 'feishu_console_callback_verification_failed'
}

function failureCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return error instanceof Error ? error.message : 'unknown'
}

function mergeMemberBotManifestBase(
  current: Record<string, unknown>,
  configuration: FeishuMemberBotConsoleConfiguration
): Record<string, unknown> {
  const bot = recordAt(current, 'bot')
  const i18ns = recordAt(current, 'i18ns')
  return {
    ...current,
    manifest_schema_version: MANIFEST_SCHEMA_VERSION,
    avatar_url: configuration.avatarUrl,
    primary_language: 'zh_cn',
    i18ns: {
      ...i18ns,
      zh_cn: {
        name: configuration.appName,
        description: configuration.appDescription
      }
    },
    bot: {
      ...bot,
      enable: true,
      menu_enable: false
    }
  }
}

function buildMemberBotTemplateCreatePayload(input: {
  appName: string
  appDescription: string
  avatarUrl: string
  correlationId: string
}): Record<string, unknown> {
  return {
    appManifestTemplateID: FEISHU_MEMBER_BOT_TEMPLATE_ID,
    createAppUserCustomField: {
      i18n: {
        zh_cn: {
          name: input.appName,
          description: input.appDescription
        }
      },
      avatar: input.avatarUrl,
      primaryLang: 'zh_cn'
    },
    cid: input.correlationId,
    HTTPHead: {}
  }
}

function createdMemberBotApp(
  data: unknown,
  fallbackAvatarUrl: string,
  creationMode: FeishuMemberBotAppCreationMode
): FeishuCreatedMemberBotApp {
  const record = requireRecord(data, 'feishu_console_create_response_invalid')
  const candidates = [
    record,
    optionalRecord(record.app),
    optionalRecord(record.application),
    optionalRecord(record.appInfo)
  ]
  const appId = candidates
    .map((candidate) => firstString(candidate, [
      'ClientID',
      'clientID',
      'clientId',
      'client_id',
      'appID',
      'appId',
      'app_id'
    ]))
    .find(Boolean)
  if (!appId || !isResourceId(appId)) {
    throw apiError('feishu_console_create_response_invalid', true)
  }
  const avatarUrl = candidates
    .map((candidate) => firstString(candidate, ['Avatar', 'avatar']))
    .find(Boolean) ?? fallbackAvatarUrl
  return { appId, avatarUrl, creationMode }
}

function isDefiniteTemplateCreationRejection(error: unknown): boolean {
  if (!(error instanceof FeishuOpenPlatformApiError) || error.outcomeUnknown) return false
  if (error.httpStatus !== null) {
    return error.httpStatus >= 400
      && error.httpStatus < 500
      && ![401, 403, 408, 409, 425, 429].includes(error.httpStatus)
  }
  if (error.remoteCode !== null) {
    return ![
      '10003',
      '99991663',
      '99991664',
      '99991668',
      '99991671',
      'unknown'
    ].includes(error.remoteCode)
  }
  return false
}

function requireRecord(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw apiError(code, false)
  return value as Record<string, unknown>
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function recordAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const nested = value[key]
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : {}
}

function normalizedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function firstString(
  value: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const result = normalizedString(value[key])
    if (result) return result
  }
  return null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizedString).filter((item): item is string => Boolean(item))
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function eventIdentifiers(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(eventIdentifiers)
  const direct = normalizedString(value)
  if (direct) return [direct]
  const record = optionalRecord(value)
  if (Object.keys(record).length === 0) return []
  const identifier = firstString(record, ['id', 'eventId', 'event_id'])
  return uniqueStrings([
    ...(identifier ? [identifier] : []),
    ...eventIdentifiers(record.items)
  ])
}

function unionNumericArrays(...values: unknown[]): number[] {
  const numbers = values.flatMap((value) => (
    Array.isArray(value)
      ? value.map(numericValue).filter((item): item is number => item !== null)
      : []
  ))
  return [...new Set(numbers)]
}

function resolveRequiredAppScopes(
  catalog: readonly FeishuOpenPlatformScope[],
  requiredNames: readonly string[]
): FeishuOpenPlatformScope[] {
  const scopes = requiredNames.map((name) => catalog
    .filter((scope) => scope.name === name && scope.supportsAppIdentity)
    .sort((left, right) => scopeStatusPriority(right.appStatus)
      - scopeStatusPriority(left.appStatus))[0])
  if (scopes.some((scope) => !scope)) {
    throw apiError('feishu_console_scope_catalog_missing', false)
  }
  return scopes as FeishuOpenPlatformScope[]
}

function scopeStatusPriority(status: number | null): number {
  if (status === FEISHU_SCOPE_STATUS_ENABLED) return 3
  if (status !== null && status !== FEISHU_SCOPE_STATUS_DISABLED) return 2
  if (status === FEISHU_SCOPE_STATUS_DISABLED) return 1
  return 0
}

function unionStrings(existing: unknown, required: readonly string[]): string[] {
  return [...new Set([...stringArray(existing), ...required])]
}

function includesEvery(value: unknown, expected: readonly string[]): boolean {
  const actual = new Set(stringArray(value))
  return expected.every((item) => actual.has(item))
}

function requireLength(value: string, minimum: number, maximum: number, code: string): void {
  const length = [...value.trim()].length
  if (length < minimum || length > maximum) throw apiError(code, false)
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

function isResourceId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function isImageDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 4096
}

function requireAppVersion(value: string): string {
  const normalized = value.trim()
  if (!isAppVersion(normalized)) throw apiError('feishu_console_app_version_invalid', false)
  return normalized
}

function isAppVersion(value: string): boolean {
  return /^(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/.test(value)
}

function compareAppVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function structuredValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structuredValueEqual(value, right[index]))
  }
  if (
    !left || typeof left !== 'object'
    || !right || typeof right !== 'object'
  ) return false
  const leftRecord = optionalRecord(left)
  const rightRecord = optionalRecord(right)
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index]
      && structuredValueEqual(leftRecord[key], rightRecord[key])
    ))
}

function requireResourceId(value: string, code: string): string {
  const normalized = value.trim()
  if (!isResourceId(normalized)) throw apiError(code, false)
  return normalized
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return null
}

function normalizedApiCode(value: unknown): string {
  const normalized = typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)
    : ''
  return normalized || 'unknown'
}

function isAmbiguousMutationStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400
}

function redirectTarget(location: string | null, requestUrl: URL): URL | null {
  if (!location) return null
  try {
    return new URL(location, requestUrl)
  } catch {
    return null
  }
}

function isFeishuAccountLoginUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  return host === 'accounts.feishu.cn' || host === 'accounts.larksuite.com'
}

function isReconcilableReleaseFailure(error: unknown): error is FeishuOpenPlatformApiError {
  return error instanceof FeishuOpenPlatformApiError
    && error.code !== 'feishu_provisioning_cancelled'
    && error.code !== 'feishu_developer_session_expired'
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(apiError('feishu_provisioning_cancelled', false))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    timer.unref?.()
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(apiError('feishu_provisioning_cancelled', false))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function apiError(
  code: string,
  outcomeUnknown: boolean,
  details: { httpStatus?: number; remoteCode?: string } = {}
): FeishuOpenPlatformApiError {
  return new FeishuOpenPlatformApiError(code, outcomeUnknown, details)
}
