import { newCommandId } from '../../shared/command-id'
import { readErrorMessage } from './error-message'
import { useCampClient } from './camp-client'
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
import { PanelToggleIcon } from './PanelToggleIcon'
import { localizeExecutionEngineTerms } from './product-copy'
import {
  memberRuntimePresentation,
  runtimePlatformAdmissionFor,
  type RuntimeUserStatus
} from './runtime-status'
import { identityColorToken } from './theme'
import { useMemberRosterLayout } from './MemberRosterLayout'

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
  onReload(): Promise<void>
}): React.JSX.Element {
  const client = useCampClient()
  const { id, collapsed, setCollapsed, sorting, setSorting } = useMemberRosterLayout()
  const members = useMemo(
    () => agents.filter((agent) => agent.presence !== 'removed' && agent.removedAt === null),
    [agents]
  )
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragAgentId, setDragAgentId] = useState<string | null>(null)
  const [dragOverAgentId, setDragOverAgentId] = useState<string | null>(null)
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false })
  const scrollRef = useRef<HTMLDivElement>(null)
  const visibleAgents = useMemo(
    () => sorting ? members : filterMembers(members, query),
    [members, query, sorting]
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
        document.querySelector<HTMLButtonElement>(`[data-member-order-handle="${CSS.escape(focusAgentId)}"]`)?.focus()
      })
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const moveMember = (agent: AgentProfile, direction: -1 | 1): void => {
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

  const dropMember = (target: AgentProfile): void => {
    const sourceId = dragAgentId
    setDragAgentId(null)
    setDragOverAgentId(null)
    if (!sourceId || sourceId === target.agentId) return
    const source = members.find((agent) => agent.agentId === sourceId)
    if (!source || source.presence !== target.presence) return
    const ordered = members.map((agent) => agent.agentId)
    const from = ordered.indexOf(sourceId)
    const to = ordered.indexOf(target.agentId)
    ordered.splice(from, 1)
    ordered.splice(to, 0, sourceId)
    void reorder(ordered, sourceId)
  }

  const toggleSorting = (): void => {
    setError(null)
    setSorting((current) => {
      const next = !current
      if (next) setQuery('')
      return next
    })
  }

  const toggleCollapsed = (): void => {
    if (sorting) return
    setCollapsed(!collapsed)
  }

  return (
    <section id={id} className={`member-sidebar ${collapsed ? 'is-collapsed' : ''} ${sorting ? 'is-sorting' : ''}`} aria-label="队员名册">
      {personalEntry}
      <div className="member-sidebar-heading">
        <div className="member-sidebar-title">
          <strong>队员</strong>
          <span>{query.trim() ? `${visibleAgents.length} / ${members.length}` : members.length}</span>
        </div>
        <div className="member-sidebar-actions">
          <button
            className="optional-action"
            type="button"
            aria-label="新增队员"
            title="新增队员"
            onClick={(event) => onCreate(event.currentTarget)}
          ><SidebarIcon name="plus" /></button>
          {members.length > 0 && (sorting ? (
            <button
              className="optional-action"
              type="button"
              aria-label="完成调整队员顺序"
              title="完成调整顺序"
              aria-pressed="true"
              onClick={toggleSorting}
            >完成</button>
          ) : <MemberRosterOptions onSort={toggleSorting} />)}
          <button
            type="button"
            aria-label={collapsed ? '展开队员名册' : '折叠队员名册'}
            title={collapsed ? '展开队员名册' : '折叠队员名册'}
            disabled={sorting}
            onClick={toggleCollapsed}
          ><PanelToggleIcon side="left" visible={!collapsed} /></button>
        </div>
      </div>

      {members.length > 8 && !sorting && (
        <div className="member-sidebar-filter">
          <label htmlFor="member-sidebar-filter">筛选队员</label>
          <div>
            <svg className="member-roster-search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="m12.2 12.2 4 4" /></svg>
            <input
              id="member-sidebar-filter"
              type="search"
              value={query}
              placeholder="搜索队员"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && <button type="button" aria-label="清除队员筛选" onClick={() => setQuery('')}>×</button>}
          </div>
        </div>
      )}

      {sorting && <p className="member-sidebar-mode-note">拖动队员排序；聚焦右侧把手后也可按 ↑↓ 移动。</p>}
      {selectedHidden && (
        <p className="member-sidebar-selection-note">当前队员未出现在筛选结果中。<button type="button" onClick={() => setQuery('')}>清除筛选</button></p>
      )}
      {error && <div className="member-sidebar-error" role="alert">{error}</div>}

      <div className={`member-sidebar-scroll ${scrollEdges.top ? 'has-top-overflow' : ''} ${scrollEdges.bottom ? 'has-bottom-overflow' : ''}`}>
        <div ref={scrollRef} className="member-sidebar-scroll-body" onScroll={updateScrollEdges}>
          {(['present', 'away'] as const).map((presence) => {
            const group = visibleAgents.filter((agent) => agent.presence === presence)
            if (group.length === 0) return null
            const total = members.filter((agent) => agent.presence === presence).length
            return (
              <section className="member-sidebar-group" key={presence} aria-label={presence === 'present' ? '在队队员' : '暂离队员'}>
                {members.some((member) => member.presence === 'away') && <div className="member-sidebar-group-heading">
                  <span>{presence === 'present' ? '在队' : '暂离'}</span><small>{query.trim() ? `${group.length}/${total}` : total}</small>
                </div>}
                {group.map((agent) => (
                  <MemberSidebarRow
                    key={agent.agentId}
                    agent={agent}
                    selected={selectedAgentId === agent.agentId}
                    dirty={dirtyAgentIds.has(agent.agentId)}
                    sorting={sorting}
                    busy={busy !== null}
                    dragOver={dragOverAgentId === agent.agentId && dragAgentId !== agent.agentId}
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
                    onDragStart={() => setDragAgentId(agent.agentId)}
                    onDragOver={() => setDragOverAgentId(agent.agentId)}
                    onDragLeave={() => setDragOverAgentId((current) => current === agent.agentId ? null : current)}
                    onDrop={() => dropMember(agent)}
                    onDragEnd={() => {
                      setDragAgentId(null)
                      setDragOverAgentId(null)
                    }}
                  />
                ))}
              </section>
            )
          })}
          {members.length === 0 && (
            <div className="member-sidebar-empty">
              <span aria-hidden="true">◎</span>
              <strong>还没有队员</strong>
              <p>创建一个长期身份后，可为其配置 Agent 运行时。</p>
              <button className="primary-button" type="button" onClick={(event) => onCreate(event.currentTarget)}>新增队员</button>
            </div>
          )}
          {members.length > 0 && visibleAgents.length === 0 && (
            <div className="member-sidebar-empty compact">
              <strong>没有匹配的队员</strong>
              <button className="quiet-button" type="button" onClick={() => setQuery('')}>清除筛选</button>
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
  sorting,
  busy,
  dragOver,
  availability,
  admission,
  platformAdmissionKnown,
  runtimeDiscoveryPending,
  onSelect,
  onMove,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd
}: {
  agent: AgentProfile
  selected: boolean
  dirty: boolean
  sorting: boolean
  busy: boolean
  dragOver: boolean
  availability: ProductRuntimeAvailability | null
  admission: RuntimePlatformAdmission | null
  platformAdmissionKnown: boolean
  runtimeDiscoveryPending: boolean
  onSelect(agentId: string, tab: MemberWorkspaceTab, focusRuntime: boolean): void
  onMove(agent: AgentProfile, direction: -1 | 1): void
  onDragStart(): void
  onDragOver(): void
  onDragLeave(): void
  onDrop(): void
  onDragEnd(): void
}): React.JSX.Element {
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
    : 'Agent 运行时'
  const configured = Boolean(agent.runtimeConfiguration?.adapterKind)
  const runtimeLabel = configured ? `${agent.displayName}，${product}，${runtime.label}；打开运行配置` : `${agent.displayName}，未配置运行时；打开运行配置`
  const runtimeTooltip = configured ? `${product} · ${runtime.label}${runtime.detail ? ` · ${runtime.detail}` : ''}` : '未配置运行时'
  return (
    <div
      className={`member-sidebar-row presence-${agent.presence} ${selected ? 'selected' : ''} ${dragOver ? 'drag-over' : ''}`}
      draggable={sorting && !busy}
      onDragStart={(event) => {
        if (!sorting) return
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragOver={(event) => {
        if (!sorting) return
        event.preventDefault()
        onDragOver()
      }}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        if (!sorting) return
        event.preventDefault()
        onDrop()
      }}
      onDragEnd={onDragEnd}
      style={{ '--agent-accent': identityColorToken(agent.agentId) } as CSSProperties}
    >
      <button
        className="member-sidebar-select"
        type="button"
        aria-current={selected ? 'true' : undefined}
        aria-label={`${agent.displayName}，${agent.teamRole || '团队角色未设置'}${dirty ? '，有未保存更改' : ''}`}
        title={`${agent.displayName} · ${agent.teamRole || '团队角色未设置'}`}
        onClick={() => onSelect(agent.agentId, 'identity', false)}
      >
        <span className="member-sidebar-accent" aria-hidden="true" />
        <MemberAvatar
          agentId={agent.agentId}
          avatarRef={agent.avatarRef}
          displayName={agent.displayName}
          size="list"
          decorative
        />
        <span className="member-sidebar-copy">
          <strong><span className="member-editor-member-name">{agent.displayName}</span>{dirty && <i className="member-editor-unsaved-mark" aria-hidden="true" />}</strong>
          <small>{agent.teamRole || '团队角色未设置'}</small>
        </span>
      </button>
      {sorting
        ? (
            <button
              className="member-order-handle"
              type="button"
              data-member-order-handle={agent.agentId}
              aria-label={`调整 ${agent.displayName} 的顺序；上、下方向键移动`}
              title="拖拽；聚焦后按上、下方向键移动"
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                onMove(agent, event.key === 'ArrowUp' ? -1 : 1)
              }}
            ><SidebarIcon name="grip" /></button>
          )
        : (
            <button
              className={`member-runtime-shortcut runtime-${compact}`}
              type="button"
              aria-label={runtimeLabel}
              title={runtimeTooltip}
              data-tooltip={runtimeTooltip}
              onClick={() => onSelect(agent.agentId, 'runtime', true)}
            >
              <RuntimeGlyph kind={agent.runtimeConfiguration?.adapterKind ?? null} />
              {(compact === 'action' || runtime.status === 'not_qualified' || runtime.status === 'unsupported') && <i className="member-runtime-attention" aria-hidden="true">!</i>}
            </button>
          )}
    </div>
  )
}

function MemberRosterOptions({ onSort }: { onSort(): void }): React.JSX.Element {
  const { width, maxWidth, setWidth } = useMemberRosterLayout()
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button className="optional-action" type="button" aria-label="名册选项" title="名册选项">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r=".8" /><circle cx="10" cy="10" r=".8" /><circle cx="16" cy="10" r=".8" /></svg>
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="member-editor-menu member-roster-options" sideOffset={6} align="end" collisionPadding={12}>
          <Menu.Item className="member-editor-menu-item" onSelect={onSort}>调整队员顺序</Menu.Item>
          <Menu.Separator className="member-editor-menu-separator" />
          <Menu.Label className="member-roster-options-label">列表宽度</Menu.Label>
          <Menu.RadioGroup value={String(width)} onValueChange={(value) => setWidth(Number(value))}>
            {([[192, '较窄'], [256, '默认'], [320, '较宽']] as const).map(([size, name]) => (
              <Menu.RadioItem key={size} value={String(size)} disabled={size > maxWidth} className="member-editor-menu-item member-roster-width-option">
                <span>{name}</span><small>{size} px</small>
                <span className="member-roster-option-check"><Menu.ItemIndicator>✓</Menu.ItemIndicator></span>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

function SidebarIcon({ name }: { name: 'plus' | 'grip' }): React.JSX.Element {
  if (name === 'plus') {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7 5h.01M13 5h.01M7 10h.01M13 10h.01M7 15h.01M13 15h.01" />
    </svg>
  )
}

function assertApplied(result: StoredCommandResult): void {
  if (result.status !== 'rejected') return
  const detail = typeof result.payload.message === 'string'
    ? result.payload.message
    : typeof result.payload.detail === 'string'
      ? result.payload.detail
      : null
  throw new Error(detail ?? `排序未完成：${result.code}`)
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(readErrorMessage(error))
}
