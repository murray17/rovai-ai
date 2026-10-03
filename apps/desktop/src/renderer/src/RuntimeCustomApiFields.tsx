import { useId, useState } from 'react'
import type { RuntimeApiKeyChange } from '@contracts'
import { reusableCredential, usesCustomApi, type ConnectionObservation, type NativeCredential, type RuntimeCustomApiConfiguration } from './runtime-connection-editor'
import { DialogControlIcon } from './AppDialog'
import { newCommandId } from '../../shared/command-id'
import { UiText, uiAttribute } from './interface-language'

export function RuntimeCustomApiFields({ value, apiKey, credential, disabled, observation, onChange, onKeyChange }: {
  value: RuntimeCustomApiConfiguration
  apiKey: RuntimeApiKeyChange
  credential?: NativeCredential
  disabled: boolean
  observation?: ConnectionObservation
  onChange(value: RuntimeCustomApiConfiguration): void
  onKeyChange(value: RuntimeApiKeyChange): void
}): React.JSX.Element {
  const id = useId()
  const [revealed, setRevealed] = useState(false)
  const activeApi = usesCustomApi(value)
  const keyInput = apiKey.action === 'replace' ? apiKey.value : ''
  const keyAvailable = reusableCredential(credential)
  const clearing = apiKey.action === 'clear'
  const credentialNote = clearing ? '保存后清除该 API Key，不退出官方登录。' : apiKey.action === 'replace' ? credential?.sourceWritable === false ? '保存后改用新 Key，原凭据来源不变。' : '保存后替换当前 API Key。'
    : keyAvailable ? '已从原生配置读取，无需重新输入。'
      : credential?.status === 'invalid_reference' ? uiAttribute('未能读取 {0}。可填写新 Key，或修复该来源。', credential.sourceLabel)
        : '未找到可复用的凭据，请填写 API Key。'
  const loginStatus = observation?.loginStatus ?? 'unknown'
  return <section className="runtime-startup-section runtime-custom-api" aria-labelledby={`${id}-title`}>
    <div className="runtime-startup-section-heading"><h2 id={`${id}-title`}><UiText zh={"连接设置"} /></h2></div>
    <p className="runtime-custom-api-scope"><UiText zh={"此处修改会同步到该智能体的原生配置。其他共用这份配置的 CLI 或应用也可能受到影响。"} /></p>
      <div className="runtime-connection-choice">
        <span id={`${id}-mode`}><UiText zh={"连接方式"} /></span>
        <fieldset className="segments runtime-connection-segments" aria-labelledby={`${id}-mode`} disabled={disabled}>
          <legend><UiText zh={"连接方式"} /></legend>
          <label><input type="radio" name={`${id}-connection`} value="official_login" checked={value.mode === 'official_login'} onChange={() => { setRevealed(false); onChange({ ...value, mode: 'official_login' }) }} /><UiText zh={"官方登录"} /></label>
          <label><input type="radio" name={`${id}-connection`} value="custom_api" checked={value.mode === 'custom_api'} onChange={() => { setRevealed(false); onChange({ ...value, mode: 'custom_api' }) }} /><UiText zh={"自定义 API"} /></label>
        </fieldset>
      </div>
      {value.mode === null && <p className="runtime-custom-api-note runtime-connection-unselected"><UiText zh={"请选择连接方式。"} /></p>}
      {!activeApi && <div className="runtime-connection-login">
        <div className="runtime-connection-login-row" role="status" aria-atomic="true"><span><UiText zh={"登录状态"} /></span><span className={`runtime-login-status is-${loginStatus}`}>
          {uiAttribute(loginStatus === 'signed_in' ? '已登录' : loginStatus === 'signed_out' ? '未登录' : '未确认')}
        </span></div>
        <details className="runtime-connection-help runtime-login-help" open={loginStatus !== 'signed_in' || undefined}>
          <summary><UiText zh={"登录与账号操作"} /></summary>
          {value.kind === 'claude-code-cli' ? <p><UiText zh={"在本机终端运行 "} /><code>claude</code><UiText zh={"，进入后用 "} /><code>/login</code><UiText zh={" 登录，并选择 Claude 账号。"} /></p>
            : <p><UiText zh={"在本机终端运行 "} /><code>codex login</code><UiText zh={"，按提示完成 ChatGPT 登录。"} /></p>}
          <p><UiText zh={"登录、退出或切换账号在对应 CLI 中操作；完成后重新进入此页。此处切换连接方式不会退出账号。"} /></p>
        </details>
        {observation?.conflict && <p role="alert" className="runtime-startup-result is-warning runtime-connection-conflict">{observation.conflict}</p>}
      </div>}
    {activeApi && <p className="runtime-custom-api-note"><UiText zh={"请求将发送至此接口，可能包含提示词、代码和工具结果。"} /></p>}
    {activeApi && <div id={`${id}-api-fields`} className="runtime-custom-api-fields">
      <label><span><UiText zh={"接口地址（Base URL）"} /></span><input type="url" value={value.baseUrl} placeholder="https://api.example.com" autoComplete="off" spellCheck={false} disabled={disabled} aria-describedby={`${id}-protocol`}
        onChange={(event) => onChange({ ...value, baseUrl: event.target.value })} /></label>
      <p id={`${id}-protocol`} className="runtime-api-protocol">{value.kind === 'claude-code-cli' ? 'Anthropic Messages' : 'OpenAI Responses'}</p>
      {value.baseUrl.trim().toLowerCase().startsWith('http:') && <p className="runtime-startup-result is-warning" role="status"><UiText zh="HTTP 不加密，凭据与请求内容可能在传输中泄露。建议使用 HTTPS。" /></p>}
      <div className="runtime-custom-api-key-row">
        <label htmlFor={`${id}-key`}>API Key</label>
        <div className="runtime-custom-api-key-input">
          <input id={`${id}-key`} type={revealed && keyInput ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} disabled={disabled || credential?.canReplace === false}
            value={keyInput} aria-describedby={`${id}-credential-note${credential?.canReplace === false ? ` ${id}-credential-restriction` : ''}`}
            placeholder={clearing ? uiAttribute('待清除') : keyAvailable ? '••••••••••••••••' : uiAttribute('输入 API Key')}
            onChange={(event) => { if (!event.target.value) setRevealed(false); onKeyChange(event.target.value ? { action: 'replace', value: event.target.value } : { action: 'keep' }) }} />
          <button type="button" className="quiet-button runtime-startup-icon runtime-key-visibility" disabled={disabled || !keyInput}
            aria-label={uiAttribute(revealed ? '隐藏 API Key' : '显示 API Key')} aria-pressed={Boolean(revealed && keyInput)}
            title={uiAttribute(revealed ? '隐藏本次输入' : '显示本次输入')} onClick={() => setRevealed(!revealed)}>
            <DialogControlIcon name={revealed && keyInput ? 'eye-off' : 'eye'} />
          </button>
        </div>
      </div>
      {credential?.canReplace === false && <p id={`${id}-credential-restriction`} className="runtime-credential-restriction" role="status"><UiText zh={"来源："} />{credential.sourceLabel}。{credential.restriction}。{credential.remedy}</p>}
      <div className="runtime-native-credential-row">
        <p id={`${id}-credential-note`} className={`runtime-native-credential-note${!keyAvailable && apiKey.action === 'keep' ? ' is-warning' : ''}`} role="status">{uiAttribute(credentialNote)}</p>
        {clearing ? <button type="button" className="quiet-button runtime-key-clear-undo" disabled={disabled} onClick={() => onKeyChange({ action: 'keep' })}><UiText zh={"撤销清除"} /></button>
          : credential?.status === 'available' && credential.canClear && <button type="button" className="quiet-button danger-text runtime-key-clear" disabled={disabled} onClick={() => { setRevealed(false); onKeyChange({ action: 'clear' }) }}><UiText zh={"清除 API Key"} /></button>}
      </div>
      {value.kind === 'claude-code-cli' && <>
        {([['model', '主模型'], ['reasoningModel', '推理模型（Thinking）'], ['haikuModel', 'Haiku 默认模型'], ['sonnetModel', 'Sonnet 默认模型'], ['opusModel', 'Opus 默认模型']] as const).map(([field, label]) =>
          <label key={field}><span>{uiAttribute(label)}</span><input value={value.models[field]} placeholder={uiAttribute("模型 ID（选填）")} autoComplete="off" spellCheck={false} disabled={disabled}
            onChange={(event) => onChange({ ...value, models: { ...value.models, [field]: event.target.value } })} /></label>)}
      </>}
      {value.kind === 'codex-cli' && <CodexApiModels value={value} disabled={disabled} onChange={onChange} />}
      <details className="runtime-connection-help runtime-api-help"><summary><UiText zh={"填写说明"} /></summary>
        <p><UiText zh={"地址填写服务方提供的 Base URL，保留路径前缀；不自动补充 /v1，也不填写单个请求的完整路径。"} /></p>
        <p><UiText zh={"不输入新 Key 时沿用当前凭据；输入后保存会替换。清空本次输入只取消替换，要移除现有 Key，请点击“清除 API Key”再保存。眼睛只显示本次输入。"} /></p>
        {credential?.sourceWritable === false && credential.canReplace && <p><UiText zh={"当前来源："} />{credential.sourceLabel}<UiText zh={"。可为此连接换用新 Key；原来源不被改写。"} /></p>}
        {value.kind === 'claude-code-cli' ? <>
          <p><UiText zh={"成员选择“运行时默认”时使用主模型；成员明确指定模型时优先。清空模型字段并保存，会移除对应的原生模型覆盖。"} /></p>
          <p><UiText zh={"推理模型用于兼容映射，不切换 Thinking；是否识别取决于 CLI 版本。新 Key 使用 Bearer 认证；已有原生凭据按其原有方式复用。"} /></p>
        </> : <p><UiText zh={"成员选择“运行时默认”时使用勾选的默认模型；成员明确指定模型时优先。显示名称清空后使用模型 ID。删除默认项前须先指定另一项。"} /></p>}
      </details>
    </div>}
  </section>
}

function CodexApiModels({ value, disabled, onChange }: {
  value: Extract<RuntimeCustomApiConfiguration, { kind: 'codex-cli' }>
  disabled: boolean
  onChange(value: RuntimeCustomApiConfiguration): void
}): React.JSX.Element {
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  return <fieldset className="runtime-custom-api-models"><legend><UiText zh="模型列表" /></legend>
    <div className="runtime-api-model-labels" aria-hidden="true"><span><UiText zh="模型 ID" /></span><span><UiText zh="显示名称（可选）" /></span><span><UiText zh="默认" /></span><span /></div>
    {value.models.map((model, index) => <div className="runtime-api-model-row" key={model.rowId} data-model-row={model.rowId}>
      <label className="runtime-api-model-field"><span><UiText zh="模型 ID" /></span><input aria-label={uiAttribute('模型 ID {0}', String(index + 1))} value={model.id} placeholder={uiAttribute("模型 ID")} disabled={disabled} autoComplete="off" spellCheck={false}
        onChange={(event) => { setError(null); onChange({ ...value, defaultModel: value.defaultRowId === model.rowId ? event.target.value : value.defaultModel,
          models: value.models.map((row, position) => position === index ? { ...row, id: event.target.value } : row) }) }} />
      </label><label className="runtime-api-model-field"><span><UiText zh="显示名称（可选）" /></span><input aria-label={uiAttribute('显示名称 {0}', String(index + 1))} value={model.displayName} placeholder={uiAttribute("显示名称")} disabled={disabled}
        onChange={(event) => onChange({ ...value, models: value.models.map((row, position) => position === index ? { ...row, displayName: event.target.value } : row) })} />
      </label><label className="runtime-api-model-field runtime-api-model-default"><span><UiText zh="默认" /></span><input type="radio" name={`${id}-default`} aria-label={uiAttribute('设为默认模型 {0}', model.id || String(index + 1))} checked={value.defaultRowId === model.rowId} disabled={disabled}
        onChange={() => { setError(null); onChange({ ...value, defaultRowId: model.rowId, defaultModel: model.id }) }} />
      </label><button type="button" className="quiet-button runtime-startup-icon" aria-label={uiAttribute('删除模型 {0}', model.id || String(index + 1))} disabled={disabled} onClick={() => {
        if (model.rowId === value.defaultRowId) { setError(uiAttribute('请先指定新的默认模型，再删除当前默认项。')); return }
        setError(null); onChange({ ...value, models: value.models.filter((_, position) => position !== index) })
      }}><DialogControlIcon name="trash" /></button>
    </div>)}
    {error && <p role="alert" className="runtime-environment-error">{error}</p>}
    <button type="button" className="quiet-button" disabled={disabled || value.models.length >= 128} onClick={() => {
      onChange({ ...value, models: [...value.models, { rowId: newCommandId(), id: '', displayName: '' }] })
    }}><DialogControlIcon name="plus" /><UiText zh="添加模型" /></button>
  </fieldset>
}
