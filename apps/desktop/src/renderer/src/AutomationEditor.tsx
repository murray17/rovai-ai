import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { AgentProfile, AutomationRunListPage, AutomationRunSummary, AutomationView, ChannelSettingsSnapshot, ProjectNavigationGroup } from '@contracts'
import { MemberAvatar } from './MemberAvatar'
import { AutomationGlyph, type AutomationIcon } from './AutomationControls'
import { dateTimeLabel, projectValue, projectFromValue, runStatus, scheduleKinds, scheduleWithKind, weekdays, type AutomationDraft } from './automation-workspace-model'
import { readErrorMessage } from './error-message'
import { runtimeAdapterDisplayLabel } from '../../shared/execution-presentation'
import feishuLogo from './assets/channel-logos/feishu.svg'
import dingtalkLogo from './assets/channel-logos/dingtalk.svg'

function Picker({ label, value, options, onChange, children, disabled = false }: {
  label: string
  value: string
  options: Array<{ value: string; label: React.ReactNode; disabled?: boolean }>
  onChange(value: string): void
  children: React.ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button className="automation-picker" type="button" aria-label={label} disabled={disabled}>{children}<AutomationGlyph name="chevron" /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="automation-menu automation-picker-menu" align="end" sideOffset={5} collisionPadding={12} aria-label={label} loop>
      <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
        {options.map((option) => <DropdownMenu.RadioItem key={option.value} className="automation-menu-item automation-picker-option" value={option.value} disabled={option.disabled}>
          {option.label}<DropdownMenu.ItemIndicator><AutomationGlyph name="check" /></DropdownMenu.ItemIndicator>
        </DropdownMenu.RadioItem>)}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>
}

function MemberCopy({ member }: { member: AgentProfile }): React.JSX.Element {
  const runtime = member.runtimeConfiguration
  return <><MemberAvatar agentId={member.agentId} avatarRef={member.avatarRef} displayName={member.displayName} size="mention" decorative />
    <span className="automation-picker-copy"><span><strong>{member.displayName}</strong><em>{member.teamRole}</em></span><small>{runtime ? `${runtimeAdapterDisplayLabel(runtime.adapterKind)}${runtime.model.mode === 'explicit' ? ` · ${runtime.model.modelId}` : ''}` : '尚未配置运行时'}</small></span></>
}

function RunHistory({ automation, onOpenCamp }: { automation: AutomationView; onOpenCamp(campId: string): void }): React.JSX.Element {
  const [runs, setRuns] = useState<AutomationRunSummary[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const runsRef = useRef(runs)
  const loadingRef = useRef(false)
  runsRef.current = runs
  const load = useCallback(async (nextCursor: string | null = null): Promise<void> => {
    if (loadingRef.current) return
    loadingRef.current = true
    const request = ++generation.current
    setLoading(true)
    setError(null)
    try {
      // Refresh every visible page: a newer skipped run can hide an older active run in lastRun.
      const targetCount = nextCursor ? 20 : Math.max(20, runsRef.current.length)
      const loaded: AutomationRunSummary[] = []
      const seen = new Set<string>()
      let pageCursor = nextCursor
      do {
        const page = await window.rovai.request<AutomationRunListPage>('automations.runs.list', { automationId: automation.automationId, limit: 20, ...(pageCursor ? { cursor: pageCursor } : {}) })
        if (request !== generation.current) return
        if (page.truncated && (!page.nextCursor || page.nextCursor === pageCursor || seen.has(page.nextCursor))) throw new Error('执行历史分页状态无效，请重试。')
        loaded.push(...page.runs)
        pageCursor = page.truncated ? page.nextCursor : null
        if (pageCursor) seen.add(pageCursor)
      } while (pageCursor && loaded.length < targetCount)
      if (request !== generation.current) return
      setRuns((current) => nextCursor ? [...current, ...loaded.filter((run) => !current.some((item) => item.runId === run.runId))] : loaded)
      setCursor(pageCursor)
    } catch (nextError) {
      if (request === generation.current) setError(readErrorMessage(nextError))
    } finally {
      if (request === generation.current) { loadingRef.current = false; setLoading(false) }
    }
  }, [automation.automationId])
  useEffect(() => {
    void load()
    const interval = window.setInterval(() => void load(), 5_000)
    const unsubscribe = window.rovai.onEvent((event) => {
      if (event.method === 'automations.updated') void load()
    })
    return () => { generation.current += 1; loadingRef.current = false; window.clearInterval(interval); unsubscribe() }
  }, [load])
  // The definition refresh supplies current terminal/notification facts without resetting older pages.
  useEffect(() => {
    const latest = automation.lastRun
    if (latest) setRuns((current) => [latest, ...current.filter((run) => run.runId !== latest.runId)])
  }, [automation.lastRun])

  return <section className="automation-history" aria-labelledby="automation-history-heading">
    <h2 id="automation-history-heading">执行历史</h2>
    {runs.length === 0 && <p className="automation-history-empty">{loading ? '正在读取执行记录…' : error ? '执行历史暂时不可用' : '还没有执行记录'}</p>}
    <div aria-busy={loading}>
      {runs.map((run) => {
        const state = runStatus(run)
        const icon: AutomationIcon = run.status === 'completed' ? 'check' : run.status === 'failed' ? 'failed' : run.status === 'skipped' ? 'skip' : 'clock'
        return <button key={run.runId} className={`automation-history-row ${state.tone}`} type="button" disabled={!run.campId} onClick={() => { if (run.campId) onOpenCamp(run.campId) }} title={state.detail ?? state.label} aria-label={`${state.label}，${dateTimeLabel(run.createdAt)}${run.campId ? '，打开执行对话' : ''}`}>
          <AutomationGlyph name={icon} /><span><time dateTime={run.createdAt}>{dateTimeLabel(run.createdAt)}</time><small>{state.detail ?? state.label}</small></span><span className="automation-history-state">{state.label}</span>{run.campId && <span className="automation-history-open"><AutomationGlyph name="chat" /></span>}
        </button>
      })}
    </div>
    {error && <div className="automation-history-error" role="alert"><span>{error}</span><button type="button" className="quiet-button compact" onClick={() => void load()}>重试读取</button></div>}
    {cursor && !error && <button type="button" className="quiet-button compact" disabled={loading} onClick={() => void load(cursor)}>{loading ? '正在读取…' : '更早的执行记录'}</button>}
  </section>
}

export function AutomationEditor({ draft, onChange, agents, projects, automation, titleRef, busy, onOpenCamp, onCreate }: {
  draft: AutomationDraft
  onChange: Dispatch<SetStateAction<AutomationDraft>>
  agents: AgentProfile[]
  projects: ProjectNavigationGroup[]
  automation: AutomationView | null
  titleRef: RefObject<HTMLInputElement | null>
  busy: boolean
  onOpenCamp(campId: string): void
  onCreate(): void
}): React.JSX.Element {
  const [channels, setChannels] = useState<ChannelSettingsSnapshot | null>(null)
  const [channelError, setChannelError] = useState(false)
  const [channelsOpen, setChannelsOpen] = useState(false)
  const loadChannels = useCallback(async (): Promise<void> => {
    setChannelError(false)
    try { setChannels(await window.rovai.channels.get()) } catch { setChannelError(true) }
  }, [])
  useEffect(() => {
    if (!channelsOpen) return
    void loadChannels()
    return window.rovai.channels.onChanged(setChannels)
  }, [channelsOpen, loadChannels])
  const member = agents.find((agent) => agent.agentId === draft.memberId)
  const selectableMembers = agents.filter((agent) => agent.presence === 'present')
  const project = draft.projectRef.kind === 'directory' ? projects.find((item) => item.projectPath === projectValue(draft.projectRef)) : null
  const projectName = draft.projectRef.kind === 'quick_chat' ? '快速对话' : project?.name ?? draft.projectRef.path.split(/[\\/]/).filter(Boolean).at(-1) ?? draft.projectRef.path
  const projectDetail = draft.projectRef.kind === 'quick_chat' ? 'Rovai AI 管理的快速对话目录' : draft.projectRef.path
  const schedule = draft.schedule

  return <div className="automation-editor-scroll"><form className="automation-form" onSubmit={(event) => { event.preventDefault(); if (!automation && !busy && draft.prompt.trim() && member?.presence === 'present') onCreate() }}>
    <input ref={titleRef} className="automation-name-input" aria-label="定时任务名称" value={draft.name} maxLength={80} placeholder="定时任务名称" disabled={busy} onChange={(event) => onChange((current) => ({ ...current, name: event.target.value }))} />
    <textarea className="automation-prompt-input" aria-label="执行内容" rows={3} value={draft.prompt} placeholder="告诉队员需要按时完成什么…" disabled={busy} onChange={(event) => onChange((current) => ({ ...current, prompt: event.target.value }))} />
    <div className="automation-context" aria-label="执行上下文">
      <div className="automation-context-field"><span>队员</span>
        <Picker label={`执行队员：${member?.displayName ?? '选择队员'}`} value={draft.memberId} disabled={busy || selectableMembers.length === 0} onChange={(memberId) => onChange((current) => ({ ...current, memberId }))} options={selectableMembers.map((agent) => ({ value: agent.agentId, label: <MemberCopy member={agent} /> }))}>
          {member ? <MemberCopy member={member} /> : <span className="automation-picker-copy"><strong>{selectableMembers.length ? '选择队员' : '暂无可用队员'}</strong></span>}
        </Picker>
      </div>
      {member?.presence !== 'present' && <p className="automation-field-note" role="status">{selectableMembers.length ? '原队员不可用，请重新选择。' : '请先在队员页添加一位队员。'}</p>}
      <div className="automation-context-field"><span>运行项目</span>
        <Picker label={`运行项目：${projectName}`} value={projectValue(draft.projectRef)} disabled={busy} onChange={(value) => onChange((current) => ({ ...current, projectRef: projectFromValue(value) }))} options={[
          { value: 'quick-chat', label: <><AutomationGlyph name="chat" /><span className="automation-picker-copy"><strong>使用快速对话</strong><small>Rovai AI 管理的快速对话目录</small></span></> },
          ...projects.map((item) => ({ value: item.projectPath, label: <><AutomationGlyph name="folder" /><span className="automation-picker-copy"><strong>{item.name}</strong><small>{item.projectPath}</small></span></> }))
        ]}>
          <span className="automation-project-icon"><AutomationGlyph name={draft.projectRef.kind === 'quick_chat' ? 'chat' : 'folder'} /></span><span className="automation-picker-copy" title={projectDetail}><strong>{projectName}</strong><small>{projectDetail}</small></span>
        </Picker>
      </div>
    </div>
    <section className="automation-schedule" aria-labelledby="automation-schedule-heading">
      <h2 id="automation-schedule-heading">运行时间</h2>
      <div className="automation-schedule-panel">
        <div className="automation-schedule-row"><span>重复</span><Picker label="重复频率" value={schedule.kind} disabled={busy} options={scheduleKinds.map((item) => ({ value: item.value, label: item.label }))} onChange={(value) => onChange((current) => ({ ...current, schedule: scheduleWithKind(value as AutomationDraft['schedule']['kind']) }))}>{scheduleKinds.find((item) => item.value === schedule.kind)?.label}</Picker></div>
        {schedule.kind === 'weekly' && <div className="automation-schedule-row"><span>星期</span><Picker label="星期" value={schedule.weekday} disabled={busy} options={weekdays.map((item) => ({ value: item.value, label: item.label }))} onChange={(value) => onChange((current) => ({ ...current, schedule: { ...schedule, weekday: value as typeof schedule.weekday } }))}>{weekdays.find((day) => day.value === schedule.weekday)?.label}</Picker></div>}
        {schedule.kind === 'once' && <label className="automation-schedule-row"><span>日期</span><input type="date" aria-label="日期" value={schedule.date} disabled={busy} onChange={(event) => onChange((current) => ({ ...current, schedule: { ...schedule, date: event.target.value } }))} /></label>}
        {'at' in schedule && <label className="automation-schedule-row"><span>时间</span><input type="time" aria-label="时间" value={schedule.at} disabled={busy} onChange={(event) => onChange((current) => ({ ...current, schedule: { ...schedule, at: event.target.value } }))} /></label>}
        {schedule.kind === 'cron' && <label className="automation-schedule-row automation-cron-row"><span>Cron</span><input aria-label="5 段 Cron 表达式" placeholder="0 9 * * 1-5" value={schedule.expression} disabled={busy} spellCheck={false} onChange={(event) => onChange((current) => ({ ...current, schedule: { ...schedule, expression: event.target.value } }))} /></label>}
      </div>
      {automation?.nextRunAt && <p className="automation-next-run">下次 <time dateTime={automation.nextRunAt}>{dateTimeLabel(automation.nextRunAt)}</time><span>本地时间</span></p>}
      {automation && !automation.enabled && <p className="automation-next-run">已关闭，可在任务操作中运行一次。</p>}
    </section>
    <details className="automation-channel-disclosure" onToggle={(event) => setChannelsOpen(event.currentTarget.open)}>
      <summary><span className="automation-channel-symbol"><AutomationGlyph name="channel" /></span><span><strong>通知到渠道</strong><small>由当前队员的渠道 Bot 发送结果</small></span><span className="automation-channel-count">{draft.notifyChannels.length ? draft.notifyChannels.map((channel) => channel === 'feishu' ? '飞书' : '钉钉').join('、') : '未选择'}</span><AutomationGlyph name="chevron" /></summary>
      <fieldset className="automation-channel-options"><legend className="sr-only">完成后通知</legend>
        {(['feishu', 'dingtalk'] as const).map((channel) => {
          const provider = channels?.channels.find((item) => item.kind === channel)
          const bot = provider?.memberBots.find((item) => item.agentId === draft.memberId)
          const available = bot?.publicationStatus === 'published'
          const checked = draft.notifyChannels.includes(channel)
          return <label key={channel} className={`automation-channel-option ${!available ? 'unavailable' : ''}`}>
            <input type="checkbox" checked={checked} disabled={busy || (!available && !checked)} onChange={(event) => onChange((current) => ({ ...current, notifyChannels: event.target.checked ? [...new Set([...current.notifyChannels, channel])] : current.notifyChannels.filter((item) => item !== channel) }))} />
            <img src={channel === 'feishu' ? feishuLogo : dingtalkLogo} alt="" /><span><strong>{channel === 'feishu' ? '飞书' : '钉钉'}</strong><small>{available ? bot.botDisplayName ?? `${member?.displayName ?? '队员'} Bot` : channelError ? '暂时无法读取' : !channels ? '正在读取…' : '队员尚未发布 Bot'}</small></span>
          </label>
        })}
      </fieldset>
      {channelError && <button type="button" className="quiet-button compact" onClick={() => void loadChannels()}>重试读取渠道</button>}
      <p className="automation-channel-note">发送到你的 Bot 私聊。通知失败只重试通知，不重新运行任务。</p>
    </details>
    {!automation && <div className="automation-create-actions"><span>名称可留空，创建后自动开启。</span><button className="primary-button" type="submit" disabled={busy || !draft.prompt.trim() || member?.presence !== 'present'}>{busy ? '正在创建…' : '创建'}</button></div>}
  </form>
    {automation && <RunHistory automation={automation} onOpenCamp={onOpenCamp} />}
  </div>
}
