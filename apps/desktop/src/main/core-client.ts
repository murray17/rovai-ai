import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { accessSync, constants, realpathSync } from 'node:fs'
import { join, posix, resolve, win32 } from 'node:path'
import { app } from 'electron'
import type {
  AuthorityState,
  CoreEvent,
  CoreMethod,
  CoreSubsystemSnapshot,
  RovaiRequestFailure,
  RovaiRequestFailureKind,
  StructuredError,
  SupervisorSnapshot,
  StartupPhase
} from '@contracts'

type CoreInternalMethod =
  | 'core.shutdown'
  | 'automations.schedulerControl'
  | 'automations.schedulerTick'

export type AutomationSchedulerControl = {
  epoch: number
  recoveryBoundary: string
  paused: boolean
}

type ChildToken = { readonly id: string }

type PendingRequest = {
  generation: number
  childToken: ChildToken
  requestId: number
  resolve(value: unknown): void
  reject(error: RovaiRequestError): void
  timer: NodeJS.Timeout
  method: CoreMethod | CoreInternalMethod
  startedAt: number
  traceId: string | null
}

type CoreWireResponse = {
  id?: number
  result?: unknown
  error?: {
    kind?: 'domain_rejection' | 'infrastructure_failure'
    code?: string
    message?: string
    retryable?: boolean
    details?: unknown
  }
  method?: string
  params?: unknown
}

type CoreStartupWireFrame = {
  kind: 'core_startup'
  schemaVersion: 1
  status: 'phase' | 'ready' | 'blocked' | 'failed'
  phase?: StartupPhase
  authorityState?: AuthorityState
  error?: StructuredError
  progress?: unknown
  subsystems?: CoreSubsystemSnapshot[]
}

type ActiveChild = {
  process: ChildProcessWithoutNullStreams
  generation: number
  token: ChildToken
  ready: boolean
  deterministicRefusal: boolean
  startupRetryDelayMs: number | null
  restartForAutomationControl: boolean
}

const STARTUP_RETRY_DELAYS_MS = [250, 750, 1500] as const

export function coreStartupRetryDelay(
  frame: Pick<CoreStartupWireFrame, 'status' | 'authorityState' | 'error'>,
  attempt: number
): number | null {
  if (frame.status !== 'blocked' && frame.status !== 'failed') return null
  const authority = frame.authorityState
  const reason = authority?.kind === 'blocked' ? authority.reason : null
  const reasonKind = reason && typeof reason === 'object' && 'kind' in reason ? reason.kind : null
  if (authority?.kind === 'owned_by_active_core' || (reasonKind && reasonKind !== 'busy')
    || frame.error?.code === 'authority_contract_changed') return null
  const busy = reasonKind === 'busy'
  // Native error classification belongs to Core, not string matching messages.
  const details = frame.error?.details
  const stage = details && typeof details === 'object' && 'stage' in details ? details.stage : null
  const transient = frame.error?.retryable === true && frame.error.code.startsWith('authority_')
    && (stage === 'database_admission' || stage === 'database_open' || stage === 'database_migration')
  return busy || transient ? STARTUP_RETRY_DELAYS_MS[attempt] ?? null : null
}

export class RovaiRequestError extends Error implements RovaiRequestFailure {
  readonly kind: RovaiRequestFailureKind
  readonly code: string
  readonly retryable: boolean
  readonly generation: number
  readonly details: unknown

  constructor(failure: RovaiRequestFailure) {
    super(failure.message)
    this.name = 'RovaiRequestError'
    this.kind = failure.kind
    this.code = failure.code
    this.retryable = failure.retryable
    this.generation = failure.generation
    this.details = failure.details
  }

  toFailure(): RovaiRequestFailure {
    return {
      kind: this.kind,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      generation: this.generation,
      details: this.details
    }
  }
}

export type PlannedShutdownReport = {
  protocolVersion: 3
  status: 'completed'
  deadlineExpired: boolean
  activeExecutionsObserved: number
  stopRequestsIssued: number
  terminalExecutionsSettled: number
  cancelledAgentRunsSettled: number
  unsettledEffectAgentRuns: number
  controlledShutdownCyclePersisted: boolean
  unresolvedExecutions: number
}

export type CoreShutdownResult = {
  report: PlannedShutdownReport | null
  forcedSignal: 'SIGTERM' | 'SIGKILL' | null
}

export function coreLaunchArguments(
  dataDirectory: string,
  runtimeCampFilesRoot: string,
  skillLibraryRoot: string | null,
  removedSkillProjectRoots: readonly string[],
  mcpConfigPath: string | null = null,
  automationSchedulerControl: AutomationSchedulerControl | null = null
): string[] {
  const args = [
    '--data-dir', dataDirectory,
    '--runtime-camp-files-root', runtimeCampFilesRoot
  ]
  if (skillLibraryRoot) args.push('--skill-library-root', skillLibraryRoot)
  else args.push('--use-default-skill-library')
  if (mcpConfigPath) args.push('--mcp-config-path', mcpConfigPath)
  if (automationSchedulerControl) {
    args.push(
      '--automation-scheduler-epoch', String(automationSchedulerControl.epoch),
      '--automation-recovery-boundary', automationSchedulerControl.recoveryBoundary
    )
    if (automationSchedulerControl.paused) args.push('--automation-scheduler-paused')
  }
  for (const executionRoot of removedSkillProjectRoots) {
    args.push('--removed-skill-project-root', executionRoot)
  }
  return args
}

function canonicalPath(path: string, platform: NodeJS.Platform = process.platform): string {
  const pathApi = platform === 'win32' ? win32 : posix
  if (platform !== process.platform) return pathApi.resolve(path)
  try {
    return realpathSync.native(pathApi.resolve(path))
  } catch {
    return pathApi.resolve(path)
  }
}

export function runtimeCampFilesRoot(
  dataDirectory: string,
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'win32') return win32.join(dataDirectory, 'runtime-files')
  const canonicalUserData = canonicalPath(dataDirectory, platform)
  const instanceKey = `v1-${createHash('sha256')
    .update('rovai-runtime-camp-files-instance-v1\0', 'utf8')
    .update(canonicalUserData, 'utf8')
    .digest('hex')}`
  return posix.join(
    canonicalPath(homeDirectory, platform),
    '.rovai',
    'instances',
    instanceKey,
    'runtime-files'
  )
}

export function coreProcessHomeDirectory(
  electronHomeDirectory: string,
  environmentHomeDirectory: string | undefined = process.env.HOME,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'win32') return electronHomeDirectory
  return environmentHomeDirectory || electronHomeDirectory
}

export function desktopSkillLibraryRoot(
  dataDirectory: string,
  hasExplicitUserDataDirectory: boolean,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (!hasExplicitUserDataDirectory && platform !== 'win32') return null
  return platform === 'win32'
    ? win32.join(dataDirectory, 'managed-skill-library')
    : join(dataDirectory, 'managed-skill-library')
}

type CoreStartOptions = {
  removedSkillProjectRoots?: string[]
  skillLibraryRoot?: string
  mcpConfigPath?: string
}

const PLANNED_SHUTDOWN_DEADLINE_MS = 10_000
const SHUTDOWN_SIGTERM_GRACE_MS = 3_000
const SHUTDOWN_SIGKILL_GRACE_MS = 2_000

function capabilitiesFor(
  runtimeMode: SupervisorSnapshot['runtimeMode'],
  fullCoreState: SupervisorSnapshot['fullCoreState']
): SupervisorSnapshot['capabilities'] {
  const fullCoreReady = runtimeMode === 'full_core' && fullCoreState === 'ready'
  return {
    authoritativeWorkspace: fullCoreReady,
    coreRequests: fullCoreReady,
    localPreferences: true,
    supervisorStatus: true,
    diagnosticsExport: true,
    fullCoreRetry: fullCoreState === 'idle'
      || fullCoreState === 'blocked'
      || fullCoreState === 'crashed'
  }
}

function initialSupervisorSnapshot(): SupervisorSnapshot {
  return {
    schemaVersion: 1,
    revision: 0,
    generation: 0,
    runtimeMode: 'bootstrap_only',
    fullCoreState: 'idle',
    authorityState: { kind: 'unknown' },
    startupPhase: null,
    restartAttempt: 0,
    capabilities: capabilitiesFor('bootstrap_only', 'idle'),
    localDegradations: [],
    coreSubsystems: [],
    lastError: null,
    migrationProgress: null
  }
}

function cloneSupervisorSnapshot(snapshot: SupervisorSnapshot): SupervisorSnapshot {
  return {
    ...snapshot,
    authorityState: { ...snapshot.authorityState },
    capabilities: { ...snapshot.capabilities },
    localDegradations: snapshot.localDegradations.map((failure) => ({ ...failure })),
    coreSubsystems: structuredClone(snapshot.coreSubsystems),
    lastError: snapshot.lastError ? { ...snapshot.lastError } : null
  }
}

function structuredError(
  code: string,
  message: string,
  retryable: boolean,
  details: unknown
): StructuredError {
  return { code, message, retryable, details }
}

function structuredFailure(
  kind: RovaiRequestFailureKind,
  code: string,
  message: string,
  retryable: boolean,
  generation: number,
  details: unknown
): RovaiRequestFailure {
  return { kind, code, message, retryable, generation, details }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class CoreClient {
  #child: ActiveChild | null = null
  #nextId = 1
  #pending = new Map<number, PendingRequest>()
  #eventListeners = new Set<(event: CoreEvent) => void>()
  #snapshotListeners = new Set<(snapshot: SupervisorSnapshot) => void>()
  #snapshot: SupervisorSnapshot = initialSupervisorSnapshot()
  #generation = 0
  #restartAttempts = 0
  #startupRetryAttempts = 0
  #requireExistingAuthority = false
  #restartTimer: NodeJS.Timeout | null = null
  #stableTimer: NodeJS.Timeout | null = null
  #queuedRetryGeneration: number | null = null
  #stopping = false
  #shutdownPromise: Promise<CoreShutdownResult> | null = null
  #removedSkillProjectRoots: string[] = []
  #skillLibraryRoot: string | null = null
  #mcpConfigPath: string | null = null
  #automationSchedulerControl: AutomationSchedulerControl
  #automationTickPending = false
  readonly #dataDirectory: string | null
  readonly #runtimeCampFilesRoot: string | null
  #startupBlock: { error: StructuredError; phase: StartupPhase } | null = null

  constructor(
    dataDirectory: string | null = app.getPath('userData'),
    runtimeFilesRoot?: string,
    automationStartedAt = new Date().toISOString()
  ) {
    this.#dataDirectory = dataDirectory
    this.#runtimeCampFilesRoot = dataDirectory === null ? null : runtimeFilesRoot ?? runtimeCampFilesRoot(
      dataDirectory,
      coreProcessHomeDirectory(app.getPath('home'))
    )
    this.#automationSchedulerControl = {
      epoch: 0,
      recoveryBoundary: automationStartedAt,
      paused: false
    }
  }

  blockStartup(error: StructuredError, phase: StartupPhase): void {
    if (this.#child) throw new Error('Cannot replace storage admission while Core is running')
    this.#startupBlock = { error, phase }
    this.#updateSnapshot({
      runtimeMode: 'bootstrap_only',
      fullCoreState: 'blocked',
      authorityState: { kind: 'unknown' },
      startupPhase: phase,
      lastError: error,
      migrationProgress: null
    })
  }

  setRemovedSkillProjectRoots(executionRoots: string[]): void {
    this.#removedSkillProjectRoots = [...new Set(executionRoots)]
  }

  setLocalDegradations(degradations: StructuredError[]): void {
    this.#updateSnapshot({ localDegradations: degradations.map((value) => ({ ...value })) })
  }

  getSnapshot(): SupervisorSnapshot {
    return cloneSupervisorSnapshot(this.#snapshot)
  }

  onSnapshot(listener: (snapshot: SupervisorSnapshot) => void): () => void {
    this.#snapshotListeners.add(listener)
    return () => this.#snapshotListeners.delete(listener)
  }

  retryFullCore(): SupervisorSnapshot {
    if (this.#stopping) return this.getSnapshot()
    if (this.#child) {
      if (this.#child.deterministicRefusal) {
        this.#queuedRetryGeneration = this.#child.generation
      }
      return this.getSnapshot()
    }
    this.#restartAttempts = 0
    this.#startupRetryAttempts = 0
    this.start()
    return this.getSnapshot()
  }

  start(options?: CoreStartOptions): void {
    if (this.#startupBlock || this.#dataDirectory === null || this.#runtimeCampFilesRoot === null) {
      this.blockStartup(this.#startupBlock?.error ?? {
        code: 'core_data_directory_not_admitted',
        message: 'The Core data directory has not been admitted.',
        retryable: true,
        details: {}
      }, this.#startupBlock?.phase ?? 'preparing_windows_data_root')
      return
    }
    if (options?.removedSkillProjectRoots) {
      this.setRemovedSkillProjectRoots(options.removedSkillProjectRoots)
    }
    if (options?.skillLibraryRoot) {
      this.#skillLibraryRoot = options.skillLibraryRoot
    }
    if (options?.mcpConfigPath) this.#mcpConfigPath = options.mcpConfigPath
    if (this.#child) return
    this.#stopping = false
    this.#queuedRetryGeneration = null
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer)
      this.#restartTimer = null
    }

    const generation = ++this.#generation
    const token: ChildToken = { id: `${generation}:${randomUUID()}` }
    let binary: string
    try {
      binary = resolveCoreBinary()
    } catch (error) {
      const failure = structuredFailure(
        'infrastructure_failure',
        'core_binary_unavailable',
        errorMessage(error),
        false,
        generation,
        {}
      )
      this.#updateSnapshot({
        generation,
        runtimeMode: 'bootstrap_only',
        fullCoreState: 'blocked',
        authorityState: { kind: 'unknown' },
        startupPhase: null,
        restartAttempt: this.#restartAttempts,
        lastError: failure
      })
      return
    }
    const args = coreLaunchArguments(
      this.#dataDirectory,
      this.#runtimeCampFilesRoot,
      this.#skillLibraryRoot,
      this.#removedSkillProjectRoots,
      this.#mcpConfigPath,
      this.#automationSchedulerControl
    )
    // Once this Desktop has observed authority, retries/crash restarts cannot
    // reinterpret its disappearance as a first install.
    if (this.#requireExistingAuthority) args.push('--require-existing-authority')
    console.info('[startup] stage=core_spawn')
    const child = spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: process.platform === 'win32'
    })
    const active: ActiveChild = {
      process: child,
      generation,
      token,
      ready: false,
      deterministicRefusal: false,
      startupRetryDelayMs: null,
      restartForAutomationControl: false
    }
    this.#child = active
    this.#updateSnapshot({
      generation,
      runtimeMode: 'bootstrap_only',
      fullCoreState: 'starting',
      authorityState: { kind: 'unknown' },
      startupPhase: 'lease',
      restartAttempt: this.#restartAttempts,
      lastError: null,
      migrationProgress: null
    })
    this.#emit({ method: 'runtime.state', params: { status: 'starting' } })

    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => this.#handleLine(generation, token, line))
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trimEnd()
      console.error(`[rovai-core] ${text}`)
    })
    child.on('error', (error) => this.#handleProcessError(generation, token, error))
    // A child can exit before its last stdout frames are delivered. Keep this generation
    // active until stdio closes so startup refusal/authority and final replies are not lost.
    child.on('close', (code, signal) => {
      this.#handleExit(generation, token, code, signal)
    })
  }

  stop(): void {
    this.#stopping = true
    if (this.#restartTimer) clearTimeout(this.#restartTimer)
    if (this.#stableTimer) clearTimeout(this.#stableTimer)
    this.#restartTimer = null
    this.#stableTimer = null
    this.#queuedRetryGeneration = null
    const active = this.#child
    this.#child = null
    if (active && !active.process.killed) active.process.kill('SIGTERM')
    this.#updateSnapshot({
      runtimeMode: 'bootstrap_only',
      fullCoreState: 'shutting_down',
      startupPhase: null
    })
    this.#failAllForShutdown('Rust Core stopped')
  }

  async request<T>(method: CoreMethod, params: unknown = {}): Promise<T> {
    if (this.#stopping) {
      throw new RovaiRequestError(structuredFailure(
        'shutdown',
        'full_core_shutting_down',
        'Rust Core is shutting down',
        false,
        this.#snapshot.generation,
        {}
      ))
    }
    const active = this.#child
    if (!active?.ready || this.#snapshot.fullCoreState !== 'ready') {
      throw new RovaiRequestError(structuredFailure(
        'full_core_unavailable',
        'full_core_unavailable',
        'The authoritative workspace is unavailable while Rovai is in bootstrap mode.',
        true,
        this.#snapshot.generation,
        { authorityState: this.#snapshot.authorityState }
      ))
    }

    return this.#sendRequest<T>(active, method, params, 60_000)
  }

  async notifyAutomationSystemSuspending(): Promise<void> {
    this.#automationSchedulerControl = {
      ...this.#automationSchedulerControl,
      epoch: this.#automationSchedulerControl.epoch + 1,
      paused: true
    }
    await this.#publishAutomationSchedulerControl()
  }

  async notifyAutomationSystemResumed(resumedAt: string): Promise<void> {
    this.#automationSchedulerControl = {
      epoch: this.#automationSchedulerControl.epoch + 1,
      recoveryBoundary: resumedAt,
      paused: false
    }
    await this.#publishAutomationSchedulerControl()
  }

  async tickAutomationScheduler(now: string): Promise<void> {
    if (
      this.#stopping
      || this.#automationSchedulerControl.paused
      || this.#automationTickPending
    ) return
    const active = this.#child
    if (!active?.ready || this.#snapshot.fullCoreState !== 'ready') return
    const epoch = this.#automationSchedulerControl.epoch
    this.#automationTickPending = true
    try {
      await this.#sendRequest(
        active,
        'automations.schedulerTick',
        { epoch, now },
        5_000
      )
    } finally {
      this.#automationTickPending = false
    }
  }

  shutdown(): Promise<CoreShutdownResult> {
    if (this.#shutdownPromise) return this.#shutdownPromise
    this.#shutdownPromise = this.#performShutdown()
    return this.#shutdownPromise
  }

  async #performShutdown(): Promise<CoreShutdownResult> {
    this.#stopping = true
    this.#emit({ method: 'runtime.state', params: { status: 'shutting_down' } })
    if (this.#restartTimer) clearTimeout(this.#restartTimer)
    if (this.#stableTimer) clearTimeout(this.#stableTimer)
    this.#restartTimer = null
    this.#stableTimer = null
    this.#queuedRetryGeneration = null
    this.#updateSnapshot({
      runtimeMode: 'bootstrap_only',
      fullCoreState: 'shutting_down',
      startupPhase: null
    })

    const active = this.#child
    if (!active) {
      this.#failAllForShutdown('Rust Core is shutting down')
      return { report: null, forcedSignal: null }
    }
    const child = active.process

    let forcedSignal: CoreShutdownResult['forcedSignal'] = null
    let sigkillTimer: NodeJS.Timeout | null = null
    const sigtermTimer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return
      forcedSignal = 'SIGTERM'
      child.kill('SIGTERM')
      sigkillTimer = setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null) return
        forcedSignal = 'SIGKILL'
        child.kill('SIGKILL')
      }, SHUTDOWN_SIGKILL_GRACE_MS)
    }, PLANNED_SHUTDOWN_DEADLINE_MS + SHUTDOWN_SIGTERM_GRACE_MS)

    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve()
        return
      }
      child.once('exit', () => resolve())
    })
    const reportPromise = this.#sendRequest<PlannedShutdownReport>(
      active,
      'core.shutdown',
      { protocolVersion: 3, deadlineMs: PLANNED_SHUTDOWN_DEADLINE_MS },
      PLANNED_SHUTDOWN_DEADLINE_MS + SHUTDOWN_SIGTERM_GRACE_MS
    ).catch((error) => {
      console.error('Rust Core planned shutdown did not return a report', error)
      return null
    })

    await exited
    clearTimeout(sigtermTimer)
    if (sigkillTimer) clearTimeout(sigkillTimer)
    const report = await reportPromise
    return { report, forcedSignal }
  }

  #sendRequest<T>(
    active: ActiveChild,
    method: CoreMethod | CoreInternalMethod,
    params: unknown,
    timeoutMs: number
  ): Promise<T> {

    const id = this.#nextId++
    const payload = `${JSON.stringify({ id, method, params })}\n`
    const startedAt = performance.now()
    const traceId = campOpenTraceId(params)
    if (traceId && (method === 'camps.enter' || method === 'camps.open')) {
      console.info(`[camp-open] trace=${traceId} stage=main_request method=${method}`)
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.#pending.get(id)
        if (pending?.generation === active.generation && pending.childToken === active.token) {
          this.#pending.delete(id)
        }
        reject(new RovaiRequestError(structuredFailure(
          'infrastructure_failure',
          'core_request_timeout',
          `Rust Core request timed out: ${method}`,
          true,
          active.generation,
          { method }
        )))
      }, timeoutMs)
      this.#pending.set(id, {
        generation: active.generation,
        childToken: active.token,
        requestId: id,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        method,
        startedAt,
        traceId
      })
      active.process.stdin.write(payload, (error) => {
        if (!error) return
        clearTimeout(timer)
        const pending = this.#pending.get(id)
        if (pending?.generation === active.generation && pending.childToken === active.token) {
          this.#pending.delete(id)
        }
        reject(new RovaiRequestError(structuredFailure(
          'infrastructure_failure',
          'core_request_write_failed',
          error.message,
          true,
          active.generation,
          { method }
        )))
      })
    })
  }

  async #publishAutomationSchedulerControl(): Promise<void> {
    if (this.#stopping) return
    const active = this.#child
    if (!active) return
    if (!active.ready || this.#snapshot.fullCoreState !== 'ready') {
      if (
        !active.deterministicRefusal
        && !active.restartForAutomationControl
        && !active.process.killed
      ) {
        // The generation was launched with an older Desktop-owned control snapshot.
        // Replace it before that generation can expose an Automation scheduler.
        active.restartForAutomationControl = true
        active.process.kill('SIGTERM')
      }
      return
    }
    await this.#sendRequest(
      active,
      'automations.schedulerControl',
      this.#automationSchedulerControl,
      5_000
    )
  }

  onEvent(listener: (event: CoreEvent) => void): () => void {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  #handleLine(generation: number, childToken: ChildToken, line: string): void {
    let message: CoreWireResponse | CoreStartupWireFrame
    const parseStartedAt = performance.now()
    try {
      message = JSON.parse(line) as CoreWireResponse | CoreStartupWireFrame
    } catch (error) {
      console.error('Invalid Rust Core response', error, line)
      return
    }

    if ((message as CoreStartupWireFrame).kind === 'core_startup') {
      this.#handleStartupFrame(generation, childToken, message as CoreStartupWireFrame)
      return
    }
    const response = message as CoreWireResponse

    if (response.method) {
      if (!this.#isActive(generation, childToken)) return
      if (response.method === 'runtime.subsystemsChanged' && this.#child?.ready) {
        const coreSubsystems = parseCoreSubsystems(response.params)
        if (coreSubsystems) this.#updateSnapshot({ coreSubsystems })
      }
      this.#emit({ method: response.method, params: response.params })
      return
    }

    if (typeof response.id !== 'number') return
    const pending = this.#pending.get(response.id)
    if (!pending || pending.generation !== generation || pending.childToken !== childToken) return
    clearTimeout(pending.timer)
    this.#pending.delete(response.id)
    if (
      pending.traceId
      && (pending.method === 'camps.enter' || pending.method === 'camps.open')
    ) {
      console.info(
        `[camp-open] trace=${pending.traceId} stage=main_response method=${pending.method} `
        + `roundtrip_ms=${(performance.now() - pending.startedAt).toFixed(1)} `
        + `parse_ms=${(performance.now() - parseStartedAt).toFixed(1)} `
        + `response_bytes=${Buffer.byteLength(line, 'utf8')}`
      )
    }
    if (response.error) {
      pending.reject(new RovaiRequestError(structuredFailure(
        response.error.kind ?? 'infrastructure_failure',
        response.error.code ?? 'core_request_failed',
        response.error.message ?? response.error.code ?? 'Core request failed',
        response.error.retryable ?? false,
        generation,
        response.error.details ?? {}
      )))
    } else {
      pending.resolve(response.result)
    }
  }

  #emit(event: CoreEvent): void {
    for (const listener of this.#eventListeners) listener(event)
  }

  #handleStartupFrame(
    generation: number,
    childToken: ChildToken,
    frame: CoreStartupWireFrame
  ): void {
    const active = this.#child
    if (!active || active.generation !== generation || active.token !== childToken) return
    if (frame.schemaVersion !== 1) {
      this.#handleProcessError(
        generation,
        childToken,
        new Error(`Unsupported Core startup frame schema ${frame.schemaVersion}`)
      )
      return
    }
    if (frame.status === 'ready' && active.restartForAutomationControl) return
    if (frame.status === 'ready' || frame.phase === 'opening_authority' || frame.phase === 'migrating_authority'
      || frame.authorityState?.kind === 'admitted' || frame.authorityState?.kind === 'migration_required'
      || frame.authorityState?.kind === 'migration_failed' || coreStartupRetryDelay(frame, 0) !== null) {
      this.#requireExistingAuthority = true
    }
    if (frame.status === 'ready') {
      active.ready = true
      this.#startupRetryAttempts = 0
      this.#updateSnapshot({
        generation,
        runtimeMode: 'full_core',
        fullCoreState: 'ready',
        authorityState: frame.authorityState ?? { kind: 'current' },
        startupPhase: null,
        restartAttempt: this.#restartAttempts,
        lastError: null,
        migrationProgress: null,
        coreSubsystems: parseCoreSubsystems(frame.subsystems) ?? []
      })
      console.info('[startup] stage=core_ready')
      this.#emit({ method: 'runtime.state', params: { status: 'ready' } })
      if (this.#stableTimer) clearTimeout(this.#stableTimer)
      this.#stableTimer = setTimeout(() => {
        if (this.#isActive(generation, childToken) && active.ready) this.#restartAttempts = 0
        this.#stableTimer = null
      }, 10_000)
      return
    }
    if (frame.status === 'phase') {
      this.#updateSnapshot({
        generation,
        runtimeMode: 'bootstrap_only',
        fullCoreState: 'starting',
        authorityState: frame.authorityState ?? this.#snapshot.authorityState,
        startupPhase: frame.phase ?? null,
        restartAttempt: this.#restartAttempts,
        lastError: null,
        migrationProgress: frame.progress ?? null
      })
      return
    }

    active.deterministicRefusal = true
    active.startupRetryDelayMs = active.ready ? null : coreStartupRetryDelay(frame, this.#startupRetryAttempts)
    const failure = frame.error
      ? structuredFailure(
          'infrastructure_failure',
          frame.error.code,
          frame.error.message,
          frame.error.retryable,
          generation,
          frame.error.details
        )
      : null
    this.#updateSnapshot({
      generation,
      runtimeMode: 'bootstrap_only',
      fullCoreState: active.startupRetryDelayMs === null ? 'blocked' : 'starting',
      authorityState: frame.authorityState ?? { kind: 'unknown' },
      startupPhase: frame.phase ?? null,
      restartAttempt: this.#restartAttempts,
      lastError: failure,
      migrationProgress: frame.progress ?? null
    })
    this.#failGeneration(
      generation,
      childToken,
      structuredFailure(
        'full_core_unavailable',
        'full_core_startup_refused',
        failure?.message ?? 'Full Core startup was refused by authority admission.',
        frame.error?.retryable ?? true,
        generation,
        { authorityState: frame.authorityState }
      )
    )
    this.#emit({
      method: 'runtime.state',
      params: { status: active.startupRetryDelayMs === null ? 'blocked' : 'starting', authorityState: frame.authorityState }
    })
  }

  #handleProcessError(generation: number, childToken: ChildToken, error: Error): void {
    const failure = structuredFailure(
      'infrastructure_failure',
      'core_process_error',
      error.message,
      true,
      generation,
      {}
    )
    this.#failGeneration(generation, childToken, failure)
    if (!this.#isActive(generation, childToken)) return
    this.#updateSnapshot({ lastError: failure })
  }

  #handleExit(
    generation: number,
    childToken: ChildToken,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    const message = `Rust Core exited (code=${code}, signal=${signal})`
    this.#failGeneration(
      generation,
      childToken,
      structuredFailure(
        this.#stopping ? 'shutdown' : 'infrastructure_failure',
        this.#stopping ? 'full_core_shutting_down' : 'core_process_exited',
        message,
        !this.#stopping,
        generation,
        { code, signal }
      )
    )
    const active = this.#child
    if (!active || active.generation !== generation || active.token !== childToken) return
    this.#child = null
    if (this.#stableTimer) {
      clearTimeout(this.#stableTimer)
      this.#stableTimer = null
    }
    if (this.#stopping) return
    if (active.restartForAutomationControl) {
      this.start()
      return
    }
    if (active.deterministicRefusal) {
      if (this.#queuedRetryGeneration === generation) {
        this.#queuedRetryGeneration = null
        this.#restartAttempts = 0
        this.#startupRetryAttempts = 0
        this.start()
      } else if (active.startupRetryDelayMs !== null) {
        this.#startupRetryAttempts += 1
        console.info('[startup] stage=startup_retry', { attempt: this.#startupRetryAttempts, delayMs: active.startupRetryDelayMs })
        this.#restartTimer = setTimeout(() => {
          if (!this.#stopping && this.#generation === generation && !this.#child) this.start()
        }, active.startupRetryDelayMs)
      }
      return
    }
    if (this.#restartAttempts >= 2) {
      const failure = structuredError('core_process_exited', message, true, { code, signal })
      this.#updateSnapshot({
        runtimeMode: 'bootstrap_only',
        fullCoreState: 'crashed',
        authorityState: { kind: 'unknown' },
        startupPhase: null,
        lastError: failure
      })
      this.#emit({ method: 'runtime.state', params: { status: 'crashed', message } })
      return
    }
    this.#restartAttempts += 1
    const delayMs = this.#restartAttempts * 750
    this.#updateSnapshot({
      runtimeMode: 'bootstrap_only',
      fullCoreState: 'starting',
      authorityState: { kind: 'unknown' },
      startupPhase: null,
      restartAttempt: this.#restartAttempts,
      lastError: structuredError('core_process_exited', message, true, { code, signal })
    })
    this.#emit({
      method: 'runtime.state',
      params: { status: 'restarting', attempt: this.#restartAttempts, message }
    })
    this.#restartTimer = setTimeout(() => this.start(), delayMs)
  }

  #isActive(generation: number, childToken: ChildToken): boolean {
    return this.#child?.generation === generation && this.#child.token === childToken
  }

  #failGeneration(
    generation: number,
    childToken: ChildToken,
    failure: RovaiRequestFailure
  ): void {
    for (const [id, pending] of this.#pending) {
      if (pending.generation !== generation || pending.childToken !== childToken) continue
      clearTimeout(pending.timer)
      pending.reject(new RovaiRequestError(failure))
      this.#pending.delete(id)
    }
  }

  #failAllForShutdown(message: string): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer)
      pending.reject(new RovaiRequestError(structuredFailure(
        'shutdown',
        'full_core_shutting_down',
        message,
        false,
        pending.generation,
        {}
      )))
      this.#pending.delete(id)
    }
  }

  #updateSnapshot(patch: Partial<Omit<SupervisorSnapshot, 'schemaVersion' | 'revision' | 'capabilities'>>): void {
    const runtimeMode = patch.runtimeMode ?? this.#snapshot.runtimeMode
    const fullCoreState = patch.fullCoreState ?? this.#snapshot.fullCoreState
    this.#snapshot = {
      ...this.#snapshot,
      ...patch,
      schemaVersion: 1,
      revision: this.#snapshot.revision + 1,
      runtimeMode,
      fullCoreState,
      coreSubsystems: runtimeMode === 'full_core'
        ? patch.coreSubsystems ?? this.#snapshot.coreSubsystems
        : [],
      capabilities: capabilitiesFor(runtimeMode, fullCoreState)
    }
    const snapshot = this.getSnapshot()
    for (const listener of this.#snapshotListeners) listener(snapshot)
  }
}

function parseCoreSubsystems(value: unknown): CoreSubsystemSnapshot[] | null {
  if (!Array.isArray(value) || value.length > 64) return null
  const ids = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string'
      || !/^[a-z][a-z0-9.-]{0,79}$/.test(entry.id)
      || ids.has(entry.id) || !['initializing', 'ready', 'degraded'].includes(entry.state)) return null
    ids.add(entry.id)
    if (entry.error !== null && (!entry.error || typeof entry.error.code !== 'string'
      || typeof entry.error.message !== 'string' || typeof entry.error.retryable !== 'boolean')) return null
  }
  return structuredClone(value) as CoreSubsystemSnapshot[]
}

function campOpenTraceId(params: unknown): string | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null
  const traceId = (params as Record<string, unknown>).traceId
  return typeof traceId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(traceId)
    ? traceId.toLowerCase()
    : null
}

export function sidecarTargetKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): 'macos-arm64' | 'macos-x64' | 'windows-x64' {
  if (platform === 'darwin' && arch === 'arm64') return 'macos-arm64'
  if (platform === 'darwin' && arch === 'x64') return 'macos-x64'
  if (platform === 'win32' && arch === 'x64') return 'windows-x64'
  throw new Error(`Unsupported Rovai sidecar host: ${platform}-${arch}`)
}

export function sidecarExecutableName(
  binary: string,
  platform: NodeJS.Platform = process.platform
): string {
  return platform === 'win32' ? `${binary}.exe` : binary
}

export function resolveCoreBinary(): string {
  return resolveBundledSidecar('rovai-core', [
    process.env.ROVAI_CORE_BIN,
    process.env.HORIZONWARD_CORE_BIN,
    process.env.LUMEN_CORE_BIN
  ])
}

export function resolveDesktopBootstrapBinary(): string {
  return resolveBundledSidecar('rovai')
}

function resolveBundledSidecar(binary: 'rovai-core' | 'rovai', overrides: Array<string | undefined> = []): string {
  const executable = sidecarExecutableName(binary)
  const stagedTarget = sidecarTargetKey()
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'bin', executable)]
    : [
        ...overrides,
        join(app.getAppPath(), 'resources', 'bin', stagedTarget, executable),
        join(process.cwd(), 'resources', 'bin', stagedTarget, executable)
      ]

  for (const candidate of candidates) {
    if (!candidate) continue
    const absoluteCandidate = resolve(candidate)
    try {
      accessSync(absoluteCandidate, constants.X_OK)
      return absoluteCandidate
    } catch {
      // Try the next known location.
    }
  }

  throw new Error(`Rovai AI ${binary === 'rovai-core' ? 'Rust Core binary' : 'Desktop bootstrap helper'} was not found. Checked: ${candidates.filter(Boolean).map((candidate) => resolve(candidate as string)).join(', ')}`)
}
