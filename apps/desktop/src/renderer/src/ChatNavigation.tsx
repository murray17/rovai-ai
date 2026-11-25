import type { ChatListItem, ChatReadState, ChatReplyPosition } from '@contracts'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader } from './AppDialog'
import { normalizeThreadTitle, THREAD_TITLE_MAX_SCALARS } from './camp-title'
import type { AppUpdateBadgePresentation } from './app-update-presentation'
import { MemberAvatar } from './MemberAvatar'
import { NavigationIcon, type NavigationIconName } from './NavigationIcon'
import { chatHasUnread, chatRailHasUnread } from './navigation-unread'
import { uiAttribute } from './interface-language'
import type { useChatList } from './useChatList'
import './chat-navigation.css'

export interface ChatNavigationProps {
  list: ReturnType<typeof useChatList>
  states: Record<string, ChatReadState>
  activeId: string | null
  projects(): void
  open(id: string | null): void
  mark(item: ChatReplyPosition, unread: boolean): void
  rename(item: ChatListItem, title: string): Promise<void>
}

export function ChatSectionRail({ chat, view, projects, missions, automations, members, teams, settings, missionUnread, update }: {
  chat: ChatNavigationProps; view: string
  projects(): void; missions(): void; automations(): void; members(): void; teams(): void; settings(): void
  missionUnread: boolean; update: AppUpdateBadgePresentation | null
}): React.JSX.Element {
  const unread = chatRailHasUnread(chat.list.page?.replyIndex ?? [], chat.states)
  const item = (label: string, name: NavigationIconName, current: boolean, click: () => void, note?: string, dotClass = '') =>
    <button type="button" className={current ? 'section-rail-item active' : 'section-rail-item'}
      aria-current={current ? 'page' : undefined} aria-label={note ? uiAttribute('{0}，{1}', label, note) : uiAttribute(label)}
      title={uiAttribute(label)} onClick={click}>
      <NavigationIcon name={name}/>{note && <i className={('section-rail-dot ' + dotClass).trim()} aria-hidden="true"/>}
    </button>
  return <nav className="section-rail" aria-label={uiAttribute('主要页面')}>
    <div className="section-rail-drag" />
    {item('项目','folder-open',view === 'camp' || view === 'compose',projects)}
    {item('聊天','chats',view === 'chat',() => chat.open(chat.activeId ?? chat.list.page?.items[0]?.chatId ?? null),unread ? '有未读回复' : undefined)}
    <i className="section-rail-divider"/>
    {item('使命板','briefcase-business',view === 'missions',missions,missionUnread ? '有新消息' : undefined)}
    {item('定时任务','calendar-clock',view === 'automations',automations)}
    <i className="section-rail-divider"/>
    {item('队员','profile',view === 'members',members)}
    {item('团队','users',view === 'teams',teams)}
    <div className="section-rail-bottom">{item('设置','settings',view === 'settings' || view === 'memory',settings, update?.accessibleLabel, update ? `is-update is-${update.kind}` : '')}</div>
  </nav>
}

export function ChatListPanel({ navigation, headerAction }: { navigation: ChatNavigationProps; headerAction?: ReactNode }): React.JSX.Element {
  const { list, states, activeId, open, mark } = navigation
  const [editing, setEditing] = useState<ChatListItem | null>(null)
  function row(item: ChatListItem) {
    const unread = chatHasUnread(item, states[item.chatId])
    return <div key={item.chatId} className={'camp-nav-row chat-list-row' + (item.chatId === activeId ? ' selected' : '')}>
      <button type="button" className="camp-nav-open" onClick={() => open(item.chatId)}
        title={item.title + ' · ' + item.displayName} aria-current={item.chatId === activeId ? 'page' : undefined}
        aria-label={[item.title,item.displayName,unread && uiAttribute('有未读回复'),item.isProcessing && uiAttribute('正在处理')].filter(Boolean).join('，')}>
        <MemberAvatar agentId={item.agentId} avatarRef={item.avatarRef} displayName={item.displayName} size="execution" decorative/>
        <span className="chat-item-title">{item.title}</span>
        <span className="camp-status-cluster" aria-hidden="true">
          {unread && <span className="camp-status-slot"><i className="camp-unread-dot"/></span>}
          {item.isProcessing && <span className="camp-status-slot"><span className="camp-loading-spinner camp-marker-loading"/></span>}
        </span>
      </button>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild><button className="sidebar-menu-trigger camp-menu-trigger" type="button" aria-label={uiAttribute('管理“{0}”', item.title)}>⋯</button></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="sidebar-action-menu" align="end" sideOffset={4} loop>
          <DropdownMenu.Item className="sidebar-action-menu-item" onSelect={() => mark(item, !unread)}>{uiAttribute(unread ? '标为已读' : '标为未读')}</DropdownMenu.Item>
          <DropdownMenu.Item className="sidebar-action-menu-item" onSelect={() => setEditing(item)}>{uiAttribute('重命名')}</DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  }
  return <section className="navigation-scroll chat-list-panel" aria-label={uiAttribute('聊天列表')}>
    <div className="sidebar-group-title navigation-section-title"><span>{uiAttribute('聊天')}</span>{headerAction}</div>
    {list.failed && <button type="button" className="quiet-button" onClick={() => void list.refresh()}>{uiAttribute('重新读取聊天列表')}</button>}
    {list.page?.items.map(row)}
    {list.page && !list.page.items.length && <p className="sidebar-empty">{uiAttribute('还没有聊天')}</p>}
    {(list.hasPrevious || list.page?.nextCursor) && <div className="camp-pagination-actions">
      {list.hasPrevious && <button type="button" disabled={list.loading} onClick={list.previous}>{uiAttribute('上一页')}</button>}
      {list.page?.nextCursor && <button type="button" disabled={list.loading} onClick={list.next}>{uiAttribute('下一页')}</button>}
    </div>}
    {editing && <RenameDialog item={editing} save={navigation.rename} close={() => setEditing(null)} />}
  </section>
}

function RenameDialog({ item, save, close }: {
  item: ChatListItem
  save: ChatNavigationProps['rename']
  close(): void
}): React.JSX.Element {
  const [name, setName] = useState(item.title)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const title = normalizeThreadTitle(name)
  const valid = title.length > 0 && Array.from(title).length <= THREAD_TITLE_MAX_SCALARS

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!valid || saving.current) return
    saving.current = true
    setBusy(true)
    try {
      await save(item, title)
      close()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : uiAttribute('名称未能保存，请重试。'))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return <Dialog.Root open onOpenChange={open => { if (!open && !saving.current) close() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
      <AppDialogContent className="camp-action-dialog">
        <AppDialogHeader title={uiAttribute('重命名聊天')} description={item.title} hideDescription closeDisabled={busy} />
        <form className="app-dialog-form" onSubmit={submit}>
          <AppDialogBody>
            <label className="field-label">{uiAttribute('聊天名称')}
              <input value={name} data-dialog-autofocus disabled={busy} autoComplete="off"
                aria-invalid={!valid || undefined} onFocus={event => event.currentTarget.select()}
                onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }}
                onChange={event => { setName(event.target.value); setError('') }} />
            </label>
            {error && <p className="compact-field-error" role="alert">{error}</p>}
          </AppDialogBody>
          <AppDialogFooter>
            <Dialog.Close asChild><button className="quiet-button" type="button" disabled={busy}>{uiAttribute('取消')}</button></Dialog.Close>
            <button className="primary-button conversation-primary-button" type="submit" disabled={busy || !valid}>{uiAttribute('保存名称')}</button>
          </AppDialogFooter>
        </form>
      </AppDialogContent>
    </Dialog.Portal>
  </Dialog.Root>
}
