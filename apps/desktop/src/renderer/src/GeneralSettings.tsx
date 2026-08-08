import { useCallback, useEffect, useState } from 'react'
import type {
  GeneralPreferencesSnapshot,
  LoginItemSnapshot,
  StartupLocationMode,
  WindowResetCapability
} from '@contracts'
import { SettingsPageHeader } from './SettingsPageHeader'

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

export function GeneralSettings(): React.JSX.Element {
  const [preferences, setPreferences] = useState<GeneralPreferencesSnapshot | null>(null)
  const [preferenceBusy, setPreferenceBusy] = useState(false)
  const [preferenceError, setPreferenceError] = useState<string | null>(null)
  const [loginItem, setLoginItem] = useState<LoginItemSnapshot | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [resetCapability, setResetCapability] = useState<WindowResetCapability | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const loadPreferences = useCallback(async (): Promise<void> => {
    setPreferenceError(null)
    try {
      setPreferences(await window.rovai.generalPreferences.get())
    } catch (error) {
      setPreferenceError(errorMessage(error))
    }
  }, [])

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
      setPreferences(await window.rovai.generalPreferences.setStartupLocationMode(mode))
      setFeedback('启动位置偏好已保存。')
    } catch (error) {
      setPreferences(previous)
      setPreferenceError(errorMessage(error))
    } finally {
      setPreferenceBusy(false)
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

  return (
    <div className="general-settings">
      <SettingsPageHeader
        eyebrow="Settings / General"
        title="通用"
        description="设置 Rovai-ai 的启动方式与窗口行为。"
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
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
