import type { NavigationSnapshot } from '@contracts'
import type { CampCreationPreflight, CoreEvent, DesktopStartupSnapshot, HealthStatus, OnboardingSnapshot, RestorableLocation, RovaiApi, SupervisorSnapshot } from '@contracts'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { App } from '../../../apps/desktop/src/renderer/src/App'
import { NewConversationDialog } from '../../../apps/desktop/src/renderer/src/NewConversationDialog'
import { STARTUP_LOADING_EXIT_MS, StartupLoadingCanvas } from '../../../apps/desktop/src/renderer/src/StartupLoadingCanvas'
import { DEFAULT_APPEARANCE } from '../../../apps/desktop/src/shared/appearance'
import '../../../apps/desktop/src/renderer/src/styles.css'

const campId = 'rvcamp_01h47kvsy5fk1shh6w1g60eec0'
const errors: string[] = []
window.addEventListener('error', event => errors.push(String(event.error?.stack ?? event.message)))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
const calls: string[] = []
const listeners = new Set<(snapshot: SupervisorSnapshot) => void>()
const coreListeners = new Set<(event: CoreEvent) => void>()
const responses = new Map<string, unknown>()
const requestHandlers = new Map<string, (params: any) => unknown>()
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
let appearanceTheme: 'day' | 'night' = 'day'
let captureNavigation: (theme: 'day' | 'night', collapsed: boolean, setup?: () => void) => Promise<unknown>

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
// Only Supervisor and Core event subscriptions are active; authority calls are recorded.
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
      if (path === 'onEvent') {
        coreListeners.add(args[0])
        return () => coreListeners.delete(args[0])
      }
      if (path.split('.').at(-1)?.startsWith('on')) return () => undefined
      if (path === 'supervisor.getSnapshot') return initialSupervisor.promise
      if (path === 'desktopSession.getStartupSnapshot') { calls.push(path); return localSession.promise }
      if (path === 'currentUserProfile.get') return Promise.resolve({ displayName: '', avatarDataUrl: null })
      if (path === 'appearance.get') return Promise.resolve({ ...DEFAULT_APPEARANCE, resolvedTheme: appearanceTheme })
      if (path === 'generalPreferences.get') return Promise.resolve({ schemaVersion: 4,
        startupLocationMode: 'last_location', lastSettingsSection: 'general', executionConsolePlacement: 'bottom',
        newConversationDefaults: null, newConversationDefaultsRequireConfirmation: false,
        oneClickNewConversationEnabled: false, worldMapEnabled: true, ...(responses.get(path) ?? {}) })
      calls.push(path === 'request' ? args[0] : path)
      if (path === 'request' && requestHandlers.has(args[0])) return Promise.resolve().then(() => requestHandlers.get(args[0])!(args[1]))
      if (responses.has(path)) return Promise.resolve(responses.get(path))
      if (path === 'request' && responses.has(args[0])) return Promise.resolve(responses.get(args[0]))
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
  coreListeners.clear()
  responses.clear()
  requestHandlers.clear()
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
  check(!document.querySelector('.bootstrap-shell, .onboarding-app-shell'), 'Ordinary startup must not use the recovery shell')
  check(document.querySelector(`[data-startup-frame="${kind}"]`), `Expected the ${kind} target frame`)
  const canvas = document.querySelector<HTMLElement>('.startup-loading-canvas')
  check(Boolean(canvas) === feedback, `Feedback visibility at ${now}ms is incorrect`)
  if (canvas) {
    check(canvas.dataset.startupRoute === kind, `Expected ${kind} on the full-window startup canvas`)
    check(canvas.getAttribute('aria-busy') === 'true' && canvas.getAttribute('role') === 'status',
      'Loading canvas must expose one polite busy status')
    check(canvas.querySelector('.sr-only')?.textContent === '正在打开会话',
      'Loading canvas keeps its status available to assistive technology')
    check(!canvas.querySelector('h1, h2, p, button, .startup-route-progress, .startup-route-skeleton'),
      'Loading canvas must not render visible copy, progress chrome or recovery actions')
    const rect = canvas.getBoundingClientRect()
    check(Math.abs(rect.left) < 1 && Math.abs(rect.top) < 1
      && Math.abs(rect.width - window.innerWidth) < 1 && Math.abs(rect.height - window.innerHeight) < 1,
    'Loading canvas must cover the complete Renderer viewport')
    const mark = canvas.querySelector<SVGElement>('.startup-loading-mark')
    check(mark, 'Loading canvas must include the Rovai horizon mark')
    check(mark.dataset.brandMark === 'horizon' && mark.querySelectorAll('path').length === 2
      && Boolean(mark.querySelector('[data-brand-point="rendezvous"]')),
    'Loading canvas must use the complete Rovai horizon mark')
    const markRect = mark.getBoundingClientRect()
    check(Math.abs(markRect.width - 48) < 1 && Math.abs(markRect.height - 48) < 1,
      'Loading mark must keep its approved 48px geometry')
    check(Math.abs(markRect.left + markRect.width / 2 - window.innerWidth / 2) < 1
      && Math.abs(markRect.top + markRect.height / 2 - window.innerHeight / 2) < 1,
    'Loading mark must remain centered in the full window')
  }
  check(!document.querySelector('.sidebar-empty'), 'Unknown navigation is not an empty workspace')
  check(document.documentElement.scrollWidth <= window.innerWidth, 'Startup must not overflow horizontally')
}

function recoveryFrame(kind: string) {
  const recovery = document.querySelector<HTMLElement>('.startup-recovery-canvas')
  check(recovery, `Expected ${kind} startup recovery`)
  check(recovery.dataset.startupRoute === kind, `Expected ${kind} startup recovery route`)
  check(recovery.getAttribute('role') === 'alertdialog' && recovery.textContent?.includes('暂时无法打开会话'),
    'Startup recovery must be a focused alert dialog with safe product copy')
  check(recovery.textContent?.includes('重新打开') && !recovery.querySelector('.startup-loading-mark'),
    'Startup recovery must be separate from the brand loading state')
}

function noAuthority() {
  // Preview retention is a Main-owned cache update and does not access Core authority.
  check(calls.every(call => ['desktopSession.getStartupSnapshot', 'filePreview.updateRetention'].includes(call)), `Pre-ready authority calls: ${calls.join(', ')}`)
}

Object.assign(window, { startupTest: {
  captureNavigation: (theme: 'day' | 'night', collapsed: boolean) => captureNavigation(theme, collapsed),
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
      cases.push(`${target.kind}: 399ms silent, 400ms full-window brand feedback`)
    }

    await reset()
    const startupFrameBeforeShutdown = document.querySelector('[data-startup-frame="camp"]')
    check(coreListeners.size > 0, 'The root App must subscribe to shutdown before Core is ready')
    coreListeners.forEach(listener => listener({ method: 'runtime.state', params: { status: 'shutting_down' } }))
    publish({ runtimeMode: 'bootstrap_only', fullCoreState: 'shutting_down', startupPhase: null,
      capabilities: { ...supervisor.capabilities, authoritativeWorkspace: false, coreRequests: false } })
    await flush()
    check(startupFrameBeforeShutdown === document.querySelector('[data-startup-frame="camp"]'),
      'Shutdown before authority ready must preserve the existing startup frame')
    check(document.querySelector('.shutdown-scrim.is-pending'),
      'Shutdown must block interaction during the anti-flash window')
    await advance(399)
    check(!document.querySelector('.shutdown-scrim.is-visible, .startup-loading-canvas'),
      'Shutdown must not expose opening feedback during the anti-flash window')
    await advance(1)
    check(document.querySelector('.shutdown-scrim.is-visible'),
      'Shutdown before authority ready must show safe-exit feedback after 400ms')
    check(document.body.textContent?.includes('正在安全退出'),
      'Shutdown before authority ready must use the safe-exit copy')
    check(!document.querySelector('.startup-loading-canvas'),
      'Shutdown feedback must replace route-opening feedback rather than compete with it')
    noAuthority()
    cases.push('pre-ready shutdown preserves its frame and shows only safe-exit feedback')

    await reset()
    publish({ startupPhase: 'migrating_authority' })
    await advance(399)
    pageFrame('camp', false)
    await advance(1)
    pageFrame('camp', true)
    check(document.querySelector('.startup-loading-canvas .sr-only')?.textContent === '正在打开会话',
      'Migration uses the same accessible brand loading status')
    check(!document.body.textContent?.match(/升级|数据库|migration|staging|schema|复制页数/), 'Internal migration details must not reach the opening UI')
    noAuthority()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
    await flush()
    check(!document.querySelector('[role="dialog"]'), 'The pending navigation shortcut must not open an empty Camp palette')
    cases.push('migration keeps the target frame without authority requests')

    await reset({ kind: 'camp', campId }, false)
    publish({ startupPhase: 'migrating_authority' })
    initialSupervisor.resolve({ ...starting(), runtimeMode: 'full_core', fullCoreState: 'ready',
      capabilities: { ...supervisor.capabilities, authoritativeWorkspace: true, coreRequests: true } })
    await advance(400)
    check(document.querySelector('.startup-loading-canvas .sr-only')?.textContent === '正在打开会话',
      'A stale initial ready snapshot cannot replace a newer starting event')
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
    check(!document.querySelector('.startup-loading-canvas, .bootstrap-shell'), 'Fast startup must not flash loading')
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
    check(document.querySelector('.startup-loading-canvas[data-startup-route="camp"]'), 'The same brand canvas survives authority handoff')
    check(!document.querySelector('.bootstrap-shell, .onboarding-app-shell'), 'No intermediate recovery shell')
    const currentRail = document.querySelector('.unified-sidebar')
    listeners.forEach(listener => listener(starting()))
    await flush()
    check(currentRail === document.querySelector('.unified-sidebar'), 'A stale Supervisor revision cannot reset the workspace')
    cases.push('ready handoff shares the original deadline and waits for real Camp authority')

    await reset()
    publish({ fullCoreState: 'blocked', capabilities: { ...supervisor.capabilities, fullCoreRetry: true },
      lastError: { code: 'authority_contract_changed', message: 'migration schema /private/fixture.sqlite', retryable: false, details: {} },
      authorityState: { kind: 'owned_by_active_core', dataDir: '/isolated/fixture', owner: { pid: 42 } } })
    await flush()
    check(document.querySelector('.bootstrap-shell'), 'An actual admission blocker still exposes recovery controls immediately')
    check(document.body.textContent?.includes('导出诊断'), 'Blocked startup retains diagnostics')
    check(document.body.textContent?.includes('暂时无法打开会话') && document.body.textContent?.includes('重新打开'), 'Recovery actions use product copy')
    check(!document.body.textContent?.match(/migration|schema|sqlite|private|Core/), 'Structured reasons remain in diagnostics only')
    noAuthority()
    cases.push('confirmed blocker remains recoverable without mounting authority')

    await reset(null)
    localSession.reject(new Error('Local session read failed'))
    await flush()
    pageFrame('location', false)
    recoveryFrame('location')
    check(document.querySelector('[role="alertdialog"]')?.textContent?.includes('暂时无法打开会话'),
      'Local session failure must expose recovery before 400ms')
    check(!document.body.textContent?.includes('Local session read failed'), 'Local technical failure stays out of visible copy')
    noAuthority()
    cases.push('local preference read errors stay local and do not wait 400ms')

    await reset({ kind: 'members', agentId: null, tab: 'runtime' })
    const health: HealthStatus = {
      core: { ok: true, version: 'fixture', dataDir: '/isolated/fixture' },
      database: { ok: true, path: '/isolated/fixture/rovai.sqlite' },
      git: { installed: true, version: 'fixture' },
      hostPlatform: 'macos-arm64', runtimeCatalog: [], runtimePlatformAdmission: [], runtimeAvailability: [],
      searchEnvironment: { generation: 1, createdAt: '2026-08-31T00:00:00Z', pathEntryCount: 0,
        shell: { status: 'unavailable', interactive: false, shellName: null, entryCount: 0, elapsedMillis: 0 } }
    }
    responses.set('health.check', health)
    responses.set('members.list', [])
    responses.set('runtime.installations.list', [])
    onboarding.resolve({ schemaVersion: 2, status: 'completed', origin: 'existing_installation',
      completedAt: '2026-08-31T00:00:00Z', selectedMemberRole: null, memberAgentId: null, quickChatCampId: null })
    publish({ runtimeMode: 'full_core', fullCoreState: 'ready', startupPhase: null,
      authorityState: { kind: 'current', origin: 'existing' },
      capabilities: { ...supervisor.capabilities, authoritativeWorkspace: true, coreRequests: true } })
    await flush()
    await flush()
    await advance(0)
    check(coreListeners.size > 0, 'The production App must subscribe to Core events')
    for (const [events, memberReads] of [
      [['runtime.availability.updated'], 0],
      [['runtime.discovery.updated'], 1],
      [['runtime.discovery.completed'], 1],
      [['runtime.discovery.updated', 'runtime.availability.updated'], 1],
      [['runtime.availability.updated', 'runtime.discovery.completed'], 1],
      [['runtime.availability.updated'], 0]
    ] as const) {
      calls.length = 0
      for (const method of events) {
        coreListeners.forEach(listener => listener({ method, params: { runtimeKind: 'copilot-cli' } }))
      }
      await advance(79)
      check(!calls.includes('runtime.installations.list'), 'Runtime reads must wait for the shared debounce')
      await advance(1)
      check(calls.filter(call => call === 'health.check').length === 1, `${events}: refresh health once`)
      check(calls.filter(call => call === 'runtime.installations.list').length === 1, `${events}: refresh installations once`)
      check(calls.filter(call => call === 'members.list').length === memberReads, `${events}: incorrect member refresh scope`)
    }
    cases.push('Runtime availability refreshes health and installations without reloading members')
    cases.push('Runtime discovery retains full refresh across mixed debounce events')

    const authoritativeWorkspaceBeforeShutdown = document.querySelector('.authoritative-workspace')
    const appShellBeforeShutdown = document.querySelector('.app-shell')
    check(authoritativeWorkspaceBeforeShutdown && appShellBeforeShutdown,
      'The ready authority surface must be mounted before the shutdown transition')
    coreListeners.forEach(listener => listener({ method: 'runtime.state', params: { status: 'shutting_down' } }))
    publish({ runtimeMode: 'bootstrap_only', fullCoreState: 'shutting_down', startupPhase: null,
      capabilities: { ...supervisor.capabilities, authoritativeWorkspace: false, coreRequests: false } })
    await flush()
    check(authoritativeWorkspaceBeforeShutdown.isConnected
      && authoritativeWorkspaceBeforeShutdown === document.querySelector('.authoritative-workspace')
      && appShellBeforeShutdown === document.querySelector('.app-shell'),
      'Planned shutdown must retain the mounted authoritative workspace')
    check(document.querySelector('.shutdown-scrim.is-pending'),
      'The retained authority surface must be guarded during the anti-flash window')
    check(!document.querySelector('.startup-loading-canvas'),
      'Planned shutdown must not remount the route-opening surface')
    await advance(399)
    check(!document.querySelector('.shutdown-scrim.is-visible'),
      'Safe-exit feedback must remain hidden before 400ms')
    await advance(1)
    check(document.querySelector('.shutdown-scrim.is-visible'),
      'The retained authority surface must show safe-exit feedback after 400ms')
    check(document.body.textContent?.includes('正在安全退出'),
      'The retained authority surface must use the safe-exit copy')
    cases.push('planned shutdown retains the authoritative surface and safe-exit modal')

    await reset({ kind: 'quick_chat' })
    responses.set('health.check', health)
    responses.set('members.list', [])
    responses.set('runtime.installations.list', [])
    responses.set('navigation.snapshot', { schemaVersion: 3, projects: [], quickChat: { recentCamps: [], totalCount: 0 } })
    const navPreferences = { pins: [], removedProjects: [], projectOrder: [], projectNames: {} }
    responses.set('navigationPreferences.get', navPreferences)
    responses.set('navigationPreferences.synchronizeProjectOrder', navPreferences)
    responses.set('memory.hearthReviewItems.list', [])
    responses.set('memory.list', { capacities: [], memories: ['M', 'N'].map(id => ({
      id, scope: 'hearth', kind: 'preference', creationOrigin: 'user', companionAgentId: null,
      relationshipAgentIds: [], direction: null, directedActorAgentId: null, lifecycle: 'active',
      currentRevisionId: 'revision-' + id, currentBody: '导航记忆 ' + id, currentBodyUtf8Bytes: 16,
      currentRetrievalKeys: [id], reviewAfter: null, reviewDue: false, outgoingSuccessorIds: [], incomingPredecessorIds: [],
      version: 1, createdAt: '2026-09-13T00:00:00Z', updatedAt: '2026-09-13T00:00:00Z', retiredAt: null, forgottenAt: null, revisions: []
    })) })
    onboarding.resolve({ schemaVersion: 2, status: 'completed', origin: 'existing_installation',
      completedAt: '2026-08-31T00:00:00Z', selectedMemberRole: null, memberAgentId: null, quickChatCampId: null })
    publish({ runtimeMode: 'full_core', fullCoreState: 'ready', startupPhase: null,
      authorityState: { kind: 'current', origin: 'existing' },
      capabilities: { ...supervisor.capabilities, authoritativeWorkspace: true, coreRequests: true } })
    await flush(); await advance(0); await flush()
    const clickNavigation = async (name: string, selector = 'button') => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(selector)].find(item => item.textContent?.trim() === name || item.getAttribute('aria-label') === name)
      check(button && !button.disabled, 'Missing available navigation button: ' + name)
      button.click(); await flush(); await flush()
    }
    const back = async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', metaKey: true, bubbles: true, cancelable: true })); await flush(); await flush() }
    const forward = async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', metaKey: true, bubbles: true, cancelable: true })); await flush(); await flush() }
    check(document.querySelector<HTMLButtonElement>('[aria-label="后退"]')?.disabled, 'Restored home begins a new one-entry history')
    await clickNavigation('设置', '.unified-sidebar button')
    check(document.querySelector('.settings-panel-general'), 'Settings open directly to their default section')
    check(!document.querySelector('.navigation-collapse-button, .navigation-resize-handle'), 'Mac settings remove layout and history controls')
    await clickNavigation('外观', '.settings-sidebar-menu button')
    check(document.querySelector('.settings-panel-appearance'), 'Independent settings categories navigate')
    await back(); check(document.querySelector('.settings-panel-general'), 'Back restores the previous settings category')
    await back(); check(document.querySelector('.compose-content'), 'No phantom Settings landing entry')
    await forward(); check(document.querySelector('.settings-panel-general'), 'Forward restores settings')
    await clickNavigation('返回 App', '.settings-sidebar-back')
    check(document.querySelector('.compose-content'), 'Return App restores the page preceding settings')
    await clickNavigation('记忆', '.unified-sidebar button')
    check(document.querySelector('.memory-catalog-item.selected')?.textContent?.includes('导航记忆 M'), 'Memory uses the real initial list selection')
    const memoryRows = [...document.querySelectorAll<HTMLButtonElement>('.memory-catalog-item')]
    check(memoryRows.length === 2, 'The fixture must have two distinct memory targets')
    memoryRows[1].click(); await flush(); await flush()
    check(document.querySelector('.memory-catalog-item.selected')?.textContent?.includes('导航记忆 N'), 'Selecting a resource navigates to it')
    await back()
    check(document.querySelector('.memory-catalog-item.selected')?.textContent?.includes('导航记忆 M'), 'Back restores the previous memory detail')
    await back(); check(document.querySelector('.compose-content'), 'Automatic first memory selection replaces rather than pushes')
    await forward(); check(document.querySelector('.memory-catalog-item.selected')?.textContent?.includes('导航记忆 M'), 'Forward restores memory ID after remount')
    await clickNavigation('设置', '.unified-sidebar button')
    await back()
    await clickNavigation('收起导航侧栏')
    check(document.querySelectorAll('.navigation-history-button').length === 0, 'Folded main pages show only the expand button')
    await forward()
    check(document.querySelector('[aria-label="展开导航侧栏"]'), 'Entering settings preserves collapsed layout')
    await clickNavigation('展开导航侧栏')
    check(!document.querySelector('.navigation-collapse-button, .navigation-resize-handle'), 'Expanded Mac settings have no collapse or resize entry')
    cases.push('Desktop navigation shares settings and memory history, restores details, and respects Mac folded controls')

    const stamp = '2026-09-13T00:00:00Z'
    const coverage = { loadedCount: 0, totalCount: 0, omittedCount: 0, complete: true }
    const campProjection = (id: string) => ({
      schemaVersion: 8, throughGlobalSequence: 0,
      camp: { id, title: '导航会话 ' + id, activationState: 'active', projectBindingKind: 'quick_chat',
        projectPath: '/fixture/quick-chat', defaultLeadAgentId: null, membershipGeneration: 1, version: 1, createdAt: stamp, updatedAt: stamp },
      members: [], membershipReconciliations: [], tasks: [], messages: [], messageDeliveries: [], turns: [],
      agentRuns: [], executionEvidence: [], approvals: [], agentRunFileChanges: [],
      coverage: { tasks: coverage, messages: { ...coverage, hasEarlier: false, oldestLoadedSequence: null, newestLoadedSequence: null },
        messageDeliveries: coverage, turns: coverage, agentRuns: coverage, approvals: coverage }
    })
    responses.set('navigation.snapshot', { schemaVersion: 3, throughGlobalSequence: 0, projects: [], quickChat: {
      totalCount: 4, recentCamps: ['A', 'B', 'C', 'D'].map(id => ({ id, title: '导航会话 ' + id, activationState: 'active',
        projectBindingKind: 'quick_chat', projectPath: '/fixture/quick-chat', defaultLead: null, marker: 'none',
        lastActivityAt: stamp, lastActivityGlobalSequence: 0, latestCompletionGlobalSequence: 0, version: 1 }))
    } })
    requestHandlers.set('navigation.camps', ({ campIds }) => ({ throughGlobalSequence: 0, groupKeys: ['quick-chat'],
      camps: (responses.get('navigation.snapshot') as NavigationSnapshot).quickChat.recentCamps.filter(camp => campIds.includes(camp.id)) }))
    responses.set('navigation.campViewed', { changed: false, navigation: { throughGlobalSequence: 0, groupKeys: ['quick-chat'], camps: [] } })
    responses.set('skills.list', [])
    responses.set('skills.deliveryGroups.list', [])
    responses.set('skills.candidates', { skills: [], errors: [] })
    responses.set('camps.exists', true)
    requestHandlers.set('camp.composerDraft.get', ({ campId }) => ({ campId, body: '', content: { version: 2, segments: [] },
      revision: 1, attachments: [], replyIntent: null, continuationIntent: null, updatedAt: stamp, expiresAt: null }))
    requestHandlers.set('camp.pendingInputs.get', ({ campId }) => ({ campId, executionActive: false, editSession: null, items: [] }))
    let campRequest = (id: string): unknown => campProjection(id)
    requestHandlers.set('camps.enter', ({ command }) => campRequest(command.campId))
    requestHandlers.set('camps.open', ({ campId }) => campRequest(campId))
    for (const listener of coreListeners) listener({ method: 'navigation.invalidated', params: {} } as CoreEvent)
    await advance(500); await flush()
    await clickNavigation('返回 App', '.settings-sidebar-back')
    await clickNavigation('导航会话 A', '.camp-nav-open')
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 A', 'Camp A is a real authoritative navigation destination')
    const switchCallStart = calls.length
    await clickNavigation('导航会话 B', '.camp-nav-open')
    await flush(); await flush()
    const switchCalls = calls.slice(switchCallStart)
    check(!switchCalls.some(method => ['navigation.snapshot', 'navigation.groupCamps', 'missions.list', 'skills.candidates', 'navigation.campViewed'].includes(method)),
      'An ordinary read Camp switch must not read the sidebar, Missions or Skill directories, or acknowledge again')
    check(switchCalls.includes('navigation.camps'), 'Camp switching validates only the target navigation row')
    cases.push('Ordinary Camp switching reads only the target row without unrelated queries')
    const skillReadStart = calls.filter(method => method === 'skills.candidates').length
    const editor = document.querySelector<HTMLElement>('.structured-mention-editor')!
    editor.focus()
    document.execCommand('insertText', false, '/')
    await flush(); await flush()
    check(calls.filter(method => method === 'skills.candidates').length === skillReadStart + 1,
      'Opening the Skill picker loads its catalog once')
    document.execCommand('selectAll')
    document.execCommand('delete')
    await flush()
    cases.push('The Skill picker loads its catalog on demand')
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 B', 'Camp switches share the same history')
    await back(); check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 A', 'Back restores the Camp ID and title')
    const delayedCamp = deferred<unknown>()
    campRequest = id => id === 'C' ? delayedCamp.promise : campProjection(id)
    await clickNavigation('导航会话 C', '.camp-nav-open')
    check(document.querySelector('.structured-mention-editor')?.getAttribute('contenteditable') === 'false', 'A pending departure locks the existing composer')
    await clickNavigation('导航会话 A', '.camp-nav-open')
    check(document.querySelector('.structured-mention-editor')?.getAttribute('contenteditable') === 'true', 'Cancelling a slow departure releases the composer without waiting for its old request')
    delayedCamp.resolve(campProjection('C')); await flush(); await flush()
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 A', 'A late read cannot override a renewed selection of the displayed Camp')
    await forward(); check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 B', 'Cancelling a pending push preserves the forward branch')
    campRequest = id => { if (id === 'C') throw new Error('Fixture Camp unavailable'); return campProjection(id) }
    await clickNavigation('导航会话 C', '.camp-nav-open')
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 B', 'A failed Camp read keeps the displayed page')
    await back(); check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 A', 'Failed reads do not consume a history entry')
    campRequest = id => { if (id === 'B') throw new Error('Fixture Camp removed'); return campProjection(id) }
    requestHandlers.set('camps.exists', ({ campId }) => campId !== 'B')
    await forward(); check(document.querySelector('.compose-content'), 'A deleted historical Camp resolves to the valid home page')
    await back(); check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 A', 'Deleted-resource fallback replaces the current entry')
    const pendingDiscard = deferred<unknown>()
    requestHandlers.set('camps.discardPending', () => pendingDiscard.promise)
    campRequest = id => {
      const projection = campProjection(id)
      return id === 'D' ? { ...projection, camp: { ...projection.camp, activationState: 'pending' } } : projection
    }
    await clickNavigation('导航会话 D', '.camp-nav-open')
    await flush(); await flush()
    await clickNavigation('导航会话 A', '.camp-nav-open')
    await flush(); await flush()
    check(calls.includes('camps.discardPending'), 'Leaving the loaded empty Camp must initiate cleanup before the race is tested')
    await back(); check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 D', 'A blank pending Camp can be revisited before its leave cleanup finishes')
    pendingDiscard.resolve({ status: 'applied', code: 'camp.pending_discarded', payload: {} }); await flush(); await flush()
    check(document.querySelector('.compose-content'), 'Late cleanup of the revisited empty Camp replaces it with a valid page')
    await forward(); check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 A', 'Empty Camp cleanup preserves the forward branch')
    cases.push('Desktop Camp navigation preserves the forward branch, ignores stale reads and retains the page on failure')
    const navigationResponses = new Map(responses)
    const navigationHandlers = new Map(requestHandlers)
    captureNavigation = async (theme, collapsed, setup) => {
      appearanceTheme = theme
      window.localStorage.removeItem('rovai.navigation-layout.v1')
      await reset({ kind: 'quick_chat' })
      for (const [method, response] of navigationResponses) responses.set(method, response)
      for (const [method, handler] of navigationHandlers) requestHandlers.set(method, handler)
      campRequest = id => campProjection(id)
      setup?.()
      onboarding.resolve({ schemaVersion: 2, status: 'completed', origin: 'existing_installation', completedAt: stamp,
        selectedMemberRole: null, memberAgentId: null, quickChatCampId: null })
      publish({ runtimeMode: 'full_core', fullCoreState: 'ready', startupPhase: null, authorityState: { kind: 'current', origin: 'existing' },
        capabilities: { ...supervisor.capabilities, authoritativeWorkspace: true, coreRequests: true } })
      await flush(); await advance(0); await flush(); await advance(0); await flush()
      await clickNavigation('导航会话 A', '.camp-nav-open')
      await clickNavigation('导航会话 B', '.camp-nav-open')
      if (collapsed) await clickNavigation('收起导航侧栏')
      document.documentElement.dataset.theme = theme
      await flush()
      const center = (selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect()
        return rect.y + rect.height / 2
      }
      check(document.querySelectorAll('.camp-detail-entry').length === 3, 'The real Camp header keeps all three existing actions')
      return { control: center('.navigation-collapse-button'), title: center('.camp-topbar h1'), actions: center('.camp-detail-entry') }
    }

    await captureNavigation('day', false)
    await clickNavigation('导航会话 B', '.camp-nav-open')
    const cancelledPush = deferred<unknown>()
    campRequest = id => id === 'C' ? cancelledPush.promise : campProjection(id)
    await clickNavigation('导航会话 C', '.camp-nav-open')
    await back()
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 A', 'Back while C loads must traverse committed A/B history')
    cancelledPush.resolve(campProjection('C')); await flush(); await flush()
    await forward()
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 B', 'Forward after cancelled C restores B')
    check(document.querySelector<HTMLButtonElement>('[aria-label="前进"]')?.disabled, 'Unseen C must not survive in the forward branch')

    await captureNavigation('day', false)
    const memoryLoading = deferred<unknown>(), campLoading = deferred<unknown>()
    requestHandlers.set('memory.list', () => memoryLoading.promise)
    campRequest = id => id === 'C' ? campLoading.promise : campProjection(id)
    await clickNavigation('记忆', '.unified-primary-nav button')
    await clickNavigation('导航会话 C', '.camp-nav-open')
    memoryLoading.resolve(responses.get('memory.list')); await flush(); await flush()
    check(document.querySelector('.memory-catalog-item.selected')?.textContent?.includes('导航记忆 M'), 'Memory may normalize its displayed entry while C loads')
    campLoading.resolve(campProjection('C')); await flush(); await flush()
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 C', 'Old memory normalization must not cancel the newer C navigation')
    await back()
    check(document.querySelector('.memory-catalog-item.selected')?.textContent?.includes('导航记忆 M'), 'Memory correction survives the pending Camp commit')
    await back()
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 B', 'Memory normalization must not create an extra history entry')
    cases.push('Pending pushes never enter history and memory normalization cannot supersede newer navigation')

    await captureNavigation('day', false)
    const cleanup = deferred<unknown>(), afterCleanup = deferred<unknown>()
    requestHandlers.set('camps.discardPending', () => cleanup.promise)
    campRequest = id => id === 'C' ? afterCleanup.promise : id === 'D'
      ? { ...campProjection(id), camp: { ...campProjection(id).camp, activationState: 'pending' } } : campProjection(id)
    await clickNavigation('导航会话 D', '.camp-nav-open')
    await flush(); await flush()
    await clickNavigation('导航会话 A', '.camp-nav-open')
    await flush(); await flush()
    await back()
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 D', 'Cleanup race must revisit D before opening C')
    check(calls.includes('camps.discardPending'), 'Cleanup race must have a pending discard')
    await clickNavigation('导航会话 C', '.camp-nav-open')
    cleanup.resolve({ status: 'applied', code: 'camp.pending_discarded', payload: {} }); await flush(); await flush()
    check(document.querySelector('.compose-content'), 'Deleted displayed pending Camp must resolve to home during a slow departure: ' + document.querySelector('.camp-topbar h1')?.textContent)
    afterCleanup.resolve(campProjection('C')); await flush(); await flush()
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 C', 'Pending Camp cleanup must not cancel a newer destination')
    await back()
    check(document.querySelector('.compose-content'), 'Deleted Camp fallback remains a corrected history entry')

    const navigationAgents = ['A', 'B'].map((name, index) => ({
      agentId: 'agent-' + name, displayName: '导航队员 ' + name, avatarRef: null, accent: null,
      teamRole: '项目协作', professionalResponsibilities: '', personalityTraits: [], workingPrinciples: '', growthTopic: '',
      defaultCapabilities: [], presence: 'present', removedAt: null, memberOrder: index, version: 1, createdAt: stamp, updatedAt: stamp,
      runtimeConfiguration: { adapterKind: 'codex-cli', model: { mode: 'runtime_default' },
        permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: {} } }, runtimeReadiness: { status: 'ready', blockers: [] }
    }))
    const setupCreation = () => {
      responses.set('members.list', navigationAgents)
      responses.set('generalPreferences.get', { oneClickNewConversationEnabled: true,
        newConversationDefaults: { memberAgentIds: ['agent-A'], defaultLeadAgentId: 'agent-A' } })
    }
    await captureNavigation('day', false, setupCreation)
    const lateCreation = deferred<unknown>()
    requestHandlers.set('camps.create', () => lateCreation.promise)
    await clickNavigation('新对话', '.unified-primary-nav button')
    check(calls.includes('camps.create'), 'One-click creation must reach Core before navigation moves')
    await clickNavigation('记忆', '.unified-primary-nav button')
    lateCreation.resolve({ status: 'applied', payload: { campId: 'NEW' } }); await flush(); await flush()
    check(document.querySelector('.memory-catalog-item.selected'), 'Late Camp creation must leave the newer memory page visible')
    check(!document.querySelector('.camp-topbar'), 'Late creation must not activate its new Camp')
    await back()
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 B', 'Late creation must not add a navigation step')
    const failedCreation = deferred<unknown>()
    requestHandlers.set('camps.create', () => failedCreation.promise)
    await clickNavigation('新对话', '.unified-primary-nav button')
    await clickNavigation('记忆', '.unified-primary-nav button')
    failedCreation.reject(new Error('Fixture creation rejected')); await flush(); await flush()
    check(!document.querySelector('.new-camp-dialog'), 'Obsolete creation failure must not reopen its dialog over the newer page')
    requestHandlers.set('camps.create', () => ({ status: 'applied', payload: { campId: 'NEW' } }))
    await clickNavigation('新对话', '.unified-primary-nav button')
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 NEW', 'Current creation intent still opens its new Camp')
    await back()
    check(document.querySelector('.memory-catalog-item.selected'), 'Successful current creation adds exactly one history entry')
    cases.push('One-click creation success and failure respect newer navigation intent')

    await captureNavigation('day', false, setupCreation)
    await clickNavigation('队员', '.unified-primary-nav button')
    const selectMember = async (name: string) => {
      const button = document.querySelector<HTMLButtonElement>(`[aria-label^="导航队员 ${name}，"]`)
      check(button, 'Member row must exist'); button.click(); await flush(); await flush()
    }
    const selectedMemberName = () => document.querySelector<HTMLInputElement>('.member-editor-page:not([hidden]) input[id$="displayName"]')?.value
    await selectMember('A'); await selectMember('B')
    await clickNavigation('新增队员')
    const draftName = document.querySelector<HTMLInputElement>('.member-editor-page:not([hidden]) input[id$="displayName"]')!
    check(draftName, 'New-member name input must exist')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(draftName, '保留的队员草稿')
    draftName.dispatchEvent(new Event('input', { bubbles: true })); await flush()
    await back()
    check(selectedMemberName() === '导航队员 A', 'History replay must leave creating mode and show A')
    await clickNavigation('继续编辑新队员草稿')
    check(selectedMemberName() === '保留的队员草稿', 'Changing display mode must retain the new-member draft')
    await selectMember('A')
    document.querySelector<HTMLButtonElement>('.member-sidebar-row.selected .member-runtime-shortcut')!.click(); await flush(); await flush()
    document.querySelector<HTMLButtonElement>('.personal-roster-button')!.click(); await flush()
    check(document.querySelector('.personal-editor-page:not([hidden])'), 'Personal profile mode must be active before replay')
    await back()
    check(selectedMemberName() === '导航队员 A', 'Same-agent tab replay must leave personal profile mode')
    cases.push('Member history replay selects the requested editor while retaining new-member drafts')

    let dialogOpen = true
    let dialogBusy = false
    const creation = deferred<void>()
    const submissions: { draft: unknown; enableOneClick: boolean }[] = []
    let preflight: CampCreationPreflight = {
      admissible: true, blockers: [], initialLeadAgentId: 'agent-a',
      presentMembers: ['agent-a', 'agent-b', 'agent-c', 'agent-d'].map((agentId, index) => ({
        agentId, displayName: agentId, memberOrder: index, runtimeConfigured: true,
        runtimeReadiness: index % 2 ? 'ready' : 'light_ready'
      }))
    }
    const renderDraft = () => flushSync(() => root!.render(<NewConversationDialog
      open={dialogOpen} initialWorkspace={null} projects={[]} preflight={preflight} agents={[]}
      busy={dialogBusy} projectAccessReady
      onOpenChange={open => { dialogOpen = open; renderDraft() }}
      onChooseWorkspaceDirectory={async () => null} onWorkspaceSelected={async () => undefined}
      onCreate={(draft, enableOneClick) => { submissions.push({ draft, enableOneClick }); return creation.promise }}
    />))
    renderDraft()
    await flush()
    document.querySelector<HTMLButtonElement>('[aria-labelledby~="new-camp-members-label"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    )
    await advance(0)
    await flush()
    document.querySelector<HTMLElement>('[role="menuitemcheckbox"]')!.click()
    await flush()
    document.querySelector<HTMLElement>('.new-camp-member-grid')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
    await advance(0)
    document.querySelector<HTMLInputElement>('.new-camp-quick-label input')!.click()
    await flush()
    preflight = structuredClone(preflight)
    preflight.presentMembers[0].runtimeReadiness = 'ready'
    renderDraft()
    await flush()
    check(document.querySelector<HTMLInputElement>('.new-camp-quick-label input')!.checked,
      'Background candidate refresh must preserve the one-click checkbox')
    check(document.getElementById('new-camp-members-value')!.textContent === '3 位队员',
      'Background candidate refresh must preserve the selected team')
    check(document.getElementById('new-camp-lead-value')!.textContent === 'agent-b',
      'Background candidate refresh must preserve the selected Lead')
    const form = document.querySelector<HTMLFormElement>('.new-camp-dialog form')!
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    check(submissions.length === 1 && submissions[0].enableOneClick, 'Repeated submit must create only once with the requested quick setting')
    dialogBusy = true
    renderDraft()
    await flush()
    check(document.querySelector<HTMLInputElement>('.new-camp-quick-label input')!.disabled, 'Submitting locks the quick setting')
    creation.reject(new Error('Creation rejected by Core'))
    await flush()
    dialogBusy = false
    renderDraft()
    await flush()
    check(document.body.textContent?.includes('Creation rejected by Core'), 'Creation failure is recoverable inside the dialog')
    check(document.querySelector<HTMLInputElement>('.new-camp-quick-label input')!.checked
      && document.getElementById('new-camp-members-value')!.textContent === '3 位队员',
      'Creation failure retains the selected team and checkbox')
    dialogOpen = false
    renderDraft()
    await flush()
    dialogOpen = true
    renderDraft()
    await flush()
    check(!document.querySelector<HTMLInputElement>('.new-camp-quick-label input')!.checked,
      'Reopening must reset the opt-in checkbox')
    check(document.getElementById('new-camp-members-value')!.textContent === '4 位队员', 'Reopening starts a fresh draft')
    cases.push('New Conversation preserves edited drafts across candidate refresh and creation failure')

    const openMembers = async () => {
      document.querySelector<HTMLButtonElement>('[aria-labelledby~="new-camp-members-label"]')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      )
      await advance(0)
      await flush()
    }
    const key = async (key: string) => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      await advance(0)
      await flush()
    }
    // A candidate disappearing at runtime must block submit, while retaining the user's draft.
    preflight = structuredClone(preflight)
    preflight.presentMembers[0].runtimeReadiness = 'needs_attention'
    renderDraft()
    await flush()
    check(document.getElementById('new-camp-members-value')!.textContent === '4 位队员', 'Refresh must not silently drop a selected member')
    check(document.querySelector<HTMLButtonElement>('.compact-primary')!.disabled, 'An unavailable selection blocks submission')
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flush()
    check(submissions.length === 1, 'A synthetic submit cannot bypass the availability guard')
    await openMembers()
    document.querySelector<HTMLButtonElement>('.compact-menu-heading button')!.click()
    await flush()
    await key('Escape')
    check(document.getElementById('new-camp-members-value')!.textContent === '3 位队员'
      && document.getElementById('new-camp-lead-value')!.textContent === 'agent-b', 'Explicit all-selection repairs team and Lead')

    dialogOpen = false
    renderDraft()
    await flush()
    preflight = structuredClone(preflight)
    preflight.presentMembers[0].runtimeConfigured = false
    preflight.presentMembers[0].runtimeReadiness = 'ready'
    preflight.presentMembers[1].runtimeReadiness = 'light_ready'
    preflight.presentMembers[2].runtimeReadiness = 'needs_attention'
    dialogOpen = true
    renderDraft()
    await flush()
    check(document.getElementById('new-camp-members-value')!.textContent === '2 位队员', 'Only configured and usable teammates start selected')
    check(document.getElementById('new-camp-lead-value')!.textContent === 'agent-b', 'Light readiness is not ranked below deep readiness')
    await openMembers()
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')]
    check(items.length === 4 && items[0].hasAttribute('data-disabled') && items[2].hasAttribute('data-disabled'), 'Unavailable teammates stay visible and disabled')
    check(items[0].textContent?.includes('未配置运行时') && items[2].textContent?.includes('运行时不可用'), 'Unavailable labels distinguish missing config from unavailable runtime')
    check(items[1].textContent?.includes('可用') && items[3].textContent?.includes('可用'), 'Usable teammates share one availability label')
    items[0].click()
    items[2].click()
    await flush()
    check(items[0].getAttribute('aria-checked') === 'false' && items[2].getAttribute('aria-checked') === 'false', 'Disabled clicks cannot add a teammate')
    items[1].focus()
    await key('ArrowDown')
    check(document.activeElement === items[3], 'Vertical arrows preserve the visual column across disabled holes')
    await key('ArrowRight')
    check(document.activeElement === items[1], 'Horizontal arrows wrap past disabled teammates')
    await key('Escape')
    document.querySelector<HTMLButtonElement>('[aria-labelledby~="new-camp-lead-label"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    )
    await advance(0)
    await flush()
    check(document.querySelectorAll('[role="menuitemradio"]').length === 2, 'Lead menu contains only available selected teammates')
    await key('Escape')
    const optIn = document.querySelector<HTMLInputElement>('.new-camp-quick-label input')!
    const help = document.querySelector<HTMLButtonElement>('[aria-label="一键新建说明"]')!
    check(!document.querySelector('[role="tooltip"]'), 'Quick-start explanation is hidden by default')
    help.focus()
    help.click()
    await flush()
    check(document.querySelector('[role="tooltip"]')?.textContent?.includes('可在「设置 → 通用」关闭。'), 'Help opens through focus and click')
    check(!optIn.checked, 'Opening help must not toggle one-click opt-in')
    await key('Escape')
    check(!document.querySelector('[role="tooltip"]') && document.querySelector('.new-camp-dialog'), 'Escape dismisses help without closing the dialog')
    document.querySelector<HTMLButtonElement>('.compact-cancel')!.focus()
    help.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }))
    await flush()
    check(document.querySelector('[role="tooltip"]'), 'Help also opens on hover')
    document.querySelector('[role="tooltip"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    await advance(0)
    check(document.querySelector('.new-camp-dialog'), 'Interacting with tooltip content keeps the dialog open')
    help.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    await advance(120)
    check(!document.querySelector('[role="tooltip"]'), 'Hover help closes after pointer leaves')
    check(!document.body.textContent?.includes('本次新建成功后生效'), 'No redundant effective-after-creation copy remains')
    cases.push('New Conversation gates selection, Lead and submit by saved usable runtimes and keeps help independent')

    dialogOpen = false
    renderDraft()
    await flush()
    preflight.presentMembers = preflight.presentMembers.map(member => ({ ...member, runtimeConfigured: false }))
    dialogOpen = true
    renderDraft()
    await flush()
    check(document.getElementById('new-camp-members-value')!.textContent === '暂无可用队员'
      && document.querySelector<HTMLButtonElement>('.compact-primary')!.disabled, 'An all-unconfigured roster cannot create a conversation')
    cases.push('New Conversation handles an all-unconfigured roster')
    preflight = structuredClone(preflight)
    preflight.presentMembers[1].runtimeConfigured = true
    renderDraft()
    await flush()
    await openMembers()
    document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')[1].click()
    await flush()
    await key('Escape')
    check(document.getElementById('new-camp-lead-value')!.textContent === 'agent-b'
      && !document.querySelector<HTMLButtonElement>('.compact-primary')!.disabled, 'Selecting the first recovered member also establishes a Lead')

    flushSync(() => root!.render(<StartupLoadingCanvas visible route="camp" />))
    await flush()
    check(document.querySelector('.startup-loading-canvas:not(.is-exiting)'),
      'The standalone brand canvas must begin in its visible phase')
    flushSync(() => root!.render(<StartupLoadingCanvas visible={false} route="camp" />))
    await flush()
    const exitingCanvas = document.querySelector<HTMLElement>('.startup-loading-canvas.is-exiting')
    check(exitingCanvas, 'Ready content must wait behind the startup canvas exit phase')
    check(getComputedStyle(exitingCanvas).transitionDuration === '0.18s',
      'The startup canvas must use the approved 180ms exit')
    await advance(STARTUP_LOADING_EXIT_MS - 1)
    check(document.querySelector('.startup-loading-canvas.is-exiting'),
      'The startup canvas must remain mounted until its exit completes')
    await advance(1)
    check(!document.querySelector('.startup-loading-canvas'),
      'The startup canvas must release the ready workspace after its exit')
    cases.push('startup brand canvas fades before revealing ready content')

    return { ok: true, cases }
  },
  async captureNewConversation(theme: string, state = 'members') {
    document.documentElement.dataset.theme = theme
    if (root) flushSync(() => root!.unmount())
    root = createRoot(document.getElementById('root')!)
    const preflight: CampCreationPreflight = {
      admissible: true, blockers: [], initialLeadAgentId: '洛可',
      presentMembers: ['洛可', '沐瓦', '阿澈', '泽安'].map((displayName, index) => ({
        agentId: displayName, displayName, memberOrder: index, runtimeConfigured: state !== 'empty' && index < 2,
        runtimeReadiness: index === 0 ? 'light_ready' : index === 1 ? 'ready' : 'runtime_not_configured'
      }))
    }
    flushSync(() => root!.render(<NewConversationDialog
      open initialWorkspace={null} projects={[]} preflight={preflight} agents={[]}
      busy={false} projectAccessReady onOpenChange={() => undefined}
      onChooseWorkspaceDirectory={async () => null} onWorkspaceSelected={async () => undefined}
      onCreate={async () => undefined}
    />))
    await advance(0)
    document.getAnimations().forEach(animation => {
      if (animation.effect?.getTiming().iterations !== Infinity) animation.finish()
    })
    await flush()
    if (state === 'members') {
      document.querySelector<HTMLButtonElement>('[aria-labelledby~="new-camp-members-label"]')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      )
      await advance(0)
    } else if (state === 'help') {
      const help = document.querySelector<HTMLButtonElement>('[aria-label="一键新建说明"]')!
      help.scrollIntoView({ block: 'nearest' })
      await advance(0)
      help.click()
    }
    await flush()
    const surface = document.querySelector(state === 'members' ? '.new-camp-member-grid' : state === 'help' ? '[role="tooltip"]' : '.new-camp-dialog')!
    check(surface, `Missing new conversation ${state} capture in ${theme}; focus=${document.activeElement?.outerHTML}`)
    const bounds = surface.getBoundingClientRect()
    check(bounds.left >= 0 && bounds.right <= window.innerWidth, 'New conversation overlays stay inside the viewport')
    check(bounds.top >= 0 && bounds.bottom <= window.innerHeight, 'New conversation overlays remain vertically visible')
    return { width: window.innerWidth, height: window.innerHeight }
  },
  async capture(theme: string, state = 'loading') {
    appearanceTheme = theme === 'night' ? 'night' : 'day'
    document.documentElement.dataset.theme = appearanceTheme
    if (state === 'local-error') {
      await reset(null)
      localSession.reject(new Error('Private local preference failure'))
    } else {
      await reset()
      if (state === 'blocked') {
        publish({ fullCoreState: 'blocked', capabilities: { ...supervisor.capabilities, fullCoreRetry: true },
          lastError: { code: 'authority_contract_changed', message: 'migration schema /private/fixture.sqlite', retryable: false, details: {} } })
      } else {
        await advance(400)
      }
    }
    document.documentElement.dataset.theme = theme
    await flush()
    if (state === 'loading') pageFrame('camp', true)
    if (state === 'local-error') recoveryFrame('location')
    check(document.documentElement.scrollWidth <= window.innerWidth, 'Startup recovery must not overflow horizontally')
    if (state !== 'loading') {
      check(document.body.textContent?.includes('暂时无法打开会话'), 'Failure capture keeps the same product title')
      check(document.body.textContent?.includes('导出诊断'), 'Failure capture retains diagnostics')
    }
    noAuthority()
    const loading = document.querySelector<HTMLElement>('.startup-loading-canvas')
    const mark = document.querySelector<SVGElement>('.startup-loading-mark')
    if (state === 'loading') {
      check(loading && mark, 'Loading capture must include the full-window brand canvas')
      const expectedSurface = theme === 'night' ? 'rgb(24, 29, 33)' : 'rgb(255, 255, 255)'
      check(getComputedStyle(loading).backgroundColor === expectedSurface,
        `Loading canvas must use the ${theme} solid surface`)
    }
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      animation: mark ? getComputedStyle(mark).animationName : 'none'
    }
  }
} })
