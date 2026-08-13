import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotificationPreference, StoredCommandResult } from '@contracts'
import { SettingsPageHeader } from './SettingsPageHeader'

export type NotificationPreferenceKey =
  | 'headsUpEnabled'
  | 'approvalHeadsUpEnabled'
  | 'userMentionHeadsUpEnabled'
  | 'turnCompletedHeadsUpEnabled'
  | 'turnIncompleteHeadsUpEnabled'

type CategoryPreferenceKey = Exclude<NotificationPreferenceKey, 'headsUpEnabled'>
type SaveStatus = 'idle' | 'saved'

interface SaveAttempt {
  key: NotificationPreferenceKey
  value: boolean
}

interface PreferenceInteraction {
  key: NotificationPreferenceKey
  scrollTop: number | null
}

interface NotificationCategory {
  key: CategoryPreferenceKey
  label: string
  description: string
}

interface NotificationScenario {
  id: string
  title: string
  description: string
  categories: readonly NotificationCategory[]
}

const NOTIFICATION_SCENARIOS: readonly NotificationScenario[] = [
  {
    id: 'response',
    title: '需要响应',
    description: '新的请求或明确提到你的消息。',
    categories: [
      {
        key: 'approvalHeadsUpEnabled',
        label: '待审批',
        description: '有新权限请求需要处理'
      },
      {
        key: 'userMentionHeadsUpEnabled',
        label: '提到你',
        description: '队员在公共 Camp 中明确提到你'
      }
    ]
  },
  {
    id: 'outcome',
    title: '本轮结果',
    description: '协作完成或未完成的结果。',
    categories: [
      {
        key: 'turnCompletedHeadsUpEnabled',
        label: '本轮完成',
        description: '本轮完成，等待你的下一步'
      },
      {
        key: 'turnIncompleteHeadsUpEnabled',
        label: '执行未完成',
        description: '本轮失败或无法证明完成'
      }
    ]
  }
]

export function NotificationSettings({
  onOpenNotificationCenter
}: {
  onOpenNotificationCenter(trigger: HTMLButtonElement): void
}): React.JSX.Element {
  const [preference, setPreference] = useState<NotificationPreference | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<NotificationPreferenceKey | null>(null)
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

  const restorePreferenceInteraction = useCallback((key: NotificationPreferenceKey): void => {
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
      const next = await window.rovai.request<NotificationPreference>(
        'notifications.preference.get'
      )
      setPreference(assertPreference(next))
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => clearSavedStatusTimer, [clearSavedStatusTimer])

  const update = async (key: NotificationPreferenceKey, value: boolean): Promise<void> => {
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
      const result = await window.rovai.request<StoredCommandResult>(
        'notifications.preference.update',
        {
          commandId: crypto.randomUUID(),
          command: {
            expectedVersion: preference.version,
            headsUpEnabled: next.headsUpEnabled,
            approvalHeadsUpEnabled: next.approvalHeadsUpEnabled,
            userMentionHeadsUpEnabled: next.userMentionHeadsUpEnabled,
            turnCompletedHeadsUpEnabled: next.turnCompletedHeadsUpEnabled,
            turnIncompleteHeadsUpEnabled: next.turnIncompleteHeadsUpEnabled
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
        const current = await window.rovai.request<NotificationPreference>(
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
        eyebrow="Settings / Notifications"
        title="通知"
        description="这里只决定当前窗口何时显示临时浮层；通知事项仍会保存在通知中心。"
        aside={(
          <button
            className="notification-center-link"
            type="button"
            onClick={(event) => onOpenNotificationCenter(event.currentTarget)}
          >
            打开通知中心
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5 11 11 5M6.5 5H11v4.5" />
            </svg>
          </button>
        )}
      />
      <section className="section-block notification-settings" aria-label="通知浮层设置">
        {loading && !preference && (
          <p className="notification-settings-state" role="status">正在读取通知设置…</p>
        )}
        {!loading && !preference && (
          <div className="notification-settings-state" role="alert">
            <span>{error ?? '通知设置暂时不可用。'}</span>
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
  savingKey: NotificationPreferenceKey | null
  saveStatus: SaveStatus
  error: string | null
  onChange(key: NotificationPreferenceKey, checked: boolean): void
  onRetry(): void
}): React.JSX.Element {
  const headsUpEnabled = preference.headsUpEnabled
  const statusLabel = savingKey ? '保存中…' : saveStatus === 'saved' ? '已保存' : null

  return (
    <fieldset className="notification-switches" aria-busy={Boolean(savingKey)}>
      <legend>浮层提醒类别</legend>
      <div className="notification-master-panel">
        <span className="notification-master-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20">
            <path d="M5.25 8.5a4.75 4.75 0 0 1 9.5 0v3.25l1.35 1.65H3.9l1.35-1.65V8.5Z" />
            <path d="M8.25 15.1a1.9 1.9 0 0 0 3.5 0" />
          </svg>
        </span>
        <div className="notification-master-copy">
          <div className="notification-master-title">
            <h2>浮层提醒</h2>
            <span className={headsUpEnabled ? '' : 'is-off'}>
              {headsUpEnabled ? '已开启' : '已关闭'}
            </span>
          </div>
          <p>显示不抢焦点的新提醒；重新开启时不补弹旧事项。</p>
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
            label="浮层提醒"
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
      <p className="notification-scenario-footnote">
        关闭主开关时会保留四类选择，重新开启后继续使用。
      </p>
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
  savingKey: NotificationPreferenceKey | null
  headsUpEnabled: boolean
  onChange(key: NotificationPreferenceKey, checked: boolean): void
}): React.JSX.Element {
  const enabledCount = scenario.categories.filter((category) => preference[category.key]).length

  return (
    <section className="notification-scenario" aria-labelledby={`notification-scenario-${scenario.id}`}>
      <header className="notification-scenario-heading">
        <h3 id={`notification-scenario-${scenario.id}`}>{scenario.title}</h3>
        <span>{enabledCount} / {scenario.categories.length} 项{headsUpEnabled ? '已开启' : '已保留'}</span>
      </header>
      <p className="notification-scenario-description">{scenario.description}</p>
      {scenario.categories.map((category) => (
        <NotificationSwitch
          key={category.key}
          label={category.label}
          description={category.description}
          checked={preference[category.key]}
          disabled={!headsUpEnabled || Boolean(savingKey && savingKey !== category.key)}
          busy={savingKey === category.key}
          preferenceKey={category.key}
          onChange={(checked) => onChange(category.key, checked)}
        />
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
    || typeof candidate.version !== 'number'
    || typeof candidate.updatedAt !== 'string'
  ) return null
  return candidate as NotificationPreference
}

function assertPreference(value: unknown): NotificationPreference {
  const preference = preferenceFromUnknown(value)
  if (!preference) throw new Error('通知设置合同不兼容。')
  return preference
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
