import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type {
  AgentProfile,
  McpConfigIssue,
  McpConfigView,
  McpImportCandidate,
  McpImportInspection,
  McpImportIssue,
  McpImportSelection,
  McpMutationResult,
  McpServerView
} from '@contracts'
import { MemberAvatar } from './MemberAvatar'
import {
  CapabilityError,
  CapabilityListItem,
  CapabilityWorkspace,
  type CapabilityFilter
} from './CapabilityWorkspace'
import { readErrorMessage } from './error-message'
import { localizeExecutionEngineTerms } from './product-copy'
import { identityColorToken } from './theme'
import { McpJsonEditor, materializeMcpDraft } from './McpJsonEditor'
import { PRODUCT_RUNTIME_LOGOS } from './runtime-products'
import { NewConversationQuickHelp } from './NewConversationQuickHelp'
import { CapabilityDeleteDialog } from './CapabilityDeleteDialog'
import { AppDialogGlyph, DialogControlIcon } from './AppDialog'

/** A name is one import choice. Keep Core's first candidate and its private commit identity. */
export function groupMcpImportCandidates(candidates: McpImportCandidate[]): {
  candidate: McpImportCandidate
  origins: McpImportCandidate[]
  issues: McpImportIssue[]
}[] {
  const groups = new Map<string, { candidate: McpImportCandidate; origins: McpImportCandidate[]; issues: McpImportIssue[] }>()
  for (const candidate of candidates) {
    const name = candidate.proposedName.trim().toLowerCase()
    const group = groups.get(name)
    if (!group) groups.set(name, { candidate, origins: [candidate], issues: [...candidate.issues] })
    else {
      if (!group.origins.some((origin) => origin.sourceKind === candidate.sourceKind)) group.origins.push(candidate)
      if (group.candidate.compatibility === 'unsupported') group.issues.push(...candidate.issues)
    }
  }
  return [...groups.values()]
}

type JsonDraft = {
  text: string
  baseDefinition: string
  baseDigest: string
  preservedDefinition?: string
}
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
    !candidate.duplicateOfCandidateId &&
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
    groupMcpImportCandidates(inspection.candidates).map(({ candidate }) => {
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
  const [drafts, setDrafts] = useState<Record<string, JsonDraft>>({})
  const [newJson, setNewJson] = useState<string | null>(null)
  const [newPreserved, setNewPreserved] = useState<string | undefined>()
  const [newMembers, setNewMembers] = useState<string[]>([])
  const [concealed, setConcealed] = useState(false)
  const [editorEpoch, setEditorEpoch] = useState(0)
  const [inspection, setInspection] = useState<McpImportInspection | null>(null)
  const [importDrafts, setImportDrafts] = useState<Record<string, McpImportDraft>>({})
  const [deleteTarget, setDeleteTarget] = useState<{
    serverId: string
    name: string
    configDigest: string
  } | null>(null)
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
    generation.current++
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
  const visible = filterMcpServers(config?.servers ?? [], search, 'all')
  const choose = (id: string | null): void => {
    setSelectedId(id)
    selectedRef.current = id
    editorSession.current++
    setDrafts({})
    setNewJson(id === 'new' ? NEW_SERVER_JSON : null)
    setNewPreserved(undefined)
    setNewMembers([])
    setConcealed(false)
    setEditorEpoch((value) => value + 1)
    setInspection(null)
    setImportDrafts({})
    setDeleteTarget(null)
    setError(null)
  }
  const clearDraft = (id: string): void => {
    setEditorEpoch((value) => value + 1)
    setConcealed(false)
    setDrafts((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }
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
          expectedConfigDigest: server
            ? (drafts[server.serverId]?.baseDigest ?? config.configDigest)
            : config.configDigest,
          ...(server ? { serverId: server.serverId } : {}),
          definitionJson: materializeMcpDraft(
            text,
            server ? drafts[server.serverId]?.preservedDefinition : newPreserved
          )
        }
      )
      const next = await apply(result)
      if (adding) {
        setNewJson(null)
        setSearch('')
        const created = next.servers.find(
          (value) => !config.servers.some((prior) => prior.serverId === value.serverId)
        )
        if (selectedRef.current === 'new') choose(created?.serverId ?? null)
        if (created && newMembers.length)
          await apply(
            await window.rovai.request<McpMutationResult>('mcp.servers.setMembers', {
              expectedConfigDigest: next.configDigest,
              serverId: created.serverId,
              agentIds: newMembers,
              acknowledgeHighRisk: true
            })
          )
      } else clearDraft(server!.serverId)
    })
  }
  const setMembers = (agentIds: string[]): void => {
    if (!selected) {
      setNewMembers(agentIds)
      return
    }
    if (!config) return
    const server = selected,
      beforeDigest = config.configDigest
    void run('assignment', async () => {
      const next = await apply(
        await window.rovai.request<McpMutationResult>('mcp.servers.setMembers', {
          expectedConfigDigest: beforeDigest,
          serverId: server.serverId,
          agentIds,
          acknowledgeHighRisk: true
        })
      )
      setDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).map(([id, draft]) => [
            id,
            draft.baseDigest === beforeDigest ? { ...draft, baseDigest: next.configDigest } : draft
          ])
        )
      )
    })
  }
  const remove = (): void => {
    if (!deleteTarget) return
    const target = deleteTarget
    void run('delete', async () => {
      const result = await window.rovai.request<McpMutationResult>('mcp.servers.delete', {
        expectedConfigDigest: target.configDigest,
        serverId: target.serverId
      })
      if (result.status === 'conflict') {
        await load()
        throw new Error('配置已更新，请取消后重新确认要删除的 MCP。')
      }
      await apply(result)
      setDeleteTarget(null)
      clearDraft(target.serverId)
      if (selectedRef.current === target.serverId || selectedRef.current === null) choose(null)
    })
  }
  const scan = (): void => {
    if (selectedId !== 'import') choose('import')
    const session = editorSession.current
    void run('scan', async () => {
      const next = await window.rovai.request<McpImportInspection>('mcp.import.scan')
      if (editorSession.current !== session) return
      setInspection(next)
      setImportDrafts((previous) => buildMcpImportDrafts(next, config?.servers ?? [], previous))
    })
  }
  const commitImport = (): void => {
    if (!inspection) return
    void run('import', async () => {
      const selections: McpImportSelection[] = groupMcpImportCandidates(inspection.candidates)
        .map(({ candidate }) => candidate)
        .filter(
          (candidate) => importDrafts[candidate.candidateId]?.selected && importableMcp(candidate)
        )
        .map((candidate) => {
          const draft = importDrafts[candidate.candidateId]
          if (!draft.action)
            throw new Error(`请为 ${candidate.proposedName} 选择覆盖配置或另存为。`)
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
  const pickedMembers = selected ? (selected.enabled ? selected.assignedAgentIds : []) : newMembers
  const selectedImports =
    groupMcpImportCandidates(inspection?.candidates ?? []).map(({ candidate }) => candidate).filter(
      (candidate) => importableMcp(candidate) && importDrafts[candidate.candidateId]?.selected
    ).length
  const libraryEmpty = Boolean(config && !config.fileIssue && config.servers.length === 0)
  const cancelDelete = () => {
    setDeleteTarget(null)
    setError(null)
  }
  const header =
    selectedId === 'import' ? (
      <>
        <header className="capability-detail-heading">
          <h2>从本机导入 MCP</h2>
          <div className="capability-actions">
            <button
              type="button"
              className="quiet-button compact"
              disabled={busy !== null}
              onClick={() => choose(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="quiet-button compact"
              disabled={busy !== null}
              onClick={scan}
            >
              重新扫描
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={busy !== null || !selectedImports}
              onClick={commitImport}
            >
              {busy === 'import'
                ? '正在导入…'
                : `导入${selectedImports ? ` ${selectedImports} 项` : ''}`}
            </button>
          </div>
        </header>
        <p className="capability-header-description">从本机已有应用中选择 MCP</p>
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
          <div className="capability-actions">
            {!selected && (
              <button
                type="button"
                className="quiet-button compact"
                disabled={busy !== null}
                onClick={() => choose(null)}
              >
                取消
              </button>
            )}
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
                {drafts[selected.serverId].baseDigest === config?.configDigest
                  ? '放弃更改'
                  : '重新载入'}
              </button>
            )}
            <button
              type="button"
              className={selected ? 'quiet-button compact capability-save-action' : 'primary-button'}
              disabled={
                disabled || concealed || (selected ? !drafts[selected.serverId] : !newJson?.trim())
              }
              onClick={save}
            >
              <DialogControlIcon name={selected ? 'save' : 'plus'} />
              {busy === 'save'
                ? '正在保存…'
                : selected
                  ? '保存'
                  : '添加 MCP'}
            </button>
            {selected && (
              <>
                <span className="capability-action-divider" aria-hidden="true" />
                <button
                  type="button"
                  className="quiet-button compact danger-text"
                  aria-label="删除 MCP"
                  disabled={disabled}
                  onClick={() => {
                    setError(null)
                    setDeleteTarget({
                      serverId: selected.serverId,
                      name: selected.name,
                      configDigest: config!.configDigest
                    })
                  }}
                >
                  <AppDialogGlyph name="trash" />
                  删除
                </button>
              </>
            )}
          </div>
        </header>
      </>
    ) : (
      <header className="capability-detail-heading">
        <h2>MCP</h2>
      </header>
    )
  return (
    <CapabilityWorkspace
      title="MCP"
      libraryEmpty={libraryEmpty}
      count={
        search
          ? `${visible.length}/${config?.servers.length ?? 0}`
          : (config?.servers.length ?? '—')
      }
      search={search}
      onSearch={setSearch}
      onAdd={() => choose('new')}
      addDisabled={disabled}
      selectionKey={
        selectedId === 'new' || selectedId === 'import' ? selectedId : (selected?.serverId ?? null)
      }
      header={libraryEmpty && !selected && selectedId !== 'new' && selectedId !== 'import' ? undefined : header}
      importAction={
        <button
          className="quiet-button compact"
          aria-label="从本机导入 MCP"
          type="button"
          disabled={disabled}
          onClick={scan}
        >
          <AppDialogGlyph name="download" />导入
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
          </div>
        )
      }
    >
      <CapabilityDeleteDialog
        open={deleteTarget !== null}
        title={`删除 MCP “${deleteTarget?.name ?? ''}”？`}
        description="删除后，队员将无法使用此 MCP。"
        busy={busy === 'delete'}
        error={error}
        onCancel={cancelDelete}
        onConfirm={remove}
      />
      <CapabilityError
        error={deleteTarget ? null : error}
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
        busy === 'scan' ? (
          <div className="capability-empty" role="status">
            正在查找本机配置…
          </div>
        ) : inspection ? (
          <McpImportPanel
            inspection={inspection}
            drafts={importDrafts}
            busy={busy !== null}
            onChange={setImportDrafts}
          />
        ) : null
      ) : selectedId === 'new' || selected ? (
        <>
          <McpMemberChoices
            members={members}
            selectedIds={pickedMembers}
            disabled={disabled}
            onAssignment={(member) =>
              setMembers(
                pickedMembers.includes(member.agentId)
                  ? pickedMembers.filter((id) => id !== member.agentId)
                  : [...pickedMembers, member.agentId]
              )
            }
            onAll={(ids) => setMembers(ids)}
          />
          {selected && Boolean(selected.configurationIssues?.length) && (
            <div id="mcp-configuration-issues" className="capability-note" role="status">
              {selected.configurationIssues?.map((issue) => (
                <p key={`${issue.code}:${issue.field}`}>
                  {issue.message}
                  <br />
                  受影响字段：{issue.field}
                </p>
              ))}
            </div>
          )}
          <section className="capability-section">
            <McpJsonEditor
              key={`${selected?.serverId ?? 'new'}:${editorEpoch}`}
              value={
                selected
                  ? (drafts[selected.serverId]?.text ?? selected.definitionJson)
                  : (newJson ?? '')
              }
              isEditing={selected ? Boolean(drafts[selected.serverId]) : true}
              serverId={selected?.serverId}
              configDigest={
                selected
                  ? (drafts[selected.serverId]?.baseDigest ?? config?.configDigest ?? '')
                  : (config?.configDigest ?? '')
              }
              disabled={busy !== null || Boolean(config?.fileIssue)}
              issuesId={
                selected?.configurationIssues?.length ? 'mcp-configuration-issues' : undefined
              }
              onConcealed={setConcealed}
              onError={setError}
              onChange={(text, preservedDefinition) => {
                if (selected)
                  setDrafts((current) => ({
                    ...current,
                    [selected.serverId]: {
                      text,
                      preservedDefinition,
                      baseDefinition:
                        current[selected.serverId]?.baseDefinition ?? selected.definitionJson,
                      baseDigest: current[selected.serverId]?.baseDigest ?? config!.configDigest
                    }
                  }))
                else {
                  setNewJson(text)
                  setNewPreserved(preservedDefinition)
                }
              }}
            />
          </section>
        </>
      ) : (
        !config?.fileIssue && (
        libraryEmpty ? (
          <section className="mcp-first-connection" aria-label="开始添加 MCP">
            <AppDialogGlyph name="server" />
            <h2>添加第一个 MCP</h2>
            <p>连接外部工具，让队员在协作时使用。</p>
            <div className="mcp-first-connection-actions">
              <button type="button" aria-label="添加配置" disabled={disabled} onClick={() => choose('new')}>
                <DialogControlIcon name="plus" />
                <span><strong>添加配置</strong><small>粘贴 MCP JSON</small></span>
                <DialogControlIcon name="chevron" />
              </button>
              <button type="button" aria-label="从本机导入 MCP" disabled={disabled} onClick={scan}>
                <AppDialogGlyph name="download" />
                <span><strong>从本机导入</strong><small>选择已有应用中的配置</small></span>
                <DialogControlIcon name="chevron" />
              </button>
            </div>
          </section>
        ) : <div className="capability-empty">从左侧选择 MCP，或添加新的连接。</div>
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
          style={
            {
              '--mcp-identity': identityColorToken(server.serverId)
            } as CSSProperties
          }
        >
          {serverInitial(server)}
        </span>
      }
      summary={`${dirty ? '未保存 · ' : ''}${server.transport === 'stdio' ? 'Stdio' : 'HTTP'} · ${server.enabled ? server.assignedAgentIds.length : 0} 位队员使用`}
      selected={selected}
      onSelect={onSelect}
    />
  )
}
export function McpMemberChoices({
  members,
  server,
  selectedIds,
  disabled,
  onAssignment,
  onAll
}: {
  members: AgentProfile[]
  server?: McpServerView
  selectedIds?: string[]
  disabled: boolean
  onAssignment(agent: AgentProfile): void
  onAll?(ids: string[]): void
}): React.JSX.Element {
  const picked = selectedIds ?? (server?.enabled ? server.assignedAgentIds : [])
  return (
    <section className="capability-members-section">
      <div className="capability-scope-heading">
        <div className="capability-title">
          <h3>使用队员</h3>
          <NewConversationQuickHelp label="MCP 使用队员说明">
            只向所选队员提供此 MCP。不选择任何队员时，不会加载。
          </NewConversationQuickHelp>
        </div>
        {onAll && (
          <div className="capability-actions">
            <button
              type="button"
              className="quiet-button compact"
              disabled={disabled}
              onClick={() => onAll(members.map((member) => member.agentId))}
            >
              全选
            </button>
            <button
              type="button"
              className="quiet-button compact"
              disabled={disabled}
              onClick={() => onAll([])}
            >
              清空
            </button>
          </div>
        )}
      </div>
      <div className="capability-member-options">
        {members.map((member) => (
          <button
            type="button"
            className="capability-choice capability-member-choice"
            key={member.agentId}
            aria-label={member.displayName}
            aria-pressed={picked.includes(member.agentId)}
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
            <strong>{member.displayName}</strong>
            <span className="capability-check" aria-hidden="true">
              <DialogControlIcon name="check" />
            </span>
          </button>
        ))}
      </div>
      {!members.length && <p className="capability-note">暂无队员。</p>}
    </section>
  )
}
export function McpImportPanel({
  inspection,
  drafts,
  busy,
  onChange
}: {
  inspection: McpImportInspection
  drafts: Record<string, McpImportDraft>
  busy: boolean
  onChange(drafts: Record<string, McpImportDraft>): void
  onScan?(): void
  onCommit?(): void
}): React.JSX.Element {
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const groups = groupMcpImportCandidates(inspection.candidates)
  const origins = (candidate: McpImportCandidate) =>
    groups.find((group) => group.candidate.candidateId === candidate.candidateId)?.origins ?? [candidate]
  const candidates = groups.map((group) => group.candidate)
  const available = candidates.filter(importableMcp)
  const other = candidates.filter(
    (candidate) => !candidate.duplicateOfCandidateId && !importableMcp(candidate)
  )
  const selected = available.filter((candidate) => drafts[candidate.candidateId]?.selected)
  const update = (id: string, patch: Partial<McpImportDraft>): void =>
    onChange({ ...drafts, [id]: { ...drafts[id], ...patch } })
  return (
    <>
      <div className="capability-import-filters" role="group" aria-label="MCP 配置来源">
        {[
          'all',
          ...new Set(
            available.flatMap((candidate) => origins(candidate).map((origin) => origin.sourceKind))
          )
        ].map((source) => (
          <button
            key={source}
            type="button"
            aria-pressed={sourceFilter === source}
            onClick={() => setSourceFilter(source)}
          >
            {source === 'all'
              ? '全部来源'
              : sourceLabel(source as McpImportCandidate['sourceKind'])}
          </button>
        ))}
      </div>
      <div className="capability-scope-heading">
        <span className="capability-note">
          {available.length} 项可选择 · 已选择 {selected.length} 项
        </span>
        <button
          type="button"
          className="quiet-button compact"
          disabled={busy}
          onClick={() => {
            const next = { ...drafts }
            const filtered = available.filter(
              (candidate) =>
                sourceFilter === 'all' ||
                origins(candidate).some((origin) => origin.sourceKind === sourceFilter)
            )
            const allSelected = filtered.every(
              (candidate) => drafts[candidate.candidateId]?.selected
            )
            for (const candidate of filtered)
              next[candidate.candidateId] = {
                ...next[candidate.candidateId],
                selected: !allSelected
              }
            onChange(next)
          }}
        >
          {available
            .filter(
              (candidate) =>
                sourceFilter === 'all' ||
                origins(candidate).some((origin) => origin.sourceKind === sourceFilter)
            )
            .every((candidate) => drafts[candidate.candidateId]?.selected)
            ? '取消选择'
            : '全选'}
        </button>
      </div>
      <div className="capability-import-items">
        {available
          .filter(
            (candidate) =>
              sourceFilter === 'all' ||
              origins(candidate).some((origin) => origin.sourceKind === sourceFilter)
          )
          .map((candidate) => {
            const draft = drafts[candidate.candidateId]
            if (!draft) return null
            return (
              <article
                className="capability-import-item"
                data-selected={draft.selected}
                key={candidate.candidateId}
                onClick={(event) => {
                  if (busy || (event.target as HTMLElement).closest('button, input, textarea, select, a, label')) return
                  update(candidate.candidateId, { selected: !draft.selected })
                }}
              >
                <div className="capability-import-item-heading">
                  <button
                    type="button"
                    className="capability-import-pick"
                    aria-pressed={draft.selected}
                    disabled={busy}
                    onClick={() =>
                      update(candidate.candidateId, {
                        selected: !draft.selected
                      })
                    }
                  >
                    <span>
                      <strong title={candidate.proposedName}>{candidate.proposedName}</strong>
                      <small>
                        {candidate.normalizedDefinitionJson?.includes('\"command\"')
                          ? 'Stdio'
                          : 'HTTP'}
                        {candidate.conflict === 'name_conflict' ? ' · 已有同名项' : ''}
                      </small>
                    </span>
                    <span className="capability-check" aria-hidden="true">
                      <DialogControlIcon name="check" />
                    </span>
                  </button>
                </div>
                <div className="capability-import-origins">
                  {origins(candidate).map((origin) => (
                    <span
                      key={origin.candidateId}
                      className="capability-import-source-tag"
                      title={origin.sourcePath}
                    >
                      <img src={sourceLogo(origin.sourceKind)} alt="" />
                      {sourceLabel(origin.sourceKind)}
                    </span>
                  ))}
                </div>
                {draft.selected && candidate.conflict === 'name_conflict' && (
                  <div className="capability-import-resolution">
                    <span className="capability-note">Rovai 中的同名配置与此处不同</span>
                    <div className="capability-actions">
                      <button
                        type="button"
                        className="quiet-button compact"
                        aria-pressed={draft.action === 'replace'}
                        disabled={busy}
                        onClick={() => update(candidate.candidateId, { action: 'replace' })}
                      >
                        覆盖配置
                      </button>
                      <button
                        type="button"
                        className="quiet-button compact"
                        aria-pressed={draft.action === 'create'}
                        disabled={busy}
                        onClick={() =>
                          update(candidate.candidateId, {
                            action: 'create',
                            open: true
                          })
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
                  <div className="capability-note capability-import-resolution" role="status">
                    {candidate.issues
                      .filter((issue) => issue.kind === 'needs_configuration')
                      .map((issue) => (
                        <p key={`${issue.code}:${issue.field}:${issue.message}`}>
                          {issue.message}
                          <br />
                          受影响字段：{issue.field}
                        </p>
                      ))}
                    <p>可先导入为停用配置。</p>
                  </div>
                )}
                <button
                  type="button"
                  className="capability-import-disclosure"
                  aria-label={`${draft.open ? '收起' : '查看'} ${candidate.proposedName} 配置`}
                  aria-expanded={draft.open}
                  aria-controls={`mcp-import-config-${candidate.candidateId}`}
                  disabled={busy}
                  onClick={() => update(candidate.candidateId, { open: !draft.open })}
                >
                  <DialogControlIcon name="chevron" />
                  {draft.open ? '收起配置' : '查看配置'}
                </button>
                {draft.open && (
                  <label className="capability-json-field capability-import-json" id={`mcp-import-config-${candidate.candidateId}`}>
                    <span className="capability-import-config-heading">配置 JSON<small title={candidate.sourcePath}>来自 {sourceLabel(candidate.sourceKind)}</small></span>
                    <textarea
                      aria-label={`${candidate.proposedName} 导入 JSON`}
                      spellCheck={false}
                      disabled={busy}
                      value={draft.definitionJson}
                      onChange={(event) =>
                        update(candidate.candidateId, {
                          definitionJson: event.target.value
                        })
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
            <article className="capability-import-other-item" key={candidate.candidateId}>
              <div className="capability-import-other-heading">
                <strong className="capability-import-other-name">{candidate.proposedName}</strong>
                {origins(candidate).map((origin) => (
                  <span key={origin.candidateId} className="capability-import-source-tag" title={origin.sourcePath}>
                    <img src={sourceLogo(origin.sourceKind)} alt="" />
                    {sourceLabel(origin.sourceKind)}
                  </span>
                ))}
                <span className="capability-import-other-status">
                  {candidate.conflict === 'same' ? '已添加' : '暂不支持'}
                </span>
              </div>
              {candidate.conflict !== 'same' && <McpImportIssueList issues={groups.find((group) => group.candidate === candidate)?.issues ?? candidate.issues} />}
            </article>
          ))}
        </details>
      )}
      {inspection.sources.some((source) => source.status === 'invalid') && (
        <div className="capability-import-source-issues" role="status">
          {inspection.sources
            .filter((source) => source.status === 'invalid')
            .map((source, index) => (
              <article className="capability-import-other-item" key={index}>
                <div className="capability-import-other-heading">
                  <span className="capability-import-source-tag" title={source.sourcePath}>
                    <img src={sourceLogo(source.sourceKind)} alt="" />
                    {sourceLabel(source.sourceKind)}
                  </span>
                </div>
                <p className="capability-note">请检查该应用的 MCP 配置后重新扫描。</p>
              </article>
            ))}
        </div>
      )}
    </>
  )
}

function McpImportIssueList({ issues }: { issues: McpImportIssue[] }): React.JSX.Element {
  const messages: Record<string, string> = {
    'mcp.import_unknown_field': '此配置包含暂不支持导入的字段。',
    'mcp.import_reference_unsupported': '此变量引用的写法暂不支持自动导入。',
    'mcp.import_tool_policy_unsupported': '此工具权限规则暂不支持自动迁移。',
    'mcp.import_authority_semantics_unsupported': '此授权配置暂不支持自动迁移。'
  }
  const groups = new Map<string, { message: string; fields: Set<string> }>()
  for (const issue of issues.filter((issue) => issue.blocking)) {
    const message = messages[issue.code] ?? issue.message
    const key = `${issue.code}:${message}`
    const group = groups.get(key) ?? { message, fields: new Set<string>() }
    if (issue.field) group.fields.add(issue.field)
    groups.set(key, group)
  }
  return (
    <ul className="capability-import-issues" aria-label="导入限制">
      {[...groups].map(([key, group]) => (
        <li key={key}>
          <p className="capability-note">{group.message}</p>
          {group.fields.size > 0 && (
            <div className="capability-import-issue-fields">
              <span>受影响字段</span>
              <div>
                {[...group.fields].map((field) => <code key={field}>{field}</code>)}
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
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

function sourceLogo(source: McpImportCandidate['sourceKind']): string {
  return PRODUCT_RUNTIME_LOGOS[
    (
      {
        codex: 'codex-cli',
        claude_code: 'claude-code-cli',
        opencode: 'opencode-cli',
        copilot: 'copilot-cli',
        antigravity: 'antigravity-app',
        cursor: 'cursor-agent'
      } as const
    )[source]
  ]
}
