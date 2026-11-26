import { useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { AgentProfile, AutomationView } from '@contracts'
import { AutomationGlyph, AutomationRunSwitch } from './AutomationControls'
import { automationPlanState, dateTimeLabel, scheduleLabel } from './automation-workspace-model'
import { UiText, uiAttribute } from './interface-language'
import { MemberAvatar } from './MemberAvatar'
import { useMobileLayout } from './MobileLayout'
import { useNavigationPressMenu } from './useNavigationPressMenu'

interface RowProps {
  task: AutomationView
  member?: AgentProfile
  selected: boolean
  overview: boolean
  disabled: boolean
  switching: boolean
  onChoose(reschedule?: boolean): void
  onToggle(): void
  onRun(): void
  onDelete(): void
}

function timingLabel(task: AutomationView, plan: ReturnType<typeof automationPlanState>): string | null {
  if (plan === 'manual') return task.lastRun ? uiAttribute('上次 {0}', dateTimeLabel(task.lastRun.createdAt)) : uiAttribute('尚未运行')
  if (plan === 'ended') return null
  if (!task.enabled) return uiAttribute('不会自动运行')
  return task.nextRunAt ? uiAttribute('下次 {0}', dateTimeLabel(task.nextRunAt)) : null
}

export function AutomationListRow({ task, member, selected, overview, disabled, switching, onChoose, onToggle, onRun, onDelete }: RowProps): React.JSX.Element {
  const mobile = useMobileLayout()
  const menu = useNavigationPressMenu(!disabled)
  const row = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const plan = automationPlanState(task)
  const state = plan === 'manual' ? uiAttribute('手动触发') : plan === 'ended' ? uiAttribute('计划已结束')
    : task.enabled ? uiAttribute('已开启') : uiAttribute('已关闭')
  const summary = scheduleLabel(task.schedule)
  const memberName = member?.displayName ?? uiAttribute('未知队员')
  const timing = timingLabel(task, plan)
  const memberColumn = overview && !mobile
  const avatar = <MemberAvatar agentId={task.memberId} avatarRef={member?.avatarRef ?? null}
    displayName={memberName} size={memberColumn ? 'execution' : mobile ? 'list' : 'mention'} decorative />
  const menuLabel = uiAttribute('{0}的操作', task.name)
  const trigger = <button type="button" className={mobile ? 'mobile-context-trigger' : 'automation-icon-button automation-task-more'}
    aria-label={menuLabel} title={uiAttribute('更多操作')} disabled={disabled}>
    {mobile ? uiAttribute('操作') : <AutomationGlyph name="more" />}
  </button>
  const { 'aria-haspopup': hasPopup, 'aria-description': menuDescription, ...gestures } = menu.rowProps

  return <DropdownMenu.Root open={menu.open} onOpenChange={menu.setOpen}>
    <div className={`automation-list-item${selected ? ' active' : ''}${menu.open ? ' menu-open' : ''}`}
      data-plan={plan} data-enabled={task.enabled} {...gestures}>
      <button ref={row} type="button" className="automation-task-open" onClick={() => onChoose()}
        aria-current={selected ? 'true' : undefined} aria-haspopup={hasPopup} aria-description={menuDescription}
        aria-keyshortcuts="Shift+F10" aria-label={[task.name, plan === 'manual' ? '' : summary, state, timing, memberName].filter(Boolean).join(uiAttribute('，'))}>
        {!memberColumn && avatar}
        <span className="automation-list-copy"><strong>{task.name}</strong><small>
          {plan !== 'manual' && <span>{summary}</span>}
          {timing && <span className="automation-row-timing">{timing}</span>}
        </small></span>
        {memberColumn && <span className="automation-row-member" title={memberName}>{avatar}<span>{memberName}</span></span>}
      </button>
      {plan === 'scheduled'
        ? <AutomationRunSwitch enabled={task.enabled} disabled={disabled} switching={switching} taskName={task.name} onChange={onToggle} />
        : <span className="automation-plan-label">{state}</span>}
      {menu.contextPoint ? <>{trigger}<DropdownMenu.Trigger asChild>
        <button className="sidebar-context-anchor" aria-hidden="true" tabIndex={-1}
          style={{ left: menu.contextPoint.x, top: menu.contextPoint.y }} />
      </DropdownMenu.Trigger></> : <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>}
    </div>
    <DropdownMenu.Portal><DropdownMenu.Content {...menu.menuProps} className="automation-menu"
      aria-label={menuLabel} align={menu.contextPoint ? 'start' : 'end'} sideOffset={menu.contextPoint ? 0 : 4} collisionPadding={8} loop
      onEscapeKeyDown={() => { restoreFocus.current = true }}
      onCloseAutoFocus={event => {
        event.preventDefault()
        if (restoreFocus.current) row.current?.focus({ preventScroll: true })
        restoreFocus.current = false
      }}>
      <DropdownMenu.Item className="automation-menu-item" onSelect={onRun}><AutomationGlyph name="play" /><UiText zh="运行一次" /></DropdownMenu.Item>
      {plan === 'ended' && <DropdownMenu.Item className="automation-menu-item" onSelect={() => onChoose(true)}>
        <AutomationGlyph name="calendar" /><UiText zh="重新安排" />
      </DropdownMenu.Item>}
      <DropdownMenu.Separator className="automation-menu-separator" />
      <DeleteMenuItem onDelete={onDelete} />
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>
}

function DeleteMenuItem({ onDelete }: { onDelete(): void }): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  return <>
    <DropdownMenu.Item className="automation-menu-item danger" onSelect={event => {
      if (armed) onDelete()
      else { event.preventDefault(); setArmed(true) }
    }}><AutomationGlyph name="trash" />{armed ? uiAttribute('确认删除任务') : uiAttribute('删除')}</DropdownMenu.Item>
    {armed && <p className="automation-menu-note"><UiText zh="删除定义，保留已有运行与对话。" /></p>}
  </>
}
