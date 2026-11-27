import type { ComponentProps, JSX } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { AgentRunView, ThreadComposerDraftView, ThreadSnapshot } from '@contracts'
import { ComposerPrimaryAction } from './ComposerPrimaryAction'
import { MemberAvatar } from './MemberAvatar'
import { materializeLocalContinuation } from './camp-composer-local-store'
import { useComposerSendShortcut } from './ShortcutProvider'
import type { ComposerLocalStatus } from './composer-document'
import { uiAttribute } from './interface-language'
import './composer-delivery.css'

type DeliveryMode = 'start' | 'steer'
type Plan = { target: {agentRunId: string; executionEpoch: number} | null; agentId: string; name: string; canSteer: boolean; reason: AgentRunView['steerUnavailableReason']; route: 'steer' | 'queue' | 'start' }

export function deliveryPlans(snapshot: ThreadSnapshot, draft: ThreadComposerDraftView | null, mode: DeliveryMode, localRecipients?: ComposerLocalStatus): Plan[] {
  // Preview follows live recipient atoms; the saved document can lag behind typing.
  // Submission omits this override and uses its flushed, complete document.
  const previewDraft: ThreadComposerDraftView | null = draft && localRecipients ? { ...draft,
    content: { version: 2, segments: localRecipients.hasAllMembers
      ? [{ kind: 'atom', atom: { type: 'all_members' } }]
      : localRecipients.memberAgentIds.map(agentId => ({ kind: 'atom', atom: { type: 'member', agentId } })) }
  } : draft
  const routedDraft = previewDraft ? materializeLocalContinuation(previewDraft, snapshot.members) : null
  const atoms = routedDraft?.content.segments.flatMap(segment => segment.kind === 'atom' ? [segment.atom] : []) ?? []
  const mentioned = atoms.some(atom => atom.type === 'all_members')
    ? snapshot.members.map(member => member.agentId)
    : atoms.flatMap(atom => atom.type === 'member' ? [atom.agentId] : [])
  const ids = [...new Set(mentioned.length ? mentioned : snapshot.thread.defaultLeadAgentId ? [snapshot.thread.defaultLeadAgentId] : [])]
  return ids.map(agentId => {
    const run = snapshot.agentRuns.find(run => run.agentId === agentId && ['queued', 'running', 'waiting'].includes(run.status))
    const canSteer = Boolean(run?.canSteer && !run.cancelRequestedAt)
    return { target: canSteer && run ? {agentRunId:run.id,executionEpoch:run.executionEpoch} : null, agentId, name: snapshot.members.find(member => member.agentId === agentId)?.displayName ?? agentId,
      canSteer, reason: run?.steerUnavailableReason, route: canSteer && mode === 'steer' ? 'steer' : run ? 'queue' : 'start' }
  })
}

const routeLabel = (route: Plan['route']): string => uiAttribute(route === 'steer' ? '插话' : route === 'queue' ? '排队' : '发送')
export function deliveryActionLabel(plans: Plan[]): string {
  if (plans.some(plan => plan.route === 'steer')) return uiAttribute(plans.length > 1 ? '优先插话' : '插话')
  if (plans.length && plans.every(plan => plan.route === 'queue')) return uiAttribute('排队发送')
  return uiAttribute('发送')
}

export function steerUnavailableLabel(reason: Plan['reason']): string | null {
  switch (reason) {
    case 'version_incompatible': return uiAttribute('当前运行版本不满足插话回执要求，本条消息将排队处理。')
    case 'version_unverified': return uiAttribute('当前运行版本的插话能力尚未确认，本条消息将排队处理。')
    case 'runtime_identity_unknown': return uiAttribute('无法确认当前运行版本，本条消息将排队处理。')
    case 'protocol_incompatible': return uiAttribute('当前接入协议不支持插话，本条消息将排队处理。')
    case 'runtime_unsupported': return uiAttribute('当前智能体不支持插话，本条消息将排队处理。')
    case 'input_outcome_unknown': return uiAttribute('上一条插话的送达结果待核对，本条消息将排队处理。')
    case 'execution_not_ready': return uiAttribute('当前执行暂不能接收插话，本条消息将排队处理。')
    case 'execution_changed': return uiAttribute('当前执行已变化，将按最新状态投递。')
    default: return null
  }
}

export function ComposerDeliveryAction({ plans, mode, onModeChange, ...props }: ComponentProps<typeof ComposerPrimaryAction> & {
  plans: Plan[]; mode: DeliveryMode; onModeChange(mode: DeliveryMode): void
}): JSX.Element {
  const sendShortcut = useComposerSendShortcut()
  if (!plans.some(plan => plan.canSteer || plan.reason) || props.invite) return <ComposerPrimaryAction {...props} />
  const canSteer = plans.some(plan => plan.canSteer)
  const multiple = plans.length > 1
  const label = deliveryActionLabel(plans)
  return <div className={`steer-send-group${canSteer ? '' : ' has-no-choice'}`}>
    <button className="composer-primary-action is-send steer-send-action" type={props.type}
      aria-label={sendShortcut ? `${label}（${sendShortcut.label}）` : label} aria-keyshortcuts={sendShortcut?.aria} title={[sendShortcut?.label, ...plans.map(plan => `${plan.name}：${routeLabel(plan.route)}${plan.route === 'queue' && plan.reason ? ` · ${steerUnavailableLabel(plan.reason) ?? ''}` : ''}`)].filter(Boolean).join('；')}
      aria-busy={props.busy} disabled={props.disabled} onClick={props.onClick}>
      <span>{label}</span>
      {props.busy ? <span className="composer-primary-action-spinner" /> : <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 15.5v-11M5.5 9 10 4.5 14.5 9" /></svg>}
    </button>
    {canSteer && <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><button className="steer-send-choice" type="button" aria-label={uiAttribute('选择发送方式')} disabled={props.busy}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6.5 3.5 3 3.5-3" /></svg>
      </button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content className="sidebar-action-menu steer-choice-menu" align="end" side="top" sideOffset={6} collisionPadding={10}>
        <DropdownMenu.RadioGroup value={mode} onValueChange={value => onModeChange(value as DeliveryMode)}>
          <DropdownMenu.RadioItem className="sidebar-action-menu-item steer-choice-row" value="steer">
            <span><strong>{uiAttribute(multiple ? '优先插话' : '插话')}</strong><small>{uiAttribute(multiple ? '支持的队员加入当前执行' : '加入当前执行')}</small></span><DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator>
          </DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem className="sidebar-action-menu-item steer-choice-row" value="start">
            <span><strong>{uiAttribute('排队发送')}</strong><small>{uiAttribute(multiple ? '忙碌队员执行结束后处理' : '当前执行结束后处理')}</small></span><DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator>
          </DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
        {(multiple || plans.some(plan => plan.reason)) && <div className="steer-recipient-preview" aria-label={uiAttribute('本次投递方式')}>
          {plans.map(plan => <div className="steer-recipient-plan" key={plan.agentId}>
            <MemberAvatar agentId={plan.agentId} avatarRef={null} displayName={plan.name} size="mention" decorative />
            <span>{plan.name}</span><small>{routeLabel(plan.route)}</small>
            {plan.route === 'queue' && plan.reason && <p className="steer-recipient-reason">{steerUnavailableLabel(plan.reason)}</p>}
          </div>)}
        </div>}
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>}
  </div>
}
