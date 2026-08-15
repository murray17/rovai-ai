import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import type {
  AdapterKind,
  AgentProfile,
  ProductRuntimeAvailability,
  StoredCommandResult
} from '@contracts'
import { MemberAvatar } from './MemberAvatar'
import { localizeExecutionEngineTerms } from './product-copy'
import {
  memberRuntimePresentation,
  type RuntimeUserStatus
} from './runtime-status'
import { identityColorToken } from './theme'

export type MemberWorkspaceTab = 'identity' | 'runtime'

export type CompactRuntimeState = 'available' | 'action' | 'neutral'

export function compactRuntimeState(status: RuntimeUserStatus): CompactRuntimeState {
  if (status === 'available') return 'available'
  if (status === 'unconfigured') return 'neutral'
  if (status === 'checking' || status === 'unknown') return 'neutral'
  return 'action'
}

const MEMBER_ROSTER_STORAGE_KEY = 'rovai-member-roster-width-v1'

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
  agents,
  runtimeAvailability,
  runtimeDiscoveryPending,
  selectedAgentId,
  onSelect,
  onCreate,
  onReload
}: {
  agents: AgentProfile[]
  runtimeAvailability: ProductRuntimeAvailability[]
  runtimeDiscoveryPending: boolean
  selectedAgentId: string | null
  onSelect(agentId: string, tab: MemberWorkspaceTab, focusRuntime: boolean): void
  onCreate(trigger: HTMLButtonElement): void
  onReload(): Promise<void>
}): React.JSX.Element {
  const members = useMemo(
    () => agents.filter((agent) => agent.presence !== 'removed' && agent.removedAt === null),
    [agents]
  )
  const [query, setQuery] = useState('')
  const [sorting, setSorting] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(MEMBER_ROSTER_STORAGE_KEY) === 'collapsed'
    } catch {
      return false
    }
  })
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
      const result = await window.rovai.request<StoredCommandResult>('members.reorder', {
        commandId: crypto.randomUUID(),
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
    setCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(MEMBER_ROSTER_STORAGE_KEY, next ? 'collapsed' : 'expanded')
      } catch {
        // This preference is optional; the roster still works when storage is unavailable.
      }
      return next
    })
  }

  return (
    <section className={`member-sidebar ${collapsed ? 'is-collapsed' : ''} ${sorting ? 'is-sorting' : ''}`} aria-label="队员名册">
      <div className="member-sidebar-heading">
        <div className="member-sidebar-title">
          <strong>队员</strong>
          <span>{members.length}</span>
        </div>
        <div className="member-sidebar-actions">
          <button
            className="optional-action"
            type="button"
            aria-label="新增队员"
            title="新增队员"
            onClick={(event) => onCreate(event.currentTarget)}
          ><SidebarIcon name="plus" /></button>
          {members.length > 0 && (
            <button
              className="optional-action"
              type="button"
              aria-label={sorting ? '完成调整队员顺序' : '调整队员顺序'}
              title={sorting ? '完成调整顺序' : '调整顺序'}
              aria-pressed={sorting}
              onClick={toggleSorting}
            >{sorting ? '完成' : <SidebarIcon name="sort" />}</button>
          )}
          <button
            type="button"
            aria-label={collapsed ? '展开队员名册' : '折叠队员名册'}
            title={collapsed ? '展开队员名册' : '折叠队员名册'}
            disabled={sorting}
            onClick={toggleCollapsed}
          ><SidebarIcon name={collapsed ? 'expand' : 'collapse'} /></button>
        </div>
      </div>

      {members.length > 20 && !sorting && (
        <div className="member-sidebar-filter">
          <label htmlFor="member-sidebar-filter">筛选队员</label>
          <div>
            <input
              id="member-sidebar-filter"
              type="search"
              value={query}
              placeholder="名称或团队角色"
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
              <section className="member-sidebar-group" key={presence} aria-labelledby={`member-group-${presence}`}>
                <div className="member-sidebar-group-heading" id={`member-group-${presence}`}>
                  <span>{presence === 'present' ? '在队' : '暂离'}</span><small>{query.trim() ? `${group.length}/${total}` : total}</small>
                </div>
                {group.map((agent) => (
                  <MemberSidebarRow
                    key={agent.agentId}
                    agent={agent}
                    selected={selectedAgentId === agent.agentId}
                    sorting={sorting}
                    busy={busy !== null}
                    dragOver={dragOverAgentId === agent.agentId && dragAgentId !== agent.agentId}
                    availability={runtimeAvailability.find((item) => item.runtimeKind === agent.runtimeConfiguration?.adapterKind) ?? null}
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
  sorting,
  busy,
  dragOver,
  availability,
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
  sorting: boolean
  busy: boolean
  dragOver: boolean
  availability: ProductRuntimeAvailability | null
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
    runtimeDiscoveryPending
  )
  const compact = compactRuntimeState(runtime.status)
  const product = agent.runtimeConfiguration?.adapterKind
    ? adapterLabel(agent.runtimeConfiguration.adapterKind)
    : 'Agent 运行时'
  const runtimeLabel = `${agent.displayName}，${product}，${runtime.label}；打开运行配置`
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
        aria-label={`${agent.displayName}，${agent.teamRole || '团队角色未设置'}`}
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
          <strong>{agent.displayName}</strong>
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
              title={`${product} · ${runtime.label}${runtime.detail ? ` · ${runtime.detail}` : ''}`}
              data-tooltip={`${product} · ${runtime.label}${runtime.detail ? ` · ${runtime.detail}` : ''}`}
              onClick={() => onSelect(agent.agentId, 'runtime', true)}
            >
              <span aria-hidden="true">{compact === 'available' ? '✓' : compact === 'action' ? '!' : '…'}</span>
            </button>
          )}
    </div>
  )
}

function SidebarIcon({ name }: { name: 'sort' | 'plus' | 'grip' | 'collapse' | 'expand' }): React.JSX.Element {
  if (name === 'plus') {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
  }
  if (name === 'grip') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M7 5h.01M13 5h.01M7 10h.01M13 10h.01M7 15h.01M13 15h.01" />
      </svg>
    )
  }
  if (name === 'collapse' || name === 'expand') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M4 4h12v12H4zM8 4v12" />
        {name === 'collapse'
          ? <path d="m12 7 3 3-3 3" />
          : <path d="m15 7-3 3 3 3" />}
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5 3-2 2 2 2M3 5h14M15 13l2 2-2 2M17 15H3" />
    </svg>
  )
}

function adapterLabel(kind: AdapterKind): string {
  return ({
    'codex-cli': 'Codex CLI',
    'opencode-cli': 'OpenCode',
    'copilot-cli': 'GitHub Copilot',
    'claude-code-cli': 'Claude Code',
    'kiro-cli': 'Kiro',
    'qoder-cli': 'Qoder',
    'codebuddy-cli': 'CodeBuddy',
    'qwen-code': 'Qwen Code',
    'trae-cn-cli': 'TRAE CLI（中国企业版）',
    'antigravity-app': 'Antigravity'
  })[kind]
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
  return localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error))
}
