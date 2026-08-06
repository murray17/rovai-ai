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

export type CompactRuntimeState = 'available' | 'unconfigured' | 'action' | 'neutral'

export function compactRuntimeState(status: RuntimeUserStatus): CompactRuntimeState {
  if (status === 'available') return 'available'
  if (status === 'unconfigured') return 'unconfigured'
  if (status === 'checking' || status === 'unknown') return 'neutral'
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
  agents,
  runtimeAvailability,
  runtimeDiscoveryPending,
  selectedAgentId,
  onBack,
  onSelect,
  onCreate,
  onReload
}: {
  agents: AgentProfile[]
  runtimeAvailability: ProductRuntimeAvailability[]
  runtimeDiscoveryPending: boolean
  selectedAgentId: string | null
  onBack(): void
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
      const result = await window.rovai.request<StoredCommandResult>('agents.reorder', {
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

  return (
    <section className="member-sidebar" aria-label="队员名册">
      <div className="member-sidebar-heading">
        <div className="member-sidebar-title">
          <button
            className="member-sidebar-home"
            type="button"
            aria-label="返回首页"
            title="返回首页"
            onClick={onBack}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <path d="M12.5 4.5 7 10l5.5 5.5M7.5 10h8" />
            </svg>
          </button>
          <strong>队员</strong>
          <span>{members.length}</span>
        </div>
        <div className="member-sidebar-actions">
          {members.length > 0 && (
            <button
              type="button"
              aria-label={sorting ? '完成调整队员顺序' : '调整队员顺序'}
              title={sorting ? '完成调整顺序' : '调整顺序'}
              aria-pressed={sorting}
              onClick={toggleSorting}
            >{sorting ? '完成' : '⇅'}</button>
          )}
          {members.length > 0 && (
            <button
              type="button"
              aria-label="新增队员"
              title="新增队员"
              onClick={(event) => onCreate(event.currentTarget)}
            >＋</button>
          )}
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

      {sorting && <p className="member-sidebar-mode-note">拖拽，或聚焦把手后按上、下方向键调整 Member Order。</p>}
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
                    availability={runtimeAvailability.find((item) => item.runtimeKind === agent.runtimeSelection?.adapterKind) ?? null}
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
    agent.runtimeSelection?.adapterKind ?? null,
    availability,
    runtimeDiscoveryPending
  )
  const compact = compactRuntimeState(runtime.status)
  const product = agent.runtimeSelection?.adapterKind
    ? adapterLabel(agent.runtimeSelection.adapterKind)
    : 'Agent 运行时'
  const runtimeLabel = `${agent.displayName}，${product}，${runtime.label}；打开运行配置`
  return (
    <div
      className={`member-sidebar-row ${selected ? 'selected' : ''} ${dragOver ? 'drag-over' : ''}`}
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
            >⋮⋮</button>
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
              <span aria-hidden="true">{compact === 'available' ? '✓' : compact === 'unconfigured' ? '○' : compact === 'action' ? '!' : '…'}</span>
            </button>
          )}
    </div>
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
  throw new Error(detail ?? `Core 拒绝了排序：${result.code}`)
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error))
}
