import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { CoreEvent, CoreMethod } from '@contracts'

type PendingRequest = {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

type CoreWireResponse = {
  id?: number
  result?: unknown
  error?: { code?: string; message?: string }
  method?: string
  params?: unknown
}

export type PlannedShutdownReport = {
  protocolVersion: 1
  status: 'completed'
  deadlineExpired: boolean
  activeExecutionsObserved: number
  stopRequestsIssued: number
  terminalExecutionsSettled: number
  unresolvedExecutions: number
}

export type CoreShutdownResult = {
  report: PlannedShutdownReport | null
  forcedSignal: 'SIGTERM' | 'SIGKILL' | null
}

export function coreLaunchArguments(
  userDataPath: string,
  skillLibraryRoot: string | null,
  removedSkillProjectRoots: readonly string[]
): string[] {
  const args = ['--data-dir', userDataPath]
  if (skillLibraryRoot) args.push('--skill-library-root', skillLibraryRoot)
  for (const executionRoot of removedSkillProjectRoots) {
    args.push('--removed-skill-project-root', executionRoot)
  }
  return args
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
    const userDataPath = app.getPath('userData')
    const args = coreLaunchArguments(
      userDataPath,
      this.#skillLibraryRoot,
      this.#removedSkillProjectRoots
    )
    const child = spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    })
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
      if (text.includes('rovai-core') && text.includes('ready')) {
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
      { protocolVersion: 1, deadlineMs: PLANNED_SHUTDOWN_DEADLINE_MS },
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
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`Rust Core request timed out: ${method}`))
      }, timeoutMs)
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
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

function resolveCoreBinary(): string {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'bin', 'rovai-core')]
    : [
        process.env.ROVAI_CORE_BIN,
        process.env.HORIZONWARD_CORE_BIN,
        process.env.LUMEN_CORE_BIN,
        join(app.getAppPath(), 'resources', 'bin', 'rovai-core'),
        join(process.cwd(), 'resources', 'bin', 'rovai-core')
      ]

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Try the next known location.
    }
  }

  throw new Error(`Rovai-ai Rust Core binary was not found. Checked: ${candidates.filter(Boolean).join(', ')}`)
}
