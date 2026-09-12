import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { AppearancePreferences, AppearanceSnapshot } from '@contracts'
import { APPEARANCE_ZOOM_OPTIONS, DEFAULT_APPEARANCE, MAX_READING_FONT_SIZE, MIN_READING_FONT_SIZE, appearancePreferencesEqual } from '../../shared/appearance'
import { SettingsPageHeader } from './SettingsPageHeader'
import { THEME_OPTIONS } from './theme'
import systemThumbnail from './assets/appearance/system.svg'
import dayThumbnail from './assets/appearance/day.svg'
import nightThumbnail from './assets/appearance/night.svg'
import './AppearanceSettings.css'

const thumbnails = { system: systemThumbnail, day: dayThumbnail, night: nightThumbnail }
const previews = ['chat', 'document', 'code'] as const
type Preview = typeof previews[number]
const previewLabels = { chat: '会话', document: '文档', code: '代码' }
const sizeKeys = { chat: 'chatFontSize', document: 'documentFontSize', code: 'codeFontSize' } as const
const sizeLabels = { chat: '会话字号', document: '文档预览字号', code: '代码预览字号' }
const sizeHints = { chat: '对话、单聊正文与输入框', document: 'Markdown 正文，标题与代码块等比例调整', code: '源码、纯文本与文件差异' }
const previewScopes = { chat: '消息正文与输入框', document: 'Markdown 正文、标题、表格与代码块', code: '源码、纯文本与文件差异' }

function Icon({ name }: { name: 'check' | 'reset' | 'minus' | 'plus' | 'arrow' | 'file' | 'code' }): React.JSX.Element {
  const paths = {
    check: 'm5 12 4 4L19 6', reset: 'M3 10a9 9 0 1 1 2 8M3 4v6h6', minus: 'M5 12h14',
    plus: 'M5 12h14M12 5v14', arrow: 'M12 19V5m-6 6 6-6 6 6', file: 'M14 3H6v18h12V7l-4-4ZM14 3v5h4',
    code: 'm8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16'
  }
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>
}

function BrandMark(): React.JSX.Element {
  return <svg className="sample-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 13.16 7.3 17.76 8.84 13.16 10.38 12 15.68 10.84 10.38 6.24 8.84 10.84 7.3Z" fill="currentColor"/><path d="M3 20.96Q12 15.96 21 20.96" fill="none" stroke="currentColor" strokeWidth="2.08" strokeLinecap="round"/></svg>
}

function SizeSetting({ kind, value, disabled, onChange }: {
  kind: Preview; value: number; disabled: boolean; onChange(value: number): void
}): React.JSX.Element {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const accept = (next: number): void => {
    setText(String(next))
    if (next !== value) onChange(next)
  }
  const commitText = (): void => {
    const number = Number(text)
    accept(text.trim() && Number.isFinite(number)
      ? Math.max(MIN_READING_FONT_SIZE, Math.min(MAX_READING_FONT_SIZE, Math.round(number))) : value)
  }
  return <div className="setting-row">
    <div className="setting-copy"><label htmlFor={`appearance-${kind}-size`}>{sizeLabels[kind]}</label><p id={`appearance-${kind}-hint`}>{sizeHints[kind]}</p></div>
    <div className="size-stepper">
      <button type="button" aria-label={`减小${sizeLabels[kind]}`} disabled={disabled || value <= MIN_READING_FONT_SIZE} onClick={() => accept(value - 1)}><Icon name="minus" /></button>
      <input id={`appearance-${kind}-size`} aria-describedby={`appearance-${kind}-hint`} type="number" min={MIN_READING_FONT_SIZE} max={MAX_READING_FONT_SIZE} step="1" value={text} disabled={disabled}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          const number = Number(next)
          if (next !== '' && Number.isInteger(number) && number >= MIN_READING_FONT_SIZE && number <= MAX_READING_FONT_SIZE && number !== value) onChange(number)
        }} onBlur={commitText} onKeyDown={(event) => { if (event.key === 'Enter') commitText() }} />
      <span className="unit" aria-hidden="true">px</span>
      <button type="button" aria-label={`增大${sizeLabels[kind]}`} disabled={disabled || value >= MAX_READING_FONT_SIZE} onClick={() => accept(value + 1)}><Icon name="plus" /></button>
    </div>
  </div>
}

export function AppearanceSettings({ appearance, disabled, platform = 'darwin', zoomManagedBy = 'desktop', onChange }: {
  appearance: AppearanceSnapshot
  disabled: boolean
  platform?: NodeJS.Platform
  zoomManagedBy?: 'desktop' | 'browser'
  onChange(preferences: AppearancePreferences): Promise<AppearanceSnapshot>
}): React.JSX.Element {
  const [draft, setDraft] = useState<AppearancePreferences>(appearance)
  const desired = useRef<AppearancePreferences>(appearance)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const request = useRef(0)
  const pending = useRef(false)
  const failed = useRef(false)
  const mounted = useRef(true)
  const [preview, setPreview] = useState<Preview>('chat')
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!pending.current && !failed.current) {
      desired.current = appearance
      setDraft(appearance)
    }
  }, [appearance])

  const change = async (patch: Partial<AppearancePreferences>): Promise<void> => {
    const next = { ...desired.current, ...patch }
    // Only persisted preference fields cross the bridge; derived theme stays Main-owned.
    const preferences = Object.fromEntries(Object.keys(DEFAULT_APPEARANCE).map((key) => [key, next[key as keyof AppearancePreferences]])) as unknown as AppearancePreferences
    desired.current = preferences
    const generation = ++request.current
    pending.current = true
    failed.current = false
    setDraft(preferences)
    setSaving(true)
    setSaveError(false)
    try {
      const saved = await onChange(preferences)
      if (!mounted.current || generation !== request.current) return
      desired.current = saved
      setDraft(saved)
    } catch {
      if (!mounted.current || generation !== request.current) return
      failed.current = true
      setSaveError(true)
    } finally {
      if (mounted.current && generation === request.current) {
        pending.current = false
        setSaving(false)
      }
    }
  }
  const switchPreview = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % previews.length
    else if (event.key === 'ArrowLeft') next = (index + previews.length - 1) % previews.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = previews.length - 1
    else return
    event.preventDefault()
    setPreview(previews[next])
    tabs.current[next]?.focus()
  }
  const style = {
    '--chat-size': `${draft.chatFontSize}px`, '--document-size': `${draft.documentFontSize}px`, '--code-size': `${draft.codeFontSize}px`,
    '--preview-gap-scale': draft.readingDensity === 'relaxed' ? 1.5 : 1,
    '--prose-leading': draft.readingDensity === 'relaxed' ? 1.85 : 1.65,
    '--paragraph-gap': draft.readingDensity === 'relaxed' ? '14px' : '9px',
    '--message-gap': draft.readingDensity === 'relaxed' ? '25px' : '19px'
  } as CSSProperties
  const zoomOptions = APPEARANCE_ZOOM_OPTIONS.includes(draft.zoomPercentage) ? APPEARANCE_ZOOM_OPTIONS : [...APPEARANCE_ZOOM_OPTIONS, draft.zoomPercentage].sort((a, b) => a - b)
  const themeLabel = appearance.resolvedTheme === 'night' ? '夜间' : '日间'
  const sourceDegraded = Boolean(appearance.degradation)
  const shortcut = platform === 'darwin' ? '⌘' : 'Ctrl'

  return <div className="appearance-settings-page" style={style}>
    <SettingsPageHeader eyebrow="Settings / Appearance" title="外观" description="调整 Rovai AI 的界面主题、文字大小与阅读体验。" aside={<div className="heading-actions">
      <span className="save-state" role="status" aria-live="polite">{!saving && !saveError && !sourceDegraded && <Icon name="check" />}{saving ? '保存中…' : saveError || sourceDegraded ? '未保存' : '已保存'}</span>
      <button className="quiet-button" type="button" disabled={disabled || (!saveError && !sourceDegraded && appearancePreferencesEqual(draft, DEFAULT_APPEARANCE))} onClick={() => void change(DEFAULT_APPEARANCE)}><Icon name="reset"/>恢复默认</button>
    </div>} />
    {sourceDegraded && !saveError && <div className="appearance-save-error" role="alert"><span>无法读取已保存的外观设置，当前使用默认值。</span><button type="button" className="quiet-button" disabled={saving} onClick={() => void change(desired.current)}>保存当前设置</button></div>}
    {saveError && <div className="appearance-save-error" role="alert"><span>未能保存设置，已保留当前调整。</span><button type="button" className="quiet-button" onClick={() => void change(desired.current)}>重试保存</button></div>}
    <section className="settings-section" aria-labelledby="appearance-theme-heading">
      <div className="section-heading"><h2 id="appearance-theme-heading">界面主题</h2><span>{appearance.preference === 'system' ? `当前跟随系统 · ${themeLabel}` : `当前为${themeLabel}`}</span></div>
      <fieldset className="appearance-options" disabled={disabled}><legend>界面主题</legend>
        {THEME_OPTIONS.map((option) => <label key={option.value} className="appearance-option">
          <input type="radio" name="theme-preference" value={option.value} checked={draft.preference === option.value} onChange={() => void change({ preference: option.value })}/>
          <span className="theme-thumbnail" aria-hidden="true"><img src={thumbnails[option.value]} width="640" height="360" alt="" draggable={false}/></span>
          <span className="theme-card-caption"><span className="theme-card-copy"><strong>{option.label}</strong><small>{option.englishLabel}</small></span><span className="theme-card-check" aria-hidden="true"><Icon name="check"/></span></span>
        </label>)}
      </fieldset>
    </section>
    <section className="settings-section" aria-labelledby="appearance-reading-heading">
      <div className="section-heading"><h2 id="appearance-reading-heading">文字与阅读</h2><span>调整时即时预览</span></div>
      <div className="reading-grid"><div className="reading-controls">
        {previews.map((kind) => <SizeSetting key={kind} kind={kind} value={draft[sizeKeys[kind]]} disabled={disabled} onChange={(value) => { setPreview(kind); void change({ [sizeKeys[kind]]: value }) }}/>) }
        <div className="setting-row"><div className="setting-copy"><span className="setting-label" id="appearance-density-label">阅读疏密</span><p>调整正文行距与段落间距</p></div><fieldset className="segments" aria-labelledby="appearance-density-label" disabled={disabled}><legend>阅读疏密</legend>{(['standard', 'relaxed'] as const).map((density) => <label key={density}><input type="radio" name="appearance-density" value={density} checked={draft.readingDensity === density} onChange={() => void change({ readingDensity: density })}/>{density === 'standard' ? '标准' : '宽松'}</label>)}</fieldset></div>
        <p className="reading-note">默认字号：会话 13 · 文档 15 · 代码 14 px</p>
      </div><div className="preview" aria-label="文字阅读预览">
        <div className="preview-heading"><span>阅读预览</span><div className="preview-tabs" role="tablist" aria-label="预览内容">{previews.map((kind, index) => <button key={kind} ref={(node) => { tabs.current[index] = node }} type="button" role="tab" id={`appearance-tab-${kind}`} aria-controls={`appearance-preview-${kind}`} aria-selected={preview === kind} tabIndex={preview === kind ? 0 : -1} onClick={() => setPreview(kind)} onKeyDown={(event) => switchPreview(event, index)}>{previewLabels[kind]}</button>)}</div></div>
        <div className="preview-panel preview-conversation" role="tabpanel" id="appearance-preview-chat" aria-labelledby="appearance-tab-chat" tabIndex={0} hidden={preview !== 'chat'}>
          <div className="sample-messages"><div className="sample-user"><div className="sample-meta"><span>你</span><span>09:41</span></div><p>帮我梳理一下这个项目。</p></div><div className="sample-agent"><div className="sample-meta"><BrandMark/><strong>队员</strong><span>09:42</span></div><p>我会先查看目录结构，再整理关键模块。</p><p>从 <code className="inline-code">README.md</code> 开始，确认项目的入口与运行方式。</p></div></div>
          <div className="sample-composer" aria-label="输入框字号示例"><span>继续聊聊这个项目…</span><Icon name="arrow"/></div>
        </div>
        <div className="preview-panel" role="tabpanel" id="appearance-preview-document" aria-labelledby="appearance-tab-document" tabIndex={0} hidden={preview !== 'document'}><article className="document-sample"><h3>开始协作</h3><p>在 Camp 中与队员一起完成任务。阅读过程，查看结果，随时补充新的想法。</p><h4>查看项目结构</h4><p>先阅读 <code className="inline-code">README.md</code>，再确认目录与入口。</p><pre><code>{'pnpm install\npnpm dev'}</code></pre><table className="sample-table"><caption className="sr-only">示例目录说明</caption><tbody><tr><td>apps/desktop</td><td>桌面应用</td></tr><tr><td>packages</td><td>共享模块</td></tr></tbody></table></article></div>
        <div className="preview-panel" role="tabpanel" id="appearance-preview-code" aria-labelledby="appearance-tab-code" tabIndex={0} hidden={preview !== 'code'}><div className="file-label"><Icon name="code"/>workspace.ts</div><div className="code-lines" aria-label="TypeScript 代码示例">{[
          <span className="token-comment">// 为新任务准备工作区</span>, <><span className="token-keyword">const</span>{' workspace = {'}</>, <>  name: <span className="token-string">'Rovai AI'</span>,</>, <>  members: [<span className="token-string">'设计'</span>, <span className="token-string">'开发'</span>],</>, <>  ready: <span className="token-keyword">true</span></>, '}', ' ', <><span className="token-keyword">await</span> openCamp(workspace)</>
        ].map((line, index) => <div className="code-line" key={index}><span className="line-number" aria-hidden="true">{index + 1}</span><code>{line}</code></div>)}</div></div>
        <div className="preview-caption"><span>{previewScopes[preview]}</span><output>{draft[sizeKeys[preview]]} px · {draft.readingDensity === 'standard' ? '标准' : '宽松'}</output></div>
      </div></div>
    </section>
    <section className="settings-section display-section" aria-labelledby="appearance-display-heading">
      <div className="section-heading"><h2 id="appearance-display-heading">显示与动效</h2></div>
      <div className="setting-row"><div className="setting-copy"><label htmlFor={zoomManagedBy === 'desktop' ? 'appearance-zoom' : undefined}>界面缩放</label><p id="appearance-zoom-hint">{zoomManagedBy === 'browser' ? '使用浏览器菜单或快捷键调整缩放，由当前浏览器保存。恢复外观默认值不会重置浏览器缩放。' : '按比例调整整个应用，包括导航、按钮与文字。'}</p></div><div className="setting-action"><span className="shortcut" aria-label="缩小、放大、恢复默认缩放"><kbd>{shortcut} −</kbd><kbd>{shortcut} +</kbd><kbd>{shortcut} 0</kbd></span>{zoomManagedBy === 'desktop' && <select className="setting-select" id="appearance-zoom" aria-describedby="appearance-zoom-hint" value={draft.zoomPercentage} disabled={disabled} onChange={(event) => void change({ zoomPercentage: Number(event.target.value) })}>{zoomOptions.map((zoom) => <option key={zoom} value={zoom}>{zoom === 100 ? '100%（默认）' : `${zoom}%`}</option>)}</select>}</div></div>
      <div className="setting-row"><div className="setting-copy motion-copy"><label htmlFor="appearance-motion">减少动态效果</label><p id="appearance-motion-hint">减少弹窗位移、标签动画和平滑滚动，保留状态与进度提示。</p></div><select className="setting-select" id="appearance-motion" aria-describedby="appearance-motion-hint" disabled={disabled} value={draft.motionPreference} onChange={(event) => void change({ motionPreference: event.target.value as AppearancePreferences['motionPreference'] })}><option value="system">跟随系统</option><option value="reduce">始终减少</option></select></div>
    </section>
  </div>
}
