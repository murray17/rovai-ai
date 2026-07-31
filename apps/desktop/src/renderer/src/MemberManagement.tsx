import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
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
  SetAgentProfileAvatarCommand,
  SetAgentProfileMemoryWriteCommand,
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
  submitMemberAvatar,
  type PendingMemberAvatarSource
} from './member-avatar-submit'
import { invalidateManagedAvatarObjectUrl } from './managed-avatar-cache'
import { identityColorToken } from './theme'
import { SummaryModelSettings } from './SummaryModelSettings'
import {
  MemberRuntimeParameters,
  runtimeDraftForMember,
  runtimeEditorInstallation,
  type MemberRuntimeDraft
} from './MemberRuntimeParameters'
import {
  memberRuntimePresentation,
  runtimeAvailabilityPresentation,
  runtimeReadinessLabel
} from './runtime-status'

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
  teamRole: string
  professionalResponsibilities: string
  personalityTraits: string[]
  workingPrinciples: string
  growthTopic: string
}

const EMPTY_IDENTITY: IdentityDraft = {
  displayName: '',
  teamRole: '',
  professionalResponsibilities: '',
  personalityTraits: [],
  workingPrinciples: '',
  growthTopic: ''
}

export function MembersView({ agents, installations, runtimeAvailability, runtimeDiscoveryPending, onReload, onOpenRuntimeSettings }: MembersViewProps): React.JSX.Element {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [identityDialog, setIdentityDialog] = useState<'create' | 'edit' | null>(null)
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false)
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
  const avatarReturnFocusRef = useRef<HTMLButtonElement | null>(null)
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
    method: 'agents.create' | 'agents.update' | 'agents.avatar.set' | 'agents.memoryWrite.set' | 'agents.runtime.set' | 'agents.runtime.clear' | 'agents.presence.set' | 'agents.remove' | 'agents.reorder',
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
    const identity = identityCommand(draft, targetAgent)
    const method = targetAgent ? 'agents.update' : 'agents.create'
    const result = await runCommand('identity', method, identity)
    if (!targetAgent) {
      const createdId = result.resultEntity?.entityId ?? stringField(result.payload, 'agentProfileId')
      if (createdId) setSelectedAgentId(createdId)
    }
    closeIdentityDialog()
  }

  const saveAvatar = async (avatarRef: string | null): Promise<void> => {
    if (!selectedAgent) return
    const previousAvatarRef = selectedAgent.avatarRef
    const command: SetAgentProfileAvatarCommand = {
      agentProfileId: selectedAgent.id,
      expectedVersion: selectedAgent.version,
      avatarRef
    }
    await runCommand('avatar', 'agents.avatar.set', command)
    if (
      previousAvatarRef
      && previousAvatarRef !== avatarRef
      && parseControlledMemberAvatarRef(previousAvatarRef)?.kind === 'managed'
    ) {
      await invalidateManagedAvatarObjectUrl(previousAvatarRef)
    }
    setAvatarDialogOpen(false)
    setNotice('角色图片已保存。')
  }

  const saveMemoryWrite = async (enabled: boolean): Promise<void> => {
    if (!selectedAgent) return
    const command: SetAgentProfileMemoryWriteCommand = {
      agentProfileId: selectedAgent.id,
      expectedVersion: selectedAgent.version,
      enabled
    }
    await runCommand('memory-write', 'agents.memoryWrite.set', command)
    setNotice(enabled ? '伙伴记忆写入已开启。' : '伙伴记忆写入已关闭。')
  }

  const saveRuntime = async (
    adapterKind: AdapterKind,
    draft: MemberRuntimeDraft | null
  ): Promise<void> => {
    if (!selectedAgent) return
    await runCommand('runtime', 'agents.runtime.set', {
      agentProfileId: selectedAgent.id,
      expectedVersion: selectedAgent.version,
      adapterKind,
      ...(draft ? {
        model: draft.model,
        permissions: draft.permissions
      } : {})
    })
    setNotice(`${adapterLabel(adapterKind)} 已保存。`)
  }

  const clearRuntime = async (): Promise<void> => {
    if (!selectedAgent) return
    await runCommand('runtime-clear', 'agents.runtime.clear', {
      agentProfileId: selectedAgent.id,
      expectedVersion: selectedAgent.version
    })
    setNotice('Agent 运行时已清除。')
  }

  const ensureRuntime = useCallback((adapterKind: AdapterKind): void => {
    void window.rovai.request('runtime.product.ensure', { runtimeKind: adapterKind })
      .catch((nextError) => setError(errorMessage(nextError)))
  }, [])

  const checkRuntime = useCallback((adapterKind: AdapterKind): void => {
    void window.rovai.request('runtime.product.check', { runtimeKind: adapterKind })
      .catch((nextError) => setError(errorMessage(nextError)))
  }, [])

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
          <h2>队员</h2>
          <p>队员保存长期身份和默认 Agent 运行时；加入 Camp、Default Lead 与 Camp 权限仍由具体 Camp 管理。</p>
        </div>
        <div className="project-actions">
          <button
            className="primary-button"
            onClick={(event) => {
              identityReturnFocusRef.current = event.currentTarget
              setIdentityDialog('create')
            }}
          >＋ 新增队员</button>
        </div>
      </section>

      {error && (
        <div className="inline-error member-page-error" role="alert">
          <strong>队员配置未保存</strong><span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="app-toast" role="status" aria-live="polite">
          <span>{notice}</span>
          <button className="icon-button" type="button" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      <section className="member-workbench">
        <aside className="member-list" aria-label="队员列表">
          <div className="member-list-heading"><strong>{agents.length} 位队员</strong><span>选择后编辑</span></div>
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
              <h3>选择一位队员</h3>
              <p>这里不会自动选中队员，也不会替新队员绑定 Agent 运行时。请选择已有队员，或新建一个长期身份。</p>
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
                onEditAvatar={(trigger) => {
                  avatarReturnFocusRef.current = trigger
                  setAvatarDialogOpen(true)
                }}
                onPresence={changePresence}
              />
              <MemberMemorySettings
                agent={selectedAgent}
                busy={busy}
                onChange={saveMemoryWrite}
              />
              <MemberRuntimeForm
                key={`${selectedAgent.id}:${selectedAgent.version}`}
                agent={selectedAgent}
                installations={installations}
                runtimeAvailability={runtimeAvailability}
                runtimeDiscoveryPending={runtimeDiscoveryPending}
                busy={busy}
                onSave={saveRuntime}
                onClear={clearRuntime}
                onRuntimeEnsure={ensureRuntime}
                onRuntimeSelected={checkRuntime}
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
      <MemberAvatarDialog
        open={avatarDialogOpen && selectedAgent !== null}
        agent={selectedAgent}
        busy={busy === 'avatar'}
        returnFocusRef={avatarReturnFocusRef}
        onOpenChange={(open) => !open && setAvatarDialogOpen(false)}
        onSubmit={saveAvatar}
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
            <div className="dialog-heading"><div><Dialog.Title>移除队员</Dialog.Title></div><Dialog.Close className="dialog-close" aria-label="关闭" disabled={busy === 'remove'}>×</Dialog.Close></div>
            <Dialog.Description id="remove-member-description">
              移除后队员不会再出现在管理列表，也不能产生后续消息；历史身份、头像、Agent 运行时、消息、Task 与 Run 仍保留。
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

function MemberIdentitySummary({ agent, busy, onEdit, onEditAvatar, onPresence }: {
  agent: AgentProfile
  busy: string | null
  onEdit(trigger: HTMLButtonElement): void
  onEditAvatar(trigger: HTMLButtonElement): void
  onPresence(presence: 'present' | 'away'): Promise<void>
}): React.JSX.Element {
  return (
    <section className="member-section member-identity-section">
      <div className="member-identity-overview">
        <div className="member-identity-appearance">
          <MemberPortrait
            agentProfileId={agent.id}
            avatarRef={agent.avatarRef}
            displayName={agent.displayName}
          />
          <button
            className="quiet-button member-avatar-change"
            type="button"
            disabled={busy !== null}
            onClick={(event) => onEditAvatar(event.currentTarget)}
          >更换角色图片</button>
        </div>
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
              <div><h3>{agent.displayName}</h3><span>{agent.teamRole || '团队角色未设置'}</span></div>
            </div>
            <button className="quiet-button" onClick={(event) => onEdit(event.currentTarget)}>编辑身份</button>
          </div>
          <div className="member-identity-field">
            <strong>专业职责</strong>
            <p className="member-role-description">{agent.professionalResponsibilities || '未设置'}</p>
          </div>
          <div className="member-identity-field">
            <strong>性格底色</strong>
            {agent.personalityTraits.length > 0
              ? <div className="member-trait-list">{agent.personalityTraits.map((trait) => <span key={trait}>{trait}</span>)}</div>
              : <p className="member-identity-empty">未设置</p>}
          </div>
          <div className="member-identity-field">
            <strong>工作准则</strong>
            <p className="member-role-description">{agent.workingPrinciples || '未设置'}</p>
          </div>
          <div className="member-identity-field">
            <strong>成长课题</strong>
            <p className="member-role-description">{agent.growthTopic || '未设置'}</p>
          </div>
        </div>
      </div>
      <div className="member-status-actions">
        <span>在队状态：<strong>{memberPresenceLabel(agent.presence)}</strong></span>
        {agent.presence === 'present' && <button className="quiet-button" disabled={busy !== null} onClick={() => void onPresence('away').catch(() => undefined)}>暂离</button>}
        {agent.presence === 'away' && <button className="quiet-button" disabled={busy !== null} onClick={() => void onPresence('present').catch(() => undefined)}>归队</button>}
      </div>
      {agent.presence === 'away' && <div className="member-status-note" role="status">队员仍属于已有 Camp；已有 Run 不会中断，但不会再启动新的 Run。</div>}
    </section>
  )
}

function MemberMemorySettings({ agent, busy, onChange }: {
  agent: AgentProfile
  busy: string | null
  onChange(enabled: boolean): Promise<void>
}): React.JSX.Element {
  const enabled = agent.defaultCapabilities.includes('memory.write')
  return (
    <section className="member-section member-memory-settings">
      <div>
        <h3>伙伴记忆</h3>
        <p>允许伙伴在真实形成长期偏好、约定或经验时写入记忆；成长课题本身不会自动创建记忆。</p>
      </div>
      <label className="memory-capability-toggle member-memory-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy !== null}
          onChange={(event) => void onChange(event.target.checked).catch(() => undefined)}
        />
        <span><strong>{enabled ? '已开启' : '已关闭'}</strong><small>独立保存，只影响之后创建的 Run。</small></span>
      </label>
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
        <h3>移除队员</h3>
        <p>停止后续参与并从队员管理中隐藏。身份、头像、Agent 运行时和全部历史记录仍会保留。</p>
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

export function MemberRuntimeForm({ agent, installations, runtimeAvailability, runtimeDiscoveryPending = false, busy, onSave, onClear, onRuntimeEnsure, onRuntimeSelected, onOpenRuntimeSettings }: {
  agent: AgentProfile
  installations: AdapterInstallation[]
  runtimeAvailability: ProductRuntimeAvailability[]
  runtimeDiscoveryPending?: boolean
  busy: string | null
  onSave(adapterKind: AdapterKind, draft: MemberRuntimeDraft | null): Promise<void>
  onClear(): Promise<void>
  onRuntimeEnsure?(adapterKind: AdapterKind): void
  onRuntimeSelected?(adapterKind: AdapterKind): void
  onOpenRuntimeSettings(): void
}): React.JSX.Element {
  const [selectedKind, setSelectedKind] = useState<AdapterKind | ''>(
    agent.runtimeSelection?.adapterKind ?? ''
  )
  const [edited, setEdited] = useState(false)
  const initialInstallation = selectedKind
    ? runtimeEditorInstallation(
        installations,
        selectedKind,
        agent.runtimePreference?.installationId
      )
    : null
  const [draft, setDraft] = useState<MemberRuntimeDraft | null>(() => (
    selectedKind
      ? runtimeDraftForMember(agent, selectedKind, initialInstallation, true)
      : null
  ))
  const [submitError, setSubmitError] = useState<string | null>(null)
  const availability = runtimeAvailability.find((item) => item.runtimeKind === selectedKind) ?? null
  const installation = useMemo(() => (
    selectedKind
      ? runtimeEditorInstallation(
          installations,
          selectedKind,
          !edited && selectedKind === agent.runtimeSelection?.adapterKind
            ? agent.runtimePreference?.installationId
            : null
        )
      : null
  ), [
    agent.runtimePreference?.installationId,
    agent.runtimeSelection?.adapterKind,
    edited,
    installations,
    selectedKind
  ])
  const selectionChanged = selectedKind !== (agent.runtimeSelection?.adapterKind ?? '')
  const canSave = Boolean(selectedKind) || selectionChanged
  const runtimeStatus = memberRuntimePresentation(
    agent,
    selectedKind || null,
    availability,
    runtimeDiscoveryPending
  )
  const reportedVersion = availability?.reportedVersion
    ?? installation?.snapshot?.reportedVersion
    ?? null

  useEffect(() => {
    if (edited || !selectedKind) return
    setDraft(runtimeDraftForMember(agent, selectedKind, installation, true))
  }, [agent, edited, installation, selectedKind])

  useEffect(() => {
    if (selectedKind) onRuntimeEnsure?.(selectedKind)
  }, [onRuntimeEnsure, selectedKind])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!canSave) return
    setSubmitError(null)
    try {
      if (selectedKind) {
        await onSave(selectedKind, draft)
      } else {
        await onClear()
      }
    } catch (nextError) {
      setSubmitError(errorMessage(nextError))
    }
  }

  return (
    <section className="member-section">
      <div className="member-section-heading">
        <div>
          <h3>运行配置</h3>
          <p>只选择 Agent 产品；Rovai 自动发现、验证并维护实际启动入口。</p>
        </div>
      </div>

      <form onSubmit={(event) => void submit(event)}>
        <label className="field-label">Agent 运行时
          <select
            value={selectedKind}
            disabled={busy !== null}
            onChange={(event) => {
              const nextKind = event.target.value as AdapterKind | ''
              setSelectedKind(nextKind)
              const nextInstallation = nextKind
                ? runtimeEditorInstallation(installations, nextKind)
                : null
              setDraft(nextKind
                ? runtimeDraftForMember(agent, nextKind, nextInstallation, false)
                : null)
              setEdited(true)
              setSubmitError(null)
              if (nextKind) onRuntimeSelected?.(nextKind)
            }}
          >
            <option value="">不选择 Agent 运行时</option>
            {PRODUCT_RUNTIMES.map((kind) => (
              <option key={kind} value={kind}>{adapterLabel(kind)}</option>
            ))}
          </select>
          <span className="field-help">未安装的 Agent 运行时也可以保存；该队员会保持不可执行，且不会回退到其他 Agent 运行时。</span>
        </label>

        <div className={`runtime-installation-summary status-${runtimeStatus.status}`} role="status" aria-live="polite">
          <span>
            <strong>{selectedKind ? adapterLabel(selectedKind) : runtimeStatus.label}</strong>
            {selectedKind && (
              <em className={`runtime-user-status status-${runtimeStatus.status}`}>
                <i aria-hidden="true" />{runtimeStatus.label}
              </em>
            )}
          </span>
          {reportedVersion && <small>{reportedVersion}</small>}
          {runtimeStatus.detail && <small className="runtime-status-detail">{runtimeStatus.detail}</small>}
          {selectedKind && (
            runtimeStatus.status === 'not_installed'
            || runtimeStatus.status === 'authentication_required'
            || runtimeStatus.status === 'version_unsupported'
            || runtimeStatus.status === 'unavailable'
          ) && (
            <div>
              <button className="quiet-button" type="button" onClick={onOpenRuntimeSettings}>
                前往 Agent 运行时
              </button>
            </div>
          )}
        </div>

        {selectedKind && (
          <MemberRuntimeParameters
            adapterKind={selectedKind}
            installation={installation}
            draft={draft}
            disabled={busy !== null}
            onChange={(nextDraft) => {
              setDraft(nextDraft)
              setEdited(true)
              setSubmitError(null)
            }}
          />
        )}

        {submitError && <div className="inline-error">{submitError}</div>}
        <div className="member-form-actions">
          <button className="primary-button" disabled={!canSave || busy !== null}>
            {busy === 'runtime' || busy === 'runtime-clear' ? '正在保存…' : '保存运行时'}
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
  const [traitInput, setTraitInput] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(true)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const teamRoleRef = useRef<HTMLInputElement | null>(null)
  const responsibilitiesRef = useRef<HTMLTextAreaElement | null>(null)
  const traitInputRef = useRef<HTMLInputElement | null>(null)
  const principlesRef = useRef<HTMLTextAreaElement | null>(null)
  const growthRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!open) return
    setDraft(agent ? {
      displayName: agent.displayName,
      teamRole: agent.teamRole,
      professionalResponsibilities: agent.professionalResponsibilities,
      personalityTraits: agent.personalityTraits,
      workingPrinciples: agent.workingPrinciples,
      growthTopic: agent.growthTopic
    } : EMPTY_IDENTITY)
    setTraitInput('')
    setAdvancedOpen(true)
    setSubmitError(null)
  // Initialize only when the dialog opens or changes target. Background profile
  // refreshes must not replace a user's unsaved draft after a rejected save.
  }, [agent?.id, open])

  const addTraits = (value: string): IdentityDraft | null => {
    const pieces = value.split(/[，,]/).map(normalizeIdentityTag).filter(Boolean)
    const nextTraits = [...draft.personalityTraits]
    for (const trait of pieces) {
      if (unicodeScalarLength(trait) > 16 || hasControlOrNewline(trait)) {
        setSubmitError('每个性格底色标签最多 16 个字符，且不能包含换行或控制字符。')
        traitInputRef.current?.focus()
        return null
      }
      if (nextTraits.some((existing) => existing.toLowerCase() === trait.toLowerCase())) continue
      if (nextTraits.length >= 6) {
        setSubmitError('性格底色最多设置 6 个标签。')
        traitInputRef.current?.focus()
        return null
      }
      nextTraits.push(trait)
    }
    const nextDraft = { ...draft, personalityTraits: nextTraits }
    setDraft(nextDraft)
    setTraitInput('')
    setSubmitError(null)
    return nextDraft
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitError(null)
    let nextDraft = draft
    if (traitInput.trim()) {
      const withPendingTrait = addTraits(traitInput)
      if (!withPendingTrait) return
      nextDraft = withPendingTrait
    }
    const issue = identityDraftIssue(nextDraft, agent?.id ?? null, agents)
    if (issue) {
      setSubmitError(issue.message)
      if (issue.field === 'advanced') setAdvancedOpen(true)
      const target = {
        displayName: nameRef.current,
        teamRole: teamRoleRef.current,
        professionalResponsibilities: responsibilitiesRef.current,
        personalityTraits: traitInputRef.current,
        workingPrinciples: principlesRef.current,
        growthTopic: growthRef.current,
        advanced: principlesRef.current
      }[issue.field]
      requestAnimationFrame(() => target?.focus())
      return
    }
    try {
      await onSubmit(nextDraft)
    } catch (nextError) {
      setSubmitError(errorMessage(nextError))
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
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
          <div className="dialog-heading"><div><Dialog.Title>{agent ? '编辑队员身份' : '新增队员'}</Dialog.Title></div><Dialog.Close className="dialog-close" aria-label="关闭身份编辑" disabled={busy}>×</Dialog.Close></div>
          <Dialog.Description className="sr-only" id="member-dialog-description">设置队员的长期身份信息。</Dialog.Description>
          <form className="member-identity-form" onSubmit={(event) => void submit(event)}>
            <div className="member-dialog-scroll">
              <section className="member-identity-editor" aria-label="队员身份字段">
                <div className="member-form-grid">
                  <label className="field-label">名称<input ref={nameRef} required value={draft.displayName} onChange={(event) => { setDraft({ ...draft, displayName: event.target.value }); setSubmitError(null) }} autoFocus /><small>{unicodeScalarLength(draft.displayName)}/80</small></label>
                  <label className="field-label">团队角色<input ref={teamRoleRef} value={draft.teamRole} onChange={(event) => { setDraft({ ...draft, teamRole: event.target.value }); setSubmitError(null) }} placeholder="队员在团队中的主要贡献类型" /><small>{unicodeScalarLength(draft.teamRole)}/120</small></label>
                </div>
                <label className="field-label">专业职责<textarea ref={responsibilitiesRef} rows={2} value={draft.professionalResponsibilities} onChange={(event) => { setDraft({ ...draft, professionalResponsibilities: event.target.value }); setSubmitError(null) }} placeholder="说明队员长期负责什么，以及通常交付什么结果。" /><small>{unicodeScalarLength(draft.professionalResponsibilities)}/300</small></label>
                <div className="field-label">
                  <span>性格底色</span>
                  <div className="member-trait-editor">
                    {draft.personalityTraits.map((trait) => <span className="member-trait-chip" key={trait}>{trait}<button type="button" aria-label={`移除标签 ${trait}`} onClick={() => setDraft({ ...draft, personalityTraits: draft.personalityTraits.filter((candidate) => candidate !== trait) })}>×</button></span>)}
                    <input ref={traitInputRef} value={traitInput} disabled={draft.personalityTraits.length >= 6} onChange={(event) => {
                      const value = event.target.value
                      if (/[，,]/.test(value)) {
                        const parts = value.split(/[，,]/)
                        const remainder = parts.pop() ?? ''
                        if (addTraits(parts.join(','))) setTraitInput(remainder)
                      } else {
                        setTraitInput(value)
                        setSubmitError(null)
                      }
                    }} onKeyDown={(event) => {
                      if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                      event.preventDefault()
                      addTraits(traitInput)
                    }} onBlur={() => { if (traitInput.trim()) addTraits(traitInput) }} placeholder={draft.personalityTraits.length >= 6 ? '最多 6 项' : '输入后按 Enter 或逗号'} />
                  </div>
                  <small>自定义标签，每项 1–16 个字符，最多 6 项。</small>
                </div>
                <details className="member-identity-advanced" open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
                  <summary><span><strong>高级设置</strong><small>{advancedIdentityStatus(draft.workingPrinciples, draft.growthTopic)}</small></span><i aria-hidden="true">⌄</i></summary>
                  <div className="member-identity-advanced-fields">
                    <label className="field-label">工作准则<textarea ref={principlesRef} rows={2} value={draft.workingPrinciples} onChange={(event) => { setDraft({ ...draft, workingPrinciples: event.target.value }); setSubmitError(null) }} placeholder="可选。补充这位队员长期遵循的做事方式、质量标准和协作边界。" /><small>{unicodeScalarLength(draft.workingPrinciples)}/300 · 修改后用于之后开始的工作，不影响正在进行的任务。</small></label>
                    <label className="field-label">成长课题<textarea ref={growthRef} rows={2} value={draft.growthTopic} onChange={(event) => { setDraft({ ...draft, growthTopic: event.target.value }); setSubmitError(null) }} placeholder="可选。描述队员当前希望逐渐练习或改善的方向。" /><small>{unicodeScalarLength(draft.growthTopic)}/300 · 更换课题不会清除已经形成的队员记忆。</small></label>
                  </div>
                </details>
              </section>
              {submitError && <div className="inline-error">{submitError}</div>}
            </div>
            <div className="dialog-actions"><Dialog.Close className="quiet-button" type="button" disabled={busy}>取消</Dialog.Close><button className="primary-button" disabled={busy || !draft.displayName.trim()}>{busy ? '正在保存身份…' : agent ? '保存身份' : '创建'}</button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function MemberAvatarDialog({ open, agent, busy, returnFocusRef, onOpenChange, onSubmit }: {
  open: boolean
  agent: AgentProfile | null
  busy: boolean
  returnFocusRef: { current: HTMLButtonElement | null }
  onOpenChange(open: boolean): void
  onSubmit(avatarRef: string | null): Promise<void>
}): React.JSX.Element {
  const [avatarRef, setAvatarRef] = useState<string | null>(null)
  const [avatarSource, setAvatarSource] = useState<PendingMemberAvatarSource | null>(null)
  const [avatarBusy, setAvatarBusy] = useState<'loading' | 'choosing' | 'saving' | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const avatarLoadGeneration = useRef(0)
  const sourceUrl = useMemo(() => {
    if (!avatarSource) return null
    const bytes = Uint8Array.from(avatarSource.sourcePng)
    return URL.createObjectURL(new Blob([bytes.buffer], { type: 'image/png' }))
  }, [avatarSource?.sourcePng])

  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl) }, [sourceUrl])
  useEffect(() => {
    const generation = avatarLoadGeneration.current + 1
    avatarLoadGeneration.current = generation
    if (!open || !agent) {
      setAvatarSource(null)
      setAvatarBusy(null)
      return undefined
    }
    setAvatarRef(agent.avatarRef)
    setAvatarSource(null)
    setAvatarError(null)
    const parsed = agent.avatarRef ? parseControlledMemberAvatarRef(agent.avatarRef) : null
    if (parsed?.kind !== 'managed' || !agent.avatarRef) {
      setAvatarBusy(null)
      return undefined
    }
    setAvatarBusy('loading')
    void window.rovai.memberAvatars.read(agent.avatarRef, 'portrait').then((rendition) => {
      if (avatarLoadGeneration.current !== generation) return
      if (!rendition) {
        setAvatarError('原角色图片不可读取。可以替换图片或移除当前图片。')
        return
      }
      setAvatarSource({ sourcePng: Uint8Array.from(rendition.bytes), width: rendition.width, height: rendition.height, crop: rendition.crop, needsSave: false })
    }).catch((nextError) => {
      if (avatarLoadGeneration.current === generation) setAvatarError(errorMessage(nextError))
    }).finally(() => {
      if (avatarLoadGeneration.current === generation) setAvatarBusy(null)
    })
    return () => { if (avatarLoadGeneration.current === generation) avatarLoadGeneration.current += 1 }
  // Preserve the pending image choice across background refreshes of this profile.
  }, [agent?.id, open])

  const chooseImage = async (): Promise<void> => {
    avatarLoadGeneration.current += 1
    setAvatarBusy('choosing')
    setAvatarError(null)
    try {
      const selection = await window.rovai.memberAvatars.selectSource()
      if (!selection) return
      const normalized = await normalizeMemberAvatarSource(selection)
      setAvatarSource({ ...normalized, crop: defaultAvatarCrop(normalized.width, normalized.height), needsSave: true })
      setAvatarRef(null)
    } catch (nextError) {
      setAvatarError(errorMessage(nextError))
    } finally {
      setAvatarBusy(null)
    }
  }

  const selectBuiltin = (preset: BuiltinMemberPreset): void => {
    avatarLoadGeneration.current += 1
    setAvatarSource(null)
    setAvatarBusy(null)
    setAvatarError(null)
    setAvatarRef(preset.avatarRef)
  }

  const isBusy = busy || avatarBusy !== null
  const parsedAvatar = avatarRef ? parseControlledMemberAvatarRef(avatarRef) : null
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setAvatarError(null)
    try {
      if (avatarSource?.needsSave) setAvatarBusy('saving')
      await submitMemberAvatar(
        avatarRef,
        avatarSource,
        async (source) => {
          const asset = await deriveMemberAvatarIcon(source, source.crop)
          return window.rovai.memberAvatars.save({ sourcePng: asset.sourcePng, iconPng: asset.iconPng, sourceWidth: asset.width, sourceHeight: asset.height, crop: asset.crop })
        },
        onSubmit,
        (persistedRef, persistedSource) => { setAvatarRef(persistedRef); setAvatarSource(persistedSource) }
      )
    } catch (nextError) {
      setAvatarError(errorMessage(nextError))
    } finally {
      setAvatarBusy(null)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(value) => !isBusy && onOpenChange(value)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content member-avatar-dialog" aria-describedby="member-avatar-dialog-description" onCloseAutoFocus={(event) => { event.preventDefault(); returnFocusRef.current?.focus() }}>
          <div className="dialog-heading"><div><Dialog.Title>更换角色图片</Dialog.Title></div><Dialog.Close className="dialog-close" aria-label="关闭角色图片编辑" disabled={isBusy}>×</Dialog.Close></div>
          <Dialog.Description id="member-avatar-dialog-description">角色图片独立保存，不会修改身份、运行时、权限或伙伴记忆。</Dialog.Description>
          <form onSubmit={(event) => void submit(event)}>
            <section className="member-avatar-editor" aria-label="角色图片">
              <div className="member-avatar-editor-heading"><div><strong>当前图片</strong><span>可裁剪自定义图片，或选择内置伙伴外观</span></div>{(avatarRef || avatarSource) && <button className="quiet-button" type="button" disabled={isBusy} onClick={() => { setAvatarRef(null); setAvatarSource(null); setAvatarError(null) }}>移除</button>}</div>
              {sourceUrl && avatarSource
                ? <MemberAvatarCropper sourceUrl={sourceUrl} sourceWidth={avatarSource.width} sourceHeight={avatarSource.height} value={avatarSource.crop} disabled={isBusy} onChange={(crop) => setAvatarSource({ ...avatarSource, crop, needsSave: true })} />
                : <div className="member-avatar-current"><MemberAvatar agentProfileId={agent?.id ?? 'avatar-draft'} avatarRef={avatarRef} displayName={agent?.displayName ?? '伙伴'} size={parsedAvatar?.kind === 'builtin' ? 'bust' : 'picker'} /><div><strong>{avatarBusy === 'loading' ? '正在读取原图…' : parsedAvatar?.kind === 'builtin' ? '内置伙伴外观' : parsedAvatar?.kind === 'managed' ? '受管角色图片' : avatarRef ? '已有图片' : '字符头像'}</strong><span>没有图片时使用名称的首个字符。</span></div></div>}
              <button className="quiet-button member-avatar-browse" type="button" disabled={isBusy} onClick={() => void chooseImage()}>{avatarBusy === 'choosing' ? '正在处理图片…' : avatarSource ? '替换图片…' : '选择一张图片…'}</button>
              <p className="field-help">支持静态 PNG/JPEG，文件不超过 10 MiB；保存时移除原始元数据。</p>
              <div className="member-preset-heading"><strong>内置伙伴外观</strong><span>只替换角色图片</span></div>
              <div className="member-preset-list member-avatar-preset-list">{BUILTIN_MEMBER_PRESETS.map((preset) => <button key={preset.role} className={`member-preset-card ${avatarRef === preset.avatarRef ? 'selected' : ''}`} type="button" disabled={isBusy} aria-pressed={avatarRef === preset.avatarRef} onClick={() => selectBuiltin(preset)}><MemberAvatar agentProfileId={`preset-${preset.role}`} avatarRef={preset.avatarRef} displayName={preset.displayName} size="bust" decorative /><span className="member-preset-copy"><strong>{preset.displayName}</strong><small>{preset.teamRole}</small></span></button>)}</div>
            </section>
            {avatarError && <div className="inline-error" role="alert">{avatarError}</div>}
            <div className="dialog-actions"><Dialog.Close className="quiet-button" type="button" disabled={isBusy}>取消</Dialog.Close><button className="primary-button" disabled={isBusy}>{avatarBusy === 'saving' || busy ? '正在保存图片…' : '保存角色图片'}</button></div>
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

  useEffect(() => {
    for (const runtimeKind of PRODUCT_RUNTIMES) {
      void window.rovai.request('runtime.product.ensure', { runtimeKind })
        .catch(() => undefined)
    }
  }, [])

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
        <div><h2>Agent 运行时目录</h2></div>
        <button className="quiet-button" disabled={busy !== null} onClick={() => void rescan()}>
          {busy === 'rescan' ? '正在重新检查…' : '重新检查全部'}
        </button>
      </div>
      <p className="section-intro">九种已支持产品始终显示。页面优先使用最近一次结果，缺失或过期时由 Core 在后台刷新；重新检查会执行你的交互式登录 Shell 初始化，但只读取 PATH。</p>

      <div className="runtime-installation-list">
        {PRODUCT_RUNTIMES.map((runtimeKind) => {
          const item = availability.find((candidate) => candidate.runtimeKind === runtimeKind)
          const presentation = runtimeAvailabilityPresentation(item ?? null, health === null)
          const help = productRuntimeHelp(runtimeKind)
          return (
            <article key={runtimeKind} className="runtime-installation-row">
              <div className="runtime-installation-main">
                <div>
                  <strong>{adapterLabel(runtimeKind)}</strong>
                  <span className={`runtime-snapshot-badge status-${presentation.status}`}>
                    {presentation.label}
                  </span>
                </div>
                <span>{item?.reportedVersion ?? adapterMaturityLabel(runtimeKind)}</span>
                {presentation.detail && <small>{presentation.detail}</small>}
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
        <p>以下路径和 fingerprint 仅用于诊断、审计与恢复；普通队员配置不会选择它们。</p>
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
                <div><dt>引用队员</dt><dd>{installation.referencedProfileCount}</dd></div>
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
  if (!installationId) throw new Error('Core 没有返回新 Agent 运行时 ID。')
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
          <div className="dialog-heading"><div><Dialog.Title>添加本机 Agent 运行时</Dialog.Title></div><Dialog.Close className="dialog-close" aria-label="关闭 Agent 运行时编辑" disabled={busy}>×</Dialog.Close></div>
          <Dialog.Description id="runtime-dialog-description">选择本机已有 CLI。Rovai-ai 会保存稳定路径，并按当前 Agent 运行时的安全准入级别检查版本、能力缺口或协议能力。</Dialog.Description>
          <form onSubmit={(event) => void submit(event)}>
            <label className="field-label">Agent 运行时类型<select value={adapterKind} onChange={(event) => setAdapterKind(event.target.value as AdapterKind)}><option value="codex-cli">Codex CLI</option><option value="opencode-cli">OpenCode</option><option value="copilot-cli">GitHub Copilot</option><option value="claude-code-cli">Claude Code</option><option value="kiro-cli">Kiro</option><option value="qoder-cli">Qoder</option><option value="codebuddy-cli">CodeBuddy</option><option value="qwen-code">Qwen Code</option><option value="antigravity-app">Antigravity（通过 agy companion）</option></select></label>
            <label className="field-label">可执行文件路径
              <span className="path-field"><input value={path} onChange={(event) => setPath(event.target.value)} placeholder={runtimePathPlaceholder(adapterKind)} autoFocus /><button className="quiet-button" type="button" onClick={() => void browse()}>浏览…</button></span>
            </label>
            <label className="field-label">认证 / 配置作用域<input value={authScope} onChange={(event) => setAuthScope(event.target.value)} placeholder="default" /></label>
            <div className="authorization-box"><strong>边界说明</strong><ul><li>Rovai-ai 保存的是这个启动入口，不固定上游版本。</li><li>刷新会执行该 Agent 运行时已验证安全的版本探测与协议握手。</li><li>Rovai-ai 不修改 CLI 的全局配置或凭据。</li></ul></div>
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

function RuntimeSnapshotBadge({ installation }: { installation: AdapterInstallation }): React.JSX.Element {
  const snapshot = installation.snapshot
  const ready = installation.enabled && Boolean(snapshot) && !snapshot?.staleAt
  return <span className={`runtime-snapshot-badge status-${ready ? 'available' : 'unavailable'}`}>{installation.enabled ? ready ? '可用' : '不可用' : '不可用'}</span>
}

function identityCommand(draft: IdentityDraft, agent: AgentProfile | null): CreateAgentProfileCommand | UpdateAgentProfileCommand {
  const identity: CreateAgentProfileCommand = {
    displayName: draft.displayName.trim(),
    teamRole: normalizeIdentityTag(draft.teamRole),
    professionalResponsibilities: draft.professionalResponsibilities.trim(),
    personalityTraits: draft.personalityTraits.map(normalizeIdentityTag),
    workingPrinciples: draft.workingPrinciples.trim(),
    growthTopic: draft.growthTopic.trim()
  }
  return agent ? { ...identity, agentProfileId: agent.id, expectedVersion: agent.version } : identity
}

type IdentityDraftField = keyof IdentityDraft | 'advanced'

function identityDraftIssue(
  draft: IdentityDraft,
  currentAgentId: string | null,
  agents: Pick<AgentProfile, 'id' | 'displayName'>[]
): { field: IdentityDraftField; message: string } | null {
  const displayNameLength = unicodeScalarLength(draft.displayName.trim())
  if (displayNameLength < 1 || displayNameLength > 80) {
    return { field: 'displayName', message: '名称必须为 1–80 个字符。' }
  }
  if (hasDuplicateMemberDisplayName(draft.displayName, currentAgentId, agents)) {
    return { field: 'displayName', message: '该名称已被其他队员使用，请换一个名称。' }
  }
  const teamRole = normalizeIdentityTag(draft.teamRole)
  if (unicodeScalarLength(teamRole) > 120 || hasControlOrNewline(draft.teamRole)) {
    return { field: 'teamRole', message: '团队角色最多 120 个字符，且不能包含换行或控制字符。' }
  }
  if (unicodeScalarLength(draft.professionalResponsibilities.trim()) > 300) {
    return { field: 'professionalResponsibilities', message: '专业职责最多 300 个字符。' }
  }
  if (draft.personalityTraits.length > 6 || draft.personalityTraits.some((trait) => {
    const length = unicodeScalarLength(normalizeIdentityTag(trait))
    return length < 1 || length > 16 || hasControlOrNewline(trait)
  })) {
    return { field: 'personalityTraits', message: '性格底色最多 6 项，每项必须为 1–16 个字符。' }
  }
  if (unicodeScalarLength(draft.workingPrinciples.trim()) > 300) {
    return { field: 'workingPrinciples', message: '工作准则最多 300 个字符。' }
  }
  if (unicodeScalarLength(draft.growthTopic.trim()) > 300) {
    return { field: 'growthTopic', message: '成长课题最多 300 个字符。' }
  }
  return null
}

function unicodeScalarLength(value: string): number {
  return Array.from(value).length
}

function hasControlOrNewline(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value)
}

function normalizeIdentityTag(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

function advancedIdentityStatus(workingPrinciples: string, growthTopic: string): string {
  const count = Number(Boolean(workingPrinciples.trim())) + Number(Boolean(growthTopic.trim()))
  return count === 0 ? '未设置' : `已设置 ${count}/2 项`
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
  return displayName.trim().normalize('NFKC').toLowerCase()
}

function assertApplied(result: StoredCommandResult): void {
  if (result.status !== 'rejected') return
  const detail = stringField(result.payload, 'message') ?? stringField(result.payload, 'detail')
  throw new Error(detail ? `${commandCodeLabel(result.code)}：${detail}` : commandCodeLabel(result.code))
}

function commandCodeLabel(code: string): string {
  return ({
    'agent_profile.display_name_conflict': '该名称已被其他队员使用',
    'agent_profile.version_conflict': '队员已被其他操作更新，请刷新后重试',
    'agent_profile.default_lead_successor_required': '该队员仍是 Camp 的 Default Lead，请先在 Camp 中指定继任者',
    'adapter_installation.already_exists': '这个 Agent 运行时已经存在',
    'adapter_installation.version_conflict': 'Agent 运行时已被更新，请刷新后重试'
  } as Record<string, string>)[code] ?? `Core 拒绝了操作：${code}`
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
