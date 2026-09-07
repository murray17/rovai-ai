import { readErrorMessage } from './error-message'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Menu from '@radix-ui/react-dropdown-menu'
import type {
  AdapterInstallation,
  AdapterKind,
  AgentProfile,
  HealthStatus,
  HostPlatformKey,
  MemberRemovalPreview,
  ProductRuntimeAvailability,
  RuntimePlatformAdmission,
  StoredCommandResult
} from '@contracts'
import { parseControlledMemberAvatarRef } from '@contracts'
import { MemberAvatar } from './MemberAvatar'
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
import { invalidateManagedAvatarObjectUrl } from './managed-avatar-cache'
import {
  MemberRuntimeParameters,
  runtimeDraftForMember,
  runtimeEditorInstallation,
  type MemberRuntimeDraft
} from './MemberRuntimeParameters'
import {
  memberRuntimePresentation,
  runtimePlatformAdmissionAllowsUse,
  runtimePlatformAdmissionFor,
  runtimeProductPresentation
} from './runtime-status'
import {
  openRuntimeModelCatalog,
  requestProductRuntimeCheck
} from './runtime-check'
import { RuntimeFailureNotice } from './RuntimeFailureNotice'
import {
  type PendingRuntimeSubmission,
  persistedRuntimeChangeDisposition,
  persistedRuntimeConfigurationKey,
  submittedRuntimeConfigurationKey
} from './member-runtime-conflict'
import type { MemberWorkspaceTab } from './MemberSidebar'
import deepSeekLogo from './assets/runtime-logos/deepseek-color.svg'
import {
  VISIBLE_PRODUCT_RUNTIMES,
  PRODUCT_RUNTIME_LOGOS,
  adapterLabel
} from './runtime-products'
import { MemberRuntimePicker } from './MemberRuntimePicker'

import { MemberSidebar } from './MemberSidebar'
import {
  MemberIdentityEditor,
  type MemberIdentityEditorHandle
} from './MemberIdentityEditor'
import { saveMemberIdentity } from './member-identity-save'
import type { IdentityDraft } from './member-identity-draft'
export { hasDuplicateMemberDisplayName } from './member-identity-draft'

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
  onProfileCommitted?(profile: AgentProfile): void
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

type MemberEditorHandle = { discard(): void }

export const MembersView = forwardRef<MembersViewHandle, MembersViewProps>(
  function MembersView(props, ref) {
    const { agents, selectedAgentId, onSelectedAgentChange } = props
    const [visited, setVisited] = useState<string[]>([])
    const [hasNewDraft, setHasNewDraft] = useState(false)
    const [creating, setCreating] = useState(false)
    const creatingRef = useRef(creating)
    creatingRef.current = creating
    const [runtimeFocus, setRuntimeFocus] = useState(0)
    const [states, setStates] = useState<
      Record<string, { dirty: boolean; busy: boolean }>
    >({})
    const [pending, setPending] = useState<GuardedTransition | null>(null)
    const pendingRef = useRef<GuardedTransition | null>(null)
    const editors = useRef(new Map<string, MemberEditorHandle>())
    const liveMembers = agents.filter(
      (agent) => agent.presence !== 'removed' && agent.removedAt === null
    )
    const ids = [
      ...new Set([...visited, ...(selectedAgentId ? [selectedAgentId] : [])])
    ].filter((id) => liveMembers.some((agent) => agent.agentId === id))
    useEffect(() => {
      if (selectedAgentId)
        setVisited((current) =>
          current.includes(selectedAgentId)
            ? current
            : [...current, selectedAgentId]
        )
    }, [selectedAgentId])
    const activeStates = Object.entries(states)
      .filter(([id]) =>
        id === 'new-member'
          ? hasNewDraft
          : liveMembers.some((agent) => agent.agentId === id)
      )
      .map(([, state]) => state)
    const dirty = hasNewDraft || activeStates.some((state) => state.dirty)
    const busy = activeStates.some((state) => state.busy)
    const stateRef = useRef({ dirty, busy })
    stateRef.current = { dirty, busy }
    const select = (
      id: string,
      tab: MemberWorkspaceTab,
      focusRuntime = false
    ): void => {
      setCreating(false)
      onSelectedAgentChange(id, tab)
      if (focusRuntime) setRuntimeFocus((value) => value + 1)
    }
    const create = (): void => {
      setHasNewDraft(true)
      setCreating(true)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLInputElement>(
            '.member-editor-page:not([hidden]) .member-identity-form input'
          )
          ?.focus()
      )
    }
    const updateState = useCallback(
      (id: string, dirty: boolean, busy: boolean): void => {
        setStates((current) =>
          current[id]?.dirty === dirty && current[id]?.busy === busy
            ? current
            : { ...current, [id]: { dirty, busy } }
        )
      },
      []
    )
    const requestTransition = useCallback(
      (
        action: () => void | Promise<void>,
        returnFocus: HTMLElement | null = document.activeElement instanceof
        HTMLElement
          ? document.activeElement
          : null
      ): Promise<boolean> => {
        if (stateRef.current.busy || pendingRef.current)
          return Promise.resolve(false)
        if (!stateRef.current.dirty)
          return Promise.resolve()
            .then(action)
            .then(() => true)
        return new Promise((resolve) => {
          const next = { action, resolve, returnFocus }
          pendingRef.current = next
          setPending(next)
        })
      },
      []
    )
    useImperativeHandle(ref, () => ({
      requestTransition,
      requestCreate: create
    }))
    useEffect(() => {
      const guard = (event: BeforeUnloadEvent): void => {
        if (stateRef.current.dirty || stateRef.current.busy) {
          event.preventDefault()
          event.returnValue = ''
        }
      }
      window.addEventListener('beforeunload', guard)
      return () => {
        window.removeEventListener('beforeunload', guard)
        pendingRef.current?.resolve(false)
      }
    }, [])
    const continueEditing = (): void => {
      const value = pendingRef.current
      pendingRef.current = null
      setPending(null)
      value?.resolve(false)
      requestAnimationFrame(() => value?.returnFocus?.focus())
    }
    const discardAndContinue = async (): Promise<void> => {
      const value = pendingRef.current
      if (!value || busy) return
      pendingRef.current = null
      setPending(null)
      editors.current.forEach((editor) => editor.discard())
      setHasNewDraft(false)
      setCreating(false)
      try {
        await value.action()
        value.resolve(true)
      } catch {
        value.resolve(false)
      }
    }
    return (
      <>
        <div className="member-editor-roster-shell">
          <MemberSidebar
            agents={agents}
            runtimeAvailability={props.runtimeAvailability}
            hostPlatform={props.hostPlatform}
            runtimePlatformAdmission={props.runtimePlatformAdmission}
            runtimeDiscoveryPending={props.runtimeDiscoveryPending}
            selectedAgentId={creating ? null : selectedAgentId}
            dirtyAgentIds={
              new Set(
                Object.entries(states)
                  .filter(([, value]) => value.dirty)
                  .map(([id]) => id)
              )
            }
            onSelect={select}
            onCreate={create}
            onReload={props.onReload}
          />
          {hasNewDraft && (
            <button
              type="button"
              className={`member-editor-draft-row ${creating ? 'is-selected' : ''}`}
              aria-label="继续编辑新队员草稿"
              aria-current={creating ? 'true' : undefined}
              onClick={create}
            >
              <MemberAvatar
                agentId="new-member"
                avatarRef={null}
                displayName="新队员"
                size="list"
                decorative
              />
              <span>
                新队员草稿<small>尚未创建</small>
              </span>
            </button>
          )}
        </div>
        <section className="members-view member-editor-view">
          {ids.map((id) => (
            <div
              key={id}
              className="member-editor-page"
              hidden={creating || selectedAgentId !== id}
            >
              <MemberEditor
                {...props}
                selectedAgentId={id}
                active={!creating && selectedAgentId === id}
                runtimeFocusRequest={props.runtimeFocusRequest + runtimeFocus}
                ref={(value) => {
                  if (value) editors.current.set(id, value)
                  else editors.current.delete(id)
                }}
                onStateChange={updateState}
                onCreated={(profile) => select(profile.agentId, 'identity')}
                onDiscardNew={() => undefined}
              />
            </div>
          ))}
          {hasNewDraft && (
            <div className="member-editor-page" hidden={!creating}>
              <MemberEditor
                {...props}
                selectedAgentId={null}
                active={creating}
                ref={(value) => {
                  if (value) editors.current.set('new-member', value)
                  else editors.current.delete('new-member')
                }}
                onStateChange={updateState}
                onCreated={(profile) => {
                  setHasNewDraft(false)
                  if (creatingRef.current) select(profile.agentId, 'identity')
                }}
                onDiscardNew={() => {
                  setHasNewDraft(false)
                  setCreating(false)
                }}
              />
            </div>
          )}
          {!creating && !ids.includes(selectedAgentId ?? '') && (
            <div className="member-editor-empty">
              {props.topNotices}
              <h1>建立第一位队员</h1>
              <p>从名称和职责开始，运行配置可以稍后补充。</p>
              <button
                className="member-editor-primary"
                type="button"
                onClick={create}
              >
                新增队员
              </button>
            </div>
          )}
        </section>
        <Dialog.Root
          open={pending !== null}
          onOpenChange={(open) => !open && continueEditing()}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
            <AppDialogContent
              className="member-leave-dialog"
              tone="attention"
              aria-describedby="member-leave-description"
            >
              <AppDialogHeader
                title="放弃未保存的队员配置？"
                description="队员信息或运行配置尚未保存，离开后这些修改将丢失。"
                descriptionId="member-leave-description"
                icon="warning"
                closeLabel="继续编辑"
              />
              <AppDialogFooter>
                <button
                  className="quiet-button"
                  type="button"
                  autoFocus
                  data-dialog-autofocus
                  onClick={continueEditing}
                >
                  继续编辑
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void discardAndContinue()}
                >
                  放弃更改
                </button>
              </AppDialogFooter>
            </AppDialogContent>
          </Dialog.Portal>
        </Dialog.Root>
      </>
    )
  }
)

const MemberEditor = forwardRef<
  MemberEditorHandle,
  MembersViewProps & {
    active: boolean
    onStateChange(id: string, dirty: boolean, busy: boolean): void
    onCreated(profile: AgentProfile): void
    onDiscardNew(): void
  }
>(function MemberEditor(
  {
    agents,
    topNotices,
    installations,
    runtimeAvailability,
    hostPlatform = null,
    runtimePlatformAdmission = [],
    runtimeDiscoveryPending,
    selectedAgentId,
    activeTab,
    active,
    runtimeFocusRequest,
    onTabChange,
    onReload,
    onProfileCommitted,
    onOpenRuntimeSettings,
    onStateChange,
    onCreated,
    onDiscardNew
  },
  ref
) {
  const activeRef = useRef(active)
  activeRef.current = active
  const authoritative =
    agents.find((agent) => agent.agentId === selectedAgentId) ?? null
  const [accepted, setAccepted] = useState<AgentProfile | null>(null)
  const selectedAgent =
    accepted && (!authoritative || accepted.version > authoritative.version)
      ? accepted
      : authoritative
  const [removal, setRemoval] = useState<{
    preview: MemberRemovalPreview
    displayName: string
    confirmationName: string
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [identityDirty, setIdentityDirty] = useState(false)
  const [runtimeDirty, setRuntimeDirty] = useState(false)
  const [draftAvatar, setDraftAvatar] = useState(
    selectedAgent?.avatarRef ?? null
  )
  const identityRef = useRef<MemberIdentityEditorHandle>(null)
  const runtimeRef = useRef<MemberRuntimeFormHandle>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const removalReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  useImperativeHandle(ref, () => ({
    discard: () => {
      identityRef.current?.discard()
      runtimeRef.current?.discard()
    }
  }))
  useEffect(() => {
    onStateChange(
      selectedAgentId ?? 'new-member',
      identityDirty || runtimeDirty,
      busy !== null
    )
  }, [selectedAgentId, identityDirty, runtimeDirty, busy, onStateChange])
  const openRuntime = (): void => {
    onTabChange('runtime')
    requestAnimationFrame(() => {
      const control = pageRef.current?.querySelector<HTMLButtonElement>(
        '[data-member-runtime-select]'
      )
      control?.scrollIntoView({ block: 'center' })
      control?.focus({ preventScroll: true })
    })
  }
  useEffect(() => {
    if (!active) return
    if (activeTab === 'runtime') openRuntime()
    else pageRef.current?.scrollTo({ top: 0 })
  }, [active, runtimeFocusRequest])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3200)
    return () => clearTimeout(timer)
  }, [notice])
  const runCommand = async (
    busyKey: string,
    method:
      | 'members.create'
      | 'members.update'
      | 'members.avatar.set'
      | 'members.runtime.set'
      | 'members.runtime.clear'
      | 'members.presence.set'
      | 'members.remove'
      | 'members.reorder',
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
      const version = result.payload.version
      if (selectedAgent && typeof version === 'number') {
        const next = { ...selectedAgent, version }
        if (method === 'members.runtime.clear') next.runtimeConfiguration = null
        if (method === 'members.runtime.set') {
          const input = command as {
            adapterKind: AdapterKind
            model: import('@contracts').ModelSelection
            permissions: import('@contracts').AdapterPermissionConfig
          }
          next.runtimeConfiguration = {
            adapterKind: input.adapterKind,
            model: input.model,
            permissions: input.permissions
          }
        }
        if (method === 'members.presence.set')
          next.presence = (command as { presence: 'present' | 'away' }).presence
        setAccepted(next)
      }
      try {
        await onReload()
      } catch (reloadError) {
        if (!appliedReloadFailurePrefix) throw reloadError
        setError(`${appliedReloadFailurePrefix}：${errorMessage(reloadError)}`)
      }
      return result
    } catch (nextError) {
      if (!busyKey.startsWith('runtime')) setError(errorMessage(nextError))
      throw nextError
    } finally {
      setBusy(null)
    }
  }

  const closeRemovalDialog = (): void => setRemoval(null)
  const saveRuntime = async (
    adapterKind: AdapterKind,
    draft: MemberRuntimeDraft | null
  ): Promise<void> => {
    if (!selectedAgent) return
    await runCommand(
      'runtime',
      'members.runtime.set',
      {
        agentId: selectedAgent.agentId,
        expectedVersion: selectedAgent.version,
        adapterKind,
        ...(draft
          ? {
              model: draft.model,
              permissions: draft.permissions
            }
          : {})
      },
      '运行配置已保存，但页面未能重新载入最新值'
    )
  }

  const clearRuntime = async (): Promise<void> => {
    if (!selectedAgent) return
    await runCommand(
      'runtime-clear',
      'members.runtime.clear',
      {
        agentId: selectedAgent.agentId,
        expectedVersion: selectedAgent.version
      },
      '运行配置已清除，但页面未能重新载入最新值'
    )
  }

  const changePresence = async (
    presence: 'present' | 'away'
  ): Promise<void> => {
    if (!selectedAgent) return
    await runCommand(`presence-${presence}`, 'members.presence.set', {
      agentId: selectedAgent.agentId,
      expectedVersion: selectedAgent.version,
      presence
    })
    setNotice(
      presence === 'present'
        ? `${selectedAgent.displayName} 已归队。`
        : `${selectedAgent.displayName} 已暂离。`
    )
  }

  const previewRemoval = async (trigger: HTMLButtonElement): Promise<void> => {
    if (!selectedAgent) return
    removalReturnFocusRef.current = trigger
    setBusy('remove-preview')
    setError(null)
    try {
      const preview = await window.rovai.request<MemberRemovalPreview>(
        'members.removalPreview',
        {
          agentId: selectedAgent.agentId
        }
      )
      if (activeRef.current)
        setRemoval({
          preview,
          displayName: selectedAgent.displayName,
          confirmationName: ''
        })
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

  const saveIdentity = async (
    draft: IdentityDraft,
    avatarRef: string | null,
    onCommitted: (profile: AgentProfile) => void
  ): Promise<AgentProfile> => {
    setBusy('identity')
    setError(null)
    try {
      const profile = await saveMemberIdentity({
        agent: selectedAgent,
        draft,
        avatarRef,
        request: (method, command) =>
          window.rovai.request<StoredCommandResult>(method, {
            commandId: crypto.randomUUID(),
            command
          }),
        onCommitted: (profile) => {
          const next = selectedAgent
            ? profile
            : {
                ...profile,
                memberOrder:
                  Math.max(-1, ...agents.map((agent) => agent.memberOrder)) + 1
              }
          onCommitted(next)
          setAccepted(next)
          onProfileCommitted?.(next)
        }
      })
      if (
        selectedAgent?.avatarRef &&
        selectedAgent.avatarRef !== profile.avatarRef &&
        parseControlledMemberAvatarRef(selectedAgent.avatarRef)?.kind ===
          'managed'
      )
        await invalidateManagedAvatarObjectUrl(selectedAgent.avatarRef)
      try {
        await onReload()
      } catch (issue) {
        setNotice(`队员信息已保存，列表暂未刷新：${errorMessage(issue)}`)
      }
      if (!selectedAgentId) onCreated(profile)
      return profile
    } catch (issue) {
      void onReload().catch(() => undefined)
      throw issue
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <div className="member-detail-scroll" ref={pageRef}>
        <div className="member-detail-page">
          {selectedAgent ? (
            <MemberDetailHeader
              agent={{ ...selectedAgent, avatarRef: draftAvatar }}
              runtimeAvailability={runtimeAvailability}
              hostPlatform={hostPlatform}
              runtimePlatformAdmission={runtimePlatformAdmission}
              runtimeDiscoveryPending={runtimeDiscoveryPending}
              busy={busy}
              onEditAvatar={() => {
                identityRef.current?.openAvatar()
                requestAnimationFrame(() =>
                  pageRef.current
                    ?.querySelector('.member-editor-avatar-editor')
                    ?.scrollIntoView({ block: 'center' })
                )
              }}
              onPresence={changePresence}
              onRuntime={openRuntime}
              onRemove={(trigger) => void previewRemoval(trigger)}
            />
          ) : (
            <header className="member-detail-header member-editor-member-header">
              <div className="member-detail-heading">
                <MemberAvatar
                  agentId="new-member"
                  avatarRef={draftAvatar}
                  displayName="新队员"
                  size="profile"
                  decorative
                />
                <div>
                  <h1>新增队员</h1>
                  <p>设置这位队员的长期身份</p>
                </div>
              </div>
            </header>
          )}
          {notice && (
            <p className="member-editor-inline-notice" role="status">
              {notice}
            </p>
          )}
          {topNotices}
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <MemberIdentityEditor
            ref={identityRef}
            agent={selectedAgent}
            agents={agents}
            busy={busy !== null}
            onDirtyChange={setIdentityDirty}
            onAvatarChange={setDraftAvatar}
            onDiscardNew={onDiscardNew}
            onSubmit={saveIdentity}
          />
          <section
            className="member-editor-section member-editor-runtime"
            aria-label="运行配置"
          >
            <div className="member-editor-section-heading">
              <h2>运行配置</h2>
              {selectedAgent && <span>用于之后开始的新执行</span>}
            </div>
            {selectedAgent ? (
              <MemberRuntimeForm
                ref={runtimeRef}
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
            ) : (
              <p className="member-editor-new-runtime">
                创建队员后，可在这里选择 Agent 运行时、模型与权限。
              </p>
            )}
          </section>
        </div>
      </div>
      <Dialog.Root
        open={removal !== null}
        onOpenChange={(open) =>
          !open && busy !== 'remove' && closeRemovalDialog()
        }
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
          <AppDialogContent
            tone="danger"
            aria-describedby="remove-member-description"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              if (removalReturnFocusRef.current?.isConnected)
                removalReturnFocusRef.current.focus()
              else
                document
                  .querySelector<HTMLButtonElement>(
                    '.member-sidebar-select[aria-current=true]'
                  )
                  ?.focus()
            }}
          >
            <AppDialogHeader
              title={`永久移除“${removal?.displayName ?? '队员'}”？`}
              description="移除后将不能继续参与协作；历史身份与记录保留。"
              descriptionId="remove-member-description"
              icon="user"
              kicker="需要名称确认"
              closeDisabled={busy === 'remove'}
            />
            {removal && (
              <>
                <AppDialogBody>
                  {error && (
                    <div className="inline-error" role="alert">
                      {error}
                    </div>
                  )}
                  <AppDialogFactGrid>
                    <AppDialogFact label="当前会话">
                      {removal.preview.currentCampMembershipCount} 个
                    </AppDialogFact>
                    <AppDialogFact label="未完成任务">
                      {removal.preview.openAssignedTaskCount} 个将释放
                    </AppDialogFact>
                    <AppDialogFact label="默认负责人">
                      {removal.preview.defaultLeadCampCount} 个将重选
                    </AppDialogFact>
                  </AppDialogFactGrid>
                  {removal.preview.nonTerminalAgentRunCount > 0 && (
                    <div
                      className="inline-error app-dialog-blocker"
                      role="alert"
                    >
                      仍有 {removal.preview.nonTerminalAgentRunCount}{' '}
                      个未结束的执行，当前不能移除。
                    </div>
                  )}
                  <label className="field-label app-dialog-confirm-field">
                    输入 <code>{removal.displayName}</code> 以确认
                    <input
                      value={removal.confirmationName}
                      onChange={(event) =>
                        setRemoval({
                          ...removal,
                          confirmationName: event.target.value
                        })
                      }
                      autoFocus
                      data-dialog-autofocus
                      autoComplete="off"
                    />
                    <small>区分大小写</small>
                  </label>
                </AppDialogBody>
                <AppDialogFooter>
                  <Dialog.Close
                    className="quiet-button"
                    type="button"
                    disabled={busy === 'remove'}
                  >
                    取消
                  </Dialog.Close>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={
                      !removal.preview.removable ||
                      removal.confirmationName !== removal.displayName ||
                      busy === 'remove'
                    }
                    onClick={() => void confirmRemoval().catch(() => undefined)}
                  >
                    {busy === 'remove' ? '正在移除…' : '永久移除队员'}
                  </button>
                </AppDialogFooter>
              </>
            )}
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

function MemberDetailHeader({
  agent,
  runtimeAvailability,
  hostPlatform,
  runtimePlatformAdmission,
  runtimeDiscoveryPending,
  busy,
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
  onEditAvatar(trigger: HTMLButtonElement): void
  onPresence(presence: 'present' | 'away'): Promise<void>
  onRuntime(): void
  onRemove(trigger: HTMLButtonElement): void
}): React.JSX.Element {
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const availability =
    runtimeAvailability.find(
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
    <header className="member-detail-header member-editor-member-header">
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
            <span className={`presence-${agent.presence}`}>
              {memberPresenceLabel(agent.presence)}
            </span>
            <button
              className={`member-header-runtime status-${runtime.status}`}
              type="button"
              onClick={onRuntime}
              aria-label={`${agent.runtimeConfiguration?.adapterKind ? adapterLabel(agent.runtimeConfiguration.adapterKind) : 'Agent 运行时'}，${runtime.label}；打开运行配置`}
              title="打开运行配置"
            >
              <i aria-hidden="true" />
              <span>
                {agent.runtimeConfiguration?.adapterKind
                  ? adapterLabel(agent.runtimeConfiguration.adapterKind)
                  : 'Agent 运行时'}
              </span>
              <strong>{runtime.label}</strong>
              <svg
                className="member-runtime-entry-arrow"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path d="m6 3.5 4.5 4.5L6 12.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div className="member-detail-actions">
        <Menu.Root>
          <Menu.Trigger asChild>
            <button
              ref={menuTriggerRef}
              className="member-editor-icon-button"
              type="button"
              aria-label={`管理 ${agent.displayName}`}
              disabled={busy !== null}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="4.5" cy="10" r="1" />
                <circle cx="10" cy="10" r="1" />
                <circle cx="15.5" cy="10" r="1" />
              </svg>
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              className="member-editor-menu"
              align="end"
              sideOffset={6}
            >
              <Menu.Item
                className="member-editor-menu-item"
                onSelect={() =>
                  onEditAvatar(menuTriggerRef.current as HTMLButtonElement)
                }
              >
                更换角色图片
              </Menu.Item>
              <Menu.Item
                className="member-editor-menu-item"
                onSelect={() =>
                  void onPresence(
                    agent.presence === 'present' ? 'away' : 'present'
                  ).catch(() => undefined)
                }
              >
                {agent.presence === 'present' ? '暂时离队' : '归队'}
              </Menu.Item>
              <Menu.Separator className="member-editor-menu-separator" />
              <Menu.Item
                className="member-editor-menu-item member-editor-menu-danger"
                onSelect={() =>
                  onRemove(menuTriggerRef.current as HTMLButtonElement)
                }
              >
                永久移除队员
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </header>
  )
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
  ...VISIBLE_PRODUCT_RUNTIMES.map((runtimeKind) => ({
    state: 'supported' as const,
    runtimeKind
  })),
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

export const MemberRuntimeForm = forwardRef<
  MemberRuntimeFormHandle,
  {
    agent: AgentProfile
    installations: AdapterInstallation[]
    runtimeAvailability: ProductRuntimeAvailability[]
    hostPlatform?: HostPlatformKey | null
    runtimePlatformAdmission?: RuntimePlatformAdmission[]
    runtimeDiscoveryPending?: boolean
    busy: string | null
    onDirtyChange?(dirty: boolean): void
    onSave(
      adapterKind: AdapterKind,
      draft: MemberRuntimeDraft | null
    ): Promise<void>
    onClear(): Promise<void>
    onReload(): Promise<void>
    onOpenRuntimeSettings(): void
  }
>(function MemberRuntimeForm(
  {
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
  },
  ref
): React.JSX.Element {
  const runtimeSelectId = useId()
  const initialStateRef = useRef<MemberRuntimeEditorState | null>(null)
  if (!initialStateRef.current)
    initialStateRef.current = runtimeEditorState(agent, installations)
  const [selectedKind, setSelectedKind] = useState<AdapterKind | ''>(
    initialStateRef.current.selectedKind
  )
  const [draft, setDraft] = useState<MemberRuntimeDraft | null>(
    initialStateRef.current.draft
  )
  const [baselineStateKey, setBaselineStateKey] = useState(() =>
    runtimeEditorStateKey(initialStateRef.current as MemberRuntimeEditorState)
  )
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const agentIdRef = useRef(agent.agentId)
  const persistedRuntimeKeyRef = useRef(persistedRuntimeKey(agent))
  const pendingSubmissionRef = useRef<PendingRuntimeSubmission | null>(null)
  const currentStateKey = runtimeEditorStateKey({ selectedKind, draft })
  const dirty = currentStateKey !== baselineStateKey
  const availability =
    runtimeAvailability.find((item) => item.runtimeKind === selectedKind) ??
    null
  const selectedAdmission = selectedKind
    ? runtimePlatformAdmissionFor(
        hostPlatform,
        runtimePlatformAdmission,
        selectedKind
      )
    : null
  const persistedAdmission = agent.runtimeConfiguration
    ? runtimePlatformAdmissionFor(
        hostPlatform,
        runtimePlatformAdmission,
        agent.runtimeConfiguration.adapterKind
      )
    : null
  const installation = useMemo(
    () =>
      selectedKind
        ? runtimeEditorInstallation(installations, selectedKind)
        : null,
    [installations, selectedKind]
  )
  const runtimeMutationAdmission = selectedKind
    ? selectedAdmission
    : persistedAdmission
  const persistedRuntimeLocked =
    agent.runtimeConfiguration !== null &&
    (agent.runtimeConfiguration.adapterKind === 'cursor-agent' ||
      (hostPlatform !== null &&
        !runtimePlatformAdmissionAllowsUse(persistedAdmission)))
  const runtimeMutationAllowed =
    !persistedRuntimeLocked &&
    (hostPlatform === null ||
      (!selectedKind && agent.runtimeConfiguration === null) ||
      runtimePlatformAdmissionAllowsUse(runtimeMutationAdmission))
  const canSave =
    dirty &&
    !conflict &&
    (!selectedKind || draft !== null) &&
    runtimeMutationAllowed
  const runtimeStatus = memberRuntimePresentation(
    agent,
    selectedKind || null,
    availability,
    runtimeDiscoveryPending,
    selectedAdmission,
    hostPlatform !== null
  )
  const reportedVersion =
    availability?.reportedVersion ??
    installation?.snapshot?.reportedVersion ??
    null

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

  useImperativeHandle(ref, () => ({ discard: resetFromAgent }), [
    resetFromAgent
  ])

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
      const submittedEditorStateKey =
        pendingSubmissionRef.current?.editorStateKey
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
    <section className="member-runtime-section">
      <form
        className="member-runtime-form"
        onSubmit={(event) => void submit(event)}
      >
        <div className="member-editor-runtime-primary">
          <MemberRuntimePicker
            id={runtimeSelectId}
            value={selectedKind}
            disabled={busy !== null || persistedRuntimeLocked}
            isDisabled={(kind) =>
              hostPlatform !== null &&
              !runtimePlatformAdmissionAllowsUse(
                runtimePlatformAdmissionFor(
                  hostPlatform,
                  runtimePlatformAdmission,
                  kind
                )
              )
            }
            onChange={(nextKind) => {
              setSelectedKind(nextKind)
              const nextInstallation = nextKind
                ? runtimeEditorInstallation(installations, nextKind)
                : null
              setDraft(
                nextKind
                  ? runtimeDraftForMember(
                      agent,
                      nextKind,
                      nextInstallation,
                      false
                    )
                  : null
              )
              setSubmitError(null)
            }}
          />

          <div
            className={`member-editor-runtime-health-wrap status-${runtimeStatus.status}`}
            role="status"
            aria-live="polite"
          >
            <div className="member-editor-runtime-health">
              <span
                className={`member-editor-runtime-status status-${runtimeStatus.status}`}
              >
                <i aria-hidden="true" />
                {runtimeStatus.label}
              </span>
              {reportedVersion && <code>{reportedVersion}</code>}
            </div>
            {runtimeStatus.detail && (
              <small className="runtime-status-detail">
                {runtimeStatus.detail}
              </small>
            )}
            {selectedKind &&
              (runtimeStatus.status === 'not_installed' ||
                runtimeStatus.status === 'authentication_required' ||
                runtimeStatus.status === 'version_unsupported' ||
                runtimeStatus.status === 'unavailable') && (
                <div className="runtime-installation-action">
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={onOpenRuntimeSettings}
                  >
                    前往 Agent 运行时
                  </button>
                </div>
              )}
          </div>
        </div>

        {selectedKind && (
          <MemberRuntimeParameters
            inline
            adapterKind={selectedKind}
            installation={installation}
            draft={draft}
            disabled={busy !== null || !runtimeMutationAllowed}
            onOpenModelCatalog={() => openRuntimeModelCatalog(selectedKind)}
            onChange={(nextDraft) => {
              setDraft(nextDraft)
              setSubmitError(null)
            }}
          />
        )}

        {conflict && (
          <div className="member-runtime-conflict" role="alert">
            <strong>运行配置已在其他操作中更新</strong>
            <span>
              当前草稿没有被覆盖。重新读取会放弃这份草稿，并载入最新保存值。
            </span>
            <button
              className="quiet-button"
              type="button"
              onClick={resetFromAgent}
            >
              重新读取已保存配置
            </button>
          </div>
        )}
        {submitError && <div className="inline-error">{submitError}</div>}
        <div className="member-editor-save-row">
          <span
            className={`member-editor-save-status ${dirty ? 'is-dirty' : ''}`}
          >
            {!runtimeMutationAllowed
              ? '当前平台仅可查看这份配置'
              : dirty
                ? '有未保存更改'
                : '当前配置已保存'}
          </span>
          <div>
            <button
              className="member-editor-cancel"
              type="button"
              disabled={!dirty || busy !== null}
              onClick={resetFromAgent}
            >
              放弃更改
            </button>
            <button
              className="member-editor-primary"
              disabled={!canSave || busy !== null}
            >
              {busy === 'runtime' || busy === 'runtime-clear'
                ? '正在保存…'
                : '保存运行配置'}
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
  const installation = runtimeEditorInstallation(installations, selectedKind)
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

export function RuntimeInstallationsPanel({
  health,
  onReload
}: {
  health: HealthStatus | null
  installations: AdapterInstallation[]
  onReload(): Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const availability = health?.runtimeAvailability ?? []
  const hasEnabledRuntime =
    health?.runtimePlatformAdmission.some(
      (row) =>
        row.platform === health.hostPlatform &&
        runtimePlatformAdmissionAllowsUse(row)
    ) ?? false

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
      await window.rovai.request('runtime.discovery.rescan', {
        interactiveShell: true
      })
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
        title="运行时"
        description="管理本机 Agent 运行时及其可用状态。"
        aside={
          <button
            className="quiet-button"
            disabled={busy !== null || (health !== null && !hasEnabledRuntime)}
            onClick={() => void rescan()}
          >
            {busy === 'rescan'
              ? '正在重新检测…'
              : health === null
                ? '重新检测全部'
                : hasEnabledRuntime
                  ? '重新检测全部'
                  : '当前平台尚无可检测 Runtime'}
          </button>
        }
      />
      <section className="section-block runtime-installations">
        <div className="section-heading">
          <div>
            <h2>Agent 运行时目录</h2>
          </div>
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
                  <button
                    className="quiet-button runtime-product-check"
                    type="button"
                    disabled
                  >
                    尚未开放
                  </button>
                </article>
              )
            }
            const runtimeKind = entry.runtimeKind
            const item = availability.find(
              (candidate) => candidate.runtimeKind === runtimeKind
            )
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
            return (
              <article key={runtimeKind} className="runtime-product-row">
                <span className="runtime-product-logo" aria-hidden="true">
                  <img src={PRODUCT_RUNTIME_LOGOS[runtimeKind]} alt="" />
                </span>
                <div className="runtime-product-copy">
                  <strong>{adapterLabel(runtimeKind)}</strong>
                  <small>
                    {admission?.status === 'preview'
                      ? `实验性开放 · ${item?.reportedVersion ?? adapterMaturityLabel(runtimeKind)}`
                      : admission?.status !== 'qualified'
                        ? presentation.detail
                        : (item?.reportedVersion ??
                          adapterMaturityLabel(runtimeKind))}
                  </small>
                </div>
                <span
                  className={`runtime-snapshot-badge runtime-product-status status-${presentation.status}`}
                >
                  {presentation.label}
                </span>
                <button
                  className="quiet-button runtime-product-check"
                  disabled={
                    busy !== null ||
                    !runtimePlatformAdmissionAllowsUse(admission)
                  }
                  onClick={() => void checkProduct(runtimeKind)}
                >
                  {busy === `check-${runtimeKind}`
                    ? '正在检查…'
                    : runtimePlatformAdmissionAllowsUse(admission)
                      ? '检查可用性'
                      : '不可检查'}
                </button>
                {item?.failure && (
                  <RuntimeFailureNotice failure={item.failure} />
                )}
              </article>
            )
          })}
        </div>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
      </section>
    </>
  )
}

function assertApplied(result: StoredCommandResult): void {
  if (result.status !== 'rejected') return
  const detail =
    stringField(result.payload, 'message') ??
    stringField(result.payload, 'detail')
  throw new Error(
    detail
      ? `${commandCodeLabel(result.code)}：${detail}`
      : commandCodeLabel(result.code)
  )
}

function commandCodeLabel(code: string): string {
  return (
    (
      {
        'agent_profile.display_name_conflict': '该名称已被其他队员使用',
        'agent_profile.version_conflict': '队员已被其他操作更新，请刷新后重试',
        'agent_profile.default_lead_successor_required':
          '该队员仍是某个会话的默认负责人，请先在对应会话中指定继任者',
        'adapter_installation.already_exists': '这个 Agent 运行时已经存在',
        'adapter_installation.version_conflict':
          'Agent 运行时已被更新，请刷新后重试'
      } as Record<string, string>
    )[code] ?? `操作未完成：${code}`
  )
}

function adapterMaturityLabel(kind: AdapterKind): string {
  return {
    'codex-cli': '稳定',
    pi: '稳定',
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
  }[kind]
}

function memberPresenceLabel(presence: AgentProfile['presence']): string {
  return { present: '在队', away: '暂离', removed: '已移除' }[presence]
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
  return (
    installation.snapshot?.models.filter(
      (model) => !model.id.endsWith('://runtime-default')
    ).length ?? 0
  )
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', { hour12: false })
}

function stringField(
  value: Record<string, unknown>,
  key: string
): string | null {
  return typeof value[key] === 'string' ? (value[key] as string) : null
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(readErrorMessage(error))
}
