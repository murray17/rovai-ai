import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { SettingsPageHeader } from './SettingsPageHeader'
import { localizeExecutionEngineTerms } from './product-copy'

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

type RiskAction =
  | { kind: 'enable'; server: McpServerView }
  | { kind: 'assignment'; server: McpServerView; agent: AgentProfile; assigned: boolean }

const NEW_SERVER_JSON = `{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@example/mcp-server"]
    }
  }
}`

export function McpSettings({ agents }: { agents: AgentProfile[] }): React.JSX.Element {
  const activeAgents = useMemo(
    () => agents
      .filter((agent) => agent.presence === 'present')
      .sort((left, right) => left.memberOrder - right.memberOrder),
    [agents]
  )
  const [config, setConfig] = useState<McpConfigView | null>(null)
  const [editor, setEditor] = useState<JsonEditor | null>(null)
  const [deleting, setDeleting] = useState<McpServerView | null>(null)
  const [riskAction, setRiskAction] = useState<RiskAction | null>(null)
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

  const applyMutation = useCallback(async (result: McpMutationResult): Promise<'ok' | 'risk' | 'failed'> => {
    if (result.status === 'ok') {
      setConfig(result.config)
      setFormIssues([])
      return 'ok'
    }
    if (result.status === 'risk_acknowledgement_required') return 'risk'
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

  const setEnabled = async (server: McpServerView, acknowledgeHighRisk = false): Promise<void> => {
    if (!config) return
    setBusy(`toggle:${server.serverId}`)
    setError(null)
    try {
      const result = await window.rovai.request<McpMutationResult>('mcp.servers.setEnabled', {
        expectedConfigDigest: config.configDigest,
        serverId: server.serverId,
        enabled: !server.enabled,
        acknowledgeHighRisk
      })
      const outcome = await applyMutation(result)
      if (outcome === 'risk') setRiskAction({ kind: 'enable', server })
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
    assigned: boolean,
    acknowledgeHighRisk = false
  ): Promise<void> => {
    if (!config) return
    const key = `assignment:${agent.id}:${server.serverId}`
    setBusy(key)
    setError(null)
    try {
      const result = await window.rovai.request<McpMutationResult>('mcp.assignments.set', {
        expectedConfigDigest: config.configDigest,
        serverId: server.serverId,
        agentProfileId: agent.id,
        assigned,
        acknowledgeHighRisk
      })
      const outcome = await applyMutation(result)
      if (outcome === 'risk') setRiskAction({ kind: 'assignment', server, agent, assigned })
    } catch (nextError) {
      await load().catch(() => undefined)
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const confirmRisk = async (): Promise<void> => {
    const action = riskAction
    if (!action) return
    setRiskAction(null)
    if (action.kind === 'enable') {
      await setEnabled(action.server, true)
    } else {
      await setAssignment(action.agent, action.server, action.assigned, true)
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

  return (
    <div className="mcp-settings">
      <SettingsPageHeader
        eyebrow="Settings / MCP"
        title="MCP 配置"
        description="统一管理外部 MCP Server，并决定每位队员在下一个 AgentRun 中可以使用哪些 MCP。"
        aside={(
          <>
            <button className="quiet-button" type="button" onClick={() => void scan()} disabled={busy !== null || Boolean(config?.fileIssue)}>
              {busy === 'scan' ? '正在读取…' : '从本机 Agent 导入'}
            </button>
            <button className="primary-button" type="button" onClick={() => setEditor({ serverId: null, definitionJson: NEW_SERVER_JSON })} disabled={busy !== null || Boolean(config?.fileIssue)}>
              添加 MCP
            </button>
          </>
        )}
      />

      <details className="mcp-source-disclosure">
        <summary>
          <span><b>配置源文件</b><code>{config?.path ?? '~/.rovai/mcp.json'}</code></span>
          <span>查看标准 JSON</span>
        </summary>
        <div className="mcp-source-panel">
          <div className="mcp-source-toolbar">
            <p>这里只展示标准 <code>mcpServers</code>；内部元数据和敏感原文不会出现在预览中。</p>
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
            <span>{issueText(config.fileIssue)} 原文件内容未被修改；新的 AgentRun 将不投影外部 MCP。</span>
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
          <div><span className="mcp-section-index">01</span><h2>为队员配置 MCP</h2><p>选择一位队员，再勾选其可以使用的 MCP。每次勾选都会立即保存。</p></div>
          <span className="health-score">{activeAgents.length} 位队员</span>
        </div>
        {config === null && <div className="skill-empty" aria-live="polite">正在读取 MCP 配置…</div>}
        {config && activeAgents.length === 0 && <div className="skill-empty">当前没有可配置的队员。</div>}
        {config && activeAgents.length > 0 && (
          <div className="mcp-member-grid">
            {activeAgents.map((agent) => (
              <MemberMcpCard
                key={agent.id}
                agent={agent}
                servers={config.servers}
                busy={busy}
                disabled={Boolean(config.fileIssue)}
                onAssignment={(server, assigned) => void setAssignment(agent, server, assigned)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="section-block mcp-installed-section">
        <div className="section-heading">
          <div><span className="mcp-section-index">02</span><h2>已安装的 MCP</h2><p>Server 的连接定义、启停与状态统一在这里管理。</p></div>
          <span className="health-score">{config?.servers.length ?? '—'} 个</span>
        </div>
        {config && !config.fileIssue && config.servers.length === 0 && (
          <div className="mcp-empty"><div><strong>还没有 MCP Server</strong><p>添加标准 JSON，或从本机 Agent 配置中选择可安全迁移的定义。</p></div></div>
        )}
        {config && !config.fileIssue && config.servers.length > 0 && (
          <div className="mcp-server-grid">
            {config.servers.map((server) => (
              <article className={`mcp-server-card ${server.enabled ? 'is-enabled' : ''}`} key={server.serverId}>
                <div className="mcp-server-card-top">
                  <div className="mcp-server-icon" aria-hidden="true">{serverInitial(server)}</div>
                  <div className="mcp-server-main">
                    <div className="mcp-server-title">
                      <strong>{server.name}</strong>
                      {server.source === 'builtin' && <span className="mcp-preset-badge">内置</span>}
                      {server.riskLevel === 'high' && <span className="mcp-risk-badge">高权限</span>}
                    </div>
                    <span>{mcpTransportLabel(server.transport)}</span>
                  </div>
                  <button
                    className="skill-toggle"
                    type="button"
                    role="switch"
                    aria-checked={server.enabled}
                    aria-label={`${server.enabled ? '停用' : '启用'} ${server.name}`}
                    onClick={() => void setEnabled(server)}
                    disabled={busy !== null}
                  ><span aria-hidden="true" /></button>
                </div>
                <code className="mcp-server-endpoint">{server.endpoint}</code>
                <div className="mcp-server-meta">
                  <span className={`status-badge ${server.enabled ? 'status-completed' : 'status-neutral'}`}><i />{server.enabled ? '已启用' : '已停用'}</span>
                  <span>{server.assignedAgentProfileIds.length} 位队员</span>
                </div>
                <div className="mcp-server-card-actions">
                  <button className="quiet-button compact" type="button" onClick={() => setEditor({ serverId: server.serverId, definitionJson: server.definitionJson })} disabled={busy !== null}>编辑 JSON</button>
                  <button className="danger-button compact" type="button" onClick={() => setDeleting(server)} disabled={busy !== null}>删除</button>
                </div>
              </article>
            ))}
          </div>
        )}
        <p className="mcp-footnote">配置和分配从下一个 AgentRun 开始生效；正在运行的 AgentRun 继续使用其冻结投影。</p>
      </section>

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
      <ConfirmDialogs
        deleting={deleting}
        riskAction={riskAction}
        busy={busy !== null}
        onDeleteClose={() => setDeleting(null)}
        onDelete={() => void deleteServer()}
        onRiskClose={() => setRiskAction(null)}
        onRiskConfirm={() => void confirmRisk()}
      />
    </div>
  )
}

export function MemberMcpCard({
  agent,
  servers,
  busy,
  disabled,
  onAssignment
}: {
  agent: AgentProfile
  servers: McpServerView[]
  busy: string | null
  disabled: boolean
  onAssignment(server: McpServerView, assigned: boolean): void
}): React.JSX.Element {
  const assigned = servers.filter((server) => server.assignedAgentProfileIds.includes(agent.id))
  return (
    <article className="mcp-member-card">
      <div className="mcp-member-identity">
        <span className="mcp-member-avatar" aria-hidden="true">{agent.displayName.slice(0, 1)}</span>
        <div><strong>{agent.displayName}</strong><span>{agent.teamRole || '队员'}</span></div>
        <span className="mcp-member-count">{assigned.length}</span>
      </div>
      <p>{assigned.length > 0 ? assigned.map((server) => server.name).join('、') : '尚未配置 MCP'}</p>
      <details className="mcp-member-picker">
        <summary>{assigned.length > 0 ? `已选择 ${assigned.length} 个 MCP` : '选择 MCP'}</summary>
        <div className="mcp-member-picker-menu">
          {servers.map((server) => {
            const checked = server.assignedAgentProfileIds.includes(agent.id)
            const saving = busy === `assignment:${agent.id}:${server.serverId}`
            return (
              <label key={server.serverId}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || busy !== null}
                  onChange={(event) => onAssignment(server, event.target.checked)}
                />
                <span><b>{server.name}</b><small>{server.enabled ? '已启用' : '当前停用'}{server.riskLevel === 'high' ? ' · 高权限' : ''}</small></span>
                {saving && <i>保存中…</i>}
              </label>
            )
          })}
          {servers.length === 0 && <span className="mcp-picker-empty">请先添加 MCP Server。</span>}
        </div>
      </details>
    </article>
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
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content mcp-editor-dialog">
          <Dialog.Title>{editor.serverId ? '编辑 MCP' : '添加 MCP'}</Dialog.Title>
          <Dialog.Description>使用标准 <code>mcpServers</code> JSON，且只能包含一个 Server。对象键就是可编辑的 Server Name。</Dialog.Description>
          {issues.length > 0 && <div className="mcp-dialog-issues" role="alert">{issues.map((issue) => <span key={`${issue.code}:${issue.field ?? ''}`}>{issueText(issue)}</span>)}</div>}
          <label className="mcp-json-editor">
            <span>Server Definition</span>
            <textarea autoFocus spellCheck={false} value={editor.definitionJson} onChange={(event) => onChange({ ...editor, definitionJson: event.target.value })} />
          </label>
          <div className="mcp-json-help">
            <span>Stdio：<code>command</code>、<code>args</code>、<code>env</code>、<code>cwd</code></span>
            <span>HTTP：<code>url</code>、<code>headers</code></span>
          </div>
          <div className="dialog-actions">
            <button className="quiet-button" type="button" onClick={onClose} disabled={busy}>取消</button>
            <button className="primary-button" type="button" onClick={onSave} disabled={busy || !editor.definitionJson.trim()}>{busy ? '正在保存…' : '保存'}</button>
          </div>
        </Dialog.Content>
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
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content mcp-import-dialog">
          <Dialog.Title>从本机 Agent 导入</Dialog.Title>
          <Dialog.Description>只读取本机用户级配置并生成预览。导入结果统一停用且不分配队员；来源明文凭据不会复制或显示。</Dialog.Description>
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
          <div className="dialog-actions">
            <button className="quiet-button" type="button" onClick={onClose} disabled={busy}>取消</button>
            <button className="primary-button" type="button" onClick={onCommit} disabled={busy || selectedCount === 0}>{busy ? '正在导入…' : `导入所选（${selectedCount}）`}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ConfirmDialogs({
  deleting,
  riskAction,
  busy,
  onDeleteClose,
  onDelete,
  onRiskClose,
  onRiskConfirm
}: {
  deleting: McpServerView | null
  riskAction: RiskAction | null
  busy: boolean
  onDeleteClose(): void
  onDelete(): void
  onRiskClose(): void
  onRiskConfirm(): void
}): React.JSX.Element {
  return (
    <>
      <Dialog.Root open={deleting !== null} onOpenChange={(open) => { if (!open) onDeleteClose() }}>
        <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content compact-dialog">
          <Dialog.Title>删除 MCP Server？</Dialog.Title>
          <Dialog.Description>将删除 <strong>{deleting?.name}</strong> 的定义和全部队员分配。正在执行的 AgentRun 不受影响。</Dialog.Description>
          <div className="dialog-actions"><button className="quiet-button" type="button" onClick={onDeleteClose} disabled={busy}>取消</button><button className="danger-button" type="button" onClick={onDelete} disabled={busy}>删除</button></div>
        </Dialog.Content></Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={riskAction !== null} onOpenChange={(open) => { if (!open) onRiskClose() }}>
        <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content compact-dialog mcp-risk-dialog">
          <Dialog.Title>启用高权限 MCP？</Dialog.Title>
          <Dialog.Description><strong>{riskAction?.server.name}</strong> 可以操作浏览器或访问更广泛的本机资源。只有在你信任其配置与来源时才继续。</Dialog.Description>
          <div className="dialog-actions"><button className="quiet-button" type="button" onClick={onRiskClose} disabled={busy}>返回</button><button className="primary-button" type="button" onClick={onRiskConfirm} disabled={busy}>我了解风险，继续</button></div>
        </Dialog.Content></Dialog.Portal>
      </Dialog.Root>
    </>
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

export function mcpTransportLabel(transport: McpServerView['transport']): string {
  return transport === 'stdio' ? 'Stdio' : 'Streamable HTTP'
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
  if (server.presetId === 'github') return 'GH'
  if (server.presetId === 'context7') return 'C7'
  if (server.presetId === 'playwright') return 'PW'
  return server.name.slice(0, 2).toUpperCase()
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
    'mcp.import_runtime_option_dropped': '已丢弃不影响权限的 Runtime 专属参数。'
  }
  return known[code] ?? fallback
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error))
}
