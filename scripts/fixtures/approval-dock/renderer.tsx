import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ActionApprovalView, GeneralPreferencesApi, InterfaceLanguage } from '@contracts'
import { ApprovalDock } from '../../../apps/desktop/src/renderer/src/ThreadWorkspace'
import { MobileLayoutProvider } from '../../../apps/desktop/src/renderer/src/MobileLayout'
import { changeInterfaceLanguage } from '../../../apps/desktop/src/renderer/src/interface-language'
import { DEFAULT_GENERAL_PREFERENCES } from '../../../apps/desktop/src/shared/general-preferences-model'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/web/src/mobile.css'

const reason = 'Runtime requests project access. Review the exact command before allowing it. '
  + 'The permission applies to the selected workspace and must not cover other projects. '
  + 'Adapter details remain verbatim: session choices can also allow subsequent matching commands.'
const requests: Array<{ approvalId: string; optionId: string; version: number }> = []
const initial: ActionApprovalView[] = [1, 2, 3].map(index => ({
  id: `approval-${index}`, actionId: `action-${index}`, actionKind: 'shell_command',
  actionSummary: `Run Runtime command ${index}`, reason: index === 3 ? '  Run Runtime\ncommand 3  ' : reason,
  canonicalInput: { command: `printf '%s' '${'long input '.repeat(100)}'`, cwd: '/fixture/project' },
  agentRunId: `run-${index}`, agentId: `member-${index}`, adapterKind: 'codex-cli',
  nativeMethod: 'item/commandExecution/requestApproval', requestDigest: `digest-${index}`,
  permissionSemantics: 'runtime_managed_v2', status: 'pending', requestedForUserId: 'local_user',
  resolvedByType: null, resolvedById: null, resolutionCode: null, version: index,
  requestedAt: '2026-08-31T00:00:00Z', resolvedAt: null,
  options: [
    { optionId: 'native-once', kind: 'allow_once', label: 'Runtime Allow once' },
    { optionId: 'native-custom', kind: 'other', label: 'Adapter custom choice' },
    { optionId: 'native-deny', kind: 'deny', label: 'Deny' },
    { optionId: 'native-session', kind: 'allow_session', label: 'Allow for this session' }
  ].map(option => ({ ...option, kind: option.kind as ActionApprovalView['options'][number]['kind'],
    consequence: 'Internal consequence must not be displayed', nativeResponseDigest: option.optionId }))
}))
let complete: () => void
let refresh: () => void
let setTarget: (id: string | null) => void
let setMobile: (value: boolean) => void
let reset: () => void
let manyOptions: () => void
type OptionsSource = 'core' | 'claude' | 'claude-remember' | 'native'
let setOptionsSource: (source: OptionsSource) => void
let longRememberRule: () => void
let nativeResponseDigests: () => string[]
const rememberLabel = 'Yes, and don’t ask again for: rovai send *'
const rememberScope = 'Bash(rovai send *)\nlocalSettings · .claude/settings.local.json'
let focusSerial = 0
const presented: number[] = []

function Fixture() {
  const [mobile, updateMobile] = useState(false)
  const [approvals, setApprovals] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState<{ id: string | null; serial: number } | null>(null)
  const dockRef = useRef<HTMLElement>(null)
  nativeResponseDigests = () => approvals[0]?.options.map(option => option.nativeResponseDigest) ?? []
  refresh = () => setApprovals(previous => previous.map(item => ({ ...item })))
  setTarget = id => setFocus({ id, serial: ++focusSerial })
  setMobile = updateMobile
  reset = () => { setApprovals(initial); setBusy(false); setFocus(null); requests.length = 0 }
  manyOptions = () => setApprovals(previous => previous.map(item => ({ ...item, options: Array.from({ length: 12 }, (_, index) => ({ ...item.options[0], optionId: `extended-${index}`, label: `Runtime custom decision ${index + 1} with its complete native label` })) })))
  setOptionsSource = source => {
    const prefix = source === 'core' ? 'core' : 'claude'
    setApprovals([{
      ...initial[0], actionSummary: '允许一次', reason: '拒绝',
      adapterKind: source === 'core' ? 'unknown' : 'claude-code-cli',
      nativeMethod: source === 'core' ? null : source.startsWith('claude') ? 'claude/permission_request' : 'session/request_permission',
      permissionSemantics: source === 'core' ? 'core_enforced_v1' : 'runtime_managed_v2',
      options: [
        { optionId: `${prefix}.deny`, kind: 'deny', label: source === 'claude-remember' ? 'No' : '拒绝', consequence: 'Internal consequence must not be displayed', nativeResponseDigest: 'deny-digest' },
        { optionId: `${prefix}.allow_once`, kind: 'allow_once', label: source === 'claude-remember' ? 'Yes' : '允许一次', consequence: 'Internal consequence must not be displayed', nativeResponseDigest: 'allow-digest' },
        ...(source === 'claude-remember' ? [{ optionId: 'claude.allow_remember.rule-digest', kind: 'other' as const,
          label: rememberLabel, consequence: rememberScope, nativeResponseDigest: 'remember-digest' }] : [])
      ]
    }])
    setBusy(false); setFocus(null); requests.length = 0
  }
  longRememberRule = () => setApprovals(items => items.map(item => ({ ...item, options: item.options.map(option =>
    option.optionId.startsWith('claude.allow_remember.') ? { ...option,
      label: `Yes, and don’t ask again for: ${'/a-long-project-directory'.repeat(12)}/*`,
      consequence: `Read(${ '/a-long-project-directory'.repeat(12)}/*)\nprojectSettings · .claude/settings.json`
    } : option) })))
  return <MobileLayoutProvider value={mobile}><div className={mobile ? 'app-shell' : undefined} style={mobile ? undefined : { height: '100vh' }}>
    <div className="camp-workspace" style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <div style={{ display: 'flex', gap: 12, padding: 12 }}>
      <button id="locate" onClick={() => setTarget(null)}>定位审批</button>
      <label>消息草稿 <input id="draft" defaultValue="Keep my focus" /></label>
    </div>
    <div className="workspace-grid" id="approval-layout" style={{ width: 1200, maxWidth: '100%', margin: '0 auto' }}>
      <section className="timeline-pane"><div style={{ flex: 1 }} />
        <section className="execution-drawer"><header className="execution-drawer-header">执行台</header></section>
      </section>
      <div className="conversation-controls">
        {approvals.length > 0 && <ApprovalDock approvals={approvals} profileById={new Map()} busy={busy}
          containerRef={dockRef} focusRequest={focus?.serial ?? null} focusApprovalId={focus?.id ?? null}
          // Header requests can remain set after presentation without a notification waiter.
          onFocusPresented={serial => { presented.push(serial) }}
          onResolve={(approval, optionId) => {
            requests.push({ approvalId: approval.id, optionId, version: approval.version })
            setBusy(true)
            complete = () => { setApprovals(items => items.filter(item => item.id !== approval.id)); setBusy(false) }
          }} />}
        <form className="composer"><div className="composer-box">Composer remains available</div></form>
      </div>
    </div>
  </div></div></MobileLayoutProvider>
}

Object.assign(window, { approvalTest: {
  complete: () => complete(), refresh: () => refresh(), locate: (id: string) => setTarget(id),
  setMobile: (value: boolean) => setMobile(value), reset: () => reset(),
  manyOptions: () => manyOptions(),
  setOptionsSource: (source: OptionsSource) => setOptionsSource(source),
  longRememberRule: () => longRememberRule(),
  setLanguage: (language: InterfaceLanguage) => changeInterfaceLanguage({
    setInterfaceLanguage: async interfaceLanguage => ({ ...DEFAULT_GENERAL_PREFERENCES, interfaceLanguage })
  } as GeneralPreferencesApi, language),
  setWidth: (width: number) => { document.getElementById('approval-layout')!.style.width = `${width}px` },
  settle: () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 20)))) ,
  snapshot: () => {
    const summary = document.querySelector<HTMLElement>('[data-approval-summary]')
    const reasonNode = document.querySelector<HTMLElement>('.approval-reason')
    const toggle = document.querySelector<HTMLButtonElement>('.approval-reason-toggle')
    const codeNode = document.querySelector<HTMLElement>('.approval-dock-scroll > pre')
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.runtime-option')]
    const bounds = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().toJSON()
    return {
      id: summary?.dataset.approvalSummary, requests, presented,
      active: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id,
      summaryFocused: document.activeElement === summary,
      decisionFocused: buttons.includes(document.activeElement as HTMLButtonElement),
      nextDisabled: document.querySelector('[aria-label="下一项审批"]')?.getAttribute('aria-disabled'),
      labels: buttons.map(button => button.textContent), disabled: buttons.every(button => button.disabled),
      titles: buttons.map(button => button.title), accessibleLabels: buttons.map(button => button.getAttribute('aria-label')),
      optionIds: buttons.map(button => button.dataset.optionId),
      nativeResponseDigests: nativeResponseDigests(),
      optionBounds: buttons.map(button => button.getBoundingClientRect().toJSON()),
      configurationVisible: /localSettings|projectSettings|\.claude\/settings/.test(document.querySelector('.approval-dock')?.textContent ?? ''),
      summary: summary?.querySelector('strong')?.textContent,
      reason: reasonNode?.textContent ?? null, expectedReason: reason,
      reasonHeight: reasonNode?.clientHeight, reasonScrollHeight: reasonNode?.scrollHeight,
      reasonToggle: Boolean(toggle), expanded: toggle?.getAttribute('aria-expanded'),
      dock: bounds('.approval-dock'), console: bounds('.execution-drawer'),
      code: bounds('.approval-dock-scroll > pre'),
      codeText: document.querySelector('.approval-dock-scroll > pre')?.textContent,
      expectedCode: JSON.stringify(initial.find(item => item.id === summary?.dataset.approvalSummary)?.canonicalInput, null, 2),
      codeFocusable: document.querySelector<HTMLElement>('.approval-dock-scroll > pre')?.tabIndex === 0,
      codeBackground: codeNode ? getComputedStyle(codeNode).backgroundColor : null,
      dockShadow: getComputedStyle(document.querySelector('.approval-dock')!).boxShadow,
      touchTargets: [...document.querySelectorAll('.approval-dock button')].map(node => ({label: node.getAttribute('aria-label') ?? node.textContent, ...node.getBoundingClientRect().toJSON()})),
      composer: bounds('.composer'), controls: bounds('.conversation-controls'),
      codeScrollable: (document.querySelector('.approval-dock-scroll > pre')?.scrollWidth ?? 0)
        > (document.querySelector('.approval-dock-scroll > pre')?.clientWidth ?? 0),
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      background: getComputedStyle(document.querySelector('.approval-dock')!).backgroundColor,
      consequenceVisible: document.body.textContent?.includes('Internal consequence must not be displayed')
    }
  }
} })
createRoot(document.getElementById('root')!).render(<Fixture />)
