import { useMemo, useState } from 'react'
import type { InterfaceLanguagePreference } from '@contracts'
import { AppToast, type AppToastValue } from './AppToast'
import { refreshInterfaceLanguage, useInterfaceLanguageSnapshot, useUiText } from './interface-language'

export function LanguagePreferenceOptions({ name, className, disabled = false, onChange }: {
  name: string
  className: string
  disabled?: boolean
  onChange(preference: InterfaceLanguagePreference): void
}): React.JSX.Element {
  const snapshot = useInterfaceLanguageSnapshot()
  const t = useUiText()
  return <div className={className} role="radiogroup" aria-label={t('界面语言')}>
    {(['system', 'zh-CN', 'en'] as const).map(preference => <label key={preference} className={snapshot.interfaceLanguagePreference === preference ? 'selected' : ''}>
      <input type="radio" name={name} value={preference} checked={snapshot.interfaceLanguagePreference === preference}
        disabled={disabled || snapshot.readError !== null} onChange={() => onChange(preference)} />
      <span lang={preference === 'system' ? undefined : preference}>{preference === 'system' ? t('跟随系统') : preference === 'zh-CN' ? '简体中文' : 'English'}</span>
    </label>)}
  </div>
}

/** Visible even when Core or authentication is unavailable. */
export function LanguagePreferenceReadNotice(): React.JSX.Element | null {
  const snapshot = useInterfaceLanguageSnapshot()
  const t = useUiText()
  const [busy, setBusy] = useState(false)
  const message = t('语言偏好暂时无法读取，原记录已保留。')
  const retryLabel = t('重新读取')
  const toast = useMemo<AppToastValue>(() => ({
    message,
    tone: 'neutral',
    persistence: 'until-resolved',
    loading: busy,
    actions: busy ? undefined : [{
      label: retryLabel,
      onSelect: () => {
        setBusy(true)
        void refreshInterfaceLanguage().finally(() => setBusy(false))
      }
    }]
  }), [busy, message, retryLabel])
  if (!snapshot.readError) return null
  return <AppToast toast={toast} onClose={() => undefined} />
}
