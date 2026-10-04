import { WindowCloseSettings } from './WindowCloseSettings'
import { GeneralLeadSelect } from './GeneralLeadSelect'
import { readErrorMessage } from './error-message'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AgentProfile,
  GeneralPreferencesSnapshot,
  GeneralPreferencesApi,
  InterfaceLanguage,
  NewConversationDefaults,
  StartupLocationMode,
  WindowResetCapability,
  WindowControlsApi
} from '@contracts'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFact,
  AppDialogFactGrid,
  AppDialogFooter,
  AppDialogGlyph,
  AppDialogHeader,
  DialogControlIcon
} from './AppDialog'
import { MemberAvatar } from './MemberAvatar'
import { SettingsPageHeader } from './SettingsPageHeader'
import { resolveNewConversationDefaults } from './new-conversation-preferences'
import { UiText, changeInterfaceLanguage, uiAttribute, useInterfaceLanguage, useUiText } from './interface-language'

export const ONE_CLICK_ENTRY_DESCRIPTIONS = [
  '左上角“新对话”',
  '已有项目文件夹后的 ＋',
  '快速对话文件夹后的 ＋',
  '“项目”标题后的 ＋，选择工作目录后直接创建'
] as const

export const ONE_CLICK_PROJECT_HELP = '左上角“新对话”使用当前选中的项目；已有项目文件夹后的 ＋ 使用对应项目；快速对话文件夹后的 ＋ 使用快速对话；“项目”标题后的 ＋ 使用新选择的工作目录。'
export const DEFAULT_MEMBER_COLLAPSE_THRESHOLD = 10
const ignorePreferencesChange = (): void => undefined

export function GeneralSettings({
  api,
  windowControls,
  windowClose,
  browserAccess,
  agents = [],
  initialPreferences = null,
  onPreferencesChange = ignorePreferencesChange
}: {
  api: GeneralPreferencesApi
  windowControls?: WindowControlsApi
  windowClose?: import('@contracts').WindowCloseApi
  browserAccess?: ReactNode
  agents?: AgentProfile[]
  initialPreferences?: GeneralPreferencesSnapshot | null
  onPreferencesChange?(preferences: GeneralPreferencesSnapshot): void
}): React.JSX.Element {
  if (!api) throw new Error(uiAttribute('通用设置缺少客户端偏好适配。'))
  const t = useUiText()
  const interfaceLanguage = useInterfaceLanguage()
  const [preferences, setPreferences] = useState<GeneralPreferencesSnapshot | null>(initialPreferences)
  const [languageError, setLanguageError] = useState<string | null>(null)
  const languageRequest = useRef(0)
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
      acceptPreferences(await api.get())
    } catch (error) {
      setPreferenceError(errorMessage(error))
    }
  }, [acceptPreferences, api])

  const loadResetCapability = useCallback(async (): Promise<void> => {
    if (!windowControls) return
    try {
      setResetCapability(await windowControls.getResetCapability())
      setResetError(null)
    } catch (error) {
      setResetError(errorMessage(error))
    }
  }, [windowControls])

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
    if (!windowControls) return
    const refreshWindowState = (): void => {
      void loadResetCapability()
    }
    window.addEventListener('focus', refreshWindowState)
    window.addEventListener('resize', loadResetCapability)
    return () => {
      window.removeEventListener('focus', refreshWindowState)
      window.removeEventListener('resize', loadResetCapability)
    }
  }, [loadResetCapability, windowControls])

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
      acceptPreferences(await api.setStartupLocationMode(mode))
      setFeedback(uiAttribute('启动位置偏好已保存。'))
    } catch (error) {
      setPreferences(previous)
      setPreferenceError(errorMessage(error))
    } finally {
      setPreferenceBusy(false)
    }
  }

  const setInterfaceLanguage = async (language: InterfaceLanguage): Promise<void> => {
    if (!preferences || language === interfaceLanguage) return
    const request = ++languageRequest.current
    setLanguageError(null)
    try {
      await changeInterfaceLanguage(api, language, acceptPreferences)
    } catch {
      if (request === languageRequest.current) setLanguageError(t('语言偏好未能保存，请重试。'))
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
      const saved = await api.setNewConversationDefaults(draft)
      acceptPreferences(saved)
      setDefaultMemberIds(saved.newConversationDefaults?.memberAgentIds ?? [])
      setDefaultLeadId(saved.newConversationDefaults?.defaultLeadAgentId ?? '')
      setDefaultsDirty(false)
      setFeedback(uiAttribute('默认队员与默认队长已保存。'))
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
      acceptPreferences(await api.setOneClickNewConversationEnabled(false))
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
      acceptPreferences(await api.setOneClickNewConversationEnabled(true))
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
      acceptPreferences(await api.setWorldMapEnabled(enabled))
      setFeedback(enabled
        ? uiAttribute('世界地图已开启。')
        : uiAttribute('世界地图已关闭，会话将保留在时间线。'))
    } catch (error) {
      setPreferences(previous)
      setWorldMapError(errorMessage(error))
    } finally {
      setWorldMapBusy(false)
    }
  }

  const resetWindow = async (): Promise<void> => {
    if (!windowControls) return
    setResetBusy(true)
    setResetError(null)
    try {
      const result = await windowControls.resetBounds()
      if (!result.performed) {
        setResetCapability({ canReset: false, reason: result.reason })
        return
      }
      setFeedback(uiAttribute('窗口大小与位置已重置。'))
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
  const worldMapEnabled = preferences?.worldMapEnabled ?? false
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
  const memberSeparator = interfaceLanguage === 'en' ? ', ' : '、'
  const memberPickerSummary = selectedMemberNames.length === 0
    ? t('尚未选择队员')
    : selectedMemberNames.length <= 2
      ? selectedMemberNames.join(memberSeparator)
      : t('{0}等 {1} 位', selectedMemberNames.slice(0, 2).join(memberSeparator), selectedMemberNames.length)
  const defaultMemberList = (
    <div className="general-default-member-list" role="group" aria-label={uiAttribute("默认队员")}>
      {visibleMemberCandidates.map((agent) => {
        const selected = defaultMemberIds.includes(agent.agentId)
        const available = agent.presence === 'present' && agent.removedAt === null
        const unavailableLabel = agent.presence === 'away'
          ? uiAttribute('暂时离队')
          : agent.presence === 'removed'
            ? uiAttribute('已永久移除')
            : agent.displayName === agent.agentId
              ? uiAttribute('队员不存在')
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
            <span><strong>{agent.displayName}</strong><small>{unavailableLabel ? t(unavailableLabel) : (agent.teamRole || t('队员'))}</small></span>
          </label>
        )
      })}
      {visibleMemberCandidates.length === 0 && (
        <p className="general-default-members-empty">
          {defaultMemberCandidates.length === 0 ? uiAttribute("当前没有可选择的在队队员。") : uiAttribute("没有匹配的队员。")}
        </p>
      )}
    </div>
  )

  return (
    <>
    <div className="general-settings">
      <SettingsPageHeader
        eyebrow="Settings / General"
        title={uiAttribute("通用")}
        description={windowControls ? uiAttribute("设置启动位置、新对话和窗口行为。") : uiAttribute("设置启动位置、新对话和会话偏好。")}
      />

      <div className="general-settings-body">
        {browserAccess}
        <section className="section-block general-settings-section general-language-section" aria-labelledby="general-language-heading">
          <div className="section-heading"><div><h2 id="general-language-heading">{t('界面语言')}</h2></div></div>
          <div className="general-section-body">
            <div className="general-language-options" role="radiogroup" aria-labelledby="general-language-heading">
              {(['zh-CN', 'en'] as const).map((language) => (
                <label key={language} className={interfaceLanguage === language ? 'selected' : ''}>
                  <input type="radio" name="interface-language" value={language}
                    checked={interfaceLanguage === language} disabled={!preferences}
                    onChange={() => void setInterfaceLanguage(language)} />
                  <span>{language === 'zh-CN' ? uiAttribute("简体中文") : 'English'}</span>
                </label>
              ))}
            </div>
            {languageError && <p className="general-inline-status is-error" role="alert">{languageError}</p>}
          </div>
        </section>
        <section className="section-block general-settings-section" aria-labelledby="general-startup-heading">
          <div className="section-heading"><div><h2 id="general-startup-heading"><UiText zh={"启动后打开"} /></h2><p><UiText zh={"稳定位置偏好"} /></p></div></div>
          <div className="general-section-body">
            <fieldset className="startup-location-options" disabled={!preferences || preferenceBusy}>
              <legend><UiText zh={"启动后打开"} /></legend>
              <label className="startup-location-option">
                <input
                  type="radio"
                  name="startup-location"
                  value="last_location"
                  checked={startupMode === 'last_location'}
                  onChange={() => void setStartupLocationMode('last_location')}
                />
                <span><strong><UiText zh={"上次使用的位置"} /></strong><small><UiText zh={"恢复最近打开的对话、队员页或记忆页。"} /></small></span>
              </label>
              <label className="startup-location-option">
                <input
                  type="radio"
                  name="startup-location"
                  value="quick_chat"
                  checked={startupMode === 'quick_chat'}
                  onChange={() => void setStartupLocationMode('quick_chat')}
                />
                <span><strong><UiText zh={"快速对话"} /></strong><small><UiText zh={"每次启动都从快速对话首页开始。"} /></small></span>
              </label>
            </fieldset>
            {preferenceBusy && <p className="general-inline-status" role="status"><UiText zh={"正在保存启动位置偏好…"} /></p>}
            {preferenceError && (
              <div className="general-inline-status is-error" role="alert">
                <span>{preferenceError}</span>
                <button className="quiet-button compact" type="button" onClick={() => void loadPreferences()}><UiText zh={"重新读取"} /></button>
              </div>
            )}
          </div>
        </section>

        <section className="section-block general-settings-section" aria-labelledby="general-new-conversation-heading">
          <div className="section-heading"><div><h2 id="general-new-conversation-heading"><UiText zh={"新对话"} /></h2><p><UiText zh={"默认队员与创建方式"} /></p></div></div>
          <div className="general-section-body">
            <div className="general-configurator">
              <div className="general-config-head">
                <div><h3><UiText zh={"默认队员"} /></h3><p><UiText zh={"选择创建新对话时默认加入的队员。"} /></p></div>
                <span>{defaultMemberIds.length > 0 ? t('已选 {0} 位', defaultMemberIds.length) : t('尚未配置')}</span>
              </div>

              {shouldCollapseMembers
                ? (
                  <details className="general-default-member-picker">
                    <summary>
                      <span><strong>{memberPickerSummary}</strong><small>{t('共 {0} 位队员，展开后可多选', defaultMemberCandidates.length)}</small></span>
                      <span><UiText zh={"管理队员"} /></span>
                      <ChevronDownIcon />
                    </summary>
                    <div className="general-default-member-picker-panel">
                      <label className="general-default-member-search">
                        <SearchIcon />
                        <input
                          type="search"
                          value={defaultMemberQuery}
                          placeholder={uiAttribute("搜索队员")}
                          aria-label={uiAttribute("搜索默认队员")}
                          onChange={(event) => setDefaultMemberQuery(event.target.value)}
                        />
                      </label>
                      {defaultMemberList}
                    </div>
                  </details>
                )
                : defaultMemberList}

              <div className="general-default-lead general-default-lead-row">
                <span><strong><UiText zh={"默认队长"} /></strong><small><UiText zh={"队长必须是已选择的默认队员。"} /></small></span>
                <GeneralLeadSelect agents={defaultMemberIds.map((agentId) => profileById.get(agentId) ?? missingAgentProfile(agentId))}
                  value={defaultLeadId} disabled={defaultsBusy || defaultMemberIds.length === 0}
                  onChange={(agentId) => {
                    setDefaultLeadId(agentId)
                    setDefaultsDirty(true)
                    setDefaultsError(null)
                  }} />
              </div>

              {preferences?.newConversationDefaultsRequireConfirmation && (
                <p className="general-defaults-attention" role="status"><UiText zh={"已保存的默认队员或默认队长曾失效，请重新选择并保存确认。"} /></p>
              )}
              {defaultsError && <p className="general-inline-status is-error" role="alert">{defaultsError}</p>}
              <div className="general-save-row">
                <span className={`general-draft-state ${defaultsDraftError ? 'is-error' : ''}`} role="status">
                  {defaultsDraftError ? t(defaultsDraftError) : t(defaultsDirty ? uiAttribute("有未保存的更改") : uiAttribute("已保存"))}
                </span>
                <button
                  className="primary-button compact"
                  type="button"
                  disabled={!preferences || defaultsBusy || !defaultsDirty || Boolean(defaultsDraftError)}
                  onClick={() => void saveNewConversationDefaults()}
                >
                  <DialogControlIcon name="save" />{defaultsBusy ? uiAttribute("正在保存…") : uiAttribute("保存")}
                </button>
              </div>

              <div className="general-one-click-setting">
                <div className="general-one-click-row">
                  <span>
                    <span className="general-one-click-title">
                      <strong><UiText zh={"一键创建新对话"} /></strong>
                      <span className="general-help-anchor">
                        <span className="general-help-mark" aria-hidden="true"><HelpCircleIcon /></span>
                        <span className="general-help-popover" id="general-one-click-help" role="tooltip">
                          <strong><UiText zh={"一键创建如何工作？"} /></strong>
                          <span><UiText zh={"开启后，新对话入口会立即创建空对话，不再询问项目、队员、队长或名称。"} /></span>
                          <span>{t(ONE_CLICK_PROJECT_HELP)}</span>
                          <span><UiText zh={"队员和队长始终使用本页保存的默认配置。"} /></span>
                          <span><UiText zh={"关闭此开关即可恢复创建弹窗。"} /></span>
                        </span>
                      </span>
                    </span>
                    <small><UiText zh={"跳过创建弹窗，使用入口对应的项目和已保存的队员配置。"} /></small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={uiAttribute("一键创建新对话")}
                    checked={oneClickEnabled}
                    disabled={!preferences || oneClickBusy || (!oneClickEnabled && !oneClickCanEnable)}
                    onChange={(event) => void setOneClickEnabled(event.target.checked)}
                  />
                </div>
                {oneClickEnabled && (
                  savedDefaults
                    ? <p className="general-effective-summary">{t('{0} 位默认队员 · 队长 {1}', savedDefaults.members.length, savedDefaults.lead.displayName)}</p>
                    : <p className="general-effective-summary attention" role="status"><UiText zh={"默认队员配置需要重新确认。一键创建时将改为打开创建弹窗。"} /></p>
                )}
                {!preferences?.newConversationDefaults && (
                  <p className="general-one-click-unavailable"><UiText zh={"请先保存默认队员与默认队长，再开启一键创建。"} /></p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="section-block general-settings-section" aria-labelledby="general-conversation-heading">
          <div className="section-heading"><div><h2 id="general-conversation-heading"><UiText zh={"会话"} /></h2><p><UiText zh={"阅读面与沉浸视图"} /></p></div></div>
          <div className="general-section-body">
            <label className="general-world-map-setting">
              <span>
                <strong><UiText zh={"世界地图"} /></strong>
                <small id="general-world-map-description"><UiText zh={"在对话中显示地图视图及切换入口。"} /></small>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label={uiAttribute("启用世界地图")}
                aria-describedby="general-world-map-description"
                checked={worldMapEnabled}
                disabled={!preferences || worldMapBusy}
                onChange={(event) => void setWorldMapEnabled(event.target.checked)}
              />
            </label>
            {worldMapBusy && <p className="general-inline-status" role="status"><UiText zh={"正在保存会话偏好…"} /></p>}
            {worldMapError && (
              <div className="general-inline-status is-error" role="alert">
                <span>{worldMapError}</span>
                <button className="quiet-button compact" type="button" onClick={() => void loadPreferences()}><UiText zh={"重新读取"} /></button>
              </div>
            )}
          </div>
        </section>

        {windowControls && <section className="section-block general-settings-section" aria-labelledby="general-window-heading">
          <div className="section-heading"><div><h2 id="general-window-heading"><UiText zh={"窗口"} /></h2><p><UiText zh={"本机显示位置"} /></p></div></div>
          {windowClose && <WindowCloseSettings api={windowClose} />}
          <div className="general-section-body general-window-row">
            <p className="general-window-description"><UiText zh={"自动记住窗口大小与位置。需要时可恢复默认。"} /></p>
            <button
              className="quiet-button"
              type="button"
              disabled={resetBusy || !resetCapability?.canReset}
              onClick={() => void resetWindow()}
            >
              {resetBusy ? uiAttribute("正在重置…") : uiAttribute("重置窗口")}
            </button>
            {resetBlockedByFullscreen && <p className="general-inline-status"><UiText zh={"请先退出全屏，再重置窗口大小与位置"} /></p>}
            {resetError && (
              <div className="general-inline-status is-error" role="alert">
                <span>{resetError}</span>
                <button className="quiet-button compact" type="button" onClick={() => void loadResetCapability()}><UiText zh={"重试"} /></button>
              </div>
            )}
          </div>
        </section>}
      </div>
      <div className="sr-only" aria-live="polite">{feedback ? t(feedback) : null}</div>
    </div>
    <Dialog.Root open={oneClickConfirmOpen} onOpenChange={(open) => !oneClickBusy && setOneClickConfirmOpen(open)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent className="one-click-confirm-dialog" tone="info" aria-describedby="one-click-confirm-description">
          <AppDialogHeader
            title={uiAttribute("开启一键新建？")}
            description={uiAttribute("新对话将直接使用以下默认设置。")}
            descriptionId="one-click-confirm-description"
            icon="bolt"
            kicker={uiAttribute("创建方式变化")}
            closeDisabled={oneClickBusy}
          />
          <AppDialogBody>
            <details className="app-dialog-disclosure"><summary><UiText zh={"查看适用入口"} /></summary><div className="app-dialog-choice-list">
              {ONE_CLICK_ENTRY_DESCRIPTIONS.map((description, index) => (
                <div className="app-dialog-choice" key={description}>
                  <span aria-hidden="true"><AppDialogGlyph name={index === ONE_CLICK_ENTRY_DESCRIPTIONS.length - 1 ? 'folder' : 'bolt'} /></span>
                  <strong>{t(description)}</strong>
                </div>
              ))}
            </div></details>
            <AppDialogFactGrid>
              <AppDialogFact label={uiAttribute("项目")}><UiText zh={"由新建入口决定"} /></AppDialogFact>
              <AppDialogFact label={uiAttribute("默认队员")}>{t('{0} 位', savedMemberNames.length)}</AppDialogFact>
              <AppDialogFact label={uiAttribute("默认队长")}>{savedLeadName ?? '—'}</AppDialogFact>
            </AppDialogFactGrid>
            <p className="app-dialog-supporting-copy"><UiText zh={"如需重新选择项目、队员、队长或对话名称，请先在设置中关闭“一键创建新对话”。"} /></p>
          </AppDialogBody>
          <AppDialogFooter>
            <Dialog.Close asChild><button className="quiet-button" type="button" autoFocus data-dialog-autofocus disabled={oneClickBusy}><UiText zh={"取消"} /></button></Dialog.Close>
            <button className="primary-button" type="button" disabled={oneClickBusy} onClick={() => void confirmOneClickEnabled()}>
              {oneClickBusy ? uiAttribute("正在开启…") : uiAttribute("开启")}
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
  if (defaults.memberAgentIds.length === 0) return uiAttribute("至少选择一位默认队员。")
  if (!defaults.memberAgentIds.includes(defaults.defaultLeadAgentId)) {
    return uiAttribute("默认队长必须属于默认队员。")
  }
  const profileById = new Map(agents.map((agent) => [agent.agentId, agent]))
  if (defaults.memberAgentIds.some((agentId) => {
    const agent = profileById.get(agentId)
    return !agent || agent.presence !== 'present' || agent.removedAt !== null
  })) return uiAttribute("默认队员中包含已失效队员，请重新选择。")
  const lead = profileById.get(defaults.defaultLeadAgentId)
  if (!lead || lead.presence !== 'present' || lead.removedAt !== null) {
    return uiAttribute("默认队长已失效，请重新选择。")
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
