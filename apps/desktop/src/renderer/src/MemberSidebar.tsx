import { newCommandId } from '../../shared/command-id'
import { readErrorMessage } from './error-message'
import { useThreadClient } from './camp-client'
import * as Menu from '@radix-ui/react-dropdown-menu'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties
} from 'react'
import type {
  AdapterKind,
  AgentProfile,
  HostPlatformKey,
  ProductRuntimeAvailability,
  RuntimePlatformAdmission,
  StoredCommandResult
} from '@contracts'
import { RuntimeGlyph } from './MemberRuntimePicker'
import { adapterLabel } from './runtime-products'
import { MemberAvatar } from './MemberAvatar'
import { useMobileLayout } from './MobileLayout'
import { useMemberReorder } from './use-member-reorder'
import { localizeExecutionEngineTerms } from './product-copy'
import {
  memberRuntimePresentation,
  runtimePlatformAdmissionFor,
  type RuntimeUserStatus
} from './runtime-status'
import { identityColorToken } from './theme'
import { useMemberRosterLayout } from './MemberRosterLayout'
import { UiText, uiAttribute } from './interface-language'

export type MemberWorkspaceTab = 'identity' | 'runtime'

export type CompactRuntimeState = 'available' | 'action' | 'neutral'

export function compactRuntimeState(status: RuntimeUserStatus): CompactRuntimeState {
  if (status === 'available') return 'available'
  if (status === 'unconfigured') return 'neutral'
  if (
    status === 'checking'
    || status === 'unknown'
    || status === 'not_qualified'
    || status === 'unsupported'
  ) return 'neutral'
  return 'action'
}

export function filterMembers(
  agents: AgentProfile[],
  query: string
): AgentProfile[] {
  const normalized = query.trim().normalize('NFKC').toLocaleLowerCase('zh-CN')
  const active = agents.filter((agent) => agent.presence !== 'removed' && agent.removedAt === null)
  if (!normalized) return active
  return active.filter((agent) => (
    agent.displayName.normalize('NFKC').toLocaleLowerCase('zh-CN').includes(normalized)
    || agent.teamRole.normalize('NFKC').toLocaleLowerCase('zh-CN').includes(normalized)
  ))
}

export function MemberSidebar({
  personalEntry,
  agents,
  runtimeAvailability,
  hostPlatform = null,
  runtimePlatformAdmission = [],
  runtimeDiscoveryPending,
  selectedAgentId,
  dirtyAgentIds = new Set<string>(),
  onSelect,
  onCreate,
  onManualCreate,
  creating = false,
  onReload
}: {
  personalEntry?: ReactNode
  agents: AgentProfile[]
  runtimeAvailability: ProductRuntimeAvailability[]
  hostPlatform?: HostPlatformKey | null
  runtimePlatformAdmission?: RuntimePlatformAdmission[]
  runtimeDiscoveryPending: boolean
  selectedAgentId: string | null
  dirtyAgentIds?: ReadonlySet<string>
  onSelect(agentId: string, tab: MemberWorkspaceTab, focusRuntime: boolean): void
  onCreate(trigger: HTMLButtonElement): void
  onManualCreate?(): void
  creating?: boolean
  onReload(): Promise<void>
}): React.JSX.Element {
  const client = useThreadClient()
  const { id, collapsed, setSorting } = useMemberRosterLayout()
  const mobile = useMobileLayout()
  const members = useMemo(
    () => agents.filter((agent) => agent.presence !== 'removed' && agent.removedAt === null),
    [agents]
  )
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false })
  const scrollRef = useRef<HTMLDivElement>(null)
  const visibleAgents = useMemo(
    () => filterMembers(members, query),
    [members, query]
  )
  const selectedHidden = Boolean(
    query.trim()
    && selectedAgentId
    && !visibleAgents.some((agent) => agent.agentId === selectedAgentId)
  )

  const updateScrollEdges = useCallback((): void => {
    const element = scrollRef.current
    if (!element) return
    setScrollEdges({
      top: element.scrollTop > 1,
      bottom: element.scrollTop + element.clientHeight < element.scrollHeight - 1
    })
  }, [])

  useEffect(() => {
    updateScrollEdges()
    const element = scrollRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(updateScrollEdges)
    observer.observe(element)
    return () => observer.disconnect()
  }, [updateScrollEdges, visibleAgents.length])

  const reorder = async (orderedAgentIds: string[], focusAgentId: string): Promise<void> => {
    setBusy(focusAgentId)
    setError(null)
    try {
      const result = await client.request<StoredCommandResult>('members.reorder', {
        commandId: newCommandId(),
        command: { orderedAgentIds }
      })
      assertApplied(result)
      await onReload()
      requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>(`[data-member-select="${CSS.escape(focusAgentId)}"]`)?.focus()
      })
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const moveMember = (agent: AgentProfile, direction: -1 | 1): void => {
    if (busy) return
    const group = members.filter((candidate) => candidate.presence === agent.presence)
    const index = group.findIndex((candidate) => candidate.agentId === agent.agentId)
    const target = group[index + direction]
    if (!target) return
    const ordered = members.map((candidate) => candidate.agentId)
    const from = ordered.indexOf(agent.agentId)
    const to = ordered.indexOf(target.agentId)
    ordered.splice(from, 1)
    ordered.splice(to, 0, agent.agentId)
    void reorder(ordered, agent.agentId)
  }

  const drag = useMemberReorder({ members, busy: busy !== null, scrollRef, onReorder: reorder, onDraggingChange: setSorting })
  const orderedVisibleAgents = drag.order
    ? [...visibleAgents].sort((a, b) => drag.order!.indexOf(a.agentId) - drag.order!.indexOf(b.agentId))
    : visibleAgents

  return (
    <section id={id} className={`member-sidebar ${collapsed ? 'is-collapsed' : ''}`} aria-label={uiAttribute("队员名册")}>
      {personalEntry}
      <div className="member-sidebar-heading">
        <div className="member-sidebar-title">
          <strong><UiText zh={"队员"} /></strong>
          <span>{query.trim() ? `${visibleAgents.length} / ${members.length}` : members.length}</span>
        </div>
        <div className="member-sidebar-actions member-add-split">
          <button type="button" aria-label={uiAttribute("添加队员")} title={uiAttribute("对话添加队员")}
            disabled={creating} aria-busy={creating || undefined} onClick={(event) => onCreate(event.currentTarget)}>
            <SidebarIcon /><span><UiText zh={"添加"} /></span>
          </button>
          <Menu.Root>
            <Menu.Trigger asChild>
              <button type="button" aria-label={uiAttribute("选择添加方式")} disabled={creating}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
              </button>
            </Menu.Trigger>
            <Menu.Portal><Menu.Content className="member-editor-menu" align="end" sideOffset={6} collisionPadding={12}>
              <Menu.Item className="member-editor-menu-item" onSelect={() => onManualCreate?.()}><UiText zh={"手动创建"} /></Menu.Item>
            </Menu.Content></Menu.Portal>
          </Menu.Root>
        </div>
      </div>

      {members.length > 8 && (
        <div className="member-sidebar-filter">
          <label htmlFor="member-sidebar-filter"><UiText zh={"筛选队员"} /></label>
          <div>
            <svg className="member-roster-search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="m12.2 12.2 4 4" /></svg>
            <input
              id="member-sidebar-filter"
              type="search"
              value={query}
              placeholder={uiAttribute("搜索队员")}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && <button type="button" aria-label={uiAttribute("清除队员筛选")} onClick={() => setQuery('')}>×</button>}
          </div>
        </div>
      )}

      {selectedHidden && (
        <p className="member-sidebar-selection-note"><UiText zh={"当前队员未出现在筛选结果中。"} /><button type="button" onClick={() => setQuery('')}><UiText zh={"清除筛选"} /></button></p>
      )}
      {error && <div className="member-sidebar-error" role="alert">{error}</div>}

      <div className={`member-sidebar-scroll ${scrollEdges.top ? 'has-top-overflow' : ''} ${scrollEdges.bottom ? 'has-bottom-overflow' : ''}`}>
        <div ref={scrollRef} className="member-sidebar-scroll-body" onScroll={updateScrollEdges}>
          {(['present', 'away'] as const).map((presence) => {
            const group = orderedVisibleAgents.filter((agent) => agent.presence === presence)
            if (group.length === 0) return null
            const total = members.filter((agent) => agent.presence === presence).length
            return (
              <section className="member-sidebar-group" key={presence} aria-label={presence === 'present' ? uiAttribute("在队队员") : uiAttribute("暂离队员")}>
                {members.some((member) => member.presence === 'away') && <div className="member-sidebar-group-heading">
                  <span>{presence === 'present' ? uiAttribute("在队") : uiAttribute("暂离")}</span><small>{query.trim() ? `${group.length}/${total}` : total}</small>
                </div>}
                {group.map((agent) => (
                  <MemberSidebarRow
                    key={agent.agentId}
                    agent={agent}
                    selected={selectedAgentId === agent.agentId}
                    dirty={dirtyAgentIds.has(agent.agentId)}
                    mobile={mobile}
                    dragging={drag.agentId === agent.agentId}
                    dragHandlers={drag.handlers(agent.agentId)}
                    suppressClick={drag.suppressClick}
                    busy={busy !== null}
                    availability={runtimeAvailability.find((item) => item.runtimeKind === agent.runtimeConfiguration?.adapterKind) ?? null}
                    admission={agent.runtimeConfiguration
                      ? runtimePlatformAdmissionFor(
                          hostPlatform,
                          runtimePlatformAdmission,
                          agent.runtimeConfiguration.adapterKind
                        )
                      : null}
                    platformAdmissionKnown={hostPlatform !== null}
                    runtimeDiscoveryPending={runtimeDiscoveryPending}
                    onSelect={onSelect}
                    onMove={moveMember}
                    canMoveUp={members.filter((member) => member.presence === presence)[0]?.agentId !== agent.agentId}
                    canMoveDown={members.filter((member) => member.presence === presence).at(-1)?.agentId !== agent.agentId}
                  />
                ))}
              </section>
            )
          })}
          {members.length === 0 && (
            <div className="member-sidebar-empty">
              <span aria-hidden="true">◎</span>
              <strong><UiText zh={"还没有队员"} /></strong>
              <p><UiText zh={"创建一个长期身份后，可为其配置智能体。"} /></p>
              <button className="primary-button conversation-primary-button" type="button" onClick={(event) => onCreate(event.currentTarget)}><UiText zh={"新增队员"} /></button>
            </div>
          )}
          {members.length > 0 && visibleAgents.length === 0 && (
            <div className="member-sidebar-empty compact">
              <strong><UiText zh={"没有匹配的队员"} /></strong>
              <button className="quiet-button" type="button" onClick={() => setQuery('')}><UiText zh={"清除筛选"} /></button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function MemberSidebarRow({
  agent,
  selected,
  dirty,
  mobile,
  dragging,
  dragHandlers,
  suppressClick,
  busy,
  availability,
  admission,
  platformAdmissionKnown,
  runtimeDiscoveryPending,
  onSelect,
  onMove,
  canMoveUp,
  canMoveDown
}: {
  agent: AgentProfile
  selected: boolean
  dirty: boolean
  mobile: boolean
  dragging: boolean
  dragHandlers: ReturnType<typeof useMemberReorder>['handlers'] extends (id: string) => infer T ? T : never
  suppressClick: { current: boolean }
  busy: boolean
  availability: ProductRuntimeAvailability | null
  admission: RuntimePlatformAdmission | null
  platformAdmissionKnown: boolean
  runtimeDiscoveryPending: boolean
  onSelect(agentId: string, tab: MemberWorkspaceTab, focusRuntime: boolean): void
  onMove(agent: AgentProfile, direction: -1 | 1): void
  canMoveUp: boolean
  canMoveDown: boolean
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const selectRef = useRef<HTMLButtonElement>(null)
  const runtime = memberRuntimePresentation(
    agent,
    agent.runtimeConfiguration?.adapterKind ?? null,
    availability,
    runtimeDiscoveryPending,
    admission,
    platformAdmissionKnown
  )
  const compact = compactRuntimeState(runtime.status)
  const product = agent.runtimeConfiguration?.adapterKind
    ? adapterLabel(agent.runtimeConfiguration.adapterKind)
    : uiAttribute('智能体')
  const configured = Boolean(agent.runtimeConfiguration?.adapterKind)
  const runtimeLabel = configured ? uiAttribute("{0}，{1}，{2}；打开运行配置", String(agent.displayName), String(product), String(runtime.label)) : uiAttribute("{0}，未配置智能体；打开运行配置", String(agent.displayName))
  const runtimeTooltip = configured ? `${product} · ${runtime.label}${runtime.detail ? ` · ${runtime.detail}` : ''}` : uiAttribute('未配置智能体')
  return (
    <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
    <div
      className={`member-sidebar-row presence-${agent.presence} ${selected ? 'selected' : ''} ${dragging ? 'is-dragging' : ''}`}
      data-member-id={agent.agentId}
      {...(!mobile ? dragHandlers : {})}
      onContextMenu={(event) => { event.preventDefault(); setMenuOpen(true) }}
      style={{ '--agent-accent': identityColorToken(agent.agentId) } as CSSProperties}
    >
      <button
        ref={selectRef}
        data-member-select={agent.agentId}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        onKeyDown={(event) => {
          if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault(); onMove(agent, event.key === "ArrowUp" ? -1 : 1)
          }
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); setMenuOpen(true) }
        }}
        className="member-sidebar-select"
        type="button"
        aria-current={selected ? 'true' : undefined}
        aria-label={`${agent.displayName}${uiAttribute('，')}${agent.teamRole ||uiAttribute("团队角色未设置")}${dirty ? uiAttribute("，有未保存更改") : ''}`}
        title={`${agent.displayName} · ${agent.teamRole ||uiAttribute("团队角色未设置")}`}
        onClick={(event) => { if (suppressClick.current) { event.preventDefault(); return }; onSelect(agent.agentId, 'identity', false) }}
      >
        <span className="member-sidebar-accent" aria-hidden="true" />
        <span className="member-reorder-avatar" {...(mobile ? dragHandlers : {})}><MemberAvatar
          agentId={agent.agentId}
          avatarRef={agent.avatarRef}
          displayName={agent.displayName}
          size="list"
          decorative
        /></span>
        <span className="member-sidebar-copy">
          <strong><span className="member-editor-member-name">{agent.displayName}</span>{dirty && <i className="member-editor-unsaved-mark" aria-hidden="true" />}</strong>
          <small>{agent.teamRole ||uiAttribute("团队角色未设置")}</small>
        </span>
      </button>
            <button
              className={`member-runtime-shortcut runtime-${compact}`}
              type="button"
              aria-label={runtimeLabel}
              title={runtimeTooltip}
              data-tooltip={runtimeTooltip}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onSelect(agent.agentId, 'runtime', true)}
            >
              <RuntimeGlyph kind={agent.runtimeConfiguration?.adapterKind ?? null} />
              {(compact === 'action' || runtime.status === 'not_qualified' || runtime.status === 'unsupported') && <i className="member-runtime-attention" aria-hidden="true">!</i>}
            </button>
      <Menu.Trigger asChild><button className="member-reorder-menu-anchor" aria-hidden="true" tabIndex={-1} /></Menu.Trigger>
    </div>
    <Menu.Portal><Menu.Content className="member-editor-menu" align="start" sideOffset={4} collisionPadding={12}
      onCloseAutoFocus={(event) => { event.preventDefault(); selectRef.current?.focus() }}>
      <Menu.Item className="member-editor-menu-item" disabled={busy || !canMoveUp} onSelect={() => onMove(agent, -1)}><UiText zh={"上移"} /></Menu.Item>
      <Menu.Item className="member-editor-menu-item" disabled={busy || !canMoveDown} onSelect={() => onMove(agent, 1)}><UiText zh={"下移"} /></Menu.Item>
    </Menu.Content></Menu.Portal>
    </Menu.Root>
  )
}

function SidebarIcon(): React.JSX.Element {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>
}

function assertApplied(result: StoredCommandResult): void {
  if (result.status !== 'rejected') return
  const detail = typeof result.payload.message === 'string'
    ? result.payload.message
    : typeof result.payload.detail === 'string'
      ? result.payload.detail
      : null
  throw new Error(detail ?? uiAttribute("排序未完成：{0}", String(result.code)))
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(readErrorMessage(error))
}
