import type {
  AppUpdateFailureReason,
  AppUpdateSnapshot
} from '@contracts'

const GITHUB_API_VERSION = '2026-03-10'
const LATEST_RELEASE_ENDPOINT = 'https://api.github.com/repos/murray17/rovai-ai/releases/latest'
const RELEASE_PAGE_PREFIX = '/murray17/rovai-ai/releases/tag/'
const MAX_RESPONSE_CHARACTERS = 512 * 1024
const MAX_RELEASE_NAME_CHARACTERS = 160
const MAX_RELEASE_NOTES_CHARACTERS = 720
const DEFAULT_TIMEOUT_MS = 12_000

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface ParsedVersion {
  normalized: string
  core: [number, number, number]
  prerelease: Array<number | string>
}

interface GitHubReleasePayload {
  tagName: string
  name: string | null
  body: string | null
  htmlUrl: string
  publishedAt: string | null
  draft: boolean
  prerelease: boolean
}

interface AppUpdatesServiceOptions {
  currentVersion(): string
  openExternal(url: string): Promise<void>
  fetchImpl?: FetchImplementation
  now?: () => Date
  timeoutMs?: number
}

export class AppUpdatesService {
  readonly #currentVersion: () => string
  readonly #openExternal: (url: string) => Promise<void>
  readonly #fetch: FetchImplementation
  readonly #now: () => Date
  readonly #timeoutMs: number
  #snapshot: AppUpdateSnapshot
  #releasePageUrl: string | null = null
  #etag: string | null = null
  #inFlight: Promise<AppUpdateSnapshot> | null = null

  constructor(options: AppUpdatesServiceOptions) {
    this.#currentVersion = options.currentVersion
    this.#openExternal = options.openExternal
    this.#fetch = options.fetchImpl ?? globalThis.fetch
    this.#now = options.now ?? (() => new Date())
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#snapshot = idleSnapshot(this.#currentVersion())
  }

  get(): AppUpdateSnapshot {
    return structuredClone(this.#snapshot)
  }

  check(): Promise<AppUpdateSnapshot> {
    if (this.#inFlight) return this.#inFlight.then((snapshot) => structuredClone(snapshot))
    const request = this.#performCheck().finally(() => {
      this.#inFlight = null
    })
    this.#inFlight = request
    return request.then((snapshot) => structuredClone(snapshot))
  }

  async openReleasePage(): Promise<boolean> {
    if (!this.#releasePageUrl) return false
    await this.#openExternal(this.#releasePageUrl)
    return true
  }

  async #performCheck(): Promise<AppUpdateSnapshot> {
    const currentVersion = this.#currentVersion()
    const checkedAt = this.#now().toISOString()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs)
    timeout.unref?.()

    let response: Response
    try {
      response = await this.#fetch(LATEST_RELEASE_ENDPOINT, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Rovai-AI/${safeUserAgentVersion(currentVersion)}`,
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
          ...(this.#etag ? { 'If-None-Match': this.#etag } : {})
        },
        redirect: 'follow',
        signal: controller.signal
      })
    } catch {
      return this.#acceptFailure(currentVersion, 'network', checkedAt)
    } finally {
      clearTimeout(timeout)
    }

    if (response.status === 304 && this.#releasePageUrl && hasRelease(this.#snapshot)) {
      this.#snapshot = { ...this.#snapshot, checkedAt }
      return this.#snapshot
    }
    if (response.status === 404) {
      this.#releasePageUrl = null
      this.#etag = null
      this.#snapshot = {
        ...idleSnapshot(currentVersion),
        status: 'no_release',
        checkedAt
      }
      return this.#snapshot
    }
    if (response.status === 403 || response.status === 429) {
      return this.#acceptFailure(
        currentVersion,
        'rate_limited',
        checkedAt,
        rateLimitRetryAt(response.headers, this.#now())
      )
    }
    if (!response.ok) {
      return this.#acceptFailure(currentVersion, 'github_unavailable', checkedAt)
    }

    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_CHARACTERS) {
      return this.#acceptFailure(currentVersion, 'invalid_release', checkedAt)
    }

    let raw: string
    try {
      raw = await response.text()
    } catch {
      return this.#acceptFailure(currentVersion, 'network', checkedAt)
    }
    if (raw.length > MAX_RESPONSE_CHARACTERS) {
      return this.#acceptFailure(currentVersion, 'invalid_release', checkedAt)
    }

    let release: GitHubReleasePayload | null = null
    try {
      release = parseGitHubRelease(JSON.parse(raw) as unknown)
    } catch {
      release = null
    }
    const current = parseVersion(currentVersion)
    const latest = release ? parseVersion(release.tagName) : null
    const releasePageUrl = release ? trustedReleasePageUrl(release.htmlUrl) : null
    if (!release || release.draft || release.prerelease || !current || !latest || !releasePageUrl) {
      return this.#acceptFailure(currentVersion, 'invalid_release', checkedAt)
    }

    this.#etag = response.headers.get('etag')
    this.#releasePageUrl = releasePageUrl
    this.#snapshot = {
      currentVersion,
      status: compareVersions(latest, current) > 0 ? 'update_available' : 'up_to_date',
      latestVersion: latest.normalized,
      releaseName: boundedSingleLine(release.name ?? release.tagName, MAX_RELEASE_NAME_CHARACTERS),
      releaseNotesSummary: summarizeReleaseNotes(release.body),
      publishedAt: validIsoDate(release.publishedAt),
      releasePageAvailable: true,
      checkedAt,
      failureReason: null,
      retryAt: null
    }
    return this.#snapshot
  }

  #acceptFailure(
    currentVersion: string,
    reason: AppUpdateFailureReason,
    checkedAt: string,
    retryAt: string | null = null
  ): AppUpdateSnapshot {
    this.#releasePageUrl = null
    this.#etag = null
    this.#snapshot = {
      ...idleSnapshot(currentVersion),
      status: 'check_failed',
      checkedAt,
      failureReason: reason,
      retryAt
    }
    return this.#snapshot
  }
}

export function parseVersion(value: string): ParsedVersion | null {
  const match = value.trim().match(
    /^v?(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
  )
  if (!match) return null
  const core = [match[1], match[2] ?? '0', match[3] ?? '0'].map(Number)
  if (core.some((part) => !Number.isSafeInteger(part))) return null
  const prerelease = match[4]
    ? match[4].split('.').map((identifier) => /^(0|[1-9]\d*)$/.test(identifier)
        ? Number(identifier)
        : identifier)
    : []
  return {
    normalized: `${core.join('.')}${match[4] ? `-${match[4]}` : ''}`,
    core: core as [number, number, number],
    prerelease
  }
}

export function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] - right.core[index]
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1
    }
    if (leftPart === rightPart) continue
    if (typeof leftPart === 'number' && typeof rightPart === 'number') return leftPart - rightPart
    if (typeof leftPart === 'number') return -1
    if (typeof rightPart === 'number') return 1
    return leftPart.localeCompare(rightPart)
  }
  return 0
}

export function summarizeReleaseNotes(body: string | null): string | null {
  if (!body?.trim()) return null
  const lines = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]{1,240}>/g, ' ')
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s{0,3}(?:#{1,6}|>|[-*+] |\d+[.)] )\s*/, '')
      .replace(/^\s*\[[ xX]\]\s*/, '')
      .replace(/[*_~`]/g, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
    .slice(0, 6)
  if (lines.length === 0) return null
  return boundedMultiline(lines.join('\n'), MAX_RELEASE_NOTES_CHARACTERS)
}

function idleSnapshot(currentVersion: string): AppUpdateSnapshot {
  return {
    currentVersion,
    status: 'idle',
    latestVersion: null,
    releaseName: null,
    releaseNotesSummary: null,
    publishedAt: null,
    releasePageAvailable: false,
    checkedAt: null,
    failureReason: null,
    retryAt: null
  }
}

function hasRelease(snapshot: AppUpdateSnapshot): boolean {
  return snapshot.releasePageAvailable
    && snapshot.latestVersion !== null
    && (snapshot.status === 'up_to_date' || snapshot.status === 'update_available')
}

function parseGitHubRelease(value: unknown): GitHubReleasePayload | null {
  if (!isRecord(value)) return null
  if (typeof value.tag_name !== 'string'
      || (typeof value.name !== 'string' && value.name !== null)
      || (typeof value.body !== 'string' && value.body !== null)
      || typeof value.html_url !== 'string'
      || (typeof value.published_at !== 'string' && value.published_at !== null)
      || typeof value.draft !== 'boolean'
      || typeof value.prerelease !== 'boolean') return null
  return {
    tagName: value.tag_name,
    name: value.name,
    body: value.body,
    htmlUrl: value.html_url,
    publishedAt: value.published_at,
    draft: value.draft,
    prerelease: value.prerelease
  }
}

function trustedReleasePageUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:'
        || url.hostname.toLowerCase() !== 'github.com'
        || url.port
        || url.username
        || url.password
        || url.search
        || url.hash
        || !url.pathname.startsWith(RELEASE_PAGE_PREFIX)
        || url.pathname.length <= RELEASE_PAGE_PREFIX.length) return null
    return url.toString()
  } catch {
    return null
  }
}

function rateLimitRetryAt(headers: Headers, now: Date): string | null {
  const retryAfter = headers.get('retry-after')
  const retryAfterSeconds = retryAfter === null ? Number.NaN : Number(retryAfter)
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return new Date(now.getTime() + retryAfterSeconds * 1000).toISOString()
  }
  const resetSeconds = Number(headers.get('x-ratelimit-reset'))
  if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
    return new Date(resetSeconds * 1000).toISOString()
  }
  return null
}

function validIsoDate(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function boundedSingleLine(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1).trimEnd()}…`
}

function boundedMultiline(value: string, maximum: number): string {
  if (value.length <= maximum) return value
  const candidate = value.slice(0, maximum - 1)
  const boundary = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('\n'))
  return `${candidate.slice(0, boundary > maximum * 0.72 ? boundary : candidate.length).trimEnd()}…`
}

function safeUserAgentVersion(value: string): string {
  return value.replace(/[^0-9A-Za-z.+-]/g, '_').slice(0, 80) || 'unknown'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
