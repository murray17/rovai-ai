import { useCallback, useEffect, useState } from 'react'
import type { InAppNotificationPreference, StoredCommandResult } from '@contracts'
import { SettingsPageHeader } from './SettingsPageHeader'

type PreferenceKey =
  | 'headsUpEnabled'
  | 'approvalHeadsUpEnabled'
  | 'executionHeadsUpEnabled'
  | 'userMentionHeadsUpEnabled'

export function NotificationSettings({
  onOpenNotificationCenter
}: {
  onOpenNotificationCenter(trigger: HTMLButtonElement): void
}): React.JSX.Element {
  const [preference, setPreference] = useState<InAppNotificationPreference | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const next = await window.rovai.request<InAppNotificationPreference>(
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

  const update = async (key: PreferenceKey, value: boolean): Promise<void> => {
    if (!preference || saving) return
    const next = { ...preference, [key]: value }
    setPreference(next)
    setSaving(true)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>(
        'notifications.preference.update',
        {
          commandId: crypto.randomUUID(),
          command: {
            expectedVersion: preference.version,
            headsUpEnabled: next.headsUpEnabled,
            approvalHeadsUpEnabled: next.approvalHeadsUpEnabled,
            executionHeadsUpEnabled: next.executionHeadsUpEnabled,
            userMentionHeadsUpEnabled: next.userMentionHeadsUpEnabled
          }
        }
      )
      if (result.status !== 'applied') {
        const current = preferenceFromUnknown(result.payload)
        if (current) setPreference(current)
        else await load()
        throw new Error('设置已在其他窗口更新，请检查当前值后重试。')
      }
      setPreference(assertPreference(result.payload))
    } catch (nextError) {
      const message = errorMessage(nextError)
      await load()
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SettingsPageHeader
        eyebrow="Settings / Notifications"
        title="通知"
        description="待审批、执行结果和消息提及始终保存在通知中心；这里只控制新通知的临时浮层。"
        aside={(
          <button className="primary-button" type="button" onClick={(event) => onOpenNotificationCenter(event.currentTarget)}>
            打开通知中心
          </button>
        )}
      />
      <section className="section-block notification-settings" aria-labelledby="notification-heads-up-heading">
        <div className="section-heading">
          <div>
            <h2 id="notification-heads-up-heading">浮层提醒</h2>
            <p>重新开启后仅提醒新通知，不补弹关闭期间的旧事项。</p>
          </div>
          {saving && <span className="status-badge status-running"><i />保存中</span>}
        </div>
        {loading && <p className="notification-settings-state">正在读取通知设置…</p>}
        {!loading && !preference && (
          <div className="notification-settings-state" role="alert">
            <span>{error ?? '通知设置暂时不可用。'}</span>
            <button className="quiet-button compact" type="button" onClick={() => void load()}>
              重试
            </button>
          </div>
        )}
        {preference && (
          <fieldset className="notification-switches" disabled={saving}>
            <legend>浮层提醒类别</legend>
            <NotificationSwitch
              label="浮层提醒"
              description="在当前窗口内显示不抢焦点的临时提醒。"
              checked={preference.headsUpEnabled}
              onChange={(checked) => void update('headsUpEnabled', checked)}
            />
            <div className="notification-switch-children" aria-disabled={!preference.headsUpEnabled}>
              <NotificationSwitch
                label="待审批"
                description="新的 Runtime 权限事项需要你处理时提醒。"
                checked={preference.approvalHeadsUpEnabled}
                disabled={!preference.headsUpEnabled}
                onChange={(checked) => void update('approvalHeadsUpEnabled', checked)}
              />
              <NotificationSwitch
                label="执行结束"
                description="一次协作完成或未完成时提醒。"
                checked={preference.executionHeadsUpEnabled}
                disabled={!preference.headsUpEnabled}
                onChange={(checked) => void update('executionHeadsUpEnabled', checked)}
              />
              <NotificationSwitch
                label="消息提及"
                description="有公共 Camp 消息明确提及你时提醒。"
                checked={preference.userMentionHeadsUpEnabled}
                disabled={!preference.headsUpEnabled}
                onChange={(checked) => void update('userMentionHeadsUpEnabled', checked)}
              />
            </div>
          </fieldset>
        )}
        {error && preference && <p className="settings-inline-error" role="alert">{error}</p>}
      </section>
      <section className="section-block notification-boundary" aria-labelledby="notification-boundary-heading">
        <div className="section-heading">
          <h2 id="notification-boundary-heading">持久边界</h2>
        </div>
        <div className="notification-boundary-band">
          <span aria-hidden="true">◇</span>
          <div>
            <strong>关闭浮层不会丢失事项</strong>
            <p>待审批、执行结果和消息提及仍进入通知中心；当前对话的 Approval Dock 和执行状态也保持原有位置。</p>
          </div>
        </div>
      </section>
    </>
  )
}

function NotificationSwitch({
  label,
  description,
  checked,
  disabled = false,
  onChange
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange(checked: boolean): void
}): React.JSX.Element {
  return (
    <label className="notification-switch">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

export function preferenceFromUnknown(value: unknown): InAppNotificationPreference | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<InAppNotificationPreference>
  if (
    typeof candidate.headsUpEnabled !== 'boolean'
    || typeof candidate.approvalHeadsUpEnabled !== 'boolean'
    || typeof candidate.executionHeadsUpEnabled !== 'boolean'
    || typeof candidate.userMentionHeadsUpEnabled !== 'boolean'
    || typeof candidate.version !== 'number'
    || typeof candidate.updatedAt !== 'string'
  ) return null
  return candidate as InAppNotificationPreference
}

function assertPreference(value: unknown): InAppNotificationPreference {
  const preference = preferenceFromUnknown(value)
  if (!preference) throw new Error('通知设置合同不兼容。')
  return preference
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
