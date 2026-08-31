import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

import {
  CoreClient,
  RovaiRequestError,
  coreProcessHomeDirectory,
  coreStartupRetryDelay,
  coreLaunchArguments,
  desktopSkillLibraryRoot,
  runtimeCampFilesRoot,
  sidecarExecutableName,
  sidecarTargetKey
} from './core-client'
import type { SupervisorSnapshot } from '@contracts'

const temporaryRoots: string[] = []
const originalPlatform = process.platform

function useSupportedPosixHost(): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
}

function nextSnapshot(
  client: CoreClient,
  predicate: (snapshot: SupervisorSnapshot) => boolean,
  timeoutMs = 3_000
): Promise<SupervisorSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error('Timed out waiting for Supervisor snapshot'))
    }, timeoutMs)
    const unsubscribe = client.onSnapshot((snapshot) => {
      if (!predicate(snapshot)) return
      clearTimeout(timer)
      unsubscribe()
      resolve(snapshot)
    })
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
  delete process.env.ROVAI_CORE_BIN
  delete process.env.ROVAI_CORE_TEST_USER_DATA
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('CoreClient planned shutdown', () => {
  it('admits only bounded transient authority retries, independently of the crash budget', () => {
    const busy = { status: 'blocked' as const, authorityState: { kind: 'blocked' as const, reason: { kind: 'busy', stage: 'open' } } }
    expect([0, 1, 2, 3].map(attempt => coreStartupRetryDelay(busy, attempt))).toEqual([250, 750, 1500, null])
    expect(coreStartupRetryDelay({ status: 'failed', error: { code: 'authority_migration_schema_failed', message: 'SQLITE_BUSY', retryable: true, details: { stage: 'database_migration' } } }, 0)).toBe(250)
    expect(coreStartupRetryDelay({ status: 'failed', error: { code: 'authority_recovery_failed', message: 'Requires explicit recovery', retryable: true, details: { stage: 'authority_recovery' } } }, 0)).toBeNull()
    for (const kind of ['unknown_data_contract', 'ambiguous_authority_candidates', 'unsupported_authority_artifact', 'identity_changed', 'corrupt_or_unreadable']) {
      expect(coreStartupRetryDelay({ ...busy, authorityState: { kind: 'blocked', reason: { kind } } }, 0)).toBeNull()
    }
    for (const code of ['authority_contract_changed', 'authority_migration_schema_failed']) {
      expect(coreStartupRetryDelay({ status: 'blocked', error: { code, message: 'deterministic refusal', retryable: false, details: {} } }, 0)).toBeNull()
    }
  })

  it.runIf(process.platform !== 'win32').each([
    { status: 'blocked', authorityState: { kind: 'blocked', reason: { kind: 'busy', stage: 'open' } } },
    { status: 'failed', authorityState: { kind: 'unknown' }, error: { code: 'authority_io_transient', message: 'Interrupted', retryable: true, details: { stage: 'database_admission' } } }
  ])('exhausts startup retries without consuming crash restarts or opening authority (%j)', async refusal => {
    useSupportedPosixHost()
    const root = mkdtempSync(join(tmpdir(), 'rovai-core-startup-retry-'))
    temporaryRoots.push(root)
    const fakeCore = join(root, 'fake-core.sh')
    writeFileSync(fakeCore, `#!/bin/sh
printf '%s\\n' "$*" >> '${join(root, 'launches.txt')}'
printf '%s\\n' '${JSON.stringify({ kind: 'core_startup', schemaVersion: 1, ...refusal })}'
`)
    chmodSync(fakeCore, 0o700)
    process.env.ROVAI_CORE_BIN = fakeCore
    const client = new CoreClient(root)
    const snapshots: SupervisorSnapshot[] = []
    client.onSnapshot(snapshot => snapshots.push(snapshot))
    try {
      const blocked = nextSnapshot(client, snapshot => snapshot.fullCoreState === 'blocked', 6_000)
      client.start()
      expect(await blocked).toMatchObject({ generation: 4, restartAttempt: 0, capabilities: { authoritativeWorkspace: false, coreRequests: false } })
      expect(snapshots.every(snapshot => snapshot.restartAttempt === 0 && !snapshot.capabilities.authoritativeWorkspace)).toBe(true)
      expect(snapshots.filter(snapshot => snapshot.fullCoreState === 'blocked')).toHaveLength(1)
      expect(readFileSync(join(root, 'launches.txt'), 'utf8').trim().split('\n').map(args => args.includes('--require-existing-authority'))).toEqual([false, true, true, true])
      // Explicit retry gets a fresh startup budget, even before refusal exit.
      const restarting = nextSnapshot(client, snapshot => snapshot.generation === 5 && snapshot.fullCoreState === 'starting')
      client.retryFullCore()
      await restarting
    } finally { client.stop() }
  })
  it.runIf(process.platform !== 'win32').each([
    ['admitted', true], ['migration_required', true], ['confirmed_absent', false]
  ] as const)('retains the %s assessment across a later preparation failure', async (kind, requiresExisting) => {
    useSupportedPosixHost()
    const root = mkdtempSync(join(tmpdir(), 'rovai-core-preparation-fence-'))
    temporaryRoots.push(root)
    const fakeCore = join(root, 'fake-core.sh')
    writeFileSync(fakeCore, `#!/bin/sh
printf '%s\\n' "$*" >> '${join(root, 'launches.txt')}'
printf '%s\\n' '{"kind":"core_startup","schemaVersion":1,"status":"phase","phase":"preparing_runtime_storage","authorityState":{"kind":"${kind}"}}'
printf '%s\\n' '{"kind":"core_startup","schemaVersion":1,"status":"failed","phase":"preparing_runtime_storage","authorityState":{"kind":"${kind}"},"error":{"code":"runtime_camp_files_root_admission_failed","message":"fixture refusal","retryable":false,"details":{"stage":"runtime_storage"}}}'
`)
    chmodSync(fakeCore, 0o700)
    process.env.ROVAI_CORE_BIN = fakeCore
    const client = new CoreClient(root)
    try {
      const first = nextSnapshot(client, snapshot => snapshot.fullCoreState === 'blocked')
      client.start()
      await first
      const second = nextSnapshot(client, snapshot => snapshot.generation === 2 && snapshot.fullCoreState === 'blocked')
      client.retryFullCore()
      await second
      expect(readFileSync(join(root, 'launches.txt'), 'utf8').trim().split('\n').map(args => args.includes('--require-existing-authority'))).toEqual([false, requiresExisting])
    } finally { client.stop() }
  })

  it('keeps an unadmitted Windows root blocked without inventing a Core path or consuming a generation', async () => {
    const client = new CoreClient(null)
    client.blockStartup({
      code: 'windows_data_root_preparation_failed', message: 'private ACL unavailable', retryable: true, details: {}
    }, 'preparing_windows_data_root')
    client.start()
    client.retryFullCore()
    expect(client.getSnapshot()).toMatchObject({
      generation: 0, restartAttempt: 0, runtimeMode: 'bootstrap_only', fullCoreState: 'blocked',
      startupPhase: 'preparing_windows_data_root',
      capabilities: { authoritativeWorkspace: false, coreRequests: false, fullCoreRetry: true },
      lastError: { code: 'windows_data_root_preparation_failed' }
    })
    await expect(client.request('members.list')).rejects.toMatchObject({ kind: 'full_core_unavailable' })
    await client.shutdown()
  })

  it('uses one closed target key and the native executable suffix', () => {
    expect(sidecarTargetKey('darwin', 'arm64')).toBe('macos-arm64')
    expect(sidecarTargetKey('darwin', 'x64')).toBe('macos-x64')
    expect(sidecarTargetKey('win32', 'x64')).toBe('windows-x64')
    expect(() => sidecarTargetKey('win32', 'arm64')).toThrow('Unsupported Rovai sidecar host')
    expect(sidecarExecutableName('rovai-core', 'darwin')).toBe('rovai-core')
    expect(sidecarExecutableName('rovai-core', 'win32')).toBe('rovai-core.exe')
  })

  it('passes an isolated Skill Library root to Core', () => {
    expect(coreLaunchArguments('/isolated/data', '/isolated/views', '/isolated/skills', [], '/isolated/mcp.json'))
      .toContain('--mcp-config-path')
    expect(coreLaunchArguments('/isolated/data', '/isolated/views', '/isolated/skills', [], '/isolated/mcp.json'))
      .toContain('/isolated/mcp.json')
    expect(coreProcessHomeDirectory('/Users/system', '/tmp/isolated-home', 'darwin')).toBe(
      '/tmp/isolated-home'
    )
    expect(coreProcessHomeDirectory('/Users/system', '', 'darwin')).toBe('/Users/system')
    expect(coreProcessHomeDirectory('C:\\Users\\system', 'C:\\Temp\\home', 'win32')).toBe(
      'C:\\Users\\system'
    )
    expect(desktopSkillLibraryRoot('/tmp/rovai-accept/user-data', true)).toBe(
      join('/tmp/rovai-accept/user-data', 'managed-skill-library')
    )
    expect(desktopSkillLibraryRoot('/daily/user-data', false, 'darwin')).toBeNull()
    expect(desktopSkillLibraryRoot('C:\\Rovai AI\\Core', false, 'win32')).toBe(
      'C:\\Rovai AI\\Core\\managed-skill-library'
    )
    expect(coreLaunchArguments(
      '/tmp/rovai-accept/user-data',
      '/tmp/rovai-accept/runtime-files',
      '/tmp/rovai-accept/user-data/managed-skill-library',
      ['/tmp/removed-project']
    )).toEqual([
      '--data-dir',
      '/tmp/rovai-accept/user-data',
      '--runtime-camp-files-root',
      '/tmp/rovai-accept/runtime-files',
      '--skill-library-root',
      '/tmp/rovai-accept/user-data/managed-skill-library',
      '--removed-skill-project-root',
      '/tmp/removed-project'
    ])
    expect(coreLaunchArguments('/daily/user-data', '/daily/runtime-files', null, [])).toEqual([
      '--data-dir',
      '/daily/user-data',
      '--runtime-camp-files-root',
      '/daily/runtime-files',
      '--use-default-skill-library'
    ])
    expect(runtimeCampFilesRoot(
      'C:\\Rovai AI\\Core',
      'C:\\Users\\test',
      'win32'
    )).toBe('C:\\Rovai AI\\Core\\runtime-files')
    const macRoot = runtimeCampFilesRoot(
      '/tmp/rovai-accept/user-data',
      '/tmp/rovai-home',
      'darwin'
    )
    expect(macRoot).toMatch(
      /^\/tmp\/rovai-home\/\.rovai\/instances\/v1-[0-9a-f]{64}\/runtime-files$/
    )
  })

  it.runIf(process.platform !== 'win32')(
    'reuses one Promise, keeps shutdown Main-only, and waits for the child exit',
    async () => {
      useSupportedPosixHost()
      const root = mkdtempSync(join(tmpdir(), 'rovai-core-client-shutdown-'))
      temporaryRoots.push(root)
      const fakeCore = join(root, 'fake-core.sh')
      writeFileSync(fakeCore, `#!/bin/sh
while IFS= read -r request; do
  case "$request" in
    *'"method":"core.shutdown"'*)
      printf '%s\\n' '{"id":1,"result":{"protocolVersion":3,"status":"completed","deadlineExpired":true,"activeExecutionsObserved":1,"stopRequestsIssued":1,"terminalExecutionsSettled":0,"cancelledAgentRunsSettled":1,"unsettledEffectAgentRuns":1,"controlledShutdownCyclePersisted":true,"unresolvedExecutions":0}}'
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
          protocolVersion: 3,
          status: 'completed',
          deadlineExpired: true,
          activeExecutionsObserved: 1,
          stopRequestsIssued: 1,
          terminalExecutionsSettled: 0,
          cancelledAgentRunsSettled: 1,
          unsettledEffectAgentRuns: 1,
          controlledShutdownCyclePersisted: true,
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
      useSupportedPosixHost()
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
      useSupportedPosixHost()
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
      printf '%s\n' '{"kind":"core_startup","schemaVersion":1,"status":"ready","authorityState":{"kind":"current"}}'
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

describe('CoreClient Supervisor protocol', () => {
  it.runIf(process.platform !== 'win32')(
    'publishes complete monotonic snapshots and enables authority only after ready',
    async () => {
      useSupportedPosixHost()
      const root = mkdtempSync(join(tmpdir(), 'rovai-core-client-supervisor-'))
      temporaryRoots.push(root)
      const fakeCore = join(root, 'fake-core.sh')
      writeFileSync(fakeCore, `#!/bin/sh
printf '%s\n' '{"kind":"core_startup","schemaVersion":1,"status":"phase","phase":"assessing_authority","authorityState":{"kind":"assessing"}}'
printf '%s\n' '{"kind":"core_startup","schemaVersion":1,"status":"ready","authorityState":{"kind":"current","origin":"existing"}}'
while IFS= read -r request; do :; done
`)
      chmodSync(fakeCore, 0o700)
      process.env.ROVAI_CORE_BIN = fakeCore
      process.env.ROVAI_CORE_TEST_USER_DATA = root

      const client = new CoreClient()
      const snapshots: SupervisorSnapshot[] = []
      client.onSnapshot((snapshot) => snapshots.push(snapshot))
      const ready = nextSnapshot(client, (snapshot) => snapshot.fullCoreState === 'ready')
      client.start()

      await expect(ready).resolves.toMatchObject({
        generation: 1,
        runtimeMode: 'full_core',
        authorityState: { kind: 'current', origin: 'existing' },
        capabilities: { authoritativeWorkspace: true, coreRequests: true }
      })
      expect(snapshots.some((snapshot) => (
        snapshot.fullCoreState === 'starting'
        && snapshot.capabilities.authoritativeWorkspace === false
      ))).toBe(true)
      expect(snapshots.map((snapshot) => snapshot.revision)).toEqual(
        [...snapshots.map((snapshot) => snapshot.revision)].sort((left, right) => left - right)
      )
      expect(new Set(snapshots.map((snapshot) => snapshot.revision)).size).toBe(snapshots.length)
      client.stop()
    }
  )

  it.runIf(process.platform !== 'win32')(
    'preserves domain rejection details across the Core boundary',
    async () => {
      useSupportedPosixHost()
      const root = mkdtempSync(join(tmpdir(), 'rovai-core-client-domain-error-'))
      temporaryRoots.push(root)
      const fakeCore = join(root, 'fake-core.sh')
      writeFileSync(fakeCore, `#!/bin/sh
printf '%s\n' '{"kind":"core_startup","schemaVersion":1,"status":"ready","authorityState":{"kind":"current"}}'
while IFS= read -r request; do
  printf '%s\n' '{"id":1,"error":{"kind":"domain_rejection","code":"camp_not_open","message":"Camp must be opened first","retryable":false,"details":{"campId":"camp-1"}}}'
done
`)
      chmodSync(fakeCore, 0o700)
      process.env.ROVAI_CORE_BIN = fakeCore
      process.env.ROVAI_CORE_TEST_USER_DATA = root

      const client = new CoreClient()
      const ready = nextSnapshot(client, (snapshot) => snapshot.fullCoreState === 'ready')
      client.start()
      await ready

      const failure = await client.request('health.check').catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(RovaiRequestError)
      expect(failure).toMatchObject({
        kind: 'domain_rejection',
        code: 'camp_not_open',
        retryable: false,
        generation: 1,
        details: { campId: 'camp-1' }
      })
      client.stop()
    }
  )

  it.runIf(process.platform !== 'win32')(
    'keeps authority ready with optional subsystem failures and clears them when Core stops',
    async () => {
      useSupportedPosixHost()
      const root = mkdtempSync(join(tmpdir(), 'rovai-core-subsystems-'))
      temporaryRoots.push(root)
      const fakeCore = join(root, 'fake-core.sh')
      writeFileSync(fakeCore, `#!/bin/sh
printf '%s\\n' '{"kind":"core_startup","schemaVersion":1,"status":"ready","subsystems":[{"id":"skills","state":"initializing","error":null}]}'
while IFS= read -r request; do
  printf '%s\\n' '{"method":"runtime.subsystemsChanged","params":[{"id":"skills","state":"degraded","error":{"code":"subsystem_initialization_failed","message":"staging unavailable","retryable":true,"details":{"subsystem":"skills"}}}]}'
  printf '%s\\n' '{"id":1,"result":[]}'
done
`)
      chmodSync(fakeCore, 0o700)
      process.env.ROVAI_CORE_BIN = fakeCore
      process.env.ROVAI_CORE_TEST_USER_DATA = root
      const client = new CoreClient()
      try {
        const ready = nextSnapshot(client, (snapshot) => snapshot.fullCoreState === 'ready')
        client.start()
        expect(await ready).toMatchObject({ coreSubsystems: [{ id: 'skills', state: 'initializing' }] })
        const degraded = nextSnapshot(client, (snapshot) => snapshot.coreSubsystems?.[0]?.state === 'degraded')
        await client.request('members.list')
        expect(await degraded).toMatchObject({
          fullCoreState: 'ready',
          restartAttempt: 0,
          capabilities: { authoritativeWorkspace: true, coreRequests: true },
          coreSubsystems: [{ id: 'skills', state: 'degraded', error: { retryable: true } }]
        })
      } finally { client.stop() }
      expect(client.getSnapshot().coreSubsystems).toEqual([])
    }
  )

  it.runIf(process.platform !== 'win32')(
    'does not spend the crash budget on deterministic authority refusal',
    async () => {
      useSupportedPosixHost()
      const root = mkdtempSync(join(tmpdir(), 'rovai-core-client-blocked-'))
      temporaryRoots.push(root)
      const fakeCore = join(root, 'fake-core.sh')
      writeFileSync(fakeCore, `#!/bin/sh
printf '%s\n' '{"kind":"core_startup","schemaVersion":1,"status":"blocked","phase":"lease","authorityState":{"kind":"owned_by_active_core","dataDir":"/tmp/authority","owner":{"pid":42}}}'
sleep 0.2
`)
      chmodSync(fakeCore, 0o700)
      process.env.ROVAI_CORE_BIN = fakeCore
      process.env.ROVAI_CORE_TEST_USER_DATA = root

      const client = new CoreClient()
      const blocked = nextSnapshot(client, (snapshot) => snapshot.fullCoreState === 'blocked')
      client.start()
      await blocked
      const retried = nextSnapshot(
        client,
        (snapshot) => snapshot.generation === 2 && snapshot.fullCoreState === 'blocked'
      )
      client.retryFullCore()
      await retried

      expect(client.getSnapshot()).toMatchObject({
        generation: 2,
        fullCoreState: 'blocked',
        restartAttempt: 0,
        capabilities: { authoritativeWorkspace: false, coreRequests: false },
        authorityState: { kind: 'owned_by_active_core' }
      })
      await expect(client.request('health.check')).rejects.toMatchObject({
        kind: 'full_core_unavailable',
        code: 'full_core_unavailable',
        generation: 2
      })
      client.stop()
    }
  )
})
