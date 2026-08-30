import { readErrorMessage } from './error-message'
import { useCallback, useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AgentProfile,
  GeneralPreferencesSnapshot,
  NewConversationDefaults,
  StartupLocationMode,
  WindowResetCapability
} from '@contracts'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFact,
  AppDialogFactGrid,
  AppDialogFooter,
  AppDialogGlyph,
  AppDialogHeader
} from './AppDialog'
import { MemberAvatar } from './MemberAvatar'
import { SettingsPageHeader } from './SettingsPageHeader'
import { resolveNewConversationDefaults } from './new-conversation-preferences'

export const ONE_CLICK_ENTRY_DESCRIPTIONS = [
  '左上角“新对话”',
  '已有项目文件夹后的 ＋',
  '快速对话文件夹后的 ＋',
  '“项目”标题后的 ＋，选择工作目录后直接创建'
] as const

export const ONE_CLICK_PROJECT_HELP = '左上角“新对话”使用当前选中的项目；已有项目文件夹后的 ＋ 使用对应项目；快速对话文件夹后的 ＋ 使用快速对话；“项目”标题后的 ＋ 使用新选择的工作目录。'
export const DEFAULT_MEMBER_COLLAPSE_THRESHOLD = 10

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
  const [defaultMemberQuery, setDefaultMemberQuery] = useState('')
  const [defaultsDirty, setDefaultsDirty] = useState(false)
  const [defaultsBusy, setDefaultsBusy] = useState(false)
  const [defaultsError, setDefaultsError] = useState<string | null>(null)
  const [oneClickBusy, setOneClickBusy] = useState(false)
  const [oneClickConfirmOpen, setOneClickConfirmOpen] = useState(false)
  const [worldMapBusy, setWorldMapBusy] = useState(false)
  const [worldMapError, setWorldMapError] = useState<string | null>(null)
  const [resetCapability, setResetCapability] = useState<WindowResetCapability | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const acceptPreferences = useCallback((snapshot: GeneralPreferencesSnapshot): void => {
    setPreferences(snapshot)
    onPreferencesChange(snapshot)
  }, [onPreferencesChange])

  const loadPreferences = useCallback(async (): Promise<void> => {
    setPreferenceError(null)
    setWorldMapError(null)
    try {
      acceptPreferences(await window.rovai.generalPreferences.get())
    } catch (error) {
      setPreferenceError(errorMessage(error))
    }
  }, [acceptPreferences])

  const loadResetCapability = useCallback(async (): Promise<void> => {
    try {
      setResetCapability(await window.rovai.windowControls.getResetCapability())
      setResetError(null)
    } catch (error) {
      setResetError(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    void Promise.all([loadPreferences(), loadResetCapability()])
  }, [loadPreferences, loadResetCapability])

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
    const refreshWindowState = (): void => {
      void loadResetCapability()
    }
    window.addEventListener('focus', refreshWindowState)
    window.addEventListener('resize', loadResetCapability)
    return () => {
      window.removeEventListener('focus', refreshWindowState)
      window.removeEventListener('resize', loadResetCapability)
    }
  }, [loadResetCapability])

  useEffect(() => {
    if (!feedback) return undefined
    const timer = window.setTimeout(() => setFeedback(null), 3_200)
    return () => window.clearTimeout(timer)
  }, [feedback])

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
      setFeedback('默认队员与默认队长已保存。')
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

  const setWorldMapEnabled = async (enabled: boolean): Promise<void> => {
    if (!preferences || enabled === preferences.worldMapEnabled || worldMapBusy) return
    const previous = preferences
    setPreferences({ ...preferences, worldMapEnabled: enabled })
    setWorldMapBusy(true)
    setWorldMapError(null)
    try {
      acceptPreferences(await window.rovai.generalPreferences.setWorldMapEnabled(enabled))
      setFeedback(enabled
        ? '世界地图已开启。'
        : '世界地图已关闭，会话将保留在时间线。')
    } catch (error) {
      setPreferences(previous)
      setWorldMapError(errorMessage(error))
    } finally {
      setWorldMapBusy(false)
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
  const worldMapEnabled = preferences?.worldMapEnabled ?? true
  const oneClickCanEnable = Boolean(savedDefaults) && !defaultsDirty && !oneClickBusy
  const shouldCollapseMembers = defaultMemberCandidates.length > DEFAULT_MEMBER_COLLAPSE_THRESHOLD
  const normalizedMemberQuery = defaultMemberQuery.trim().toLocaleLowerCase('zh-CN')
  const visibleMemberCandidates = !shouldCollapseMembers || normalizedMemberQuery.length === 0
    ? defaultMemberCandidates
    : defaultMemberCandidates.filter((agent) => [agent.displayName, agent.teamRole, agent.agentId]
        .join(' ')
        .toLocaleLowerCase('zh-CN')
        .includes(normalizedMemberQuery))
  const selectedMemberNames = defaultMemberIds.map(
    (agentId) => profileById.get(agentId)?.displayName ?? agentId
  )
  const memberPickerSummary = selectedMemberNames.length === 0
    ? '尚未选择队员'
    : selectedMemberNames.length <= 2
      ? selectedMemberNames.join('、')
      : `${selectedMemberNames.slice(0, 2).join('、')}等 ${selectedMemberNames.length} 位`
  const pageSaveError = Boolean(preferenceError || defaultsError || worldMapError)
  const pageSaving = preferenceBusy || defaultsBusy || oneClickBusy || worldMapBusy
  const pageSaveLabel = !preferences
    ? '正在读取设置…'
    : pageSaving
      ? '正在保存…'
      : pageSaveError
        ? '部分设置未保存'
        : defaultsDirty
          ? '有未保存的更改'
          : '当前设置已保存'

  const defaultMemberList = (
    <div className="general-default-member-list" role="group" aria-label="默认队员">
      {visibleMemberCandidates.map((agent) => {
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
      {visibleMemberCandidates.length === 0 && (
        <p className="general-default-members-empty">
          {defaultMemberCandidates.length === 0 ? '当前没有可选择的在队队员。' : '没有匹配的队员。'}
        </p>
      )}
    </div>
  )

  return (
    <>
    <div className="general-settings">
      <SettingsPageHeader
        eyebrow="Settings / General"
        title="通用"
        description="设置 Rovai AI 的启动位置、新对话与窗口行为。"
        aside={(
          <span className={`general-save-state ${pageSaveError ? 'is-error' : defaultsDirty ? 'is-dirty' : ''}`} role="status">
            {pageSaveLabel}
          </span>
        )}
      />

      <div className="general-settings-body">
        <section className="section-block general-settings-section" aria-labelledby="general-startup-heading">
          <div className="section-heading"><div><h2 id="general-startup-heading">启动</h2><p>稳定位置偏好</p></div></div>
          <div className="general-section-body">
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
          </div>
        </section>

        <section className="section-block general-settings-section" aria-labelledby="general-new-conversation-heading">
          <div className="section-heading"><div><h2 id="general-new-conversation-heading">新对话</h2><p>默认队员与创建方式</p></div></div>
          <div className="general-section-body">
            <div className="general-configurator">
              <div className="general-config-head">
                <div><h3>默认队员</h3><p>选择创建新对话时默认加入的队员。</p></div>
                <span>{defaultMemberIds.length > 0 ? `已选 ${defaultMemberIds.length} 位` : '尚未配置'}</span>
              </div>

              {shouldCollapseMembers
                ? (
                  <details className="general-default-member-picker">
                    <summary>
                      <span><strong>{memberPickerSummary}</strong><small>共 {defaultMemberCandidates.length} 位队员，展开后可多选</small></span>
                      <span>管理队员</span>
                      <ChevronDownIcon />
                    </summary>
                    <div className="general-default-member-picker-panel">
                      <label className="general-default-member-search">
                        <SearchIcon />
                        <input
                          type="search"
                          value={defaultMemberQuery}
                          placeholder="搜索队员"
                          aria-label="搜索默认队员"
                          onChange={(event) => setDefaultMemberQuery(event.target.value)}
                        />
                      </label>
                      {defaultMemberList}
                    </div>
                  </details>
                )
                : defaultMemberList}

              <label className="general-default-lead">
                <span><strong>默认队长</strong><small>队长必须是已选择的默认队员。</small></span>
                <select
                  value={defaultLeadId}
                  disabled={defaultsBusy || defaultMemberIds.length === 0}
                  onChange={(event) => {
                    setDefaultLeadId(event.target.value)
                    setDefaultsDirty(true)
                    setDefaultsError(null)
                  }}
                >
                  <option value="">请选择默认队长</option>
                  {defaultMemberIds.map((agentId) => {
                    const agent = profileById.get(agentId)
                    const valid = agent?.presence === 'present' && agent.removedAt === null
                    return <option key={agentId} value={agentId}>{agent?.displayName ?? agentId}{valid ? '' : ' · 已失效'}</option>
                  })}
                </select>
              </label>

              {preferences?.newConversationDefaultsRequireConfirmation && (
                <p className="general-defaults-attention" role="status">
                  已保存的默认队员或默认队长曾失效，请重新选择并保存确认。
                </p>
              )}
              {defaultsError && <p className="general-inline-status is-error" role="alert">{defaultsError}</p>}
              <div className="general-save-row">
                <span className={`general-draft-state ${defaultsDraftError ? 'is-error' : ''}`} role="status">
                  {defaultsDraftError ?? (defaultsDirty ? '默认配置有未保存的更改。' : '默认配置已保存。')}
                </span>
                <button
                  className="primary-button compact"
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
                      <span className="general-help-anchor">
                        <span className="general-help-mark" aria-hidden="true"><HelpCircleIcon /></span>
                        <span className="general-help-popover" id="general-one-click-help" role="tooltip">
                          <strong>一键创建如何工作？</strong>
                          <span>开启后，新对话入口会立即创建空对话，不再询问项目、队员、队长或名称。</span>
                          <span>{ONE_CLICK_PROJECT_HELP}</span>
                          <span>队员和队长始终使用本页保存的默认配置。</span>
                          <span>关闭此开关即可恢复创建弹窗。</span>
                        </span>
                      </span>
                    </span>
                    <small>开启后，新对话入口将使用入口对应的项目和已保存的默认配置直接创建。</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label="一键创建新对话"
                    checked={oneClickEnabled}
                    disabled={!preferences || oneClickBusy || (!oneClickEnabled && !oneClickCanEnable)}
                    onChange={(event) => void setOneClickEnabled(event.target.checked)}
                  />
                </div>
                {oneClickEnabled && (
                  savedDefaults
                    ? <p className="general-effective-summary">当前生效：{currentProjectLabel} · {savedDefaults.members.length} 位默认队员 · 队长 {savedDefaults.lead.displayName}</p>
                    : <p className="general-effective-summary attention" role="status">默认队员配置需要重新确认。一键创建时将改为打开创建弹窗。</p>
                )}
                {!preferences?.newConversationDefaults && (
                  <p className="general-one-click-unavailable">请先保存默认队员与默认队长，再开启一键创建。</p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="section-block general-settings-section" aria-labelledby="general-conversation-heading">
          <div className="section-heading"><div><h2 id="general-conversation-heading">会话</h2><p>阅读面与沉浸视图</p></div></div>
          <div className="general-section-body">
            <label className="general-world-map-setting">
              <span>
                <strong>世界地图</strong>
                <small id="general-world-map-description">
                  在 Camp 会话中启用地图视图；关闭后仅显示会话时间线，并隐藏视图切换按钮。
                </small>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label="启用世界地图"
                aria-describedby="general-world-map-description"
                checked={worldMapEnabled}
                disabled={!preferences || worldMapBusy}
                onChange={(event) => void setWorldMapEnabled(event.target.checked)}
              />
            </label>
            {worldMapBusy && <p className="general-inline-status" role="status">正在保存会话偏好…</p>}
            {worldMapError && (
              <div className="general-inline-status is-error" role="alert">
                <span>{worldMapError}</span>
                <button className="quiet-button compact" type="button" onClick={() => void loadPreferences()}>重新读取</button>
              </div>
            )}
          </div>
        </section>

        <section className="section-block general-settings-section" aria-labelledby="general-window-heading">
          <div className="section-heading"><div><h2 id="general-window-heading">窗口</h2><p>本机显示位置</p></div></div>
          <div className="general-section-body general-window-row">
            <p className="general-window-description">
              Rovai AI 会自动保存窗口大小和位置，并确保下次打开时窗口仍位于可见的显示器区域。
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
          </div>
        </section>
      </div>
      <div className="sr-only" aria-live="polite">{feedback}</div>
    </div>
    <Dialog.Root open={oneClickConfirmOpen} onOpenChange={(open) => !oneClickBusy && setOneClickConfirmOpen(open)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent className="one-click-confirm-dialog" tone="info" aria-describedby="one-click-confirm-description">
          <AppDialogHeader
            title="开启一键创建新对话？"
            description="开启后，以下入口会直接创建并进入新对话，不再显示创建弹窗。"
            descriptionId="one-click-confirm-description"
            icon="bolt"
            kicker="创建方式变化"
            closeDisabled={oneClickBusy}
          />
          <AppDialogBody>
            <div className="app-dialog-choice-list">
              {ONE_CLICK_ENTRY_DESCRIPTIONS.map((description, index) => (
                <div className="app-dialog-choice" key={description}>
                  <span aria-hidden="true"><AppDialogGlyph name={index === ONE_CLICK_ENTRY_DESCRIPTIONS.length - 1 ? 'folder' : 'bolt'} /></span>
                  <strong>{description}</strong>
                </div>
              ))}
            </div>
            <AppDialogFactGrid>
              <AppDialogFact label="项目">由新建入口决定</AppDialogFact>
              <AppDialogFact label="默认队员">{savedMemberNames.length} 位</AppDialogFact>
              <AppDialogFact label="默认队长">{savedLeadName ?? '—'}</AppDialogFact>
            </AppDialogFactGrid>
            <p className="app-dialog-supporting-copy">如需重新选择项目、队员、队长或对话名称，请先在设置中关闭“一键创建新对话”。</p>
          </AppDialogBody>
          <AppDialogFooter>
            <Dialog.Close asChild><button className="quiet-button" type="button" autoFocus data-dialog-autofocus disabled={oneClickBusy}>取消</button></Dialog.Close>
            <button className="primary-button" type="button" disabled={oneClickBusy} onClick={() => void confirmOneClickEnabled()}>
              {oneClickBusy ? '正在开启…' : '开启一键创建'}
            </button>
          </AppDialogFooter>
        </AppDialogContent>
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
    return '默认队长必须属于默认队员。'
  }
  const profileById = new Map(agents.map((agent) => [agent.agentId, agent]))
  if (defaults.memberAgentIds.some((agentId) => {
    const agent = profileById.get(agentId)
    return !agent || agent.presence !== 'present' || agent.removedAt !== null
  })) return '默认队员中包含已失效队员，请重新选择。'
  const lead = profileById.get(defaults.defaultLeadAgentId)
  if (!lead || lead.presence !== 'present' || lead.removedAt !== null) {
    return '默认队长已失效，请重新选择。'
  }
  return null
}

export function newConversationDefaultsDraftIsValid(
  defaults: NewConversationDefaults,
  agents: AgentProfile[]
): boolean {
  return newConversationDefaultsDraftError(defaults, agents) === null
}

function SearchIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
}

function ChevronDownIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
}

function HelpCircleIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 0 1 4.65.8c0 1.8-2.45 2.05-2.45 3.7" /><path d="M12 17h.01" /></svg>
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
  return readErrorMessage(error)
}
