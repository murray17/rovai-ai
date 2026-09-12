import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { CampMessagePage, NavigationCampItem, NavigationCampPage, NavigationSnapshot } from '@contracts'
import { ConsoleClient, SessionRequired, type ConnectionState, type WebOperation } from './client'
import './styles.css'

const client = new ConsoleClient(window.location.origin)
const sections = [
  ['camp', '对话'], ['members', '队员'], ['tasks', '任务'], ['runtime', 'Runtime'],
  ['memory', '记忆'], ['automations', '自动化'], ['skills', 'Skills'], ['mcp', 'MCP']
] as const
type Section = typeof sections[number][0]
type Row = Record<string, unknown>
const operations: Partial<Record<Section, WebOperation>> = {
  members: 'members.list', tasks: 'tasks.list', runtime: 'runtime.installations.list',
  memory: 'memory.list', automations: 'automations.list', skills: 'skills.list', mcp: 'mcp.config.get'
}
const statusLabels: Record<string, string> = { in_progress: '进行中', pending: '待处理', blocked: '受阻', completed: '已完成', cancelled: '已取消', active: '有效', retired: '已停用', available: '可用', ready: '就绪', missing: '未安装' }

function Markdown({ text }: { text: string }): React.JSX.Element {
  return <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => /^https?:\/\//i.test(href ?? '')
      ? <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> : <span>{children}</span>,
    // Remote images would make an automatic request to an untrusted origin.
    img: ({ alt }) => <span className="web-muted">[图片{alt ? `：${alt}` : ''}]</span>
  }}>{text}</ReactMarkdown>
}

function text(row: Row, ...keys: string[]): string {
  for (const key of keys) if (typeof row[key] === 'string') return row[key] as string
  return ''
}

function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object') as Row[]
  if (!value || typeof value !== 'object') return []
  for (const key of ['items', 'tasks', 'memories', 'automations', 'skills', 'servers', 'installations', 'adapters']) {
    const found = (value as Row)[key]
    if (Array.isArray(found)) return rows(found)
  }
  return []
}

function Workspace(): React.JSX.Element {
  const [loggedIn, setLoggedIn] = useState(false)
  const [credential, setCredential] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [error, setError] = useState('')
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [theme, setTheme] = useState<'day' | 'night'>(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day')
  const [section, setSection] = useState<Section>('camp')
  const [navigation, setNavigation] = useState<NavigationSnapshot | null>(null)
  const [camp, setCamp] = useState<NavigationCampItem | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState<CampMessagePage | null>(null)
  const [resource, setResource] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [readingHistory, setReadingHistory] = useState(false)
  const loading = useRef(false)
  const refreshPending = useRef(false)
  const [extraCamps, setExtraCamps] = useState<Record<string, NavigationCampItem[]>>({})
  const selection = useRef(0)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  const fail = useCallback((failure: unknown): void => {
    if (failure instanceof SessionRequired) {
      selection.current++
      loading.current = false; refreshPending.current = false; setReadingHistory(false)
      setLoggedIn(false); setNavigation(null); setPage(null); setResource(null); setExtraCamps({}); setCamp(null)
    }
    if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
      setError(failure instanceof Error ? failure.message : '读取失败，请重试。')
    }
  }, [])

  const refresh = useCallback((): void => {
    if (loading.current) { refreshPending.current = true; return }
    if (refreshTimer.current) return
    refreshTimer.current = setTimeout(() => { refreshTimer.current = null; setRevision((value) => value + 1) }, 350)
  }, [])

  useEffect(() => {
    if (!loggedIn) return
    const unsubscribe = client.subscribe(refresh, (state) => {
      setConnection(state)
      if (state === 'expired') fail(new SessionRequired())
    })
    return () => { unsubscribe(); if (refreshTimer.current) clearTimeout(refreshTimer.current); refreshTimer.current = null }
  }, [loggedIn, refresh, fail])

  useEffect(() => {
    if (!loggedIn) return
    const current = ++selection.current
    loading.current = true
    setBusy(true); setError('')
    const load = async (): Promise<void> => {
      const snapshot = await client.request<NavigationSnapshot>('navigation.snapshot')
      if (current !== selection.current) return
      setNavigation(snapshot)
      if (section === 'camp') {
        if (!camp) { setPage(null); return }
        // Older pages retain their immutable reading watermark and position.
        // The explicit return action opts back into the latest snapshot.
        if (readingHistory) return
        const next = await client.request<CampMessagePage>('camp.messages.page', {
          campId: camp.id, beforeSequence: Number.MAX_SAFE_INTEGER,
          throughGlobalSequence: snapshot.throughGlobalSequence, limit: 50
        })
        if (current === selection.current) setPage(next)
      } else {
        if (section === 'tasks' && !camp) { setResource(null); return }
        const next = await client.request(operations[section]!, section === 'tasks' ? { campId: camp!.id, limit: 100 } : {})
        if (current === selection.current) setResource(next)
      }
    }
    void load().catch((failure: unknown) => { if (current === selection.current) fail(failure) })
      .finally(() => {
        if (current !== selection.current) return
        setBusy(false); loading.current = false
        if (refreshPending.current) { refreshPending.current = false; refresh() }
      })
    return () => { if (current === selection.current) selection.current++ }
  }, [loggedIn, section, camp, revision, readingHistory, fail, refresh])

  async function login(event: React.FormEvent): Promise<void> {
    event.preventDefault(); if (loginBusy) return
    const token = credential.trim(); setCredential(''); setError(''); setLoginBusy(true)
    try { await client.login(token); setLoggedIn(true) } catch (failure) { fail(failure) }
    finally { setLoginBusy(false) }
  }

  async function older(): Promise<void> {
    if (!page?.hasMore || !camp || busy) return
    const current = selection.current; const previous = page
    setBusy(true); loading.current = true
    try {
      const next = await client.request<CampMessagePage>('camp.messages.page', {
        campId: camp.id, beforeSequence: page.nextBeforeSequence,
        throughGlobalSequence: page.throughGlobalSequence, limit: 50
      })
      if (current === selection.current) { setPage({ ...next, messages: [...next.messages, ...previous.messages] }); setReadingHistory(true) }
    } catch (failure) { if (current === selection.current) fail(failure) }
    finally { if (current === selection.current) { setBusy(false); loading.current = false; if (refreshPending.current) { refreshPending.current = false; refresh() } } }
  }

  async function loadGroup(projectPath: string | null, recent: NavigationCampItem[]): Promise<void> {
    const key = projectPath ?? ''
    try {
      const previous = extraCamps[key] ?? recent
      const next = await client.request<NavigationCampPage>('navigation.groupCamps', { projectPath, offset: previous.length, limit: 100 })
      setExtraCamps((value) => ({ ...value, [key]: [...previous, ...next.camps] }))
    } catch (failure) { fail(failure) }
  }

  const themeButton = <button className="web-quiet" onClick={() => setTheme(theme === 'day' ? 'night' : 'day')}>{theme === 'day' ? '深色外观' : '浅色外观'}</button>
  if (!loggedIn) return <main className="web-login">
    <div className="web-login-top"><strong>Rovai AI</strong>{themeButton}</div>
    <form onSubmit={(event) => void login(event)} className="web-login-form">
      <span className="web-eyebrow">浏览器工作区</span><h1>连接你的工作区</h1>
      <p>使用 Desktop「浏览器访问」或 Server 启动时设置的管理令牌登录。</p>
      <p className="web-origin">{client.origin}</p>
      <label>管理令牌<input autoFocus type="password" value={credential} onChange={(event) => setCredential(event.target.value)} autoComplete="off" spellCheck={false} required disabled={loginBusy} /></label>
      <button className="web-primary" disabled={loginBusy || !credential.trim()}>{loginBusy ? '正在连接…' : '连接工作区'}</button>
      {error && <p role="alert" className="web-error">{error}</p>}
      <p className="web-muted">刷新或关闭页面后需要重新登录。</p>
    </form>
  </main>

  const groups = navigation ? [{ name: '快速对话', projectPath: null, ...navigation.quickChat }, ...navigation.projects] : []
  const list = rows(resource).filter((row) => Object.values(row).filter((value) => typeof value === 'string').join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  return <div className="web-shell">
    <aside className="web-rail">
      <div className="web-brand"><strong>Rovai AI</strong><span>工作区</span></div>
      <nav aria-label="工作区导航">{sections.map(([id, name]) => <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => { setSection(id); setSearch(''); setResource(null) }}>{name}</button>)}</nav>
      <div className="web-camp-list">{groups.map((group) => {
        const camps = extraCamps[group.projectPath ?? ''] ?? group.recentCamps
        return <section key={group.projectPath ?? 'quick'}><h2>{group.name}</h2>{camps.map((item) => <button key={item.id} className={camp?.id === item.id ? 'selected' : ''} onClick={() => { setCamp(item); setSection('camp'); setPage(null); setReadingHistory(false); setSearch('') }}><span>{item.title || '未命名对话'}</span>{item.marker === 'loading' && <span aria-label="正在执行">·</span>}</button>)}{camps.length < group.totalCount && <button className="web-muted" onClick={() => void loadGroup(group.projectPath, group.recentCamps)}>查看更早的对话</button>}</section>
      })}{navigation && groups.every((group) => group.totalCount === 0) && <p className="web-muted">暂无对话</p>}</div>
      <div className="web-rail-bottom">{themeButton}<button className="web-quiet" onClick={() => { void client.logout().catch(() => undefined); fail(new SessionRequired()); setError('') }}>退出登录</button></div>
    </aside>
    <main className="web-workspace">
      <header className="web-topbar"><div><h1>{section === 'camp' ? camp?.title ?? '对话' : sections.find(([id]) => id === section)?.[1]}</h1><p role="status">{connection === 'live' ? '已连接' : connection === 'connecting' ? '正在连接…' : '连接已断开，正在重试'}{busy ? ' · 正在读取…' : ''}</p></div><button className="web-quiet" disabled={busy} onClick={() => setRevision((value) => value + 1)}>刷新</button></header>
      <div className="web-preview-note">浏览预览 · 发送、上传与审批尚未开放</div>
      {error && <div className="web-error web-banner" role="alert">{error}<button className="web-quiet" onClick={() => setRevision((value) => value + 1)}>重试</button></div>}
      {section === 'camp' ? <div className="web-conversation">
        {!camp ? <div className="web-empty"><h2>从左侧选择一段对话</h2><p>查看消息与协作进展。</p></div> : <>
          {readingHistory && <button className="web-quiet web-older" onClick={() => { setReadingHistory(false); setPage(null) }}>返回最新消息</button>}
          {page?.hasMore && <button className="web-quiet web-older" disabled={busy} onClick={() => void older()}>载入更早的消息</button>}
          {page?.messages.length === 0 && <div className="web-empty"><h2>对话尚未开始</h2><p>这里还没有消息。</p></div>}
          {[...(page?.messages ?? [])].sort((a, b) => a.sequence - b.sequence).map((message) => <article className={`web-message ${message.authorType === 'user' ? 'is-user' : ''}`} key={message.id}>
            <div className="web-message-meta"><strong>{message.authorDisplayName || (message.authorType === 'user' ? '你' : message.authorType === 'system' ? '系统' : '队员')}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time></div>
            <div className="web-message-body"><Markdown text={message.body} />{message.attachments.length > 0 && <p className="web-muted">{message.attachments.length} 个附件 · 浏览器下载尚未开放</p>}</div>
          </article>)}
        </>}
      </div> : <section className="web-resource" aria-label={sections.find(([id]) => id === section)?.[1]}>
        {section === 'tasks' && <p className="web-muted">{camp ? `当前对话：${camp.title}` : '先从左侧选择对话，再查看它的任务。'}</p>}
        <label className="web-search">筛选<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="输入关键词" /></label>
        {list.length === 0 && !busy && <div className="web-empty"><h2>{search ? '没有匹配的内容' : '暂无可显示的内容'}</h2></div>}
        {list.map((row, index) => <article className="web-resource-row" key={text(row, 'id', 'agentId', 'taskId', 'automationId', 'skillId', 'serverId', 'installationId') || index}>
          <div className="web-resource-heading"><h2>{text(row, 'displayName', 'title', 'name', 'adapterKind') || (section === 'memory' ? (Array.isArray(row.currentRetrievalKeys) ? row.currentRetrievalKeys.join(' · ') : '记忆') : '条目')}</h2><span>{statusLabels[text(row, 'status', 'lifecycle', 'state')] ?? text(row, 'status', 'lifecycle', 'state')}{typeof row.enabled === 'boolean' ? row.enabled ? '已启用' : '已停用' : ''}</span></div>
          {text(row, 'teamRole', 'transport', 'version') && <p className="web-muted">{text(row, 'teamRole', 'transport', 'version')}</p>}
          <Markdown text={text(row, 'description', 'currentBody', 'prompt', 'professionalResponsibilities')} />
          {typeof row.nextRunAt === 'string' && <p className="web-muted">下次执行：{new Date(row.nextRunAt).toLocaleString()}</p>}
        </article>)}
      </section>}
    </main>
  </div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Workspace /></StrictMode>)
