import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AgentProfile,
  ChannelAccountView,
  ChannelKind,
  ChannelMemberBotView,
  ChannelProviderView,
  ChannelSettingsSnapshot,
  ExecutionWebSettingsSnapshot,
  MemberBotProvisioningView
} from '@contracts'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from './AppDialog'
import { MemberAvatar } from './MemberAvatar'
import { SettingsPageHeader } from './SettingsPageHeader'
import { ChannelLoginViewport } from './ChannelLoginViewport'
import { memberBotAppDescription } from '../../shared/channel-member-bot-copy'

export function visibleChannelMembers(agents: readonly AgentProfile[]): AgentProfile[] {
  return agents
    .filter((agent) => agent.presence === 'present')
    .sort((left, right) => left.memberOrder - right.memberOrder || left.agentId.localeCompare(right.agentId))
}

export function ChannelSettings({ agents }: { agents: AgentProfile[] }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ChannelSettingsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [selectedKind, setSelectedKind] = useState<ChannelKind>('feishu')
  const [publishAgentId, setPublishAgentId] = useState<string | null>(null)
  const [publishKind, setPublishKind] = useState<ChannelKind>('feishu')
  const [publishBoundAppId, setPublishBoundAppId] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const next = await window.rovai.channels.get()
      setSnapshot(assertChannelSettingsSnapshot(next))
    } catch (nextError) {
      setError(channelErrorMessage(nextError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    return window.rovai.channels.onChanged((next) => {
      try {
        setSnapshot(assertChannelSettingsSnapshot(next))
      } catch (nextError) {
        setError(channelErrorMessage(nextError))
      }
    })
  }, [load])

  const run = useCallback(async (
    key: string,
    action: () => Promise<ChannelSettingsSnapshot>
  ): Promise<ChannelSettingsSnapshot | null> => {
    if (busy) return null
    setBusy(key)
    setError(null)
    try {
      const next = assertChannelSettingsSnapshot(await action())
      setSnapshot(next)
      return next
    } catch (nextError) {
      setError(channelErrorMessage(nextError))
      return null
    } finally {
      setBusy(null)
    }
  }, [busy])

  const cancelQrAttempt = useCallback(async (attemptId: string): Promise<void> => {
    setError(null)
    try {
      setSnapshot(assertChannelSettingsSnapshot(
        await window.rovai.channels.cancelQrAttempt(attemptId)
      ))
    } catch (nextError) {
      setError(channelErrorMessage(nextError))
    }
  }, [])

  const refreshLoginQr = useCallback(async (attemptId: string): Promise<void> => {
    setError(null)
    try { await window.rovai.channels.refreshLoginQr(attemptId) }
    catch (nextError) { setError(channelErrorMessage(nextError)) }
  }, [])

  const publishChannel = snapshot?.channels.find((candidate) => candidate.kind === publishKind) ?? null

  return (
    <>
      <ChannelSettingsView
        agents={agents}
        snapshot={snapshot}
        loading={loading}
        busy={busy}
        error={error}
        selectedKind={selectedKind}
        onSelectChannel={setSelectedKind}
        onRetry={() => void load()}
        onConnect={(provider) => void run(
          `connect:${provider.kind}`,
          () => window.rovai.channels.connect(provider.kind)
        )}
        onDisconnect={(provider) => void run(
          `disconnect:${provider.kind}`,
          () => window.rovai.channels.disconnect(provider.kind)
        )}
        onPublish={(provider, agent) => {
          setError(null)
          setPublishBoundAppId(
            provider.memberBots.find((bot) => bot.agentId === agent.agentId)?.appId ?? null
          )
          setPublishKind(provider.kind)
          setPublishAgentId(agent.agentId)
        }}
        onRetryPublish={(provider, agent) => void run(
          `retry:${provider.kind}:${agent.agentId}`,
          () => window.rovai.channels.retryMemberBot(agent.agentId, provider.kind)
        )}
      />

      <QrDialog
        snapshot={snapshot}
        kind={selectedKind}
        busy={busy !== null}
        onClose={(attemptId) => void cancelQrAttempt(attemptId)}
        onRefresh={(attemptId) => void refreshLoginQr(attemptId)}
      />

      <PublishBotDialog
        agent={agents.find((candidate) => candidate.agentId === publishAgentId) ?? null}
        kind={publishKind}
        account={publishChannel?.connection.account ?? null}
        boundAppId={publishBoundAppId}
        provisioning={snapshot?.activeProvisioning?.agentId === publishAgentId
          && (snapshot.activeProvisioning.kind ?? 'feishu') === publishKind
          ? snapshot.activeProvisioning
          : null}
        busy={busy !== null}
        error={error}
        onClose={() => {
          setPublishAgentId(null)
          setPublishBoundAppId(null)
        }}
        onReconnect={() => {
          setPublishAgentId(null)
          setPublishBoundAppId(null)
          setSelectedKind(publishKind)
          void run(`connect:${publishKind}`, () => window.rovai.channels.connect(publishKind))
        }}
        onPublish={(agentId) => {
          void run(
            `publish:${publishKind}:${agentId}`,
            () => window.rovai.channels.publishMemberBot(agentId, publishKind)
          ).then((next) => {
              if (
                next?.activeProvisioning?.stage === 'completed'
                && (next.activeProvisioning.kind ?? 'feishu') === publishKind
              ) {
                setPublishAgentId(null)
                setPublishBoundAppId(null)
              }
            })
        }}
        onSelectApprover={(agentId, userId) => {
          void run(
            `approve:${publishKind}:${agentId}`,
            () => window.rovai.channels.selectPublicationApprover(agentId, userId, publishKind)
          ).then((next) => {
            if (
              next?.activeProvisioning?.stage === 'completed'
              && (next.activeProvisioning.kind ?? 'feishu') === publishKind
            ) {
              setPublishAgentId(null)
              setPublishBoundAppId(null)
            }
          })
        }}
      />

    </>
  )
}

export function ChannelSettingsView({
  agents,
  snapshot,
  loading = false,
  busy = null,
  error = null,
  selectedKind = 'feishu',
  onRetry = () => undefined,
  onSelectChannel,
  onConnect,
  onDisconnect,
  onPublish,
  onRetryPublish
}: {
  agents: AgentProfile[]
  snapshot: ChannelSettingsSnapshot | null
  loading?: boolean
  busy?: string | null
  error?: string | null
  selectedKind?: ChannelKind
  onRetry?(): void
  onSelectChannel?(kind: ChannelKind): void
  onConnect?(channel: ChannelProviderView): void
  onDisconnect?(channel: ChannelProviderView): void
  onPublish?(channel: ChannelProviderView, agent: AgentProfile): void
  onRetryPublish?(channel: ChannelProviderView, agent: AgentProfile): void
}): React.JSX.Element {
  const members = useMemo(() => visibleChannelMembers(agents), [agents])
  const channels = snapshot?.channels ?? []
  const channel = channels.find((candidate) => candidate.kind === selectedKind)
    ?? channels[0]
    ?? null
  const pendingBindingCount = channel?.pendingBindingCount ?? snapshot?.pendingBindingCount ?? 0
  const bindingIssueCount = channel?.bindingIssueCount ?? snapshot?.bindingIssueCount ?? 0
  const providerName = channel?.displayName ?? '渠道'

  return (
    <div className="channel-settings">
      <SettingsPageHeader
        eyebrow="Settings / Channels"
        title="渠道"
        description="在本机连接协作平台并逐一发布队员 Bot。只有 Rovai Owner 可以从外部渠道触发队员；项目选择与执行管理仍由本机掌控。"
        aside={<span className="settings-page-note">Owner 本机</span>}
      />

      {loading && !snapshot && <ChannelSettingsState label="正在读取渠道状态…" />}

      {!loading && !snapshot && (
        <ChannelSettingsState
          label={error ?? '渠道状态暂时不可用。'}
          tone="error"
          action={<button className="quiet-button compact" type="button" onClick={onRetry}>重试</button>}
        />
      )}

      {snapshot && !channel && <ChannelSettingsState label="当前版本没有可用的渠道。" tone="empty" />}

      {channel && snapshot && (
        <div className="channel-settings-body">
          {error && (
            <div className="channel-settings-inline-error" role="alert">
              <span>{error}</span>
              <button className="quiet-button compact" type="button" onClick={onRetry}>重新读取</button>
            </div>
          )}

          <section className="channel-settings-section" aria-labelledby="channel-provider-heading">
            <ChannelSectionHeading
              id="channel-provider-heading"
              title="渠道"
              description="选择要连接和管理的平台。账号会话、应用凭据与项目路径都留在这台设备。"
              summary={`${channels.length} 个渠道`}
            />
            <div className="channel-provider-strip" role="tablist" aria-label="渠道">
              {channels.map((provider) => {
                const selected = provider.kind === channel.kind
                return (
                  <button
                    className={`channel-provider-tab${selected ? ' is-selected' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    key={provider.kind}
                    onClick={() => onSelectChannel?.(provider.kind)}
                  >
                    <ChannelMark kind={provider.kind} />
                    <span>
                      <strong>{provider.displayName}</strong>
                      <small>{provider.hostStatus === 'ready' ? connectionLabel(provider) : '待接入'}</small>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="channel-settings-section" aria-labelledby="channel-connection-heading">
            <ChannelSectionHeading
              id="channel-connection-heading"
              title={`${providerName}连接`}
              description="连接只决定后续 Bot 的发布目标；切换连接不会迁移或停用已发布 Bot。"
            />
            <ChannelConnectionRow
              channel={channel}
              busy={busy}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
            />
            <p className="channel-owner-note">
              <OwnerShieldIcon />
              <span>{providerName}中的 Owner 消息仍是外部消息身份，不获得本机管理权限。项目绝对路径不会发送到外部渠道。</span>
            </p>
          </section>

          <section className="channel-settings-section" aria-labelledby="channel-member-bots-heading">
            <ChannelSectionHeading
              id="channel-member-bots-heading"
              title="队员 Bot"
              description="每次只发布一名队员。每名队员拥有独立 Bot 身份和隔离的长连接。"
              summary={memberSummary(members, channel.memberBots)}
            />
            <ChannelMemberBotTable
              channel={channel}
              members={members}
              busy={busy}
              onPublish={onPublish}
              onRetryPublish={onRetryPublish}
            />
          </section>

          <section className="channel-settings-section" aria-labelledby="channel-binding-diagnostics-heading">
            <ChannelSectionHeading
              id="channel-binding-diagnostics-heading"
              title="会话接入"
              description={channel.kind === 'dingtalk'
                ? '私聊自动进入 Quick Chat；群聊首次由 Owner @ 后，在原群项目卡片中选择一次项目。钉钉话题暂不接入。'
                : '私聊自动进入 Quick Chat；群聊和话题首次由 Owner @ 后，在飞书私密卡片中选择一次项目。'}
              summary={`${pendingBindingCount} 个待选择`}
            />
            <div className="channel-binding-diagnostics" role="status">
              <span><strong>{pendingBindingCount}</strong><small>待处理绑定</small></span>
              <span className={bindingIssueCount > 0 ? 'is-warning' : undefined}>
                <strong>{bindingIssueCount}</strong><small>绑定异常</small>
              </span>
              <p>项目绑定完成后不可换绑；需要另一个项目时，请新建{channel.kind === 'dingtalk' ? '钉钉群' : '飞书群或话题'}。</p>
            </div>
          </section>

          <ExecutionWebSettingsPanel />
        </div>
      )}

      {(!channel || !snapshot) && <ExecutionWebSettingsPanel />}
    </div>
  )
}

export function ExecutionWebSettingsPanel(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ExecutionWebSettingsSnapshot | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [port, setPort] = useState('8765')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = useCallback((next: ExecutionWebSettingsSnapshot): void => {
    setSnapshot(next)
    setEnabled(next.enabled)
    setPort(String(next.port))
    setError(null)
  }, [])

  useEffect(() => {
    let alive = true
    void window.rovai.channels.getExecutionWebSettings().then((next) => {
      if (alive) apply(next)
    }).catch(() => {
      if (alive) setError('暂时无法读取执行台设置。')
    })
    const unsubscribe = window.rovai.channels.onExecutionWebSettingsChanged((next) => {
      if (alive) apply(next)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [apply])

  const parsedPort = Number(port)
  const portValid = /^\d{4,5}$/u.test(port)
    && Number.isSafeInteger(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535
  const dirty = Boolean(snapshot && (snapshot.enabled !== enabled || snapshot.port !== parsedPort))
  const status = executionWebStatus(snapshot)

  const validatePort = (): boolean => {
    if (portValid) {
      setError(null)
      return true
    }
    setError('端口需为 1024～65535 的整数。')
    return false
  }

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!validatePort() || saving) return
    setSaving(true)
    setError(null)
    try {
      apply(await window.rovai.channels.setExecutionWebSettings({ enabled, port: parsedPort }))
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError)
      setError(message.includes('port') || message.includes('EADDRINUSE')
        ? '这个端口暂时不可用，原设置未改变。'
        : '执行台设置保存失败，请重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="channel-settings-section execution-web-settings">
      <summary>
        <span>
          <strong>局域网执行台</strong>
          <small>在同一网络中查看公开执行记录</small>
        </span>
        <span className={`execution-web-status is-${status.tone}`}>{status.label}</span>
      </summary>
      <form className="execution-web-form" onSubmit={(event) => void save(event)}>
        <label className="execution-web-switch-row">
          <span><strong>允许局域网访问</strong><small>仅提供只读页面</small></span>
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
        </label>
        <label className="execution-web-port-row">
          <span>端口</span>
          <input
            type="number"
            inputMode="numeric"
            min={1024}
            max={65535}
            step={1}
            value={port}
            aria-invalid={!portValid}
            onBlur={validatePort}
            onChange={(event) => setPort(event.target.value)}
          />
        </label>
        {snapshot?.server.address && (
          <div className="execution-web-address"><span>当前地址</span><code>http://{snapshot.server.address}</code></div>
        )}
        <p className="execution-web-warning">修改端口后，此前发送的执行台链接可能失效。</p>
        {error && <p className="execution-web-error" role="alert">{error}</p>}
        <div className="execution-web-actions">
          <button className="primary-button compact" type="submit" disabled={!dirty || !portValid || saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </details>
  )
}

function executionWebStatus(snapshot: ExecutionWebSettingsSnapshot | null): {
  label: string
  tone: 'neutral' | 'success' | 'warning'
} {
  if (!snapshot || !snapshot.enabled || snapshot.server.state === 'disabled') {
    return { label: '未开启', tone: 'neutral' }
  }
  if (snapshot.server.state === 'ready') return { label: `已开启 · ${snapshot.port}`, tone: 'success' }
  if (snapshot.server.state === 'port_conflict') return { label: `端口被占用 · ${snapshot.port}`, tone: 'warning' }
  if (snapshot.server.state === 'no_lan_address') return { label: '未找到局域网', tone: 'warning' }
  if (snapshot.server.state === 'starting') return { label: '正在启动', tone: 'neutral' }
  return { label: '暂不可用', tone: 'warning' }
}

function ChannelSettingsState({
  label,
  tone = 'loading',
  action
}: {
  label: string
  tone?: 'loading' | 'empty' | 'error'
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={`channel-settings-state is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true" />
      <p>{label}</p>
      {action}
    </div>
  )
}

function ChannelSectionHeading({
  id,
  title,
  description,
  summary
}: {
  id: string
  title: string
  description: string
  summary?: string
}): React.JSX.Element {
  return (
    <div className="channel-section-heading">
      <div>
        <h2 id={id}>{title}</h2>
        <p>{description}</p>
      </div>
      {summary && <span>{summary}</span>}
    </div>
  )
}

export function ChannelConnectionRow({
  channel,
  busy,
  onConnect,
  onDisconnect
}: {
  channel: ChannelProviderView
  busy: string | null
  onConnect?: (channel: ChannelProviderView) => void
  onDisconnect?: (channel: ChannelProviderView) => void
}): React.JSX.Element {
  const account = channel.connection.account
  const connected = channel.connection.status === 'connected' && account !== null
  const hostReady = channel.hostStatus === 'ready'
  const providerName = channel.displayName
  const connectBusy = busy === `connect:${channel.kind}`
  const disconnectBusy = busy === `disconnect:${channel.kind}`
  const connectLabel = !hostReady ? '尚未开放'
    : channel.kind === 'dingtalk'
      ? channel.connection.status === 'not_connected' ? '连接钉钉' : '重新连接'
      : connected ? '切换账号' : '登录开放平台'
  return (
    <div className="channel-connection-row">
      <ChannelMark kind={channel.kind} />
      <div className="channel-connection-label">
        <strong>{providerName}开放平台</strong>
        <span>{hostReady
          ? '开发者账号会话 · 保存在 Rovai 本地数据库'
          : '渠道宿主尚未就绪'}</span>
      </div>
      {connected ? (
        <div className="channel-account-summary">
          <span className="channel-account-avatar" aria-hidden="true">{firstGrapheme(account.userName)}</span>
          <span>
            <strong>{account.userName}</strong>
            <small>{account.email ? `${account.email} · ` : ''}{account.tenantName} · {account.brand === 'lark' ? 'Lark' : providerName}</small>
          </span>
        </div>
      ) : (
        <span className="channel-account-empty">{!hostReady ? '连接能力尚未开放'
          : channel.kind === 'dingtalk' && channel.connection.status === 'session_expired'
            ? '登录已失效，请重新连接' : `还没有连接${providerName}账号`}</span>
      )}
      <span className={`channel-connection-status${connected ? ' is-connected' : ''}`}>
        {connected ? '已连接' : channel.connection.status === 'session_expired' ? '需重新连接' : '未连接'}
      </span>
      <div className="channel-connection-actions">
        {connected && (
          <button
            className="channel-row-action"
            type="button"
            disabled={busy !== null || !onDisconnect}
            onClick={() => onDisconnect?.(channel)}
          >
            {disconnectBusy ? '断开中…' : '断开'}
          </button>
        )}
        <button
          className="quiet-button compact"
          type="button"
          disabled={!hostReady || busy !== null || !onConnect}
          title={!hostReady ? `${providerName}渠道宿主尚未接入` : undefined}
          onClick={() => onConnect?.(channel)}
        >
          {connectBusy
            ? '等待扫码…'
            : connectLabel}
        </button>
      </div>
    </div>
  )
}

function ChannelMemberBotTable({
  channel,
  members,
  busy,
  onPublish,
  onRetryPublish
}: {
  channel: ChannelProviderView
  members: AgentProfile[]
  busy: string | null
  onPublish?: (channel: ChannelProviderView, agent: AgentProfile) => void
  onRetryPublish?: (channel: ChannelProviderView, agent: AgentProfile) => void
}): React.JSX.Element {
  const bots = new Map(channel.memberBots.map((bot) => [bot.agentId, bot]))
  const connected = channel.hostStatus === 'ready'
    && channel.connection.status === 'connected'
    && channel.connection.account !== null
  if (members.length === 0) {
    return <div className="channel-member-bots-empty"><strong>还没有可发布的队员</strong><span>先在队员页创建或恢复一名队员。</span></div>
  }
  return (
    <div className="channel-member-bot-table" role="table" aria-label="队员 Bot">
      <div className="channel-member-bot-grid channel-member-bot-head" role="row">
        <span role="columnheader">队员</span><span role="columnheader">{channel.displayName}身份</span><span role="columnheader">状态</span><span role="columnheader" aria-label="操作" />
      </div>
      <div role="rowgroup">
        {members.map((agent) => {
          const bot = bots.get(agent.agentId)
          const status = bot?.publicationStatus ?? 'unpublished'
          const published = status === 'published'
          const failed = status === 'failed'
          const disabled = status === 'disabled'
          const provisioning = status === 'provisioning'
          const action = failed ? onRetryPublish : onPublish
          const actionBusy = busy === `publish:${channel.kind}:${agent.agentId}`
            || busy === `retry:${channel.kind}:${agent.agentId}`
          return (
            <div className="channel-member-bot-grid channel-member-bot-row" role="row" key={agent.agentId}>
              <div className="channel-member-identity" role="cell">
                <MemberAvatar agentId={agent.agentId} avatarRef={agent.avatarRef} displayName={agent.displayName} size="workspace" decorative />
                <span><strong>{agent.displayName}</strong><small>{agent.teamRole || '未设置队内职责'}</small></span>
              </div>
              <div className="channel-bot-identity" role="cell">
                {bot?.botDisplayName
                  ? <><strong>{bot.botDisplayName}</strong><small>独立 Bot 身份</small></>
                  : <span>名称沿用队员；应用图标由 Rovai 配置</span>}
              </div>
              <span className={`channel-publication-status is-${status}`} role="cell">
                <span>{publicationLabel(status)}</span>
              </span>
              <div className="channel-member-action" role="cell">
                {published && bot?.managementUrl ? (
                  <a
                    className="channel-row-action"
                    href={bot.managementUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`在${channel.displayName}开放平台管理 ${agent.displayName}`}
                  >
                    {channel.displayName}管理
                  </a>
                ) : (
                  <button
                    className="channel-row-action"
                    type="button"
                    disabled={!connected || busy !== null || provisioning || !action || published}
                    onClick={() => action?.(channel, agent)}
                  >
                    {actionBusy || provisioning
                      ? '处理中…'
                      : published
                        ? '管理不可用'
                        : failed
                          ? bot?.appId ? '继续核对' : '重试'
                          : connected
                            ? disabled ? '重新发布' : '发布'
                            : '等待连接'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function QrDialog({
  snapshot,
  kind,
  busy,
  onClose,
  onRefresh
}: {
  snapshot: ChannelSettingsSnapshot | null
  kind: ChannelKind
  busy: boolean
  onClose: (attemptId: string) => void
  onRefresh: (attemptId: string) => void
}): React.JSX.Element {
  const attempt = snapshot?.activeQrAttempt ?? null
  if (!attempt) return <></>
  const attemptKind = attempt.kind ?? kind
  const providerName = attemptKind === 'dingtalk' ? '钉钉' : '飞书'
  const interaction = attemptKind === 'dingtalk' && attempt.stage === 'awaiting_interaction'
  const committing = attemptKind === 'dingtalk' && attempt.stage === 'saving_local_session'
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !committing) onClose(attempt.attemptId) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent className={`channel-qr-dialog${attemptKind === 'dingtalk' ? ' is-dingtalk' : ''}${interaction ? ' has-platform-view' : ''}`}>
          <AppDialogHeader
            title={`登录${providerName}开放平台`}
            description={`使用${providerName}扫码登录开发者平台。本次不会创建应用、读取 App Secret 或发布 Bot。`}
            icon="shield"
            closeDisabled={committing || (attemptKind !== 'dingtalk' && busy && attempt.stage !== 'failed')}
          />
          <AppDialogBody className="channel-qr-body">
            {interaction
              ? <ChannelLoginViewport key={attempt.attemptId} attemptId={attempt.attemptId} />
              : <div className={`channel-qr-frame is-${attempt.stage}`}>
                  {attempt.qrDataUrl
                    ? <img src={attempt.qrDataUrl} alt={`${providerName}连接二维码`} />
                    : <span aria-hidden="true"><ChannelMark kind={attemptKind} /></span>}
                </div>}
            <strong role="status" aria-live="polite">{attempt.detail}</strong>
            <small>{attempt.expiresAt
              ? `二维码有效期至 ${formatLocalTime(attempt.expiresAt)}`
              : '开发者会话保存在 Rovai 本地数据库，不会暴露给页面。'}</small>
          </AppDialogBody>
          <AppDialogFooter note="登录后，后续发布会复用同一开发者会话。">
            {attemptKind === 'dingtalk' && attempt.stage === 'expired' && <button
              className="primary-button" type="button" onClick={() => onRefresh(attempt.attemptId)}
            >刷新二维码</button>}
            <button className="quiet-button" type="button" disabled={committing} onClick={() => onClose(attempt.attemptId)}>
              {attempt.stage === 'failed' ? '关闭' : '取消'}
            </button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PublishBotDialog({
  agent,
  kind,
  account,
  boundAppId,
  provisioning,
  busy,
  error,
  onClose,
  onReconnect,
  onPublish,
  onSelectApprover
}: {
  agent: AgentProfile | null
  kind: ChannelKind
  account: ChannelAccountView | null
  boundAppId: string | null
  provisioning: MemberBotProvisioningView | null
  busy: boolean
  error: string | null
  onClose: () => void
  onReconnect: () => void
  onPublish: (agentId: string) => void
  onSelectApprover: (agentId: string, userId: string) => void
}): React.JSX.Element {
  const approvers = provisioning?.approvalCandidates ?? []
  const approverKey = approvers.map((candidate) => candidate.userId).join('\0')
  const [selectedApprover, setSelectedApprover] = useState('')
  useEffect(() => {
    setSelectedApprover('')
  }, [agent?.agentId, approverKey])
  if (!agent || !account) return <></>
  const providerName = kind === 'dingtalk' ? '钉钉' : '飞书'
  const terminal = provisioning
    ? ['completed', 'failed', 'unknown_remote_state'].includes(provisioning.stage)
    : false
  const effectiveAppId = boundAppId ?? provisioning?.remoteAppId ?? null
  const retryLocked = provisioning?.stage === 'unknown_remote_state'
    && provisioning.remoteAppId === null
  const connectionFailed = provisioning?.failureCode === 'feishu_connection_error'
    || provisioning?.failureCode === 'dingtalk_connection_error'
  const sessionUnavailable = Boolean(error && /登录已过期|账号已变化|重新连接账号|重新连接/.test(error))
  const awaitingApprover = kind === 'dingtalk'
    && provisioning?.failureCode === 'dingtalk_approver_selection_required'
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && (!busy || terminal)) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent className="channel-publish-dialog">
          <AppDialogHeader
            title={boundAppId
              ? `重新发布「${agent.displayName}」${providerName} Bot`
              : `发布「${agent.displayName}」为${providerName} Bot`}
            description={boundAppId
              ? `Rovai 会核对并恢复这名队员已经绑定的${providerName}应用。App ID 保持不变，不会创建或换绑其他应用。`
              : `Rovai 会复用当前开发者会话，在后台创建、配置并发布这名队员的独立应用。正常流程不会打开${providerName}创建确认页，也不需要再次登录。`}
            icon="server"
            closeDisabled={busy && !terminal}
          />
          <AppDialogBody>
            <div className="channel-publish-identity">
              <MemberAvatar
                agentId={agent.agentId}
                avatarRef={agent.avatarRef}
                displayName={agent.displayName}
                size="workspace"
                decorative
              />
              <span><strong>{agent.displayName}</strong><small>{agent.teamRole || '协作者'}</small></span>
              <span className="channel-publish-arrow" aria-hidden="true">→</span>
              <ChannelMark kind={kind} />
              <span><strong>独立{providerName} Bot</strong><small>权限、事件与长连接彼此隔离</small></span>
            </div>
            <div className="channel-dialog-fact"><span>发布账号</span><strong>{account.userName}</strong></div>
            <div className="channel-dialog-fact"><span>所属租户</span><strong>{account.tenantName}</strong></div>
            {effectiveAppId && <div className="channel-dialog-fact"><span>绑定应用</span><code>{effectiveAppId}</code></div>}
            <div className="channel-dialog-fact"><span>应用说明</span><strong>{memberBotAppDescription(kind, agent.teamRole)}</strong></div>
            {error && <div className="channel-dialog-error" role="alert">{error}</div>}
            {awaitingApprover && (
              <label className="channel-approver-select">
                <span>版本审批人</span>
                <select
                  value={selectedApprover}
                  onChange={(event) => setSelectedApprover(event.target.value)}
                >
                  <option value="" disabled>请选择审批人</option>
                  {approvers.map((candidate) => (
                    <option value={candidate.userId} key={candidate.userId}>
                      {candidate.displayName}
                    </option>
                  ))}
                </select>
                <small>钉钉要求由 Owner 明确选择，本机不会自动代选。</small>
              </label>
            )}
            {provisioning ? (
              <div className={`channel-provisioning-state is-${provisioning.stage}`} role="status">
                <span className="channel-provisioning-dot" aria-hidden="true" />
                <span>
                  <strong>{provisioningLabel(
                    provisioning.stage,
                    Boolean(effectiveAppId)
                  )}</strong>
                  <small>{provisioning.detail}</small>
                  {provisioning.remoteAppId && <code>{provisioning.remoteAppId}</code>}
                  {terminal && provisioning.failureCode && (
                    <code>{provisioning.failureCode}</code>
                  )}
                </span>
              </div>
            ) : (
              <p className="channel-publish-note">
                {boundAppId
                  ? `该队员的${providerName}身份已冻结到此应用；重新发布只恢复原应用的配置、版本和连接。`
                  : '创建前会再次校验账号和租户；一旦身份变化或会话过期，发布会停止并提示重新连接。'}
              </p>
            )}
          </AppDialogBody>
          <AppDialogFooter note={connectionFailed
            ? effectiveAppId
              ? '已保留原应用绑定；关闭后可以稍后重试。'
              : `${providerName}连接异常；关闭后可以稍后重试。`
            : retryLocked
              ? '创建结果无法确认。Rovai 已锁定再次创建，避免产生重复应用。'
            : effectiveAppId
              ? '重新发布始终复用已绑定应用，不提供换绑入口。'
              : '发布只使用当前开发者会话，不会打开平台创建确认页。'}>
            <button className="quiet-button" type="button" disabled={busy && !terminal} onClick={onClose}>取消</button>
            {sessionUnavailable ? (
              <button className="primary-button" type="button" disabled={busy} onClick={onReconnect}>
                重新连接{providerName}
              </button>
            ) : awaitingApprover ? (
              <button
                className="primary-button"
                type="button"
                disabled={busy || !selectedApprover}
                onClick={() => onSelectApprover(agent.agentId, selectedApprover)}
              >
                {busy ? '正在提交审批…' : '提交审批并继续发布'}
              </button>
            ) : !retryLocked && (
              <button className="primary-button" type="button" disabled={busy} onClick={() => onPublish(agent.agentId)}>
                {busy
                  ? effectiveAppId ? '核对中…' : '发布中…'
                  : provisioning?.stage === 'failed' && effectiveAppId
                    ? '继续核对'
                    : boundAppId
                      ? '确认重新发布'
                      : provisioning?.stage === 'failed'
                        ? '重新发布'
                        : '确认发布'}
              </button>
            )}
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ChannelMark({ kind }: { kind: ChannelKind }): React.JSX.Element {
  return (
    <span className={`channel-mark channel-mark-${kind}`} aria-hidden="true">
      {kind === 'dingtalk' ? '钉' : '飞'}
    </span>
  )
}

function OwnerShieldIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.8 2.8 8.3 7 10 4.2-1.7 7-5.2 7-10V6Z" /><path d="m9 12 2 2 4-4" /></svg>
}

function connectionLabel(channel: ChannelProviderView): string {
  if (channel.connection.status === 'connected') return '已连接'
  if (channel.connection.status === 'session_expired') return '需重新连接'
  return '未连接'
}

function memberSummary(members: readonly AgentProfile[], bots: readonly ChannelMemberBotView[]): string {
  const visibleMemberIds = new Set(members.map((member) => member.agentId))
  const published = bots.filter((bot) => visibleMemberIds.has(bot.agentId) && bot.publicationStatus === 'published').length
  return `${published} 已发布 · ${members.length - published} 未发布`
}

function publicationLabel(status: ChannelMemberBotView['publicationStatus'] | 'unpublished'): string {
  switch (status) {
    case 'provisioning': return '发布中'
    case 'published': return '已发布'
    case 'failed': return '需处理'
    case 'disabled': return '已停用'
    default: return '未发布'
  }
}

function provisioningLabel(
  stage: MemberBotProvisioningView['stage'],
  recoveringFrozenApp = false
): string {
  switch (stage) {
    case 'verifying_session': return '正在校验发布账号…'
    case 'creating_app': return recoveringFrozenApp ? '正在核对已绑定应用…' : '正在创建独立应用…'
    case 'activating_app': return '正在启用应用…'
    case 'configuring_permissions': return '正在读取并提交配置…'
    case 'waiting_configuration': return '正在等待配置生效…'
    case 'publishing_version': return '正在发布最终配置…'
    case 'verifying_configuration': return '正在确认 Bot 与版本…'
    case 'connecting_bot': return '正在建立 Bot 长连接…'
    case 'completed': return '发布完成'
    case 'unknown_remote_state': return '远端创建结果待核对'
    default: return '发布尚未完成'
  }
}

function firstGrapheme(value: string): string {
  return Array.from(value.trim())[0] ?? '飞'
}

function formatLocalTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function assertChannelSettingsSnapshot(value: ChannelSettingsSnapshot): ChannelSettingsSnapshot {
  if (
    value.schemaVersion !== 4
    || !Array.isArray(value.channels)
    || !Number.isInteger(value.pendingBindingCount)
    || !Number.isInteger(value.bindingIssueCount)
  ) throw new Error('渠道状态数据版本不兼容。')
  return value
}

export function channelErrorMessage(error: unknown): string | null {
  const raw = error instanceof Error && error.message ? error.message : ''
  const message = raw
    .replace(/^Error invoking remote method '[^']+': (?:[A-Za-z_$][\w$]*Error|Error):\s*/, '')
    .trim()
  if (message === 'feishu_login_cancelled') return null
  if (message === 'dingtalk_operation_cancelled') return null
  if (message === 'feishu_console_remote_app_unavailable') {
    return '原飞书应用已删除或当前账号无权访问，无法按原 App ID 重试。'
  }
  if (message === 'feishu_connection_error') {
    return '飞书连接异常，请稍后重试。'
  }
  const provisioningFailures: Record<string, string> = {
    feishu_console_event_verification_failed:
      '飞书事件与长连接配置尚未确认生效；原应用已保留，可以稍后继续核对。',
    feishu_console_scope_update_verification_failed:
      '飞书消息权限尚未确认生效；原应用已保留，可以稍后继续核对。',
    feishu_console_scope_verification_failed:
      '飞书消息权限尚未确认生效；原应用已保留，可以稍后继续核对。',
    feishu_console_callback_verification_failed:
      '飞书回调与长连接配置尚未确认生效；原应用已保留，可以稍后继续核对。',
    feishu_console_version_not_published:
      '飞书应用版本尚未确认发布；原应用已保留，可以稍后继续核对。'
  }
  if (provisioningFailures[message]) return provisioningFailures[message]
  if (/^feishu_console_/u.test(message)) {
    return '飞书开放平台操作尚未完成；请查看下方状态，排除问题后重试。'
  }
  if (message === 'published_bot_credential_missing') {
    return '本机 Bot 凭据缺失或与冻结应用不一致，已停止连接。'
  }
  const dingtalkFailures: Record<string, string> = {
    dingtalk_developer_session_expired: '登录已失效，请重新连接。',
    dingtalk_legacy_session_requires_reconnect: '钉钉已改用网页登录，请重新连接一次；已有 Bot 和应用绑定会保留。',
    dingtalk_web_session_store_invalid: '暂时无法读取本机钉钉登录态，数据已保留，请稍后重试。',
    dingtalk_web_session_store_unavailable: '暂时无法保存钉钉登录态，请稍后重试；已有会话和应用绑定会保留。',
    dingtalk_login_timeout: '本次钉钉登录等待超时，请重新连接；已有登录态会保留。',
    dingtalk_login_view_unavailable: '暂时无法显示钉钉登录页，请关闭后重新连接。',
    dingtalk_login_identity_mismatch: '当前登录的钉钉账号或企业与原账号不一致，请重新连接。',
    dingtalk_console_protocol_unverified: '当前版本尚未完成钉钉后台此步骤的验证，操作已停止；已有应用身份会保留。',
    dingtalk_open_platform_unavailable: '暂时无法连接钉钉开放平台，请检查网络后重试。',
    dingtalk_open_platform_timeout: '钉钉开放平台响应超时；已有应用身份会保留，可以稍后重试。',
    dingtalk_open_platform_access_denied: '当前钉钉账号没有完成此开放平台操作的权限。',
    dingtalk_open_platform_operation_failed: '钉钉开放平台拒绝了本次操作，请核对账号权限后重试。',
    dingtalk_login_identity_unavailable: '暂时未能读取完整的钉钉账号与企业身份，请稍后重试。',
    dingtalk_account_identity_changed: '钉钉账号或企业已经变化，请重新连接账号。',
    dingtalk_app_create_unknown_remote_state:
      '无法确认钉钉应用是否已经创建；Rovai 已锁定再次创建，避免产生重复应用。',
    dingtalk_version_not_released: '钉钉应用版本尚未确认发布；原应用已保留，可以稍后继续。'
  }
  if (dingtalkFailures[message]) return dingtalkFailures[message]
  if (/^dingtalk_/u.test(message)) {
    return '钉钉开放平台操作尚未完成；请查看下方状态，排除问题后重试。'
  }
  return message || '渠道操作失败。'
}
