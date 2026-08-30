import type { DesktopStartupSnapshot, OnboardingSnapshot, RestorableLocation, RovaiApi, SupervisorSnapshot } from '@contracts'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { App } from '../../../apps/desktop/src/renderer/src/App'
import '../../../apps/desktop/src/renderer/src/styles.css'

const campId = 'rvcamp_01h47kvsy5fk1shh6w1g60eec0'
const errors: string[] = []
window.addEventListener('error', event => errors.push(String(event.error?.stack ?? event.message)))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
const calls: string[] = []
const listeners = new Set<(snapshot: SupervisorSnapshot) => void>()
let now = 0
let nextTimer = 0
const timers = new Map<number, { at: number; callback: () => void }>()
Object.defineProperty(performance, 'now', { value: () => now })
window.setTimeout = ((callback: () => void, delay = 0) => {
  const id = ++nextTimer
  timers.set(id, { at: now + delay, callback })
  return id
}) as typeof window.setTimeout
window.clearTimeout = id => { timers.delete(id) }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse })
  return { promise, resolve, reject }
}
let localSession = deferred<DesktopStartupSnapshot>()
let initialSupervisor = deferred<SupervisorSnapshot>()
let onboarding = deferred<OnboardingSnapshot>()
let root: Root | null = null
let supervisor: SupervisorSnapshot

function starting(): SupervisorSnapshot {
  return {
    schemaVersion: 1, revision: 1, generation: 1, runtimeMode: 'bootstrap_only', fullCoreState: 'starting',
    authorityState: { kind: 'assessing' }, startupPhase: 'assessing_authority', restartAttempt: 0,
    capabilities: { authoritativeWorkspace: false, coreRequests: false, localPreferences: true,
      supervisorStatus: true, diagnosticsExport: true, fullCoreRetry: false },
    localDegradations: [], coreSubsystems: [], lastError: null, migrationProgress: null
  }
}

function session(target: RestorableLocation): DesktopStartupSnapshot {
  return { schemaVersion: 1, sessionId: 'main-window-1', startupLocationMode: 'last_location',
    lastSettingsSection: 'general', restorableLocationStatus: 'valid', restorableLocation: target }
}

// Unknown query methods remain pending, never return fabricated business empties.
// Subscriptions are inert; every authority read/mutation is recorded and checked.
function api(path = ''): unknown {
  return new Proxy(() => undefined, {
    get(_target, key) {
      if (path === '' && key === 'platform') return 'darwin'
      return api(path ? `${path}.${String(key)}` : String(key))
    },
    apply(_target, _this, args) {
      if (path === 'supervisor.onChanged') {
        listeners.add(args[0])
        return () => listeners.delete(args[0])
      }
      if (path.split('.').at(-1)?.startsWith('on')) return () => undefined
      if (path === 'supervisor.getSnapshot') return initialSupervisor.promise
      if (path === 'desktopSession.getStartupSnapshot') { calls.push(path); return localSession.promise }
      if (path === 'appearance.get') return Promise.resolve({ preference: 'system', resolvedTheme: 'day' })
      if (path === 'generalPreferences.get') return Promise.resolve({ schemaVersion: 4,
        startupLocationMode: 'last_location', lastSettingsSection: 'general', executionConsolePlacement: 'bottom',
        newConversationDefaults: null, newConversationDefaultsRequireConfirmation: false,
        oneClickNewConversationEnabled: false, worldMapEnabled: true })
      calls.push(path === 'request' ? args[0] : path)
      if (path === 'onboarding.get') return onboarding.promise
      return new Promise(() => undefined)
    }
  })
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
async function flush() { await frames(); check(errors.length === 0, errors.join('\n')) }

async function advance(milliseconds: number) {
  const end = now + milliseconds
  while (true) {
    const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
    if (!next) break
    now = next[1].at
    timers.delete(next[0])
    flushSync(next[1].callback)
  }
  now = end
  await flush()
}

async function reset(target: RestorableLocation | null = { kind: 'camp', campId }, resolveSupervisor = true) {
  if (root) flushSync(() => root!.unmount())
  timers.clear()
  listeners.clear()
  calls.length = 0
  errors.length = 0
  now = 0
  supervisor = starting()
  localSession = deferred()
  initialSupervisor = deferred()
  onboarding = deferred()
  Object.assign(window, { rovai: api() as RovaiApi })
  if (target) localSession.resolve(session(target))
  if (resolveSupervisor) initialSupervisor.resolve(supervisor)
  root = createRoot(document.getElementById('root')!)
  flushSync(() => root!.render(<App />))
  await flush()
}

function publish(next: Partial<SupervisorSnapshot>) {
  supervisor = { ...supervisor, ...next, revision: supervisor.revision + 1 }
  listeners.forEach(listener => listener(supervisor))
}

function pageFrame(kind: string, feedback: boolean) {
  check(document.querySelector('.unified-sidebar'), 'Startup must preserve the ordinary navigation rail')
  check(!document.querySelector('.bootstrap-shell, .onboarding-app-shell'), 'Ordinary startup must not use a full-screen gate')
  check(document.querySelector(`[data-startup-frame="${kind}"]`), `Expected the ${kind} target frame`)
  check(Boolean(document.querySelector('.startup-route-loading')) === feedback, `Feedback visibility at ${now}ms is incorrect`)
  check(!document.querySelector('.sidebar-empty'), 'Unknown navigation is not an empty workspace')
  check(document.documentElement.scrollWidth <= window.innerWidth, 'Startup must not overflow horizontally')
}

function noAuthority() {
  check(calls.every(call => call === 'desktopSession.getStartupSnapshot'), `Pre-ready authority calls: ${calls.join(', ')}`)
}

Object.assign(window, { startupTest: {
  async run() {
    const cases: string[] = []
    await reset(null, false)
    pageFrame('location', false)
    noAuthority()
    cases.push('null initial snapshots retain ordinary chrome')

    for (const target of [{ kind: 'camp', campId }, { kind: 'members', agentId: null, tab: 'identity' },
      { kind: 'memory' }, { kind: 'quick_chat' }] as RestorableLocation[]) {
      await reset(target)
      await advance(399)
      pageFrame(target.kind, false)
      await advance(1)
      pageFrame(target.kind, true)
      noAuthority()
      cases.push(`${target.kind}: 399ms silent, 400ms local feedback`)
    }

    await reset()
    publish({ startupPhase: 'migrating_authority' })
    await advance(399)
    pageFrame('camp', false)
    await advance(1)
    pageFrame('camp', true)
    check(document.querySelector('main')?.textContent?.includes('升级本地数据'), 'Migration status stays inside the target page')
    noAuthority()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
    await flush()
    check(!document.querySelector('[role="dialog"]'), 'The pending navigation shortcut must not open an empty Camp palette')
    cases.push('migration keeps the target frame without authority requests')

    await reset({ kind: 'camp', campId }, false)
    publish({ startupPhase: 'migrating_authority' })
    initialSupervisor.resolve(starting())
    await advance(400)
    check(document.querySelector('main')?.textContent?.includes('升级本地数据'), 'A stale initial snapshot cannot replace a newer event')
    noAuthority()
    cases.push('subscribe-first startup ignores a late initial Supervisor snapshot')

    await reset({ kind: 'quick_chat' })
    onboarding.resolve({ schemaVersion: 2, status: 'in_progress', step: 'welcome',
      selectedMemberRole: null, runtimeSelection: null, provisioning: null })
    noAuthority()
    await advance(100)
    publish({ runtimeMode: 'full_core', fullCoreState: 'ready', startupPhase: null,
      authorityState: { kind: 'current', origin: 'initialized' },
      capabilities: { ...supervisor.capabilities, authoritativeWorkspace: true, coreRequests: true } })
    await flush()
    check(document.querySelector('.onboarding-welcome'), 'A real first install proceeds immediately once ready; 400ms is not a minimum delay')
    check(!document.querySelector('.startup-route-loading, .bootstrap-shell'), 'Fast startup must not flash loading')
    check(!calls.includes('camps.enter'), 'A fresh first-run flow must not enter an existing Camp')
    cases.push('first-run authority gate stays intact without imposing a 400ms minimum delay')

    await reset()
    await advance(350)
    publish({ runtimeMode: 'full_core', fullCoreState: 'ready', startupPhase: null,
      authorityState: { kind: 'current', origin: 'existing' },
      capabilities: { ...supervisor.capabilities, authoritativeWorkspace: true, coreRequests: true } })
    await flush()
    pageFrame('camp', false)
    await advance(49)
    pageFrame('camp', false)
    await advance(1)
    pageFrame('camp', true)
    onboarding.resolve({ schemaVersion: 2, status: 'completed', origin: 'existing_installation',
      completedAt: '2026-08-30T00:00:00Z', selectedMemberRole: null, memberAgentId: null, quickChatCampId: null })
    await flush()
    // The production restore path intentionally paints the route before entering
    // the Camp. Allow that additional pair of frames to complete.
    await flush()
    check(calls.includes('camps.enter'), 'The restored Camp begins loading once authority and onboarding are ready')
    check(!calls.includes('navigation.campViewed') && !calls.includes('desktopSession.commitRestorableLocation'),
      'A candidate route is not a committed/read Camp')
    check(document.querySelector('[data-startup-route="camp"]'), 'The same local feedback survives authority handoff')
    check(!document.querySelector('.bootstrap-shell, .onboarding-app-shell'), 'No intermediate full-screen gate')
    const currentRail = document.querySelector('.unified-sidebar')
    listeners.forEach(listener => listener(starting()))
    await flush()
    check(currentRail === document.querySelector('.unified-sidebar'), 'A stale Supervisor revision cannot reset the workspace')
    cases.push('ready handoff shares the original deadline and waits for real Camp authority')

    await reset()
    publish({ fullCoreState: 'blocked', capabilities: { ...supervisor.capabilities, fullCoreRetry: true },
      authorityState: { kind: 'owned_by_active_core', dataDir: '/isolated/fixture', owner: { pid: 42 } } })
    await flush()
    check(document.querySelector('.bootstrap-shell'), 'An actual admission blocker still exposes recovery controls immediately')
    check(document.body.textContent?.includes('导出诊断'), 'Blocked startup retains diagnostics')
    noAuthority()
    cases.push('confirmed blocker remains recoverable without mounting authority')

    await reset(null)
    localSession.reject(new Error('Local session read failed'))
    await flush()
    pageFrame('location', true)
    check(document.querySelector('[role="alert"]')?.textContent?.includes('Local session read failed'),
      'Local session failure must be visible before 400ms')
    noAuthority()
    cases.push('local preference read errors stay local and do not wait 400ms')
    return { ok: true, cases }
  },
  async capture(theme: string) {
    await reset()
    await advance(400)
    document.documentElement.dataset.theme = theme
    await flush()
    pageFrame('camp', true)
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      animation: getComputedStyle(document.querySelector('.startup-route-progress')!).animationName
    }
  }
} })
