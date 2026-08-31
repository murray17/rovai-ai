import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'

export type ProvisioningTimingPhase =
  | 'identity_verify_ms'
  | 'session_open_ms'
  | 'avatar_upload_ms'
  | 'template_create_ms'
  | 'activation_publish_ms'
  | 'scope_config_ms'
  | 'event_convergence_ms'
  | 'callback_convergence_ms'
  | 'configuration_convergence_ms'
  | 'manifest_reconcile_ms'
  | 'final_publish_ms'
  | 'final_verify_ms'
  | 'owner_identity_ms'
  | 'websocket_handshake_ms'
  | 'total_ms'

export type ProvisioningTimingOutcome = 'ok' | 'failed'

export type ProvisioningMutationTimingMetadata = {
  scopesChanged: boolean
  eventsChanged: boolean
  callbacksChanged: boolean
  manifestChanged: boolean
}

type ProvisioningTimingMetadata = {
  publicationIntentId?: string
  agentId: string
  appIdDigest?: `sha256:${string}`
  creationMode?: 'template' | 'self_build_fallback'
  recovering: boolean
} & Partial<ProvisioningMutationTimingMetadata>

type ProvisioningTimingDetails = {
  failureCode?: string
  missingDimensions?: readonly ('scope' | 'event' | 'callback')[]
  skipped?: boolean
}

type ProvisioningTimingRecorderOptions = {
  now?: () => number
  write?: (line: string) => void
}

export class ProvisioningTimingRecorder {
  readonly #startedAt: number
  readonly #now: () => number
  readonly #write: (line: string) => void
  #metadata: ProvisioningTimingMetadata
  #totalRecorded = false

  constructor(
    metadata: {
      publicationIntentId?: string
      agentId: string
      appId?: string
      creationMode?: 'template' | 'self_build_fallback'
      recovering: boolean
    },
    options: ProvisioningTimingRecorderOptions = {}
  ) {
    this.#now = options.now ?? (() => performance.now())
    this.#write = options.write ?? ((line) => console.info(line))
    this.#startedAt = this.#now()
    this.#metadata = {
      ...(metadata.publicationIntentId
        ? { publicationIntentId: metadata.publicationIntentId }
        : {}),
      agentId: metadata.agentId,
      ...(metadata.appId ? { appIdDigest: appIdDigest(metadata.appId) } : {}),
      ...(metadata.creationMode ? { creationMode: metadata.creationMode } : {}),
      recovering: metadata.recovering
    }
  }

  setAppId(appId: string): void {
    this.#metadata = { ...this.#metadata, appIdDigest: appIdDigest(appId) }
  }

  setCreationMode(creationMode: 'template' | 'self_build_fallback'): void {
    this.#metadata = { ...this.#metadata, creationMode }
  }

  setMutations(metadata: ProvisioningMutationTimingMetadata): void {
    this.#metadata = { ...this.#metadata, ...metadata }
  }

  now(): number {
    return this.#now()
  }

  async measure<T>(
    phase: ProvisioningTimingPhase,
    action: () => Promise<T>,
    details: Omit<ProvisioningTimingDetails, 'failureCode'> = {}
  ): Promise<T> {
    const startedAt = this.#now()
    try {
      const result = await action()
      this.record(phase, this.#now() - startedAt, 'ok', details)
      return result
    } catch (error) {
      this.record(phase, this.#now() - startedAt, 'failed', {
        ...details,
        failureCode: safeFailureCode(error)
      })
      throw error
    }
  }

  record(
    phase: ProvisioningTimingPhase,
    durationMs: number,
    outcome: ProvisioningTimingOutcome,
    details: ProvisioningTimingDetails = {}
  ): void {
    const sample = {
      event: 'feishu.provision.timing',
      phase,
      durationMs: roundedDuration(durationMs),
      outcome,
      ...this.#metadata,
      ...(details.failureCode
        ? { failureCode: safeFailureCode(details.failureCode) }
        : {}),
      ...(details.missingDimensions && details.missingDimensions.length > 0
        ? { missingDimensions: [...details.missingDimensions] }
        : {}),
      ...(details.skipped ? { skipped: true } : {})
    }
    this.#write(`[feishu.provision.timing] ${JSON.stringify(sample)}`)
  }

  recordSkipped(phase: ProvisioningTimingPhase): void {
    this.record(phase, 0, 'ok', { skipped: true })
  }

  recordTotal(outcome: ProvisioningTimingOutcome, error?: unknown): void {
    if (this.#totalRecorded) return
    this.#totalRecorded = true
    this.record('total_ms', this.#now() - this.#startedAt, outcome, {
      ...(outcome === 'failed' ? { failureCode: safeFailureCode(error) } : {})
    })
  }
}

function appIdDigest(appId: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(appId).digest('hex')}`
}

function roundedDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.round(value * 1_000) / 1_000
}

function safeFailureCode(error: unknown): string {
  const candidate = typeof error === 'string'
    ? error
    : error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : error instanceof Error
        ? error.message
        : null
  if (
    typeof candidate === 'string'
    && /^(?:feishu|desktop|published|channel)_[A-Za-z0-9_.-]{1,88}$/.test(candidate)
  ) return candidate
  return 'unknown'
}
