import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AgentProfile,
  McpConfigIssue,
  McpConfigView,
  McpImportCandidate,
  McpImportInspection,
  McpImportSelection,
  McpMutationResult,
  McpServerView
} from '@contracts'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from './AppDialog'
import { SettingsPageHeader } from './SettingsPageHeader'
import { MemberAvatar } from './MemberAvatar'
import { localizeExecutionEngineTerms } from './product-copy'
import { identityColorToken } from './theme'

type JsonEditor = {
  serverId: string | null
  definitionJson: string
}

type ImportDraft = {
  selected: boolean
  action: 'create' | 'replace'
  replaceServerId?: string
  definitionJson: string
}

type McpServerFilter = 'all' | 'assigned' | 'unassigned' | 'enabled'

const NEW_SERVER_JSON = `{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@example/mcp-server"]
    }
  }
}`

export function McpSettings({ agents }: { agents: AgentProfile[] }): React.JSX.Element {
  const members = useMemo(
    () => agents
      .filter((agent) => agent.presence === 'present')
      .sort((left, right) => left.memberOrder - right.memberOrder),
    [agents]
  )
  const [config, setConfig] = useState<McpConfigView | null>(null)
  const [editor, setEditor] = useState<JsonEditor | null>(null)
  const [deleting, setDeleting] = useState<McpServerView | null>(null)
  const [inspection, setInspection] = useState<McpImportInspection | null>(null)
  const [importDrafts, setImportDrafts] = useState<Record<string, ImportDraft>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formIssues, setFormIssues] = useState<McpConfigIssue[]>([])

  const load = useCallback(async (): Promise<McpConfigView> => {
    const next = await window.rovai.request<McpConfigView>('mcp.config.get')
    setConfig(next)
    return next
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.rovai.request<McpConfigView>('mcp.config.get')
      .then((next) => { if (!cancelled) setConfig(next) })
      .catch((nextError) => { if (!cancelled) setError(errorMessage(nextError)) })
    const onFocus = (): void => { void load().catch((nextError) => setError(errorMessage(nextError))) }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const applyMutation = useCallback(async (result: McpMutationResult): Promise<'ok' | 'failed'> => {
    if (result.status === 'ok') {
      setConfig(result.config)
      setFormIssues([])
      return 'ok'
    }
    if (result.status === 'risk_acknowledgement_required') {
      setError('MCP 配置未能保存，请重新读取后再试。')
      return 'failed'
    }
    if (result.status === 'conflict') {
      await load()
      setError('配置文件刚刚发生了变化。页面已重新读取，请再试一次。')
      return 'failed'
    }
    setFormIssues(result.issues)
    return 'failed'
  }, [load])

  const saveEditor = async (): Promise<void> => {
    if (!editor || !config) return
    setBusy('save')
    setError(null)
    setFormIssues([])
    try {
      const result = editor.serverId
        ? await window.rovai.request<McpMutationResult>('mcp.servers.update', {
            expectedConfigDigest: config.configDigest,
            serverId: editor.serverId,
            definitionJson: editor.definitionJson
          })
        : await window.rovai.request<McpMutationResult>('mcp.servers.create', {
            expectedConfigDigest: config.configDigest,
            definitionJson: editor.definitionJson
          })
      if (await applyMutation(result) === 'ok') setEditor(null)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const setEnabled = async (server: McpServerView): Promise<void> => {
    if (!config) return
    setBusy(`toggle:${server.serverId}`)
    setError(null)
    try {
      const result = await window.rovai.request<McpMutationResult>('mcp.servers.setEnabled', {
        expectedConfigDigest: config.configDigest,
        serverId: server.serverId,
        enabled: !server.enabled,
        acknowledgeHighRisk: true
      })
      await applyMutation(result)
    } catch (nextError) {
      await load().catch(() => undefined)
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const setAssignment = async (
    agent: AgentProfile,
    server: McpServerView,
    assigned: boolean
  ): Promise<void> => {
    if (!config) return
    const key = `assignment:${agent.agentId}:${server.serverId}`
    setBusy(key)
    setError(null)
    try {
      const result = await window.rovai.request<McpMutationResult>('mcp.assignments.set', {
        expectedConfigDigest: config.configDigest,
        serverId: server.serverId,
        agentId: agent.agentId,
        assigned,
        acknowledgeHighRisk: true
      })
      await applyMutation(result)
    } catch (nextError) {
      await load().catch(() => undefined)
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const setBulkAssignments = async (
    agent: AgentProfile,
    servers: McpServerView[],
    assigned: boolean
  ): Promise<void> => {
    if (!config || servers.length === 0) return
    setBusy(`assignment-bulk:${agent.agentId}`)
    setError(null)
    setFormIssues([])
    let current = config
    try {
      for (const server of servers) {
        const result = await window.rovai.request<McpMutationResult>('mcp.assignments.set', {
          expectedConfigDigest: current.configDigest,
          serverId: server.serverId,
          agentId: agent.agentId,
          assigned,
          acknowledgeHighRisk: true
        })
        if (result.status === 'ok') {
          current = result.config
          setConfig(current)
          continue
        }
        if (result.status === 'risk_acknowledgement_required') {
          setError('MCP 配置未能保存，请重新读取后再试。')
          return
        }
        if (result.status === 'conflict') {
          await load()
          setError('配置文件刚刚发生了变化。页面已重新读取，请再试一次。')
          return
        }
        setFormIssues(result.issues)
        return
      }
    } catch (nextError) {
      await load().catch(() => undefined)
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const deleteServer = async (): Promise<void> => {
    if (!config || !deleting) return
    setBusy(`delete:${deleting.serverId}`)
    setError(null)
    try {
      const result = await window.rovai.request<McpMutationResult>('mcp.servers.delete', {
        expectedConfigDigest: config.configDigest,
        serverId: deleting.serverId
      })
      if (await applyMutation(result) === 'ok') setDeleting(null)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const scan = async (): Promise<void> => {
    setBusy('scan')
    setError(null)
    try {
      const next = await window.rovai.request<McpImportInspection>('mcp.import.scan')
      setInspection(next)
      setImportDrafts(buildImportDrafts(next, config?.servers ?? []))
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const commitImport = async (): Promise<void> => {
    if (!inspection) return
    const selections: McpImportSelection[] = inspection.candidates.flatMap((candidate) => {
      const draft = importDrafts[candidate.candidateId]
      if (!draft?.selected || !draft.definitionJson.trim()) return []
      return [{
        candidateId: candidate.candidateId,
        action: draft.action,
        replaceServerId: draft.action === 'replace' ? draft.replaceServerId : undefined,
        definitionJson: draft.definitionJson,
        hasBlockingIssues: candidate.issues.some((issue) => issue.blocking)
      }]
    })
    if (selections.length === 0) {
      setError('请至少选择一个可导入的 MCP Server。')
      return
    }
    setBusy('import')
    setError(null)
    setFormIssues([])
    try {
      const result = await window.rovai.request<McpMutationResult>('mcp.import.commit', {
        expectedConfigDigest: inspection.configDigest,
        selections
      })
      if (await applyMutation(result) === 'ok') {
        setInspection(null)
        setImportDrafts({})
      }
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const repairPermissions = async (): Promise<void> => {
    setBusy('permissions')
    try {
      setConfig(await window.rovai.request<McpConfigView>('mcp.config.repairPermissions'))
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const revealConfig = async (): Promise<void> => {
    setBusy('reveal')
    try {
      await window.rovai.revealMcpConfig()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const libraryIsEmpty = Boolean(config && !config.fileIssue && config.servers.length === 0)

  return (
    <div className="mcp-settings">
      <SettingsPageHeader
        eyebrow="Settings / MCP"
        title="MCP"
        description="管理 MCP 连接及队员可用范围。"
        aside={libraryIsEmpty ? undefined : (
          <>
            <button className="quiet-button" type="button" onClick={() => void scan()} disabled={config === null || busy !== null || Boolean(config.fileIssue)}>
              {busy === 'scan' ? '正在读取…' : '从本机配置导入'}
            </button>
            <button className="primary-button" type="button" onClick={() => setEditor({ serverId: null, definitionJson: NEW_SERVER_JSON })} disabled={config === null || busy !== null || Boolean(config.fileIssue)}>
              添加 MCP
            </button>
          </>
        )}
      />

      <div className="mcp-section-stack">
        <details className="mcp-source-disclosure">
          <summary>
            <span><b>配置源文件</b><code>{config?.path ?? '~/.rovai/mcp.json'}</code></span>
            <span>查看标准 JSON</span>
          </summary>
          <div className="mcp-source-panel">
            <div className="mcp-source-toolbar">
              <p>展示标准 <code>mcpServers</code>；内部元数据和敏感原文不出现在预览中。</p>
              <button className="quiet-button compact" type="button" onClick={() => void revealConfig()} disabled={busy !== null}>
                {busy === 'reveal' ? '正在打开…' : '在 Finder 中显示'}
              </button>
            </div>
            <pre>{config?.publicConfigJson || '{\n  "mcpServers": {}\n}'}</pre>
          </div>
        </details>

        {error && (
          <div className="skill-page-error" role="alert">
            <strong>操作未完成</strong><span>{error}</span>
            <button className="quiet-button compact" type="button" onClick={() => setError(null)}>关闭</button>
          </div>
        )}

        {config?.fileIssue && (
          <div className="mcp-file-banner" role="alert">
            <div>
              <strong>无法使用 MCP 配置</strong>
              <span>{issueText(config.fileIssue)} 原文件内容未被修改；后续新执行将不投影外部 MCP。</span>
              <code>{config.path}</code>
            </div>
            <div className="mcp-file-actions">
              <button className="quiet-button compact" type="button" onClick={() => void load()}>重新读取</button>
              <button className="quiet-button compact" type="button" onClick={() => void revealConfig()}>打开文件</button>
            </div>
          </div>
        )}

        {config?.permissionIssue && !config.fileIssue && (
          <div className="mcp-permission-banner" role="status">
            <div><strong>配置文件权限过宽</strong><span>建议恢复为仅当前用户可读写。</span></div>
            <button className="quiet-button compact" type="button" onClick={() => void repairPermissions()} disabled={busy !== null}>
              {busy === 'permissions' ? '正在修复…' : '修复权限'}
            </button>
          </div>
        )}

        <section className="section-block mcp-assignment-section">
          <div className="section-heading">
            <div><h2>队员分配工作台</h2><p>选择队员，再勾选其后续新执行可以使用的 MCP。</p></div>
            <span className="health-score">{members.length} 位队员</span>
          </div>
          {config === null && <div className="skill-empty" aria-live="polite">正在读取 MCP 配置…</div>}
          {config && members.length === 0 && <div className="skill-empty">当前没有可配置的队员。</div>}
          {config && members.length > 0 && (
            <McpAssignmentWorkbench
              members={members}
              servers={config.servers}
              busy={busy}
              disabled={Boolean(config.fileIssue)}
              onAssignment={(agent, server, assigned) => void setAssignment(agent, server, assigned)}
              onBulkAssignment={(agent, servers, assigned) => void setBulkAssignments(agent, servers, assigned)}
            />
          )}
        </section>

        <section className="section-block mcp-installed-section">
          <div className="section-heading">
            <div><h2>已安装的 MCP</h2><p>管理连接定义、启停状态与队员范围。</p></div>
            <span className="health-score">{config?.servers.length ?? '—'} 个</span>
          </div>
          {config && !config.fileIssue && config.servers.length === 0 && (
            <McpLibraryEmptyState
              busy={busy}
              onImport={() => void scan()}
              onAdd={() => setEditor({ serverId: null, definitionJson: NEW_SERVER_JSON })}
            />
          )}
          {config && !config.fileIssue && config.servers.length > 0 && (
            <McpServerLibrary
              members={members}
              servers={config.servers}
              busy={busy}
              onToggleEnabled={(server) => void setEnabled(server)}
              onEdit={(server) => setEditor({ serverId: server.serverId, definitionJson: server.definitionJson })}
              onDelete={setDeleting}
            />
          )}
        </section>
      </div>

      <JsonEditorDialog
        editor={editor}
        issues={formIssues}
        busy={busy === 'save'}
        onChange={setEditor}
        onClose={() => { setEditor(null); setFormIssues([]) }}
        onSave={() => void saveEditor()}
      />
      <ImportDialog
        inspection={inspection}
        drafts={importDrafts}
        busy={busy === 'import'}
        onDraftsChange={setImportDrafts}
        onClose={() => { setInspection(null); setImportDrafts({}); setFormIssues([]) }}
        onCommit={() => void commitImport()}
      />
      <DeleteServerDialog
        deleting={deleting}
        busy={busy !== null}
        onDeleteClose={() => setDeleting(null)}
        onDelete={() => void deleteServer()}
      />
    </div>
  )
}

export function McpLibraryEmptyState({
  busy,
  onImport,
  onAdd
}: {
  busy: string | null
  onImport(): void
  onAdd(): void
}): React.JSX.Element {
  return (
    <div className="mcp-empty">
      <div><strong>还没有 MCP Server</strong><p>手动添加标准 JSON，或从本机 Agent 配置中选择可安全迁移的定义。</p></div>
      <div className="mcp-empty-actions">
        <button className="quiet-button" type="button" onClick={onImport} disabled={busy !== null}>
          {busy === 'scan' ? '正在读取…' : '从本机配置导入'}
        </button>
        <button className="primary-button" type="button" onClick={onAdd} disabled={busy !== null}>手动添加</button>
      </div>
    </div>
  )
}

export function McpAssignmentWorkbench({
  members,
  servers,
  busy,
  disabled,
  onAssignment,
  onBulkAssignment
}: {
  members: AgentProfile[]
  servers: McpServerView[]
  busy: string | null
  disabled: boolean
  onAssignment(agent: AgentProfile, server: McpServerView, assigned: boolean): void
  onBulkAssignment(agent: AgentProfile, servers: McpServerView[], assigned: boolean): void
}): React.JSX.Element {
  const [selectedAgentId, setSelectedAgentId] = useState(members[0]?.agentId ?? '')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<McpServerFilter>('all')
  const selectedAgent = members.find((member) => member.agentId === selectedAgentId) ?? members[0]

  useEffect(() => {
    if (members.length > 0 && !members.some((member) => member.agentId === selectedAgentId)) {
      setSelectedAgentId(members[0].agentId)
    }
  }, [members, selectedAgentId])

  if (!selectedAgent) return <div className="skill-empty">当前没有可配置的队员。</div>

  const visibleServers = filterMcpServers(servers, query, filter, selectedAgent.agentId)
  const assignedCount = servers.filter((server) => server.assignedAgentIds.includes(selectedAgent.agentId)).length
  const selectTargets = bulkAssignmentTargets(visibleServers, selectedAgent.agentId, true)
  const clearTargets = bulkAssignmentTargets(visibleServers, selectedAgent.agentId, false)

  const focusMember = (index: number): void => {
    const member = members[index]
    if (!member) return
    document.getElementById(memberOptionId(member.agentId))?.focus()
    setSelectedAgentId(member.agentId)
  }

  const onRosterKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const currentIndex = Math.max(0, members.findIndex((member) => member.agentId === selectedAgent.agentId))
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = Math.min(members.length - 1, currentIndex + 1)
    if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1)
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = members.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    focusMember(nextIndex)
  }

  return (
    <div className="mcp-assignment-workbench">
      <aside className="mcp-member-roster-pane" aria-label="选择队员">
        <div className="mcp-member-roster-heading">
          <strong>队员</strong>
          <span>{members.length}</span>
        </div>
        <div className="mcp-member-roster" role="listbox" aria-label="队员列表" onKeyDown={onRosterKeyDown}>
          {members.map((member) => {
            const memberAssignedCount = servers.filter((server) => server.assignedAgentIds.includes(member.agentId)).length
            const selected = member.agentId === selectedAgent.agentId
            return (
              <button
                id={memberOptionId(member.agentId)}
                className={`mcp-member-roster-row ${selected ? 'is-selected' : ''}`}
                key={member.agentId}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => setSelectedAgentId(member.agentId)}
              >
                <MemberAvatar agentId={member.agentId} avatarRef={member.avatarRef} displayName={member.displayName} size="list" decorative />
                <span>
                  <strong>{member.displayName}</strong>
                  <small>{member.teamRole || '队员'} · {memberAssignedCount > 0 ? `${memberAssignedCount} 个 MCP` : '未分配'}</small>
                </span>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
              </button>
            )
          })}
        </div>
      </aside>

      <div className="mcp-assignment-chooser">
        <header className="mcp-assignment-chooser-heading">
          <div className="mcp-chosen-member">
            <MemberAvatar agentId={selectedAgent.agentId} avatarRef={selectedAgent.avatarRef} displayName={selectedAgent.displayName} size="picker" decorative />
            <div>
              <span>正在为队员配置</span>
              <strong>{selectedAgent.displayName}</strong>
              <small>{selectedAgent.teamRole || '队员'} · {assignedCount} / {servers.length} 个 MCP 已分配</small>
            </div>
          </div>
          <label className="mcp-search-field">
            <SearchIcon />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 MCP 名称、连接或来源" aria-label="搜索可分配 MCP" />
          </label>
        </header>

        <div className="mcp-assignment-toolbar">
          <div className="mcp-filter-rail" aria-label="分配筛选">
            {([
              ['all', '全部'],
              ['assigned', '只看已分配'],
              ['unassigned', '只看未分配']
            ] as const).map(([value, label]) => (
              <button className={filter === value ? 'is-active' : ''} key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
            ))}
          </div>
          <div className="mcp-bulk-actions">
            <button type="button" disabled={disabled || busy !== null || selectTargets.length === 0} onClick={() => onBulkAssignment(selectedAgent, selectTargets, true)}>选择筛选结果</button>
            <button type="button" disabled={disabled || busy !== null || clearTargets.length === 0} onClick={() => onBulkAssignment(selectedAgent, clearTargets, false)}>清空当前筛选</button>
          </div>
        </div>

        <div className="mcp-assignment-options" aria-label={`${selectedAgent.displayName}的 MCP`}>
          {visibleServers.map((server) => {
            const checked = server.assignedAgentIds.includes(selectedAgent.agentId)
            const saving = busy === `assignment:${selectedAgent.agentId}:${server.serverId}`
            return (
              <label
                className={`mcp-assignment-option ${checked ? 'is-assigned' : ''}`}
                data-mcp-server-name={server.name}
                key={server.serverId}
                style={{ '--mcp-identity': identityColorToken(server.serverId) } as CSSProperties}
              >
                <span className="mcp-assignment-option-mark" aria-hidden="true">{serverInitial(server)}</span>
                <span className="mcp-assignment-option-copy">
                  <strong>{server.name}</strong>
                  <small>{saving ? '保存中…' : `${mcpTransportLabel(server.transport)} · ${server.enabled ? '已启用' : '当前停用'}`}</small>
                  <code>{server.endpoint}</code>
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  aria-label={`${checked ? '取消分配' : '分配'} ${server.name} 给 ${selectedAgent.displayName}`}
                  disabled={disabled || busy !== null}
                  onChange={(event) => onAssignment(selectedAgent, server, event.target.checked)}
                />
              </label>
            )
          })}
          {visibleServers.length === 0 && (
            <div className="mcp-assignment-empty">{servers.length === 0 ? '请先添加 MCP Server。' : '当前筛选下没有 MCP。'}</div>
          )}
        </div>
      </div>
    </div>
  )
}

export function McpServerLibrary({
  members,
  servers,
  busy,
  onToggleEnabled,
  onEdit,
  onDelete
}: {
  members: AgentProfile[]
  servers: McpServerView[]
  busy: string | null
  onToggleEnabled(server: McpServerView): void
  onEdit(server: McpServerView): void
  onDelete(server: McpServerView): void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<McpServerFilter>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const visibleServers = filterMcpServers(servers, query, filter)
  const membersById = useMemo(() => new Map(members.map((member) => [member.agentId, member])), [members])

  const toggleDetails = (serverId: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(serverId)) next.delete(serverId)
      else next.add(serverId)
      return next
    })
  }

  return (
    <div className="mcp-library">
      <div className="mcp-library-toolbar">
        <label className="mcp-search-field">
          <SearchIcon />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 MCP 名称、连接或来源" aria-label="搜索已安装 MCP" />
        </label>
        <div className="mcp-filter-rail" aria-label="MCP Library 筛选">
          {([
            ['all', '全部'],
            ['enabled', '已启用']
          ] as const).map(([value, label]) => (
            <button className={filter === value ? 'is-active' : ''} key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
      </div>

      {visibleServers.length === 0 && <div className="skill-empty">当前筛选下没有 MCP。</div>}
      {visibleServers.length > 0 && (
        <div className="mcp-server-list">
          <div className="mcp-server-columns" aria-hidden="true">
            <span />
            <span>MCP</span>
            <span>队员范围</span>
            <span>状态</span>
            <span>查看</span>
          </div>
          {visibleServers.map((server) => {
            const isExpanded = expanded.has(server.serverId)
            const assignedMembers = server.assignedAgentIds.flatMap((agentId) => {
              const member = membersById.get(agentId)
              return member ? [member] : []
            })
            const detailsId = `mcp-details-${safeDomId(server.serverId)}`
            return (
              <article
                className={`mcp-server-row ${server.enabled ? 'is-enabled' : 'is-disabled'} ${isExpanded ? 'is-expanded' : ''}`}
                data-mcp-server-name={server.name}
                key={server.serverId}
                style={{ '--mcp-identity': identityColorToken(server.serverId) } as CSSProperties}
              >
                <div className="mcp-server-row-primary">
                  <span className="mcp-server-mark" aria-hidden="true">{serverInitial(server)}</span>
                  <div className="mcp-server-main">
                    <div className="mcp-server-title">
                      <strong title={server.name}>{server.name}</strong>
                      <span className={`mcp-source-badge source-${server.source}`}>{mcpSourceLabel(server.source)}</span>
                    </div>
                    <p>{mcpTransportLabel(server.transport)}</p>
                    <code>{server.endpoint}</code>
                  </div>
                  <div className="mcp-server-assignees" aria-label={`${server.assignedAgentIds.length} 位队员`}>
                    <div className="mcp-assignee-stack" aria-hidden="true">
                      {assignedMembers.slice(0, 3).map((member) => (
                        <MemberAvatar key={member.agentId} agentId={member.agentId} avatarRef={member.avatarRef} displayName={member.displayName} size="mention" decorative />
                      ))}
                      {server.assignedAgentIds.length > 3 && <span>+{server.assignedAgentIds.length - 3}</span>}
                    </div>
                    <span>{server.assignedAgentIds.length > 0 ? `${server.assignedAgentIds.length} 位队员` : '未分配'}</span>
                  </div>
                  <div className="mcp-server-status-control">
                    <button
                      className="skill-toggle"
                      type="button"
                      role="switch"
                      aria-checked={server.enabled}
                      aria-label={`${server.enabled ? '停用' : '启用'} ${server.name}`}
                      onClick={() => onToggleEnabled(server)}
                      disabled={busy !== null}
                    ><span aria-hidden="true" /></button>
                    <small>{busy === `toggle:${server.serverId}` ? '保存中…' : server.enabled ? '已启用' : '已停用'}</small>
                  </div>
                  <button
                    className="mcp-server-details-button"
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={detailsId}
                    onClick={() => toggleDetails(server.serverId)}
                  >
                    <span>详情</span>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
                  </button>
                </div>
                <div className="mcp-server-row-details" id={detailsId} hidden={!isExpanded}>
                  <dl>
                    <div><dt>连接方式</dt><dd>{mcpTransportLabel(server.transport)}</dd></div>
                    <div><dt>来源</dt><dd>{mcpSourceLabel(server.source)}</dd></div>
                    <div className="mcp-server-detail-wide"><dt>Endpoint</dt><dd><code>{server.endpoint}</code></dd></div>
                    <div className="mcp-server-detail-wide"><dt>可访问队员</dt><dd>{assignedMembers.length > 0 ? assignedMembers.map((member) => member.displayName).join('、') : '尚未分配队员'}</dd></div>
                  </dl>
                  <div className="mcp-server-row-actions">
                    <button className="quiet-button compact" type="button" onClick={() => onEdit(server)} disabled={busy !== null}>编辑 JSON</button>
                    <button className="quiet-button compact danger-text" type="button" onClick={() => onDelete(server)} disabled={busy !== null}>删除</button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function JsonEditorDialog({
  editor,
  issues,
  busy,
  onChange,
  onClose,
  onSave
}: {
  editor: JsonEditor | null
  issues: McpConfigIssue[]
  busy: boolean
  onChange(value: JsonEditor | null): void
  onClose(): void
  onSave(): void
}): React.JSX.Element {
  if (!editor) return <></>
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent className="mcp-editor-dialog" width="wide">
          <AppDialogHeader
            title={editor.serverId ? '编辑 MCP' : '添加 MCP'}
            description={<>粘贴一个标准 <code>mcpServers</code> 对象；本次只能保存一个 Server，外层对象键将作为 Server Name。</>}
            icon="server"
            closeDisabled={busy}
          />
          <AppDialogBody>
            {issues.length > 0 && <div className="mcp-dialog-issues" role="alert">{issues.map((issue) => <span key={`${issue.code}:${issue.field ?? ''}`}>{issueText(issue)}</span>)}</div>}
            <label className="mcp-json-editor">
              <span>Server Definition</span>
              <textarea autoFocus data-dialog-autofocus spellCheck={false} value={editor.definitionJson} onChange={(event) => onChange({ ...editor, definitionJson: event.target.value })} />
            </label>
          </AppDialogBody>
          <AppDialogFooter>
            <button className="quiet-button" type="button" onClick={onClose} disabled={busy}>取消</button>
            <button className="primary-button" type="button" onClick={onSave} disabled={busy || !editor.definitionJson.trim()}>{busy ? '正在保存…' : '保存 MCP'}</button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ImportDialog({
  inspection,
  drafts,
  busy,
  onDraftsChange,
  onClose,
  onCommit
}: {
  inspection: McpImportInspection | null
  drafts: Record<string, ImportDraft>
  busy: boolean
  onDraftsChange(value: Record<string, ImportDraft>): void
  onClose(): void
  onCommit(): void
}): React.JSX.Element {
  if (!inspection) return <></>
  const selectedCount = Object.values(drafts).filter((draft) => draft.selected).length
  const update = (candidateId: string, patch: Partial<ImportDraft>): void => {
    onDraftsChange({ ...drafts, [candidateId]: { ...drafts[candidateId], ...patch } })
  }
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent className="mcp-import-dialog" width="large" tone="info">
          <AppDialogHeader
            title="从本机配置导入 MCP"
            description="只读取用户级配置并生成预览。导入项默认停用且不分配队员；明文凭据不会复制或显示。"
            icon="download"
            kicker="本机只读扫描"
            closeDisabled={busy}
          />
          <AppDialogBody>
            <div className="mcp-import-sources" aria-label="读取来源">
              {inspection.sources.map((source) => (
                <span className={`mcp-source-status source-${source.status}`} key={`${source.sourceKind}:${source.sourcePath}`} title={source.sourcePath}>
                  <b>{sourceLabel(source.sourceKind)}</b>{source.status === 'loaded' ? `${source.candidateCount} 个` : source.status === 'missing' ? '未配置' : '读取失败'}
                </span>
              ))}
            </div>
            {inspection.candidates.length === 0 && <div className="skill-empty">没有发现可导入的 MCP Server。</div>}
            <div className="mcp-import-candidates">
              {inspection.candidates.map((candidate) => {
                const draft = drafts[candidate.candidateId]
                const unavailable = candidate.compatibility === 'unsupported' || !candidate.normalizedDefinitionJson || candidate.conflict === 'same'
                return (
                  <article className={`mcp-import-candidate ${unavailable ? 'unavailable' : ''}`} key={candidate.candidateId}>
                    <label className="mcp-import-select">
                      <input type="checkbox" checked={draft?.selected ?? false} disabled={unavailable} onChange={(event) => update(candidate.candidateId, { selected: event.target.checked })} />
                      <span><strong>{candidate.sourceName}</strong><small>{sourceLabel(candidate.sourceKind)} · {importCompatibilityLabel(candidate.compatibility, candidate.conflict)}</small></span>
                    </label>
                    <pre className="mcp-import-source-preview">{candidate.sourceDefinitionJson}</pre>
                    {draft?.selected && (
                      <div className="mcp-import-options">
                        {candidate.conflict === 'name_conflict' && (
                          <label><span>冲突处理</span><select value={draft.action} onChange={(event) => update(candidate.candidateId, { action: event.target.value as ImportDraft['action'] })}><option value="replace">替换同名 Server，保留 ID 与分配</option><option value="create">修改 JSON 后另存</option></select></label>
                        )}
                        <label className="mcp-import-json"><span>规范化后的 JSON</span><textarea spellCheck={false} value={draft.definitionJson} onChange={(event) => update(candidate.candidateId, { definitionJson: event.target.value })} /></label>
                      </div>
                    )}
                    <div className="mcp-import-issues">
                      {candidate.issues.map((issue) => <span className={`issue-${issue.kind}`} key={`${candidate.candidateId}:${issue.code}:${issue.field ?? ''}`}>{importIssueText(issue.code, issue.message)}</span>)}
                    </div>
                    {unavailable && <p className="mcp-import-manual">该来源包含 Rovai 当前无法等价表达的权限或未知字段，因此不会自动导入。你仍可根据预览手动创建标准 JSON。</p>}
                  </article>
                )
              })}
            </div>
          </AppDialogBody>
          <AppDialogFooter note="导入后需显式启用并分配给队员。">
            <button className="quiet-button" type="button" onClick={onClose} disabled={busy}>取消</button>
            <button className="primary-button" type="button" onClick={onCommit} disabled={busy || selectedCount === 0}>{busy ? '正在导入…' : `导入所选（${selectedCount}）`}</button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function DeleteServerDialog({
  deleting,
  busy,
  onDeleteClose,
  onDelete
}: {
  deleting: McpServerView | null
  busy: boolean
  onDeleteClose(): void
  onDelete(): void
}): React.JSX.Element {
  return (
    <Dialog.Root open={deleting !== null} onOpenChange={(open) => { if (!open) onDeleteClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent tone="danger">
          <AppDialogHeader
            title={`删除 MCP Server “${deleting?.name ?? ''}”？`}
            description="将删除 Server 定义和全部队员分配。"
            icon="server"
            kicker="配置删除"
            closeDisabled={busy}
          />
          <AppDialogFooter>
            <button className="quiet-button" type="button" autoFocus data-dialog-autofocus onClick={onDeleteClose} disabled={busy}>取消</button>
            <button className="danger-button" type="button" onClick={onDelete} disabled={busy}>{busy ? '正在删除…' : '删除 MCP'}</button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function buildImportDrafts(inspection: McpImportInspection, servers: McpServerView[]): Record<string, ImportDraft> {
  return Object.fromEntries(inspection.candidates.map((candidate) => {
    const existing = servers.find((server) => server.name.toLocaleLowerCase() === candidate.proposedName.toLocaleLowerCase())
    return [candidate.candidateId, {
      selected: false,
      action: candidate.conflict === 'name_conflict' ? 'replace' : 'create',
      replaceServerId: existing?.serverId,
      definitionJson: candidate.normalizedDefinitionJson ?? ''
    }]
  }))
}

export function filterMcpServers(
  servers: McpServerView[],
  query: string,
  filter: McpServerFilter,
  agentId?: string
): McpServerView[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return servers.filter((server) => {
    const assigned = agentId ? server.assignedAgentIds.includes(agentId) : false
    if (filter === 'assigned' && !assigned) return false
    if (filter === 'unassigned' && assigned) return false
    if (filter === 'enabled' && !server.enabled) return false
    if (!normalizedQuery) return true
    return [
      server.name,
      server.endpoint,
      mcpTransportLabel(server.transport),
      mcpSourceLabel(server.source)
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  })
}

export function bulkAssignmentTargets(
  servers: McpServerView[],
  agentId: string,
  assigned: boolean
): McpServerView[] {
  return servers.filter((server) => server.assignedAgentIds.includes(agentId) !== assigned)
}

export function mcpTransportLabel(transport: McpServerView['transport']): string {
  return transport === 'stdio' ? 'Stdio' : 'Streamable HTTP'
}

export function mcpSourceLabel(source: McpServerView['source']): string {
  if (source === 'import') return '本机导入'
  return '用户添加'
}

export function importCompatibilityLabel(
  compatibility: McpImportCandidate['compatibility'],
  conflict: McpImportCandidate['conflict']
): string {
  if (conflict === 'same') return '已存在相同配置'
  if (conflict === 'name_conflict') return '名称冲突'
  if (conflict === 'duplicate_definition') return '可能重复'
  if (compatibility === 'unsupported') return '不支持自动导入'
  if (compatibility === 'needs_input') return '需要补充环境变量引用'
  return '可导入'
}

function sourceLabel(source: McpImportCandidate['sourceKind']): string {
  switch (source) {
    case 'codex': return 'Codex'
    case 'claude_code': return 'Claude Code'
    case 'opencode': return 'OpenCode'
    case 'copilot': return 'Copilot'
    case 'antigravity': return 'Antigravity'
    case 'cursor': return 'Cursor'
  }
}

function serverInitial(server: McpServerView): string {
  return server.name.slice(0, 2).toUpperCase()
}

function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function memberOptionId(agentId: string): string {
  return `mcp-member-${safeDomId(agentId)}`
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.25" />
      <path d="m12.5 12.5 4 4" />
    </svg>
  )
}

function issueText(issue: McpConfigIssue): string {
  const known: Record<string, string> = {
    'mcp.name_conflict': 'Server Name 已被使用。',
    'mcp.not_found': '该 MCP Server 已不存在，请重新读取。',
    'mcp.single_entry_required': 'JSON 必须且只能包含一个 mcpServers 条目。',
    'mcp.definition_json_invalid': 'JSON 格式或字段不符合 MCP Schema。',
    'mcp.unknown_agent_profile': '该队员已不存在。',
    'mcp.import_candidate_unsupported': '该候选包含当前不支持自动迁移的配置。'
  }
  return known[issue.code] ?? issue.message
}

function importIssueText(code: string, fallback: string): string {
  const known: Record<string, string> = {
    'mcp.import_enabled_reset': '来源启用状态不会继承；导入后保持停用且不分配队员。',
    'mcp.import_literal_redacted': '来源明文值已隐藏，并替换为待确认的环境变量引用。',
    'mcp.import_unknown_field': '存在未识别字段，已阻止自动导入。',
    'mcp.import_tool_policy_unsupported': '来源包含工具白名单、黑名单或审批策略，已阻止自动导入。',
    'mcp.import_trust_unsupported': '来源包含 trust 配置，已阻止自动导入。',
    'mcp.import_oauth_unsupported': '来源依赖 OAuth 状态或凭据缓存，已阻止自动导入。',
    'mcp.import_runtime_option_dropped': '已丢弃不影响权限的 Agent 运行时专属参数。'
  }
  return known[code] ?? fallback
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error))
}
