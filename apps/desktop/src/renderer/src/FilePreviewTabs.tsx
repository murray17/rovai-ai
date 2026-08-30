import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useFilePreview } from './FilePreviewContext'
import { FilePreviewTabIcon } from './FilePreviewTabIcon'
import { previewTabLabel, previewTabPresentation } from './file-preview-tab-presentation'

function tabDomId(tabId: string): string {
  return `file-preview-tab-${tabId}`
}

function panelDomId(tabId: string): string {
  return `file-preview-panel-${tabId}`
}

export function FilePreviewTabs({ compact = false }: { compact?: boolean } = {}): React.JSX.Element | null {
  const {
    tabs,
    activeTabId,
    openFeedback,
    paneVisible,
    activate,
    close,
    hidePane,
    move,
    closeMany,
    openInSystem,
    revealInFolder,
    copyDisplayPath,
    reload
  } = useFilePreview()
  const listRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ tabId: string; left: number; top: number } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const tab of tabs) {
      const key = `${tab.kind}:${previewTabPresentation(tab).fileName}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name))
  }, [tabs])

  useEffect(() => {
    if (!paneVisible || !openFeedback || openFeedback.tabId !== activeTabId) return
    const tab = document.getElementById(tabDomId(openFeedback.tabId))
    tab?.parentElement?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'instant'
    })
    if (openFeedback.focusTab
      && (document.activeElement === document.body || document.activeElement?.closest('.file-preview-pane'))) {
      tab?.focus({ preventScroll: true })
    }
  }, [activeTabId, openFeedback, paneVisible])

  useEffect(() => {
    if (compact && paneVisible) {
      const target = listRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
        ?? listRef.current?.parentElement?.querySelector<HTMLButtonElement>('.file-preview-return')
      target?.focus({ preventScroll: true })
    }
  }, [compact, paneVisible])

  useEffect(() => {
    if (!menu) return undefined
    const dismiss = (event: Event): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setMenu(null)
    }
    const keydown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      const tabId = menu.tabId
      setMenu(null)
      focusTab(tabId)
    }
    window.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', keydown, true)
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    return () => {
      window.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', keydown, true)
    }
  }, [menu])

  useEffect(() => {
    if (menu && !tabs.some((tab) => tab.id === menu.tabId)) setMenu(null)
  }, [menu, tabs])

  const focusTab = (tabId: string): void => {
    window.requestAnimationFrame(() => document.getElementById(tabDomId(tabId))?.focus())
  }

  const focusConversation = (): void => {
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('.camp-timeline:not([hidden])')
        ?? document.querySelector<HTMLElement>('.timeline-pane')
      target?.focus({ preventScroll: true })
    })
  }

  const announce = (message: string): void => {
    setAnnouncement(message)
    window.setTimeout(() => setAnnouncement(''), 1_800)
  }

  const runSystemAction = async (
    action: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>,
    successMessage: string
  ): Promise<void> => {
    setMenu(null)
    const result = await action()
    announce(result.ok ? successMessage : result.error.message)
  }

  const closeAndRestoreFocus = (index: number): void => {
    const tab = tabs[index]
    if (!tab) return
    const neighbor = tabs[index + 1] ?? tabs[index - 1]
    close(tab.id)
    if (neighbor) focusTab(neighbor.id)
    else focusConversation()
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.altKey && event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      const direction = event.key === 'ArrowLeft' ? -1 : 1
      move(tabs[index].id, direction)
      focusTab(tabs[index].id)
      return
    }
    if (event.key === 'Delete') {
      event.preventDefault()
      closeAndRestoreFocus(index)
      return
    }
    let next = index
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <div className="file-preview-tabs">
      <button
        className="file-preview-return"
        type="button"
        onClick={() => {
          hidePane()
          focusConversation()
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m9.5 3.5-4.5 4.5 4.5 4.5M5 8h7" /></svg>
        <span>返回会话</span>
      </button>
      <div className="file-preview-tab-strip" role={tabs.length ? 'tablist' : undefined} aria-label="打开的预览" ref={listRef}>
        {tabs.length === 0 && <span className="file-preview-tabs-empty">文件预览</span>}
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId
          const label = previewTabLabel(tab, duplicateNames)
          const { displayPath, icon } = previewTabPresentation(tab)
          const hasExternalUpdate = tab.kind === 'file' && tab.hasExternalUpdate
          const feedback = openFeedback?.tabId === tab.id ? openFeedback : null
          return (
            <div
              className={`file-preview-tab${active ? ' is-active' : ''}${feedback?.isNew ? ' is-arriving' : ''}`}
              key={tab.id}
              onContextMenu={(event) => {
                event.preventDefault()
                const width = 196
                const height = tab.kind === 'file' ? 282 : 134
                const keyboardInvocation = event.clientX === 0 && event.clientY === 0
                const bounds = event.currentTarget.getBoundingClientRect()
                const requestedLeft = keyboardInvocation ? bounds.left + 8 : event.clientX
                const requestedTop = keyboardInvocation ? bounds.bottom + 4 : event.clientY
                setMenu({
                  tabId: tab.id,
                  left: Math.max(8, Math.min(requestedLeft, window.innerWidth - width - 8)),
                  top: Math.max(8, Math.min(requestedTop, window.innerHeight - height - 8))
                })
              }}
            >
              <button
                id={tabDomId(tab.id)}
                className="file-preview-tab-activate"
                type="button"
                role="tab"
                aria-label={`${label}${hasExternalUpdate ? '，有更新' : ''}`}
                aria-selected={active}
                aria-controls={panelDomId(tab.id)}
                tabIndex={active ? 0 : -1}
                title={tab.kind === 'file_change' ? `${displayPath}\nFile Change · ${tab.changes.completedAt}` : displayPath}
                onClick={() => activate(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                <FilePreviewTabIcon kind={icon} />
                <span className="file-preview-tab-label">{label}</span>
                {hasExternalUpdate && <i className="file-preview-tab-update" aria-hidden="true" />}
              </button>
              <button
                className="file-preview-tab-close"
                type="button"
                aria-label={`关闭 ${label}`}
                title={`关闭 ${label}`}
                onClick={() => closeAndRestoreFocus(index)}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
              </button>
              {feedback && (
                <span
                  key={feedback.sequence}
                  className="file-preview-tab-open-feedback"
                  data-open-sequence={feedback.sequence}
                  aria-hidden="true"
                />
              )}
            </div>
          )
        })}
      </div>
      {menu && createPortal((() => {
        const index = tabs.findIndex((tab) => tab.id === menu.tabId)
        const tab = tabs[index]
        if (!tab) return null
        const platform = document.documentElement.dataset.rovaiPlatform
        const revealLabel = platform === 'win32' ? '在文件资源管理器中显示' : '在 Finder 中显示'
        const closeRight = tabs.slice(index + 1).map((entry) => entry.id)
        const closeOthers = tabs.filter((entry) => entry.id !== tab.id).map((entry) => entry.id)
        return (
          <div
            ref={menuRef}
            className="file-preview-tab-menu"
            role="menu"
            aria-label={`${previewTabLabel(tab, duplicateNames)} 操作`}
            style={{ left: menu.left, top: menu.top }}
          >
            {tab.kind === 'file' && <><button role="menuitem" type="button" onClick={() => void runSystemAction(
              () => openInSystem(tab.id),
              '已交给系统默认应用打开'
            )}>使用默认应用打开</button>
            <button role="menuitem" type="button" onClick={() => void runSystemAction(
              () => revealInFolder(tab.id),
              '已在文件夹中定位'
            )}>{revealLabel}</button>
            <button role="menuitem" type="button" onClick={() => void runSystemAction(
              () => copyDisplayPath(tab.id),
              '已复制相对路径'
            )}>复制相对路径</button>
            <button role="menuitem" type="button" onClick={() => {
              setMenu(null)
              void reload(tab.id)
            }}>重新加载</button>
            <div role="separator" /></>}
            <button role="menuitem" type="button" onClick={() => {
              setMenu(null)
              close(tab.id)
            }}>关闭</button>
            <button role="menuitem" type="button" disabled={closeOthers.length === 0} onClick={() => {
              setMenu(null)
              activate(tab.id)
              closeMany(closeOthers)
            }}>关闭其他文件</button>
            <button role="menuitem" type="button" disabled={closeRight.length === 0} onClick={() => {
              setMenu(null)
              closeMany(closeRight)
            }}>关闭右侧文件</button>
            <button role="menuitem" type="button" onClick={() => {
              setMenu(null)
              closeMany(tabs.map((entry) => entry.id))
            }}>关闭全部文件</button>
          </div>
        )
      })(), document.body)}
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </div>
  )
}
