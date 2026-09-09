import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { AgentRunFileChangesView } from '@contracts'
import { DialogControlIcon } from './AppDialog'
import { useOptionalFileFind } from './FilePreviewFind'
import { agentRunFilePathParts } from './file-changes-presentation'

export function ChangedFileSelect({ files, value, onChange }: {
  files: AgentRunFileChangesView['files']
  value: string
  onChange(evidenceFileId: string): void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState(value)
  const find = useOptionalFileFind()
  const openingFind = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const selected = files.find(file => file.evidenceFileId === value)
  const path = agentRunFilePathParts(selected?.path ?? '')
  const filtered = files.filter(file => file.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const active = filtered.find(file => file.evidenceFileId === activeId) ?? filtered[0]
  const activeIndex = filtered.findIndex(file => file.evidenceFileId === active?.evidenceFileId)

  function changeOpen(next: boolean): void {
    if (next) {
      openingFind.current = false
      setQuery('')
      setActiveId(value)
    }
    setOpen(next)
  }

  function choose(evidenceFileId: string): void {
    onChange(evidenceFileId)
    setOpen(false)
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      event.stopPropagation()
      openingFind.current = true
      setOpen(false)
      find?.controller?.open()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (active) choose(active.evidenceFileId)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const index = Math.max(0, Math.min(filtered.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1)))
      if (filtered[index]) setActiveId(filtered[index].evidenceFileId)
    }
  }

  useEffect(() => {
    if (!open || activeIndex < 0) return
    const container = list.current
    const option = container?.querySelector(`[data-option-index="${activeIndex}"]`)
    if (!container || !option) return
    // Keep keyboard navigation inside the popup's own scroll area.
    const bounds = container.getBoundingClientRect()
    const row = option.getBoundingClientRect()
    if (row.top < bounds.top) container.scrollTop -= bounds.top - row.top
    else if (row.bottom > bounds.bottom) container.scrollTop += row.bottom - bounds.bottom
  }, [open, activeIndex])

  useEffect(() => {
    if (!open || !trigger.current) return
    const observer = new ResizeObserver(() => {
      if (!trigger.current?.getClientRects().length) setOpen(false)
    })
    observer.observe(trigger.current)
    return () => observer.disconnect()
  }, [open])

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild>
        <button ref={trigger} type="button" className="changed-file-trigger"
          aria-label={`选择变更文件，当前 ${path.basename}`} title={selected?.path}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              changeOpen(true)
            }
          }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h10l6 6v10H4Z" /><path d="M14 4v6h6" /></svg>
          <span className="changed-file-copy"><strong>{path.basename}</strong><small>{path.directory}</small></span>
          <DialogControlIcon name="chevron" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="changed-file-popover" align="start" sideOffset={5} collisionPadding={12}
          aria-label="选择变更文件"
          onCloseAutoFocus={event => { if (openingFind.current) event.preventDefault() }}
          onOpenAutoFocus={event => { event.preventDefault(); search.current?.focus() }}>
          <input ref={search} type="search" role="combobox" aria-label="筛选变更文件" placeholder="筛选文件…"
            aria-expanded={open} aria-autocomplete="list" aria-controls={id}
            aria-activedescendant={activeIndex >= 0 ? `${id}-${activeIndex}` : undefined}
            autoComplete="off" value={query} onKeyDown={handleKey}
            onChange={event => { setQuery(event.target.value); setActiveId('') }} />
          <div ref={list} id={id} role="listbox" aria-label="变更文件候选" className="changed-file-options">
            {filtered.map((file, index) => {
              const parts = agentRunFilePathParts(file.path)
              return <div key={file.evidenceFileId} id={`${id}-${index}`} data-option-index={index}
                role="option" aria-selected={file.evidenceFileId === value} title={file.path}
                className={`changed-file-option${file.evidenceFileId === active?.evidenceFileId ? ' is-active' : ''}`}
                onPointerMove={() => setActiveId(file.evidenceFileId)} onClick={() => choose(file.evidenceFileId)}>
                <span className="changed-file-copy"><strong>{parts.basename}</strong><small>{parts.directory}</small></span>
                {file.evidenceFileId === value && <DialogControlIcon name="check" />}
              </div>
            })}
            {!filtered.length && <p className="changed-file-empty" role="status">没有匹配的文件</p>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
