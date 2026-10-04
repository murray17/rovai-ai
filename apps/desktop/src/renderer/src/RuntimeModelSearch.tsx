import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { ModelDescriptor } from '@contracts'
import { RuntimePickerCheck, RuntimePickerChevron } from './RuntimeParameterSelect'
import { UiText, uiAttribute } from './interface-language'

const DEFAULT_MODEL = 'runtime_default'
const normalize = (text: string): string => text.normalize('NFKC').trim().toLocaleLowerCase()

export function RuntimeModelSearch({ open, onOpenChange, models, value, label, missingLabel, disabled, loading, failed, notice, onRetry, onSelect }: {
  open: boolean
  onOpenChange(open: boolean): void
  models: ModelDescriptor[]
  value: string
  label: string
  missingLabel: string | null
  disabled: boolean
  loading: boolean
  failed: boolean
  notice: string | null
  onRetry(): void
  onSelect(value: string): void
}): React.JSX.Element {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const tabDismissed = useRef(false)
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState(value)
  const filtered = models.filter(model => normalize(`${model.displayName} ${model.id}`).includes(normalize(query)))
  const enabled = [...filtered.map(model => model.id), DEFAULT_MODEL]
  const active = enabled.includes(activeId) ? activeId : filtered[0]?.id
  const activeIndex = active ? enabled.indexOf(active) : -1
  const activeDescendant = activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined

  function changeOpen(next: boolean): void {
    if (next && disabled) return
    if (next) { composing.current = false; setQuery(''); setActiveId(value); tabDismissed.current = false }
    onOpenChange(next)
  }

  function choose(next: string): void {
    if (disabled || !enabled.includes(next)) return
    onSelect(next)
    onOpenChange(false)
  }

  function handleKey(event: KeyboardEvent<HTMLElement>): void {
    if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const index = enabled.indexOf(active ?? '')
      setActiveId(enabled[(index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length])
    } else if (event.key === 'Enter' && event.target === search.current) {
      event.preventDefault()
      if (active) choose(active)
    } else if (event.key === 'Tab') {
      const localControls = [...(content.current?.querySelectorAll<HTMLElement>('input,button') ?? [])]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled'))
      const localNext = localControls[localControls.indexOf(event.target as HTMLElement) + (event.shiftKey ? -1 : 1)]
      if (localNext) { event.preventDefault(); localNext.focus(); return }
      event.preventDefault()
      const controls = [...document.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]')
          && !content.current?.contains(element) && element.getClientRects().length > 0)
      const next = controls[controls.indexOf(trigger.current!) + (event.shiftKey ? -1 : 1)]
      tabDismissed.current = true
      onOpenChange(false)
      ;(next ?? trigger.current)?.focus()
    }
  }

  useEffect(() => {
    if (disabled && open) onOpenChange(false)
  }, [disabled, open, onOpenChange])

  useEffect(() => {
    const container = scroll.current
    const row = container?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
    if (!open || !container || !row) return
    // Scroll the result area only; never move the surrounding form or fixed default row.
    if (row.offsetTop < container.scrollTop) container.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > container.scrollTop + container.clientHeight) {
      container.scrollTop = row.offsetTop + row.offsetHeight - container.clientHeight
    }
  }, [activeIndex, open, query])

  return <Popover.Root open={open} onOpenChange={changeOpen}>
    <Popover.Trigger asChild>
      <button ref={trigger} className="runtime-model-picker-trigger" type="button" disabled={disabled}
        aria-label={uiAttribute("模型，{0}", String(label))} title={label}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); changeOpen(true) }
        }}>
        <span><strong>{label}</strong></span><RuntimePickerChevron />
      </button>
    </Popover.Trigger>
    <Popover.Portal><Popover.Content ref={content} className="runtime-model-picker-menu runtime-model-search-menu"
      align="start" sideOffset={5} collisionPadding={10} aria-label={uiAttribute("模型选项")}
      onOpenAutoFocus={event => { event.preventDefault(); search.current?.focus() }}
      onCloseAutoFocus={event => { if (tabDismissed.current) event.preventDefault() }}
      onEscapeKeyDown={event => { if (composing.current || event.isComposing) event.preventDefault() }} onKeyDown={handleKey}>
      <div className="runtime-model-search">
        <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
        <input ref={search} role="combobox" aria-label={uiAttribute("搜索模型")} aria-expanded={open}
          aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={activeDescendant}
          placeholder={uiAttribute("搜索模型名称或 ID…")} value={query}
          onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
          onChange={event => { setQuery(event.target.value); setActiveId('') }} />
        {query && <button className="runtime-model-search-clear" type="button" aria-label={uiAttribute("清除模型搜索")}
          onClick={() => { setQuery(''); setActiveId(value); search.current?.focus() }}>
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 4 8 8M4 12l8-8" /></svg>
        </button>}
      </div>
      {notice && <div className="runtime-model-picker-notice" role="status">
        <span>{notice}</span>
        <button type="button" className="runtime-model-picker-retry" disabled={disabled} onClick={onRetry}><UiText zh={"重试"} /></button>
      </div>}
      <div id={`${id}-list`} role="listbox" aria-label={uiAttribute("模型")} className="runtime-picker-options">
        <div ref={scroll} className="runtime-picker-scroll">
          {missingLabel && <div role="option" aria-selected="true" aria-disabled="true" className="runtime-model-picker-item" data-disabled="">
            <span className="runtime-model-picker-copy"><strong>{missingLabel}</strong></span>
          </div>}
          {filtered.map((model, index) => <button key={model.id} type="button" tabIndex={-1}
            role="option" aria-selected={value === model.id} id={`${id}-option-${index}`} data-option-index={index}
            className="runtime-model-picker-item" data-highlighted={active === model.id ? '' : undefined}
            title={[model.displayName, model.id, model.description].filter(Boolean).join('\n')}
            onMouseDown={event => event.preventDefault()} onPointerMove={() => setActiveId(model.id)} onClick={() => choose(model.id)}>
            <span className="runtime-model-picker-copy"><strong>{model.displayName}</strong>
              {model.id !== model.displayName && <small className="is-code">{model.id}</small>}
              {model.description && <small>{model.description}</small>}
            </span>
            <span className="runtime-model-picker-check">{value === model.id && <RuntimePickerCheck />}</span>
          </button>)}
          {!filtered.length && <p className="runtime-model-picker-empty" role="status">
            {query ? uiAttribute("没有匹配的模型，请尝试其他名称或 ID。") : loading ? uiAttribute("正在获取模型列表…") : failed ? uiAttribute("暂时无法获取模型列表。") : uiAttribute("当前没有可选的固定模型。")}
          </p>}
        </div>
        <div className="runtime-picker-default">
          <button type="button" tabIndex={-1} role="option" aria-selected={value === DEFAULT_MODEL}
            id={`${id}-option-${filtered.length}`} className="runtime-model-picker-item"
            data-highlighted={active === DEFAULT_MODEL ? '' : undefined} title={uiAttribute("跟随智能体默认")}
            onMouseDown={event => event.preventDefault()} onPointerMove={() => setActiveId(DEFAULT_MODEL)} onClick={() => choose(DEFAULT_MODEL)}>
            <span className="runtime-model-picker-copy"><strong><UiText zh={"默认"} /></strong></span>
            <span className="runtime-model-picker-check">{value === DEFAULT_MODEL && <RuntimePickerCheck />}</span>
          </button>
        </div>
      </div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}
