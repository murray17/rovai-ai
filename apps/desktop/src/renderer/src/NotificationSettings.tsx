import { useCampClient } from './camp-client'
import { newCommandId } from '../../shared/command-id'
import { readErrorMessage } from './error-message'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotificationPreference, StoredCommandResult } from '@contracts'
import { SettingsPageHeader } from './SettingsPageHeader'

export type NotificationPreferenceKey =
  | 'headsUpEnabled'
  | 'approvalHeadsUpEnabled'
  | 'userMentionHeadsUpEnabled'
  | 'turnCompletedHeadsUpEnabled'
  | 'turnIncompleteHeadsUpEnabled'
  | 'singleChatHeadsUpEnabled'
  | 'missionNeedsYouHeadsUpEnabled'
  | 'missionStatusHeadsUpEnabled'
  | 'taskStatusHeadsUpEnabled'

type FilterKey = 'missionStatuses' | 'taskStatuses'
type SettingKey = NotificationPreferenceKey | FilterKey
type SettingValue = boolean | NotificationPreference[FilterKey]

type CategoryPreferenceKey = Exclude<NotificationPreferenceKey, 'headsUpEnabled'>
type SaveStatus = 'idle' | 'saved'

interface SaveAttempt {
  key: SettingKey
  value: SettingValue
}

interface PreferenceInteraction {
  key: SettingKey
  scrollTop: number | null
}

interface NotificationCategory {
  key: CategoryPreferenceKey
  label: string
  description: string
  filter?: FilterKey
}

interface NotificationScenario {
  id: string
  title: string
  categories: readonly NotificationCategory[]
}

const NOTIFICATION_SCENARIOS: readonly NotificationScenario[] = [
  { id: 'conversation', title: '会话', categories: [
    { key: 'approvalHeadsUpEnabled', label: '待审批', description: '公共会话或单聊有权限请求时提醒' },
    { key: 'userMentionHeadsUpEnabled', label: '提到你', description: '队员在公共会话中明确提到你' },
    { key: 'turnCompletedHeadsUpEnabled', label: '本轮完成', description: '本次消息引发的全部协作结束后，只提醒一次' },
    { key: 'singleChatHeadsUpEnabled', label: '单聊回复', description: '队员在单聊中完成回复时提醒' },
    { key: 'turnIncompleteHeadsUpEnabled', label: '执行未完成', description: '公共会话或单聊失败、未完成时提醒' }
  ] },
  { id: 'mission', title: '使命', categories: [
    { key: 'missionNeedsYouHeadsUpEnabled', label: '使命需要你', description: '使命进入“需要你”状态时提醒' },
    { key: 'missionStatusHeadsUpEnabled', label: '使命状态变更', description: '使命进入所选状态时提醒', filter: 'missionStatuses' }
  ] },
  { id: 'task', title: '任务', categories: [
    { key: 'taskStatusHeadsUpEnabled', label: '任务状态变更', description: '任务进入所选状态时提醒', filter: 'taskStatuses' }
  ] }
]

const STATUS_OPTIONS: Record<FilterKey, readonly { value: string; label: string }[]> = {
  missionStatuses: [{ value: 'completed', label: '已完成' }, { value: 'in_progress', label: '进行中' }, { value: 'not_started', label: '未开始' }],
  taskStatuses: [{ value: 'completed', label: '已完成' }, { value: 'blocked', label: '受阻' }, { value: 'cancelled', label: '已取消' }, { value: 'in_progress', label: '进行中' }, { value: 'pending', label: '待开始' }]
}

export function NotificationSettings(): React.JSX.Element {
  const client = useCampClient()
  const [preference, setPreference] = useState<NotificationPreference | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<SettingKey | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [lastAttempt, setLastAttempt] = useState<SaveAttempt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const savedStatusTimerRef = useRef<number | null>(null)
  const interactionRef = useRef<PreferenceInteraction | null>(null)

  const clearSavedStatusTimer = useCallback((): void => {
    if (savedStatusTimerRef.current === null) return
    window.clearTimeout(savedStatusTimerRef.current)
    savedStatusTimerRef.current = null
  }, [])

  const restorePreferenceInteraction = useCallback((key: SettingKey): void => {
    const interaction = interactionRef.current
    if (!interaction || interaction.key !== key) return
    window.requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>('.settings-panel-notifications')
      if (panel && interaction.scrollTop !== null) panel.scrollTop = interaction.scrollTop
      document.querySelector<HTMLInputElement>(
        `[data-notification-preference="${key}"]`
      )?.focus({ preventScroll: true })
    })
  }, [])

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const next = await client.request<NotificationPreference>(
        'notifications.preference.get'
      )
      setPreference(assertPreference(next))
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => clearSavedStatusTimer, [clearSavedStatusTimer])

  const update = async (key: SettingKey, value: SettingValue): Promise<void> => {
    if (!preference || savingKey) return

    const previous = preference
    const next = { ...preference, [key]: value }
    let lastKnownCurrent = previous
    const panel = document.querySelector<HTMLElement>('.settings-panel-notifications')
    interactionRef.current = { key, scrollTop: panel?.scrollTop ?? null }
    clearSavedStatusTimer()
    setPreference(next)
    setSavingKey(key)
    setSaveStatus('idle')
    setLastAttempt({ key, value })
    setError(null)
    restorePreferenceInteraction(key)

    try {
      const result = await client.request<StoredCommandResult>(
        'notifications.preference.update',
        {
          commandId: newCommandId(),
          command: {
            expectedVersion: preference.version,
            headsUpEnabled: next.headsUpEnabled,
            approvalHeadsUpEnabled: next.approvalHeadsUpEnabled,
            userMentionHeadsUpEnabled: next.userMentionHeadsUpEnabled,
            turnCompletedHeadsUpEnabled: next.turnCompletedHeadsUpEnabled,
            turnIncompleteHeadsUpEnabled: next.turnIncompleteHeadsUpEnabled,
            singleChatHeadsUpEnabled: next.singleChatHeadsUpEnabled,
            missionNeedsYouHeadsUpEnabled: next.missionNeedsYouHeadsUpEnabled,
            missionStatusHeadsUpEnabled: next.missionStatusHeadsUpEnabled,
            taskStatusHeadsUpEnabled: next.taskStatusHeadsUpEnabled,
            missionStatuses: next.missionStatuses,
            taskStatuses: next.taskStatuses
          }
        }
      )
      if (result.status !== 'applied') {
        const current = preferenceFromUnknown(result.payload)
        if (current) {
          lastKnownCurrent = current
          setPreference(current)
        }
        throw new Error('设置已在其他窗口更新，请检查当前值后重试。')
      }

      setPreference(assertPreference(result.payload))
      setLastAttempt(null)
      setSaveStatus('saved')
      savedStatusTimerRef.current = window.setTimeout(() => {
        setSaveStatus('idle')
        savedStatusTimerRef.current = null
      }, 1800)
    } catch (nextError) {
      let message = errorMessage(nextError)
      try {
        const current = await client.request<NotificationPreference>(
          'notifications.preference.get'
        )
        setPreference(assertPreference(current))
      } catch {
        setPreference(lastKnownCurrent)
        message = `${message} 当前值暂时无法重新读取。`
      }
      setError(message)
    } finally {
      setSavingKey(null)
      restorePreferenceInteraction(key)
    }
  }

  const retryLastSave = (): void => {
    if (!lastAttempt || savingKey) return
    const { key, value } = lastAttempt
    void update(key, value)
  }

  return (
    <>
      <SettingsPageHeader
        eyebrow="Settings / Reminders"
        title="提醒"
        description="设置需要显示临时浮层的提醒。"
      />
      <section className="section-block notification-settings" aria-label="应用内提醒设置">
        {loading && !preference && (
          <p className="notification-settings-state" role="status">正在读取提醒设置…</p>
        )}
        {!loading && !preference && (
          <div className="notification-settings-state" role="alert">
            <span>{error ?? '提醒设置暂时不可用。'}</span>
            <button className="quiet-button compact" type="button" onClick={() => void load()}>
              重试
            </button>
          </div>
        )}
        {preference && (
          <NotificationPreferenceEditor
            preference={preference}
            savingKey={savingKey}
            saveStatus={saveStatus}
            error={error}
            onChange={(key, checked) => void update(key, checked)}
            onRetry={retryLastSave}
          />
        )}
      </section>
    </>
  )
}

export function NotificationPreferenceEditor({
  preference,
  savingKey,
  saveStatus,
  error,
  onChange,
  onRetry
}: {
  preference: NotificationPreference
  savingKey: SettingKey | null
  saveStatus: SaveStatus
  error: string | null
  onChange(key: SettingKey, checked: SettingValue): void
  onRetry(): void
}): React.JSX.Element {
  const headsUpEnabled = preference.headsUpEnabled
  const statusLabel = savingKey ? '保存中…' : saveStatus === 'saved' ? '已保存' : null

  return (
    <fieldset className="notification-switches" aria-busy={Boolean(savingKey)}>
      <legend>应用内提醒类别</legend>
      <div className="notification-master-panel">
        <span className="notification-master-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20">
            <path d="M5.25 8.5a4.75 4.75 0 0 1 9.5 0v3.25l1.35 1.65H3.9l1.35-1.65V8.5Z" />
            <path d="M8.25 15.1a1.9 1.9 0 0 0 3.5 0" />
          </svg>
        </span>
        <div className="notification-master-copy">
          <div className="notification-master-title">
            <h2>应用内提醒</h2>
            <span className={headsUpEnabled ? '' : 'is-off'}>
              {headsUpEnabled ? '已开启' : '已关闭'}
            </span>
          </div>
          <p>正在查看的会话保持安静，包含它的使命和任务；重新开启提醒时不补弹旧消息。</p>
        </div>
        <div className="notification-master-control">
          <span
            className={`notification-save-state${savingKey ? ' is-saving' : saveStatus === 'saved' ? ' is-saved' : ''}`}
            role={statusLabel ? 'status' : undefined}
            aria-hidden={statusLabel ? undefined : true}
          >
            {statusLabel ?? ''}
          </span>
          <NotificationSwitch
            label="应用内提醒"
            checked={headsUpEnabled}
            disabled={Boolean(savingKey && savingKey !== 'headsUpEnabled')}
            busy={savingKey === 'headsUpEnabled'}
            controlOnly
            preferenceKey="headsUpEnabled"
            onChange={(checked) => onChange('headsUpEnabled', checked)}
          />
        </div>
      </div>

      {error && (
        <div className="notification-settings-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRetry}>重试</button>
        </div>
      )}

      <div className="notification-scenario-grid" aria-disabled={!headsUpEnabled}>
        {NOTIFICATION_SCENARIOS.map((scenario) => (
          <NotificationScenarioGroup
            key={scenario.id}
            scenario={scenario}
            preference={preference}
            savingKey={savingKey}
            headsUpEnabled={headsUpEnabled}
            onChange={onChange}
          />
        ))}
      </div>
    </fieldset>
  )
}

function NotificationScenarioGroup({
  scenario,
  preference,
  savingKey,
  headsUpEnabled,
  onChange
}: {
  scenario: NotificationScenario
  preference: NotificationPreference
  savingKey: SettingKey | null
  headsUpEnabled: boolean
  onChange(key: SettingKey, checked: SettingValue): void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<FilterKey | null>(null)
  const enabledCount = scenario.categories.filter((category) => preference[category.key]).length

  return (
    <section className={`notification-scenario notification-scenario-${scenario.id}`} aria-labelledby={`notification-scenario-${scenario.id}`}>
      <header className="notification-scenario-heading">
        <h3 id={`notification-scenario-${scenario.id}`}>{scenario.title}</h3>
        <span>{enabledCount} / {scenario.categories.length} 项{headsUpEnabled ? '已开启' : '已保留'}</span>
      </header>
      {scenario.categories.map((category) => (
        <div className="notification-preference-row" key={category.key}>
        <NotificationSwitch
          label={category.label}
          description={category.description}
          checked={preference[category.key]}
          disabled={!headsUpEnabled || Boolean(savingKey && savingKey !== category.key)}
          busy={savingKey === category.key}
          preferenceKey={category.key}
          onChange={(checked) => onChange(category.key, checked)}
        />
        {category.filter && <div className="notification-status-filter">
          <button type="button" className="notification-filter-toggle" aria-expanded={expanded === category.filter}
            disabled={!headsUpEnabled || !preference[category.key] || Boolean(savingKey)}
            data-notification-preference={category.filter}
            onClick={() => setExpanded(expanded === category.filter ? null : category.filter ?? null)}>
            <span>{STATUS_OPTIONS[category.filter].filter(option => (preference[category.filter!] as string[]).includes(option.value)).map(option => option.label).join('、') || '未选择状态'}</span>
            <span>{expanded === category.filter ? '收起' : '选择状态'}</span>
          </button>
          {expanded === category.filter && <div className="notification-filter-options" role="group" aria-label={`${scenario.title}提醒状态`}>
            {STATUS_OPTIONS[category.filter].map(option => <label key={option.value}>
              <input type="checkbox" checked={(preference[category.filter!] as string[]).includes(option.value)}
                disabled={!headsUpEnabled || !preference[category.key] || Boolean(savingKey)}
                onChange={event => {
                  const key = category.filter!
                  const next = STATUS_OPTIONS[key].filter(item => item.value === option.value ? event.target.checked : (preference[key] as string[]).includes(item.value)).map(item => item.value)
                  onChange(key, next as NotificationPreference[FilterKey])
                }} />{option.label}
            </label>)}
          </div>}
        </div>}
        </div>
      ))}
    </section>
  )
}

function NotificationSwitch({
  label,
  description,
  checked,
  disabled = false,
  busy = false,
  controlOnly = false,
  preferenceKey,
  onChange
}: {
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  busy?: boolean
  controlOnly?: boolean
  preferenceKey: NotificationPreferenceKey
  onChange(checked: boolean): void
}): React.JSX.Element {
  return (
    <label className={`notification-switch${controlOnly ? ' notification-master-switch' : ''}${busy ? ' is-busy' : ''}`}>
      {!controlOnly && (
        <span>
          <strong>{label}</strong>
          {description && <small>{description}</small>}
        </span>
      )}
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        aria-disabled={busy || undefined}
        data-notification-preference={preferenceKey}
        checked={checked}
        disabled={disabled}
        onClick={(event) => {
          if (busy) event.preventDefault()
        }}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

export function preferenceFromUnknown(value: unknown): NotificationPreference | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<NotificationPreference>
  if (
    typeof candidate.headsUpEnabled !== 'boolean'
    || typeof candidate.approvalHeadsUpEnabled !== 'boolean'
    || typeof candidate.userMentionHeadsUpEnabled !== 'boolean'
    || typeof candidate.turnCompletedHeadsUpEnabled !== 'boolean'
    || typeof candidate.turnIncompleteHeadsUpEnabled !== 'boolean'
    || typeof candidate.singleChatHeadsUpEnabled !== 'boolean'
    || typeof candidate.missionNeedsYouHeadsUpEnabled !== 'boolean'
    || typeof candidate.missionStatusHeadsUpEnabled !== 'boolean'
    || typeof candidate.taskStatusHeadsUpEnabled !== 'boolean'
    || !validStatusFilter(candidate.missionStatuses, 'missionStatuses')
    || !validStatusFilter(candidate.taskStatuses, 'taskStatuses')
    || typeof candidate.version !== 'number'
    || typeof candidate.updatedAt !== 'string'
  ) return null
  return candidate as NotificationPreference
}

function validStatusFilter(value: unknown, key: FilterKey): boolean {
  return Array.isArray(value) && new Set(value).size === value.length
    && value.every(status => STATUS_OPTIONS[key].some(option => option.value === status))
}

function assertPreference(value: unknown): NotificationPreference {
  const preference = preferenceFromUnknown(value)
  if (!preference) throw new Error('通知设置合同不兼容。')
  return preference
}

function errorMessage(error: unknown): string {
  return readErrorMessage(error)
}
