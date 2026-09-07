import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
import { MemberAvatar } from './MemberAvatar'
import {
  CapabilityError,
  CapabilityListItem,
  CapabilityToggle,
  CapabilityWorkspace,
  type CapabilityFilter
} from './CapabilityWorkspace'
import { readErrorMessage } from './error-message'
import { localizeExecutionEngineTerms } from './product-copy'
import { identityColorToken } from './theme'

type JsonDraft = { text: string; baseDefinition: string }
export type McpImportDraft = {
  selected: boolean
  action: 'create' | 'replace' | null
  replaceServerId?: string
  definitionJson: string
  open: boolean
}
export const NEW_SERVER_JSON =
  '{\n  "mcpServers": {\n    "my-server": {\n      "command": "npx",\n      "args": ["-y", "@example/mcp-server"]\n    }\n  }\n}'

export function importableMcp(candidate: McpImportCandidate): boolean {
  return (
    candidate.compatibility !== 'unsupported' &&
    candidate.conflict !== 'same' &&
    candidate.normalizedDefinitionJson !== null &&
    !candidate.issues.some((issue) => issue.blocking)
  )
}
export function buildMcpImportDrafts(
  inspection: McpImportInspection,
  servers: McpServerView[],
  previous: Record<string, McpImportDraft> = {}
): Record<string, McpImportDraft> {
  return Object.fromEntries(
    inspection.candidates.map((candidate) => {
      const existing = servers.find(
        (server) => server.name.toLocaleLowerCase() === candidate.proposedName.toLocaleLowerCase()
      )
      const prior = previous[candidate.candidateId]
      return [
        candidate.candidateId,
        prior && importableMcp(candidate)
          ? {
              ...prior,
              replaceServerId: existing?.serverId,
              action: candidate.conflict === 'name_conflict' ? prior.action : 'create'
            }
          : {
              selected: false,
              action: candidate.conflict === 'name_conflict' ? null : 'create',
              replaceServerId: existing?.serverId,
              definitionJson: candidate.normalizedDefinitionJson ?? '',
              open: candidate.compatibility === 'needs_input'
            }
      ]
    })
  )
}

export function McpSettings({
  agents
}: {
  agents: AgentProfile[]
  platform?: NodeJS.Platform
}): React.JSX.Element {
  const members = useMemo(
    () =>
      agents
        .filter((agent) => agent.presence === 'present')
        .sort((a, b) => a.memberOrder - b.memberOrder),
    [agents]
  )
  const [config, setConfig] = useState<McpConfigView | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<CapabilityFilter>('all')
  const [drafts, setDrafts] = useState<Record<string, JsonDraft>>({})
  const [newJson, setNewJson] = useState<string | null>(null)
  const [inspection, setInspection] = useState<McpImportInspection | null>(null)
  const [importDrafts, setImportDrafts] = useState<Record<string, McpImportDraft>>({})
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const locked = useRef(false)
  const generation = useRef(0)
  const editorSession = useRef(0)
  const load = useCallback(async (): Promise<McpConfigView> => {
    const request = ++generation.current
    const next = await window.rovai.request<McpConfigView>('mcp.config.get')
    if (request === generation.current) setConfig(next)
    return next
  }, [])
  useEffect(() => {
    const refresh = (): void => {
      if (!locked.current) void load().catch((reason) => setError(errorMessage(reason)))
    }
    refresh()
    window.addEventListener('focus', refresh)
    const unsubscribe = window.rovai.onEvent((event) => {
      if (
        event.method === 'runtime.state' &&
        (event.params as { status?: string })?.status === 'ready'
      )
        refresh()
    })
    return () => {
      generation.current++
      choose(null)
      window.removeEventListener('focus', refresh)
      unsubscribe()
    }
  }, [load])
  const run = async (key: string, action: () => Promise<void>): Promise<void> => {
    if (locked.current) return
    locked.current = true
    setBusy(key)
    setError(null)
    try {
      await action()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      locked.current = false
      setBusy(null)
    }
  }
  const apply = async (result: McpMutationResult): Promise<McpConfigView> => {
    if (result.status === 'ok') {
      ++generation.current
      setConfig(result.config)
      return result.config
    }
    if (result.status === 'conflict') {
      await load()
      throw new Error('配置已更新。已保留你的更改；编辑时可重新载入，导入时请重新扫描。')
    }
    if (result.status === 'invalid') throw new Error(issueText(result.issues[0]))
    throw new Error('MCP 配置未能保存，请重新读取后再试。')
  }
  const selected =
    selectedId === 'new' || selectedId === 'import'
      ? undefined
      : (config?.servers.find((server) => server.serverId === selectedId) ?? config?.servers[0])
  const visible = filterMcpServers(config?.servers ?? [], search, filter)
  const choose = (id: string | null): void => {
    setSelectedId(id)
    selectedRef.current = id
    editorSession.current++
    setDrafts({})
    setNewJson(id === 'new' ? NEW_SERVER_JSON : null)
    setInspection(null)
    setImportDrafts({})
    setDeleting(false)
    setError(null)
  }
  const clearDraft = (id: string): void =>
    setDrafts((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  const save = (): void => {
    if (!config) return
    const adding = selectedId === 'new',
      server = selected
    if (!adding && !server) return
    const text = adding
      ? (newJson ?? '')
      : (drafts[server!.serverId]?.text ?? server!.definitionJson)
    void run('save', async () => {
      try {
        JSON.parse(text)
      } catch {
        throw new Error('JSON 格式不正确，请检查括号、引号和逗号。')
      }
      if (server && drafts[server.serverId]?.baseDefinition !== server.definitionJson)
        throw new Error('该连接已在其他位置更新。请保留需要的内容，再点击“重新载入”后编辑。')
      const result = await window.rovai.request<McpMutationResult>(
        adding ? 'mcp.servers.create' : 'mcp.servers.update',
        {
          expectedConfigDigest: config.configDigest,
          ...(server ? { serverId: server.serverId } : {}),
          definitionJson: text
        }
      )
      const next = await apply(result)
      if (adding) {
        setNewJson(null)
        setFilter('all')
        setSearch('')
        const created = next.servers.find(
          (value) => !config.servers.some((prior) => prior.serverId === value.serverId)
        )
        if (selectedRef.current === 'new') choose(created?.serverId ?? null)
      } else clearDraft(server!.serverId)
    })
  }
  const toggle = (server: McpServerView): void => {
    if (!config) return
    void run('toggle', async () => {
      await apply(
        await window.rovai.request<McpMutationResult>('mcp.servers.setEnabled', {
          expectedConfigDigest: config.configDigest,
          serverId: server.serverId,
          enabled: !server.enabled,
          acknowledgeHighRisk: true
        })
      )
    })
  }
  const assign = (agent: AgentProfile, server: McpServerView): void => {
    if (!config) return
    void run('assignment', async () => {
      await apply(
        await window.rovai.request<McpMutationResult>('mcp.assignments.set', {
          expectedConfigDigest: config.configDigest,
          serverId: server.serverId,
          agentId: agent.agentId,
          assigned: !server.assignedAgentIds.includes(agent.agentId),
          acknowledgeHighRisk: true
        })
      )
    })
  }
  const remove = (server: McpServerView): void => {
    if (!config) return
    void run('delete', async () => {
      await apply(
        await window.rovai.request<McpMutationResult>('mcp.servers.delete', {
          expectedConfigDigest: config.configDigest,
          serverId: server.serverId
        })
      )
      clearDraft(server.serverId)
      if (selectedRef.current === server.serverId) choose(null)
    })
  }
  const scan = (): void => {
    choose('import')
    const session = editorSession.current
    void run('scan', async () => {
      const next = await window.rovai.request<McpImportInspection>('mcp.import.scan')
      if (editorSession.current !== session) return
      setInspection(next)
      setImportDrafts(buildMcpImportDrafts(next, config?.servers ?? []))
    })
  }
  const commitImport = (): void => {
    if (!inspection) return
    void run('import', async () => {
      const selections: McpImportSelection[] = inspection.candidates
        .filter(
          (candidate) => importDrafts[candidate.candidateId]?.selected && importableMcp(candidate)
        )
        .map((candidate) => {
          const draft = importDrafts[candidate.candidateId]
          if (!draft.action)
            throw new Error(`请为 ${candidate.proposedName} 选择替换现有或另存为。`)
          if (draft.action === 'replace' && draft.replaceServerId && drafts[draft.replaceServerId])
            throw new Error('该 MCP 有未保存更改，请先保存或放弃更改，再替换。')
          return {
            candidateId: candidate.candidateId,
            action: draft.action,
            ...(draft.action === 'replace' ? { replaceServerId: draft.replaceServerId } : {}),
            definitionJson: draft.definitionJson,
            hasBlockingIssues: false
          }
        })
      if (!selections.length) throw new Error('请选择要导入的 MCP。')
      const next = await apply(
        await window.rovai.request<McpMutationResult>('mcp.import.commit', {
          expectedConfigDigest: inspection.configDigest,
          selections
        })
      )
      setInspection(null)
      setImportDrafts({})
      setFilter('all')
      setSearch('')
      if (selectedRef.current === 'import')
        choose(
          next.servers.find(
            (server) => !config?.servers.some((prior) => prior.serverId === server.serverId)
          )?.serverId ??
            next.servers[0]?.serverId ??
            null
        )
    })
  }
  const disabled = busy !== null || !config || Boolean(config.fileIssue)
  return (
    <CapabilityWorkspace
      title="MCP"
      count={
        search || filter !== 'all'
          ? `${visible.length}/${config?.servers.length ?? 0}`
          : (config?.servers.length ?? '—')
      }
      search={search}
      onSearch={setSearch}
      filter={filter}
      onFilter={setFilter}
      onAdd={() => choose('new')}
      addDisabled={disabled}
      selectionKey={
        selectedId === 'new' || selectedId === 'import' ? selectedId : (selected?.serverId ?? null)
      }
      importAction={
        <button
          className="quiet-button compact"
          aria-label="从本机导入 MCP"
          title="从本机导入 MCP"
          type="button"
          disabled={disabled}
          onClick={scan}
        >
          ↓ 导入
        </button>
      }
      list={
        !config ? (
          <div className="capability-empty" role="status">
            正在读取 MCP 配置…
          </div>
        ) : visible.length ? (
          visible.map((server) => (
            <McpListItem
              key={server.serverId}
              server={server}
              dirty={Boolean(drafts[server.serverId])}
              selected={server.serverId === selected?.serverId}
              onSelect={() => choose(server.serverId)}
            />
          ))
        ) : (
          <div className="capability-empty">
            {config.servers.length ? '没有匹配的 MCP。' : '还没有 MCP。'}
            {(search || filter !== 'all') && (
              <button
                className="quiet-button compact"
                type="button"
                onClick={() => {
                  setSearch('')
                  setFilter('all')
                }}
              >
                清除筛选
              </button>
            )}
          </div>
        )
      }
    >
      <CapabilityError
        error={error}
        onRetry={
          !config
            ? () => {
                void run('load', async () => {
                  await load()
                })
              }
            : undefined
        }
      />
      {config?.fileIssue && (
        <div className="capability-error" role="alert">
          <span>配置暂时无法读取，请修正后重新读取。</span>
          <div className="capability-actions">
            <button
              type="button"
              className="quiet-button compact"
              disabled={busy !== null}
              onClick={() => {
                void run('load', async () => {
                  await load()
                })
              }}
            >
              重新读取
            </button>
            <button
              type="button"
              className="quiet-button compact"
              disabled={busy !== null}
              onClick={() => {
                void run('reveal', async () => {
                  await window.rovai.revealMcpConfig()
                })
              }}
            >
              打开文件
            </button>
          </div>
        </div>
      )}
      {config?.permissionIssue && !config.fileIssue && (
        <div className="capability-error">
          <span>配置文件权限需要收紧。</span>
          <button
            type="button"
            className="quiet-button compact"
            disabled={busy !== null}
            onClick={() => {
              void run('permissions', async () =>
                setConfig(await window.rovai.request<McpConfigView>('mcp.config.repairPermissions'))
              )
            }}
          >
            修复权限
          </button>
        </div>
      )}
      {selectedId === 'import' ? (
        <>
          <header className="capability-detail-heading">
            <h2>从本机导入</h2>
            <button
              type="button"
              className="quiet-button compact"
              disabled={busy !== null}
              onClick={() => {
                setInspection(null)
                setImportDrafts({})
                choose(null)
              }}
            >
              取消
            </button>
          </header>
          {busy === 'scan' ? (
            <div className="capability-empty" role="status">
              正在查找本机配置…
            </div>
          ) : inspection ? (
            <McpImportPanel
              inspection={inspection}
              drafts={importDrafts}
              busy={busy !== null}
              onChange={setImportDrafts}
              onScan={scan}
              onCommit={commitImport}
            />
          ) : (
            <button type="button" className="quiet-button compact" onClick={scan}>
              重新扫描
            </button>
          )}
        </>
      ) : selectedId === 'new' || selected ? (
        <>
          <header className="capability-detail-heading">
            <div className="capability-title">
              <h2>{selected?.name ?? '添加 MCP'}</h2>
              {selected && (
                <span className="capability-source">
                  {selected.transport === 'stdio' ? 'Stdio' : 'HTTP'}
                </span>
              )}
            </div>
            {selected ? (
              <CapabilityToggle
                name={selected.name}
                enabled={selected.enabled}
                disabled={disabled}
                onToggle={() => toggle(selected)}
              />
            ) : (
              <button
                type="button"
                className="quiet-button compact"
                disabled={busy !== null}
                onClick={() => {
                  setNewJson(null)
                  choose(null)
                }}
              >
                取消
              </button>
            )}
          </header>
          <label className="capability-json-field">
            <span>配置 JSON</span>
            <textarea
              aria-label="MCP 配置 JSON"
              spellCheck={false}
              value={
                selected
                  ? (drafts[selected.serverId]?.text ?? selected.definitionJson)
                  : (newJson ?? '')
              }
              disabled={busy !== null || Boolean(config?.fileIssue)}
              onChange={(event) => {
                const text = event.target.value
                setError(null)
                if (selected)
                  setDrafts((current) => ({
                    ...current,
                    [selected.serverId]: {
                      text,
                      baseDefinition:
                        current[selected.serverId]?.baseDefinition ?? selected.definitionJson
                    }
                  }))
                else setNewJson(text)
              }}
            />
          </label>
          {!selected && <p className="capability-note">粘贴包含一个 MCP 的 mcpServers JSON。</p>}
          <div className="capability-save">
            <span className="capability-note">
              {selected
                ? drafts[selected.serverId]
                  ? '有未保存更改'
                  : '已保存'
                : '新添加的 MCP 默认关闭'}
            </span>
            <div className="capability-actions">
              {selected && drafts[selected.serverId] && (
                <button
                  type="button"
                  className="quiet-button compact"
                  disabled={busy !== null}
                  onClick={() => {
                    clearDraft(selected.serverId)
                    setError(null)
                  }}
                >
                  {drafts[selected.serverId].baseDefinition === selected.definitionJson
                    ? '放弃更改'
                    : '重新载入'}
                </button>
              )}
              <button
                type="button"
                className="primary-button"
                disabled={disabled || (selected ? !drafts[selected.serverId] : !newJson?.trim())}
                onClick={save}
              >
                {busy === 'save' ? '正在保存…' : selected ? '保存' : '添加 MCP'}
              </button>
            </div>
          </div>
          {selected && (
            <>
              <section className="capability-section">
                <McpMemberChoices
                  members={members}
                  server={selected}
                  disabled={disabled}
                  onAssignment={(member) => assign(member, selected)}
                />
              </section>
              <section className="capability-section">
                {deleting ? (
                  <div className="capability-confirm">
                    <strong>删除 {selected.name}？</strong>
                    <p>将删除连接定义及队员分配。</p>
                    <div className="capability-actions">
                      <button
                        type="button"
                        className="quiet-button compact"
                        disabled={disabled}
                        onClick={() => setDeleting(false)}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        disabled={disabled}
                        onClick={() => remove(selected)}
                      >
                        确认删除
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="quiet-button compact capability-danger"
                    disabled={disabled}
                    onClick={() => setDeleting(true)}
                  >
                    删除 MCP
                  </button>
                )}
              </section>
            </>
          )}
        </>
      ) : (
        !config?.fileIssue && (
          <div className="capability-empty">从左侧选择 MCP，或添加新的连接。</div>
        )
      )}
    </CapabilityWorkspace>
  )
}

export function McpListItem({
  server,
  dirty = false,
  selected,
  onSelect
}: {
  server: McpServerView
  dirty?: boolean
  selected: boolean
  onSelect(): void
}): React.JSX.Element {
  return (
    <CapabilityListItem
      name={server.name}
      mark={
        <span
          className="capability-mcp-mark"
          style={{ '--mcp-identity': identityColorToken(server.serverId) } as CSSProperties}
        >
          {serverInitial(server)}
        </span>
      }
      enabled={server.enabled}
      summary={`${dirty ? '未保存 · ' : ''}${server.transport === 'stdio' ? 'Stdio' : 'HTTP'} · ${server.assignedAgentIds.length} 位队员`}
      selected={selected}
      onSelect={onSelect}
    />
  )
}
export function McpMemberChoices({
  members,
  server,
  disabled,
  onAssignment
}: {
  members: AgentProfile[]
  server: McpServerView
  disabled: boolean
  onAssignment(agent: AgentProfile): void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const visible = members.filter((member) =>
    `${member.displayName} ${member.teamRole ?? ''}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase())
  )
  return (
    <>
      <div className="capability-scope-heading">
        <h3>使用队员</h3>
        <span className="capability-note">
          {members.filter((member) => server.assignedAgentIds.includes(member.agentId)).length}{' '}
          位已选
        </span>
      </div>
      {members.length > 8 && (
        <label className="capability-search">
          <span className="sr-only">搜索队员</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索队员"
            aria-label="搜索队员"
          />
        </label>
      )}
      <div className="capability-member-options">
        {visible.map((member) => (
          <button
            type="button"
            className="capability-choice capability-member-choice"
            key={member.agentId}
            aria-pressed={server.assignedAgentIds.includes(member.agentId)}
            disabled={disabled}
            onClick={() => onAssignment(member)}
          >
            <MemberAvatar
              agentId={member.agentId}
              avatarRef={member.avatarRef}
              displayName={member.displayName}
              size="list"
              decorative
            />
            <span>
              <strong>{member.displayName}</strong>
              <small>{member.teamRole || '队员'}</small>
            </span>
            <span className="capability-check" aria-hidden="true">
              ✓
            </span>
          </button>
        ))}
      </div>
      {!visible.length && (
        <p className="capability-note">{members.length ? '没有匹配的队员。' : '暂无队员。'}</p>
      )}
    </>
  )
}
export function McpImportPanel({
  inspection,
  drafts,
  busy,
  onChange,
  onScan,
  onCommit
}: {
  inspection: McpImportInspection
  drafts: Record<string, McpImportDraft>
  busy: boolean
  onChange(drafts: Record<string, McpImportDraft>): void
  onScan(): void
  onCommit(): void
}): React.JSX.Element {
  const available = inspection.candidates.filter(importableMcp)
  const other = inspection.candidates.filter((candidate) => !importableMcp(candidate))
  const selected = available.filter((candidate) => drafts[candidate.candidateId]?.selected)
  const update = (id: string, patch: Partial<McpImportDraft>): void =>
    onChange({ ...drafts, [id]: { ...drafts[id], ...patch } })
  return (
    <>
      <div className="capability-scope-heading">
        <span className="capability-note">{available.length} 项可选择</span>
        <button type="button" className="quiet-button compact" disabled={busy} onClick={onScan}>
          重新扫描
        </button>
      </div>
      <div className="capability-import-items">
        {available.map((candidate) => {
          const draft = drafts[candidate.candidateId]
          if (!draft) return null
          return (
            <article className="capability-import-item" key={candidate.candidateId}>
              <div className="capability-import-item-heading">
                <button
                  type="button"
                  className="capability-import-pick"
                  aria-pressed={draft.selected}
                  disabled={busy}
                  onClick={() => update(candidate.candidateId, { selected: !draft.selected })}
                >
                  <span>
                    <strong title={candidate.proposedName}>{candidate.proposedName}</strong>
                    <small>
                      {sourceLabel(candidate.sourceKind)}
                      {candidate.conflict === 'name_conflict' ? ' · 已有同名项' : ''}
                    </small>
                  </span>
                  <span className="capability-check" aria-hidden="true">
                    ✓
                  </span>
                </button>
                <button
                  type="button"
                  className="quiet-button compact"
                  aria-expanded={draft.open}
                  onClick={() => update(candidate.candidateId, { open: !draft.open })}
                >
                  {draft.open ? '收起' : '配置'}
                </button>
              </div>
              {draft.selected && candidate.conflict === 'name_conflict' && (
                <div className="capability-import-resolution">
                  <span className="capability-note">同名配置如何处理</span>
                  <div className="capability-actions">
                    <button
                      type="button"
                      className="quiet-button compact"
                      aria-pressed={draft.action === 'replace'}
                      disabled={busy}
                      onClick={() => update(candidate.candidateId, { action: 'replace' })}
                    >
                      替换现有
                    </button>
                    <button
                      type="button"
                      className="quiet-button compact"
                      aria-pressed={draft.action === 'create'}
                      disabled={busy}
                      onClick={() =>
                        update(candidate.candidateId, { action: 'create', open: true })
                      }
                    >
                      另存为
                    </button>
                  </div>
                  {draft.action === 'create' && (
                    <p className="capability-note">请在 JSON 中修改 MCP 名称。</p>
                  )}
                </div>
              )}
              {candidate.compatibility === 'needs_input' && (
                <p className="capability-note capability-import-resolution">
                  请确认 JSON 中的环境变量引用后导入。
                </p>
              )}
              {draft.open && (
                <label className="capability-json-field capability-import-json">
                  <span>配置 JSON</span>
                  <textarea
                    aria-label={`${candidate.proposedName} 导入 JSON`}
                    spellCheck={false}
                    disabled={busy}
                    value={draft.definitionJson}
                    onChange={(event) =>
                      update(candidate.candidateId, { definitionJson: event.target.value })
                    }
                  />
                </label>
              )}
            </article>
          )
        })}
      </div>
      {!available.length && <p className="capability-note">没有新的可导入配置。</p>}
      {other.length > 0 && (
        <details className="capability-import-other">
          <summary>其他 {other.length} 项</summary>
          {other.map((candidate) => (
            <div key={candidate.candidateId}>
              <span>{candidate.proposedName}</span>
              <small>{candidate.conflict === 'same' ? '已添加' : '需手动配置'}</small>
            </div>
          ))}
        </details>
      )}
      {inspection.sources.some((source) => source.status === 'invalid') && (
        <details className="capability-import-other">
          <summary>部分来源暂未读取</summary>
          {inspection.sources
            .filter((source) => source.status === 'invalid')
            .map((source, index) => (
              <div key={index}>
                {sourceLabel(source.sourceKind)}
                <small>请检查该应用的 MCP 配置后重新扫描。</small>
              </div>
            ))}
        </details>
      )}
      <div className="capability-save">
        <span className="capability-note">新添加的 MCP 默认关闭</span>
        <button
          type="button"
          className="primary-button"
          disabled={busy || !selected.length}
          onClick={onCommit}
        >
          {busy ? '正在导入…' : `导入${selected.length ? ` ${selected.length} 项` : ''}`}
        </button>
      </div>
    </>
  )
}
export function filterMcpServers(
  servers: McpServerView[],
  query: string,
  filter: CapabilityFilter
): McpServerView[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return servers.filter((server) => {
    if (filter === 'enabled' && !server.enabled) return false
    if (filter === 'disabled' && server.enabled) return false
    if (!normalizedQuery) return true
    return [
      server.name,
      server.endpoint,
      mcpTransportLabel(server.transport),
      mcpSourceLabel(server.source)
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  })
}

export function mcpTransportLabel(transport: McpServerView['transport']): string {
  return transport === 'stdio' ? 'Stdio' : 'Streamable HTTP'
}

export function mcpSourceLabel(source: McpServerView['source']): string {
  if (source === 'import') return '本机导入'
  return '用户添加'
}

function sourceLabel(source: McpImportCandidate['sourceKind']): string {
  switch (source) {
    case 'codex':
      return 'Codex'
    case 'claude_code':
      return 'Claude Code'
    case 'opencode':
      return 'OpenCode'
    case 'copilot':
      return 'Copilot'
    case 'antigravity':
      return 'Antigravity'
    case 'cursor':
      return 'Cursor'
  }
}

function serverInitial(server: McpServerView): string {
  return server.name.slice(0, 2).toUpperCase()
}

function issueText(issue: McpConfigIssue | undefined): string {
  if (!issue) return '配置未通过检查，请检查 JSON 后重试。'
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

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(readErrorMessage(error))
}
