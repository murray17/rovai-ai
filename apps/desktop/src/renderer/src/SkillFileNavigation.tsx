import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { SkillContentView } from '@contracts'

interface FileBranch {
  path: string
  files: string[]
  folders: Map<string, FileBranch>
}

function fileTree(paths: string[]): FileBranch {
  const root: FileBranch = { path: '', files: [], folders: new Map() }
  for (const path of paths) {
    const parts = path.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      let folder = node.folders.get(part)
      if (!folder) {
        folder = {
          path: node.path ? `${node.path}/${part}` : part,
          files: [],
          folders: new Map()
        }
        node.folders.set(part, folder)
      }
      node = folder
    }
    node.files.push(path)
  }
  return root
}

function FileIcon({
  kind = 'file'
}: {
  kind?: 'file' | 'folder' | 'code' | 'chevron' | 'check' | 'search'
}): React.JSX.Element {
  const paths = {
    file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6',
    folder: 'M3 5h6l2 3h10v12H3ZM3 8h8',
    code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',
    chevron: 'm9 5 7 7-7 7',
    check: 'm5 12 4 4L19 6',
    search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'
  }
  return (
    <svg
      className={`skill-file-icon skill-file-icon-${kind}`}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  )
}

function contentIcon(path: string): 'code' | 'file' {
  return /\.(?:ya?ml|json|toml|py|sh|js|ts)$/iu.test(path) ? 'code' : 'file'
}

export function SkillFileNavigation({
  files,
  path,
  onSelect,
  children
}: {
  files: SkillContentView['files']
  path: string
  onSelect: (path: string) => void
  children?: ReactNode
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const trigger = useRef<HTMLButtonElement>(null)
  const directory = useRef<HTMLElement>(null)
  const navigation = useRef<HTMLDivElement>(null)
  const directoryId = useId()
  const paths = useMemo(() => files.map((file) => file.path), [files])
  const tree = useMemo(() => fileTree(paths), [paths])
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const name = path.split('/').at(-1)
  const multiple = paths.length > 1
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matches = paths.filter((file) => file.toLocaleLowerCase().includes(normalizedQuery))

  useLayoutEffect(() => {
    if (!expanded) return
    const nav = navigation.current
    const scroll = nav?.closest<HTMLElement>('.capability-detail-scroll')
    const list = directory.current?.querySelector<HTMLElement>('.skill-file-directory-list')
    if (!nav || !scroll || !list) return
    const fit = (): void => {
      const controlsHeight = nav.offsetHeight - list.offsetHeight
      list.style.maxHeight = `${Math.max(40, Math.min(266, scroll.clientHeight - controlsHeight - 16))}px`
      const overflow = nav.getBoundingClientRect().bottom - scroll.getBoundingClientRect().bottom
      if (overflow > 0) scroll.scrollTop += overflow
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [expanded, files.length])

  function close(): void {
    setExpanded(false)
    setQuery('')
    trigger.current?.focus({ preventScroll: true })
  }

  function toggleFolder(folder: string): void {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }

  function navigate(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    const target = event.target
    if (!(target instanceof HTMLButtonElement)) return
    const buttons = [...(directory.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const index = buttons.indexOf(target)
    let next: HTMLButtonElement | undefined
    if (event.key === 'ArrowDown') next = buttons[Math.min(index + 1, buttons.length - 1)]
    if (event.key === 'ArrowUp') next = buttons[Math.max(index - 1, 0)]
    if (event.key === 'Home') next = buttons[0]
    if (event.key === 'End') next = buttons.at(-1)
    const folder = target.dataset.folderPath
    if (
      folder &&
      ((event.key === 'ArrowRight' && collapsed.has(folder)) ||
        (event.key === 'ArrowLeft' && !collapsed.has(folder)))
    ) {
      event.preventDefault()
      toggleFolder(folder)
    } else if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  function fileEntry(file: string, searching = false): React.JSX.Element {
    const directoryName = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''
    return (
      <li key={file}>
        <button
          type="button"
          className="skill-file-entry"
          aria-current={file === path ? 'true' : undefined}
          aria-label={file}
          title={file}
          onClick={() => {
            onSelect(file)
            close()
          }}
        >
          <FileIcon kind={contentIcon(file)} />
          <span className="skill-file-entry-name">{file.split('/').at(-1)}</span>
          {file === 'SKILL.md' && <span className="skill-file-entry-meta">说明文档</span>}
          {searching && directoryName && (
            <span className="skill-file-search-path">{directoryName}</span>
          )}
          {file === path && <FileIcon kind="check" />}
        </button>
      </li>
    )
  }

  function branch(node: FileBranch): React.JSX.Element {
    return (
      <ul>
        {[...node.files]
          .sort((a, b) => a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b))
          .map((file) => fileEntry(file))}
        {[...node.folders].sort(([a], [b]) => a.localeCompare(b)).map(([folderName, folder]) => {
          const open = !collapsed.has(folder.path)
          const id = `${directoryId}-${encodeURIComponent(folder.path)}`
          return (
            <li key={folder.path}>
              <button
                type="button"
                className="skill-file-folder"
                data-folder-path={folder.path}
                title={folder.path}
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                onClick={() => toggleFolder(folder.path)}
              >
                <FileIcon kind="chevron" />
                <FileIcon kind="folder" />
                <span>{folderName}</span>
              </button>
              {open && <div className="skill-file-folder-children" id={id}>{branch(folder)}</div>}
            </li>
          )
        })}
      </ul>
    )
  }

  const label = (
    <>
      <FileIcon kind={contentIcon(path)} />
      <span className="skill-file-current-path">
        {parent && <span className="skill-file-parent">{parent} /</span>}
        <span className="skill-file-basename">{name}</span>
      </span>
    </>
  )
  return (
    <div ref={navigation} className="skill-file-navigation">
      <div className="skill-file-toolbar">
        <div className="skill-file-location">
          {multiple ? (
            <button
              type="button"
              ref={trigger}
              className="skill-file-current"
              aria-label={`切换文件，当前 ${path}`}
              title={`${path} · 切换文件`}
              aria-expanded={expanded}
              aria-controls={expanded ? directoryId : undefined}
              onClick={() => {
                setExpanded(!expanded)
                setQuery('')
              }}
              onKeyDown={(event) => { if (expanded) navigate(event) }}
            >
              {label}
              <FileIcon kind="chevron" />
            </button>
          ) : <span className="skill-file-current" title={path}>{label}</span>}
          {multiple && <span className="skill-file-total">{paths.length} 个文件</span>}
        </div>
        {children}
      </div>
      {multiple && expanded && (
        <nav
          ref={directory}
          id={directoryId}
          className="skill-file-directory"
          aria-label="Skill 文件"
          onKeyDown={navigate}
        >
          {paths.length > 10 && (
            <label className="skill-file-search">
              <FileIcon kind="search" />
              <input
                type="search"
                aria-label="查找文件"
                placeholder="查找文件…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          )}
          <div className="skill-file-directory-list">
            {normalizedQuery ? (
              matches.length ? <ul>{matches.map((file) => fileEntry(file, true))}</ul>
                : <p className="skill-file-empty" role="status">没有匹配的文件。</p>
            ) : branch(tree)}
          </div>
        </nav>
      )}
    </div>
  )
}
