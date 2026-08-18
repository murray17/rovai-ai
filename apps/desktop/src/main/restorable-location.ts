import { readFile } from 'node:fs/promises'
import { isCampId, type RestorableLocation } from '@contracts'
import { writePrivateJson } from './general-preferences'

const MAX_STABLE_ID_LENGTH = 256

export type RestorableLocationReadResult = {
  status: 'valid' | 'missing' | 'invalid'
  location: RestorableLocation | null
}

export function parseRestorableLocation(value: unknown): RestorableLocation | null {
  if (!isRecord(value)) return null
  if (value.kind === 'quick_chat' && hasExactKeys(value, ['kind'])) return { kind: 'quick_chat' }
  if (value.kind === 'memory' && hasExactKeys(value, ['kind'])) return { kind: 'memory' }
  if (
    value.kind === 'camp'
    && hasExactKeys(value, ['kind', 'campId'])
    && isCampId(value.campId)
  ) {
    return { kind: 'camp', campId: value.campId }
  }
  if (
    value.kind === 'members'
    && hasExactKeys(value, ['kind', 'agentId', 'tab'])
    && (value.agentId === null || isStableId(value.agentId))
    && (value.tab === 'identity' || value.tab === 'runtime')
  ) {
    return { kind: 'members', agentId: value.agentId, tab: value.tab }
  }
  return null
}

export async function readRestorableLocation(filePath: string): Promise<RestorableLocationReadResult> {
  let source: unknown
  try {
    source = JSON.parse(await readFile(filePath, 'utf8')) as unknown
  } catch (error) {
    return isMissingPathError(error)
      ? { status: 'missing', location: null }
      : { status: 'invalid', location: null }
  }
  if (!isRecord(source) || !hasExactKeys(source, ['schemaVersion', 'location']) || source.schemaVersion !== 1) {
    return { status: 'invalid', location: null }
  }
  const location = parseRestorableLocation(source.location)
  return location
    ? { status: 'valid', location }
    : { status: 'invalid', location: null }
}

export class RestorableLocationStore {
  readonly #filePath: string
  #readResult: RestorableLocationReadResult
  #writeTail: Promise<void> = Promise.resolve()

  private constructor(filePath: string, readResult: RestorableLocationReadResult) {
    this.#filePath = filePath
    this.#readResult = readResult
  }

  static async load(filePath: string): Promise<RestorableLocationStore> {
    return new RestorableLocationStore(filePath, await readRestorableLocation(filePath))
  }

  get(): RestorableLocationReadResult {
    return {
      status: this.#readResult.status,
      location: this.#readResult.location ? structuredClone(this.#readResult.location) : null
    }
  }

  commit(location: RestorableLocation): Promise<void> {
    const validated = parseRestorableLocation(location)
    if (!validated) return Promise.reject(new Error('Unsupported restorable location'))
    return this.#enqueue(async () => {
      if (
        this.#readResult.status === 'valid'
        && JSON.stringify(this.#readResult.location) === JSON.stringify(validated)
      ) return
      await writePrivateJson(this.#filePath, { schemaVersion: 1, location: validated })
      this.#readResult = { status: 'valid', location: validated }
    })
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writeTail.then(operation, operation)
    this.#writeTail = result.then(() => undefined, () => undefined)
    return result
  }
}

function isStableId(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_STABLE_ID_LENGTH
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: string[]): boolean {
  const keys = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
