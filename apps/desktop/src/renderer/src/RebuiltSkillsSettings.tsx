import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import * as Dialog from '@radix-ui/react-dialog'
import type { AdapterKind, AgentProfile, NativeSkillScan, NativeSkillView, SkillContentView, StoredCommandResult, ToolboxSkillView } from '@contracts'
import { useCampClient } from './camp-client'
import { useCapabilitySplitter } from './useCapabilitySplitter'
import { MemberAvatar } from './MemberAvatar'
import { RuntimeGlyph } from './MemberRuntimePicker'
import { SkillIdentityMark } from './SkillIdentityMark'
import { SafeMarkdown } from './SafeMarkdown'
import { skillReadingContent } from './SkillContentPreview'
import { SkillFileNavigation } from './SkillFileNavigation'
import { adapterLabel, VISIBLE_PRODUCT_RUNTIMES } from './runtime-products'
import { readErrorMessage } from './error-message'
import './rebuilt-skills-settings.css'

export function NativeSkillsSettings(): React.JSX.Element {
  const id = useId()
  const { root, compact, separator } = useCapabilitySplitter('rovai.native-skills-list-width.v1', `${id}-list ${id}-detail`)
  const client = useCampClient()
  const [runtime, setRuntime] = useState<AdapterKind>('codex-cli')
  const [scan, setScan] = useState<NativeSkillScan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [content, setContent] = useState<SkillContentView | null>(null)
  const [files, setFiles] = useState<SkillContentView['files']>([])
  const [filePath, setFilePath] = useState('SKILL.md')
  const [raw, setRaw] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)
  const [contentRevision, setContentRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [detailVisible, setDetailVisible] = useState(false)
  const listRequest = useRef(0)
  const load = useCallback(async (refresh: boolean): Promise<void> => {
    const request = ++listRequest.current
    setLoading(true)
    setError(null)
    try {
      const next = await client.request<NativeSkillScan>('nativeSkills.list', { adapterKind: runtime, refresh })
      if (request !== listRequest.current) return
      setScan(next)
      setSelectedId((current) => next.skills.some((skill) => skill.id === current) ? current : next.skills[0]?.id ?? null)
      setFilePath('SKILL.md')
      setFiles([])
      setContentRevision((revision) => revision + 1)
    } catch (reason) {
      if (request === listRequest.current) setError(readErrorMessage(reason))
    } finally {
      if (request === listRequest.current) setLoading(false)
    }
  }, [client, runtime])
  useEffect(() => {
    setScan(null)
    setSelectedId(null)
    void load(false)
    return () => { listRequest.current += 1 }
  }, [load])
  const selected = scan?.skills.find((skill) => skill.id === selectedId) ?? null
  useEffect(() => {
    if (!selected) { setContent(null); setContentError(null); return }
    let cancelled = false
    setContent(null)
    setContentError(null)
    void client.request<SkillContentView>('nativeSkills.read', { skillId: selected.id, path: filePath })
      .then((value) => { if (!cancelled) { setContent(value); setFiles(value.files) } })
      .catch((reason) => { if (!cancelled) setContentError(readErrorMessage(reason)) })
    return () => { cancelled = true }
  }, [client, runtime, selected?.id, filePath, contentRevision])
  const visible = useMemo(() => (scan?.skills ?? []).filter((skill) =>
    `${skill.name} ${skill.description} ${skill.entryPath}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  ), [scan, query])
  const copyPath = async (skill: NativeSkillView): Promise<void> => {
    try { await navigator.clipboard.writeText(skill.entryPath) }
    catch (reason) { setContentError(readErrorMessage(reason)) }
  }
  return <div className="rebuilt-skills-page">
    <header className="rebuilt-skills-header">
      <div><h1>Skills</h1><p>查看各运行时的 Skills。</p></div>
    </header>
    <div className="rebuilt-runtime-bar"><span>运行时</span>
      <Menu.Root>
        <Menu.Trigger asChild><button className="member-runtime-picker rebuilt-runtime-trigger" type="button" aria-label={`选择运行时，当前为 ${adapterLabel(runtime)}`}><RuntimeGlyph kind={runtime} /><span>{adapterLabel(runtime)}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></button></Menu.Trigger>
        <Menu.Portal><Menu.Content className="runtime-model-picker-menu member-runtime-menu" align="end" sideOffset={5} loop>
          <Menu.RadioGroup className="runtime-picker-options" value={runtime} onValueChange={(value) => setRuntime(value as AdapterKind)}>
            <div className="runtime-picker-scroll">{VISIBLE_PRODUCT_RUNTIMES.map((kind) => <Menu.RadioItem key={kind} value={kind} textValue={adapterLabel(kind)} className="runtime-model-picker-item member-runtime-menu-item"><RuntimeGlyph kind={kind} /><span className="runtime-model-picker-copy"><strong>{adapterLabel(kind)}</strong></span><Menu.ItemIndicator className="runtime-model-picker-check">✓</Menu.ItemIndicator></Menu.RadioItem>)}</div>
          </Menu.RadioGroup>
        </Menu.Content></Menu.Portal>
      </Menu.Root>
      <button type="button" className="rebuilt-skill-action" onClick={() => void load(true)} disabled={loading}><SkillActionIcon name="refresh" />刷新</button>
    </div>
    <div ref={root} className="rebuilt-skills-columns" data-compact={compact}>
      <aside id={`${id}-list`} className={`rebuilt-skills-list ${detailVisible ? 'is-detail-visible' : ''}`}>
        <div className="rebuilt-skills-toolbar"><strong>Skills</strong><span>{scan?.skills.length ?? '—'} 项</span></div>
        <label className="rebuilt-skills-search"><span className="sr-only">搜索 Skills</span><input type="search" placeholder="搜索 Skill" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {error && <div className="rebuilt-skills-error" role="alert">执行端暂不可读：{error}<button type="button" onClick={() => void load(true)}>重试</button></div>}
        {scan?.errors.length ? <div className="rebuilt-skills-error" role="status">部分来源暂不可读。已发现的 Skill 仍可查看。<button type="button" onClick={() => void load(true)}>重试</button></div> : null}
        {loading && !scan && <p className="rebuilt-skills-empty">正在读取 Skills…</p>}
        {!loading && scan && scan.skills.length === 0 && <p className="rebuilt-skills-empty">这个运行时尚未发现 Skills。</p>}
        {scan && visible.length === 0 && scan.skills.length > 0 && <p className="rebuilt-skills-empty">没有匹配的 Skill。</p>}
        <div className="rebuilt-skills-list-scroll">{visible.map((skill) => <button type="button" key={skill.id} className={`rebuilt-skill-row ${selectedId === skill.id ? 'is-selected' : ''}`} onClick={() => { if (selectedId !== skill.id) { setSelectedId(skill.id); setFilePath('SKILL.md'); setFiles([]) } setRaw(false); setDetailVisible(true) }}><SkillIdentityMark skillId={skill.id} name={skill.name} /><span><strong>{skill.name}</strong><small>{skill.description}</small></span></button>)}</div>
      </aside>
      {separator}
      <section id={`${id}-detail`} className={`rebuilt-skills-detail ${detailVisible ? 'is-detail-visible' : ''}`} aria-label="Skill 预览">
        <button type="button" className="rebuilt-skills-back" onClick={() => setDetailVisible(false)}>返回列表</button>
        {selected ? <><header><h2>{selected.name}</h2><p>{selected.description}</p><div className="rebuilt-skill-source"><span title={selected.entryPath}>{selected.entryPath}</span><button type="button" onClick={() => void copyPath(selected)} aria-label="复制 Skill 路径">复制路径</button></div></header><div className="rebuilt-skills-content"><SkillFileNavigation files={files} path={filePath} onSelect={(path) => { setFilePath(path); setRaw(false) }}>
          {/\.(?:md|markdown)$/iu.test(filePath) && <div className="capability-view-modes" role="group" aria-label="Skill 预览方式"><button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>阅读</button><button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>源码</button></div>}
        </SkillFileNavigation>{contentError ? <div className="rebuilt-skills-error" role="alert">正文暂不可读：{contentError}<button type="button" onClick={() => setContentRevision((revision) => revision + 1)}>重试</button></div> : content === null ? <p className="rebuilt-skills-empty">正在读取正文…</p> : content.status === 'too_large' ? <p className="rebuilt-skills-empty">该文件较大，暂不支持正文预览。</p> : content.status === 'binary' ? <p className="rebuilt-skills-empty">该文件不是文本文件。</p> : raw || !/\.(?:md|markdown)$/iu.test(filePath) ? <pre className="capability-source-code">{content.content}</pre> : <SafeMarkdown className="capability-reading" mode="document">{skillReadingContent(content.content ?? '')}</SafeMarkdown>}</div></> : <p className="rebuilt-skills-empty">选择一项 Skill 查看正文。</p>}
      </section>
    </div>
  </div>
}

export function ToolboxSettings({ agents }: { agents: AgentProfile[] }): React.JSX.Element {
  const id = useId()
  const { root, compact, separator } = useCapabilitySplitter('rovai.toolbox-list-width.v1', `${id}-list ${id}-detail`)
  const client = useCampClient()
  const [skills, setSkills] = useState<ToolboxSkillView[] | null>(null)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [memberQuery, setMemberQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failedSave, setFailedSave] = useState<{ skillName: string; memberIds: string[]; expectedVersion: string; commandId: string } | null>(null)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const [descriptionContent, setDescriptionContent] = useState<string | null>(null)
  const [descriptionError, setDescriptionError] = useState<string | null>(null)
  const [detailVisible, setDetailVisible] = useState(false)
  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await client.request<ToolboxSkillView[]>('toolbox.list')
      setSkills(next)
      setSelectedName((name) => next.some((skill) => skill.name === name) ? name : next[0]?.name ?? null)
      setLoadingError(null)
    } catch (reason) { setLoadingError(readErrorMessage(reason)) }
  }, [client])
  useEffect(() => { void load() }, [load])
  const selected = skills?.find((skill) => skill.name === selectedName) ?? null
  useEffect(() => {
    if (!descriptionOpen || !selectedName) return
    let cancelled = false
    setDescriptionContent(null)
    setDescriptionError(null)
    void client.request<{ content: string }>('toolbox.read', { skillName: selectedName })
      .then((value) => { if (!cancelled) setDescriptionContent(value.content) })
      .catch((reason) => { if (!cancelled) setDescriptionError(readErrorMessage(reason)) })
    return () => { cancelled = true }
  }, [client, descriptionOpen, selectedName])
  const members = agents.filter((agent) => agent.presence !== 'removed')
  const visibleMembers = members.filter((agent) => `${agent.displayName} ${agent.teamRole}`.toLocaleLowerCase().includes(memberQuery.toLocaleLowerCase()))
  const visibleSkills = skills ?? []
  const save = async (memberIds: string[], skillName = selected?.name, retry?: typeof failedSave): Promise<void> => {
    if (!skillName || busy) return
    const name = skillName
    const before = skills
    const expectedVersion = retry?.expectedVersion ?? before?.find((skill) => skill.name === name)?.version
    if (!expectedVersion) return
    const commandId = retry?.commandId ?? crypto.randomUUID()
    setError(null)
    setFailedSave(null)
    setBusy(true)
    setSkills((current) => current?.map((skill) => skill.name === name ? { ...skill, memberIds } : skill) ?? null)
    try {
      const result = await client.request<StoredCommandResult>('toolbox.setMembers', {
        commandId,
        command: { skillName: name, memberIds, expectedVersion }
      })
      if (result.status !== 'applied') {
        setSkills(before)
        setError(result.code === 'toolbox.members.conflict'
          ? '配置已在其他位置更新，请按新状态重试。'
          : '队员配置已变化，请重新选择。')
        await load()
      } else {
        const version = result.payload.version
        if (typeof version === 'string') {
          setSkills((current) => current?.map((skill) => skill.name === name ? { ...skill, memberIds, version } : skill) ?? null)
        }
      }
    } catch (reason) {
      setSkills(before)
      setError(readErrorMessage(reason))
      setFailedSave({ skillName: name, memberIds, expectedVersion, commandId })
    }
    finally { setBusy(false) }
  }
  const selectedMembers = new Set(selected?.memberIds ?? [])
  const bulk = (enabled: boolean): void => {
    const next = new Set(selectedMembers)
    for (const member of visibleMembers) enabled ? next.add(member.agentId) : next.delete(member.agentId)
    void save([...next])
  }
  return <div className="rebuilt-skills-page">
    <header className="rebuilt-skills-header"><div><h1>工具箱</h1><p>为队员配置多人协作常用的 Skills 与工具。</p></div></header>
    <div ref={root} className="rebuilt-skills-columns" data-compact={compact}>
      <aside id={`${id}-list`} className={`rebuilt-skills-list ${detailVisible ? 'is-detail-visible' : ''}`}><div className="rebuilt-skills-toolbar"><strong>协作 Skills</strong><span className="rebuilt-toolbox-help"><button type="button" aria-label="协作 Skills 说明" aria-describedby={`${id}-toolbox-help`}>?</button><span id={`${id}-toolbox-help`} className="rebuilt-toolbox-help-popover" role="tooltip">为队员勾选后，其新一轮执行可按需读取该 Skill；会话中也可输入 / 单次选用。</span></span><span>{skills?.length ?? '—'} 项</span></div>
        {loadingError && <div className="rebuilt-skills-error" role="alert">工具箱暂不可读：{loadingError}<button type="button" onClick={() => void load()}>重试</button></div>}
        {!skills && !loadingError && <p className="rebuilt-skills-empty" role="status">正在读取工具箱…</p>}
        {skills && visibleSkills.length === 0 && <p className="rebuilt-skills-empty">暂无 Skill。</p>}
        <div className="rebuilt-skills-list-scroll">{visibleSkills.map((skill) => <button type="button" key={skill.name} className={`rebuilt-skill-row ${selectedName === skill.name ? 'is-selected' : ''}`} onClick={() => { setSelectedName(skill.name); setError(null); setFailedSave(null); setDetailVisible(true) }}><SkillIdentityMark skillId={skill.name} name={skill.name} /><span><strong>{skill.name}</strong><small>{skill.description ?? '说明暂不可读'}</small></span><em>{skill.memberIds.length ? `已选 ${skill.memberIds.length} 人` : '未分配'}</em></button>)}</div>
      </aside>
      {separator}
      <section id={`${id}-detail`} className={`rebuilt-skills-detail rebuilt-toolbox-detail ${detailVisible ? 'is-detail-visible' : ''}`} aria-label="工具箱队员配置"><button type="button" className="rebuilt-skills-back" onClick={() => setDetailVisible(false)}>返回列表</button>{selected ? <><header className="rebuilt-toolbox-heading"><div><h2>{selected.name}</h2><p>{selected.description ?? '说明暂不可读'}</p></div><button type="button" className="rebuilt-skill-action" onClick={() => setDescriptionOpen(true)}><SkillActionIcon name="file" />查看说明</button></header><div className="rebuilt-skills-toolbar"><strong>提供给队员</strong><span>已选 {selected.memberIds.length} 人</span><button type="button" disabled={busy || !visibleMembers.length} onClick={() => bulk(true)}>全选{memberQuery ? '当前结果' : ''}</button><button type="button" disabled={busy || !visibleMembers.length} onClick={() => bulk(false)}>取消全选{memberQuery ? '当前结果' : ''}</button></div><label className="rebuilt-skills-search"><span className="sr-only">搜索队员</span><input type="search" placeholder="搜索队员姓名或角色" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} /></label>{busy && <p role="status" className="rebuilt-skills-status">正在保存…</p>}{error && <div className="rebuilt-skills-error" role="alert">保存失败：{error}{failedSave && <button type="button" disabled={busy} onClick={() => void save(failedSave.memberIds, failedSave.skillName, failedSave)}>重试</button>}</div>}{!members.length && <p className="rebuilt-skills-empty">暂无队员。</p>}{members.length > 0 && visibleMembers.length === 0 && <p className="rebuilt-skills-empty">没有匹配的队员。</p>}<div className="rebuilt-toolbox-members">{visibleMembers.map((agent) => <label key={agent.agentId} className="rebuilt-toolbox-member"><MemberAvatar agentId={agent.agentId} displayName={agent.displayName} avatarRef={agent.avatarRef} /><span><strong>{agent.displayName}</strong><small>{agent.teamRole}</small></span><input type="checkbox" checked={selectedMembers.has(agent.agentId)} disabled={busy} onChange={(event) => { const next = new Set(selectedMembers); event.target.checked ? next.add(agent.agentId) : next.delete(agent.agentId); void save([...next]) }} /></label>)}</div><Dialog.Root open={descriptionOpen} onOpenChange={setDescriptionOpen}><Dialog.Portal><Dialog.Overlay className="dialog-overlay app-dialog-overlay" /><Dialog.Content className="dialog-content app-dialog app-dialog-wide rebuilt-description-dialog"><div className="rebuilt-description-header"><div><small>只读说明</small><Dialog.Title>{selected.name}</Dialog.Title></div><Dialog.Close asChild><button type="button" className="icon-button" aria-label="关闭说明">×</button></Dialog.Close></div><Dialog.Description className="sr-only">{selected.description ?? '只读 Skill 说明'}</Dialog.Description><div className="rebuilt-description-body">{descriptionError ? <p role="alert">说明暂不可读：{descriptionError}</p> : descriptionContent === null ? <p role="status">正在读取说明…</p> : <SafeMarkdown mode="document">{skillReadingContent(descriptionContent)}</SafeMarkdown>}</div></Dialog.Content></Dialog.Portal></Dialog.Root></> : <p className="rebuilt-skills-empty">{loadingError ? '工具箱暂不可读，请从列表区重试。' : skills ? '选择一项 Skill 配置队员。' : '正在读取工具箱…'}</p>}</section>
    </div>
  </div>
}

function SkillActionIcon({ name }: { name: 'refresh' | 'file' }): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{name === 'refresh'
    ? <path d="M20 11a8 8 0 1 0-2.5 6M20 4v7h-7" />
    : <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></>}
  </svg>
}
