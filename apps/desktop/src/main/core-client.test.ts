import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => process.env.ROVAI_CORE_TEST_USER_DATA ?? tmpdir(),
    getAppPath: () => process.cwd()
  }
}))

import { CoreClient } from './core-client'

const temporaryRoots: string[] = []

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete process.env.ROVAI_CORE_BIN
  delete process.env.ROVAI_CORE_TEST_USER_DATA
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('CoreClient planned shutdown', () => {
  it.runIf(process.platform !== 'win32')(
    'reuses one Promise, keeps shutdown Main-only, and waits for the child exit',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'rovai-core-client-shutdown-'))
      temporaryRoots.push(root)
      const fakeCore = join(root, 'fake-core.sh')
      writeFileSync(fakeCore, `#!/bin/sh
while IFS= read -r request; do
  case "$request" in
    *'"method":"core.shutdown"'*)
      printf '%s\\n' '{"id":1,"result":{"protocolVersion":1,"status":"completed","deadlineExpired":false,"activeExecutionsObserved":1,"stopRequestsIssued":1,"terminalExecutionsSettled":1,"unresolvedExecutions":0}}'
      sleep 0.05
      exit 0
      ;;
  esac
done
`)
      chmodSync(fakeCore, 0o700)
      process.env.ROVAI_CORE_BIN = fakeCore
      process.env.ROVAI_CORE_TEST_USER_DATA = root

      const events: unknown[] = []
      const client = new CoreClient()
      client.onEvent((event) => events.push(event))
      client.start()

      const first = client.shutdown()
      const second = client.shutdown()
      expect(second).toBe(first)
      await expect(first).resolves.toEqual({
        report: {
          protocolVersion: 1,
          status: 'completed',
          deadlineExpired: false,
          activeExecutionsObserved: 1,
          stopRequestsIssued: 1,
          terminalExecutionsSettled: 1,
          unresolvedExecutions: 0
        },
        forcedSignal: null
      })
      expect(events).toContainEqual({
        method: 'runtime.state',
        params: { status: 'shutting_down' }
      })
      expect(events).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          method: 'runtime.state',
          params: expect.objectContaining({ status: 'restarting' })
        })
      ]))
      await expect(client.request('health.check')).rejects.toThrow('shutting down')
    }
  )

  it.runIf(process.platform !== 'win32')(
    'uses SIGTERM only after the Core deadline and outer grace expire',
    async () => {
      vi.useFakeTimers()
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const root = mkdtempSync(join(tmpdir(), 'rovai-core-client-sigterm-'))
      temporaryRoots.push(root)
      const fakeCore = join(root, 'fake-core.sh')
      writeFileSync(fakeCore, `#!/bin/sh
while IFS= read -r request; do
  case "$request" in
    *'"method":"core.shutdown"'*)
      while IFS= read -r ignored; do :; done
      ;;
  esac
done
`)
      chmodSync(fakeCore, 0o700)
      process.env.ROVAI_CORE_BIN = fakeCore
      process.env.ROVAI_CORE_TEST_USER_DATA = root

      const client = new CoreClient()
      client.start()
      const shutdown = client.shutdown()

      await vi.advanceTimersByTimeAsync(12_999)
      let settled = false
      void shutdown.finally(() => {
        settled = true
      })
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await expect(shutdown).resolves.toEqual({ report: null, forcedSignal: 'SIGTERM' })
    }
  )

  it.runIf(process.platform !== 'win32')(
    'escalates to SIGKILL when the child ignores SIGTERM',
    async () => {
      vi.useFakeTimers()
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const root = mkdtempSync(join(tmpdir(), 'rovai-core-client-sigkill-'))
      temporaryRoots.push(root)
      const fakeCore = join(root, 'fake-core.sh')
      writeFileSync(fakeCore, `#!/bin/sh
while IFS= read -r request; do
  case "$request" in
    *'"method":"core.shutdown"'*)
      trap '' TERM
      printf '%s\n' 'rovai-core shutdown test ready' >&2
      while IFS= read -r ignored; do :; done
      ;;
  esac
done
`)
      chmodSync(fakeCore, 0o700)
      process.env.ROVAI_CORE_BIN = fakeCore
      process.env.ROVAI_CORE_TEST_USER_DATA = root

      const client = new CoreClient()
      const armed = new Promise<void>((resolve) => {
        client.onEvent((event) => {
          if (event.method === 'runtime.state'
            && JSON.stringify(event.params).includes('"status":"ready"')) resolve()
        })
      })
      client.start()
      const shutdown = client.shutdown()

      await armed
      await vi.advanceTimersByTimeAsync(13_000)
      await vi.advanceTimersByTimeAsync(2_000)
      await expect(shutdown).resolves.toEqual({ report: null, forcedSignal: 'SIGKILL' })
    }
  )
})
