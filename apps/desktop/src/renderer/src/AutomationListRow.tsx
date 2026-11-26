import { useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { AgentProfile, AutomationView } from '@contracts'
import { AutomationGlyph, AutomationRunSwitch } from './AutomationControls'
import { describeAutomationPlan, type AutomationDetailMode } from './automation-workspace-model'
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
  onOpen(mode: AutomationDetailMode): void
  onToggle(): void
  onRun(): void
  onDelete(): void
}

export function AutomationListRow({ task, member, selected, overview, disabled, switching, onOpen, onToggle, onRun, onDelete }: RowProps): React.JSX.Element {
  const mobile = useMobileLayout()
  const menu = useNavigationPressMenu(!disabled)
  const row = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const plan = describeAutomationPlan(task)
  const memberName = member?.displayName ?? uiAttribute('未知队员')
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
      data-plan={plan.kind} data-enabled={task.enabled} {...gestures}>
      <button ref={row} type="button" className="automation-task-open" onClick={() => onOpen('details')}
        aria-current={selected ? 'true' : undefined} aria-haspopup={hasPopup} aria-description={menuDescription}
        aria-keyshortcuts="Shift+F10" aria-label={[task.name, plan.summary, plan.label, plan.timing, memberName].filter(Boolean).join(uiAttribute('，'))}>
        {!memberColumn && avatar}
        <span className="automation-list-copy"><strong>{task.name}</strong><small>
          {plan.summary && <span>{plan.summary}</span>}
          {plan.timing && <span className="automation-row-timing">{plan.timing}</span>}
        </small></span>
        {memberColumn && <span className="automation-row-member" title={memberName}>{avatar}<span>{memberName}</span></span>}
      </button>
      {plan.row === 'switch'
        ? <AutomationRunSwitch enabled={task.enabled} disabled={disabled} switching={switching} taskName={task.name} onChange={onToggle} />
        : <span className="automation-plan-label">{plan.label}</span>}
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
      {plan.endedSchedule && <DropdownMenu.Item className="automation-menu-item" onSelect={() => onOpen('reschedule')}>
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
