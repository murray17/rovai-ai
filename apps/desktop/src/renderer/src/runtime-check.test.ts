import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeRefresh, openRuntimeModelCatalog, requestProductRuntimeCheck, runtimeCheckFeedback } from './runtime-check'
import type { ProductRuntimeAvailability } from '@contracts'

describe('Runtime check feedback ownership', () => {
  it.each(['runtime_version_failed', 'runtime_version_empty', 'runtime_version_output_truncated'])(
    'supersedes only a read failure after success and keeps newer request errors visible: %s', code => {
      const availability = {
        failure: { runtimeKind: 'codex-cli', origin: 'environment', phase: 'spawn', code,
          summary: '旧版本读取失败', detail: '旧原因', retryable: true },
        discovery: { versionProbeSucceeded: false }
      } as ProductRuntimeAvailability
      expect(runtimeCheckFeedback(availability).message).toBe('旧版本读取失败\n旧原因')
      expect(runtimeCheckFeedback(availability, { kind: 'check_failed', message: '完整检查未通过' }).message).toBe('旧版本读取失败\n旧原因')
      for (const message of ['本次请求异常', '检查未完成，程序或启动设置已变化，请重新检查。']) {
        expect(runtimeCheckFeedback(availability, { kind: 'request_error', message }).message).toBe(message)
      }
      availability.discovery.versionProbeSucceeded = true
      expect(runtimeCheckFeedback(availability).message).toBeUndefined()
      expect(runtimeCheckFeedback(availability, { kind: 'request_error', message: '本次请求异常' }).message).toBe('本次请求异常')
      expect(runtimeCheckFeedback(availability, { kind: 'check_failed', message: '旧完整检查未通过' }).message).toBeUndefined()
      availability.failure!.code = 'runtime_version_below_minimum'
      expect(runtimeCheckFeedback(availability).versionFailure).toBeNull()
      expect(runtimeCheckFeedback(availability, { kind: 'check_failed', message: '完整检查未通过' }).message).toBe('完整检查未通过')
    }
  )
})

describe('explicit Runtime check targeting', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('checks only the Qwen Runtime selected by the user', async () => {
    const request = vi.fn().mockResolvedValue({
      scheduled: true,
      completed: true,
      ready: true,
      runtimeKind: 'qwen-code'
    })
    vi.stubGlobal('window', { rovai: { request } })

    await requestProductRuntimeCheck('qwen-code')

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('runtime.product.check', {
      runtimeKind: 'qwen-code'
    })
  })

  it('opens only the selected Runtime model catalog', async () => {
    const request = vi.fn().mockResolvedValue({
      runtimeKind: 'copilot-cli',
      cache: {
        status: 'fresh',
        observedAt: '2026-08-18T00:00:00Z',
        revalidateAfter: '2026-08-18T00:01:00Z',
        expiresAt: '2026-08-19T00:00:00Z'
      },
      models: [],
      refreshStatus: 'not_required',
      diagnosticCode: null
    })
    vi.stubGlobal('window', { rovai: { request } })

    await openRuntimeModelCatalog('copilot-cli')

    expect(request).toHaveBeenCalledWith('runtime.modelCatalog.open', {
      runtimeKind: 'copilot-cli'
    })
  })

  it('waits for the backend-owned check and preserves its failure outcome without a separate rescan', async () => {
    let finishCheck!: (result: unknown) => void
    const completion = new Promise(resolve => { finishCheck = resolve })
    const request = vi.fn().mockReturnValueOnce(completion)
    vi.stubGlobal('window', { rovai: { request } })

    const check = requestProductRuntimeCheck('codex-cli')
    expect(request).toHaveBeenCalledExactlyOnceWith('runtime.product.check', { runtimeKind: 'codex-cli' })
    finishCheck({ ready: false, outcome: 'stable_failure' })
    await expect(check).resolves.toEqual({ ready: false, outcome: 'stable_failure' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not hide a backend environment-read failure or retry with cached discovery', async () => {
    const request = vi.fn().mockRejectedValue(new Error('discovery failed'))
    vi.stubGlobal('window', { rovai: { request } })
    await expect(requestProductRuntimeCheck('codex-cli')).rejects.toThrow('discovery failed')
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('Runtime snapshot refresh', () => {
  it('refreshes a shared installation list started before check completion before resolving the Runtime refresh', async () => {
    const releases: Array<() => void> = []
    let source = 'old installation'
    let displayedList: string[] = []
    let displayedStatus = ''
    const request = vi.fn(async (method: string) => {
      if (method === 'runtime.product.check') return { ready: true, outcome: 'ready' }
      if (method === 'runtime.status.get') return source
      if (method === 'runtime.installations.list') {
        const snapshot = [source]
        await new Promise<void>(resolve => releases.push(resolve))
        return snapshot
      }
      throw new Error(`Unexpected non-Runtime read: ${method}`)
    })
    // The shared list and enclosing Runtime read use the same production refresh
    // function as BusinessApp; an earlier Overview/member reader shares the list.
    const loadInstallations = createRuntimeRefresh(async () => {
      displayedList = await request('runtime.installations.list') as string[]
      return displayedList
    })
    const loadRuntime = createRuntimeRefresh(async () => {
      const results = await Promise.allSettled([request('runtime.status.get'), loadInstallations()])
      if (results[0].status === 'fulfilled') displayedStatus = results[0].value as string
      const failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    })
    const earlierList = loadInstallations()
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    source = 'new installation'
    await request('runtime.product.check')
    const completion = loadRuntime()
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('runtime.status.get'))
    releases.shift()!()
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    expect(request.mock.calls.filter(([method]) => method === 'runtime.installations.list')).toHaveLength(2)
    releases.shift()!()
    await completion
    expect(displayedStatus).toBe('new installation')
    expect(displayedList).toEqual(['new installation'])
    await expect(earlierList).resolves.toEqual(displayedList)
  })

  it('coalesces requests and reads the final state after events during both the first and trailing reads', async () => {
    const pending: Array<() => void> = []
    let source = 0
    let displayed = -1
    const read = vi.fn(() => {
      const snapshot = source
      return new Promise<void>(resolve => pending.push(() => { displayed = snapshot; resolve() }))
    })
    const refresh = createRuntimeRefresh(read)
    const completion = refresh()
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(1)
    source = 1
    expect(refresh()).toBe(completion)
    expect(refresh()).toBe(completion)
    pending.shift()!()
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(2)
    source = 2
    expect(refresh()).toBe(completion)
    pending.shift()!()
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(3)
    pending.shift()!()
    await completion
    expect(displayed).toBe(2)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('keeps invalidations after a failed read and permits retry after a terminal error', async () => {
    let reject!: (error: Error) => void
    const read = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail }))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    const refresh = createRuntimeRefresh(read)
    const completion = refresh()
    await Promise.resolve()
    refresh()
    reject(new Error('obsolete read'))
    await expect(completion).resolves.toBeUndefined()
    expect(read).toHaveBeenCalledTimes(2)
    await expect(refresh()).rejects.toThrow('offline')
    await expect(refresh()).resolves.toBeUndefined()
    expect(read).toHaveBeenCalledTimes(4)
  })
})
