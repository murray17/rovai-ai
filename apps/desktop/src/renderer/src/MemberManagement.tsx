import { readErrorMessage } from './error-message'
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
  HostPlatformKey,
  MemberRemovalPreview,
  ProductRuntimeAvailability,
  RuntimePlatformAdmission,
  SetAgentProfileAvatarCommand,
  StoredCommandResult,
  UpdateAgentProfileCommand
} from '@contracts'
import { parseControlledMemberAvatarRef } from '@contracts'
import { MemberAvatar } from './MemberAvatar'
import { MemberAvatarCropper } from './MemberAvatarCropper'
import { MemberPortrait } from './MemberPortrait'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFact,
  AppDialogFactGrid,
  AppDialogFooter,
  AppDialogHeader
} from './AppDialog'
import { localizeExecutionEngineTerms } from './product-copy'
import { SettingsPageHeader } from './SettingsPageHeader'
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
  MemberRuntimeParameters,
  runtimeDraftForMember,
  runtimeEditorInstallation,
  type MemberRuntimeDraft
} from './MemberRuntimeParameters'
import {
  memberRuntimePresentation,
  runtimePlatformAdmissionFor,
  runtimeProductPresentation,
} from './runtime-status'
import { openRuntimeModelCatalog, requestProductRuntimeCheck } from './runtime-check'
import { RuntimeFailureNotice } from './RuntimeFailureNotice'
import {
  type PendingRuntimeSubmission,
  persistedRuntimeChangeDisposition,
  persistedRuntimeConfigurationKey,
  submittedRuntimeConfigurationKey
} from './member-runtime-conflict'
import type { MemberWorkspaceTab } from './MemberSidebar'
import antigravityLogo from './assets/runtime-logos/antigravity-color.svg'
import claudeCodeLogo from './assets/runtime-logos/claudecode-color.svg'
import codeBuddyLogo from './assets/runtime-logos/codebuddy-color.svg'
import codexLogo from './assets/runtime-logos/codex-color.svg'
import copilotLogo from './assets/runtime-logos/copilot-color.svg'
import cursorLogo from './assets/runtime-logos/cursor.svg'
import grokLogo from './assets/runtime-logos/grok.svg'
import deepSeekLogo from './assets/runtime-logos/deepseek-color.svg'
import kiroLogo from './assets/runtime-logos/kiro-color.svg'
import kimiLogo from './assets/runtime-logos/kimi.svg'
import openCodeLogo from './assets/runtime-logos/opencode.svg'
import qoderLogo from './assets/runtime-logos/qoder-color.svg'
import qwenLogo from './assets/runtime-logos/qwen-color.svg'
import traeLogo from './assets/runtime-logos/trae-color.svg'

type MembersViewProps = {
  agents: AgentProfile[]
  topNotices?: ReactNode
  installations: AdapterInstallation[]
  runtimeAvailability: ProductRuntimeAvailability[]
  hostPlatform?: HostPlatformKey | null
  runtimePlatformAdmission?: RuntimePlatformAdmission[]
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
  topNotices,
  installations,
  runtimeAvailability,
  hostPlatform = null,
  runtimePlatformAdmission = [],
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
  const [pendingTransition, setPendingTransition] = useState<GuardedTransition | null>(null)
  const identityReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const avatarReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const removalReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const runtimeFormRef = useRef<MemberRuntimeFormHandle>(null)
  const pendingTransitionRef = useRef<GuardedTransition | null>(null)
  const dirtyRef = useRef(false)
  const selectedAgent = agents.find((agent) => agent.agentId === selectedAgentId) ?? null

  useEffect(() => {
    dirtyRef.current = runtimeDirty
  }, [runtimeDirty])

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
    method: 'members.create' | 'members.update' | 'members.avatar.set' | 'members.runtime.set' | 'members.runtime.clear' | 'members.presence.set' | 'members.remove' | 'members.reorder',
    command: unknown,
    appliedReloadFailurePrefix?: string
  ): Promise<StoredCommandResult> => {
    setBusy(busyKey)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>(method, {
        commandId: crypto.randomUUID(),
        command
      })
      assertApplied(result)
      try {
        await onReload()
      } catch (reloadError) {
        if (!appliedReloadFailurePrefix) throw reloadError
        setError(`${appliedReloadFailurePrefix}：${errorMessage(reloadError)}`)
      }
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
    const method = targetAgent ? 'members.update' : 'members.create'
    const result = await runCommand('identity', method, identity)
    if (!targetAgent) {
      const createdId = result.resultEntity?.entityId ?? stringField(result.payload, 'agentId')
      if (createdId) onSelectedAgentChange(createdId, 'identity')
    }
    closeIdentityDialog()
  }

  const saveAvatar = async (avatarRef: string | null): Promise<void> => {
    if (!selectedAgent) return
    const previousAvatarRef = selectedAgent.avatarRef
    const command: SetAgentProfileAvatarCommand = {
      agentId: selectedAgent.agentId,
      expectedVersion: selectedAgent.version,
      avatarRef
    }
    await runCommand('avatar', 'members.avatar.set', command)
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

  const saveRuntime = async (
    adapterKind: AdapterKind,
    draft: MemberRuntimeDraft | null
  ): Promise<void> => {
    if (!selectedAgent) return
    await runCommand('runtime', 'members.runtime.set', {
      agentId: selectedAgent.agentId,
      expectedVersion: selectedAgent.version,
      adapterKind,
      ...(draft ? {
        model: draft.model,
        permissions: draft.permissions
      } : {})
    }, '运行配置已保存，但页面未能重新载入最新值')
    setNotice(`${adapterLabel(adapterKind)} 已保存。`)
  }

  const clearRuntime = async (): Promise<void> => {
    if (!selectedAgent) return
    await runCommand('runtime-clear', 'members.runtime.clear', {
      agentId: selectedAgent.agentId,
      expectedVersion: selectedAgent.version
    }, '运行配置已清除，但页面未能重新载入最新值')
    setNotice('Agent 运行时已清除。')
  }

  const changePresence = async (presence: 'present' | 'away'): Promise<void> => {
    if (!selectedAgent) return
    await runCommand(`presence-${presence}`, 'members.presence.set', {
      agentId: selectedAgent.agentId,
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
      const preview = await window.rovai.request<MemberRemovalPreview>('members.removalPreview', {
        agentId: selectedAgent.agentId
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
    await runCommand('remove', 'members.remove', {
      agentId: removal.preview.agentId,
      expectedVersion: removal.preview.version,
      confirmationName: removal.displayName
    })
    setNotice(`${removal.displayName} 已移除，历史身份与记录继续保留。`)
    setRemoval(null)
  }

  const discardDrafts = useCallback((): void => {
    runtimeFormRef.current?.discard()
    setRuntimeDirty(false)
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

  const pageNotices = topNotices || error
    ? (
        <div className="member-page-notices">
          {topNotices}
          {error && (
            <div className="inline-error member-page-error" role="alert">
              <strong>队员配置未保存</strong><span>{error}</span>
            </div>
          )}
        </div>
      )
    : null

  return (
    <>
      <section className="members-view">
        {notice && (
          <div className="app-toast" role="status" aria-live="polite">
            <span>{notice}</span>
            <button className="icon-button" type="button" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button>
          </div>
        )}
        <div className="member-detail-scroll">
          <div className="member-detail-page">
            {!selectedAgent && (
              <>
                <MemberEmptyHeader />
                {pageNotices}
                <div className="member-empty">
                  <span aria-hidden="true">◎</span>
                  <h3>建立第一位队员</h3>
                  <p>队员保存长期身份与默认 Agent 运行时；创建后仍需由你明确选择和保存运行配置。</p>
                </div>
              </>
            )}
            {selectedAgent && (
              <>
                <MemberDetailHeader
                  agent={selectedAgent}
                  runtimeAvailability={runtimeAvailability}
                  hostPlatform={hostPlatform}
                  runtimePlatformAdmission={runtimePlatformAdmission}
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
                {pageNotices}
                <MemberTabs
                  value={activeTab}
                  onChange={onTabChange}
                />
                <div id="member-identity-panel" role="tabpanel" aria-labelledby="member-identity-tab" hidden={activeTab !== 'identity'}>
                  <MemberIdentitySummary
                    agent={selectedAgent}
                    busy={busy}
                    onEditAvatar={(trigger) => {
                      avatarReturnFocusRef.current = trigger
                      setAvatarDialogOpen(true)
                    }}
                  />
                </div>
                <div id="member-runtime-panel" role="tabpanel" aria-labelledby="member-runtime-tab" hidden={activeTab !== 'runtime'}>
                  <p className="member-runtime-intro">设置这位队员后续执行使用的 Agent 运行时、模型和权限。保存后仅影响之后开始的新执行。</p>
                  <MemberRuntimeForm
                    ref={runtimeFormRef}
                    agent={selectedAgent}
                    installations={installations}
                    runtimeAvailability={runtimeAvailability}
                    hostPlatform={hostPlatform}
                    runtimePlatformAdmission={runtimePlatformAdmission}
                    runtimeDiscoveryPending={runtimeDiscoveryPending}
                    busy={busy}
                    onDirtyChange={setRuntimeDirty}
                    onSave={saveRuntime}
                    onClear={clearRuntime}
                    onReload={onReload}
                    onOpenRuntimeSettings={onOpenRuntimeSettings}
                  />
                </div>
              </>
            )}
          </div>
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
          <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
          <AppDialogContent
            tone="danger"
            aria-describedby="remove-member-description"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              removalReturnFocusRef.current?.focus()
            }}
          >
            <AppDialogHeader
              title={`永久移除“${removal?.displayName ?? '队员'}”？`}
              description="移除后，这位队员不能再加入后续协作或产生新消息；历史身份与记录继续保留。"
              descriptionId="remove-member-description"
              icon="user"
              kicker="需要名称确认"
              closeDisabled={busy === 'remove'}
            />
            {removal && (
              <>
                <AppDialogBody>
                  <AppDialogFactGrid>
                    <AppDialogFact label="当前会话">{removal.preview.currentCampMembershipCount} 个</AppDialogFact>
                    <AppDialogFact label="未完成任务">{removal.preview.openAssignedTaskCount} 个将释放</AppDialogFact>
                    <AppDialogFact label="默认负责人">{removal.preview.defaultLeadCampCount} 个将重选</AppDialogFact>
                  </AppDialogFactGrid>
                  {removal.preview.nonTerminalAgentRunCount > 0 && (
                    <div className="inline-error app-dialog-blocker" role="alert">仍有 {removal.preview.nonTerminalAgentRunCount} 个未结束的执行，当前不能移除。</div>
                  )}
                  <label className="field-label app-dialog-confirm-field">输入 <code>{removal.displayName}</code> 以确认
                    <input
                      value={removal.confirmationName}
                      onChange={(event) => setRemoval({ ...removal, confirmationName: event.target.value })}
                      autoFocus
                      data-dialog-autofocus
                      autoComplete="off"
                    />
                    <small>区分大小写</small>
                  </label>
                </AppDialogBody>
                <AppDialogFooter note="历史身份、消息与审计记录仍会保留。">
                  <Dialog.Close className="quiet-button" type="button" disabled={busy === 'remove'}>取消</Dialog.Close>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={!removal.preview.removable || removal.confirmationName !== removal.displayName || busy === 'remove'}
                    onClick={() => void confirmRemoval().catch(() => undefined)}
                  >{busy === 'remove' ? '正在移除…' : '永久移除队员'}</button>
                </AppDialogFooter>
              </>
            )}
          </AppDialogContent>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={pendingTransition !== null} onOpenChange={(open) => !open && continueEditing()}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
          <AppDialogContent className="member-leave-dialog" tone="attention" aria-describedby="member-leave-description">
            <AppDialogHeader
              title="放弃未保存的运行配置？"
              description="刚才的操作需要离开当前编辑。放弃后，这些更改不会应用到后续执行。"
              descriptionId="member-leave-description"
              icon="warning"
              kicker="未保存更改"
              closeLabel="继续编辑"
            />
            <AppDialogFooter>
              <button className="quiet-button" type="button" autoFocus data-dialog-autofocus onClick={continueEditing}>继续编辑</button>
              <button className="danger-button" type="button" onClick={() => void discardAndContinue()}>放弃更改</button>
            </AppDialogFooter>
          </AppDialogContent>
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

function MemberEmptyHeader(): React.JSX.Element {
  return (
    <header className="member-detail-header member-detail-header-empty">
      <div className="member-detail-heading">
        <div>
          <h2>队员</h2>
          <p>从左侧选择或创建队员</p>
        </div>
      </div>
    </header>
  )
}

function MemberDetailHeader({
  agent,
  runtimeAvailability,
  hostPlatform,
  runtimePlatformAdmission,
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
  hostPlatform: HostPlatformKey | null
  runtimePlatformAdmission: RuntimePlatformAdmission[]
  runtimeDiscoveryPending: boolean
  busy: string | null
  onEdit(trigger: HTMLButtonElement): void
  onEditAvatar(trigger: HTMLButtonElement): void
  onPresence(presence: 'present' | 'away'): Promise<void>
  onRuntime(): void
  onRemove(trigger: HTMLButtonElement): void
}): React.JSX.Element {
  const availability = runtimeAvailability.find(
    (item) => item.runtimeKind === agent.runtimeConfiguration?.adapterKind
  ) ?? null
  const admission = agent.runtimeConfiguration
    ? runtimePlatformAdmissionFor(
        hostPlatform,
        runtimePlatformAdmission,
        agent.runtimeConfiguration.adapterKind
      )
    : null
  const runtime = memberRuntimePresentation(
    agent,
    agent.runtimeConfiguration?.adapterKind ?? null,
    availability,
    runtimeDiscoveryPending,
    admission,
    hostPlatform !== null
  )
  return (
    <header className="member-detail-header">
      <div className="member-detail-heading">
        <MemberAvatar
          agentId={agent.agentId}
          avatarRef={agent.avatarRef}
          displayName={agent.displayName}
          size="profile"
          decorative
          className="member-detail-avatar"
        />
        <div>
          <h1>{agent.displayName}</h1>
          <p>{agent.teamRole || '团队角色未设置'}</p>
          <div className="member-detail-statuses">
            <span className={`presence-${agent.presence}`}>{memberPresenceLabel(agent.presence)}</span>
            <button
              className={`member-header-runtime status-${runtime.status}`}
              type="button"
              onClick={onRuntime}
              aria-label={`${agent.runtimeConfiguration?.adapterKind ? adapterLabel(agent.runtimeConfiguration.adapterKind) : 'Agent 运行时'}，${runtime.label}；打开运行配置`}
              title="打开运行配置"
            >
              <i aria-hidden="true" />
              <span>{agent.runtimeConfiguration?.adapterKind ? adapterLabel(agent.runtimeConfiguration.adapterKind) : 'Agent 运行时'}</span>
              <strong>{runtime.label}</strong>
              <svg className="member-runtime-entry-arrow" viewBox="0 0 16 16" aria-hidden="true">
                <path d="m6 3.5 4.5 4.5L6 12.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div className="member-detail-actions">
        <button className="quiet-button" type="button" disabled={busy !== null} onClick={(event) => onEdit(event.currentTarget)}>编辑身份</button>
        <details className="member-detail-menu">
          <summary aria-label={`管理 ${agent.displayName}`} title="更多操作">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="4.5" cy="10" r="1" />
              <circle cx="10" cy="10" r="1" />
              <circle cx="15.5" cy="10" r="1" />
            </svg>
          </summary>
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

function MemberIdentitySummary({ agent, busy, onEditAvatar }: {
  agent: AgentProfile
  busy: string | null
  onEditAvatar(trigger: HTMLButtonElement): void
}): React.JSX.Element {
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
          <button
            className="member-portrait-button"
            type="button"
            aria-label={`更换${agent.displayName}的角色图片`}
            title="更换角色图片"
            disabled={busy !== null}
            onClick={(event) => onEditAvatar(event.currentTarget)}
          >
            <MemberPortrait
              agentId={agent.agentId}
              avatarRef={agent.avatarRef}
              displayName={agent.displayName}
              decorative
            />
            <span className="member-portrait-edit" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <path d="M3.5 6.5h2.2l1.1-1.8h6.4l1.1 1.8h2.2v8.8h-13z" />
                <circle cx="10" cy="10.8" r="2.7" />
              </svg>
              <strong>更换角色图片</strong>
            </span>
          </button>
        </div>
      </div>
      {agent.presence === 'away' && <div className="member-status-note" role="status">队员仍属于已有会话；已有执行不会中断，但不会再启动新的执行。</div>}
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

const PRODUCT_RUNTIMES: AdapterKind[] = [
  'claude-code-cli',
  'codex-cli',
  'copilot-cli',
  'opencode-cli',
  'kiro-cli',
  'qoder-cli',
  'codebuddy-cli',
  'qwen-code',
  'trae-cn-cli',
  'cursor-agent',
  'kimi-code-cli',
  'grok-build',
  'antigravity-app'
]

const VISIBLE_PRODUCT_RUNTIMES = PRODUCT_RUNTIMES.filter(
  (runtimeKind) => runtimeKind !== 'cursor-agent'
)

const PRODUCT_RUNTIME_LOGOS: Record<AdapterKind, string> = {
  'claude-code-cli': claudeCodeLogo,
  'codex-cli': codexLogo,
  'copilot-cli': copilotLogo,
  'opencode-cli': openCodeLogo,
  'kiro-cli': kiroLogo,
  'qoder-cli': qoderLogo,
  'codebuddy-cli': codeBuddyLogo,
  'qwen-code': qwenLogo,
  'trae-cn-cli': traeLogo,
  'cursor-agent': cursorLogo,
  'kimi-code-cli': kimiLogo,
  'grok-build': grokLogo,
  'antigravity-app': antigravityLogo
}

type RuntimeCatalogEntry =
  | { state: 'supported'; runtimeKind: AdapterKind }
  | {
      state: 'pending'
      id: 'deepseek-harness'
      label: 'DeepSeek Harness'
      detail: '尚未接入 AgentRun'
      logo: string
    }

const RUNTIME_CATALOG: RuntimeCatalogEntry[] = [
  ...VISIBLE_PRODUCT_RUNTIMES
    .map((runtimeKind) => ({ state: 'supported' as const, runtimeKind })),
  {
    state: 'pending',
    id: 'deepseek-harness',
    label: 'DeepSeek Harness',
    detail: '尚未接入 AgentRun',
    logo: deepSeekLogo
  }
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
  hostPlatform?: HostPlatformKey | null
  runtimePlatformAdmission?: RuntimePlatformAdmission[]
  runtimeDiscoveryPending?: boolean
  busy: string | null
  onDirtyChange?(dirty: boolean): void
  onSave(adapterKind: AdapterKind, draft: MemberRuntimeDraft | null): Promise<void>
  onClear(): Promise<void>
  onReload(): Promise<void>
  onOpenRuntimeSettings(): void
}>(function MemberRuntimeForm({
  agent,
  installations,
  runtimeAvailability,
  hostPlatform = null,
  runtimePlatformAdmission = [],
  runtimeDiscoveryPending = false,
  busy,
  onDirtyChange,
  onSave,
  onClear,
  onReload,
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
  const agentIdRef = useRef(agent.agentId)
  const persistedRuntimeKeyRef = useRef(persistedRuntimeKey(agent))
  const pendingSubmissionRef = useRef<PendingRuntimeSubmission | null>(null)
  const currentStateKey = runtimeEditorStateKey({ selectedKind, draft })
  const dirty = currentStateKey !== baselineStateKey
  const availability = runtimeAvailability.find((item) => item.runtimeKind === selectedKind) ?? null
  const selectedAdmission = selectedKind
    ? runtimePlatformAdmissionFor(hostPlatform, runtimePlatformAdmission, selectedKind)
    : null
  const persistedAdmission = agent.runtimeConfiguration
    ? runtimePlatformAdmissionFor(
        hostPlatform,
        runtimePlatformAdmission,
        agent.runtimeConfiguration.adapterKind
      )
    : null
  const installation = useMemo(() => (
    selectedKind
      ? runtimeEditorInstallation(
          installations,
          selectedKind
        )
      : null
  ), [
    installations,
    selectedKind
  ])
  const runtimeMutationAdmission = selectedKind ? selectedAdmission : persistedAdmission
  const persistedRuntimeLocked = hostPlatform !== null
    && agent.runtimeConfiguration !== null
    && persistedAdmission?.status !== 'qualified'
  const runtimeMutationAllowed = hostPlatform === null
    || (!selectedKind && agent.runtimeConfiguration === null)
    || runtimeMutationAdmission?.status === 'qualified'
  const canSave = dirty
    && !conflict
    && (!selectedKind || draft !== null)
    && runtimeMutationAllowed
  const runtimeStatus = memberRuntimePresentation(
    agent,
    selectedKind || null,
    availability,
    runtimeDiscoveryPending,
    selectedAdmission,
    hostPlatform !== null
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
    agentIdRef.current = agent.agentId
    persistedRuntimeKeyRef.current = persistedRuntimeKey(agent)
    pendingSubmissionRef.current = null
  }, [agent, installations])

  useImperativeHandle(ref, () => ({ discard: resetFromAgent }), [resetFromAgent])

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    const nextPersistedKey = persistedRuntimeKey(agent)
    if (agentIdRef.current !== agent.agentId) {
      resetFromAgent()
      return
    }
    const disposition = persistedRuntimeChangeDisposition({
      previousPersistedKey: persistedRuntimeKeyRef.current,
      nextPersistedKey,
      currentVersion: agent.version,
      pendingSubmission: pendingSubmissionRef.current,
      currentEditorStateKey: currentStateKey,
      dirty
    })
    if (disposition === 'unchanged') return
    persistedRuntimeKeyRef.current = nextPersistedKey
    if (disposition === 'saved_submission') {
      resetFromAgent()
      return
    }
    if (disposition === 'saved_submission_with_newer_draft') {
      const submittedEditorStateKey = pendingSubmissionRef.current?.editorStateKey
      pendingSubmissionRef.current = null
      if (submittedEditorStateKey) setBaselineStateKey(submittedEditorStateKey)
      setConflict(false)
      setSubmitError(null)
      return
    }
    if (disposition === 'external_conflict') {
      pendingSubmissionRef.current = null
      setConflict(true)
      setSubmitError(null)
      return
    }
    resetFromAgent()
  }, [agent, currentStateKey, dirty, resetFromAgent])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!canSave) return
    setSubmitError(null)
    const pendingSubmission: PendingRuntimeSubmission = {
      baseVersion: agent.version,
      persistedKey: submittedRuntimeConfigurationKey(selectedKind, draft),
      editorStateKey: currentStateKey
    }
    pendingSubmissionRef.current = pendingSubmission
    try {
      if (selectedKind) {
        await onSave(selectedKind, draft)
      } else {
        await onClear()
      }
      setBaselineStateKey(currentStateKey)
      setConflict(false)
      setSubmitError(null)
    } catch (nextError) {
      if (pendingSubmissionRef.current === pendingSubmission) {
        pendingSubmissionRef.current = null
      }
      setSubmitError(errorMessage(nextError))
    }
  }

  return (
    <section className="member-section member-runtime-section">
      <div className="member-section-heading">
        <div>
          <h3>运行时</h3>
          <p>选择执行产品，并确认当前安装与可用状态。</p>
        </div>
      </div>

      <form className="member-runtime-form" onSubmit={(event) => void submit(event)}>
        <div className="member-runtime-primary">
          <label className="field-label" htmlFor="member-runtime-select">Agent 运行时
          <select
            id="member-runtime-select"
            value={selectedKind}
            disabled={busy !== null || persistedRuntimeLocked}
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
            }}
          >
            <option value="">不选择 Agent 运行时</option>
            {VISIBLE_PRODUCT_RUNTIMES.map((kind) => (
              <option
                key={kind}
                value={kind}
                disabled={hostPlatform !== null && runtimePlatformAdmissionFor(
                  hostPlatform,
                  runtimePlatformAdmission,
                  kind
                )?.status !== 'qualified'}
              >{adapterLabel(kind)}</option>
            ))}
          </select>
          </label>

          <div className={`runtime-installation-summary status-${runtimeStatus.status}`} role="status" aria-live="polite">
            <div className="runtime-installation-primary">
              <em className={`runtime-user-status status-${runtimeStatus.status}`}>
                <i aria-hidden="true" />
                <strong>{selectedKind ? adapterLabel(selectedKind) : runtimeStatus.label}</strong>
                {selectedKind && <span>{runtimeStatus.label}</span>}
              </em>
              {reportedVersion && <code>{reportedVersion}</code>}
            </div>
            {runtimeStatus.detail && <small className="runtime-status-detail">{runtimeStatus.detail}</small>}
            {selectedKind && (
              runtimeStatus.status === 'not_installed'
              || runtimeStatus.status === 'authentication_required'
              || runtimeStatus.status === 'version_unsupported'
              || runtimeStatus.status === 'unavailable'
            ) && (
              <div className="runtime-installation-action">
                <button className="quiet-button" type="button" onClick={onOpenRuntimeSettings}>
                  前往 Agent 运行时
                </button>
              </div>
            )}
          </div>
        </div>
        <span className="field-help member-runtime-help">运行时、模型与权限会作为一份配置共同保存。</span>

        {selectedKind && (
          <MemberRuntimeParameters
            adapterKind={selectedKind}
            installation={installation}
            draft={draft}
            disabled={busy !== null || !runtimeMutationAllowed}
            onOpenModelCatalog={async () => {
              const catalog = await openRuntimeModelCatalog(selectedKind)
              await onReload()
              return catalog
            }}
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
          <span className={`member-runtime-save-state ${dirty ? 'is-dirty' : ''}`}>
            {!runtimeMutationAllowed
              ? '当前平台仅可查看这份配置'
              : dirty ? '有未保存更改' : '当前配置已保存'}
          </span>
          <div>
            <button className="quiet-button" type="button" disabled={!dirty || busy !== null} onClick={resetFromAgent}>
              放弃更改
            </button>
            <button className="primary-button" disabled={!canSave || busy !== null}>
              {busy === 'runtime' || busy === 'runtime-clear' ? '正在保存…' : '保存运行配置'}
            </button>
          </div>
        </div>
      </form>
    </section>
  )
})

function runtimeEditorState(
  agent: AgentProfile,
  installations: AdapterInstallation[]
): MemberRuntimeEditorState {
  const selectedKind = agent.runtimeConfiguration?.adapterKind ?? ''
  if (!selectedKind) return { selectedKind: '', draft: null }
  const installation = runtimeEditorInstallation(
    installations,
    selectedKind
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
  return persistedRuntimeConfigurationKey(agent.runtimeConfiguration)
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
  }, [agent?.agentId, open])

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
    const issue = identityDraftIssue(nextDraft, agent?.agentId ?? null, agents)
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
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent
          className="member-dialog"
          width="wide"
          aria-describedby="member-dialog-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocusRef.current?.focus()
          }}
        >
          <AppDialogHeader
            title={agent ? '编辑队员身份' : '新增队员'}
            description={agent
              ? '更新这位队员的长期身份信息；不会直接改动 Agent 运行时、权限或记忆。'
              : '设置新队员的长期身份信息；Agent 运行时与权限将在创建后单独配置。'}
            descriptionId="member-dialog-description"
            icon="user"
            closeLabel="关闭身份编辑"
            closeDisabled={busy}
          />
          <form className="member-identity-form app-dialog-form" onSubmit={(event) => void submit(event)}>
            <AppDialogBody className="member-dialog-scroll">
              <section className="member-identity-editor" aria-label="队员身份字段">
                <div className="member-form-grid">
                  <label className="field-label">名称<input ref={nameRef} required value={draft.displayName} onChange={(event) => { setDraft({ ...draft, displayName: event.target.value }); setSubmitError(null) }} autoFocus data-dialog-autofocus /><small>{unicodeScalarLength(draft.displayName)}/80</small></label>
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
            </AppDialogBody>
            <AppDialogFooter note="身份变更会用于之后符合条件的新执行。">
              <Dialog.Close className="quiet-button" type="button" disabled={busy}>取消</Dialog.Close>
              <button className="primary-button" disabled={busy || !draft.displayName.trim()}>{busy ? '正在保存身份…' : agent ? '保存身份' : '创建队员'}</button>
            </AppDialogFooter>
          </form>
        </AppDialogContent>
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
  }, [agent?.agentId, open])

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
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent className="member-avatar-dialog" width="wide" aria-describedby="member-avatar-dialog-description" onCloseAutoFocus={(event) => { event.preventDefault(); returnFocusRef.current?.focus() }}>
          <AppDialogHeader
            title="更换角色图片"
            description="图片单独保存，不会改动队员身份、Agent 运行时、权限或记忆。"
            descriptionId="member-avatar-dialog-description"
            icon="image"
            closeLabel="关闭角色图片编辑"
            closeDisabled={isBusy}
          />
          <form className="app-dialog-form" onSubmit={(event) => void submit(event)}>
            <AppDialogBody>
              <section className="member-avatar-editor" aria-label="角色图片">
                <div className="member-avatar-editor-heading"><div><strong>当前图片</strong><span>可裁剪自定义图片，或选择内置队员外观</span></div></div>
                {sourceUrl && avatarSource
                  ? <MemberAvatarCropper sourceUrl={sourceUrl} sourceWidth={avatarSource.width} sourceHeight={avatarSource.height} value={avatarSource.crop} disabled={isBusy} onChange={(crop) => setAvatarSource({ ...avatarSource, crop, needsSave: true })} />
                  : <div className="member-avatar-current"><MemberAvatar agentId={agent?.agentId ?? 'avatar-draft'} avatarRef={avatarRef} displayName={agent?.displayName ?? '队员'} size={parsedAvatar?.kind === 'builtin' ? 'bust' : 'picker'} /><div><strong>{avatarBusy === 'loading' ? '正在读取原图…' : parsedAvatar?.kind === 'builtin' ? '内置队员外观' : parsedAvatar?.kind === 'managed' ? '受管角色图片' : avatarRef ? '已有图片' : '字符头像'}</strong><span>没有图片时使用名称的首个字符。</span></div></div>}
                <button className="quiet-button member-avatar-browse" type="button" disabled={isBusy} onClick={() => void chooseImage()}>{avatarBusy === 'choosing' ? '正在处理图片…' : avatarSource ? '替换图片…' : '选择一张图片…'}</button>
                <p className="field-help">支持静态 PNG/JPEG，文件不超过 10 MiB；保存时移除原始元数据。</p>
                <div className="member-preset-heading"><strong>内置队员外观</strong><span>只替换角色图片</span></div>
                <div className="member-preset-list member-avatar-preset-list">{BUILTIN_MEMBER_PRESETS.map((preset) => <button key={preset.role} className={`member-preset-card ${avatarRef === preset.avatarRef ? 'selected' : ''}`} type="button" disabled={isBusy} aria-pressed={avatarRef === preset.avatarRef} onClick={() => selectBuiltin(preset)}><MemberAvatar agentId={`preset-${preset.role}`} avatarRef={preset.avatarRef} displayName={preset.displayName} size="bust" decorative /><span className="member-preset-copy"><strong>{preset.displayName}</strong><small>{preset.teamRole}</small></span></button>)}</div>
              </section>
              {avatarError && <div className="inline-error" role="alert">{avatarError}</div>}
            </AppDialogBody>
            <AppDialogFooter leading={(avatarRef || avatarSource) && <button className="quiet-button" type="button" disabled={isBusy} onClick={() => { setAvatarRef(null); setAvatarSource(null); setAvatarError(null) }}>移除图片</button>}>
              <Dialog.Close className="quiet-button" type="button" disabled={isBusy}>取消</Dialog.Close>
              <button className="primary-button" disabled={isBusy}>{avatarBusy === 'saving' || busy ? '正在保存图片…' : '保存图片'}</button>
            </AppDialogFooter>
          </form>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function RuntimeInstallationsPanel({ health, onReload }: {
  health: HealthStatus | null
  installations: AdapterInstallation[]
  onReload(): Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const availability = health?.runtimeAvailability ?? []
  const hasQualifiedRuntime = health?.runtimePlatformAdmission.some((row) => (
    row.platform === health.hostPlatform && row.status === 'qualified'
  )) ?? false

  const checkProduct = async (runtimeKind: AdapterKind): Promise<void> => {
    setBusy(`check-${runtimeKind}`)
    setError(null)
    try {
      await requestProductRuntimeCheck(runtimeKind)
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

  return (
    <>
      <SettingsPageHeader
        eyebrow="Settings / Runtime"
        title="Agent 运行时"
        description="管理本机 Agent 运行时及其可用状态。"
        aside={(
          <button className="quiet-button" disabled={busy !== null || (health !== null && !hasQualifiedRuntime)} onClick={() => void rescan()}>
            {busy === 'rescan'
              ? '正在重新检测…'
              : health === null
                ? '重新检测全部'
                : hasQualifiedRuntime ? '重新检测全部' : '当前平台尚无可检测 Runtime'}
          </button>
        )}
      />
      <section className="section-block runtime-installations">
        <div className="section-heading">
          <div><h2>Agent 运行时目录</h2></div>
        </div>

        <div className="runtime-product-list">
          {RUNTIME_CATALOG.map((entry) => {
            if (entry.state === 'pending') {
              return (
                <article key={entry.id} className="runtime-product-row">
                  <span className="runtime-product-logo" aria-hidden="true">
                    <img src={entry.logo} alt="" />
                  </span>
                  <div className="runtime-product-copy">
                    <strong>{entry.label}</strong>
                    <small>{entry.detail}</small>
                  </div>
                  <span className="runtime-snapshot-badge runtime-product-status status-unknown">
                    待支持
                  </span>
                  <button className="quiet-button runtime-product-check" type="button" disabled>
                    尚未开放
                  </button>
                </article>
              )
            }
            const runtimeKind = entry.runtimeKind
            const item = availability.find((candidate) => candidate.runtimeKind === runtimeKind)
            const admission = runtimePlatformAdmissionFor(
              health?.hostPlatform ?? null,
              health?.runtimePlatformAdmission ?? [],
              runtimeKind
            )
            const presentation = runtimeProductPresentation(
              admission,
              item ?? null,
              health === null
            )
            const discoveryDiagnostic = item
              ? runtimeDiscoveryDiagnostic(item.discovery)
              : null
            return (
              <article key={runtimeKind} className="runtime-product-row">
                <span className="runtime-product-logo" aria-hidden="true">
                  <img src={PRODUCT_RUNTIME_LOGOS[runtimeKind]} alt="" />
                </span>
                <div className="runtime-product-copy">
                  <strong>{adapterLabel(runtimeKind)}</strong>
                  <small>{admission?.status !== 'qualified'
                    ? presentation.detail
                    : item?.reportedVersion ?? adapterMaturityLabel(runtimeKind)}</small>
                  {discoveryDiagnostic && (
                    <small className="runtime-discovery-diagnostic">{discoveryDiagnostic}</small>
                  )}
                </div>
                <span className={`runtime-snapshot-badge runtime-product-status status-${presentation.status}`}>
                  {presentation.label}
                </span>
                <button className="quiet-button runtime-product-check" disabled={busy !== null || admission?.status !== 'qualified'} onClick={() => void checkProduct(runtimeKind)}>
                  {busy === `check-${runtimeKind}`
                    ? '正在检查…'
                    : admission?.status === 'qualified' ? '检查可用性' : '不可检查'}
                </button>
                {item?.failure && <RuntimeFailureNotice failure={item.failure} />}
              </article>
            )
          })}
        </div>
        {error && <div className="inline-error" role="alert">{error}</div>}
      </section>
    </>
  )
}

function runtimeDiscoveryDiagnostic(
  discovery: ProductRuntimeAvailability['discovery']
): string | null {
  if (!discovery.entrypointKind || !discovery.candidateExtension) return null
  const source = discovery.searchPathSource ?? discovery.source ?? 'unknown'
  const target = discovery.resolvedNativeTarget ? '已解析' : '未解析'
  const versionProbe = discovery.versionProbeSucceeded === true
    ? '成功'
    : discovery.versionProbeSucceeded === false ? '失败' : '未运行'
  const extension = discovery.candidateExtension === 'native'
    ? 'native'
    : `.${discovery.candidateExtension}`
  return `来源 ${source} · 入口 ${discovery.entrypointKind} · 后缀 ${extension} · Native 目标 ${target} · Version Probe ${versionProbe}`
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
  return agent ? { ...identity, agentId: agent.agentId, expectedVersion: agent.version } : identity
}

type IdentityDraftField = keyof IdentityDraft | 'advanced'

function identityDraftIssue(
  draft: IdentityDraft,
  currentAgentId: string | null,
  agents: Pick<AgentProfile, 'agentId' | 'displayName'>[]
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
  agents: Pick<AgentProfile, 'agentId' | 'displayName'>[]
): boolean {
  const normalized = normalizeMemberDisplayName(displayName)
  return normalized !== '' && agents.some((candidate) =>
    candidate.agentId !== currentAgentId
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
    'agent_profile.default_lead_successor_required': '该队员仍是某个会话的默认负责人，请先在对应会话中指定继任者',
    'adapter_installation.already_exists': '这个 Agent 运行时已经存在',
    'adapter_installation.version_conflict': 'Agent 运行时已被更新，请刷新后重试'
  } as Record<string, string>)[code] ?? `操作未完成：${code}`
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
    'trae-cn-cli': 'TRAE CLI',
    'cursor-agent': 'Cursor Agent',
    'kimi-code-cli': 'Kimi Code',
    'grok-build': 'Grok Build',
    'antigravity-app': 'Antigravity'
  })[kind]
}

function adapterMaturityLabel(kind: AdapterKind): string {
  return ({
    'codex-cli': '稳定',
    'opencode-cli': '测试',
    'copilot-cli': '测试',
    'claude-code-cli': '测试',
    'kiro-cli': '实验性',
    'qoder-cli': '实验性',
    'codebuddy-cli': '实验性',
    'qwen-code': '实验性',
    'trae-cn-cli': '实验性',
    'cursor-agent': '实验性',
    'kimi-code-cli': '实验性',
    'grok-build': '实验性',
    'antigravity-app': '实验性'
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
  return localizeExecutionEngineTerms(readErrorMessage(error))
}
