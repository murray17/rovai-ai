import { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AgentProfile,
  GeneralPreferencesSnapshot,
  LoginItemSnapshot,
  NewConversationDefaults,
  StartupLocationMode,
  WindowResetCapability
} from '@contracts'
import { MemberAvatar } from './MemberAvatar'
import { SettingsPageHeader } from './SettingsPageHeader'
import { resolveNewConversationDefaults } from './new-conversation-preferences'

export function loginItemStatusMessage(snapshot: LoginItemSnapshot | null): string {
  if (!snapshot) return '正在读取 macOS 登录项状态…'
  if (snapshot.status === 'development') return '仅在已安装的 Rovai-ai 应用中可配置'
  if (snapshot.status === 'requires-approval') return '等待系统授权，当前尚未生效。'
  if (snapshot.status === 'not-found') return '未找到 Rovai-ai 登录项服务，请重新安装或修复应用。'
  if (snapshot.status === 'enabled') return '已开启。'
  return '登录 macOS 后自动打开 Rovai-ai。'
}

export function loginItemCanToggle(snapshot: LoginItemSnapshot | null): boolean {
  return snapshot !== null
    && snapshot.status !== 'development'
    && snapshot.status !== 'not-found'
}

export function GeneralSettings({
  agents = [],
  initialPreferences = null,
  currentProjectLabel = '快速对话',
  onPreferencesChange = () => undefined
}: {
  agents?: AgentProfile[]
  initialPreferences?: GeneralPreferencesSnapshot | null
  currentProjectLabel?: string
  onPreferencesChange?(preferences: GeneralPreferencesSnapshot): void
}): React.JSX.Element {
  const [preferences, setPreferences] = useState<GeneralPreferencesSnapshot | null>(initialPreferences)
  const [preferenceBusy, setPreferenceBusy] = useState(false)
  const [preferenceError, setPreferenceError] = useState<string | null>(null)
  const [defaultMemberIds, setDefaultMemberIds] = useState<string[]>(
    () => initialPreferences?.newConversationDefaults?.memberAgentIds ?? []
  )
  const [defaultLeadId, setDefaultLeadId] = useState(
    () => initialPreferences?.newConversationDefaults?.defaultLeadAgentId ?? ''
  )
  const [defaultsDirty, setDefaultsDirty] = useState(false)
  const [defaultsBusy, setDefaultsBusy] = useState(false)
  const [defaultsError, setDefaultsError] = useState<string | null>(null)
  const [oneClickBusy, setOneClickBusy] = useState(false)
  const [oneClickConfirmOpen, setOneClickConfirmOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [loginItem, setLoginItem] = useState<LoginItemSnapshot | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [resetCapability, setResetCapability] = useState<WindowResetCapability | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const helpButtonRef = useRef<HTMLButtonElement>(null)

  const acceptPreferences = useCallback((snapshot: GeneralPreferencesSnapshot): void => {
    setPreferences(snapshot)
    onPreferencesChange(snapshot)
  }, [onPreferencesChange])

  const loadPreferences = useCallback(async (): Promise<void> => {
    setPreferenceError(null)
    try {
      acceptPreferences(await window.rovai.generalPreferences.get())
    } catch (error) {
      setPreferenceError(errorMessage(error))
    }
  }, [acceptPreferences])

  const loadLoginItem = useCallback(async (): Promise<void> => {
    setLoginError(null)
    try {
      setLoginItem(await window.rovai.loginItem.get())
    } catch (error) {
      setLoginError(errorMessage(error))
    }
  }, [])

  const loadResetCapability = useCallback(async (): Promise<void> => {
    try {
      setResetCapability(await window.rovai.windowControls.getResetCapability())
      setResetError(null)
    } catch (error) {
      setResetError(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    void Promise.all([loadPreferences(), loadLoginItem(), loadResetCapability()])
  }, [loadLoginItem, loadPreferences, loadResetCapability])

  useEffect(() => {
    if (!initialPreferences) return
    acceptPreferences(initialPreferences)
  }, [acceptPreferences, initialPreferences])

  useEffect(() => {
    if (!preferences || defaultsDirty) return
    setDefaultMemberIds(preferences.newConversationDefaults?.memberAgentIds ?? [])
    setDefaultLeadId(preferences.newConversationDefaults?.defaultLeadAgentId ?? '')
  }, [defaultsDirty, preferences])

  useEffect(() => {
    if (!helpOpen) return undefined
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && helpButtonRef.current?.contains(event.target)) return
      setHelpOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setHelpOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [helpOpen])

  useEffect(() => {
    const refreshShellState = (): void => {
      void Promise.all([loadLoginItem(), loadResetCapability()])
    }
    window.addEventListener('focus', refreshShellState)
    window.addEventListener('resize', loadResetCapability)
    return () => {
      window.removeEventListener('focus', refreshShellState)
      window.removeEventListener('resize', loadResetCapability)
    }
  }, [loadLoginItem, loadResetCapability])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 3_200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const setLoginEnabled = async (enabled: boolean): Promise<void> => {
    setLoginBusy(true)
    setLoginError(null)
    try {
      setLoginItem(await window.rovai.loginItem.setEnabled(enabled))
    } catch (error) {
      setLoginError(errorMessage(error))
    } finally {
      setLoginBusy(false)
    }
  }

  const setStartupLocationMode = async (mode: StartupLocationMode): Promise<void> => {
    if (!preferences || mode === preferences.startupLocationMode || preferenceBusy) return
    const previous = preferences
    setPreferences({ ...preferences, startupLocationMode: mode })
    setPreferenceBusy(true)
    setPreferenceError(null)
    try {
      acceptPreferences(await window.rovai.generalPreferences.setStartupLocationMode(mode))
      setFeedback('启动位置偏好已保存。')
    } catch (error) {
      setPreferences(previous)
      setPreferenceError(errorMessage(error))
    } finally {
      setPreferenceBusy(false)
    }
  }

  const toggleDefaultMember = (agentId: string): void => {
    if (defaultsBusy) return
    setDefaultsError(null)
    setDefaultsDirty(true)
    setDefaultMemberIds((current) => current.includes(agentId)
      ? current.filter((id) => id !== agentId)
      : [...current, agentId])
  }

  const saveNewConversationDefaults = async (): Promise<void> => {
    if (!preferences || defaultsBusy) return
    const orderedMemberIds = defaultMemberIds.slice().sort((left, right) => {
      const leftOrder = agents.find((agent) => agent.agentId === left)?.memberOrder ?? Number.MAX_SAFE_INTEGER
      const rightOrder = agents.find((agent) => agent.agentId === right)?.memberOrder ?? Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder || left.localeCompare(right)
    })
    const draft: NewConversationDefaults = {
      memberAgentIds: orderedMemberIds,
      defaultLeadAgentId: defaultLeadId
    }
    if (!newConversationDefaultsDraftIsValid(draft, agents)) return
    setDefaultsBusy(true)
    setDefaultsError(null)
    try {
      const saved = await window.rovai.generalPreferences.setNewConversationDefaults(draft)
      acceptPreferences(saved)
      setDefaultMemberIds(saved.newConversationDefaults?.memberAgentIds ?? [])
      setDefaultLeadId(saved.newConversationDefaults?.defaultLeadAgentId ?? '')
      setDefaultsDirty(false)
      setFeedback('默认队员与 Lead 已保存。')
    } catch (error) {
      setDefaultsError(errorMessage(error))
    } finally {
      setDefaultsBusy(false)
    }
  }

  const setOneClickEnabled = async (enabled: boolean): Promise<void> => {
    if (!preferences || oneClickBusy) return
    if (enabled) {
      if (!resolveNewConversationDefaults(preferences, agents) || defaultsDirty) return
      setOneClickConfirmOpen(true)
      return
    }
    setOneClickBusy(true)
    setPreferenceError(null)
    try {
      acceptPreferences(await window.rovai.generalPreferences.setOneClickNewConversationEnabled(false))
    } catch (error) {
      setPreferenceError(errorMessage(error))
    } finally {
      setOneClickBusy(false)
    }
  }

  const confirmOneClickEnabled = async (): Promise<void> => {
    if (!preferences || oneClickBusy) return
    setOneClickBusy(true)
    setPreferenceError(null)
    try {
      acceptPreferences(await window.rovai.generalPreferences.setOneClickNewConversationEnabled(true))
      setOneClickConfirmOpen(false)
    } catch (error) {
      setPreferenceError(errorMessage(error))
    } finally {
      setOneClickBusy(false)
    }
  }

  const openSystemSettings = async (): Promise<void> => {
    setLoginError(null)
    try {
      await window.rovai.loginItem.openSystemSettings()
    } catch (error) {
      setLoginError(errorMessage(error))
    }
  }

  const resetWindow = async (): Promise<void> => {
    setResetBusy(true)
    setResetError(null)
    try {
      const result = await window.rovai.windowControls.resetBounds()
      if (!result.performed) {
        setResetCapability({ canReset: false, reason: result.reason })
        return
      }
      setFeedback('窗口大小与位置已重置。')
      await loadResetCapability()
    } catch (error) {
      setResetError(errorMessage(error))
    } finally {
      setResetBusy(false)
    }
  }

  const loginMessage = loginBusy
    ? '正在保存并读取 macOS 系统状态…'
    : loginItemStatusMessage(loginItem)
  const startupMode = preferences?.startupLocationMode ?? 'last_location'
  const resetBlockedByFullscreen = resetCapability?.reason === 'fullscreen'
  const profileById = new Map(agents.map((agent) => [agent.agentId, agent]))
  const missingSelectedIds = defaultMemberIds.filter((agentId) => !profileById.has(agentId))
  const defaultMemberCandidates = [
    ...agents.filter((agent) => agent.presence !== 'removed' || defaultMemberIds.includes(agent.agentId)),
    ...missingSelectedIds.map((agentId) => missingAgentProfile(agentId))
  ].sort((left, right) => left.memberOrder - right.memberOrder || left.agentId.localeCompare(right.agentId))
  const defaultsDraft: NewConversationDefaults = {
    memberAgentIds: defaultMemberIds,
    defaultLeadAgentId: defaultLeadId
  }
  const defaultsDraftError = newConversationDefaultsDraftError(defaultsDraft, agents)
  const savedDefaults = resolveNewConversationDefaults(preferences, agents)
  const savedMemberNames = preferences?.newConversationDefaults?.memberAgentIds.map(
    (agentId) => profileById.get(agentId)?.displayName ?? agentId
  ) ?? []
  const savedLeadName = preferences?.newConversationDefaults
    ? profileById.get(preferences.newConversationDefaults.defaultLeadAgentId)?.displayName
      ?? preferences.newConversationDefaults.defaultLeadAgentId
    : null
  const oneClickEnabled = preferences?.oneClickNewConversationEnabled ?? false
  const oneClickCanEnable = Boolean(savedDefaults) && !defaultsDirty && !oneClickBusy

  return (
    <>
    <div className="general-settings">
      <SettingsPageHeader
        eyebrow="Settings / General"
        title="通用"
        description="设置 Rovai-ai 的启动方式、新对话与窗口行为。"
      />

      <section className="section-block general-settings-section" aria-labelledby="general-startup-heading">
        <div className="section-heading"><div><h2 id="general-startup-heading">启动</h2></div></div>
        <div className="general-setting-row">
          <label className="notification-switch general-login-switch">
            <span>
              <strong>登录时启动 Rovai-ai</strong>
              <small>登录 macOS 后自动打开 Rovai-ai。</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="登录时启动 Rovai-ai"
              checked={loginItem?.checked ?? false}
              disabled={loginBusy || !loginItemCanToggle(loginItem)}
              onChange={(event) => void setLoginEnabled(event.target.checked)}
            />
          </label>
          <div className={`general-inline-status ${loginError ? 'is-error' : ''}`} role={loginError ? 'alert' : 'status'}>
            <span>{loginError ?? loginMessage}</span>
            {loginError && <button className="quiet-button compact" type="button" onClick={() => void loadLoginItem()}>重试</button>}
            {loginItem?.status === 'requires-approval' && !loginError && (
              <button className="quiet-button compact" type="button" onClick={() => void openSystemSettings()}>打开系统设置</button>
            )}
          </div>
        </div>

        <fieldset className="startup-location-options" disabled={!preferences || preferenceBusy}>
          <legend>启动后打开</legend>
          <label className="startup-location-option">
            <input
              type="radio"
              name="startup-location"
              value="last_location"
              checked={startupMode === 'last_location'}
              onChange={() => void setStartupLocationMode('last_location')}
            />
            <span><strong>上次使用的位置</strong><small>恢复最近打开的对话、队员页或记忆页。</small></span>
          </label>
          <label className="startup-location-option">
            <input
              type="radio"
              name="startup-location"
              value="quick_chat"
              checked={startupMode === 'quick_chat'}
              onChange={() => void setStartupLocationMode('quick_chat')}
            />
            <span><strong>快速对话</strong><small>每次启动都从快速对话首页开始。</small></span>
          </label>
        </fieldset>
        {preferenceBusy && <p className="general-inline-status" role="status">正在保存启动位置偏好…</p>}
        {preferenceError && (
          <div className="general-inline-status is-error" role="alert">
            <span>{preferenceError}</span>
            <button className="quiet-button compact" type="button" onClick={() => void loadPreferences()}>重新读取</button>
          </div>
        )}
        <p className="general-recovery-note">
          此设置只决定启动后显示的位置。已有 Camp、草稿、任务、审批和运行记录仍按 Rovai-ai 的既有恢复规则处理。
        </p>
      </section>

      <section className="section-block general-settings-section" aria-labelledby="general-new-conversation-heading">
        <div className="section-heading"><div><h2 id="general-new-conversation-heading">新对话</h2></div></div>
        <div className="general-new-conversation-defaults">
          <div className="general-subsection-heading">
            <div>
              <h3>默认队员</h3>
              <p>选择创建新对话时默认加入的队员，并指定一位默认 Lead。</p>
            </div>
            <span>{defaultMemberIds.length > 0 ? `已选 ${defaultMemberIds.length} 位` : '尚未配置'}</span>
          </div>
          <div className="general-default-member-list" role="group" aria-label="默认队员">
            {defaultMemberCandidates.map((agent) => {
              const selected = defaultMemberIds.includes(agent.agentId)
              const available = agent.presence === 'present' && agent.removedAt === null
              const unavailableLabel = agent.presence === 'away'
                ? '暂时离队'
                : agent.presence === 'removed'
                  ? '已永久移除'
                  : agent.displayName === agent.agentId
                    ? '队员不存在'
                    : null
              return (
                <label className={`general-default-member ${!available ? 'unavailable' : ''}`} key={agent.agentId}>
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={defaultsBusy || (!available && !selected)}
                    onChange={() => toggleDefaultMember(agent.agentId)}
                  />
                  <MemberAvatar
                    agentId={agent.agentId}
                    avatarRef={agent.avatarRef}
                    displayName={agent.displayName}
                    size="mention"
                    decorative
                  />
                  <span><strong>{agent.displayName}</strong><small>{unavailableLabel ?? (agent.teamRole || '队员')}</small></span>
                </label>
              )
            })}
            {defaultMemberCandidates.length === 0 && (
              <p className="general-default-members-empty">当前没有可选择的在队队员。</p>
            )}
          </div>
          <label className="general-default-lead">
            <span>默认 Lead</span>
            <select
              value={defaultLeadId}
              disabled={defaultsBusy || defaultMemberIds.length === 0}
              onChange={(event) => {
                setDefaultLeadId(event.target.value)
                setDefaultsDirty(true)
                setDefaultsError(null)
              }}
            >
              <option value="">请选择默认 Lead</option>
              {defaultMemberIds.map((agentId) => {
                const agent = profileById.get(agentId)
                const valid = agent?.presence === 'present' && agent.removedAt === null
                return <option key={agentId} value={agentId}>{agent?.displayName ?? agentId}{valid ? '' : ' · 已失效'}</option>
              })}
            </select>
          </label>
          {preferences?.newConversationDefaultsRequireConfirmation && (
            <p className="general-defaults-attention" role="status">
              已保存的默认队员或 Lead 曾失效，请重新选择并保存确认。
            </p>
          )}
          {defaultsDirty && <p className="general-unsaved-note" role="status">默认配置有未保存的更改。</p>}
          {defaultsDraftError && <p className="general-defaults-validation">{defaultsDraftError}</p>}
          {defaultsError && <p className="general-inline-status is-error" role="alert">{defaultsError}</p>}
          <button
            className="quiet-button"
            type="button"
            disabled={!preferences || defaultsBusy || !defaultsDirty || Boolean(defaultsDraftError)}
            onClick={() => void saveNewConversationDefaults()}
          >
            {defaultsBusy ? '正在保存…' : '保存默认配置'}
          </button>
        </div>

        <div className="general-one-click-setting">
          <div className="general-one-click-row">
            <span>
              <span className="general-one-click-title">
                <strong>一键创建新对话</strong>
                <button
                  ref={helpButtonRef}
                  className="general-help-button"
                  type="button"
                  aria-label="了解一键创建如何工作"
                  aria-expanded={helpOpen}
                  aria-controls="general-one-click-help"
                  onFocus={() => setHelpOpen(true)}
                  onClick={() => setHelpOpen(true)}
                >?</button>
              </span>
              <small>开启后，新对话入口将使用当前项目和已保存的默认配置直接创建。</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="一键创建新对话"
              checked={oneClickEnabled}
              disabled={!preferences || oneClickBusy || (!oneClickEnabled && !oneClickCanEnable)}
              onChange={(event) => void setOneClickEnabled(event.target.checked)}
            />
            {helpOpen && (
              <div className="general-help-popover" id="general-one-click-help" role="dialog" aria-label="一键创建如何工作">
                <strong>一键创建如何工作？</strong>
                <p>开启后，新对话入口会立即创建空对话，不再询问项目、队员、Lead 或名称。</p>
                <p>项目取当前选中的项目；<br />队员和 Lead 使用本页保存的默认配置。</p>
                <p>关闭此开关即可恢复创建弹窗。</p>
              </div>
            )}
          </div>
          {oneClickEnabled && (
            savedDefaults
              ? <p className="general-effective-summary">当前生效：{currentProjectLabel} · {savedDefaults.members.length} 位默认队员 · Lead {savedDefaults.lead.displayName}</p>
              : <p className="general-effective-summary attention" role="status">默认队员配置需要重新确认。一键创建时将改为打开创建弹窗。</p>
          )}
          {!preferences?.newConversationDefaults && (
            <p className="general-one-click-unavailable">请先保存默认队员与 Lead，再开启一键创建。</p>
          )}
        </div>
      </section>

      <section className="section-block general-settings-section" aria-labelledby="general-window-heading">
        <div className="section-heading"><div><h2 id="general-window-heading">窗口</h2></div></div>
        <p className="general-window-description">
          Rovai-ai 会自动保存窗口大小和位置，并确保下次打开时窗口仍位于可见的显示器区域。
        </p>
        <button
          className="quiet-button"
          type="button"
          disabled={resetBusy || !resetCapability?.canReset}
          onClick={() => void resetWindow()}
        >
          {resetBusy ? '正在重置…' : '重置窗口大小与位置'}
        </button>
        {resetBlockedByFullscreen && <p className="general-inline-status">请先退出全屏，再重置窗口大小与位置</p>}
        {resetError && (
          <div className="general-inline-status is-error" role="alert">
            <span>{resetError}</span>
            <button className="quiet-button compact" type="button" onClick={() => void loadResetCapability()}>重试</button>
          </div>
        )}
      </section>
      <div className="sr-only" aria-live="polite">{feedback}</div>
    </div>
    <Dialog.Root open={oneClickConfirmOpen} onOpenChange={(open) => !oneClickBusy && setOneClickConfirmOpen(open)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content compact-dialog one-click-confirm-dialog" aria-describedby="one-click-confirm-description">
          <Dialog.Title>开启一键创建新对话？</Dialog.Title>
          <Dialog.Description id="one-click-confirm-description">
            开启后，以下入口将不再打开创建弹窗，而是直接创建并进入新对话：
          </Dialog.Description>
          <ul>
            <li>左上角“新对话”</li>
            <li>项目文件夹后的 ＋</li>
            <li>快速对话文件夹后的 ＋</li>
          </ul>
          <div className="one-click-confirm-summary">
            <strong>新对话将使用：</strong>
            <span>项目：{currentProjectLabel}</span>
            <span>队员：{savedMemberNames.join('、') || '—'}</span>
            <span>Lead：{savedLeadName ?? '—'}</span>
          </div>
          <p>如需重新选择项目、队员、Lead 或对话名称，请先在设置中关闭“一键创建新对话”。</p>
          <div className="dialog-actions">
            <Dialog.Close asChild><button className="quiet-button" type="button" disabled={oneClickBusy}>取消</button></Dialog.Close>
            <button className="primary-button" type="button" disabled={oneClickBusy} onClick={() => void confirmOneClickEnabled()}>
              {oneClickBusy ? '正在开启…' : '开启一键创建'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    </>
  )
}

export function newConversationDefaultsDraftError(
  defaults: NewConversationDefaults,
  agents: AgentProfile[]
): string | null {
  if (defaults.memberAgentIds.length === 0) return '至少选择一位默认队员。'
  if (!defaults.memberAgentIds.includes(defaults.defaultLeadAgentId)) {
    return '默认 Lead 必须属于默认队员。'
  }
  const profileById = new Map(agents.map((agent) => [agent.agentId, agent]))
  if (defaults.memberAgentIds.some((agentId) => {
    const agent = profileById.get(agentId)
    return !agent || agent.presence !== 'present' || agent.removedAt !== null
  })) return '默认队员中包含已失效队员，请重新选择。'
  const lead = profileById.get(defaults.defaultLeadAgentId)
  if (!lead || lead.presence !== 'present' || lead.removedAt !== null) {
    return '默认 Lead 已失效，请重新选择。'
  }
  return null
}

export function newConversationDefaultsDraftIsValid(
  defaults: NewConversationDefaults,
  agents: AgentProfile[]
): boolean {
  return newConversationDefaultsDraftError(defaults, agents) === null
}

function missingAgentProfile(agentId: string): AgentProfile {
  return {
    agentId,
    displayName: agentId,
    avatarRef: null,
    accent: null,
    teamRole: '',
    professionalResponsibilities: '',
    personalityTraits: [],
    workingPrinciples: '',
    growthTopic: '',
    defaultCapabilities: [],
    presence: 'removed',
    runtimeConfiguration: null,
    runtimeReadiness: { status: 'runtime_not_configured', blockers: [] },
    memberOrder: Number.MAX_SAFE_INTEGER,
    version: 0,
    createdAt: '',
    updatedAt: '',
    removedAt: ''
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
