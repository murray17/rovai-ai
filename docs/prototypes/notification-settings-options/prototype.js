const VARIANTS = {
  a: {
    label: 'A · 主从清单',
    summary: '最小改动：一个明确主开关，四个子项用连接线和缩进表达从属关系。'
  },
  b: {
    label: 'B · 场景分组',
    summary: '推荐：主开关统领全局，子项按“需要响应 / 本轮结果”分组。'
  },
  c: {
    label: 'C · 实时预览',
    summary: '解释最直观：选择子项即可看到对应浮层，开关仍独立保存。'
  }
}

const CATEGORIES = {
  approval: {
    setting: 'approval',
    label: '待审批',
    short: '有新权限请求需要处理',
    preview: '有操作等待你确认',
    camp: '通知中心产品收尾'
  },
  incomplete: {
    setting: 'incomplete',
    label: '执行未完成',
    short: '本轮失败或无法证明完成',
    preview: '本轮未能证明完成，请返回查看',
    camp: '通知验收'
  },
  mention: {
    setting: 'mention',
    label: '提到你',
    short: '队员在公共 Camp 中明确提到你',
    preview: '小狐狸：请确认设置页的主从层级',
    camp: '设置交互方案'
  },
  completed: {
    setting: 'completed',
    label: '本轮完成',
    short: '本轮完成，等待你的下一步',
    preview: '本轮已完成，等待你的下一步',
    camp: '通知设置重构'
  }
}

const CATEGORY_ORDER = ['approval', 'mention', 'completed', 'incomplete']
const params = new URLSearchParams(window.location.search)
const requestedVariant = (params.get('variant') || 'b').toLowerCase()

const state = {
  variant: Object.hasOwn(VARIANTS, requestedVariant) ? requestedVariant : 'b',
  theme: params.get('theme') === 'night' ? 'night' : 'day',
  preferences: defaultPreferences(),
  previewType: 'approval',
  saving: false,
  savingSetting: null,
  saveStatus: null,
  error: null,
  failNext: false,
  lastAttempt: null,
  saveTimer: null,
  toastTimer: null
}

const root = document.querySelector('#settings-variant')
const summary = document.querySelector('#variant-summary')
const toast = document.querySelector('#toast')
const themeButton = document.querySelector('#theme-toggle')
const failureButton = document.querySelector('#fail-next')

function defaultPreferences() {
  return {
    master: true,
    approval: true,
    mention: true,
    completed: true,
    incomplete: true
  }
}

function icon(name) {
  return `<svg aria-hidden="true"><use href="#icon-${name}"></use></svg>`
}

function enabledCategoryCount() {
  return CATEGORY_ORDER.filter((type) => state.preferences[CATEGORIES[type].setting]).length
}

function categoryCountLabel(count, total, suffix = '类') {
  return state.preferences.master
    ? `${count} / ${total} ${suffix}已开启`
    : `${count} / ${total} ${suffix}已保留`
}

function saveStateMarkup() {
  if (state.saving) return '<span class="save-state saving" role="status">保存中…</span>'
  if (state.saveStatus === 'saved') return '<span class="save-state saved" role="status">已保存</span>'
  return '<span class="save-state" aria-hidden="true"></span>'
}

function switchMarkup(setting, label, checked, disabled = false) {
  return `
    <label class="switch" aria-label="${label}">
      <input
        type="checkbox"
        role="switch"
        data-setting="${setting}"
        ${checked ? 'checked' : ''}
        ${disabled ? 'disabled' : ''}
      />
      <span class="switch-track" aria-hidden="true"></span>
    </label>`
}

function masterPanel() {
  const enabled = state.preferences.master
  const disabled = state.saving && state.savingSetting !== 'master'
  return `
    <section class="master-panel" aria-labelledby="master-heading">
      <span class="master-icon">${icon('bell')}</span>
      <div class="master-copy">
        <div class="master-title-line">
          <h2 id="master-heading">浮层提醒</h2>
          <span class="master-status ${enabled ? '' : 'is-off'}">${enabled ? '已开启' : '已关闭'}</span>
        </div>
        <p>显示不抢焦点的新提醒；重新开启时不补弹旧事项。</p>
      </div>
      <div class="master-control">
        ${saveStateMarkup()}
        ${switchMarkup('master', '浮层提醒', enabled, disabled)}
      </div>
    </section>
    ${errorMarkup()}`
}

function errorMarkup() {
  if (!state.error) return ''
  return `
    <div class="inline-error" role="alert">
      <span>${state.error}</span>
      <button type="button" data-action="retry-save">重试</button>
    </div>`
}

function settingRow(type) {
  const category = CATEGORIES[type]
  const checked = state.preferences[category.setting]
  const disabled = !state.preferences.master
    || (state.saving && state.savingSetting !== category.setting)
  return `
    <div class="setting-row" data-category="${type}" tabindex="-1">
      <span class="setting-copy">
        <strong>${category.label}</strong>
        <small>${category.short}</small>
      </span>
      ${switchMarkup(category.setting, category.label, checked, disabled)}
    </div>`
}

function renderA() {
  return `
    ${masterPanel()}
    <section class="subsettings ${state.preferences.master ? '' : 'is-disabled'}" aria-labelledby="category-heading">
      <header class="section-intro">
        <h2 id="category-heading">哪些事项弹出提醒</h2>
        <span>${categoryCountLabel(enabledCategoryCount(), 4)}</span>
      </header>
      <div class="branch-list">
        ${CATEGORY_ORDER.map(settingRow).join('')}
      </div>
      <p class="branch-note">关闭主开关时保留这些选择，下次开启继续使用。</p>
    </section>`
}

function scenarioGroup(title, description, types) {
  const enabled = types.filter((type) => state.preferences[CATEGORIES[type].setting]).length
  return `
    <section class="scenario-group" aria-labelledby="scenario-${types[0]}">
      <header class="scenario-heading">
        <h2 id="scenario-${types[0]}">${title}</h2>
        <span>${categoryCountLabel(enabled, types.length, '项')}</span>
      </header>
      <p class="scenario-description">${description}</p>
      ${types.map(settingRow).join('')}
    </section>`
}

function renderB() {
  return `
    ${masterPanel()}
    <div class="scenario-grid subsettings ${state.preferences.master ? '' : 'is-disabled'}">
      ${scenarioGroup('需要响应', '新的请求或明确提到你的消息。', ['approval', 'mention'])}
      ${scenarioGroup('本轮结果', '协作完成或未完成的结果。', ['completed', 'incomplete'])}
    </div>
    <p class="scenario-footnote">关闭主开关时会保留四类选择，重新开启后继续使用。</p>`
}

function previewSettingRow(type) {
  const category = CATEGORIES[type]
  const checked = state.preferences[category.setting]
  const disabled = !state.preferences.master
    || (state.saving && state.savingSetting !== category.setting)
  return `
    <div class="preview-setting-row" data-category="${type}" tabindex="-1">
      <button
        class="preview-selector"
        type="button"
        data-action="select-preview"
        data-type="${type}"
        aria-pressed="${state.previewType === type}"
      >
        <strong>${category.label}</strong>
        <small>${category.short}</small>
      </button>
      ${switchMarkup(category.setting, category.label, checked, disabled)}
    </div>`
}

function headsUpPreview() {
  const category = CATEGORIES[state.previewType]
  const enabled = state.preferences.master && state.preferences[category.setting]
  return `
    <aside class="heads-up-preview ${enabled ? '' : 'is-paused'}" aria-label="${category.label}浮层预览">
      <div class="heads-up-copy">
        <strong>${enabled ? category.label : '此类浮层已关闭'}</strong>
        <span>${enabled ? category.preview : `开启“${category.label}”后可在这里预览。`}</span>
        <small>${enabled ? category.camp : '事项仍会保存在通知中心'}</small>
      </div>
      <span class="heads-up-close" aria-hidden="true">${icon('close')}</span>
    </aside>`
}

function renderC() {
  return `
    ${masterPanel()}
    <div class="preview-grid subsettings ${state.preferences.master ? '' : 'is-disabled'}">
      <section class="preview-settings" aria-labelledby="preview-settings-heading">
        <header class="section-intro">
          <h2 id="preview-settings-heading">提醒类型</h2>
          <span>${categoryCountLabel(enabledCategoryCount(), 4)}</span>
        </header>
        ${CATEGORY_ORDER.map(previewSettingRow).join('')}
      </section>
      <section class="preview-column" aria-labelledby="preview-heading">
        <header><h2 id="preview-heading">浮层预览</h2><span>示意内容</span></header>
        ${headsUpPreview()}
        <p class="preview-note"><strong>选择左侧类型只更新预览，不会修改设置。</strong> 开关保存后立即生效。</p>
      </section>
    </div>`
}

function render() {
  document.documentElement.dataset.theme = state.theme
  summary.textContent = VARIANTS[state.variant].summary

  document.querySelectorAll('[data-variant]').forEach((button) => {
    const selected = button.dataset.variant === state.variant
    button.setAttribute('aria-selected', String(selected))
    button.tabIndex = selected ? 0 : -1
  })

  const night = state.theme === 'night'
  themeButton.innerHTML = `${icon(night ? 'sun' : 'moon')}<span>${night ? '日间' : '夜间'}</span>`
  themeButton.setAttribute('aria-label', night ? '切换到日间主题' : '切换到夜间主题')
  themeButton.title = night ? '切换到日间主题' : '切换到夜间主题'
  const failureLabel = state.failNext ? '取消下次保存失败模拟' : '模拟下次保存失败'
  failureButton.setAttribute('aria-label', failureLabel)
  failureButton.title = failureLabel
  failureButton.setAttribute('aria-pressed', String(state.failNext))

  if (state.variant === 'a') root.innerHTML = renderA()
  if (state.variant === 'b') root.innerHTML = renderB()
  if (state.variant === 'c') root.innerHTML = renderC()

  root.dataset.variant = state.variant
  updateLocation()
}

function updateLocation() {
  const url = new URL(window.location.href)
  url.searchParams.set('variant', state.variant)
  url.searchParams.set('theme', state.theme)
  window.history.replaceState(null, '', url)
}

function focusAfterRender(selector) {
  window.requestAnimationFrame(() => {
    const target = document.querySelector(selector)
    target?.focus({ preventScroll: true })
  })
}

function showToast(message) {
  window.clearTimeout(state.toastTimer)
  toast.textContent = message
  toast.hidden = false
  state.toastTimer = window.setTimeout(() => {
    toast.hidden = true
  }, 2400)
}

function settingSelector(setting) {
  return `[data-setting="${setting}"]`
}

function updatePreference(setting, value) {
  if (state.saving) {
    render()
    focusAfterRender(settingSelector(setting))
    return
  }
  if (setting !== 'master' && !state.preferences.master) return

  const previous = { ...state.preferences }
  state.lastAttempt = { setting, value }
  state.preferences = { ...state.preferences, [setting]: value }
  state.saving = true
  state.savingSetting = setting
  state.saveStatus = null
  state.error = null
  window.clearTimeout(state.saveTimer)
  render()
  focusAfterRender(settingSelector(setting))

  state.saveTimer = window.setTimeout(() => {
    if (state.failNext) {
      state.preferences = previous
      state.failNext = false
      state.saving = false
      state.savingSetting = null
      state.error = '保存失败，已恢复之前的设置。'
      render()
      focusAfterRender('[data-action="retry-save"]')
      return
    }

    state.saving = false
    state.savingSetting = null
    state.saveStatus = 'saved'
    state.error = null
    render()
    focusAfterRender(settingSelector(setting))
  }, 480)
}

function retryLastSave() {
  if (!state.lastAttempt || state.saving) return
  const { setting, value } = state.lastAttempt
  updatePreference(setting, value)
}

root.addEventListener('change', (event) => {
  const input = event.target.closest('[data-setting]')
  if (!input) return
  updatePreference(input.dataset.setting, input.checked)
})

root.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')
  if (!action) return
  if (action.dataset.action === 'retry-save') {
    retryLastSave()
    return
  }
  if (action.dataset.action === 'select-preview') {
    state.previewType = action.dataset.type
    render()
    focusAfterRender(`[data-action="select-preview"][data-type="${state.previewType}"]`)
  }
})

document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-action="open-center"]')) return
  showToast('原型：这里会打开通知中心，不会离开当前设置。')
})

const variantButtons = [...document.querySelectorAll('[data-variant]')]

variantButtons.forEach((button) => {
  button.addEventListener('click', () => {
    state.variant = button.dataset.variant
    render()
  })
  button.addEventListener('keydown', (event) => {
    const index = variantButtons.indexOf(button)
    let nextIndex = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % variantButtons.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + variantButtons.length) % variantButtons.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = variantButtons.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const next = variantButtons[nextIndex]
    state.variant = next.dataset.variant
    render()
    next.focus()
  })
})

themeButton.addEventListener('click', () => {
  state.theme = state.theme === 'day' ? 'night' : 'day'
  render()
  themeButton.focus()
})

failureButton.addEventListener('click', () => {
  state.failNext = !state.failNext
  render()
  failureButton.focus()
  showToast(state.failNext ? '下一次开关保存将模拟失败。' : '已取消保存失败模拟。')
})

document.querySelector('#reset').addEventListener('click', () => {
  window.clearTimeout(state.saveTimer)
  state.preferences = defaultPreferences()
  state.previewType = 'approval'
  state.saving = false
  state.savingSetting = null
  state.saveStatus = null
  state.error = null
  state.failNext = false
  state.lastAttempt = null
  render()
  showToast('通知设置原型已重置。')
})

render()
