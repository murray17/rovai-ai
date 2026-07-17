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

export class CoreClient {
  #child: ChildProcessWithoutNullStreams | null = null
  #nextId = 1
  #pending = new Map<number, PendingRequest>()
  #eventListeners = new Set<(event: CoreEvent) => void>()

  start(): void {
    if (this.#child) return

    const binary = resolveCoreBinary()
    const child = spawn(binary, ['--data-dir', app.getPath('userData')], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.#child = child

    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => this.#handleLine(line))
    child.stderr.on('data', (chunk) => {
      console.error(`[lumen-core] ${String(chunk).trimEnd()}`)
    })
    child.on('error', (error) => this.#failAll(error))
    child.on('exit', (code, signal) => {
      const error = new Error(`Rust Core exited (code=${code}, signal=${signal})`)
      this.#child = null
      this.#failAll(error)
      this.#emit({ method: 'runtime.state', params: { status: 'crashed', message: error.message } })
    })
  }

  stop(): void {
    const child = this.#child
    this.#child = null
    if (child && !child.killed) child.kill('SIGTERM')
    this.#failAll(new Error('Rust Core stopped'))
  }

  async request<T>(method: CoreMethod, params: unknown = {}): Promise<T> {
    if (!this.#child) this.start()
    const child = this.#child
    if (!child) throw new Error('Rust Core is unavailable')

    const id = this.#nextId++
    const payload = `${JSON.stringify({ id, method, params })}\n`
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`Rust Core request timed out: ${method}`))
      }, 30_000)
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
    ? [join(process.resourcesPath, 'bin', 'lumen-core')]
    : [
        process.env.LUMEN_CORE_BIN,
        join(app.getAppPath(), 'resources', 'bin', 'lumen-core'),
        join(process.cwd(), 'resources', 'bin', 'lumen-core')
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

  throw new Error(`Lumen Rust Core binary was not found. Checked: ${candidates.filter(Boolean).join(', ')}`)
}

