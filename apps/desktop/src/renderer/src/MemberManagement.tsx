import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AdapterInstallation,
  AdapterKind,
  AgentProfile,
  CreateAgentProfileCommand,
  HealthStatus,
  MemberRemovalPreview,
  ProductRuntimeAvailability,
  RuntimeReadinessStatus,
  StoredCommandResult,
  UpdateAgentProfileCommand
} from '@contracts'
import { parseControlledMemberAvatarRef } from '@contracts'
import { MemberAvatar } from './MemberAvatar'
import { MemberAvatarCropper } from './MemberAvatarCropper'
import { MemberPortrait } from './MemberPortrait'
import { localizeExecutionEngineTerms } from './product-copy'
import {
  deriveMemberAvatarIcon,
  normalizeMemberAvatarSource
} from './member-avatar-image'
import {
  defaultAvatarCrop
} from './member-avatar-crop'
import {
  BUILTIN_MEMBER_PRESETS,
  type BuiltinMemberPreset
} from './member-presets'
import {
  submitMemberIdentityWithAvatar,
  type PendingMemberAvatarSource
} from './member-avatar-submit'
import { invalidateManagedAvatarObjectUrl } from './managed-avatar-cache'
import { identityColorToken } from './theme'
import { SummaryModelSettings } from './SummaryModelSettings'

type MembersViewProps = {
  agents: AgentProfile[]
  installations: AdapterInstallation[]
  runtimeAvailability: ProductRuntimeAvailability[]
  runtimeDiscoveryPending: boolean
  onReload(): Promise<void>
  onOpenRuntimeSettings(): void
}

type IdentityDraft = {
  displayName: string
  avatarRef: string | null
  personaLabel: string
  roleTitle: string
  roleDescription: string
  instructions: string
  memoryWriteEnabled: boolean
}

const EMPTY_IDENTITY: IdentityDraft = {
  displayName: '',
  avatarRef: null,
  personaLabel: '',
  roleTitle: '',
  roleDescription: '',
  instructions: '',
  memoryWriteEnabled: true
}

export function MembersView({ agents, installations, runtimeAvailability, runtimeDiscoveryPending, onReload, onOpenRuntimeSettings }: MembersViewProps): React.JSX.Element {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [identityDialog, setIdentityDialog] = useState<'create' | 'edit' | null>(null)
  const [removal, setRemoval] = useState<{
    preview: MemberRemovalPreview
    displayName: string
    confirmationName: string
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragAgentId, setDragAgentId] = useState<string | null>(null)
  const [dragOverAgentId, setDragOverAgentId] = useState<string | null>(null)
  const identityReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const removalReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null

  useEffect(() => {
    if (selectedAgentId && !agents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(null)
    }
  }, [agents, selectedAgentId])

  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(null), 3_200)
    return () => clearTimeout(timer)
  }, [notice])

  const runCommand = async (
    busyKey: string,
    method: 'agents.create' | 'agents.update' | 'agents.runtime.set' | 'agents.runtime.clear' | 'agents.presence.set' | 'agents.remove' | 'agents.reorder',
    command: unknown
  ): Promise<StoredCommandResult> => {
    setBusy(busyKey)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>(method, {
        commandId: crypto.randomUUID(),
        command
      })
      assertApplied(result)
      await onReload()
      return result
    } catch (nextError) {
      setError(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  const closeIdentityDialog = (): void => {
    setIdentityDialog(null)
  }

  const closeRemovalDialog = (): void => {
    setRemoval(null)
  }

  const saveIdentity = async (draft: IdentityDraft): Promise<void> => {
    const targetAgent = memberIdentityTargetAgent(identityDialog, selectedAgent)
    const previousAvatarRef = targetAgent?.avatarRef ?? null
    const identity = identityCommand(draft, targetAgent)
    const method = targetAgent ? 'agents.update' : 'agents.create'
    const result = await runCommand('identity', method, identity)
    if (!targetAgent) {
      const createdId = result.resultEntity?.entityId ?? stringField(result.payload, 'agentProfileId')
      if (createdId) setSelectedAgentId(createdId)
    }
    if (
      previousAvatarRef
      && previousAvatarRef !== draft.avatarRef
      && parseControlledMemberAvatarRef(previousAvatarRef)?.kind === 'managed'
    ) {
      await invalidateManagedAvatarObjectUrl(previousAvatarRef)
    }
    closeIdentityDialog()
  }

  const saveRuntime = async (adapterKind: AdapterKind): Promise<void> => {
    if (!selectedAgent) return
    await runCommand('runtime', 'agents.runtime.set', {
      agentProfileId: selectedAgent.id,
      expectedVersion: selectedAgent.version,
      adapterKind
    })
  }

  const clearRuntime = async (): Promise<void> => {
    if (!selectedAgent) return
    await runCommand('runtime-clear', 'agents.runtime.clear', {
      agentProfileId: selectedAgent.id,
      expectedVersion: selectedAgent.version
    })
  }

  const changePresence = async (presence: 'present' | 'away'): Promise<void> => {
    if (!selectedAgent) return
    await runCommand(`presence-${presence}`, 'agents.presence.set', {
      agentProfileId: selectedAgent.id,
      expectedVersion: selectedAgent.version,
      presence
    })
    setNotice(presence === 'present' ? `${selectedAgent.displayName} 已归队。` : `${selectedAgent.displayName} 已暂离。`)
  }

  const previewRemoval = async (trigger: HTMLButtonElement): Promise<void> => {
    if (!selectedAgent) return
    removalReturnFocusRef.current = trigger
    setBusy('remove-preview')
    setError(null)
    try {
      const preview = await window.rovai.request<MemberRemovalPreview>('agents.removalPreview', {
        agentProfileId: selectedAgent.id
      })
      setRemoval({ preview, displayName: selectedAgent.displayName, confirmationName: '' })
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const confirmRemoval = async (): Promise<void> => {
    if (!removal) return
    await runCommand('remove', 'agents.remove', {
      agentProfileId: removal.preview.agentProfileId,
      expectedVersion: removal.preview.version,
      confirmationHandle: removal.preview.handle
    })
    setNotice(`${removal.displayName} 已移除，历史身份与记录继续保留。`)
    setRemoval(null)
    setSelectedAgentId(null)
  }

  const dropReorder = async (targetAgentId: string): Promise<void> => {
    const sourceAgentId = dragAgentId
    setDragAgentId(null)
    setDragOverAgentId(null)
    if (!sourceAgentId || sourceAgentId === targetAgentId) return
    const orderedAgentProfileIds = agents.map((agent) => agent.id)
    const from = orderedAgentProfileIds.indexOf(sourceAgentId)
    const to = orderedAgentProfileIds.indexOf(targetAgentId)
    if (from < 0 || to < 0) return
    orderedAgentProfileIds.splice(from, 1)
    orderedAgentProfileIds.splice(to, 0, sourceAgentId)
    await runCommand('reorder', 'agents.reorder', { orderedAgentProfileIds }).catch(() => undefined)
  }

  const moveMemberByKeyboard = async (
    agent: AgentProfile,
    direction: -1 | 1
  ): Promise<void> => {
    const samePresence = agents.filter((candidate) => candidate.presence === agent.presence)
    const visibleIndex = samePresence.findIndex((candidate) => candidate.id === agent.id)
    const target = samePresence[visibleIndex + direction]
    if (!target) return
    const orderedAgentProfileIds = agents.map((candidate) => candidate.id)
    const from = orderedAgentProfileIds.indexOf(agent.id)
    const to = orderedAgentProfileIds.indexOf(target.id)
    orderedAgentProfileIds.splice(from, 1)
    orderedAgentProfileIds.splice(to, 0, agent.id)
    await runCommand('reorder', 'agents.reorder', { orderedAgentProfileIds }).catch(() => undefined)
  }

  return (
    <>
      <section className="project-hero member-hero">
        <div>
          <h2>成员</h2>
          <p>成员保存长期身份和默认执行引擎；加入 Camp、Default Lead 与 Camp 权限仍由具体 Camp 管理。</p>
        </div>
        <div className="project-actions">
          <button
            className="primary-button"
            onClick={(event) => {
              identityReturnFocusRef.current = event.currentTarget
              setIdentityDialog('create')
            }}
          >＋ 新增成员</button>
        </div>
      </section>

      {error && (
        <div className="inline-error member-page-error" role="alert">
          <strong>成员配置未保存</strong><span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="app-toast" role="status" aria-live="polite">
          <span>{notice}</span>
          <button className="icon-button" type="button" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      <section className="member-workbench">
        <aside className="member-list" aria-label="成员列表">
          <div className="member-list-heading"><strong>{agents.length} 位成员</strong><span>选择后编辑</span></div>
          {(['present', 'away'] as const).map((presence) => {
            const group = agents.filter((agent) => agent.presence === presence)
            if (group.length === 0) return null
            return (
              <div className="member-list-group" key={presence}>
                <div className="member-list-group-heading">
                  <span>{memberPresenceLabel(presence)}</span><small>{group.length}</small>
                </div>
                {group.map((agent) => (
                  <div
                    key={agent.id}
                    className={`member-list-row ${dragOverAgentId === agent.id && dragAgentId !== agent.id ? 'drag-over' : ''}`}
                    draggable={busy === null}
                    onDragStart={(event) => {
                      setDragAgentId(agent.id)
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setDragOverAgentId(agent.id)
                    }}
                    onDragLeave={() => setDragOverAgentId((current) => current === agent.id ? null : current)}
                    onDrop={(event) => {
                      event.preventDefault()
                      void dropReorder(agent.id)
                    }}
                    onDragEnd={() => {
                      setDragAgentId(null)
                      setDragOverAgentId(null)
                    }}
                  >
                    <button
                      className="member-drag-handle"
                      type="button"
                      title="拖拽；聚焦后用方向键调整 Member Order"
                      aria-label={`调整 ${agent.displayName} 的顺序；上、下方向键移动`}
                      disabled={busy !== null}
                      onKeyDown={(event) => {
                        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                        event.preventDefault()
                        void moveMemberByKeyboard(agent, event.key === 'ArrowUp' ? -1 : 1)
                      }}
                    >⋮⋮</button>
                    <button
                      type="button"
                      className={`member-list-item ${selectedAgent?.id === agent.id ? 'selected' : ''}`}
                      aria-current={selectedAgent?.id === agent.id ? 'true' : undefined}
                      onClick={() => setSelectedAgentId(agent.id)}
                      style={{ '--agent-accent': identityColorToken(agent.id) } as React.CSSProperties}
                    >
                      <span className="member-list-accent" aria-hidden="true" />
                      <MemberAvatar
                        agentProfileId={agent.id}
                        avatarRef={agent.avatarRef}
                        displayName={agent.displayName}
                        size="list"
                        decorative
                        className="member-list-avatar"
                      />
                      <span className="member-list-copy">
                        <strong>{agent.displayName}</strong>
                        <small>{memberPresenceLabel(agent.presence)}</small>
                      </span>
                      <RuntimeReadinessMark status={agent.runtimeReadiness.status} />
                    </button>
                  </div>
                ))}
              </div>
            )
          })}
          <p className="member-order-note">⋮⋮ 拖拽调整 Member Order —— 只影响展示与新 Camp 初始顺序，不代表能力或权限。</p>
        </aside>

        <div className="member-detail">
          {!selectedAgent && (
            <div className="member-empty">
              <span aria-hidden="true">◎</span>
              <h3>选择一位成员</h3>
              <p>这里不会自动选中成员，也不会替新成员绑定执行引擎。请选择已有成员，或新建一个长期身份。</p>
            </div>
          )}
          {selectedAgent && (
            <>
              <MemberIdentitySummary
                agent={selectedAgent}
                busy={busy}
                onEdit={(trigger) => {
                  identityReturnFocusRef.current = trigger
                  setIdentityDialog('edit')
                }}
                onPresence={changePresence}
              />
              <MemberRuntimeForm
                key={`${selectedAgent.id}:${selectedAgent.version}`}
                agent={selectedAgent}
                runtimeAvailability={runtimeAvailability}
                runtimeDiscoveryPending={runtimeDiscoveryPending}
                busy={busy}
                onSave={saveRuntime}
                onClear={clearRuntime}
                onOpenRuntimeSettings={onOpenRuntimeSettings}
              />
              <MemberAdvancedSettings
                key={`advanced:${selectedAgent.id}`}
                agent={selectedAgent}
                installations={installations}
              />
              <MemberRemovalSection
                agent={selectedAgent}
                busy={busy}
                onRemove={previewRemoval}
              />
            </>
          )}
        </div>
      </section>

      <MemberIdentityDialog
        open={identityDialog !== null}
        agent={identityDialog === 'edit' ? selectedAgent : null}
        agents={agents}
        busy={busy === 'identity'}
        returnFocusRef={identityReturnFocusRef}
        onOpenChange={(open) => !open && closeIdentityDialog()}
        onSubmit={saveIdentity}
      />
      <Dialog.Root open={removal !== null} onOpenChange={(open) => !open && busy !== 'remove' && closeRemovalDialog()}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="dialog-content"
            aria-describedby="remove-member-description"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              removalReturnFocusRef.current?.focus()
            }}
          >
            <div className="dialog-heading"><div><Dialog.Title>移除成员</Dialog.Title></div><Dialog.Close className="dialog-close" aria-label="关闭" disabled={busy === 'remove'}>×</Dialog.Close></div>
            <Dialog.Description id="remove-member-description">
              移除后成员不会再出现在管理列表，也不能产生后续消息；历史身份、头像、执行引擎、消息、Task 与 Run 仍保留。
            </Dialog.Description>
            {removal && (
              <>
                {removal.preview.nonTerminalAgentRunCount > 0 && (
                  <div className="inline-error" role="alert">仍有 {removal.preview.nonTerminalAgentRunCount} 个未结束的 Run，当前不能移除。</div>
                )}
                <label className="field-label">输入 {removal.displayName} 确认
                  <input
                    value={removal.confirmationName}
                    onChange={(event) => setRemoval({ ...removal, confirmationName: event.target.value })}
                    autoFocus
                    autoComplete="off"
                  />
                </label>
                <div className="dialog-actions">
                  <Dialog.Close className="quiet-button" type="button" disabled={busy === 'remove'}>取消</Dialog.Close>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={!removal.preview.removable || removal.confirmationName !== removal.displayName || busy === 'remove'}
                    onClick={() => void confirmRemoval().catch(() => undefined)}
                  >{busy === 'remove' ? '正在移除…' : '永久移除'}</button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

export function memberIdentityTargetAgent(
  mode: 'create' | 'edit' | null,
  selectedAgent: AgentProfile | null
): AgentProfile | null {
  return mode === 'edit' ? selectedAgent : null
}

function MemberIdentitySummary({ agent, busy, onEdit, onPresence }: {
  agent: AgentProfile
  busy: string | null
  onEdit(trigger: HTMLButtonElement): void
  onPresence(presence: 'present' | 'away'): Promise<void>
}): React.JSX.Element {
  return (
    <section className="member-section member-identity-section">
      <div className="member-identity-overview">
        <MemberPortrait
          agentProfileId={agent.id}
          avatarRef={agent.avatarRef}
          displayName={agent.displayName}
        />
        <div className="member-identity-copy">
          <div className="member-section-heading">
            <div className="member-profile-heading">
              <MemberAvatar
                agentProfileId={agent.id}
                avatarRef={agent.avatarRef}
                displayName={agent.displayName}
                size="profile"
                decorative
                className="member-profile-avatar"
              />
              <div><h3>{agent.displayName}</h3><span>{agent.roleTitle ?? '自定义成员'}{agent.personaLabel ? ` · ${agent.personaLabel}` : ''}</span></div>
            </div>
            <button className="quiet-button" onClick={(event) => onEdit(event.currentTarget)}>编辑身份</button>
          </div>
          <p className="member-role-description">{agent.roleDescription}</p>
        </div>
      </div>
      {agent.instructions && <details className="member-instructions"><summary>查看成员指令</summary><pre>{agent.instructions}</pre></details>}
      <div className="member-status-actions">
        <span>在队状态：<strong>{memberPresenceLabel(agent.presence)}</strong></span>
        {agent.presence === 'present' && <button className="quiet-button" disabled={busy !== null} onClick={() => void onPresence('away').catch(() => undefined)}>暂离</button>}
        {agent.presence === 'away' && <button className="quiet-button" disabled={busy !== null} onClick={() => void onPresence('present').catch(() => undefined)}>归队</button>}
      </div>
      {agent.presence === 'away' && <div className="member-status-note" role="status">成员仍属于已有 Camp；已有 Run 不会中断，但不会再启动新的 Run。</div>}
    </section>
  )
}

export function MemberAdvancedSettings({ installations, agent, defaultOpen = false }: {
  installations: AdapterInstallation[]
  agent: AgentProfile
  defaultOpen?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="member-section member-advanced-settings">
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <span>
            <strong>高级设置</strong>
            <small>Camp 共享摘要模型</small>
          </span>
          <i aria-hidden="true">⌄</i>
        </summary>
        {open && <SummaryModelSettings installations={installations} agent={agent} />}
      </details>
    </section>
  )
}

function MemberRemovalSection({ agent, busy, onRemove }: {
  agent: AgentProfile
  busy: string | null
  onRemove(trigger: HTMLButtonElement): Promise<void>
}): React.JSX.Element {
  return (
    <section className="member-section member-danger-zone">
      <div>
        <h3>移除成员</h3>
        <p>停止后续参与并从成员管理中隐藏。身份、头像、执行引擎和全部历史记录仍会保留。</p>
      </div>
      <button className="danger-button" disabled={busy !== null} onClick={(event) => void onRemove(event.currentTarget).catch(() => undefined)}>
        移除 {agent.displayName}
      </button>
    </section>
  )
}

const PRODUCT_RUNTIMES: AdapterKind[] = [
  'claude-code-cli',
  'codex-cli',
  'copilot-cli',
  'opencode-cli',
  'kiro-cli',
  'qoder-cli',
  'codebuddy-cli',
  'qwen-code',
  'antigravity-app'
]

export function MemberRuntimeForm({ agent, runtimeAvailability, runtimeDiscoveryPending = false, busy, onSave, onClear, onOpenRuntimeSettings }: {
  agent: AgentProfile
  runtimeAvailability: ProductRuntimeAvailability[]
  runtimeDiscoveryPending?: boolean
  busy: string | null
  onSave(adapterKind: AdapterKind): Promise<void>
  onClear(): Promise<void>
  onOpenRuntimeSettings(): void
}): React.JSX.Element {
  const [selectedKind, setSelectedKind] = useState<AdapterKind | ''>(
    agent.runtimeSelection?.adapterKind ?? ''
  )
  const [submitError, setSubmitError] = useState<string | null>(null)
  const availability = runtimeAvailability.find((item) => item.runtimeKind === selectedKind) ?? null

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!selectedKind) return
    setSubmitError(null)
    try {
      await onSave(selectedKind)
    } catch (nextError) {
      setSubmitError(errorMessage(nextError))
    }
  }

  return (
    <section className="member-section">
      <div className="member-section-heading">
        <div>
          <h3>Agent运行时</h3>
          <p>只选择 Agent 产品；Rovai 自动发现、验证并维护实际启动入口。</p>
        </div>
        <RuntimeReadinessBadge agent={agent} />
      </div>

      {agent.runtimeReadiness.blockers.length > 0 && (
        <div className="runtime-blockers" role="status">
          {agent.runtimeReadiness.blockers.map((blocker) => (
            <span key={blocker.code}>
              <strong>{runtimeBlockerLabel(blocker.code)}</strong>
              {blocker.detail ? ` · ${localizeExecutionEngineTerms(blocker.detail)}` : ''}
            </span>
          ))}
        </div>
      )}

      <form onSubmit={(event) => void submit(event)}>
        <label className="field-label">Product Runtime
          <select
            value={selectedKind}
            disabled={busy !== null}
            onChange={(event) => {
              setSelectedKind(event.target.value as AdapterKind | '')
              setSubmitError(null)
            }}
          >
            <option value="">不选择执行引擎</option>
            {PRODUCT_RUNTIMES.map((kind) => {
              const item = runtimeAvailability.find((candidate) => candidate.runtimeKind === kind)
              const status = item?.status ?? (runtimeDiscoveryPending ? 'detecting' : 'missing')
              return (
                <option key={kind} value={kind}>
                  {adapterLabel(kind)} · {productRuntimeAvailabilityLabel(status)}
                </option>
              )
            })}
          </select>
          <span className="field-help">未安装的 Runtime 也可以保存；该成员会保持不可执行，且不会回退到其他 Runtime。</span>
        </label>

        {selectedKind && (
          <div className="runtime-installation-summary">
            <span>
              <strong>{adapterLabel(selectedKind)}</strong>
              {productRuntimeAvailabilityLabel(availability?.status ?? 'detecting')}
            </span>
            <small>
              {availability?.reportedVersion
                ? `检测版本 ${availability.reportedVersion}`
                : '模型与原生权限会在真实能力检查完成后自动解析。'}
            </small>
            {availability?.status === 'missing' && (
              <button className="quiet-button" type="button" onClick={onOpenRuntimeSettings}>
                查看安装与检查
              </button>
            )}
          </div>
        )}

        {submitError && <div className="inline-error">{submitError}</div>}
        <div className="member-form-actions">
          {agent.runtimeSelection && (
            <button className="quiet-button" type="button" disabled={busy !== null} onClick={() => void onClear().catch(() => undefined)}>
              清除执行引擎
            </button>
          )}
          <button className="primary-button" disabled={!selectedKind || busy !== null}>
            {busy === 'runtime' ? '正在检查并保存…' : '保存 Agent运行时'}
          </button>
        </div>
      </form>
    </section>
  )
}

function MemberIdentityDialog({ open, agent, agents, busy, returnFocusRef, onOpenChange, onSubmit }: {
  open: boolean
  agent: AgentProfile | null
  agents: AgentProfile[]
  busy: boolean
  returnFocusRef: { current: HTMLButtonElement | null }
  onOpenChange(open: boolean): void
  onSubmit(draft: IdentityDraft): Promise<void>
}): React.JSX.Element {
  const [draft, setDraft] = useState<IdentityDraft>(EMPTY_IDENTITY)
  const [avatarSource, setAvatarSource] = useState<PendingMemberAvatarSource | null>(null)
  const [avatarBusy, setAvatarBusy] = useState<'loading' | 'choosing' | 'saving' | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const avatarLoadGeneration = useRef(0)
  const sourceUrl = useMemo(() => {
    if (!avatarSource) return null
    const bytes = Uint8Array.from(avatarSource.sourcePng)
    return URL.createObjectURL(new Blob([bytes.buffer], { type: 'image/png' }))
  }, [avatarSource?.sourcePng])

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    }
  }, [sourceUrl])

  useEffect(() => {
    const generation = avatarLoadGeneration.current + 1
    avatarLoadGeneration.current = generation
    if (!open) {
      setAvatarSource(null)
      setAvatarBusy(null)
      return undefined
    }
    setDraft(agent ? {
      displayName: agent.displayName,
      avatarRef: agent.avatarRef,
      personaLabel: agent.personaLabel ?? '',
      roleTitle: agent.roleTitle ?? '',
      roleDescription: agent.roleDescription,
      instructions: agent.instructions,
      memoryWriteEnabled: agent.defaultCapabilities.includes('memory.write')
    } : EMPTY_IDENTITY)
    setAvatarSource(null)
    setAvatarError(null)
    setSubmitError(null)
    const parsed = agent?.avatarRef
      ? parseControlledMemberAvatarRef(agent.avatarRef)
      : null
    if (parsed?.kind !== 'managed' || !agent?.avatarRef) {
      setAvatarBusy(null)
      return undefined
    }
    setAvatarBusy('loading')
    void window.rovai.memberAvatars.read(agent.avatarRef, 'portrait')
      .then((rendition) => {
        if (avatarLoadGeneration.current !== generation) return
        if (!rendition) {
          setAvatarError('原角色图片不可读取。现有身份仍然有效；可替换图片或移除头像。')
          return
        }
        setAvatarSource({
          sourcePng: Uint8Array.from(rendition.bytes),
          width: rendition.width,
          height: rendition.height,
          crop: rendition.crop,
          needsSave: false
        })
      })
      .catch((nextError) => {
        if (avatarLoadGeneration.current === generation) {
          setAvatarError(errorMessage(nextError))
        }
      })
      .finally(() => {
        if (avatarLoadGeneration.current === generation) setAvatarBusy(null)
      })
    return () => {
      if (avatarLoadGeneration.current === generation) {
        avatarLoadGeneration.current += 1
      }
    }
  }, [agent, open])

  const applyPreset = (selected: BuiltinMemberPreset): void => {
    avatarLoadGeneration.current += 1
    setAvatarSource(null)
    setAvatarBusy(null)
    setAvatarError(null)
    if (agent) {
      setDraft((current) => ({ ...current, avatarRef: selected.avatarRef }))
      return
    }
    setDraft((current) => ({
      ...current,
      displayName: selected.displayName,
      avatarRef: selected.avatarRef,
      personaLabel: selected.personaLabel,
      roleTitle: selected.roleTitle,
      roleDescription: selected.roleDescription,
      instructions: selected.instructions
    }))
  }

  const chooseImage = async (): Promise<void> => {
    avatarLoadGeneration.current += 1
    setAvatarBusy('choosing')
    setAvatarError(null)
    try {
      const selection = await window.rovai.memberAvatars.selectSource()
      if (!selection) return
      const normalized = await normalizeMemberAvatarSource(selection)
      setAvatarSource({
        ...normalized,
        crop: defaultAvatarCrop(normalized.width, normalized.height),
        needsSave: true
      })
      setDraft((current) => ({ ...current, avatarRef: null }))
    } catch (nextError) {
      setAvatarError(errorMessage(nextError))
    } finally {
      setAvatarBusy(null)
    }
  }

  const removeAvatar = (): void => {
    avatarLoadGeneration.current += 1
    setAvatarSource(null)
    setAvatarBusy(null)
    setAvatarError(null)
    setDraft((current) => ({ ...current, avatarRef: null }))
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitError(null)
    if (hasDuplicateMemberDisplayName(draft.displayName, agent?.id ?? null, agents)) {
      setSubmitError('该名称已被其他成员使用，请换一个名称。')
      return
    }
    try {
      if (avatarSource?.needsSave) setAvatarBusy('saving')
      await submitMemberIdentityWithAvatar(
        draft,
        avatarSource,
        async (source) => {
          const asset = await deriveMemberAvatarIcon(source, source.crop)
          return window.rovai.memberAvatars.save({
            sourcePng: asset.sourcePng,
            iconPng: asset.iconPng,
            sourceWidth: asset.width,
            sourceHeight: asset.height,
            crop: asset.crop
          })
        },
        onSubmit,
        (persistedDraft, persistedSource) => {
          setDraft(persistedDraft)
          setAvatarSource(persistedSource)
        }
      )
    } catch (nextError) {
      setSubmitError(errorMessage(nextError))
    } finally {
      setAvatarBusy(null)
    }
  }

  const isBusy = busy || avatarBusy !== null
  const parsedDraftAvatar = draft.avatarRef
    ? parseControlledMemberAvatarRef(draft.avatarRef)
    : null

  return (
    <Dialog.Root open={open} onOpenChange={(value) => !isBusy && onOpenChange(value)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog-content member-dialog"
          aria-describedby="member-dialog-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocusRef.current?.focus()
          }}
        >
          <div className="dialog-heading"><div><Dialog.Title>{agent ? '编辑成员身份' : '新增成员'}</Dialog.Title></div><Dialog.Close className="dialog-close" aria-label="关闭成员编辑" disabled={isBusy}>×</Dialog.Close></div>
          <Dialog.Description id="member-dialog-description">身份与角色会长期保留；新成员不会自动选择执行引擎，也不会自动加入 Camp。</Dialog.Description>
          <form onSubmit={(event) => void submit(event)}>
            <div className="member-editor-layout">
              <section className="member-avatar-editor" aria-label="成员头像">
                <div className="member-avatar-editor-heading">
                  <div><strong>角色图片</strong><span>只影响身份外观</span></div>
                  {(draft.avatarRef || avatarSource) && (
                    <button className="quiet-button" type="button" disabled={isBusy} onClick={removeAvatar}>移除</button>
                  )}
                </div>

                {sourceUrl && avatarSource && (
                  <MemberAvatarCropper
                    sourceUrl={sourceUrl}
                    sourceWidth={avatarSource.width}
                    sourceHeight={avatarSource.height}
                    value={avatarSource.crop}
                    disabled={isBusy}
                    onChange={(crop) => setAvatarSource({
                      ...avatarSource,
                      crop,
                      needsSave: true
                    })}
                  />
                )}

                {!sourceUrl && (
                  <div className="member-avatar-current">
                    <MemberAvatar
                      agentProfileId={agent?.id ?? `draft-${draft.displayName || 'member'}`}
                      avatarRef={draft.avatarRef}
                      displayName={draft.displayName}
                      size={parsedDraftAvatar?.kind === 'builtin' ? 'bust' : 'picker'}
                    />
                    <div>
                      <strong>{avatarBusy === 'loading' ? '正在读取原图…' : parsedDraftAvatar?.kind === 'builtin' ? '内置伙伴外观' : parsedDraftAvatar?.kind === 'managed' ? '受管角色图片' : draft.avatarRef ? '旧版头像引用' : '字符头像'}</strong>
                      <span>{draft.avatarRef ? '更换外观不会修改角色、执行引擎或 Camp。' : '未选择图片时使用显示名称的首个字符。'}</span>
                    </div>
                  </div>
                )}

                <button className="quiet-button member-avatar-browse" type="button" disabled={isBusy} onClick={() => void chooseImage()}>
                  {avatarBusy === 'choosing' ? '正在处理图片…' : avatarSource ? '替换图片…' : '选择一张图片…'}
                </button>
                <p className="field-help">支持静态 PNG/JPEG，文件不超过 10 MiB；保存时移除原始元数据。</p>
                {avatarError && <div className="member-avatar-recovery" role="alert">{avatarError}</div>}

                <div className="member-preset-heading">
                  <strong>{agent ? '内置外观' : '伙伴预设'}</strong>
                  <span>{agent ? '只替换外观' : '填入可继续编辑的身份草稿'}</span>
                </div>
                <div className="member-preset-list">
                  {BUILTIN_MEMBER_PRESETS.map((preset) => (
                    <button
                      key={preset.role}
                      className={`member-preset-card ${draft.avatarRef === preset.avatarRef ? 'selected' : ''}`}
                      type="button"
                      disabled={isBusy}
                      aria-pressed={draft.avatarRef === preset.avatarRef}
                      onClick={() => applyPreset(preset)}
                    >
                      <MemberAvatar
                        agentProfileId={`preset-${preset.role}`}
                        avatarRef={preset.avatarRef}
                        displayName={preset.displayName}
                        size="bust"
                        decorative
                      />
                      <span className="member-preset-copy">
                        <strong>{preset.displayName} · {preset.roleTitle}</strong>
                        <small>{preset.motto}</small>
                        <em>{preset.strengths.join(' · ')}</em>
                        <span>注意：{preset.watchout}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="member-identity-editor" aria-label="成员身份字段">
                <div className="member-form-grid">
                  <label className="field-label">名称<input required maxLength={80} value={draft.displayName} onChange={(event) => {
                    setDraft({ ...draft, displayName: event.target.value })
                    setSubmitError(null)
                  }} autoFocus /></label>
                  <label className="field-label">角色标题<input value={draft.roleTitle} onChange={(event) => setDraft({ ...draft, roleTitle: event.target.value })} placeholder="例如：前端工程师" /></label>
                  <label className="field-label">身份标签<input value={draft.personaLabel} onChange={(event) => setDraft({ ...draft, personaLabel: event.target.value })} placeholder="可选" /></label>
                </div>
                <label className="field-label">长期角色描述<textarea required maxLength={4000} rows={4} value={draft.roleDescription} onChange={(event) => setDraft({ ...draft, roleDescription: event.target.value })} placeholder="说明这位成员长期负责什么、擅长什么。" /></label>
                <label className="field-label">成员指令<textarea maxLength={32000} rows={7} value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} placeholder="这些指令会注入该成员的新 AgentRun。" /></label>
                <label className="memory-capability-toggle"><input type="checkbox" checked={draft.memoryWriteEnabled} onChange={(event) => setDraft({ ...draft, memoryWriteEnabled: event.target.checked })} /><span><strong>允许写入长期记忆</strong><small>只影响未来运行：Companion / Relationship 的合法写入直接生效，Hearth 仍必须由用户确认。</small></span></label>
              </section>
            </div>
            {submitError && <div className="inline-error">{submitError}</div>}
            <div className="dialog-actions"><Dialog.Close className="quiet-button" type="button" disabled={isBusy}>取消</Dialog.Close><button className="primary-button" disabled={isBusy || !draft.displayName.trim() || !draft.roleDescription.trim()}>{avatarBusy === 'saving' ? '正在保存图片…' : busy ? '正在保存身份…' : agent ? '保存身份' : '创建成员'}</button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function RuntimeInstallationsPanel({ health, installations, onReload }: {
  health: HealthStatus | null
  installations: AdapterInstallation[]
  onReload(): Promise<void>
}): React.JSX.Element {
  const [customOpen, setCustomOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const availability = health?.runtimeAvailability ?? []

  const checkProduct = async (runtimeKind: AdapterKind): Promise<void> => {
    setBusy(`check-${runtimeKind}`)
    setError(null)
    try {
      await window.rovai.request('runtime.product.check', { runtimeKind })
      await onReload()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const rescan = async (): Promise<void> => {
    setBusy('rescan')
    setError(null)
    try {
      await window.rovai.request('runtime.discovery.rescan', { interactiveShell: true })
      await onReload()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const refresh = async (installationId: string): Promise<void> => {
    setBusy(`refresh-${installationId}`)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('runtime.installations.refresh', {
        commandId: crypto.randomUUID(),
        installationId
      })
      assertApplied(result)
      await onReload()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const create = async (adapterKind: AdapterKind, executablePath: string, source: 'custom', authScope: string): Promise<void> => {
    setBusy('create-installation')
    setError(null)
    try {
      await createAndRefreshRuntimeInstallation(adapterKind, executablePath, source, authScope)
      setCustomOpen(false)
      await onReload()
    } catch (nextError) {
      setError(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  const toggle = async (installation: AdapterInstallation): Promise<void> => {
    setBusy(`toggle-${installation.id}`)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('runtime.installations.update', {
        commandId: crypto.randomUUID(),
        command: {
          installationId: installation.id,
          expectedVersion: installation.version,
          executablePath: installation.executablePath,
          commandName: installation.commandName,
          source: installation.source,
          authScope: installation.authScope,
          enabled: !installation.enabled
        }
      })
      assertApplied(result)
      await onReload()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="section-block runtime-installations">
      <div className="section-heading">
        <div><h2>Product Runtime</h2></div>
        <button className="quiet-button" disabled={busy !== null} onClick={() => void rescan()}>
          {busy === 'rescan' ? '正在重新检测…' : '重新检测全部'}
        </button>
      </div>
      <p className="section-intro">九种已支持产品始终显示。重新检测会执行你的交互式登录 Shell 初始化，只读取 PATH；未登记产品不会因此启动 Session 或检查登录。</p>

      <div className="runtime-installation-list">
        {PRODUCT_RUNTIMES.map((runtimeKind) => {
          const item = availability.find((candidate) => candidate.runtimeKind === runtimeKind)
          const status = item?.status ?? 'detecting'
          const help = productRuntimeHelp(runtimeKind)
          return (
            <article key={runtimeKind} className="runtime-installation-row">
              <div className="runtime-installation-main">
                <div>
                  <strong>{adapterLabel(runtimeKind)}</strong>
                  <span className={`runtime-snapshot-badge ${status === 'ready' ? 'ready' : 'attention'}`}>
                    {productRuntimeAvailabilityLabel(status)}
                  </span>
                </div>
                <span>{item?.reportedVersion ?? adapterMaturityLabel(runtimeKind)}</span>
                {status === 'missing' && <small>尚未找到本机入口；成员仍可选择并等待自动解析。</small>}
                <small className="runtime-self-check">自查命令：<code>{help.selfCheckCommand}</code></small>
              </div>
              <div className="runtime-row-actions">
                <button className="quiet-button" disabled={busy !== null} onClick={() => void checkProduct(runtimeKind)}>
                  {busy === `check-${runtimeKind}` ? '正在检查…' : '检查可用性'}
                </button>
                <a className="quiet-button" href={help.installationUrl} target="_blank" rel="noreferrer">安装说明</a>
              </div>
            </article>
          )
        })}
      </div>
      {error && <div className="inline-error" role="alert">{error}</div>}

      <details className="member-advanced-settings runtime-advanced-diagnostics">
        <summary>高级诊断与自定义启动入口</summary>
        <p>以下路径和 fingerprint 仅用于诊断、审计与恢复；普通成员配置不会选择它们。</p>
        <button className="quiet-button" onClick={() => setCustomOpen(true)}>添加自定义启动入口</button>
        <div className="runtime-installation-list">
          {installations.map((installation) => (
            <article key={installation.id} className={`runtime-installation-row ${installation.enabled ? '' : 'disabled'}`}>
              <div className="runtime-installation-main">
                <div><strong>{adapterLabel(installation.adapterKind)}</strong><RuntimeSnapshotBadge installation={installation} /></div>
                <code>{installation.executablePath}</code>
                <span>{installation.installationClass === 'managed_default' ? '受管默认入口' : '自定义入口'} · {installationSourceLabel(installation.source)} · generation {installation.generation}</span>
                <small>fingerprint：{installation.snapshot?.executableFingerprint ?? '—'}</small>
                {installation.relocationHistory[0] && <small>最近自动迁移：{formatTimestamp(installation.relocationHistory[0].createdAt)} · {installation.relocationHistory[0].result}</small>}
              </div>
              <dl>
                <div><dt>模型</dt><dd>{reportedModelCount(installation)}</dd></div>
                <div><dt>引用成员</dt><dd>{installation.referencedProfileCount}</dd></div>
                <div><dt>最近探测</dt><dd>{formatTimestamp(installation.lastProbeAttempt?.attemptedAt ?? installation.snapshot?.lastSuccessfulProbeAt)}</dd></div>
              </dl>
              <div className="runtime-row-actions">
                <button className="quiet-button" disabled={busy !== null || !installation.enabled} onClick={() => void refresh(installation.id)}>{busy === `refresh-${installation.id}` ? '探测中…' : '刷新能力'}</button>
                <button className={installation.enabled ? 'danger-button' : 'quiet-button'} disabled={busy !== null} onClick={() => void toggle(installation)}>{installation.enabled ? '停用' : '启用'}</button>
              </div>
            </article>
          ))}
          {installations.length === 0 && <div className="runtime-empty">尚无内部 Installation；选择产品或检查可用性后会自动创建。</div>}
        </div>
      </details>

      <CustomRuntimeDialog open={customOpen} busy={busy === 'create-installation'} onOpenChange={setCustomOpen} onSubmit={create} />
    </section>
  )
}

async function createAndRefreshRuntimeInstallation(
  adapterKind: AdapterKind,
  executablePath: string,
  source: 'custom',
  authScope: string
): Promise<string> {
  const result = await window.rovai.request<StoredCommandResult>('runtime.installations.create', {
    commandId: crypto.randomUUID(),
    command: {
      adapterKind,
      executablePath,
      commandName: runtimeCommandName(adapterKind),
      source,
      authScope
    }
  })
  assertApplied(result)
  const installationId = result.resultEntity?.entityId ?? stringField(result.payload, 'installationId')
  if (!installationId) throw new Error('Core 没有返回新执行引擎 ID。')
  const refreshed = await window.rovai.request<StoredCommandResult>('runtime.installations.refresh', {
    commandId: crypto.randomUUID(),
    installationId
  })
  assertApplied(refreshed)
  return installationId
}

function CustomRuntimeDialog({ open, busy, onOpenChange, onSubmit }: {
  open: boolean
  busy: boolean
  onOpenChange(open: boolean): void
  onSubmit(adapterKind: AdapterKind, executablePath: string, source: 'custom', authScope: string): Promise<void>
}): React.JSX.Element {
  const [adapterKind, setAdapterKind] = useState<AdapterKind>('codex-cli')
  const [path, setPath] = useState('')
  const [authScope, setAuthScope] = useState('default')
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setAdapterKind('codex-cli')
    setPath('')
    setAuthScope('default')
    setSubmitError(null)
  }, [open])

  const browse = async (): Promise<void> => {
    setSubmitError(null)
    try {
      const selected = await window.rovai.selectRuntimeExecutable()
      if (selected) setPath(selected)
    } catch (nextError) {
      setSubmitError(errorMessage(nextError))
    }
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitError(null)
    try {
      await onSubmit(adapterKind, path.trim(), 'custom', authScope.trim())
    } catch (nextError) {
      setSubmitError(errorMessage(nextError))
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content runtime-dialog" aria-describedby="runtime-dialog-description">
          <div className="dialog-heading"><div><Dialog.Title>添加本机执行引擎</Dialog.Title></div><Dialog.Close className="dialog-close" aria-label="关闭执行引擎编辑" disabled={busy}>×</Dialog.Close></div>
          <Dialog.Description id="runtime-dialog-description">选择本机已有 CLI。Rovai-ai 会保存稳定路径，并按当前执行引擎的安全准入级别检查版本、能力缺口或协议能力。</Dialog.Description>
          <form onSubmit={(event) => void submit(event)}>
            <label className="field-label">执行引擎类型<select value={adapterKind} onChange={(event) => setAdapterKind(event.target.value as AdapterKind)}><option value="codex-cli">Codex CLI</option><option value="opencode-cli">OpenCode</option><option value="copilot-cli">GitHub Copilot</option><option value="claude-code-cli">Claude Code</option><option value="kiro-cli">Kiro</option><option value="qoder-cli">Qoder</option><option value="codebuddy-cli">CodeBuddy</option><option value="qwen-code">Qwen Code</option><option value="antigravity-app">Antigravity（通过 agy companion）</option></select></label>
            <label className="field-label">可执行文件路径
              <span className="path-field"><input value={path} onChange={(event) => setPath(event.target.value)} placeholder={runtimePathPlaceholder(adapterKind)} autoFocus /><button className="quiet-button" type="button" onClick={() => void browse()}>浏览…</button></span>
            </label>
            <label className="field-label">认证 / 配置作用域<input value={authScope} onChange={(event) => setAuthScope(event.target.value)} placeholder="default" /></label>
            <div className="authorization-box"><strong>边界说明</strong><ul><li>Rovai-ai 保存的是这个启动入口，不固定上游版本。</li><li>刷新会执行该引擎已验证安全的版本探测与协议握手。</li><li>Rovai-ai 不修改 CLI 的全局配置或凭据。</li></ul></div>
            {submitError && <div className="inline-error">{submitError}</div>}
            <div className="dialog-actions"><Dialog.Close className="quiet-button" type="button" disabled={busy}>取消</Dialog.Close><button className="primary-button" disabled={busy || !path.trim() || !authScope.trim()}>{busy ? '正在探测…' : '添加并探测'}</button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function RuntimeReadinessMark({ status }: { status: RuntimeReadinessStatus }): React.JSX.Element {
  return <span className={`runtime-readiness-mark readiness-${status}`} aria-label={runtimeReadinessLabel(status)} title={runtimeReadinessLabel(status)}>{status === 'ready' ? '✓' : status === 'runtime_not_configured' ? '○' : '!'}</span>
}

function RuntimeReadinessBadge({ agent }: { agent: AgentProfile }): React.JSX.Element {
  const status = agent.runtimeReadiness.status
  return <span className={`runtime-readiness-badge readiness-${status}`}><RuntimeReadinessMark status={status} />{runtimeReadinessLabel(status)}</span>
}

function RuntimeSnapshotBadge({ installation }: { installation: AdapterInstallation }): React.JSX.Element {
  const snapshot = installation.snapshot
  const ready = installation.enabled && Boolean(snapshot) && !snapshot?.staleAt
  return <span className={`runtime-snapshot-badge ${ready ? 'ready' : 'attention'}`}>{installation.enabled ? ready ? '已就绪' : '需要处理' : '已停用'}</span>
}

function identityCommand(draft: IdentityDraft, agent: AgentProfile | null): CreateAgentProfileCommand | UpdateAgentProfileCommand {
  const capabilities = new Set(agent?.defaultCapabilities ?? [])
  if (draft.memoryWriteEnabled) capabilities.add('memory.write')
  else capabilities.delete('memory.write')
  const identity: CreateAgentProfileCommand = {
    displayName: draft.displayName.trim(),
    avatarRef: draft.avatarRef,
    personaLabel: draft.personaLabel.trim() || null,
    accent: agent?.accent ?? null,
    roleTitle: draft.roleTitle.trim() || null,
    roleDescription: draft.roleDescription.trim(),
    instructions: draft.instructions,
    defaultCapabilities: [...capabilities]
  }
  return agent ? { ...identity, agentProfileId: agent.id, expectedVersion: agent.version } : identity
}

export function hasDuplicateMemberDisplayName(
  displayName: string,
  currentAgentId: string | null,
  agents: Pick<AgentProfile, 'id' | 'displayName'>[]
): boolean {
  const normalized = normalizeMemberDisplayName(displayName)
  return normalized !== '' && agents.some((candidate) =>
    candidate.id !== currentAgentId
    && normalizeMemberDisplayName(candidate.displayName) === normalized
  )
}

function normalizeMemberDisplayName(displayName: string): string {
  return displayName.trim().normalize('NFKC').toLocaleLowerCase()
}

function assertApplied(result: StoredCommandResult): void {
  if (result.status !== 'rejected') return
  const detail = stringField(result.payload, 'message') ?? stringField(result.payload, 'detail')
  throw new Error(detail ? `${commandCodeLabel(result.code)}：${detail}` : commandCodeLabel(result.code))
}

function commandCodeLabel(code: string): string {
  return ({
    'agent_profile.display_name_conflict': '该名称已被其他成员使用',
    'agent_profile.version_conflict': '成员已被其他操作更新，请刷新后重试',
    'agent_profile.default_lead_successor_required': '该成员仍是 Camp 的 Default Lead，请先在 Camp 中指定继任者',
    'adapter_installation.already_exists': '这个执行引擎已经存在',
    'adapter_installation.version_conflict': '执行引擎已被更新，请刷新后重试'
  } as Record<string, string>)[code] ?? `Core 拒绝了操作：${code}`
}

function runtimeBlockerLabel(code: string): string {
  return ({
    runtime_not_configured: '尚未配置执行引擎',
    runtime_selection_unresolved: '已选择产品，等待发现并检查本机执行引擎',
    runtime_configuration_incomplete: '执行引擎配置不完整',
    runtime_probe_required: '需要探测执行引擎',
    runtime_snapshot_stale: 'CLI 已变化或能力快照已过期',
    runtime_authentication_required: '需要先完成上游 CLI 登录',
    runtime_model_unavailable: '显式模型当前不可用',
    runtime_model_option_unknown: '模型参数已不受支持',
    runtime_model_option_invalid: '模型参数值已失效',
    runtime_permission_schema_mismatch: '权限结构已升级，需要重新确认',
    runtime_permission_option_unknown: '权限字段已不受支持',
    runtime_permission_option_unsupported: '所选权限值当前不能执行',
    runtime_permission_value_invalid: '权限值已失效',
    runtime_permission_value_required: '缺少必填权限值',
    runtime_permission_adapter_mismatch: '权限配置属于另一个执行引擎',
    adapter_installation_missing: '引用的执行引擎不存在',
    adapter_installation_disabled: '引用的执行引擎已停用'
  } as Record<string, string>)[code] ?? code
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

function adapterMaturityLabel(kind: AdapterKind): string {
  return ({
    'codex-cli': '稳定',
    'opencode-cli': '测试',
    'copilot-cli': '测试',
    'claude-code-cli': '测试',
    'kiro-cli': '实验性 · 私有 Agent + ACP MCP',
    'qoder-cli': '实验性 · 严格 MCP',
    'codebuddy-cli': '实验性 · 严格 MCP',
    'qwen-code': '实验性 · MCP allowlist',
    'antigravity-app': '实验性'
  })[kind]
}

function installationSourceLabel(source: AdapterInstallation['source']): string {
  return ({
    manual: '手动入口',
    env: '环境变量',
    inherited_path: '应用继承 PATH',
    login_shell: '登录 Shell PATH',
    known_location: '平台常见目录',
    custom: '高级自定义'
  })[source]
}

function runtimeCommandName(kind: AdapterKind): string {
  return ({
    'codex-cli': 'codex',
    'opencode-cli': 'opencode',
    'copilot-cli': 'copilot',
    'claude-code-cli': 'claude',
    'kiro-cli': 'kiro-cli',
    'qoder-cli': 'qodercli',
    'codebuddy-cli': 'codebuddy',
    'qwen-code': 'qwen',
    'antigravity-app': 'agy'
  })[kind]
}

function productRuntimeHelp(kind: AdapterKind): {
  installationUrl: string
  selfCheckCommand: string
} {
  const command = runtimeCommandName(kind)
  return {
    installationUrl: ({
      'codex-cli': 'https://learn.chatgpt.com/docs/codex/cli',
      'opencode-cli': 'https://opencode.ai/docs/',
      'copilot-cli': 'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli',
      'claude-code-cli': 'https://docs.anthropic.com/en/docs/claude-code/getting-started',
      'kiro-cli': 'https://kiro.dev/docs/cli/installation/',
      'qoder-cli': 'https://docs.qoder.com/en/cli/quick-start',
      'codebuddy-cli': 'https://www.codebuddy.cn/docs/cli/installation',
      'qwen-code': 'https://qwenlm.github.io/qwen-code-docs/en/users/quickstart/',
      'antigravity-app': 'https://antigravity.google/docs/cli-getting-started'
    })[kind],
    selfCheckCommand: `command -v ${command} && ${command} --version`
  }
}

function runtimePathPlaceholder(kind: AdapterKind): string {
  return ({
    'codex-cli': '/opt/homebrew/bin/codex',
    'opencode-cli': '/opt/homebrew/bin/opencode',
    'copilot-cli': '/opt/homebrew/bin/copilot',
    'claude-code-cli': '/opt/homebrew/bin/claude',
    'kiro-cli': '/opt/homebrew/bin/kiro-cli',
    'qoder-cli': '~/.local/bin/qodercli',
    'codebuddy-cli': '/opt/homebrew/bin/codebuddy',
    'qwen-code': '/opt/homebrew/bin/qwen',
    'antigravity-app': '~/.local/bin/agy'
  })[kind]
}

function runtimeReadinessLabel(status: RuntimeReadinessStatus): string {
  return ({
    runtime_not_configured: '未配置执行引擎',
    selected_unresolved: '等待执行引擎',
    configuration_incomplete: '等待模型或权限配置',
    needs_attention: '需要处理',
    ready: '已就绪'
  })[status]
}

function productRuntimeAvailabilityLabel(status: ProductRuntimeAvailability['status']): string {
  return ({
    detecting: '正在检测',
    missing: '未找到',
    found_uninspected: '已找到，尚未检查',
    checking: '正在检查',
    ready: '已就绪',
    authentication_required: '需要登录',
    incompatible: '版本或能力不兼容',
    path_missing: '路径失效',
    disabled: '已停用',
    refresh_failed_using_last_success: '刷新失败，仍使用上次成功检查'
  })[status]
}

function memberPresenceLabel(presence: AgentProfile['presence']): string {
  return ({ present: '在队', away: '暂离', removed: '已移除' })[presence]
}

function runtimeSnapshotSummary(installation: AdapterInstallation): string {
  const snapshot = installation.snapshot
  if (!installation.enabled) return '该安装已停用'
  if (!snapshot) return '尚未探测能力'
  if (snapshot.staleAt) return '成功快照已失效，请重新检查'
  if (installation.lastProbeAttempt?.status === 'failed') {
    return installation.lastProbeAttempt.failureClass === 'transient'
      ? '最近刷新失败，仍保留上次成功快照'
      : '最近检查失败，请查看诊断'
  }
  return `${reportedModelCount(installation)} 个模型 · ${snapshot.permissionOptions.length} 个权限字段`
}

function reportedModelCount(installation: AdapterInstallation): number {
  return installation.snapshot?.models.filter((model) =>
    !model.id.endsWith('://runtime-default')
  ).length ?? 0
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === 'string' ? value[key] as string : null
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error))
}
