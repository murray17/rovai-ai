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
  McpServerInput,
  McpServerView
} from '@contracts'

const AUTO_SCAN_KEY = 'rovai.mcp.initialScanCompleted.v1'
const LEGACY_AUTO_SCAN_KEYS = [
  'horizonward.mcp.initialScanCompleted.v1',
  'lumen.mcp.initialScanCompleted.v1'
] as const

function hasCompletedInitialScan(): boolean {
  if (window.localStorage.getItem(AUTO_SCAN_KEY) === 'true') return true
  if (!LEGACY_AUTO_SCAN_KEYS.some((key) => window.localStorage.getItem(key) === 'true')) {
    return false
  }
  window.localStorage.setItem(AUTO_SCAN_KEY, 'true')
  LEGACY_AUTO_SCAN_KEYS.forEach((key) => window.localStorage.removeItem(key))
  return true
}

type EditorState = {
  originalName: string | null
  name: string
  transport: 'stdio' | 'streamable_http'
  enabled: boolean
  agentProfileIds: string[]
  command: string
  args: string
  cwd: string
  url: string
  values: EditableValueRow[]
  missingValues: string[]
}

type EditableValueRow = {
  id: string
  key: string
  value: string
  preserveStored: boolean
  hasStoredValue: boolean
  sensitive: boolean
}

type ImportDraft = {
  selected: boolean
  action: 'create' | 'replace'
  name: string
  definition: McpServerInput | null
  acceptAllTools: boolean
}

export function McpSettings({ agents }: { agents: AgentProfile[] }): React.JSX.Element {
  const activeAgents = useMemo(
    () => agents.filter((agent) => agent.status === 'active').sort((left, right) => left.memberOrder - right.memberOrder),
    [agents]
  )
  const [config, setConfig] = useState<McpConfigView | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
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

  const scan = useCallback(async (automatic = false): Promise<void> => {
    setBusy(automatic ? 'auto-scan' : 'scan')
    setError(null)
    try {
      const next = await window.rovai.request<McpImportInspection>('mcp.import.scan')
      setInspection(next)
      setImportDrafts(buildImportDrafts(next))
      if (automatic) window.localStorage.setItem(AUTO_SCAN_KEY, 'true')
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.rovai.request<McpConfigView>('mcp.config.get')
      .then((next) => {
        if (cancelled) return
        setConfig(next)
        if (
          !next.fileIssue
          && !hasCompletedInitialScan()
        ) {
          void scan(true)
        }
      })
      .catch((nextError) => {
        if (!cancelled) setError(errorMessage(nextError))
      })
    const onFocus = (): void => {
      void load().catch((nextError) => setError(errorMessage(nextError)))
    }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [load, scan])

  const applyMutation = async (result: McpMutationResult): Promise<boolean> => {
    if (result.status === 'ok') {
      setConfig(result.config)
      setFormIssues([])
      return true
    }
    if (result.status === 'conflict') {
      await load()
      setError('配置文件已被其他操作修改。Rovai-ai 已重新读取，请确认后再保存。')
      return false
    }
    setFormIssues(result.issues)
    return false
  }

  const saveEditor = async (): Promise<void> => {
    if (!editor || !config) return
    setBusy('save')
    setError(null)
    setFormIssues([])
    try {
      const definition = editorInput(editor)
      const result = editor.originalName
        ? await window.rovai.request<McpMutationResult>('mcp.servers.update', {
            expectedConfigDigest: config.configDigest,
            name: editor.originalName,
            newName: editor.name.trim(),
            definition
          })
        : await window.rovai.request<McpMutationResult>('mcp.servers.create', {
            expectedConfigDigest: config.configDigest,
            name: editor.name.trim(),
            definition
          })
      if (await applyMutation(result)) setEditor(null)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const setEnabled = async (server: McpServerView): Promise<void> => {
    if (!config) return
    setBusy(`toggle-${server.name}`)
    setError(null)
    try {
      const result = await window.rovai.request<McpMutationResult>('mcp.servers.setEnabled', {
        expectedConfigDigest: config.configDigest,
        name: server.name,
        enabled: !server.enabled
      })
      await applyMutation(result)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const deleteServer = async (): Promise<void> => {
    if (!config || !deleting) return
    setBusy(`delete-${deleting.name}`)
    setError(null)
    try {
      const result = await window.rovai.request<McpMutationResult>('mcp.servers.delete', {
        expectedConfigDigest: config.configDigest,
        name: deleting.name
      })
      if (await applyMutation(result)) setDeleting(null)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const repairPermissions = async (): Promise<void> => {
    setBusy('repair-permissions')
    setError(null)
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
    setError(null)
    try {
      await window.rovai.revealMcpConfig()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const commitImport = async (): Promise<void> => {
    if (!inspection) return
    const selections = inspection.candidates.flatMap((candidate) => {
      const draft = importDrafts[candidate.candidateId]
      if (!draft?.selected || !draft.definition) return []
      const selection: McpImportSelection = {
        candidateId: candidate.candidateId,
        action: draft.action,
        name: draft.name.trim(),
        definition: draft.definition,
        acceptAllTools: draft.acceptAllTools,
        hasNonportableToolFilter: candidate.issues.some((issue) => issue.requiresConfirmation),
        hasBlockingIssues: candidate.issues.some((issue) => issue.blocking)
      }
      return [selection]
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
      if (await applyMutation(result)) {
        setInspection(null)
        setImportDrafts({})
        window.localStorage.setItem(AUTO_SCAN_KEY, 'true')
      }
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mcp-settings">
      <section className="project-hero mcp-hero">
        <div>
          <h2>MCP</h2>
          <p>应用级外部 MCP Server，按成员分配，不自动暴露给所有 Agent；Rovai-ai 不修改其他 Agent 的配置。</p>
        </div>
        <div className="project-actions">
          <button className="quiet-button" type="button" onClick={() => void scan()} disabled={busy !== null}>
            {busy === 'scan' || busy === 'auto-scan' ? '正在扫描…' : '从本机 Agent 导入'}
          </button>
          <button className="primary-button" type="button" onClick={() => setEditor(emptyEditor(activeAgents))} disabled={busy !== null || Boolean(config?.fileIssue)}>
            添加 MCP
          </button>
        </div>
      </section>

      <div className="mcp-config-path">
        <span>真源文件 <code>{config?.path ?? '~/.rovai/mcp.json'}</code></span>
        <button className="mcp-config-reveal" type="button" onClick={() => void revealConfig()} disabled={busy !== null}>
          {busy === 'reveal' ? '正在打开…' : '在 Finder 中显示'}
        </button>
      </div>

      {error && (
        <div className="skill-page-error" role="alert">
          <strong>操作未完成</strong>
          <span>{error}</span>
          <button className="quiet-button compact" type="button" onClick={() => setError(null)}>关闭</button>
        </div>
      )}

      {config?.fileIssue && (
        <div className="mcp-file-banner" role="alert">
          <div>
            <strong>无法读取 MCP 配置</strong>
            <span>{issueText(config.fileIssue)}{config.fileIssue.line ? `（${config.fileIssue.line}:${config.fileIssue.column ?? 1}）` : ''}</span>
            <code>{config.path}</code>
          </div>
          <div className="project-actions">
            <button className="quiet-button compact" type="button" onClick={() => void load()}>重新读取</button>
            <button className="quiet-button compact" type="button" onClick={() => void revealConfig()}>打开文件</button>
          </div>
        </div>
      )}

      {config?.permissionIssue && !config.fileIssue && (
        <div className="mcp-permission-banner" role="status">
          <div><strong>配置文件权限过宽</strong><span>其中可能包含本机凭据。建议恢复为仅当前用户可读写。</span></div>
          <button className="quiet-button compact" type="button" onClick={() => void repairPermissions()} disabled={busy !== null}>
            {busy === 'repair-permissions' ? '正在修复…' : '修复权限'}
          </button>
        </div>
      )}

      <section className="section-block">
        <div className="section-heading">
          <div><h2>Server</h2></div>
          <span className="health-score">{config?.servers.length ?? '—'} 个</span>
        </div>
        {config === null && <div className="skill-empty" aria-live="polite">正在读取 MCP Library…</div>}
        {config && !config.fileIssue && config.servers.length === 0 && (
          <div className="mcp-empty">
            <div><strong>还没有 MCP Server</strong><p>可以手动添加，或从 Codex、Claude Code、OpenCode、Copilot、Antigravity 和 Cursor 的用户配置中选择导入。</p></div>
            <div className="project-actions">
              <button className="quiet-button" type="button" onClick={() => void scan()} disabled={busy !== null}>扫描本机配置</button>
              <button className="primary-button" type="button" onClick={() => setEditor(emptyEditor(activeAgents))} disabled={busy !== null}>添加 MCP</button>
            </div>
          </div>
        )}
        {config && !config.fileIssue && config.servers.length > 0 && (
          <div className="mcp-server-list">
            {config.servers.map((server) => (
              <article className="mcp-server-row" key={server.name}>
                <div className="mcp-server-main">
                  <div className="mcp-server-title">
                    <strong>{server.name}</strong>
                    <span className={`mcp-transport ${server.transport === 'stdio' ? '' : 'transport-http'}`}>{mcpTransportLabel(server.transport)}</span>
                    <span className={`status-badge ${server.enabled ? 'status-completed' : 'status-neutral'}`}>
                      <i />{server.enabled ? '已启用' : '已停用'}
                    </span>
                  </div>
                  <code>{serverEndpoint(server)}</code>
                  <p>{serverMemberSummary(server, activeAgents)}</p>
                  {server.missingValues.length > 0 && (
                    <span className="mcp-inline-issue">缺少配置值：{server.missingValues.join('、')}</span>
                  )}
                  {server.issues.map((issue) => (
                    <span className="mcp-inline-issue" key={`${server.name}:${issue.code}:${issue.field ?? ''}`}>{issueText(issue)}</span>
                  ))}
                </div>
                <div className="mcp-server-actions">
                  <button
                    className="skill-toggle"
                    type="button"
                    role="switch"
                    aria-checked={server.enabled}
                    aria-label={`${server.enabled ? '停用' : '启用'} ${server.name}`}
                    onClick={() => void setEnabled(server)}
                    disabled={busy !== null || (!server.enabled && server.missingValues.length > 0)}
                  >
                    <span aria-hidden="true" />
                    {busy === `toggle-${server.name}` ? '保存中' : server.enabled ? '已启用' : '已停用'}
                  </button>
                  <button className="quiet-button compact" type="button" onClick={() => setEditor(editorFromServer(server))} disabled={busy !== null}>编辑</button>
                  <button className="danger-button" type="button" onClick={() => setDeleting(server)} disabled={busy !== null}>删除</button>
                </div>
              </article>
            ))}
          </div>
        )}
        <p className="mcp-footnote">改动只保存到本机真源文件，并从下一个 AgentRun 开始生效；Rovai-ai 不修改各 Runtime 自己的 MCP 配置。</p>
      </section>

      <ServerEditorDialog
        editor={editor}
        configPath={config?.path ?? '~/.rovai/mcp.json'}
        agents={activeAgents}
        busy={busy === 'save'}
        issues={formIssues}
        onChange={setEditor}
        onClose={() => { setEditor(null); setFormIssues([]) }}
        onSave={() => void saveEditor()}
      />
      <ImportDialog
        inspection={inspection}
        drafts={importDrafts}
        agents={activeAgents}
        busy={busy === 'import'}
        onDraftsChange={setImportDrafts}
        onClose={() => { setInspection(null); setImportDrafts({}); setFormIssues([]) }}
        onCommit={() => void commitImport()}
      />
      <Dialog.Root open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content compact-dialog">
            <Dialog.Title>删除 MCP Server？</Dialog.Title>
            <Dialog.Description>将从 Rovai-ai 的 MCP Library 删除 <strong>{deleting?.name}</strong>。正在执行的 AgentRun 不受影响，后续 AgentRun 不再获得它。</Dialog.Description>
            <div className="dialog-actions">
              <Dialog.Close asChild><button className="quiet-button" type="button" disabled={busy !== null}>取消</button></Dialog.Close>
              <button className="danger-button" type="button" onClick={() => void deleteServer()} disabled={busy !== null}>{busy?.startsWith('delete-') ? '正在删除…' : '删除'}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

function ServerEditorDialog({
  editor,
  configPath,
  agents,
  busy,
  issues,
  onChange,
  onClose,
  onSave
}: {
  editor: EditorState | null
  configPath: string
  agents: AgentProfile[]
  busy: boolean
  issues: McpConfigIssue[]
  onChange(value: EditorState | null): void
  onClose(): void
  onSave(): void
}): React.JSX.Element {
  if (!editor) return <></>
  const update = (patch: Partial<EditorState>): void => onChange({ ...editor, ...patch })
  const allSelected = agents.length > 0 && agents.every((agent) => editor.agentProfileIds.includes(agent.id))
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content mcp-editor-dialog">
          <Dialog.Title>{editor.originalName ? '编辑 MCP Server' : '添加 MCP Server'}</Dialog.Title>
          <Dialog.Description>配置只保存在本机 <code>{configPath}</code>，并从下一个 AgentRun 开始生效。</Dialog.Description>
          {issues.length > 0 && (
            <div className="mcp-dialog-issues" role="alert">
              {issues.map((issue) => <span key={`${issue.code}:${issue.field ?? ''}`}>{issueText(issue)}</span>)}
            </div>
          )}
          <div className="mcp-form-grid">
            <label><span>名称</span><input autoFocus value={editor.name} onChange={(event) => update({ name: event.target.value })} placeholder="context7" /></label>
            <label><span>连接方式</span><select value={editor.transport} onChange={(event) => update({ transport: event.target.value as EditorState['transport'], values: [], missingValues: [] })}><option value="stdio">Stdio</option><option value="streamable_http">Streamable HTTP</option></select></label>
            {editor.transport === 'stdio'
              ? (
                <>
                  <label className="mcp-form-wide"><span>命令</span><input value={editor.command} onChange={(event) => update({ command: event.target.value })} placeholder="npx" /></label>
                  <label className="mcp-form-wide"><span>参数（每行一个）</span><textarea value={editor.args} onChange={(event) => update({ args: event.target.value })} rows={3} placeholder={'-y\n@example/mcp-server'} /></label>
                  <label className="mcp-form-wide"><span>工作目录（留空则使用 AgentRun 目录）</span><input value={editor.cwd} onChange={(event) => update({ cwd: event.target.value })} placeholder="/path/to/workdir" /></label>
                </>
                )
              : <label className="mcp-form-wide"><span>URL</span><input value={editor.url} onChange={(event) => update({ url: event.target.value })} placeholder="https://example.com/mcp" /></label>}
          </div>
          <MemberSelection
            agents={agents}
            selected={editor.agentProfileIds}
            onChange={(agentProfileIds) => update({ agentProfileIds })}
            allSelected={allSelected}
          />
          <KeyValueEditor
            title={editor.transport === 'stdio' ? '环境变量' : 'HTTP Headers'}
            rows={editor.values}
            onChange={(values) => update({ values })}
          />
          <label className="mcp-enabled-check">
            <input type="checkbox" checked={editor.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
            <span>保存后启用</span>
          </label>
          <div className="dialog-actions">
            <button className="quiet-button" type="button" onClick={onClose} disabled={busy}>取消</button>
            <button className="primary-button" type="button" onClick={onSave} disabled={busy || !editor.name.trim()}>{busy ? '正在保存…' : '保存'}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function MemberSelection({
  agents,
  selected,
  allSelected,
  onChange
}: {
  agents: AgentProfile[]
  selected: string[]
  allSelected: boolean
  onChange(value: string[]): void
}): React.JSX.Element {
  return (
    <fieldset className="mcp-member-fieldset">
      <legend>适用成员</legend>
      <label className="mcp-member-all">
        <input type="checkbox" checked={allSelected} onChange={(event) => onChange(event.target.checked ? agents.map((agent) => agent.id) : [])} />
        <span>全部活跃成员</span>
      </label>
      <div className="mcp-member-options">
        {agents.map((agent) => (
          <label key={agent.id}>
            <input
              type="checkbox"
              checked={selected.includes(agent.id)}
              onChange={(event) => onChange(event.target.checked
                ? [...new Set([...selected, agent.id])]
                : selected.filter((id) => id !== agent.id))}
            />
            <span>{agent.displayName}</span>
            <small>@{agent.handle}</small>
          </label>
        ))}
        {agents.length === 0 && <span className="mcp-no-members">当前没有活跃成员。Server 可以保存，但不会向任何 Agent 暴露。</span>}
      </div>
    </fieldset>
  )
}

function KeyValueEditor({
  title,
  rows,
  onChange
}: {
  title: string
  rows: EditableValueRow[]
  onChange(value: EditableValueRow[]): void
}): React.JSX.Element {
  return (
    <fieldset className="mcp-value-fieldset">
      <legend>{title}</legend>
      {rows.map((row) => (
        <div className="mcp-value-row" key={row.id}>
          <input aria-label={`${title}名称`} value={row.key} onChange={(event) => onChange(rows.map((value) => value.id === row.id ? { ...value, key: event.target.value } : value))} placeholder="NAME" />
          <input
            aria-label={`${title}值`}
            type={row.sensitive || row.hasStoredValue ? 'password' : 'text'}
            value={row.value}
            onChange={(event) => onChange(rows.map((value) => value.id === row.id ? { ...value, value: event.target.value, preserveStored: event.target.value.length === 0 && value.hasStoredValue } : value))}
            placeholder={row.hasStoredValue && row.preserveStored ? '保留已保存值' : '${ENV_VAR} 或本地值'}
          />
          <button className="quiet-button compact" type="button" aria-label={`删除 ${row.key || title} 条目`} onClick={() => onChange(rows.filter((value) => value.id !== row.id))}>移除</button>
        </div>
      ))}
      <button className="quiet-button compact" type="button" onClick={() => onChange([...rows, newValueRow()])}>添加一项</button>
      <p>优先使用 <code>${'{ENV_VAR}'}</code>。直接填写的值会以明文保存在本机配置中，界面不会再次显示敏感原文。</p>
    </fieldset>
  )
}

function ImportDialog({
  inspection,
  drafts,
  agents,
  busy,
  onDraftsChange,
  onClose,
  onCommit
}: {
  inspection: McpImportInspection | null
  drafts: Record<string, ImportDraft>
  agents: AgentProfile[]
  busy: boolean
  onDraftsChange(value: Record<string, ImportDraft>): void
  onClose(): void
  onCommit(): void
}): React.JSX.Element {
  if (!inspection) return <></>
  const selectedCount = Object.values(drafts).filter((draft) => draft.selected).length
  const updateDraft = (candidateId: string, patch: Partial<ImportDraft>): void => {
    onDraftsChange({ ...drafts, [candidateId]: { ...drafts[candidateId], ...patch } })
  }
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content mcp-import-dialog">
          <Dialog.Title>从本机 Agent 导入</Dialog.Title>
          <Dialog.Description>这里只读取用户级配置并生成候选。导入后 Rovai-ai 不再与来源文件同步，来源中的明文凭据不会复制。</Dialog.Description>
          <div className="mcp-import-sources" aria-label="扫描来源">
            {inspection.sources.map((source) => (
              <span className={`mcp-source-status source-${source.status}`} key={source.sourceKind}>
                <b>{sourceLabel(source.sourceKind)}</b>
                {source.status === 'loaded' ? `${source.candidateCount} 个` : source.status === 'missing' ? '未配置' : '读取失败'}
              </span>
            ))}
          </div>
          {inspection.candidates.length === 0 && <div className="skill-empty">没有发现可导入的 MCP Server。可以关闭此窗口后手动添加。</div>}
          <div className="mcp-import-candidates">
            {inspection.candidates.map((candidate) => {
              const draft = drafts[candidate.candidateId]
              const unavailable = candidate.compatibility === 'unsupported' || !draft?.definition || candidate.conflict === 'same'
              return (
                <article className={`mcp-import-candidate ${unavailable ? 'unavailable' : ''}`} key={candidate.candidateId}>
                  <label className="mcp-import-select">
                    <input type="checkbox" checked={draft?.selected ?? false} disabled={unavailable} onChange={(event) => updateDraft(candidate.candidateId, { selected: event.target.checked })} />
                    <span><strong>{candidate.sourceName}</strong><small>{sourceLabel(candidate.sourceKind)} · {importCompatibilityLabel(candidate.compatibility, candidate.conflict)}</small></span>
                  </label>
                  {draft?.selected && draft.definition && (
                    <div className="mcp-import-options">
                      {candidate.conflict === 'name_conflict' && (
                        <label><span>冲突处理</span><select value={draft.action} onChange={(event) => updateDraft(candidate.candidateId, { action: event.target.value as ImportDraft['action'] })}><option value="replace">替换现有配置（保留启用和成员）</option><option value="create">改名导入</option></select></label>
                      )}
                      <label><span>导入名称</span><input value={draft.name} disabled={draft.action === 'replace'} onChange={(event) => updateDraft(candidate.candidateId, { name: event.target.value })} /></label>
                      <div className="mcp-import-members">
                        <span>适用成员</span>
                        {agents.map((agent) => (
                          <label key={agent.id}>
                            <input
                              type="checkbox"
                              checked={draft.definition?.agentProfileIds.includes(agent.id) ?? false}
                              onChange={(event) => {
                                if (!draft.definition) return
                                updateDraft(candidate.candidateId, {
                                  definition: {
                                    ...draft.definition,
                                    agentProfileIds: event.target.checked
                                      ? [...new Set([...draft.definition.agentProfileIds, agent.id])]
                                      : draft.definition.agentProfileIds.filter((id) => id !== agent.id)
                                  }
                                })
                              }}
                            />
                            <span>{agent.displayName}</span>
                          </label>
                        ))}
                      </div>
                      {candidate.issues.some((issue) => issue.requiresConfirmation) && (
                        <label className="mcp-import-confirm"><input type="checkbox" checked={draft.acceptAllTools} onChange={(event) => updateDraft(candidate.candidateId, { acceptAllTools: event.target.checked })} /><span>我确认忽略来源 Tool Filter，按全部工具导入</span></label>
                      )}
                    </div>
                  )}
                  {candidate.issues.map((issue) => <span className="mcp-import-issue" key={`${candidate.candidateId}:${issue.code}`}>{importIssueText(issue.code, issue.message)}</span>)}
                </article>
              )
            })}
          </div>
          <div className="dialog-actions">
            <button className="quiet-button" type="button" onClick={onClose} disabled={busy}>稍后处理</button>
            <button className="primary-button" type="button" onClick={onCommit} disabled={busy || selectedCount === 0}>{busy ? '正在导入…' : `导入所选（${selectedCount}）`}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function emptyEditor(agents: AgentProfile[]): EditorState {
  return {
    originalName: null,
    name: '',
    transport: 'stdio',
    enabled: true,
    agentProfileIds: agents.map((agent) => agent.id),
    command: '',
    args: '',
    cwd: '',
    url: '',
    values: [],
    missingValues: []
  }
}

function editorFromServer(server: McpServerView): EditorState {
  const values = Object.entries(server.transport === 'stdio' ? server.env : server.headers)
    .map(([key, view]) => ({
      id: crypto.randomUUID(),
      key,
      value: view.value ?? '',
      preserveStored: view.hasStoredValue && view.value === null,
      hasStoredValue: view.hasStoredValue,
      sensitive: view.sensitive
    }))
  return {
    originalName: server.name,
    name: server.name,
    transport: server.transport,
    enabled: server.enabled,
    agentProfileIds: server.agentProfileIds,
    command: server.transport === 'stdio' ? server.command : '',
    args: server.transport === 'stdio' ? server.args.join('\n') : '',
    cwd: server.transport === 'stdio' ? server.cwd ?? '' : '',
    url: server.transport === 'streamable_http' ? server.url : '',
    values,
    missingValues: server.missingValues
  }
}

function editorInput(editor: EditorState): McpServerInput {
  const values = Object.fromEntries(editor.values
    .filter((row) => row.key.trim())
    .map((row) => [row.key.trim(), {
      value: row.value.length > 0 ? row.value : null,
      preserveStored: row.value.length === 0 && row.preserveStored
    }]))
  const remainingMissing = editor.missingValues.filter((key) => {
    const row = editor.values.find((value) => value.key.trim() === key)
    return !row || row.value.length === 0
  })
  if (editor.transport === 'stdio') {
    return {
      transport: 'stdio',
      enabled: editor.enabled,
      agentProfileIds: editor.agentProfileIds,
      command: editor.command.trim(),
      args: parseArgumentLines(editor.args),
      cwd: editor.cwd.trim() || null,
      env: values,
      missingValues: remainingMissing
    }
  }
  return {
    transport: 'streamable_http',
    enabled: editor.enabled,
    agentProfileIds: editor.agentProfileIds,
    url: editor.url.trim(),
    headers: values,
    missingValues: remainingMissing
  }
}

function newValueRow(): EditableValueRow {
  return {
    id: crypto.randomUUID(),
    key: '',
    value: '',
    preserveStored: false,
    hasStoredValue: false,
    sensitive: false
  }
}

function buildImportDrafts(inspection: McpImportInspection): Record<string, ImportDraft> {
  return Object.fromEntries(inspection.candidates.map((candidate) => [
    candidate.candidateId,
    {
      selected: false,
      action: candidate.conflict === 'name_conflict' ? 'replace' : 'create',
      name: candidate.proposedName,
      definition: candidate.normalizedDefinition,
      acceptAllTools: false
    }
  ]))
}

export function parseArgumentLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

export function mcpTransportLabel(transport: McpServerView['transport']): string {
  return transport === 'stdio' ? 'Stdio' : 'Streamable HTTP'
}

export function serverMemberSummary(server: McpServerView, agents: AgentProfile[]): string {
  if (server.agentProfileIds.length === 0) return '尚未分配成员'
  const names = server.agentProfileIds.map((id) => agents.find((agent) => agent.id === id)?.displayName ?? `未知成员 ${id}`)
  return `适用成员：${names.join('、')}`
}

export function importCompatibilityLabel(
  compatibility: McpImportCandidate['compatibility'],
  conflict: McpImportCandidate['conflict']
): string {
  if (conflict === 'same') return '已存在相同配置'
  if (conflict === 'name_conflict') return '名称冲突'
  if (conflict === 'duplicate_definition') return '可能重复'
  if (compatibility === 'unsupported') return '当前不支持'
  if (compatibility === 'needs_input') return '导入后需补充配置'
  return '可导入'
}

function serverEndpoint(server: McpServerView): string {
  return server.transport === 'stdio'
    ? [server.command, ...server.args].join(' ')
    : server.url
}

function sourceLabel(source: McpImportCandidate['sourceKind']): string {
  switch (source) {
    case 'codex': return 'Codex'
    case 'claude_code': return 'Claude Code'
    case 'opencode': return 'OpenCode'
    case 'copilot': return 'Copilot CLI'
    case 'antigravity': return 'Antigravity'
    case 'cursor': return 'Cursor'
  }
}

function issueText(issue: McpConfigIssue): string {
  const known: Record<string, string> = {
    'mcp.name_conflict': '名称已被其他 MCP Server 使用。',
    'mcp.not_found': '该 MCP Server 已不存在，请重新读取。',
    'mcp.value_required': '补齐导入时缺失的值后，才能启用该 MCP Server。',
    'mcp.values_required': '请先补齐导入时缺失的配置值。',
    'mcp.unknown_agent_profile': '配置中包含已经不存在的成员，请重新选择适用成员。',
    'mcp.config_conflict': '配置文件已经变化，请重新读取后再保存。',
    'mcp.import_tool_filter_confirmation_required': '必须确认按全部工具导入。',
    'mcp.import_candidate_unsupported': '该候选包含当前不支持的配置。'
  }
  return known[issue.code] ?? issue.message
}

function importIssueText(code: string, fallback: string): string {
  const known: Record<string, string> = {
    'mcp.redacted_value': '来源中的明文值没有复制；导入后需要重新填写。',
    'mcp.nonportable_tool_filter': '来源配置限制了具体工具；只能明确确认按全部工具导入。',
    'mcp.unsupported_oauth': '来源依赖不可移植的 OAuth 状态，当前不能导入。',
    'mcp.unsupported_transport': '当前不支持旧式 SSE Transport。',
    'mcp.import_bearer_header_required': '需要在 Rovai-ai 中重新填写 Authorization Header。',
    'mcp.import_invalid_definition': 'Server 定义格式无效。',
    'mcp.import_invalid_field': 'Server 中存在无效字段。',
    'mcp.import_source_invalid': '来源配置无法读取。',
    'mcp.import_transport_unknown': '无法判断该 Server 的连接方式。',
    'mcp.runtime_option_ignored': '来源包含 Runtime 专属选项，导入时不会复制。'
  }
  return known[code] ?? fallback
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
