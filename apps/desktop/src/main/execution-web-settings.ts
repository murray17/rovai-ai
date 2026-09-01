import { readFile } from 'node:fs/promises'
import type { ExecutionWebSettingsSnapshot, StructuredError } from '@contracts'
import { writePrivateJson } from './general-preferences'

export const DEFAULT_EXECUTION_WEB_SETTINGS = {
  enabled: false,
  port: 8765
} as const

export type StoredExecutionWebSettings = {
  schemaVersion: 1
  enabled: boolean
  port: number
}

export function isExecutionWebPort(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1024
    && value <= 65535
}

export function parseExecutionWebSettings(value: unknown): StoredExecutionWebSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const keys = Object.keys(candidate).sort()
  if (keys.join('\0') !== ['enabled', 'port', 'schemaVersion'].sort().join('\0')) return null
  if (candidate.schemaVersion !== 1 || typeof candidate.enabled !== 'boolean'
    || !isExecutionWebPort(candidate.port)) return null
  return { schemaVersion: 1, enabled: candidate.enabled, port: candidate.port }
}

export class ExecutionWebSettingsStore {
  readonly #filePath: string
  #settings: StoredExecutionWebSettings
  readonly loadDegradation: StructuredError | null
  #writeTail: Promise<void> = Promise.resolve()

  private constructor(
    filePath: string,
    settings: StoredExecutionWebSettings,
    loadDegradation: StructuredError | null
  ) {
    this.#filePath = filePath
    this.#settings = settings
    this.loadDegradation = loadDegradation
  }

  static async load(filePath: string): Promise<ExecutionWebSettingsStore> {
    try {
      const parsed = parseExecutionWebSettings(JSON.parse(await readFile(filePath, 'utf8')))
      if (parsed) return new ExecutionWebSettingsStore(filePath, parsed, null)
      return new ExecutionWebSettingsStore(filePath, defaults(), degradation(
        'execution_web_settings_invalid',
        'Execution Web settings are invalid; the service remains disabled with in-memory defaults.'
      ))
    } catch (error) {
      const missing = error instanceof Error && 'code' in error
        && (error as NodeJS.ErrnoException).code === 'ENOENT'
      return new ExecutionWebSettingsStore(filePath, defaults(), missing ? null : degradation(
        'execution_web_settings_unreadable',
        'Execution Web settings could not be read; the service remains disabled with in-memory defaults.'
      ))
    }
  }

  get(): StoredExecutionWebSettings {
    return { ...this.#settings }
  }

  set(next: Pick<ExecutionWebSettingsSnapshot, 'enabled' | 'port'>): Promise<StoredExecutionWebSettings> {
    if (typeof next.enabled !== 'boolean' || !isExecutionWebPort(next.port)) {
      return Promise.reject(new Error('Execution Web settings are invalid'))
    }
    return this.#enqueue(async () => {
      const stored = { schemaVersion: 1 as const, enabled: next.enabled, port: next.port }
      await writePrivateJson(this.#filePath, stored)
      this.#settings = stored
      return this.get()
    })
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writeTail.then(operation, operation)
    this.#writeTail = result.then(() => undefined, () => undefined)
    return result
  }
}

function defaults(): StoredExecutionWebSettings {
  return { schemaVersion: 1, ...DEFAULT_EXECUTION_WEB_SETTINGS }
}

function degradation(code: string, message: string): StructuredError {
  return { code, message, retryable: true, details: {} }
}
