import { describe, expect, it, vi } from 'vitest'
import {
  AppUpdatesService,
  compareVersions,
  parseVersion,
  summarizeReleaseNotes
} from './app-updates'

const RELEASE_URL = 'https://github.com/murray17/rovai-ai/releases/tag/v1.3.0'
const NOW = new Date('2026-08-23T08:00:00.000Z')

function release(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'v1.3.0',
    name: 'Rovai AI 1.3.0',
    body: '## 新功能\n- 增加关于与更新页面\n- 改善启动体验',
    html_url: RELEASE_URL,
    published_at: '2026-08-22T09:30:00Z',
    draft: false,
    prerelease: false,
    ...overrides
  }
}

describe('app update version comparison', () => {
  it('compares normalized stable and prerelease versions', () => {
    expect(parseVersion('v1.2')).toMatchObject({ normalized: '1.2.0', core: [1, 2, 0] })
    expect(compareVersions(parseVersion('1.2.1')!, parseVersion('1.2.0')!)).toBeGreaterThan(0)
    expect(compareVersions(parseVersion('1.2.0')!, parseVersion('1.2.0-rc.2')!)).toBeGreaterThan(0)
    expect(compareVersions(parseVersion('1.2.0-rc.10')!, parseVersion('1.2.0-rc.2')!)).toBeGreaterThan(0)
    expect(parseVersion('1.2.3.4')).toBeNull()
  })

  it('turns markdown release notes into a bounded plain-text summary', () => {
    expect(summarizeReleaseNotes(
      '## 更新内容\n- [查看详情](https://example.com)\n![截图](https://example.com/a.png)\n```sh\nrm -rf /\n```'
    )).toBe('更新内容\n查看详情\n截图')
    expect(summarizeReleaseNotes(' '.repeat(20))).toBeNull()
  })
})

describe('AppUpdatesService', () => {
  it('starts idle and checks the unauthenticated official latest-release endpoint only on demand', async () => {
    const openExternal = vi.fn(async () => undefined)
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('accept')).toBe('application/vnd.github+json')
      expect(headers.get('x-github-api-version')).toBe('2026-03-10')
      expect(headers.get('user-agent')).toBe('Rovai-AI/1.2.0')
      expect(headers.has('authorization')).toBe(false)
      return new Response(JSON.stringify(release()), {
        status: 200,
        headers: { etag: '"release-v1.3.0"' }
      })
    })
    const service = new AppUpdatesService({
      currentVersion: () => '1.2.0',
      fetchImpl,
      openExternal,
      now: () => NOW
    })

    expect(service.get()).toMatchObject({ status: 'idle', currentVersion: '1.2.0' })
    expect(fetchImpl).not.toHaveBeenCalled()

    await expect(service.check()).resolves.toEqual({
      currentVersion: '1.2.0',
      status: 'update_available',
      latestVersion: '1.3.0',
      releaseName: 'Rovai AI 1.3.0',
      releaseNotesSummary: '新功能\n增加关于与更新页面\n改善启动体验',
      publishedAt: '2026-08-22T09:30:00.000Z',
      releasePageAvailable: true,
      checkedAt: NOW.toISOString(),
      failureReason: null,
      retryAt: null
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/murray17/rovai-ai/releases/latest',
      expect.objectContaining({ method: 'GET' })
    )
    await expect(service.openReleasePage()).resolves.toBe(true)
    expect(openExternal).toHaveBeenCalledWith(RELEASE_URL)
  })

  it('reports up-to-date, no-release, and rate-limit outcomes without retrying', async () => {
    const upToDate = new AppUpdatesService({
      currentVersion: () => '1.3.0',
      fetchImpl: async () => new Response(JSON.stringify(release()), { status: 200 }),
      openExternal: async () => undefined,
      now: () => NOW
    })
    await expect(upToDate.check()).resolves.toMatchObject({ status: 'up_to_date' })

    const noReleaseFetch = vi.fn(async () => new Response('', { status: 404 }))
    const noRelease = new AppUpdatesService({
      currentVersion: () => '1.2.0',
      fetchImpl: noReleaseFetch,
      openExternal: async () => undefined,
      now: () => NOW
    })
    await expect(noRelease.check()).resolves.toMatchObject({
      status: 'no_release',
      releasePageAvailable: false
    })
    expect(noReleaseFetch).toHaveBeenCalledTimes(1)

    const rateLimitedFetch = vi.fn(async () => new Response('', {
      status: 429,
      headers: { 'retry-after': '90' }
    }))
    const rateLimited = new AppUpdatesService({
      currentVersion: () => '1.2.0',
      fetchImpl: rateLimitedFetch,
      openExternal: async () => undefined,
      now: () => NOW
    })
    await expect(rateLimited.check()).resolves.toMatchObject({
      status: 'check_failed',
      failureReason: 'rate_limited',
      retryAt: '2026-08-23T08:01:30.000Z'
    })
    expect(rateLimitedFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects untrusted release pages and never opens them', async () => {
    const openExternal = vi.fn(async () => undefined)
    const service = new AppUpdatesService({
      currentVersion: () => '1.2.0',
      fetchImpl: async () => new Response(JSON.stringify(release({
        html_url: 'https://example.com/murray17/rovai-ai/releases/tag/v1.3.0'
      })), { status: 200 }),
      openExternal,
      now: () => NOW
    })

    await expect(service.check()).resolves.toMatchObject({
      status: 'check_failed',
      failureReason: 'invalid_release',
      releasePageAvailable: false
    })
    await expect(service.openReleasePage()).resolves.toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('coalesces simultaneous manual checks into one GitHub request', async () => {
    let resolveResponse!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { resolveResponse = resolve })
    const fetchImpl = vi.fn(() => pending)
    const service = new AppUpdatesService({
      currentVersion: () => '1.2.0',
      fetchImpl,
      openExternal: async () => undefined,
      now: () => NOW
    })

    const first = service.check()
    const second = service.check()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    resolveResponse(new Response(JSON.stringify(release()), { status: 200 }))
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
