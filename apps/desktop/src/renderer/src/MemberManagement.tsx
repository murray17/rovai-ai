import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AdapterInstallation,
  AdapterKind,
  AgentProfile,
  CreateAgentProfileCommand,
  HealthStatus,
  MemberRemovalPreview,
  ProductRuntimeAvailability,
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
import {
  SummaryModelSettings,
  type SummaryModelSettingsHandle
} from './SummaryModelSettings'
import {
  MemberRuntimeParameters,
  runtimeDraftForMember,
  runtimeEditorInstallation,
  type MemberRuntimeDraft
} from './MemberRuntimeParameters'
import {
  memberRuntimePresentation,
  runtimeAvailabilityPresentation,
} from './runtime-status'
import type { MemberWorkspaceTab } from './MemberSidebar'

type MembersViewProps = {
  agents: AgentProfile[]
  installations: AdapterInstallation[]
  runtimeAvailability: ProductRuntimeAvailability[]
  runtimeDiscoveryPending: boolean
  selectedAgentId: string | null
  activeTab: MemberWorkspaceTab
  runtimeFocusRequest: number
  onSelectedAgentChange(agentId: string, tab: MemberWorkspaceTab): void
  onTabChange(tab: MemberWorkspaceTab): void
  onReload(): Promise<void>
  onOpenRuntimeSettings(): void
}

type GuardedTransition = {
  action(): void | Promise<void>
  resolve(continued: boolean): void
  returnFocus: HTMLElement | null
}

export type MembersViewHandle = {
  requestTransition(
    action: () => void | Promise<void>,
    returnFocus?: HTMLElement | null
  ): Promise<boolean>
  requestCreate(trigger: HTMLButtonElement): void
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

export const MembersView = forwardRef<MembersViewHandle, MembersViewProps>(function MembersView({
  agents,
  installations,
  runtimeAvailability,
  runtimeDiscoveryPending,
  selectedAgentId,
  activeTab,
  runtimeFocusRequest,
  onSelectedAgentChange,
  onTabChange,
  onReload,
  onOpenRuntimeSettings
}, ref): React.JSX.Element {
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
  const [runtimeDirty, setRuntimeDirty] = useState(false)
  const [summaryDirty, setSummaryDirty] = useState(false)
  const [pendingTransition, setPendingTransition] = useState<GuardedTransition | null>(null)
  const identityReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const avatarReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const removalReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const runtimeFormRef = useRef<MemberRuntimeFormHandle>(null)
  const summarySettingsRef = useRef<SummaryModelSettingsHandle>(null)
  const pendingTransitionRef = useRef<GuardedTransition | null>(null)
  const dirtyRef = useRef(false)
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null

  useEffect(() => {
    dirtyRef.current = runtimeDirty || summaryDirty
  }, [runtimeDirty, summaryDirty])

  useEffect(() => {
    if (activeTab !== 'runtime' || runtimeFocusRequest < 1) return undefined
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLSelectElement>('#member-runtime-select')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [activeTab, runtimeFocusRequest, selectedAgentId])

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
      if (createdId) onSelectedAgentChange(createdId, 'identity')
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
  }

  const discardDrafts = useCallback((): void => {
    runtimeFormRef.current?.discard()
    summarySettingsRef.current?.discard()
    setRuntimeDirty(false)
    setSummaryDirty(false)
    dirtyRef.current = false
  }, [])

  const requestTransition = useCallback((
    action: () => void | Promise<void>,
    returnFocus: HTMLElement | null = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  ): Promise<boolean> => {
    if (!dirtyRef.current) {
      return Promise.resolve()
        .then(action)
        .then(() => true)
        .catch((nextError) => {
          setError(errorMessage(nextError))
          return false
        })
    }
    if (pendingTransitionRef.current) return Promise.resolve(false)
    return new Promise((resolve) => {
      const transition = { action, resolve, returnFocus }
      pendingTransitionRef.current = transition
      setPendingTransition(transition)
    })
  }, [])

  const continueEditing = useCallback((): void => {
    const transition = pendingTransitionRef.current
    pendingTransitionRef.current = null
    setPendingTransition(null)
    transition?.resolve(false)
    requestAnimationFrame(() => transition?.returnFocus?.focus())
  }, [])

  const discardAndContinue = useCallback(async (): Promise<void> => {
    const transition = pendingTransitionRef.current
    if (!transition) return
    pendingTransitionRef.current = null
    setPendingTransition(null)
    discardDrafts()
    try {
      await transition.action()
      transition.resolve(true)
    } catch (nextError) {
      setError(errorMessage(nextError))
      transition.resolve(false)
    }
  }, [discardDrafts])

  const requestCreate = useCallback((trigger: HTMLButtonElement): void => {
    void requestTransition(() => {
      identityReturnFocusRef.current = trigger
      setIdentityDialog('create')
    }, trigger)
  }, [requestTransition])

  useImperativeHandle(ref, () => ({ requestTransition, requestCreate }), [requestCreate, requestTransition])

  const openRuntimeTab = (): void => {
    onTabChange('runtime')
    requestAnimationFrame(() => document.querySelector<HTMLSelectElement>('#member-runtime-select')?.focus())
  }

  return (
    <>
      <section className="members-view">
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
        <div className="member-detail-scroll">
          {!selectedAgent && (
            <div className="member-empty">
              <span aria-hidden="true">◎</span>
              <h3>建立第一位队员</h3>
              <p>队员保存长期身份与默认 Agent 运行时；创建后仍需由你明确选择和保存运行配置。</p>
            </div>
          )}
          {selectedAgent && (
            <>
              <MemberDetailHeader
                agent={selectedAgent}
                runtimeAvailability={runtimeAvailability}
                runtimeDiscoveryPending={runtimeDiscoveryPending}
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
                onRuntime={openRuntimeTab}
                onRemove={(trigger) => {
                  void requestTransition(() => previewRemoval(trigger), trigger)
                }}
              />
              <MemberTabs
                value={activeTab}
                onChange={onTabChange}
              />
              <div id="member-identity-panel" role="tabpanel" aria-labelledby="member-identity-tab" hidden={activeTab !== 'identity'}>
                <MemberIdentitySummary agent={selectedAgent} />
                <MemberMemorySettings agent={selectedAgent} busy={busy} onChange={saveMemoryWrite} />
              </div>
              <div id="member-runtime-panel" role="tabpanel" aria-labelledby="member-runtime-tab" hidden={activeTab !== 'runtime'}>
                <p className="member-runtime-intro">为这位队员设置后续 Run 使用的 Agent 运行时、模型和该运行时提供的权限选项。保存后仅影响之后创建的 Run。</p>
                <MemberRuntimeForm
                  ref={runtimeFormRef}
                  agent={selectedAgent}
                  installations={installations}
                  runtimeAvailability={runtimeAvailability}
                  runtimeDiscoveryPending={runtimeDiscoveryPending}
                  busy={busy}
                  onDirtyChange={setRuntimeDirty}
                  onSave={saveRuntime}
                  onClear={clearRuntime}
                  onRuntimeEnsure={ensureRuntime}
                  onRuntimeSelected={checkRuntime}
                  onOpenRuntimeSettings={onOpenRuntimeSettings}
                />
                <MemberAdvancedSettings
                  key={`advanced:${selectedAgent.id}`}
                  ref={summarySettingsRef}
                  agent={selectedAgent}
                  installations={installations}
                  onDirtyChange={setSummaryDirty}
                />
              </div>
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
      <Dialog.Root open={pendingTransition !== null} onOpenChange={(open) => !open && continueEditing()}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content member-leave-dialog" aria-describedby="member-leave-description">
            <div className="dialog-heading">
              <div><Dialog.Title>运行配置尚未保存</Dialog.Title></div>
              <Dialog.Close className="dialog-close" aria-label="继续编辑">×</Dialog.Close>
            </div>
            <Dialog.Description id="member-leave-description">
              当前队员的运行配置或 Camp 共享摘要模型包含未保存更改。你可以继续编辑，或放弃更改后执行刚才的操作。
            </Dialog.Description>
            <div className="dialog-actions">
              <button className="quiet-button" type="button" onClick={continueEditing}>继续编辑</button>
              <button className="danger-button" type="button" onClick={() => void discardAndContinue()}>放弃更改</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
})

export function memberIdentityTargetAgent(
  mode: 'create' | 'edit' | null,
  selectedAgent: AgentProfile | null
): AgentProfile | null {
  return mode === 'edit' ? selectedAgent : null
}

function MemberDetailHeader({
  agent,
  runtimeAvailability,
  runtimeDiscoveryPending,
  busy,
  onEdit,
  onEditAvatar,
  onPresence,
  onRuntime,
  onRemove
}: {
  agent: AgentProfile
  runtimeAvailability: ProductRuntimeAvailability[]
  runtimeDiscoveryPending: boolean
  busy: string | null
  onEdit(trigger: HTMLButtonElement): void
  onEditAvatar(trigger: HTMLButtonElement): void
  onPresence(presence: 'present' | 'away'): Promise<void>
  onRuntime(): void
  onRemove(trigger: HTMLButtonElement): void
}): React.JSX.Element {
  const availability = runtimeAvailability.find(
    (item) => item.runtimeKind === agent.runtimeSelection?.adapterKind
  ) ?? null
  const runtime = memberRuntimePresentation(
    agent,
    agent.runtimeSelection?.adapterKind ?? null,
    availability,
    runtimeDiscoveryPending
  )
  return (
    <header className="member-detail-header">
      <div className="member-detail-heading">
        <MemberAvatar
          agentProfileId={agent.id}
          avatarRef={agent.avatarRef}
          displayName={agent.displayName}
          size="profile"
          decorative
          className="member-detail-avatar"
        />
        <div>
          <h2>{agent.displayName}</h2>
          <p>{agent.teamRole || '团队角色未设置'}</p>
          <div className="member-detail-statuses">
            <span className={`presence-${agent.presence}`}>{memberPresenceLabel(agent.presence)}</span>
            <button
              className={`member-header-runtime status-${runtime.status}`}
              type="button"
              onClick={onRuntime}
              title={runtime.detail ?? runtime.label}
            >
              <i aria-hidden="true" />
              <span>{agent.runtimeSelection?.adapterKind ? adapterLabel(agent.runtimeSelection.adapterKind) : 'Agent 运行时'}</span>
              <strong>{runtime.label}</strong>
            </button>
          </div>
        </div>
      </div>
      <div className="member-detail-actions">
        <button className="quiet-button" type="button" disabled={busy !== null} onClick={(event) => onEdit(event.currentTarget)}>编辑身份</button>
        <details className="member-detail-menu">
          <summary aria-label={`管理 ${agent.displayName}`} title="更多操作">•••</summary>
          <div role="menu">
            <button type="button" role="menuitem" disabled={busy !== null} onClick={(event) => {
              closeParentDetails(event.currentTarget)
              onEditAvatar(event.currentTarget)
            }}>更换角色图片</button>
            <button type="button" role="menuitem" disabled={busy !== null} onClick={(event) => {
              closeParentDetails(event.currentTarget)
              void onPresence(agent.presence === 'present' ? 'away' : 'present').catch(() => undefined)
            }}>{agent.presence === 'present' ? '暂时离队' : '归队'}</button>
            <button className="danger-menu-item" type="button" role="menuitem" disabled={busy !== null} onClick={(event) => {
              closeParentDetails(event.currentTarget)
              onRemove(event.currentTarget)
            }}>永久移除队员</button>
          </div>
        </details>
      </div>
    </header>
  )
}

function MemberTabs({ value, onChange }: {
  value: MemberWorkspaceTab
  onChange(tab: MemberWorkspaceTab): void
}): React.JSX.Element {
  const identityRef = useRef<HTMLButtonElement>(null)
  const runtimeRef = useRef<HTMLButtonElement>(null)
  const focusTab = (tab: MemberWorkspaceTab): void => {
    (tab === 'identity' ? identityRef : runtimeRef).current?.focus()
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'Home') {
      event.preventDefault()
      focusTab('identity')
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'End') {
      event.preventDefault()
      focusTab('runtime')
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onChange(event.currentTarget.dataset.memberTab as MemberWorkspaceTab)
    }
  }
  return (
    <div className="member-tabs" role="tablist" aria-label="队员详情">
      <button
        id="member-identity-tab"
        ref={identityRef}
        data-member-tab="identity"
        role="tab"
        type="button"
        aria-selected={value === 'identity'}
        aria-controls="member-identity-panel"
        tabIndex={value === 'identity' ? 0 : -1}
        onClick={() => onChange('identity')}
        onKeyDown={onKeyDown}
      >身份</button>
      <button
        id="member-runtime-tab"
        ref={runtimeRef}
        data-member-tab="runtime"
        role="tab"
        type="button"
        aria-selected={value === 'runtime'}
        aria-controls="member-runtime-panel"
        tabIndex={value === 'runtime' ? 0 : -1}
        onClick={() => onChange('runtime')}
        onKeyDown={onKeyDown}
      >运行配置</button>
    </div>
  )
}

function MemberIdentitySummary({ agent }: { agent: AgentProfile }): React.JSX.Element {
  return (
    <section className="member-section member-identity-section">
      <div className="member-identity-overview">
        <div className="member-identity-copy">
          <ExpandableIdentityField label="专业职责" lines={4} contentKey={agent.professionalResponsibilities}>
            <p className="member-role-description">{agent.professionalResponsibilities || '未设置'}</p>
          </ExpandableIdentityField>
          <ExpandableIdentityField label="性格底色" lines={2} contentKey={agent.personalityTraits.join('\u0000')}>
            {agent.personalityTraits.length > 0
              ? <div className="member-trait-list">{agent.personalityTraits.map((trait) => <span key={trait}>{trait}</span>)}</div>
              : <p className="member-identity-empty">未设置</p>}
          </ExpandableIdentityField>
          <ExpandableIdentityField label="工作准则" lines={3} contentKey={agent.workingPrinciples}>
            <p className="member-role-description">{agent.workingPrinciples || '未设置'}</p>
          </ExpandableIdentityField>
          <ExpandableIdentityField label="成长课题" lines={3} contentKey={agent.growthTopic}>
            <p className="member-role-description">{agent.growthTopic || '未设置'}</p>
          </ExpandableIdentityField>
        </div>
        <div className="member-identity-appearance">
          <MemberPortrait
            agentProfileId={agent.id}
            avatarRef={agent.avatarRef}
            displayName={agent.displayName}
          />
        </div>
      </div>
      {agent.presence === 'away' && <div className="member-status-note" role="status">队员仍属于已有 Camp；已有 Run 不会中断，但不会再启动新的 Run。</div>}
    </section>
  )
}

function ExpandableIdentityField({ label, lines, contentKey, children }: {
  label: string
  lines: number
  contentKey: string
  children: ReactNode
}): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const measure = useCallback((): void => {
    const element = contentRef.current
    if (!element || expanded) return
    setOverflow(element.scrollHeight > element.clientHeight + 1)
  }, [expanded])
  useEffect(() => {
    setExpanded(false)
    setOverflow(false)
  }, [contentKey])
  useEffect(() => {
    if (expanded) return undefined
    const frame = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(frame)
  }, [contentKey, expanded, measure])
  useEffect(() => {
    const element = contentRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [measure])
  return (
    <div className="member-identity-field">
      <strong>{label}</strong>
      <div
        ref={contentRef}
        className={`member-identity-clamp ${expanded ? 'expanded' : ''}`}
        style={{ '--identity-clamp-lines': lines } as React.CSSProperties}
      >{children}</div>
      {overflow && (
        <button className="member-identity-expand" type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? `收起${label}` : `展开${label}`}
        </button>
      )}
    </div>
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
        <p>允许这位伙伴在协作中形成长期偏好、约定或经验时写入记忆。</p>
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

export const MemberAdvancedSettings = forwardRef<SummaryModelSettingsHandle, {
  installations: AdapterInstallation[]
  agent: AgentProfile
  defaultOpen?: boolean
  onDirtyChange?(dirty: boolean): void
}>(function MemberAdvancedSettings({
  installations,
  agent,
  defaultOpen = false,
  onDirtyChange
}, ref): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const [openedOnce, setOpenedOnce] = useState(defaultOpen)
  const settingsRef = useRef<SummaryModelSettingsHandle>(null)
  useImperativeHandle(ref, () => ({
    discard(): void {
      settingsRef.current?.discard()
    }
  }), [])
  return (
    <section className="member-section member-advanced-settings">
      <details open={open} onToggle={(event) => {
        const nextOpen = event.currentTarget.open
        setOpen(nextOpen)
        if (nextOpen) setOpenedOnce(true)
      }}>
        <summary>
          <span>
            <strong>高级设置</strong>
            <small>Camp 共享摘要模型</small>
          </span>
          <i aria-hidden="true">⌄</i>
        </summary>
        {openedOnce && (
          <div hidden={!open}>
            <SummaryModelSettings
              ref={settingsRef}
              installations={installations}
              agent={agent}
              onDirtyChange={onDirtyChange}
            />
          </div>
        )}
      </details>
    </section>
  )
})

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

export type MemberRuntimeFormHandle = {
  discard(): void
}

type MemberRuntimeEditorState = {
  selectedKind: AdapterKind | ''
  draft: MemberRuntimeDraft | null
}

export const MemberRuntimeForm = forwardRef<MemberRuntimeFormHandle, {
  agent: AgentProfile
  installations: AdapterInstallation[]
  runtimeAvailability: ProductRuntimeAvailability[]
  runtimeDiscoveryPending?: boolean
  busy: string | null
  onDirtyChange?(dirty: boolean): void
  onSave(adapterKind: AdapterKind, draft: MemberRuntimeDraft | null): Promise<void>
  onClear(): Promise<void>
  onRuntimeEnsure?(adapterKind: AdapterKind): void
  onRuntimeSelected?(adapterKind: AdapterKind): void
  onOpenRuntimeSettings(): void
}>(function MemberRuntimeForm({
  agent,
  installations,
  runtimeAvailability,
  runtimeDiscoveryPending = false,
  busy,
  onDirtyChange,
  onSave,
  onClear,
  onRuntimeEnsure,
  onRuntimeSelected,
  onOpenRuntimeSettings
}, ref): React.JSX.Element {
  const initialStateRef = useRef<MemberRuntimeEditorState | null>(null)
  if (!initialStateRef.current) initialStateRef.current = runtimeEditorState(agent, installations)
  const [selectedKind, setSelectedKind] = useState<AdapterKind | ''>(initialStateRef.current.selectedKind)
  const [draft, setDraft] = useState<MemberRuntimeDraft | null>(initialStateRef.current.draft)
  const [baselineStateKey, setBaselineStateKey] = useState(
    () => runtimeEditorStateKey(initialStateRef.current as MemberRuntimeEditorState)
  )
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const agentIdRef = useRef(agent.id)
  const persistedRuntimeKeyRef = useRef(persistedRuntimeKey(agent))
  const currentStateKey = runtimeEditorStateKey({ selectedKind, draft })
  const dirty = currentStateKey !== baselineStateKey
  const availability = runtimeAvailability.find((item) => item.runtimeKind === selectedKind) ?? null
  const installation = useMemo(() => (
    selectedKind
      ? runtimeEditorInstallation(
          installations,
          selectedKind,
          !dirty && selectedKind === agent.runtimeSelection?.adapterKind
            ? agent.runtimePreference?.installationId
            : null
        )
      : null
  ), [
    agent.runtimePreference?.installationId,
    agent.runtimeSelection?.adapterKind,
    dirty,
    installations,
    selectedKind
  ])
  const canSave = dirty && !conflict
  const runtimeStatus = memberRuntimePresentation(
    agent,
    selectedKind || null,
    availability,
    runtimeDiscoveryPending
  )
  const reportedVersion = availability?.reportedVersion
    ?? installation?.snapshot?.reportedVersion
    ?? null

  const resetFromAgent = useCallback((): void => {
    const next = runtimeEditorState(agent, installations)
    setSelectedKind(next.selectedKind)
    setDraft(next.draft)
    setBaselineStateKey(runtimeEditorStateKey(next))
    setSubmitError(null)
    setConflict(false)
    agentIdRef.current = agent.id
    persistedRuntimeKeyRef.current = persistedRuntimeKey(agent)
  }, [agent, installations])

  useImperativeHandle(ref, () => ({ discard: resetFromAgent }), [resetFromAgent])

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    const nextPersistedKey = persistedRuntimeKey(agent)
    if (agentIdRef.current !== agent.id) {
      resetFromAgent()
      return
    }
    if (persistedRuntimeKeyRef.current === nextPersistedKey) return
    persistedRuntimeKeyRef.current = nextPersistedKey
    if (dirty) {
      setConflict(true)
      setSubmitError('已保存的运行配置在编辑期间发生变化。请重新读取后再编辑，或放弃当前更改。')
      return
    }
    resetFromAgent()
  }, [agent, dirty, resetFromAgent])

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
      setBaselineStateKey(currentStateKey)
      setConflict(false)
    } catch (nextError) {
      setSubmitError(errorMessage(nextError))
    }
  }

  return (
    <section className="member-section member-runtime-section">
      <div className="member-section-heading">
        <div>
          <h3>Agent 运行时</h3>
          <p>选择产品并使用当前能力快照配置模型、参数和该 Agent 运行时的原生权限。</p>
        </div>
      </div>

      <form onSubmit={(event) => void submit(event)}>
        <label className="field-label" htmlFor="member-runtime-select">Agent 运行时
          <select
            id="member-runtime-select"
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
              setSubmitError(null)
              setConflict(false)
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
              setSubmitError(null)
            }}
          />
        )}

        {conflict && (
          <div className="member-runtime-conflict" role="alert">
            <strong>运行配置已在其他操作中更新</strong>
            <span>当前草稿没有被覆盖。重新读取会放弃这份草稿，并载入最新保存值。</span>
            <button className="quiet-button" type="button" onClick={resetFromAgent}>重新读取已保存配置</button>
          </div>
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
})

function runtimeEditorState(
  agent: AgentProfile,
  installations: AdapterInstallation[]
): MemberRuntimeEditorState {
  const selectedKind = agent.runtimeSelection?.adapterKind ?? ''
  if (!selectedKind) return { selectedKind: '', draft: null }
  const installation = runtimeEditorInstallation(
    installations,
    selectedKind,
    agent.runtimePreference?.installationId
  )
  return {
    selectedKind,
    draft: runtimeDraftForMember(agent, selectedKind, installation, true)
  }
}

function runtimeEditorStateKey(state: MemberRuntimeEditorState): string {
  return JSON.stringify(state)
}

function persistedRuntimeKey(agent: AgentProfile): string {
  return JSON.stringify({
    selection: agent.runtimeSelection,
    preference: agent.runtimePreference
  })
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

function closeParentDetails(element: HTMLElement): void {
  element.closest('details')?.removeAttribute('open')
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
