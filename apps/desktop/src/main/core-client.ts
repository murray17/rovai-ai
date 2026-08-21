import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import { accessSync, constants, realpathSync } from 'node:fs'
import { join, resolve, win32 } from 'node:path'
import { app } from 'electron'
import type { CoreEvent, CoreMethod } from '@contracts'

type PendingRequest = {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: NodeJS.Timeout
  method: CoreMethod | 'core.shutdown'
  startedAt: number
  traceId: string | null
}

type CoreWireResponse = {
  id?: number
  result?: unknown
  error?: { code?: string; message?: string }
  method?: string
  params?: unknown
}

export type PlannedShutdownReport = {
  protocolVersion: 2
  status: 'completed'
  deadlineExpired: boolean
  activeExecutionsObserved: number
  stopRequestsIssued: number
  terminalExecutionsSettled: number
  fencedAgentRunsSettled: number
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
  removedSkillProjectRoots: readonly string[]
): string[] {
  const args = [
    '--data-dir', dataDirectory,
    '--runtime-camp-files-root', runtimeCampFilesRoot
  ]
  if (skillLibraryRoot) args.push('--skill-library-root', skillLibraryRoot)
  else args.push('--use-default-skill-library')
  for (const executionRoot of removedSkillProjectRoots) {
    args.push('--removed-skill-project-root', executionRoot)
  }
  return args
}

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(resolve(path))
  } catch {
    return resolve(path)
  }
}

export function runtimeCampFilesRoot(
  dataDirectory: string,
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'win32') return win32.join(dataDirectory, 'runtime-files')
  const canonicalUserData = canonicalPath(dataDirectory)
  const instanceKey = `v1-${createHash('sha256')
    .update('rovai-runtime-camp-files-instance-v1\0', 'utf8')
    .update(canonicalUserData, 'utf8')
    .digest('hex')}`
  return join(canonicalPath(homeDirectory), '.rovai', 'instances', instanceKey, 'runtime-files')
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
}

const PLANNED_SHUTDOWN_DEADLINE_MS = 10_000
const SHUTDOWN_SIGTERM_GRACE_MS = 3_000
const SHUTDOWN_SIGKILL_GRACE_MS = 2_000

export class CoreClient {
  #child: ChildProcessWithoutNullStreams | null = null
  #nextId = 1
  #pending = new Map<number, PendingRequest>()
  #eventListeners = new Set<(event: CoreEvent) => void>()
  #restartAttempts = 0
  #restartTimer: NodeJS.Timeout | null = null
  #stableTimer: NodeJS.Timeout | null = null
  #stopping = false
  #shutdownPromise: Promise<CoreShutdownResult> | null = null
  #removedSkillProjectRoots: string[] = []
  #skillLibraryRoot: string | null = null
  readonly #dataDirectory: string
  readonly #runtimeCampFilesRoot: string

  constructor(
    dataDirectory: string = app.getPath('userData'),
    runtimeFilesRoot: string = runtimeCampFilesRoot(
      dataDirectory,
      coreProcessHomeDirectory(app.getPath('home'))
    )
  ) {
    this.#dataDirectory = dataDirectory
    this.#runtimeCampFilesRoot = runtimeFilesRoot
  }

  setRemovedSkillProjectRoots(executionRoots: string[]): void {
    this.#removedSkillProjectRoots = [...new Set(executionRoots)]
  }

  start(options?: CoreStartOptions): void {
    if (options?.removedSkillProjectRoots) {
      this.setRemovedSkillProjectRoots(options.removedSkillProjectRoots)
    }
    if (options?.skillLibraryRoot) {
      this.#skillLibraryRoot = options.skillLibraryRoot
    }
    if (this.#child) return
    this.#stopping = false
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer)
      this.#restartTimer = null
    }

    const binary = resolveCoreBinary()
    const args = coreLaunchArguments(
      this.#dataDirectory,
      this.#runtimeCampFilesRoot,
      this.#skillLibraryRoot,
      this.#removedSkillProjectRoots
    )
    const coreStartedAt = performance.now()
    console.info('[startup] stage=core_spawn')
    const child = spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: process.platform === 'win32'
    })
    let readyReported = false
    this.#child = child
    this.#emit({ method: 'runtime.state', params: { status: 'starting' } })
    this.#stableTimer = setTimeout(() => {
      this.#restartAttempts = 0
      this.#stableTimer = null
    }, 10_000)

    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => this.#handleLine(line))
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trimEnd()
      console.error(`[rovai-core] ${text}`)
      if (!readyReported && text.includes('rovai-core') && text.includes('ready')) {
        readyReported = true
        console.info(
          `[startup] stage=core_ready elapsed_ms=${(performance.now() - coreStartedAt).toFixed(1)}`
        )
        this.#emit({ method: 'runtime.state', params: { status: 'ready' } })
      }
    })
    child.on('error', (error) => this.#failAll(error))
    child.on('exit', (code, signal) => {
      const error = new Error(`Rust Core exited (code=${code}, signal=${signal})`)
      if (this.#child === child) this.#child = null
      if (this.#stableTimer) {
        clearTimeout(this.#stableTimer)
        this.#stableTimer = null
      }
      this.#failAll(error)
      if (this.#stopping) return
      if (this.#restartAttempts >= 2) {
        this.#emit({ method: 'runtime.state', params: { status: 'crashed', message: error.message } })
        return
      }
      this.#restartAttempts += 1
      const delayMs = this.#restartAttempts * 750
      this.#emit({
        method: 'runtime.state',
        params: { status: 'restarting', attempt: this.#restartAttempts, message: error.message }
      })
      this.#restartTimer = setTimeout(() => this.start(), delayMs)
    })
  }

  stop(): void {
    this.#stopping = true
    if (this.#restartTimer) clearTimeout(this.#restartTimer)
    if (this.#stableTimer) clearTimeout(this.#stableTimer)
    this.#restartTimer = null
    this.#stableTimer = null
    const child = this.#child
    this.#child = null
    if (child && !child.killed) child.kill('SIGTERM')
    this.#failAll(new Error('Rust Core stopped'))
  }

  async request<T>(method: CoreMethod, params: unknown = {}): Promise<T> {
    if (this.#stopping) throw new Error('Rust Core is shutting down')
    if (!this.#child) this.start()
    const child = this.#child
    if (!child) throw new Error('Rust Core is unavailable')

    return this.#sendRequest<T>(child, method, params, 60_000)
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

    const child = this.#child
    if (!child) return { report: null, forcedSignal: null }

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
      child,
      'core.shutdown',
      { protocolVersion: 2, deadlineMs: PLANNED_SHUTDOWN_DEADLINE_MS },
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
    child: ChildProcessWithoutNullStreams,
    method: CoreMethod | 'core.shutdown',
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
        this.#pending.delete(id)
        reject(new Error(`Rust Core request timed out: ${method}`))
      }, timeoutMs)
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        method,
        startedAt,
        traceId
      })
      child.stdin.write(payload, (error) => {
        if (!error) return
        clearTimeout(timer)
        this.#pending.delete(id)
        reject(error)
      })
    })
  }

  onEvent(listener: (event: CoreEvent) => void): () => void {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  #handleLine(line: string): void {
    let message: CoreWireResponse
    const parseStartedAt = performance.now()
    try {
      message = JSON.parse(line) as CoreWireResponse
    } catch (error) {
      console.error('Invalid Rust Core response', error, line)
      return
    }

    if (message.method) {
      this.#emit({ method: message.method, params: message.params })
      return
    }

    if (typeof message.id !== 'number') return
    const pending = this.#pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.#pending.delete(message.id)
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
    if (message.error) {
      pending.reject(new Error(message.error.message ?? message.error.code ?? 'Core request failed'))
    } else {
      pending.resolve(message.result)
    }
  }

  #emit(event: CoreEvent): void {
    for (const listener of this.#eventListeners) listener(event)
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }
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
  const executable = sidecarExecutableName('rovai-core')
  const stagedTarget = sidecarTargetKey()
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'bin', executable)]
    : [
        process.env.ROVAI_CORE_BIN,
        process.env.HORIZONWARD_CORE_BIN,
        process.env.LUMEN_CORE_BIN,
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

  throw new Error(`Rovai AI Rust Core binary was not found. Checked: ${candidates.filter(Boolean).map((candidate) => resolve(candidate as string)).join(', ')}`)
}
