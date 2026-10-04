import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { AdapterInstallation, AgentProfile, MemberRuntimeConfiguration } from '@contracts'
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader, DialogControlIcon } from './AppDialog'
import { MemberAvatar } from './MemberAvatar'
import { RuntimeGlyph } from './MemberRuntimePicker'
import { runtimeEditorInstallation } from './MemberRuntimeParameters'
import { adapterLabel } from './runtime-products'
import { useThreadClient } from './camp-client'
import { uiAttribute, useUiText } from './interface-language'
import { MemberRuntimeCommandError } from './member-runtime-commands'
import {
  applyRuntimeToMember, reconcileUnknownRuntimeApply, runtimeApplyEligibility,
  type RuntimeApplyEditorState, type RuntimeApplyEnvironment, type RuntimeApplyResult
} from './member-runtime-apply'
import './member-runtime-apply.css'

export type RuntimeApplySource = AgentProfile & { runtimeConfiguration: MemberRuntimeConfiguration }

export function RuntimeApplyIcon(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8h10m-4-4 4 4-4 4"/>
  </svg>
}

const permissionLabels: Record<string, string> = {
  sandbox_mode: '文件系统访问', approval_policy: '审批策略', permission_mode: '权限模式',
  permission: '工具权限', allow_all: '自动允许全部操作', trust_all_tools: '自动允许全部工具',
  approval_mode: '审批模式', execution_mode: '执行模式', mode: '执行模式',
  sandbox: '终端沙箱', dangerously_skip_permissions: '自动通过权限请求'
}
const optionLabels: Record<string, string> = {
  reasoning_effort: '推理强度', effort: '思考强度', thinking_level: '思考深度'
}
const liveMembers = (members: AgentProfile[], sourceId: string): AgentProfile[] =>
  members.filter(member => member.agentId !== sourceId && member.presence !== 'removed' && member.removedAt === null)
const finished = (result: RuntimeApplyResult): boolean => result.status === 'applied' || result.status === 'matched'
const valueLabel = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value) ?? ''

function runtimeSummary(configuration: MemberRuntimeConfiguration | null): string {
  if (!configuration) return uiAttribute('未配置智能体')
  return adapterLabel(configuration.adapterKind) + ' · ' +
    (configuration.model.mode === 'runtime_default' ? uiAttribute('默认') : configuration.model.modelId)
}

function SnapshotDetails({ source, installations }: { source: RuntimeApplySource; installations: AdapterInstallation[] }): React.JSX.Element {
  const t = useUiText()
  const config = source.runtimeConfiguration
  const schema = runtimeEditorInstallation(installations, config.adapterKind)?.snapshot
  const model = config.model.mode === 'explicit' ? config.model : null
  const descriptor = model ? schema?.models.find(item => item.id === model.modelId) : null
  return <section className="apply-source" aria-label={t('将应用的配置')}>
    <div className="apply-source-identity"><MemberAvatar {...source} size="list" decorative/>
      <div><span className="apply-label">{t('配置来源')}</span><strong>{source.displayName}</strong></div>
      <span className="apply-source-runtime"><RuntimeGlyph kind={config.adapterKind}/>{adapterLabel(config.adapterKind)}</span>
    </div>
    <dl className="apply-config">
      <div><dt>{t('模型')}</dt><dd>{model ? descriptor?.displayName ?? model.modelId : t('默认')}</dd></div>
      {model && Object.entries(model.options).map(([key, value]) => {
        const option = descriptor?.options.find(item => item.key === key)
        return <div key={key}><dt>{optionLabels[key] ? t(optionLabels[key]) : option?.label ?? key}</dt>
          <dd>{option?.values.find(choice => choice.value === value)?.label ?? valueLabel(value)}</dd></div>
      })}
    </dl>
    <details className="apply-permissions"><summary>{t('同时应用权限设置')}<DialogControlIcon name="chevron"/></summary>
      <dl className="apply-config">{Object.entries(config.permissions.values).map(([key, value]) => {
        const option = schema?.permissionOptions.find(item => item.key === key)
        const label = config.adapterKind === 'deepseek-harness' ? key : t(permissionLabels[key] ?? key)
        return <div key={key}><dt>{label}</dt><dd>{option?.choices?.find(choice => choice.value === value)?.label ?? valueLabel(value)}</dd></div>
      })}
        {Object.keys(config.permissions.values).length === 0 && <div><dt>{t('权限')}</dt><dd>{t('由智能体管理')}</dd></div>}
      </dl>
    </details>
  </section>
}

export function MemberRuntimeApplyDialog({ source, agents, installations, editorStates, environment, onBusyChange, onReload, onProfileCommitted, onClose }: {
  source: RuntimeApplySource
  agents: AgentProfile[]
  installations: AdapterInstallation[]
  editorStates: Record<string, RuntimeApplyEditorState>
  environment: RuntimeApplyEnvironment
  onBusyChange(busy: boolean): void
  onReload(): Promise<void>
  onProfileCommitted?(profile: AgentProfile): void
  onClose(): void
}): React.JSX.Element {
  const t = useUiText()
  const client = useThreadClient()
  // Names, configuration and versions describe the selection the user reviewed.
  // New versions are admitted only by an explicit read/review operation below.
  const [targets, setTargets] = useState(() => structuredClone(liveMembers(agents, source.agentId)))
  const eligibility = (member: AgentProfile) => runtimeApplyEligibility(member, source.runtimeConfiguration, editorStates[member.agentId], environment)
  const [selected, setSelected] = useState(() => new Set(targets.filter(member => !member.runtimeConfiguration && eligibility(member) === 'available').map(member => member.agentId)))
  const [stage, setStage] = useState<'choose' | 'applying' | 'result'>('choose')
  const [results, setResults] = useState<RuntimeApplyResult[]>([])
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(false)
  const running = useRef(false)
  const mounted = useRef(true)
  const latest = useRef({ agents, editorStates, environment, onReload, onProfileCommitted })
  latest.current = { agents, editorStates, environment, onReload, onProfileCommitted }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; onBusyChange(false) }
  }, [onBusyChange])
  const eligible = targets.filter(member => eligibility(member) === 'available')
  const chosen = eligible.filter(member => selected.has(member.agentId))
  const replacing = chosen.filter(member => member.runtimeConfiguration).length
  const visible = targets.filter(member => (member.displayName + ' ' + member.teamRole).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const busy = stage === 'applying' || refreshing
  const failures = results.filter(result => !finished(result))
  const completeCount = results.filter(finished).length
  const hasConflict = failures.some(result => result.status === 'conflict')
  const hasUnknown = failures.some(result => result.status === 'unknown')
  const resultDescription = failures.length
    ? t('已完成 {0} 位，{1} 位未完成。', String(completeCount), String(failures.length))
    : results.some(result => result.status === 'matched')
      ? t('已完成 {0} 位队员。', String(completeCount))
      : completeCount === 1 ? t('已应用到 1 位队员。') : t('已应用到 {0} 位队员。', String(completeCount))
  const close = (): void => { if (!running.current) onClose() }
  const begin = (): boolean => {
    if (running.current) return false
    running.current = true
    onBusyChange(true)
    setRefreshError(false)
    return true
  }
  const end = (): void => {
    running.current = false
    if (mounted.current) { onBusyChange(false); setRefreshing(false) }
  }
  const reload = async (): Promise<void> => {
    try { await latest.current.onReload() }
    catch { if (mounted.current) setRefreshError(true) }
  }
  const apply = async (retry = false): Promise<void> => {
    const batch: RuntimeApplyResult[] = retry
      ? results.filter(result => result.status === 'failed')
      : chosen.map(member => ({ member, status: 'waiting' }))
    if (!batch.length || !begin()) return
    setStage('applying')
    let next: RuntimeApplyResult[] = retry
      ? results.map(result => result.status === 'failed' ? { ...result, status: 'waiting' } : result)
      : batch
    const update = (result: RuntimeApplyResult): void => {
      next = next.map(item => item.member.agentId === result.member.agentId ? result : item)
      if (mounted.current) setResults([...next])
    }
    setResults(next)
    try {
      for (const item of batch) {
        if (!mounted.current) break
        const current = latest.current.agents.find(member => member.agentId === item.member.agentId)
        const state = current && runtimeApplyEligibility(current, source.runtimeConfiguration, latest.current.editorStates[current.agentId], latest.current.environment)
        if (state === 'same') { update({ ...item, status: 'matched', version: current?.version }); continue }
        if (!current || state !== 'available' || current.version !== item.member.version) {
          update({ ...item, status: 'conflict' }); continue
        }
        update({ ...item, status: 'applying' })
        update(await applyRuntimeToMember(item.member, source.runtimeConfiguration, client.request))
      }
      if (mounted.current) await reload()
    } finally {
      if (mounted.current) setStage('result')
      end()
    }
  }
  const refresh = async (reviewSelection: boolean): Promise<void> => {
    if (!begin()) return
    setRefreshing(true)
    try {
      const fresh = await client.request<AgentProfile[]>('members.list', {})
      if (!mounted.current) return
      fresh.forEach(profile => latest.current.onProfileCommitted?.(profile))
      const remaining = results.map(result => reconcileUnknownRuntimeApply(result, fresh.find(member => member.agentId === result.member.agentId), source.runtimeConfiguration))
      if (reviewSelection) {
        const candidates = liveMembers(fresh, source.agentId)
        const incompleteIds = new Set(remaining.filter(result => !finished(result)).map(result => result.member.agentId))
        setTargets(structuredClone(candidates))
        setSelected(new Set(candidates.filter(member => incompleteIds.has(member.agentId) && eligibility(member) === 'available').map(member => member.agentId)))
        setQuery('')
        setStage('choose')
        setResults([])
      } else setResults(remaining)
      await reload()
    } catch { if (mounted.current) setRefreshError(true) }
    finally { end() }
  }
  const retryReload = async (): Promise<void> => {
    if (!begin()) return
    setRefreshing(true)
    try { await reload() } finally { end() }
  }
  const statusLabel = (result: RuntimeApplyResult): string => {
    switch (result.status) {
      case 'waiting': return t('等待应用')
      case 'applying': return t('正在应用…')
      case 'applied': return t('已应用')
      case 'matched': return t('配置已一致')
      case 'conflict': return t('配置已变更，请重新选择')
      case 'unknown': return t('保存结果未知，请先核对')
      case 'failed': return result.code ? new MemberRuntimeCommandError(result.code, result.payload).message : t('暂未应用，可重试')
    }
  }
  return <Dialog.Root open onOpenChange={close}><Dialog.Portal>
    <Dialog.Overlay className="dialog-overlay app-dialog-overlay"/>
    <AppDialogContent className="runtime-apply-dialog" tone="neutral"
      onInteractOutside={event => event.preventDefault()}
      onEscapeKeyDown={event => { if (running.current) event.preventDefault() }}>
      <AppDialogHeader title={stage === 'choose' ? t('应用运行配置') : stage === 'applying' ? t('正在应用配置') : t('应用结果')}
        description={stage === 'choose' ? t('选择要使用这份配置的队员。') : stage === 'applying' ? t('正在保存所选队员的配置。') : resultDescription}
        closeLabel={t('关闭')} closeDisabled={busy}/>
      <AppDialogBody>
        {refreshError && <div className="inline-error" role="alert">{t('暂时无法重新读取队员，已有结果已保留。')}
          <button type="button" className="quiet-button" disabled={busy} onClick={() => void (hasUnknown ? refresh(false) : retryReload())}>{t('重新读取')}</button>
        </div>}
        {stage === 'choose' ? <>
          <SnapshotDetails source={source} installations={installations}/>
          <div className="apply-target-heading"><strong>{t('应用到')}</strong>
            {eligible.length > 0 && <button type="button" className="quiet-button compact" data-select-all
              onClick={() => setSelected(new Set(chosen.length === eligible.length ? [] : eligible.map(member => member.agentId)))}>
              {chosen.length === eligible.length ? t('取消全选') : t('全选')}
            </button>}
          </div>
          {targets.length > 8 && <input className="apply-search" aria-label={t('搜索队员')} placeholder={t('搜索队员')} value={query} onChange={event => setQuery(event.target.value)}/>}
          <div className="apply-target-list">{visible.map(member => {
            const state = eligibility(member)
            const checked = state === 'available' && selected.has(member.agentId)
            const detail = state === 'same' ? t('配置已一致') : state === 'draft' ? t('有未保存更改') : state === 'busy' ? t('正在保存…') : state === 'locked' ? t('当前平台仅可查看这份配置') : state === 'removed' ? t('已移除') : runtimeSummary(member.runtimeConfiguration)
            return <label key={member.agentId} className="apply-target" data-selected={checked || undefined} data-disabled={state !== 'available' || undefined}>
              <MemberAvatar {...member} size="list" decorative/>
              <span className="apply-target-copy"><strong>{member.displayName}</strong><small>{detail}</small>
                {checked && member.runtimeConfiguration && <span className="apply-target-change">→ {runtimeSummary(source.runtimeConfiguration)}</span>}
              </span>
              <input type="checkbox" aria-label={t('应用到 {0}', member.displayName)} checked={checked} disabled={state !== 'available'} onChange={() => setSelected(current => {
                const next = new Set(current)
                next.has(member.agentId) ? next.delete(member.agentId) : next.add(member.agentId)
                return next
              })}/>
            </label>
          })}
            {targets.length === 0 && <div className="apply-empty">{t('暂无其他队员')}<p>{t('添加队员后，可在这里应用配置。')}</p></div>}
            {targets.length > 0 && visible.length === 0 && <div className="apply-empty">{t('没有匹配的队员')}</div>}
          </div>
          {replacing > 0 && <p className="apply-replace-note" role="status">{replacing === 1 ? t('将替换 1 位队员的已有运行配置。') : t('将替换 {0} 位队员的已有运行配置。', String(replacing))}</p>}
        </> : <div className="apply-results" role="status" aria-live="polite">
          {results.map(result => <div className="apply-result" key={result.member.agentId} data-status={result.status}>
            <MemberAvatar {...result.member} size="list" decorative/>
            <div><strong>{result.member.displayName}</strong><small>{statusLabel(result)}</small></div>
            <span className="apply-result-mark">{finished(result) ? <DialogControlIcon name="check"/> : result.status === 'applying' ? <span className="apply-spinner"/> : result.status === 'waiting' ? <span aria-hidden="true">—</span> : <span aria-hidden="true">!</span>}</span>
          </div>)}
          {stage === 'result' && failures.length === 0 && <p className="apply-result-note">{t('后续修改可按队员分别保存。')}</p>}
        </div>}
      </AppDialogBody>
      <AppDialogFooter leading={stage === 'choose' ? <span aria-live="polite">{t('已选 {0} 位', String(chosen.length))}</span> : stage === 'applying' ? <span>{t('{0} / {1} 已完成', String(completeCount), String(results.length))}</span> : undefined}>
        {stage === 'choose' ? <>
          <button type="button" className="quiet-button" disabled={busy} onClick={close}>{t('取消')}</button>
          <button type="button" className="primary-button apply-primary" data-apply-submit disabled={chosen.length === 0 || busy} onClick={() => void apply()}>
            {chosen.length === 1 ? t('应用到 1 位队员') : t('应用到 {0} 位队员', String(chosen.length))}
          </button>
        </> : stage === 'applying' ? <button type="button" className="primary-button apply-primary" disabled>{t('正在应用…')}</button> : <>
          {failures.length > 0 && <button type="button" className="quiet-button" disabled={busy} onClick={close}>{t('关闭')}</button>}
          <button type="button" className="primary-button apply-primary" data-apply-complete disabled={busy}
            onClick={() => hasUnknown ? void refresh(false) : hasConflict ? void refresh(true) : failures.length ? void apply(true) : close()}>
            {refreshing ? t('正在读取…') : hasUnknown ? t('核对结果') : hasConflict ? t('重新选择') : failures.length ? t('重试失败项') : t('完成')}
          </button>
        </>}
      </AppDialogFooter>
    </AppDialogContent>
  </Dialog.Portal></Dialog.Root>
}
