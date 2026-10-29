import { DEFAULT_GENERAL_PREFERENCES } from '../../../apps/desktop/src/shared/general-preferences-model'
import { shortcutDefaults } from '../../../apps/desktop/src/shared/shortcuts'
import { EMPTY_SNAPSHOT, sanitizeSnapshot, registerNavigationProjects } from '../../../apps/desktop/src/shared/navigation-preferences-model'
import type { GeneralPreferencesSnapshot, NavigationSnapshot, NavigationPreferencesSnapshot, MissionRecord } from '@contracts'
import type { ThreadCreationPreflight, CoreEvent, DesktopStartupSnapshot, HealthStatus, OnboardingSnapshot, RestorableLocation, RovaiApi, SupervisorSnapshot } from '@contracts'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { App } from '../../../apps/desktop/src/renderer/src/App'
import { desktopThreadClient } from '../../../apps/desktop/src/renderer/src/desktop-camp-client'
import { NewConversationDialog } from '../../../apps/desktop/src/renderer/src/NewConversationDialog'
import { STARTUP_LOADING_EXIT_MS, StartupLoadingCanvas } from '../../../apps/desktop/src/renderer/src/StartupLoadingCanvas'
import { DEFAULT_APPEARANCE } from '../../../apps/desktop/src/shared/appearance'
import { initial as runFixture, run as runTemplate } from '../host-web-parity/data'
import '../../../apps/desktop/src/renderer/src/styles.css'

const threadId = 'rvcamp_01h47kvsy5fk1shh6w1g60eec0'
const errors: string[] = []
window.addEventListener('error', event => errors.push(String(event.error?.stack ?? event.message)))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
const calls: string[] = []
const listeners = new Set<(snapshot: SupervisorSnapshot) => void>()
const coreListeners = new Set<(event: CoreEvent) => void>()
const navigationPreferenceListeners = new Set<(snapshot: NavigationPreferencesSnapshot) => void>()
const languageListeners = new Set<(snapshot: GeneralPreferencesSnapshot) => void>()
let localLanguage: GeneralPreferencesSnapshot = { ...DEFAULT_GENERAL_PREFERENCES, interfaceLanguagePreference: 'zh-CN', interfaceLanguage: 'zh-CN' }
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
let captureStoppedThread: (theme: 'day' | 'night') => Promise<void>

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
      if (path === '' && key === 'windowClose') return undefined
      if (path === '' && key === 'shortcuts') return {
        get: async () => ({ revision: 0, preferences: shortcutDefaults(), degraded: false }),
        save: async () => { throw new Error('Shortcut changes use their dedicated fixture') },
        onChanged: () => () => undefined, onMouseSide: () => () => undefined, setRecording: async () => {}
      }
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
      if (path === 'navigationPreferences.onChanged') {
        navigationPreferenceListeners.add(args[0])
        return () => navigationPreferenceListeners.delete(args[0])
      }
      if (path === 'navigationPreferences.registerProjects') {
        calls.push(path)
        if (requestHandlers.has(path)) return Promise.resolve().then(() => requestHandlers.get(path)!(args))
        const next = registerNavigationProjects(sanitizeSnapshot(responses.get('navigationPreferences.get')), args[0], args[1])
        responses.set('navigationPreferences.get', next)
        navigationPreferenceListeners.forEach(listener => listener(next))
        return Promise.resolve(next)
      }
      if (path === 'navigationPreferences.get' && requestHandlers.has(path)) { calls.push(path); return Promise.resolve().then(() => requestHandlers.get(path)!(args)) }
      if (path === 'navigationPreferences.get' && responses.has(path)) {
        calls.push(path)
        return Promise.resolve(sanitizeSnapshot(responses.get(path)))
      }
      if (path === 'navigationPreferences.setThreadReadState') {
        const previous = responses.get('navigationPreferences.get') as NavigationPreferencesSnapshot
        const next = { ...previous, threadReadStates: { ...previous.threadReadStates, [args[0]]: args[1] } }
        responses.set('navigationPreferences.get', next)
        navigationPreferenceListeners.forEach(listener => listener(next))
        calls.push(path)
        return Promise.resolve(next)
      }
      if (path === 'generalPreferences.onInterfaceLanguageChanged') {
        languageListeners.add(args[0])
        return () => languageListeners.delete(args[0])
      }
      if (path === 'generalPreferences.setInterfaceLanguagePreference') {
        localLanguage = { ...localLanguage, interfaceLanguagePreference: args[0],
          interfaceLanguage: args[0] === 'system' ? localLanguage.systemLanguage : args[0], languageRevision: localLanguage.languageRevision + 1 }
        languageListeners.forEach(listener => listener(localLanguage))
        return Promise.resolve(localLanguage)
      }
      if (path.split('.').at(-1)?.startsWith('on')) return () => undefined
      if (path === 'supervisor.getSnapshot') return initialSupervisor.promise
      if (path === 'desktopSession.getStartupSnapshot') { calls.push(path); return localSession.promise }
      if (path === 'generalPreferences.getInterfaceLanguage') { calls.push(path); return Promise.resolve(localLanguage) }
      if (path === 'currentUserProfile.get') return Promise.resolve({ displayName: '', avatarDataUrl: null })
      if (path === 'appearance.get') return Promise.resolve({ ...DEFAULT_APPEARANCE, resolvedTheme: appearanceTheme })
      if (path === 'generalPreferences.get') return Promise.resolve({ ...localLanguage,
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

async function reset(target: RestorableLocation | null = { kind: 'camp', threadId }, resolveSupervisor = true) {
  if (root) flushSync(() => root!.unmount())
  timers.clear()
  listeners.clear()
  coreListeners.clear()
  navigationPreferenceListeners.clear()
  languageListeners.clear()
  localLanguage = { ...DEFAULT_GENERAL_PREFERENCES, interfaceLanguagePreference: 'zh-CN', interfaceLanguage: 'zh-CN' }
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
  check(document.querySelector('.language-bootstrap') && !document.querySelector('.startup-loading-canvas'),
    'The first committed frame must wait for the local language before rendering localized startup content')
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
  // Session state, interface language and preview retention are Main-owned
  // local reads; none enter Core authority before admission.
  check(calls.every(call => ['desktopSession.getStartupSnapshot', 'generalPreferences.getInterfaceLanguage', 'filePreview.updateRetention'].includes(call)), `Pre-ready authority calls: ${calls.join(', ')}`)
}

Object.assign(window, { startupTest: {
  async runProjects() {
    const cases: string[] = []
    const emptyNavigation: NavigationSnapshot = { schemaVersion: 3, throughGlobalSequence: 0, projects: [], quickChat: { totalCount: 0, recentThreads: [] } }
    const group = (path: string) => ({ projectKey: `directory:${path}`, projectPath: path, name: path.split('/').at(-1)!, totalCount: 1, recentThreads: [], lastActivityAt: '', lastActivityGlobalSequence: 0 })
    const health: HealthStatus = { core: { ok: true, version: 'fixture', dataDir: '/isolated/fixture' }, database: { ok: true, path: '/isolated/fixture/rovai.sqlite' }, git: { installed: true, version: 'fixture' }, hostPlatform: 'macos-arm64', runtimeCatalog: [], runtimePlatformAdmission: [], runtimeAvailability: [], searchEnvironment: { generation: 1, createdAt: '2026-08-31T00:00:00Z', pathEntryCount: 0, shell: { status: 'unavailable', interactive: false, shellName: null, entryCount: 0, elapsedMillis: 0 } } }
    const boot = async (preferences: NavigationPreferencesSnapshot, navigation = emptyNavigation, setup?: () => void) => {
      await reset({ kind: 'quick_chat' })
      responses.set('runtime.status.get', health)
      responses.set('members.list', [])
      responses.set('runtime.installations.list', [])
      responses.set('navigation.snapshot', navigation)
      responses.set('navigationPreferences.get', preferences)
      responses.set('memory.hearthReviewItems.list', [])
      responses.set('threads.deletionIssues', [])
      setup?.()
      onboarding.resolve({ schemaVersion: 2, status: 'completed', origin: 'existing_installation', completedAt: '2026-08-31T00:00:00Z', selectedMemberRole: null, memberAgentId: null, quickChatThreadId: null })
      publish({ runtimeMode: 'full_core', fullCoreState: 'ready', startupPhase: null, authorityState: { kind: 'current', origin: 'existing' }, capabilities: { ...supervisor.capabilities, authoritativeWorkspace: true, coreRequests: true } })
      await flush()
      for (let pass = 0; pass < 6 && !calls.includes('navigation.snapshot'); pass++) await advance(100)
      await flush()
    }
    const saved = () => responses.get('navigationPreferences.get') as NavigationPreferencesSnapshot
    const visible = (path: string) => !!document.querySelector(`[data-group="directory:${path}"]`)
    const refresh = async () => {
      coreListeners.forEach(listener => listener({ method: 'navigation.invalidated', params: { scope: 'all', reason: 'fixture' } }))
      await advance(100); await flush()
    }
    const add = async (path: string) => {
      responses.set('selectWorkspaceDirectory', { projectPath: path, name: path.split('/').at(-1)! })
      const button = document.querySelector<HTMLButtonElement>('.section-create-button[aria-label="选择工作目录"]')
      check(button && !button.disabled, 'Project add must remain available')
      button.click(); await flush(); await flush()
    }
    localStorage.setItem('rovai.current-project.v1', JSON.stringify({ kind: 'directory', projectPath: '/old-empty' }))
    await boot({ ...EMPTY_SNAPSHOT, projectNames: { 'directory:/old': '旧别名', 'directory:/alias-only': '残留' }, removedProjects: [{ targetKey: 'directory:/removed', removedAt: '2026-10-01T00:00:00Z' }] }, { ...emptyNavigation, projects: [group('/old'), group('/removed')] })
    check(saved().legacyProjectsSynced && saved().registeredProjects.includes('/old-empty') && saved().registeredProjects.includes('/old'), 'Complete import preserves the old empty selection before startup changes it: ' + JSON.stringify({ saved: saved(), calls }))
    check(!saved().registeredProjects.includes('/removed') && !saved().registeredProjects.includes('/alias-only'), 'Removal wins and aliases do not invent directories')
    check(document.body.textContent?.includes('旧别名'), 'Saved aliases remain visible')
    const writes = calls.filter(call => call === 'navigationPreferences.registerProjects').length
    const reads = calls.filter(call => call === 'navigationPreferences.get').length
    await refresh(); await refresh()
    check(calls.filter(call => call === 'navigationPreferences.registerProjects').length === writes && calls.filter(call => call === 'navigationPreferences.get').length === reads, 'Completed migration never rereads preferences or resynchronizes on navigation refresh')
    await add('/empty-a'); await add('/empty-b')
    check(visible('/empty-a') && visible('/empty-b'), 'All empty directories remain after switching')
    const restarted = structuredClone(saved())
    await boot(restarted)
    check(visible('/empty-a') && visible('/empty-b') && visible('/old'), 'Saved directories survive restart and zero remaining conversations')
    check(!calls.includes('navigationPreferences.registerProjects'), 'Completed startup does not attempt migration')
    cases.push('Empty directories survive switching and restart; completed migration performs no reads or writes during navigation refresh')
    await boot({ ...EMPTY_SNAPSHOT, legacyProjectsSynced: true }, { ...emptyNavigation, projects: [group('/old')] })
    check(!visible('/old') && !calls.includes('navigationPreferences.registerProjects'), 'An intentionally empty completed list cannot revive legacy projects')
    await add('/after-complete')
    check(saved().registeredProjects.includes('/after-complete'), 'Completion does not disable explicit directory saving')
    cases.push('An empty completed list stays empty until an explicit add')
    await boot(structuredClone(EMPTY_SNAPSHOT), { ...emptyNavigation, projects: [group('/fallback')] }, () => requestHandlers.set('navigationPreferences.registerProjects', () => { throw new Error('fixture save failed') }))
    check(visible('/fallback') && !saved().legacyProjectsSynced, 'Failed migration keeps legacy navigation and does not mark completion')
    const failedWrites = calls.filter(call => call === 'navigationPreferences.registerProjects').length
    await refresh(); await refresh()
    check(calls.filter(call => call === 'navigationPreferences.registerProjects').length === failedWrites, 'Failure does not start automatic retry')
    const previousSelection = localStorage.getItem('rovai.current-project.v1')
    await add('/unsaved')
    check(!visible('/unsaved') && !saved().registeredProjects.includes('/unsaved') && localStorage.getItem('rovai.current-project.v1') === previousSelection, 'A failed add neither displays nor selects an unsaved directory')
    check(document.querySelector('.app-toast')?.textContent?.includes('项目目录未保存，请重新添加。') && !document.querySelector('.app-toast-action, .error-banner'), 'A failed add gives one ordinary notice with no recovery action or banner')
    await advance(6000)
    check(!document.querySelector('.app-toast'), 'The ordinary save failure notice expires')
    requestHandlers.delete('navigationPreferences.registerProjects')
    await add('/unsaved')
    check(saved().registeredProjects.includes('/unsaved') && visible('/unsaved') && !saved().legacyProjectsSynced, 'Adding again saves and displays the directory without reopening legacy import')
    cases.push('Failed import keeps legacy projects; failed adds remain absent until a successful add')
    await boot(structuredClone(EMPTY_SNAPSHOT), { ...emptyNavigation, projects: [group('/fallback')] }, () => requestHandlers.set('navigationPreferences.get', () => { throw new Error('fixture read failed') }))
    check(visible('/fallback'), 'First preference read failure cannot hide successful Core navigation')
    await boot(structuredClone(EMPTY_SNAPSHOT), { ...emptyNavigation, projects: [group('/fallback')] })
    check(saved().legacyProjectsSynced && saved().registeredProjects.includes('/fallback'), 'The next startup can complete legacy import after storage recovers')
    requestHandlers.set('navigationPreferences.registerProjects', () => { throw new Error('fixture later save failed') })
    await add('/unsaved-after-completion')
    check(saved().legacyProjectsSynced && !visible('/unsaved-after-completion') && !document.querySelector('.error-banner'), 'A later save failure keeps the completed marker without a temporary row or persistent banner')
    cases.push('First preference read failure preserves ordinary navigation')
    return { ok: true, cases }
  },

  captureNavigation: (theme: 'day' | 'night', collapsed: boolean) => captureNavigation(theme, collapsed),
  captureStoppedThread: (theme: 'day' | 'night') => captureStoppedThread(theme),
  async run() {
    const cases: string[] = []
    await reset(null, false)
    pageFrame('location', true)
    noAuthority()
    cases.push('the local language resolves before null initial snapshots show the brand canvas')

    for (const target of [{ kind: 'camp', threadId }, { kind: 'members', agentId: null, tab: 'identity' },
      { kind: 'memory' }, { kind: 'quick_chat' }] as RestorableLocation[]) {
      await reset(target)
      pageFrame(target.kind, true)
      await advance(399)
      pageFrame(target.kind, true)
      await advance(1)
      pageFrame(target.kind, true)
      noAuthority()
      cases.push(`${target.kind}: full-window brand feedback starts immediately and stays visible`)
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
    await flush()
    pageFrame('camp', true)
    await advance(399)
    pageFrame('camp', true)
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

    await reset({ kind: 'camp', threadId }, false)
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
    check(document.querySelector('.onboarding-welcome'), 'A real first install proceeds immediately once ready')
    check(!document.querySelector('.startup-loading-canvas, .bootstrap-shell'), 'Ready onboarding replaces the initial loading canvas')
    check(!calls.includes('threads.enter'), 'A fresh first-run flow must not enter an existing Camp')
    cases.push('first-run authority gate stays intact and ready onboarding replaces loading immediately')
    const welcome = document.querySelector('.onboarding-welcome')
    const languages = document.querySelectorAll<HTMLInputElement>('input[name="onboarding-language"]')
    check(languages.length === 3, 'Onboarding exposes system, Simplified Chinese and English in the existing position')
    document.querySelector<HTMLInputElement>('input[name="onboarding-language"][value="en"]')!.click()
    await flush()
    check(document.documentElement.lang === 'en' && document.querySelector('#onboarding-welcome-title')?.textContent === 'Welcome to Rovai',
      'Manual English updates app-owned content and the page language')
    document.querySelector<HTMLInputElement>('input[name="onboarding-language"][value="system"]')!.click()
    await flush()
    check(localLanguage.interfaceLanguagePreference === 'system' && document.querySelector<HTMLInputElement>('input[name="onboarding-language"][value="system"]')!.checked,
      'Switching to system retains the preference even when the effective language stays English')
    check(document.querySelector('.onboarding-welcome') === welcome, 'Changing language preserves the current component tree')
    cases.push('Onboarding language choices update in place and distinguish system from its resolved language')

    await reset()
    await advance(350)
    publish({ runtimeMode: 'full_core', fullCoreState: 'ready', startupPhase: null,
      authorityState: { kind: 'current', origin: 'existing' },
      capabilities: { ...supervisor.capabilities, authoritativeWorkspace: true, coreRequests: true } })
    await flush()
    pageFrame('camp', true)
    await advance(49)
    pageFrame('camp', true)
    await advance(1)
    pageFrame('camp', true)
    onboarding.resolve({ schemaVersion: 2, status: 'completed', origin: 'existing_installation',
      completedAt: '2026-08-30T00:00:00Z', selectedMemberRole: null, memberAgentId: null, quickChatThreadId: null })
    await flush()
    // The production restore path intentionally paints the route before entering
    // the Camp. Allow that additional pair of frames to complete.
    await flush()
    check(calls.includes('threads.enter'), 'The restored Camp begins loading once authority and onboarding are ready')
    check(!calls.includes('navigation.threadViewed') && !calls.includes('desktopSession.commitRestorableLocation'),
      'A candidate route is not a committed/read Camp')
    check(document.querySelector('.startup-loading-canvas[data-startup-route="camp"]'), 'The same brand canvas survives authority handoff')
    check(!document.querySelector('.bootstrap-shell, .onboarding-app-shell'), 'No intermediate recovery shell')
    const currentRail = document.querySelector('.unified-sidebar')
    listeners.forEach(listener => listener(starting()))
    await flush()
    check(currentRail === document.querySelector('.unified-sidebar'), 'A stale Supervisor revision cannot reset the workspace')
    cases.push('ready handoff keeps loading visible until real Camp authority is available')

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
      'Local session failure must replace loading with recovery immediately')
    check(!document.body.textContent?.includes('Local session read failed'), 'Local technical failure stays out of visible copy')
    noAuthority()
    cases.push('local preference read errors stay local and replace loading with recovery immediately')

    await reset({ kind: 'members', agentId: null, tab: 'runtime' })
    const health: HealthStatus = {
      core: { ok: true, version: 'fixture', dataDir: '/isolated/fixture' },
      database: { ok: true, path: '/isolated/fixture/rovai.sqlite' },
      git: { installed: true, version: 'fixture' },
      hostPlatform: 'macos-arm64', runtimeCatalog: [], runtimePlatformAdmission: [], runtimeAvailability: [],
      searchEnvironment: { generation: 1, createdAt: '2026-08-31T00:00:00Z', pathEntryCount: 0,
        shell: { status: 'unavailable', interactive: false, shellName: null, entryCount: 0, elapsedMillis: 0 } }
    }
    responses.set('runtime.status.get', health)
    responses.set('members.list', [])
    responses.set('runtime.installations.list', [])
    onboarding.resolve({ schemaVersion: 2, status: 'completed', origin: 'existing_installation',
      completedAt: '2026-08-31T00:00:00Z', selectedMemberRole: null, memberAgentId: null, quickChatThreadId: null })
    publish({ runtimeMode: 'full_core', fullCoreState: 'ready', startupPhase: null,
      authorityState: { kind: 'current', origin: 'existing' },
      capabilities: { ...supervisor.capabilities, authoritativeWorkspace: true, coreRequests: true } })
    await flush()
    await flush()
    await advance(0)
    check(coreListeners.size > 0, 'The production App must subscribe to Core events')
    for (const events of [
      ['runtime.availability.updated'],
      ['runtime.discovery.updated'],
      ['runtime.discovery.completed'],
      ['runtime.discovery.updated', 'runtime.availability.updated'],
      ['runtime.availability.updated', 'runtime.discovery.completed'],
      ['runtime.availability.updated']
    ] as const) {
      calls.length = 0
      for (const method of events) {
        coreListeners.forEach(listener => listener({ method, params: { runtimeKind: 'copilot-cli' } }))
      }
      await flush()
      check(calls.filter(call => call === 'runtime.status.get').length === 1, `${events}: refresh Runtime status once`)
      check(calls.filter(call => call === 'runtime.installations.list').length === 1, `${events}: refresh installations once`)
      check(!calls.includes('members.list'), `${events}: Runtime status events must not reload members`)
    }
    cases.push('Runtime availability refreshes health and installations without reloading members')
    cases.push('Runtime discovery coalesces same-tick events without reloading members')

    await advance(STARTUP_LOADING_EXIT_MS)
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
    responses.set('runtime.status.get', health)
    responses.set('members.list', [])
    responses.set('runtime.installations.list', [])
    responses.set('navigation.snapshot', { schemaVersion: 3, projects: [], quickChat: { recentThreads: [], totalCount: 0 } })
    const navPreferences: NavigationPreferencesSnapshot = { schemaVersion: 6, registeredProjects: [], legacyProjectsSynced: false, pins: [], removedProjects: [], projectOrder: [], projectNames: {}, threadReadStates: {} }
    responses.set('navigationPreferences.get', navPreferences)
    responses.set('memory.hearthReviewItems.list', [])
    responses.set('memory.list', { capacities: [], memories: ['M', 'N'].map(id => ({
      id, scope: 'hearth', kind: 'preference', creationOrigin: 'user', companionAgentId: null,
      relationshipAgentIds: [], direction: null, directedActorAgentId: null, lifecycle: 'active',
      currentRevisionId: 'revision-' + id, currentBody: '导航记忆 ' + id, currentBodyUtf8Bytes: 16,
      currentRetrievalKeys: [id], reviewAfter: null, reviewDue: false, outgoingSuccessorIds: [], incomingPredecessorIds: [],
      version: 1, createdAt: '2026-09-13T00:00:00Z', updatedAt: '2026-09-13T00:00:00Z', retiredAt: null, forgottenAt: null, revisions: []
    })) })
    onboarding.resolve({ schemaVersion: 2, status: 'completed', origin: 'existing_installation',
      completedAt: '2026-08-31T00:00:00Z', selectedMemberRole: null, memberAgentId: null, quickChatThreadId: null })
    publish({ runtimeMode: 'full_core', fullCoreState: 'ready', startupPhase: null,
      authorityState: { kind: 'current', origin: 'existing' },
      capabilities: { ...supervisor.capabilities, authoritativeWorkspace: true, coreRequests: true } })
    await flush(); await advance(0); await flush()
    await advance(STARTUP_LOADING_EXIT_MS)
    check(!document.querySelector('.startup-loading-canvas'), 'The ready workspace releases its startup canvas after the exit transition')
    const clickNavigation = async (name: string, selector = 'button') => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(selector)].find(item => item.textContent?.trim() === name || item.getAttribute('aria-label') === name)
      check(button && !button.disabled, 'Missing available navigation button: ' + name)
      button.click(); await flush(); await flush()
    }
    const back = async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', metaKey: true, bubbles: true, cancelable: true })); await flush(); await flush() }
    const forward = async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', metaKey: true, bubbles: true, cancelable: true })); await flush(); await flush() }
    const shortcut = async (key: string) => { window.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true })); await flush(); await flush() }
    const openMemory = async () => {
      await clickNavigation('设置', '.unified-sidebar button')
      await clickNavigation('记忆', '.settings-sidebar-menu button')
    }
    const jumpToThread = async (name: string) => {
      await shortcut('k')
      const button = [...document.querySelectorAll<HTMLButtonElement>('.command-palette-item')].find(item => item.querySelector('.truncate')?.textContent === name)
      check(button && !button.disabled, 'Missing conversation jump result: ' + name)
      button.click(); await flush(); await flush()
    }
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
    await openMemory()
    check(document.querySelector('.memory-catalog-item.selected')?.textContent?.includes('导航记忆 M'), 'Memory uses the real initial list selection')
    const memoryRows = [...document.querySelectorAll<HTMLButtonElement>('.memory-catalog-item')]
    check(memoryRows.length === 2, 'The fixture must have two distinct memory targets')
    memoryRows[1].click(); await flush(); await flush()
    check(document.querySelector('.memory-catalog-item.selected')?.textContent?.includes('导航记忆 N'), 'Selecting a resource navigates to it')
    await back()
    check(document.querySelector('.memory-catalog-item.selected')?.textContent?.includes('导航记忆 M'), 'Back restores the previous memory detail')
    await back(); check(document.querySelector('.settings-panel-general'), 'Automatic first memory selection replaces rather than pushes')
    await back(); check(document.querySelector('.compose-content'), 'Memory entry retains the real Settings step')
    await forward(); check(document.querySelector('.settings-panel-general'), 'Forward restores the Settings entry')
    await forward(); check(document.querySelector('.memory-catalog-item.selected')?.textContent?.includes('导航记忆 M'), 'Forward restores memory ID after remount')
    await clickNavigation('通用', '.settings-sidebar-menu button')
    await back()
    await back(); check(document.querySelector('.settings-panel-general'), 'Back traverses the Settings entry before the main workspace')
    await back(); check(document.querySelector('.compose-content'), 'Main-page layout controls remain outside Settings and Memory')
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
      schemaVersion: 9, tasksEnabled: false, throughGlobalSequence: 0,
      thread: { id, title: '导航会话 ' + id, activationState: 'active', projectBindingKind: 'quick_chat',
        projectPath: '/fixture/quick-chat', defaultLeadAgentId: null, membershipGeneration: 1, version: 1, createdAt: stamp, updatedAt: stamp },
      members: [], membershipReconciliations: [], tasks: [], messages: [], messageDeliveries: [], turns: [],
      agentRuns: [], executionEvidence: [], approvals: [], agentRunFileChanges: [],
      coverage: { tasks: coverage, messages: { ...coverage, hasEarlier: false, oldestLoadedSequence: null, newestLoadedSequence: null },
        messageDeliveries: coverage, turns: coverage, agentRuns: coverage, approvals: coverage }
    })
    responses.set('navigation.snapshot', { schemaVersion: 3, throughGlobalSequence: 0, projects: [], quickChat: {
      totalCount: 4, recentThreads: ['A', 'B', 'C', 'D'].map(id => ({ id, title: '导航会话 ' + id, activationState: 'active',
        projectBindingKind: 'quick_chat', projectPath: '/fixture/quick-chat', defaultLead: null, marker: 'none',
        lastActivityAt: stamp, lastActivityGlobalSequence: 0, latestCompletionGlobalSequence: 0, version: 1 }))
    } })
    requestHandlers.set('navigation.threads', ({ threadIds }) => ({ throughGlobalSequence: 0, groupKeys: ['quick-chat'],
      threads: (responses.get('navigation.snapshot') as NavigationSnapshot).quickChat.recentThreads.filter(camp => threadIds.includes(camp.id)) }))
    responses.set('navigation.threadViewed', { changed: false, navigation: { throughGlobalSequence: 0, groupKeys: ['quick-chat'], threads: [] } })
    responses.set('skills.list', [])
    responses.set('skills.deliveryGroups.list', [])
    responses.set('skills.candidates', { skills: [], errors: [] })
    responses.set('threads.exists', true)
    responses.set('threads.pendingDraft.setPresence', { changed: false })
    requestHandlers.set('thread.composerDraft.get', ({ threadId }) => ({ threadId, body: '', content: { version: 2, segments: [] },
      revision: 1, attachments: [], replyIntent: null, continuationIntent: null, updatedAt: stamp, expiresAt: null }))
    requestHandlers.set('thread.pendingInputs.get', ({ threadId }) => ({ threadId, executionActive: false, editSession: null, items: [] }))
    let campRequest = (id: string): unknown => campProjection(id)
    requestHandlers.set('threads.enter', ({ command }) => campRequest(command.threadId))
    requestHandlers.set('threads.open', ({ threadId }) => campRequest(threadId))
    for (const listener of coreListeners) listener({ method: 'navigation.invalidated', params: {} } as CoreEvent)
    await advance(500); await flush()
    await clickNavigation('返回 App', '.settings-sidebar-back')
    await clickNavigation('导航会话 A', '.camp-nav-open')
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 A', 'Camp A is a real authoritative navigation destination')
    const markUnread = async (id: string) => {
      const next = { ...(responses.get('navigationPreferences.get') as NavigationPreferencesSnapshot),
        threadReadStates: { [id]: { manualUnread: true, readThroughGlobalSequence: 0 } } }
      responses.set('navigationPreferences.get', next)
      navigationPreferenceListeners.forEach(listener => listener(next))
      await flush(); await flush()
    }
    const manualUnread = (id: string) => (responses.get('navigationPreferences.get') as NavigationPreferencesSnapshot).threadReadStates[id]?.manualUnread
    await markUnread('A')
    window.dispatchEvent(new Event('focus'))
    for (const listener of coreListeners) listener({ method: 'navigation.invalidated', params: {} } as CoreEvent)
    await advance(500); await flush()
    check(manualUnread('A') && document.querySelector('[data-thread-id="A"] .camp-unread-dot'),
      'Manual unread on the active Thread survives focus and navigation refresh')
    await clickNavigation('导航会话 A', '.camp-nav-open')
    check(manualUnread('A') === false, 'Explicit successful reopening clears the manual reminder')

    let stoppedRun = { ...runTemplate, id: 'manual-stop-run', threadTurnId: null,
      invocationKind: 'batch' as const, executionEvidenceCount: 0, executionEvidenceChangeSequence: 0 }
    let stopReadUnavailable = false
    campRequest = id => {
      if (id === 'A' && stopReadUnavailable) throw new Error('Fixture stop read unavailable')
      return id === 'A' ? { ...campProjection(id), members: runFixture.members, agentRuns: [stoppedRun] } : campProjection(id)
    }
    const reopenRunningThread = async () => {
      stoppedRun = { ...stoppedRun, status: 'running', cancelRequestedAt: null, cancelReasonCode: null, endedAt: null }
      await clickNavigation('导航会话 B', '.camp-nav-open')
      await clickNavigation('导航会话 A', '.camp-nav-open')
      await clickNavigation('会话', '.camp-conversation-view-controls button')
      check(document.querySelector('.run-presence-stop'), 'The real Thread must offer its Run stop action')
      check(!manualUnread('A'), 'A reopened Thread starts without a manual reminder')
    }
    const stopRun = async () => {
      const stop = document.querySelector<HTMLButtonElement>('.run-presence-stop')!
      stop.scrollIntoView({ block: 'center' })
      await flush()
      stop.click()
      await advance(0); await flush()
      const confirm = document.querySelector<HTMLButtonElement>('.run-presence-stop-confirmation .danger-button')
      check(confirm && !confirm.disabled, 'Stop confirmation must be available: ' + JSON.stringify({
        label: stop.getAttribute('aria-label'), disabled: stop.disabled, rect: stop.getBoundingClientRect().toJSON(),
        popover: document.querySelector('.run-presence-stop-confirmation')?.textContent
      }))
      confirm.click(); await flush(); await flush()
    }
    const cancelResult = () => ({ status: 'applied', code: 'agent_run.cancelled', payload: {
      agentRunId: stoppedRun.id, status: 'cancelled' } })
    const settleStop = () => { stoppedRun = { ...stoppedRun, status: 'cancelled',
      cancelRequestedAt: stamp, cancelReasonCode: 'user_requested_agent_run_stop', endedAt: stamp } }
    const stopReply = deferred<unknown>()
    requestHandlers.set('agentRuns.cancel', () => stopReply.promise)
    await reopenRunningThread()
    await stopRun()
    check(!manualUnread('A'), 'A pending stop must not create a reminder')
    await clickNavigation('导航会话 B', '.camp-nav-open')
    settleStop(); stopReply.resolve(cancelResult()); await flush(); await flush()
    check(!manualUnread('A') && !document.querySelector('[data-thread-id="A"] .camp-unread-dot') && !manualUnread('B'),
      'A successful stop must not mark either Thread unread after navigation')
    await clickNavigation('导航会话 A', '.camp-nav-open')
    check(!manualUnread('A'), 'Reopening a stopped Thread preserves its normal read state')

    await reopenRunningThread()
    requestHandlers.set('agentRuns.cancel', () => { settleStop(); return cancelResult() })
    await stopRun()
    window.dispatchEvent(new Event('focus'))
    for (const listener of coreListeners) listener({ method: 'navigation.invalidated', params: {} } as CoreEvent)
    await advance(500); await flush()
    check(!manualUnread('A') && !document.querySelector('[data-thread-id="A"] .camp-unread-dot'),
      'A successful stop must not create a blue dot while the current Thread is focused and refreshed')

    for (const result of [
      { status: 'rejected', code: 'command.version_conflict', payload: {} },
      { status: 'applied', code: 'agent_run.already_terminal', payload: { agentRunId: stoppedRun.id, status: 'succeeded' } }
    ]) {
      await reopenRunningThread()
      requestHandlers.set('agentRuns.cancel', () => result)
      await stopRun()
      check(!manualUnread('A'), 'Rejected stops and already-terminal results must not create reminders')
    }

    await reopenRunningThread()
    requestHandlers.set('agentRuns.cancel', () => {
      settleStop(); stopReadUnavailable = true
      throw new Error('Fixture lost stop receipt')
    })
    await stopRun()
    check(!manualUnread('A'), 'An unknown stop outcome must not create a reminder before reconciliation')
    const reminderWrites = calls.filter(call => call === 'navigationPreferences.setThreadReadState').length
    stopReadUnavailable = false
    for (const listener of coreListeners) listener({ method: 'agent_run.terminal', params: { threadId: 'A' } } as CoreEvent)
    await flush(); await flush()
    check(!manualUnread('A') && !document.querySelector('[data-thread-id="A"] .camp-unread-dot'),
      'A later authoritative cancelled Run must not create a lost-receipt reminder')
    for (const listener of coreListeners) listener({ method: 'agent_run.terminal', params: { threadId: 'A' } } as CoreEvent)
    await flush(); await flush()
    check(calls.filter(call => call === 'navigationPreferences.setThreadReadState').length === reminderWrites,
      'Terminal refreshes must not save a stop reminder')
    requestHandlers.delete('agentRuns.cancel')
    campRequest = id => campProjection(id)
    await clickNavigation('导航会话 A', '.camp-nav-open')
    cases.push('User stops do not create a Thread unread reminder, including lost receipts and navigation races')
    await markUnread('A')
    cases.push('Manual unread survives automatic observation and clears only after an explicit successful open')
    const switchCallStart = calls.length
    await clickNavigation('导航会话 B', '.camp-nav-open')
    await flush(); await flush()
    const switchCalls = calls.slice(switchCallStart)
    check(!switchCalls.some(method => ['navigation.snapshot', 'navigation.groupThreads', 'missions.list', 'skills.candidates', 'navigation.threadViewed'].includes(method)),
      'An ordinary read Camp switch must not read the sidebar, Missions or Skill directories, or acknowledge again')
    check(switchCalls.includes('navigation.threads'), 'Camp switching validates only the target navigation row')
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
    check(manualUnread('A') === false, 'Explicit history navigation clears the reminder after the full projection opens')
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
    await markUnread('C')
    await clickNavigation('导航会话 C', '.camp-nav-open')
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 B', 'A failed Camp read keeps the displayed page')
    check(manualUnread('C'), 'A failed explicit open must preserve the manual unread reminder')
    await back(); check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 A', 'Failed reads do not consume a history entry')
    campRequest = id => { if (id === 'B') throw new Error('Fixture Camp removed'); return campProjection(id) }
    requestHandlers.set('threads.exists', ({ threadId }) => threadId !== 'B')
    await forward(); check(document.querySelector('.compose-content'), 'A deleted historical Camp resolves to the valid home page')
    await back(); check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 A', 'Deleted-resource fallback replaces the current entry')
    const pendingDiscard = deferred<unknown>()
    requestHandlers.set('threads.discardPending', () => pendingDiscard.promise)
    campRequest = id => {
      const projection = campProjection(id)
      return id === 'D' ? { ...projection, thread: { ...projection.thread, activationState: 'pending' } } : projection
    }
    await clickNavigation('导航会话 D', '.camp-nav-open')
    await flush(); await flush()
    await clickNavigation('导航会话 A', '.camp-nav-open')
    await flush(); await flush()
    check(calls.includes('threads.discardPending'), 'Leaving the loaded empty Camp must initiate cleanup before the race is tested')
    await back(); check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 D', 'A blank pending Camp can be revisited before its leave cleanup finishes')
    pendingDiscard.resolve({ status: 'applied', code: 'thread.pending_discarded', payload: {} }); await flush(); await flush()
    check(document.querySelector('.compose-content'), 'Late cleanup of the revisited empty Camp replaces it with a valid page')
    await forward(); check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 A', 'Empty Camp cleanup preserves the forward branch')
    cases.push('Desktop Camp navigation preserves the forward branch, ignores stale reads and retains the page on failure')
    campRequest = id => campProjection(id)
    requestHandlers.delete('threads.exists')
    await clickNavigation('导航会话 B', '.camp-nav-open')
    await markUnread('B')
    await clickNavigation('导航会话 A', '.camp-nav-open')
    campRequest = id => { if (id === 'B') throw new Error('Fixture full projection unavailable'); return campProjection(id) }
    await clickNavigation('导航会话 B', '.camp-nav-open')
    check(manualUnread('B'), 'A cached preview after projection failure must retain manual unread')
    campRequest = id => campProjection(id)
    await clickNavigation('导航会话 A', '.camp-nav-open')
    cases.push('Failed opens with and without cached projections retain manual unread')
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
        selectedMemberRole: null, memberAgentId: null, quickChatThreadId: null })
      publish({ runtimeMode: 'full_core', fullCoreState: 'ready', startupPhase: null, authorityState: { kind: 'current', origin: 'existing' },
        capabilities: { ...supervisor.capabilities, authoritativeWorkspace: true, coreRequests: true } })
      await flush(); await advance(0); await flush(); await advance(0); await flush()
      await advance(STARTUP_LOADING_EXIT_MS)
      await clickNavigation('导航会话 A', '.camp-nav-open')
      await clickNavigation('导航会话 B', '.camp-nav-open')
      if (collapsed) await clickNavigation('收起导航侧栏')
      document.documentElement.dataset.theme = theme
      await flush()
      const center = (selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect()
        return rect.y + rect.height / 2
      }
      check(document.querySelectorAll('.camp-detail-entry').length === 2
        && !document.querySelector('.camp-detail-entry[data-detail="tasks"]'),
      'The real Camp header keeps its two actions while Tasks are disabled')
      return { control: center('.navigation-collapse-button'), title: center('.camp-topbar h1'), actions: center('.camp-detail-entry') }
    }

    captureStoppedThread = async theme => {
      await captureNavigation(theme, false)
      campRequest = id => id === 'A'
        ? { ...campProjection(id), members: runFixture.members, agentRuns: [stoppedRun] }
        : campProjection(id)
      requestHandlers.set('agentRuns.cancel', () => { settleStop(); return cancelResult() })
      await reopenRunningThread()
      await stopRun()
      const dot = document.querySelector<HTMLElement>('[data-thread-id="A"] .camp-unread-dot')
      check(!dot, 'The stopped Thread must not acquire an unread dot in ' + theme)
      await flush()
    }

    // Hold the authority response so cached navigation is a behavioral assertion,
    // independent of machine speed or the post-response meaningful-paint log.
    {
      let tasksEnabled = false
      let taskSequence = 0
      const taskSnapshot = () => ({ enabled: tasksEnabled, headsUpAfterSequence: 0,
        observedThroughChangeSequence: taskSequence })
      const cachedProjection = (id: string) => {
        const projection = campProjection(id)
        const body = '缓存正文 ' + id
        return { ...projection, tasksEnabled,
          ...(tasksEnabled ? { tasks: [] } : { tasks: undefined }),
          messages: [{ ...runFixture.messages[0], id: 'cached-' + id, sequence: 1,
            body, content: [{ kind: 'text', text: body }] }],
          coverage: { ...projection.coverage, tasks: tasksEnabled ? coverage : undefined,
            messages: { loadedCount: 1, totalCount: 1, omittedCount: 0, complete: true,
              hasEarlier: false, oldestLoadedSequence: 1, newestLoadedSequence: 1 } } }
      }
      const displayed = (id: string) => document.querySelector('.camp-topbar h1')?.textContent === '导航会话 ' + id
        && document.querySelector('[data-message-id="cached-' + id + '"]')?.textContent?.includes('缓存正文 ' + id)
      const taskEntry = () => document.querySelector<HTMLButtonElement>('.camp-detail-entry[data-detail="tasks"]')
      const publishTasks = async (enabled: boolean) => {
        tasksEnabled = enabled
        ++taskSequence
        responses.set('preferences.tasks.get', taskSnapshot())
        coreListeners.forEach(listener => listener({ method: 'preferences.tasks_changed', params: {} } as CoreEvent))
        await flush(); await flush()
      }
      await captureNavigation('day', false, () => {
        responses.set('preferences.tasks.get', taskSnapshot())
        responses.set('generalPreferences.get', { worldMapEnabled: false })
        campRequest = cachedProjection
      })
      check(displayed('B'), 'The cache scenario starts with real message content in B')
      for (const enabled of [false, true]) {
        if (enabled) {
          await publishTasks(true)
          check(taskEntry(), 'Enabling Tasks refreshes the current projection')
        }
        for (const id of ['A', 'B', 'A', 'B']) {
          const authority = deferred<ReturnType<typeof cachedProjection>>()
          campRequest = target => target === id ? authority.promise : cachedProjection(target)
          const before = calls.length
          await clickNavigation('导航会话 ' + id, '.camp-nav-open')
          check(displayed(id), 'A revisit must display cached messages before authority returns; tasks=' + enabled)
          check(calls.slice(before).filter(method => method === 'threads.enter').length === 1,
            'A cached revisit still verifies authority exactly once')
          check(!calls.slice(before).includes('threads.open'), 'Ordinary switching must not add a capability refresh')
          authority.resolve(cachedProjection(id))
          await flush(); await flush()
          campRequest = cachedProjection
          check(Boolean(taskEntry()) === enabled, 'The verified projection uses the current Task capability')
        }
      }
      const unchangedStart = calls.length
      await publishTasks(true)
      check(!calls.slice(unchangedStart).includes('threads.open'), 'An unchanged capability observation must not refresh the Thread')
      cases.push('Cached Thread revisits show messages before authority returns without redundant reads, with Tasks off and on')

      taskEntry()!.click(); await flush(); await flush()
      check(document.querySelector('.task-panel-scroll'), 'The Task panel is open before disabling the capability')
      const lateEnabled = deferred<ReturnType<typeof cachedProjection>>()
      const oldEnabledProjection = cachedProjection('B')
      let firstRead = true
      campRequest = id => {
        if (id === 'B' && firstRead) { firstRead = false; return lateEnabled.promise }
        return cachedProjection(id)
      }
      coreListeners.forEach(listener => listener({ method: 'agent_run.terminal', params: { threadId: 'B' } } as CoreEvent))
      await flush(); await flush()
      check(!firstRead, 'A projection read is in flight before disabling Tasks')
      await publishTasks(false)
      check(displayed('B') && !taskEntry() && !document.querySelector('.task-panel-scroll'),
        'Disabling Tasks closes its panel and keeps the conversation content')
      lateEnabled.resolve(oldEnabledProjection)
      await flush(); await flush()
      check(!taskEntry(), 'A late enabled projection cannot restore disabled Task UI')
      campRequest = cachedProjection
      const afterDisable = deferred<ReturnType<typeof cachedProjection>>()
      campRequest = id => id === 'A' ? afterDisable.promise : cachedProjection(id)
      await clickNavigation('导航会话 A', '.camp-nav-open')
      check(displayed('B'), 'An actual disable invalidates A cached under the enabled capability')
      afterDisable.resolve(cachedProjection('A'))
      await flush(); await flush()
      check(displayed('A') && !taskEntry(), 'A fresh disabled projection becomes the new cache entry')
      campRequest = cachedProjection
      cases.push('Actual Task disable clears incompatible caches and panels while rejecting late enabled UI')

      // Enabling can race an enter for a different Thread. The old disabled
      // response must not leave that destination without its restored Task UI.
      const lateDisabled = deferred<ReturnType<typeof cachedProjection>>()
      const oldDisabledProjection = cachedProjection('C')
      let firstEnter = true
      campRequest = id => {
        if (id === 'C' && firstEnter) { firstEnter = false; return lateDisabled.promise }
        return cachedProjection(id)
      }
      await clickNavigation('导航会话 C', '.camp-nav-open')
      check(displayed('A') && !firstEnter, 'A cold destination waits for its in-flight enter')
      await publishTasks(true)
      lateDisabled.resolve(oldDisabledProjection)
      await flush(); await flush(); await flush()
      check(displayed('C') && taskEntry(), 'Enabling during enter must converge the destination to the enabled projection')
      const cycled = deferred<ReturnType<typeof cachedProjection>>()
      campRequest = id => id === 'D' ? cycled.promise : cachedProjection(id)
      await clickNavigation('导航会话 D', '.camp-nav-open')
      await publishTasks(false)
      const intermediateProjection = cachedProjection('D')
      await publishTasks(true)
      campRequest = cachedProjection
      cycled.resolve(intermediateProjection)
      await flush(); await flush(); await flush()
      check(displayed('D') && taskEntry(), 'An off/on cycle must also reject a projection from the intermediate disabled state')

      const alreadyCurrent = deferred<ReturnType<typeof cachedProjection>>()
      campRequest = id => id === 'B' ? alreadyCurrent.promise : cachedProjection(id)
      await clickNavigation('导航会话 B', '.camp-nav-open')
      await publishTasks(false)
      const currentStart = calls.length
      alreadyCurrent.resolve(cachedProjection('B'))
      await flush(); await flush()
      check(displayed('B') && !taskEntry() && !calls.slice(currentStart).includes('threads.open'),
        'A response already matching the new capability commits without another read')
      cases.push('Task capability changes during enter cannot commit the previous capability projection')
    }

    // Use the real startup restore and workspace gates: the Thread is ready
    // before missions.list, so selection/snapshot readiness alone cannot ACK.
    const originalHasFocus = document.hasFocus.bind(document)
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true })
    for (const outcome of ['loaded', 'failed'] as const) {
      await reset({ kind: 'camp', threadId: 'A' })
      for (const [method, response] of navigationResponses) responses.set(method, response)
      for (const [method, handler] of navigationHandlers) requestHandlers.set(method, handler)
      const mission: MissionRecord = { missionId: 'mission-attention', threadId: 'A', number: 1,
        title: '恢复的使命', description: '', status: 'not_started', sourceMessageId: null,
        projectPath: '/fixture/quick-chat', projectBindingKind: 'quick_chat', detailsVersion: 1,
        tags: [], attachments: [], createdAt: stamp, updatedAt: stamp, memberAgentIds: [],
        defaultLeadAgentId: null, runningAgentIds: [], startAvailable: false, hasUnread: false,
        workspaceEverCreated: false, workspaceResourcesPresent: false, cleanupAvailable: false }
      const projection = campProjection('A')
      campRequest = id => id === 'A'
        ? { ...projection, thread: { ...projection.thread, missionId: mission.missionId } }
        : campProjection(id)
      const missions = deferred<MissionRecord[]>()
      requestHandlers.set('missions.list', () => missions.promise)
      const task = { enabled: false, headsUpAfterSequence: 0, observedThroughChangeSequence: 10 }
      responses.set('preferences.tasks.get', task)
      responses.set('notifications.inbox', { schemaVersion: 11, throughChangeSequence: 10, unreadCount: 1, items: [], nextCursor: null })
      responses.set('notifications.changesSince', { schemaVersion: 11, nextChangeSequence: 10,
        resetRequired: false, hasMore: false, taskCapability: task, changes: [] })
      let unread = true
      const acknowledgements: unknown[] = []
      requestHandlers.set('notifications.threadInterruptions', ({ threadIds }) => ({ throughChangeSequence: 10,
        threads: threadIds.map(threadId => ({ threadId, hasUnreadInterruption: threadId === 'A' && unread })) }))
      requestHandlers.set('notifications.acknowledgeThreadInterruptions', request => {
        acknowledgements.push(request)
        unread = false
        return { commandId: request.commandId, status: 'applied', code: 'ok', payload: { resultingChangeSequence: 10 } }
      })
      onboarding.resolve({ schemaVersion: 2, status: 'completed', origin: 'existing_installation', completedAt: stamp,
        selectedMemberRole: null, memberAgentId: null, quickChatThreadId: null })
      publish({ runtimeMode: 'full_core', fullCoreState: 'ready', startupPhase: null, authorityState: { kind: 'current', origin: 'existing' },
        capabilities: { ...supervisor.capabilities, authoritativeWorkspace: true, coreRequests: true } })
      await flush(); await advance(0); await flush(); await advance(STARTUP_LOADING_EXIT_MS)
      const placeholder = () => document.querySelector<HTMLElement>('.camp-content > .mission-section-empty')
      check(placeholder()?.textContent?.includes('正在读取使命'), 'Mission restore must wait for the separate mission list')
      check(!document.querySelector('.workspace-shell') && unread && acknowledgements.length === 0,
        'Loading mission content cannot acknowledge its interruption')
      if (outcome === 'failed') {
        missions.reject(new Error('Mission list unavailable'))
        await flush(); await flush()
        check(placeholder()?.getAttribute('role') === 'alert' && !document.querySelector('.workspace-shell'),
          'Mission failure must keep the workspace unmounted')
        check(unread && acknowledgements.length === 0, 'Mission load failure must preserve the interruption')
        requestHandlers.set('missions.list', () => [mission])
        await clickNavigation('重试', '.camp-content > .mission-section-empty button')
      } else missions.resolve([mission])
      await flush(); await flush()
      check(document.querySelector('.workspace-shell') && !unread && acknowledgements.length === 1,
        'Only successfully displayed mission content acknowledges the observed interruption')
    }
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: originalHasFocus })
    cases.push('mission restore waits for actual content before interruption ACK, including load failure and retry')

    // Exercise the shared App with Web-style invalidation, including a refresh
    // already in flight when deletion is accepted and removal in another client.
    const invalidationListeners = new Set<() => void>()
    desktopThreadClient.onInvalidated = listener => {
      invalidationListeners.add(listener)
      return () => { invalidationListeners.delete(listener) }
    }
    await captureNavigation('day', false)
    const invalidateWeb = () => invalidationListeners.forEach(listener => listener())
    check(invalidationListeners.size > 0, 'The shared App subscribes to Web invalidation')
    const staleProjection = deferred<unknown>()
    campRequest = id => id === 'B' ? staleProjection.promise : campProjection(id)
    invalidateWeb(); await flush()
    const openReads = calls.filter(call => call === 'threads.open').length
    invalidateWeb(); await flush()
    for (const listener of coreListeners) listener({ method: 'navigation.invalidated',
      params: { scope: 'camp', reason: 'camps.delete_accepted', threadId: 'B' } })
    await flush()
    check(document.querySelector('.compose-content'), 'Accepted deletion leaves the current Thread')
    staleProjection.reject(new Error('Camp does not exist'))
    await flush(); await flush()
    check(!document.querySelector('.error-banner'), 'A failed pre-deletion refresh must not show a global error')
    check(calls.filter(call => call === 'threads.open').length === openReads, 'Deletion cancels the trailing projection read')
    cases.push('Accepted deletion discards in-flight Web refresh failures and queued reads')

    campRequest = id => campProjection(id)
    await clickNavigation('导航会话 A', '.camp-nav-open')
    campRequest = () => { throw new Error('Camp does not exist') }
    requestHandlers.set('threads.exists', () => false)
    invalidateWeb(); await flush(); await flush()
    check(document.querySelector('.compose-content') && !document.querySelector('.error-banner'),
      'Authoritative removal before a local receipt leaves the Thread without a failure banner')
    check(!document.querySelector('[data-thread-id="A"]'), 'Externally deleted Threads stay out of navigation')
    cases.push('Web refresh confirms external deletion before removing the current Thread')

    campRequest = id => campProjection(id)
    requestHandlers.set('threads.exists', () => true)
    await clickNavigation('导航会话 C', '.camp-nav-open')
    campRequest = () => { throw new Error('Fixture connection lost') }
    invalidateWeb(); await flush(); await flush()
    check(document.querySelector('.error-banner')?.textContent?.includes('Fixture connection lost'),
      'Refresh errors for an existing Thread must remain visible')
    cases.push('Web refresh retains real errors when the Thread still exists')
    delete desktopThreadClient.onInvalidated

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
    await openMemory()
    await jumpToThread('导航会话 C')
    memoryLoading.resolve(responses.get('memory.list')); await flush(); await flush()
    check(document.querySelector('.memory-catalog-item.selected')?.textContent?.includes('导航记忆 M'), 'Memory may normalize its displayed entry while C loads')
    campLoading.resolve(campProjection('C')); await flush(); await flush()
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 C', 'Old memory normalization must not cancel the newer C navigation')
    await back()
    check(document.querySelector('.memory-catalog-item.selected')?.textContent?.includes('导航记忆 M'), 'Memory correction survives the pending Camp commit')
    await back()
    check(document.querySelector('.settings-panel-general'), 'Memory history retains the real Settings entry')
    await back()
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 B', 'Memory normalization must not create an extra history entry')
    cases.push('Pending pushes never enter history and memory normalization cannot supersede newer navigation')

    await captureNavigation('day', false)
    const cleanup = deferred<unknown>(), afterCleanup = deferred<unknown>()
    requestHandlers.set('threads.discardPending', () => cleanup.promise)
    campRequest = id => id === 'C' ? afterCleanup.promise : id === 'D'
      ? { ...campProjection(id), thread: { ...campProjection(id).thread, activationState: 'pending' } } : campProjection(id)
    await clickNavigation('导航会话 D', '.camp-nav-open')
    await flush(); await flush()
    await clickNavigation('导航会话 A', '.camp-nav-open')
    await flush(); await flush()
    await back()
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 D', 'Cleanup race must revisit D before opening C')
    check(calls.includes('threads.discardPending'), 'Cleanup race must have a pending discard')
    await clickNavigation('导航会话 C', '.camp-nav-open')
    cleanup.resolve({ status: 'applied', code: 'thread.pending_discarded', payload: {} }); await flush(); await flush()
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
    requestHandlers.set('threads.create', () => lateCreation.promise)
    await clickNavigation('新对话', '.unified-primary-nav button')
    check(calls.includes('threads.create'), 'One-click creation must reach Core before navigation moves')
    await openMemory()
    lateCreation.resolve({ status: 'applied', payload: { threadId: 'NEW' } }); await flush(); await flush()
    check(document.querySelector('.memory-catalog-item.selected'), 'Late Camp creation must leave the newer memory page visible')
    check(!document.querySelector('.camp-topbar'), 'Late creation must not activate its new Camp')
    await back()
    check(document.querySelector('.settings-panel-general'), 'Leaving the newer Memory page first restores Settings')
    await back()
    check(document.querySelector('.camp-topbar h1')?.textContent === '导航会话 B', 'Late creation must not add a navigation step')
    const failedCreation = deferred<unknown>()
    requestHandlers.set('threads.create', () => failedCreation.promise)
    await clickNavigation('新对话', '.unified-primary-nav button')
    await openMemory()
    failedCreation.reject(new Error('Fixture creation rejected')); await flush(); await flush()
    check(!document.querySelector('.new-camp-dialog'), 'Obsolete creation failure must not reopen its dialog over the newer page')
    requestHandlers.set('threads.create', () => ({ status: 'applied', payload: { threadId: 'NEW' } }))
    await shortcut('n')
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
    const addOptions = document.querySelector<HTMLButtonElement>('[aria-label="选择添加方式"]')
    check(addOptions, 'The member creation menu must be available')
    addOptions.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await flush()
    await clickNavigation('手动创建', '[role="menuitem"]')
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
    let preflight: ThreadCreationPreflight = {
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
    check(items[0].textContent?.includes('未配置智能体') && items[2].textContent?.includes('智能体不可用'), 'Unavailable labels distinguish missing config from unavailable agent')
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
    const preflight: ThreadCreationPreflight = {
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
      check(now === 0, 'Loading screenshots must capture the initial frame without advancing timers')
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
