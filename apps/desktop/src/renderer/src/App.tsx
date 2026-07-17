import { useEffect, useMemo, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import type { AgentProfile, HealthStatus } from '@contracts'

type LoadState = 'loading' | 'ready' | 'error'

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    setState('loading')
    setError(null)
    try {
      const [nextHealth, nextAgents] = await Promise.all([
        window.lumen.request<HealthStatus>('health.check'),
        window.lumen.request<AgentProfile[]>('agents.list')
      ])
      setHealth(nextHealth)
      setAgents(nextAgents)
      setState('ready')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
      setState('error')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const readyCount = useMemo(
    () => [health?.core.ok, health?.database.ok, health?.git.installed, health?.codex.installed].filter(Boolean).length,
    [health]
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="traffic-space" />
        <div className="brand-mark" aria-hidden="true">
          <span />
        </div>
        <div>
          <p className="eyebrow">Lumen AI · v0.01</p>
          <h1>研发营地</h1>
        </div>
        <div className="topbar-actions">
          <span className="local-pill">本地工作空间</span>
          <button className="quiet-button" onClick={() => void load()} disabled={state === 'loading'}>
            {state === 'loading' ? '检测中…' : '重新检测'}
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <nav aria-label="主导航">
          <button className="nav-item active"><span>⌂</span>营地</button>
          <button className="nav-item"><span>◇</span>项目</button>
          <button className="nav-item"><span>✓</span>任务</button>
          <button className="nav-item"><span>◌</span>伙伴</button>
        </nav>
        <div className="sidebar-footer">
          <div className={`status-orb ${state}`} />
          <div>
            <strong>{state === 'ready' ? 'Core 已连接' : state === 'loading' ? '正在连接' : '需要检查'}</strong>
            <span>{health?.core.version ? `Rust ${health.core.version}` : 'Lumen Core'}</span>
          </div>
        </div>
      </aside>

      <main className="content">
        <section className="hero-card">
          <div className="contour contour-one" />
          <div className="contour contour-two" />
          <div className="hero-copy">
            <span className="stamp">LOCAL FIRST</span>
            <h2>把下一段路，交给熟悉你的伙伴。</h2>
            <p>v0.01 正在建立第一条自举路径：Lumen → 沐瓦 → Codex → Worktree → 下一版 Lumen。</p>
          </div>
          <div className="lantern" aria-hidden="true">
            <div className="lantern-glow" />
            <div className="lantern-body" />
          </div>
        </section>

        {error && <div className="error-banner"><strong>Rust Core 连接失败</strong><span>{error}</span></div>}

        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="eyebrow">COMPANIONS</p>
              <h2>长期伙伴</h2>
            </div>
            <span className="section-note">身份持久保存 · Runtime 按需启动</span>
          </div>
          <div className="agent-grid">
            {agents.map((agent) => (
              <article className="agent-card" key={agent.id} style={{ '--agent-accent': agent.accent } as React.CSSProperties}>
                <div className="avatar-ring">
                  <span>{agent.displayName.slice(0, 1)}</span>
                </div>
                <div className="agent-title">
                  <div><h3>{agent.displayName}</h3><span>{agent.species}</span></div>
                  <i className={agent.runtimeEnabled ? 'online' : ''} />
                </div>
                <strong>{agent.roleTitle}</strong>
                <p>{agent.roleContract}</p>
                <div className="agent-footer">
                  <span>{agent.runtimeEnabled ? '可执行' : 'v0.02 开放'}</span>
                  {agent.runtimeEnabled && <button>准备任务 →</button>}
                </div>
              </article>
            ))}
            {state === 'loading' && [0, 1, 2, 3].map((item) => <div className="agent-card skeleton" key={item} />)}
          </div>
        </section>

        <section className="section-block runtime-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">RUNTIME HEALTH</p>
              <h2>出发前检查</h2>
            </div>
            <span className="health-score">{readyCount}/4 ready</span>
          </div>
          <Tabs.Root defaultValue="overview" className="runtime-card">
            <Tabs.List className="tabs-list">
              <Tabs.Trigger value="overview">概览</Tabs.Trigger>
              <Tabs.Trigger value="details">诊断详情</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="overview" className="health-grid">
              <HealthItem label="Rust Core" ok={health?.core.ok} detail={health?.core.version} />
              <HealthItem label="SQLite" ok={health?.database.ok} detail="WAL · bundled" />
              <HealthItem label="Git" ok={health?.git.installed} detail={health?.git.version} />
              <HealthItem label="Codex" ok={health?.codex.installed && health?.codex.authenticated !== false} detail={health?.codex.version} />
            </Tabs.Content>
            <Tabs.Content value="details" className="diagnostics">
              <Diagnostic label="数据目录" value={health?.core.dataDir} />
              <Diagnostic label="数据库" value={health?.database.path} />
              <Diagnostic label="Codex 路径" value={health?.codex.path} />
              <Diagnostic label="Codex 登录" value={health?.codex.detail ?? (health?.codex.authenticated ? '已登录' : '未知')} />
            </Tabs.Content>
          </Tabs.Root>
        </section>
      </main>
    </div>
  )
}

function HealthItem({ label, ok, detail }: { label: string; ok?: boolean; detail?: string | null }): React.JSX.Element {
  return (
    <div className="health-item">
      <span className={`health-indicator ${ok ? 'ok' : ''}`}>{ok ? '✓' : '·'}</span>
      <div><strong>{label}</strong><span>{detail ?? '等待检测'}</span></div>
    </div>
  )
}

function Diagnostic({ label, value }: { label: string; value?: string | null }): React.JSX.Element {
  return <div className="diagnostic-row"><strong>{label}</strong><code>{value ?? '—'}</code></div>
}

