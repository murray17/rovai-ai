import { useCampClient, type CampClient } from './camp-client'
import { feishuLoginFailureDetail } from '../../shared/feishu-login-progress'
import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
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
  AppDialogHeader,
  DialogControlIcon
} from './AppDialog'
import { MemberAvatar } from './MemberAvatar'
import { SettingsPageHeader } from './SettingsPageHeader'
import { ChannelLoginViewport } from './ChannelLoginViewport'
import { memberBotAppDescription } from '../../shared/channel-member-bot-copy'
import { CHANNEL_PROVIDER_BRANDS, channelCopy, type ChannelProviderBrand } from './channel-provider-brand'

interface ChannelProviderPresentation extends ChannelProviderBrand {
  connectLabel: string
  qrDialogClassName: string
  supportsNativeLoginInteraction: boolean
  approverSelectionFailureCode: string | null
  qualificationNote: string | null
}

const CHANNEL_PROVIDER_PRESENTATIONS = {
  feishu: {
    ...CHANNEL_PROVIDER_BRANDS.feishu,
    connectLabel: '登录开放平台',
    qrDialogClassName: '',
    supportsNativeLoginInteraction: false,
    approverSelectionFailureCode: null,
    qualificationNote: null
  },
  lark: {
    ...CHANNEL_PROVIDER_BRANDS.lark,
    connectLabel: '登录开放平台',
    qrDialogClassName: '',
    supportsNativeLoginInteraction: false,
    approverSelectionFailureCode: null,
    qualificationNote: 'Lark 支持尚未完成真实租户验收'
  },
  dingtalk: {
    ...CHANNEL_PROVIDER_BRANDS.dingtalk,
    connectLabel: '连接钉钉',
    qrDialogClassName: ' is-dingtalk',
    supportsNativeLoginInteraction: true,
    approverSelectionFailureCode: 'dingtalk_approver_selection_required',
    qualificationNote: null
  }
} satisfies Record<ChannelKind, ChannelProviderPresentation>

function channelProviderPresentation(kind: ChannelKind): ChannelProviderPresentation {
  return CHANNEL_PROVIDER_PRESENTATIONS[kind]
}

export function visibleChannelMembers(agents: readonly AgentProfile[]): AgentProfile[] {
  return agents
    .filter((agent) => agent.presence === 'present')
    .sort((left, right) => left.memberOrder - right.memberOrder || left.agentId.localeCompare(right.agentId))
}

export interface ChannelActionError {
  kind: ChannelKind
  message: string
}

// Action failures belong to the provider that raised them; switching tabs must
// not show one provider's failure on another provider's page.
export function channelActionErrorFor(error: ChannelActionError | null, kind: ChannelKind): string | null {
  return error?.kind === kind ? error.message : null
}

function channelActionError(kind: ChannelKind, error: unknown): ChannelActionError | null {
  const message = channelErrorMessage(error)
  return message ? { kind, message } : null
}

function channelProvisioning(snapshot: ChannelSettingsSnapshot | null, kind: ChannelKind): MemberBotProvisioningView | null {
  const provider = snapshot?.channels.find(channel => channel.kind === kind)
  if (provider?.provisioning !== undefined) return provider.provisioning
  return snapshot?.activeProvisioning && (snapshot.activeProvisioning.kind ?? 'feishu') === kind
    ? snapshot.activeProvisioning : null
}

export function ChannelSettings({ agents }: { agents: AgentProfile[] }): React.JSX.Element {
  const client = useCampClient()
  if (!client.channels) return <div className="channel-settings-page">
    <SettingsPageHeader eyebrow="Settings / Channels" title="渠道" description="独立 Server 当前不支持飞书／钉钉渠道。渠道功能请使用 Rovai Desktop。" />
  </div>
  return <ManagedChannelSettings agents={agents} channels={client.channels} />
}

function ManagedChannelSettings({ agents, channels }: { agents: AgentProfile[]; channels: NonNullable<CampClient['channels']> }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ChannelSettingsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ChannelActionError | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [selectedKind, setSelectedKind] = useState<ChannelKind>('feishu')
  const [publishAgentId, setPublishAgentId] = useState<string | null>(null)
  const [publishKind, setPublishKind] = useState<ChannelKind>('feishu')
  const [publishBoundAppId, setPublishBoundAppId] = useState<string | null>(null)

  const mounted = useRef(false)
  const reading = useRef(false)
  const load = useCallback(async (background = false): Promise<void> => {
    if (reading.current) return
    reading.current = true
    if (!background) { setLoading(true); setError(null) }
    try {
      const next = await channels.get()
      if (!mounted.current) return
      setSnapshot(assertChannelSettingsSnapshot(next))
      setReadError(null)
    } catch (nextError) {
      if (!mounted.current) return
      setReadError(channelErrorMessage(nextError))
      setSnapshot(current => current ? { ...current, channels: current.channels.map(provider => ({
        ...provider, connection: { ...provider.connection, sessionStatus: 'unavailable' },
        memberBots: provider.memberBots.map(bot => ({ ...bot, connectionStatus: 'unknown' }))
      })) } : null)
    } finally {
      reading.current = false
      if (mounted.current) setLoading(false)
    }
  }, [channels])

  useEffect(() => {
    mounted.current = true
    void load()
    const unsubscribe = channels.onChanged(next => {
      if (!mounted.current) return
      try { setSnapshot(assertChannelSettingsSnapshot(next)); setReadError(null) }
      catch (nextError) { setReadError(channelErrorMessage(nextError)) }
    })
    const timer = channels.native ? undefined : setInterval(() => void load(true), 2000)
    return () => { mounted.current = false; unsubscribe(); clearInterval(timer) }
  }, [channels, load])

  const run = useCallback(async (
    key: string,
    kind: ChannelKind,
    action: () => Promise<ChannelSettingsSnapshot>
  ): Promise<ChannelSettingsSnapshot | null> => {
    if (busy) return null
    setBusy(key)
    setError(null)
    try {
      const next = assertChannelSettingsSnapshot(await action())
      if (!mounted.current) return null
      setSnapshot(next)
      return next
    } catch (nextError) {
      if (!mounted.current) return null
      setError(channelActionError(kind, nextError))
      return null
    } finally {
      if (mounted.current) setBusy(null)
    }
  }, [busy])

  const cancelQrAttempt = useCallback(async (attemptId: string, kind: ChannelKind): Promise<void> => {
    setError(null)
    try {
      setSnapshot(assertChannelSettingsSnapshot(
        await channels.native!.cancelQrAttempt(attemptId)
      ))
    } catch (nextError) {
      setError(channelActionError(kind, nextError))
    }
  }, [channels])

  const refreshLoginQr = useCallback(async (attemptId: string, kind: ChannelKind): Promise<void> => {
    setError(null)
    try { await channels.native!.refreshLoginQr(attemptId) }
    catch (nextError) { setError(channelActionError(kind, nextError)) }
  }, [channels])

  const publishChannel = snapshot?.channels.find((candidate) => candidate.kind === publishKind) ?? null
  const provisioning = channelProvisioning(snapshot, publishKind)

  return (
    <>
      <ChannelSettingsView
        agents={agents}
        desktopManagedWeb={!channels.native}
        snapshot={snapshot}
        loading={loading}
        busy={busy}
        error={channelActionErrorFor(error, selectedKind) ?? readError}
        selectedKind={selectedKind}
        onSelectChannel={setSelectedKind}
        onRetry={() => void load()}
        onConnect={channels.native ? (provider) => void run(
          `connect:${provider.kind}`,
          provider.kind,
          () => channels.native!.connect(provider.kind)
        ) : undefined}
        onDisconnect={channels.native ? (provider) => void run(
          `disconnect:${provider.kind}`,
          provider.kind,
          () => channels.native!.disconnect(provider.kind)
        ) : undefined}
        onPublish={(provider, agent) => {
          setError(null)
          setPublishBoundAppId(
            provider.memberBots.find((bot) => bot.agentId === agent.agentId)?.appId ?? null
          )
          setPublishKind(provider.kind)
          setPublishAgentId(agent.agentId)
        }}
        onRetryPublish={(provider, agent) => {
          setPublishKind(provider.kind)
          setPublishAgentId(agent.agentId)
          setPublishBoundAppId(provider.memberBots.find(bot => bot.agentId === agent.agentId)?.appId ?? null)
          const pending = channelProvisioning(snapshot, provider.kind)
          if (pending?.agentId === agent.agentId && pending.failureCode === 'dingtalk_approver_selection_required') return
          void run(
          `retry:${provider.kind}:${agent.agentId}`,
          provider.kind,
          () => channels.retryMemberBot(agent.agentId, provider.kind)
        )
        }}
      />

      {channels.native && <QrDialog
        snapshot={snapshot}
        kind={selectedKind}
        busy={busy !== null}
        onClose={(attemptId) => void cancelQrAttempt(attemptId, selectedKind)}
        onRefresh={(attemptId) => void refreshLoginQr(attemptId, selectedKind)}
      />}

      <PublishBotDialog
        agent={agents.find((candidate) => candidate.agentId === publishAgentId) ?? null}
        kind={publishKind}
        account={publishChannel?.connection.account ?? null}
        boundAppId={publishBoundAppId}
        provisioning={provisioning?.agentId === publishAgentId ? provisioning : null}
        busy={busy !== null}
        error={channelActionErrorFor(error, publishKind)}
        onClose={() => {
          setPublishAgentId(null)
          setPublishBoundAppId(null)
        }}
        onReconnect={channels.native ? () => {
          setPublishAgentId(null)
          setPublishBoundAppId(null)
          setSelectedKind(publishKind)
          void run(`connect:${publishKind}`, publishKind, () => channels.native!.connect(publishKind))
        } : undefined}
        onPublish={(agentId) => {
          void run(
            `publish:${publishKind}:${agentId}`,
            publishKind,
            () => channels.publishMemberBot(agentId, publishKind)
          ).then((next) => {
              if (
                channelProvisioning(next, publishKind)?.stage === 'completed'
              ) {
                setPublishAgentId(null)
                setPublishBoundAppId(null)
              }
            })
        }}
        onSelectApprover={(agentId, userId) => {
          void run(
            `approve:${publishKind}:${agentId}`,
            publishKind,
            () => channels.selectPublicationApprover(agentId, userId, publishKind)
          ).then((next) => {
            if (
              channelProvisioning(next, publishKind)?.stage === 'completed'
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
  desktopManagedWeb = false,
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
  desktopManagedWeb?: boolean
  onRetry?(): void
  onSelectChannel?(kind: ChannelKind): void
  onConnect?(channel: ChannelProviderView): void
  onDisconnect?(channel: ChannelProviderView): void
  onPublish?(channel: ChannelProviderView, agent: AgentProfile): void
  onRetryPublish?(channel: ChannelProviderView, agent: AgentProfile): void
}): React.JSX.Element {
  const members = useMemo(() => visibleChannelMembers(agents), [agents])
  const channels = snapshot?.channels ?? []
  const manageableChannels = channels
  const channel = manageableChannels.find((candidate) => candidate.kind === selectedKind)
    ?? manageableChannels[0]
    ?? null
  const providerName = channel?.displayName ?? '渠道'

  return (
    <div className="channel-settings">
      <SettingsPageHeader
        eyebrow="Settings / Channels"
        title="渠道"
        description={desktopManagedWeb ? '渠道由运行此服务的 Rovai Desktop 管理。连接、切换账号和重新登录，请在该电脑的桌面应用中完成；已有账号的 Bot 发布和重试可以在此操作。' : '连接飞书、Lark 或钉钉，让队员在你常用的平台协作。'}
        aside={<span className="settings-page-note">{desktopManagedWeb ? '宿主 Desktop 管理' : '本机管理'}</span>}
      />

      {loading && !snapshot && <ChannelSettingsState label="正在读取渠道状态…" />}

      {!loading && !snapshot && (
        <ChannelSettingsState
          label={error ?? '渠道状态暂时不可用。'}
          tone="error"
          action={<button className="quiet-button compact" type="button" onClick={onRetry}>重试</button>}
        />
      )}

      {snapshot && (
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
              description="选择要连接的平台。"
              summary={`${manageableChannels.length} 个可用渠道`}
            />
            <div className="channel-provider-strip" role="tablist" aria-label="渠道">
              {manageableChannels.map((provider) => {
                const selected = provider.kind === channel?.kind
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

          {!channel && <ChannelSettingsState label="当前版本没有可用的渠道。" tone="empty" />}

          {channel && <>
            <section className="channel-settings-section" aria-labelledby="channel-connection-heading">
              <ChannelSectionHeading
                id="channel-connection-heading"
                title={channelCopy`${providerName}连接`}
                description="连接后可发布队员 Bot。"
              />
              <ChannelConnectionRow
                channel={channel}
                remote={desktopManagedWeb}
                busy={busy}
                onConnect={onConnect}
                onDisconnect={onDisconnect}
              />
              {channelProviderPresentation(channel.kind).qualificationNote && (
                <p className="channel-qualification-note">
                  {channelProviderPresentation(channel.kind).qualificationNote}
                </p>
              )}
              <details className="settings-disclosure channel-policy"><summary><OwnerShieldIcon /><span>连接与权限</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></summary><div><p>只有 Rovai Owner 可以从外部渠道触发队员；项目选择与执行管理仍由运行服务的 Desktop 掌控。</p><p>连接只决定后续 Bot 的发布目标，切换连接不会迁移或停用已发布 Bot。</p><p>账号会话和应用凭据保存在运行服务的 Desktop 所在设备。项目绝对路径不会发送到外部渠道。</p><p>{channelCopy`${providerName}中的 Owner 消息不获得本机管理权限。`}</p></div></details>
            </section>

            <section className="channel-settings-section" aria-labelledby="channel-member-bots-heading">
              <ChannelSectionHeading
                id="channel-member-bots-heading"
                title="队员 Bot"
                description="每位队员使用独立的 Bot 身份。"
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
          </>}

          {!desktopManagedWeb && <ExecutionWebSettingsPanel />}
        </div>
      )}

      {!snapshot && !desktopManagedWeb && <ExecutionWebSettingsPanel />}
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
        <span className={`execution-web-status is-${status.tone}`}>
          <span className="execution-web-status-dot" aria-hidden="true" />
          <span>{status.label}</span>
        </span>
        <span className="execution-web-disclosure" aria-hidden="true">
          <svg viewBox="0 0 20 20">
            <path d="m5.5 7.75 4.5 4.5 4.5-4.5" />
          </svg>
        </span>
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
            <DialogControlIcon name="save" />{saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </details>
  )
}

export function executionWebStatus(snapshot: ExecutionWebSettingsSnapshot | null): {
  label: string
  tone: 'neutral' | 'success' | 'warning'
} {
  if (!snapshot || !snapshot.enabled || snapshot.server.state === 'disabled') {
    return { label: '未开启', tone: 'neutral' }
  }
  if (snapshot.server.state === 'no_published_bot') {
    return { label: `等待 Bot 发布 · ${snapshot.port}`, tone: 'neutral' }
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
  remote = false,
  busy,
  onConnect,
  onDisconnect
}: {
  channel: ChannelProviderView
  remote?: boolean
  busy: string | null
  onConnect?: (channel: ChannelProviderView) => void
  onDisconnect?: (channel: ChannelProviderView) => void
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const account = channel.connection.account
  const connected = channel.connection.status === 'connected' && account !== null
  const expired = channel.connection.status === 'session_expired'
  const hostReady = channel.hostStatus === 'ready'
  const disabled = busy !== null || !hostReady
  const menuDisabled = disabled || (!onConnect && !onDisconnect)
  const providerName = channel.displayName
  const connectBusy = busy === `connect:${channel.kind}`
  const disconnectBusy = busy === `disconnect:${channel.kind}`
  const presentation = channelProviderPresentation(channel.kind)
  const connectLabel = !hostReady ? '尚未开放'
    : expired ? '重新连接'
      : presentation.connectLabel

  useEffect(() => {
    setMenuOpen(false)
  }, [channel.kind, channel.connection.status, account?.accountId, menuDisabled])

  return (
    <div className="channel-connection-row" aria-busy={connectBusy || disconnectBusy}>
      <ChannelMark kind={channel.kind} />
      <div className="channel-connection-label">
        <strong>{channelCopy`${providerName}开放平台`}</strong>
        <span>{hostReady
          ? '开发者账号会话 · 保存在 Rovai 本地数据库'
          : '渠道宿主尚未就绪'}</span>
      </div>
      {account ? (
        <div className="channel-account-summary">
          <span className="channel-account-avatar" aria-hidden="true">{firstGrapheme(account.userName ?? channelCopy`${providerName}用户`)}</span>
          <span>
            <span className="channel-account-heading">
              <strong>{account.userName ?? channelCopy`${providerName}用户`}</strong>
              <span className={`channel-connection-status${connected && channel.connection.sessionStatus === 'valid' ? ' is-connected' : ''}${expired ? ' is-expired' : ''}`} role="status">
                {disconnectBusy ? '断开中…' : connected ? sessionLabel(channel) : expired ? '登录已失效' : '未连接'}
              </span>
            </span>
            <small>{account.email ? `${account.email} · ` : ''}{account.tenantName ?? '当前企业'} · {account.brand === 'lark' ? 'Lark' : providerName}</small>
          </span>
        </div>
      ) : (
        <span className="channel-account-empty">{!hostReady ? '连接能力尚未开放'
          : expired
            ? '登录已失效，请重新连接' : channelCopy`还没有连接${providerName}账号`}</span>
      )}
      {!remote && <div className="channel-connection-actions">
        {connected ? (
          <DropdownMenu.Root open={menuOpen && !menuDisabled} onOpenChange={setMenuOpen} modal={false}>
            <DropdownMenu.Trigger asChild>
              <button
                className="quiet-button compact channel-connection-trigger"
                type="button"
                disabled={menuDisabled}
                title={!hostReady ? channelCopy`${providerName}渠道宿主尚未接入` : undefined}
                aria-label={channelCopy`管理连接（${providerName}）`}
              >
                <span>管理连接</span>
                <DialogControlIcon name="chevron" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="compact-menu channel-connection-menu"
                align="end"
                sideOffset={6}
                collisionPadding={12}
                loop
                onCloseAutoFocus={(event) => event.preventDefault()}
                aria-label={channelCopy`${providerName}连接操作`}
              >
                <DropdownMenu.Item
                  className="compact-option channel-connection-menu-item"
                  disabled={!onConnect}
                  onSelect={() => onConnect?.(channel)}
                >
                  <svg className="channel-connection-menu-icon" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M3 6h13m-3-3 3 3-3 3M17 14H4m3-3-3 3 3 3" />
                  </svg>
                  <span>切换账号<small>重新扫码，连接另一个开发者账号</small></span>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="channel-connection-menu-separator" />
                <DropdownMenu.Item
                  className="compact-option channel-connection-menu-item is-danger"
                  disabled={!onDisconnect}
                  onSelect={() => onDisconnect?.(channel)}
                >
                  <svg className="channel-connection-menu-icon" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M8 3H4v14h4M9 10h8m-3-3 3 3-3 3" />
                  </svg>
                  <span>断开连接<small>退出开发者账号，保留已发布 Bot</small></span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : (
          <button
            className="quiet-button compact"
            type="button"
            disabled={disabled || !onConnect}
            title={!hostReady ? channelCopy`${providerName}渠道宿主尚未接入` : undefined}
            onClick={() => onConnect?.(channel)}
          >
            {connectBusy ? '等待扫码…' : connectLabel}
          </button>
        )}
      </div>}
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
        <span role="columnheader">队员</span><span role="columnheader">{channelCopy`${channel.displayName}身份`}</span><span role="columnheader">状态</span><span role="columnheader" aria-label="操作" />
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
                  : <span>发布后沿用队员身份</span>}
              </div>
              <span className={`channel-publication-status is-${status}`} role="cell">
                <span>{bot?.published && status !== 'published' ? `已发布 · ${publicationLabel(status)}` : publicationLabel(status)}</span>
                {bot?.appId && <small className="channel-live-status">{bot.connectionStatus === 'online' ? '连接在线' : bot.connectionStatus === 'offline' ? '连接离线' : '连接状态未知'}</small>}
              </span>
              <div className="channel-member-action" role="cell">
                {published && bot?.managementUrl ? (
                  <a
                    className="channel-row-action"
                    href={bot.managementUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={channelCopy`在${channel.displayName}开放平台管理 ${agent.displayName}`}
                  >
                    {channelCopy`${channel.displayName}管理`}
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
  const presentation = channelProviderPresentation(attemptKind)
  const providerName = presentation.name
  const interaction = presentation.supportsNativeLoginInteraction && attempt.stage === 'awaiting_interaction'
  const committing = attempt.stage === 'saving_local_session'
  const refreshable = attempt.stage === 'expired' || attempt.stage === 'awaiting_refresh'
  const deadlineDetail = attempt.expiresAt
    ? `二维码有效期至 ${formatLocalTime(attempt.expiresAt)}`
    : null
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !committing) onClose(attempt.attemptId) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent className={`channel-qr-dialog${presentation.qrDialogClassName}${interaction ? ' has-platform-view' : ''}`}>
          <AppDialogHeader
            title={channelCopy`登录${providerName}开放平台`}
            description="仅登录开发者平台，本次不会创建应用或发布 Bot。"
            icon="shield"
            closeDisabled={committing}
          />
          <AppDialogBody className="channel-qr-body">
            {interaction
              ? <ChannelLoginViewport key={attempt.attemptId} attemptId={attempt.attemptId} />
              : refreshable
                ? <button
                    className={`channel-qr-frame channel-qr-refresh is-${attempt.stage}`}
                    type="button"
                    aria-label="刷新二维码"
                    onClick={() => onRefresh(attempt.attemptId)}
                  >
                    <DialogControlIcon name="refresh" />
                    {attempt.stage === 'expired' && <span>二维码已过期</span>}
                    <strong>点击刷新</strong>
                  </button>
              : <div className={`channel-qr-frame is-${attempt.stage}`}>
                  {attempt.qrDataUrl
                    ? <img src={attempt.qrDataUrl} alt={channelCopy`${providerName}连接二维码`} />
                    : <span aria-hidden="true"><ChannelMark kind={attemptKind} /></span>}
                </div>}
            <strong role="status" aria-live="polite">{attempt.detail}</strong>
            {!refreshable && deadlineDetail && <small>{deadlineDetail}</small>}
          </AppDialogBody>
          <AppDialogFooter>
            {attempt.commitUncertain && <button
              className="primary-button" type="button" onClick={() => onRefresh(attempt.attemptId)}
            >核对保存结果</button>}
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
  onReconnect?: () => void
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
  const presentation = channelProviderPresentation(kind)
  const providerName = presentation.name
  const terminal = provisioning
    ? ['completed', 'failed', 'unknown_remote_state'].includes(provisioning.stage)
    : false
  const effectiveAppId = boundAppId ?? provisioning?.remoteAppId ?? null
  const retryLocked = provisioning?.stage === 'unknown_remote_state'
    && provisioning.remoteAppId === null
  const connectionFailed = provisioning?.failureCode === 'feishu_connection_error'
    || provisioning?.failureCode === 'dingtalk_connection_error'
  const sessionUnavailable = Boolean(error && /登录已过期|账号已变化|重新连接账号|重新连接/.test(error))
  const awaitingApprover = presentation.approverSelectionFailureCode !== null
    && provisioning?.failureCode === presentation.approverSelectionFailureCode
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && (!busy || terminal)) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent className="channel-publish-dialog">
          <AppDialogHeader
            title={boundAppId
              ? channelCopy`重新发布「${agent.displayName}」${providerName} Bot`
              : channelCopy`发布「${agent.displayName}」为${providerName} Bot`}
            description={effectiveAppId ? "核对并恢复已有应用，保持原 App ID。" : "将使用当前账号创建并发布这位队员的独立应用。"}
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
              <span><strong>{channelCopy`独立${providerName} Bot`}</strong><small>权限、事件与长连接彼此隔离</small></span>
            </div>
            <div className="channel-dialog-fact"><span>发布账号</span><strong>{account.userName ?? channelCopy`${providerName}用户`}</strong></div>
            <div className="channel-dialog-fact"><span>所属租户</span><strong>{account.tenantName ?? '当前企业'}</strong></div>
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
                <small>钉钉要求由 Owner 明确选择，Rovai 不会自动代选。</small>
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
                  ? channelCopy`该队员的${providerName}身份已冻结到此应用；重新发布只恢复原应用的配置、版本和连接。`
                  : "发布前会验证账号与租户；账号变化或登录失效时，需要重新连接。"}
              </p>
            )}
          </AppDialogBody>
          <AppDialogFooter note={connectionFailed
            ? effectiveAppId
              ? '已保留原应用绑定；关闭后可以稍后重试。'
              : channelCopy`${providerName}连接异常；关闭后可以稍后重试。`
            : retryLocked
              ? '创建结果无法确认。Rovai 已锁定再次创建，避免产生重复应用。'
            : effectiveAppId
              ? '重新发布始终复用已绑定应用，不提供换绑入口。'
              : null}>
            <button className="quiet-button" type="button" disabled={busy && !terminal} onClick={onClose}>取消</button>
            {sessionUnavailable && onReconnect ? (
              <button className="primary-button" type="button" disabled={busy} onClick={onReconnect}>
                {channelCopy`重新连接${providerName}`}
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
  const presentation = channelProviderPresentation(kind)
  return (
    <span className={`channel-mark channel-mark-${kind}`} aria-hidden="true">
      <img src={presentation.logo} alt="" />
    </span>
  )
}

function OwnerShieldIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.8 2.8 8.3 7 10 4.2-1.7 7-5.2 7-10V6Z" /><path d="m9 12 2 2 4-4" /></svg>
}

function sessionLabel(channel: ChannelProviderView): string {
  return channel.connection.sessionStatus === 'valid' ? '登录有效'
    : channel.connection.sessionStatus === 'invalid' ? '登录已失效'
      : channel.connection.sessionStatus === 'unavailable' ? '登录态暂不可用' : '登录态待校验'
}

function connectionLabel(channel: ChannelProviderView): string {
  if (channel.connection.status === 'connected') return sessionLabel(channel)
  if (channel.connection.status === 'session_expired') return '需重新连接'
  return '未连接'
}

function memberSummary(members: readonly AgentProfile[], bots: readonly ChannelMemberBotView[]): string {
  const visibleMemberIds = new Set(members.map((member) => member.agentId))
  const published = bots.filter((bot) => visibleMemberIds.has(bot.agentId) && (bot.published ?? bot.publicationStatus === 'published')).length
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
  if (message === 'channel_publication_busy') return '已有渠道发布正在进行，请查看原发布进度。'
  if (message === 'feishu_login_cancelled') return null
  const loginDetail = feishuLoginFailureDetail(message)
  if (loginDetail) return loginDetail
  if (message === 'dingtalk_operation_cancelled') return null
  const loginHttp = /^dingtalk_login_http_(\d{3})$/u.exec(message)
  if (loginHttp) return `钉钉登录服务暂时无法完成请求（HTTP ${loginHttp[1]}），请稍后重试。`
  const loginBusiness = /^dingtalk_login_business_(\d{1,9})$/u.exec(message)
  if (loginBusiness) return `钉钉未接受本次登录（错误码 ${loginBusiness[1]}），请重新连接。`
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
    dingtalk_login_timeout: '请刷新二维码后继续扫码。',
    dingtalk_login_scan_timeout: '请刷新二维码后继续扫码。',
    dingtalk_login_request_timeout: '钉钉登录请求超时，请检查网络后重试。',
    dingtalk_login_handoff_timeout: '建立钉钉后台会话超时，请重新连接。',
    dingtalk_login_identity_timeout: '读取钉钉账号与企业身份超时，请稍后重试。',
    dingtalk_login_protocol_incompatible: '钉钉登录接口返回了暂不支持的结果，无法继续本次连接。',
    dingtalk_login_response_invalid: '暂时无法解析钉钉登录响应，请稍后重试。',
    dingtalk_login_response_too_large: '钉钉登录响应超出处理范围，请稍后重试。',
    dingtalk_login_unavailable: '暂时无法访问钉钉登录服务，请检查网络后重试。',
    dingtalk_login_redirect_rejected: '钉钉登录要求跳转到暂不支持的认证页面，无法继续本次连接。',
    dingtalk_login_redirect_limit: '钉钉登录跳转次数过多，请稍后重试。',
    dingtalk_login_rejected: '本次钉钉登录已被拒绝或取消，请重新连接。',
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
