import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useFilePreview, type FilePreviewTabModel } from './FilePreviewContext'

function tabDomId(tabId: string): string {
  return `file-preview-tab-${tabId}`
}

function panelDomId(tabId: string): string {
  return `file-preview-panel-${tabId}`
}

function visibleTabLabel(tab: FilePreviewTabModel, duplicateNames: ReadonlySet<string>): string {
  if (!duplicateNames.has(tab.file.fileName)) return tab.file.fileName
  const segments = tab.file.displayPath.replace(/\\/gu, '/').split('/').filter(Boolean)
  return segments.slice(-2).join('/') || tab.file.fileName
}

export function FilePreviewTabs(): React.JSX.Element | null {
  const {
    tabs,
    activeTabId,
    activate,
    close,
    hidePane,
    move,
    closeMany,
    openInSystem,
    revealInFolder,
    copyDisplayPath,
    reload,
    returnTarget,
    returnToTarget
  } = useFilePreview()
  const listRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ tabId: string; left: number; top: number } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const tab of tabs) counts.set(tab.file.fileName, (counts.get(tab.file.fileName) ?? 0) + 1)
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name))
  }, [tabs])

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
  if (tabs.length === 0) return null

  const focusTab = (tabId: string): void => {
    window.requestAnimationFrame(() => document.getElementById(tabDomId(tabId))?.focus())
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
    else window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.camp-timeline')?.focus({ preventScroll: true })
    })
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
        className={`file-preview-return${returnTarget ? ' is-surface-return' : ''}`}
        type="button"
        onClick={() => {
          if (returnTarget) {
            returnToTarget()
            return
          }
          hidePane()
          window.requestAnimationFrame(() => {
            document.querySelector<HTMLElement>('.camp-timeline')?.focus({ preventScroll: true })
          })
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m9.5 3.5-4.5 4.5 4.5 4.5M5 8h7" /></svg>
        <span>{returnTarget?.label ?? '返回会话'}</span>
      </button>
      <div className="file-preview-tab-strip" role="tablist" aria-label="打开的文件" ref={listRef}>
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId
          const label = visibleTabLabel(tab, duplicateNames)
          return (
            <div
              className={`file-preview-tab ${active ? 'is-active' : ''}`}
              key={tab.id}
              onContextMenu={(event) => {
                event.preventDefault()
                const width = 196
                const height = 282
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
                aria-label={`${label}${tab.hasExternalUpdate ? '，有更新' : ''}`}
                aria-selected={active}
                aria-controls={panelDomId(tab.id)}
                tabIndex={active ? 0 : -1}
                title={tab.file.displayPath}
                onClick={() => activate(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                <span>{label}</span>
                {tab.hasExternalUpdate && <i className="file-preview-tab-update" aria-hidden="true" />}
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
            aria-label={`${visibleTabLabel(tab, duplicateNames)} 操作`}
            style={{ left: menu.left, top: menu.top }}
          >
            <button role="menuitem" type="button" onClick={() => void runSystemAction(
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
            <div role="separator" />
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
