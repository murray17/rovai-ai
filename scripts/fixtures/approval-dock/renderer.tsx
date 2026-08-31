import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ActionApprovalView } from '@contracts'
import { ApprovalDock } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import '../../../apps/desktop/src/renderer/src/styles.css'

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
let setTarget: (id: string) => void
let focusSerial = 0
const presented: number[] = []

function Fixture() {
  const [approvals, setApprovals] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState<{ id: string; serial: number } | null>(null)
  const dockRef = useRef<HTMLElement>(null)
  refresh = () => setApprovals(previous => previous.map(item => ({ ...item })))
  setTarget = id => setFocus({ id, serial: ++focusSerial })
  return <div className="camp-workspace" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <div style={{ display: 'flex', gap: 12, padding: 12 }}>
      <button id="locate" onClick={() => setTarget(approvals[0].id)}>定位审批</button>
      <label>消息草稿 <input id="draft" defaultValue="Keep my focus" /></label>
    </div>
    <div className="workspace-grid" id="approval-layout" style={{ width: 1200, maxWidth: '100%', margin: '0 auto' }}>
      <section className="timeline-pane"><div style={{ flex: 1 }} />
        <section className="execution-drawer"><header className="execution-drawer-header">执行台</header></section>
      </section>
      <div className="conversation-controls">
        {approvals.length > 0 && <ApprovalDock approvals={approvals} profileById={new Map()} busy={busy}
          containerRef={dockRef} focusRequest={focus?.serial ?? null} focusApprovalId={focus?.id ?? null}
          onFocusPresented={serial => { presented.push(serial); setFocus(null) }}
          onResolve={(approval, optionId) => {
            requests.push({ approvalId: approval.id, optionId, version: approval.version })
            setBusy(true)
            complete = () => { setApprovals(items => items.filter(item => item.id !== approval.id)); setBusy(false) }
          }} />}
        <form className="composer"><div className="composer-box">Composer remains available</div></form>
      </div>
    </div>
  </div>
}

Object.assign(window, { approvalTest: {
  complete: () => complete(), refresh: () => refresh(), locate: (id: string) => setTarget(id),
  setWidth: (width: number) => { document.getElementById('approval-layout')!.style.width = `${width}px` },
  settle: () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 20)))) ,
  snapshot: () => {
    const summary = document.querySelector<HTMLElement>('[data-approval-summary]')
    const reasonNode = document.querySelector<HTMLElement>('.approval-reason')
    const toggle = document.querySelector<HTMLButtonElement>('.approval-reason-toggle')
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.runtime-option')]
    const bounds = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().toJSON()
    return {
      id: summary?.dataset.approvalSummary, requests, presented,
      active: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id,
      summaryFocused: document.activeElement === summary,
      decisionFocused: buttons.includes(document.activeElement as HTMLButtonElement),
      nextDisabled: document.querySelector('[aria-label="下一项审批"]')?.getAttribute('aria-disabled'),
      labels: buttons.map(button => button.textContent), disabled: buttons.every(button => button.disabled),
      reason: reasonNode?.textContent ?? null, expectedReason: reason,
      reasonHeight: reasonNode?.clientHeight, reasonScrollHeight: reasonNode?.scrollHeight,
      reasonToggle: Boolean(toggle), expanded: toggle?.getAttribute('aria-expanded'),
      dock: bounds('.approval-dock'), console: bounds('.execution-drawer'),
      code: bounds('.approval-dock-scroll > pre'),
      codeScrollable: (document.querySelector('.approval-dock-scroll > pre')?.scrollWidth ?? 0)
        > (document.querySelector('.approval-dock-scroll > pre')?.clientWidth ?? 0),
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      background: getComputedStyle(document.querySelector('.approval-dock')!).backgroundColor,
      consequenceVisible: document.body.textContent?.includes('Internal consequence must not be displayed')
    }
  }
} })
createRoot(document.getElementById('root')!).render(<Fixture />)
