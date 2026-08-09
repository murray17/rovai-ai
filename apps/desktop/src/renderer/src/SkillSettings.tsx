import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type {
  AdapterKind,
  SkillDeliveryGroupKey,
  SkillDeliveryGroupView,
  SkillImportCandidate,
  SkillImportInspection,
  SkillRiskSummary,
  SkillView,
  StoredCommandResult
} from '@contracts'
import { MemberAvatar } from './MemberAvatar'
import { SettingsPageHeader } from './SettingsPageHeader'
import { localizeExecutionEngineTerms } from './product-copy'

type ImportTab = 'local' | 'github'
type Confirmation =
  | { kind: 'delete'; skill: SkillView }
  | { kind: 'update'; candidate: SkillImportCandidate }
  | null

export function SkillSettings(): React.JSX.Element {
  const [skills, setSkills] = useState<SkillView[] | null>(null)
  const [groups, setGroups] = useState<SkillDeliveryGroupView[]>([])
  const [inspection, setInspection] = useState<SkillImportInspection | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [importTab, setImportTab] = useState<ImportTab>('local')
  const [githubInput, setGithubInput] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    const [nextSkills, nextGroups] = await Promise.all([
      window.rovai.request<SkillView[]>('skills.list'),
      window.rovai.request<SkillDeliveryGroupView[]>('skills.deliveryGroups.list')
    ])
    setSkills(nextSkills)
    setGroups(nextGroups)
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.rovai.request<SkillView[]>('skills.list'),
      window.rovai.request<SkillDeliveryGroupView[]>('skills.deliveryGroups.list')
    ]).then(([nextSkills, nextGroups]) => {
      if (cancelled) return
      setSkills(nextSkills)
      setGroups(nextGroups)
    }).catch((nextError) => {
      if (!cancelled) setError(errorMessage(nextError))
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => window.rovai.onEvent((event) => {
    if (event.method !== 'runtime.state') return
    const params = event.params !== null && typeof event.params === 'object'
      ? event.params as Record<string, unknown>
      : {}
    if (params.status === 'ready') void load().catch((nextError) => setError(errorMessage(nextError)))
  }), [load])

  const visibleSkills = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN')
    if (!skills || query.length === 0) return skills
    return skills.filter((skill) => `${skill.name}\n${skill.currentRevision.description}`
      .toLocaleLowerCase('zh-CN')
      .includes(query))
  }, [search, skills])

  const inspectLocalImport = async (): Promise<void> => {
    setBusy('inspect-local')
    setError(null)
    try {
      const path = await window.rovai.selectSkillImportDirectory()
      if (!path) return
      setInspection(await window.rovai.request<SkillImportInspection>('skills.import.inspect', { path }))
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const inspectGithubImport = async (): Promise<void> => {
    setBusy('inspect-github')
    setError(null)
    try {
      const params = parseGithubImportInput(githubInput)
      setInspection(await window.rovai.request<SkillImportInspection>(
        'skills.import.github.inspect',
        params
      ))
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const commitCandidate = async (
    candidate: SkillImportCandidate,
    confirmUpdate: boolean
  ): Promise<void> => {
    if (!inspection) return
    setBusy(`import-${candidate.name}`)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('skills.import.commit', {
        commandId: crypto.randomUUID(),
        command: {
          stagingToken: inspection.stagingToken,
          candidateName: candidate.name,
          expectedDigest: candidate.contentDigest,
          expectedSkillVersion: candidate.existingSkillVersion,
          confirmUpdate
        }
      })
      assertCommandApplied(result)
      setInspection((current) => current
        ? { ...current, candidates: current.candidates.filter((value) => value.name !== candidate.name) }
        : null)
      setConfirmation(null)
      await load()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const setEnabled = async (skill: SkillView): Promise<void> => {
    setBusy(`toggle-${skill.id}`)
    setError(null)
    try {
      const current = skills?.find((value) => value.id === skill.id) ?? skill
      const result = await window.rovai.request<StoredCommandResult>('skills.setEnabled', {
        commandId: crypto.randomUUID(),
        command: {
          skillId: current.id,
          expectedVersion: current.version,
          enabled: !current.enabled
        }
      })
      assertCommandApplied(result)
      await load()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const toggleGroup = async (skill: SkillView, groupKey: SkillDeliveryGroupKey): Promise<void> => {
    setBusy(`groups-${skill.id}`)
    setError(null)
    try {
      const current = skills?.find((value) => value.id === skill.id) ?? skill
      const selected = new Set(current.groupAssignments.map((assignment) => assignment.groupKey))
      if (selected.has(groupKey)) selected.delete(groupKey)
      else selected.add(groupKey)
      const result = await window.rovai.request<StoredCommandResult>('skills.setGroupAssignments', {
        commandId: crypto.randomUUID(),
        command: {
          skillId: current.id,
          expectedVersion: current.version,
          groupKeys: groups.map((group) => group.key).filter((key) => selected.has(key))
        }
      })
      assertCommandApplied(result)
      await load()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const deleteSkill = async (skill: SkillView): Promise<void> => {
    setBusy(`delete-${skill.id}`)
    setError(null)
    try {
      const current = skills?.find((value) => value.id === skill.id) ?? skill
      const result = await window.rovai.request<StoredCommandResult>('skills.delete', {
        commandId: crypto.randomUUID(),
        command: { skillId: current.id, expectedVersion: current.version }
      })
      assertCommandApplied(result)
      setConfirmation(null)
      await load()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="skill-settings">
      <SettingsPageHeader
        eyebrow="Settings / Skills"
        title="Skill 管理"
        description="管理 Rovai 内置与用户导入的 Skill，并为每个 Skill 独立选择 Runtime 生效组。"
        aside={<span className="settings-page-note">应用全局配置</span>}
      />

      {error && (
        <div className="skill-page-error" role="alert">
          <strong>操作未完成</strong>
          <span>{error}</span>
          <button className="quiet-button compact" type="button" onClick={() => setError(null)}>关闭</button>
        </div>
      )}

      <section className="skill-section">
        <div className="skill-section-heading">
          <div><p className="skill-eyebrow">Add Skill</p><h2>添加 Skill</h2></div>
        </div>
        <div className="skill-import-panel">
          <div className="skill-import-tabs" role="tablist" aria-label="Skill 添加方式">
            <button className={importTab === 'local' ? 'active' : ''} type="button" role="tab" aria-selected={importTab === 'local'} onClick={() => setImportTab('local')}>本地文件夹</button>
            <button className={importTab === 'github' ? 'active' : ''} type="button" role="tab" aria-selected={importTab === 'github'} onClick={() => setImportTab('github')}>GitHub</button>
          </div>
          {importTab === 'local'
            ? (
              <div className="skill-import-body" role="tabpanel">
                <span className="skill-import-description">选择包含 <code>SKILL.md</code> 的完整目录，导入后复制到 Rovai 本机受管仓库。</span>
                <div className="skill-import-placeholder">导入后不再依赖原始文件夹</div>
                <button className="primary-button" type="button" disabled={busy !== null} onClick={() => void inspectLocalImport()}>
                  {busy === 'inspect-local' ? '正在检查…' : '选择文件夹'}
                </button>
                <ImportHelp>导入时，Rovai 会保存一份完整副本。以后移动或删除原文件夹，也不影响这个 Skill。</ImportHelp>
              </div>
              )
            : (
              <div className="skill-import-body" role="tabpanel">
                <span className="skill-import-description">粘贴 GitHub 仓库或 Skill 子目录链接，可包含 branch、tag 或 commit 信息。</span>
                <input className="skill-text-input" value={githubInput} onChange={(event) => setGithubInput(event.target.value)} placeholder="https://github.com/org/repo/tree/main/path/to/skill" aria-label="GitHub Skill 链接" />
                <button className="primary-button" type="button" disabled={busy !== null || githubInput.trim().length === 0} onClick={() => void inspectGithubImport()}>
                  {busy === 'inspect-github' ? '正在检查…' : '检查并导入'}
                </button>
                <ImportHelp>Rovai 会保存完整副本，不依赖远端仓库或临时 checkout 持续可用。</ImportHelp>
              </div>
              )}
        </div>
      </section>

      <section className="skill-section">
        <div className="skill-section-heading">
          <div><p className="skill-eyebrow">Library</p><h2>已安装 Skills</h2></div>
          <span className="skill-section-count">{skills?.length ?? '—'} 个</span>
        </div>
        <label className="skill-search-row">
          <SearchIcon />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 Skill 名称或简介" aria-label="搜索 Skill" />
        </label>
        {skills === null && <div className="skill-empty" aria-live="polite">正在读取 Skill Library…</div>}
        {skills?.length === 0 && <div className="skill-empty">还没有可用的 Skill。可以导入包含 <code>SKILL.md</code> 的目录。</div>}
        {skills && skills.length > 0 && visibleSkills?.length === 0 && <div className="skill-empty">没有匹配“{search.trim()}”的 Skill。</div>}
        {visibleSkills && visibleSkills.length > 0 && (
          <div className="skill-card-grid">
            {visibleSkills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                groups={groups}
                busy={busy}
                onToggleEnabled={() => void setEnabled(skill)}
                onToggleGroup={(groupKey) => void toggleGroup(skill, groupKey)}
                onDelete={() => setConfirmation({ kind: 'delete', skill })}
              />
            ))}
          </div>
        )}
      </section>

      <ImportInspectionDialog
        inspection={inspection}
        busy={busy}
        onClose={() => !busy && setInspection(null)}
        onCommit={(candidate) => {
          if (candidate.importAction === 'update') setConfirmation({ kind: 'update', candidate })
          else void commitCandidate(candidate, false)
        }}
      />
      <ConfirmationDialog
        confirmation={confirmation}
        busy={busy}
        onClose={() => !busy && setConfirmation(null)}
        onConfirm={() => {
          if (confirmation?.kind === 'delete') void deleteSkill(confirmation.skill)
          if (confirmation?.kind === 'update') void commitCandidate(confirmation.candidate, true)
        }}
      />
    </div>
  )
}

function SkillCard({
  skill,
  groups,
  busy,
  onToggleEnabled,
  onToggleGroup,
  onDelete
}: {
  skill: SkillView
  groups: SkillDeliveryGroupView[]
  busy: string | null
  onToggleEnabled(): void
  onToggleGroup(groupKey: SkillDeliveryGroupKey): void
  onDelete(): void
}): React.JSX.Element {
  const selected = new Set(skill.groupAssignments.map((assignment) => assignment.groupKey))
  const selectedGroups = groups.filter((group) => selected.has(group.key))
  const deleting = skill.lifecycleStatus === 'deleting'
  return (
    <article className={`skill-card ${!skill.enabled ? 'is-disabled' : ''} ${deleting ? 'is-deleting' : ''}`}>
      <header className="skill-card-header">
        <div className="skill-card-heading">
          <div className="skill-card-title">
            <strong title={skill.name}>{skill.name}</strong>
            <span className={`skill-source ${skill.origin === 'official' ? 'source-official' : ''}`}>
              {skill.origin === 'official' ? 'Rovai 内置' : '用户导入'}
            </span>
          </div>
          <p>{skill.currentRevision.description || '未提供说明。'}</p>
        </div>
        <div className="skill-card-controls">
          <button
            className="skill-toggle"
            type="button"
            role="switch"
            aria-checked={skill.enabled}
            aria-label={`${skill.enabled ? '停用' : '启用'} ${skill.name}`}
            disabled={busy !== null || deleting}
            onClick={onToggleEnabled}
          >
            <span aria-hidden="true" /><b>{busy === `toggle-${skill.id}` ? '保存中' : skill.enabled ? '启用' : '停用'}</b>
          </button>
          <SkillMoreMenu skill={skill} disabled={busy !== null || deleting} onDelete={onDelete} />
        </div>
      </header>
      {deleting && <span className="skill-deleting-note">等待现有执行释放后删除</span>}
      <div className="skill-groups">
        <div className="skill-groups-summary">
          <span>当前生效组</span>
          <strong>{selectedGroups.length === 0 ? '未选择' : `已选择 ${selectedGroups.length} 个`}</strong>
        </div>
        <div className="skill-group-chips">
          {selectedGroups.map((group) => <span className="skill-group-chip" key={group.key}>{group.label}</span>)}
          {selectedGroups.length === 0 && <span className="skill-group-empty">尚未选择任何 Runtime 生效组</span>}
        </div>
        <SkillGroupMenu
          skill={skill}
          groups={groups}
          selected={selected}
          disabled={busy !== null || deleting}
          onToggle={onToggleGroup}
        />
      </div>
    </article>
  )
}

function SkillMoreMenu({ skill, disabled, onDelete }: {
  skill: SkillView
  disabled: boolean
  onDelete(): void
}): React.JSX.Element {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="skill-more-button" type="button" aria-label={`${skill.name} 更多操作`} disabled={disabled}>•••</button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="skill-more-menu" align="end" sideOffset={5} collisionPadding={10}>
          <div className="skill-version-block">
            <VersionRow label="Revision" value={`r${skill.currentRevision.revision}`} mono />
            <VersionRow label={skill.currentRevision.sourceType === 'bundled' ? '安装时间' : '更新时间'} value={formatTimestamp(skill.currentRevision.installedAt)} />
            <VersionRow label="内容" value={`${skill.currentRevision.fileCount} 个文件 · ${formatBytes(skill.currentRevision.totalBytes)}`} />
            <VersionRow label="来源" value={sourceTypeLabel(skill.currentRevision.sourceType)} />
          </div>
          {skill.origin === 'imported' && (
            <div className="skill-menu-actions">
              <DropdownMenu.Item className="skill-menu-action danger" onSelect={onDelete}>删除 Skill</DropdownMenu.Item>
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function VersionRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): React.JSX.Element {
  return <div className="skill-version-row"><span>{label}</span><strong className={mono ? 'mono' : ''}>{value}</strong></div>
}

function SkillGroupMenu({ skill, groups, selected, disabled, onToggle }: {
  skill: SkillView
  groups: SkillDeliveryGroupView[]
  selected: Set<SkillDeliveryGroupKey>
  disabled: boolean
  onToggle(groupKey: SkillDeliveryGroupKey): void
}): React.JSX.Element {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="skill-group-select" type="button" disabled={disabled}>
          <span>{selected.size === 0 ? '选择生效组' : '调整生效组'}</span><ChevronIcon />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="skill-group-menu" align="start" sideOffset={5} collisionPadding={12}>
          <div className="skill-group-menu-header">
            <div><strong>选择 Runtime 生效组</strong><small>可多选。队员根据当前 Runtime 实时计算，仅用于展示。</small></div>
            <span>{selected.size} / {groups.length}</span>
          </div>
          <div className="skill-group-options">
            {groups.map((group) => (
              <DropdownMenu.CheckboxItem
                className="skill-group-option"
                key={group.key}
                checked={selected.has(group.key)}
                onCheckedChange={() => onToggle(group.key)}
                onSelect={(event) => event.preventDefault()}
                disabled={disabled}
                aria-label={`${selected.has(group.key) ? '取消' : '选择'} ${group.label}`}
              >
                <span className="skill-group-checkbox"><DropdownMenu.ItemIndicator><CheckIcon /></DropdownMenu.ItemIndicator></span>
                <span className="skill-group-main">
                  <span className="skill-group-name-line">
                    <strong>{group.label}</strong><code>{group.relativePath}</code>
                    <i className={group.verification === 'verified' ? 'verified' : 'unverified'}>{group.verification === 'verified' ? '已验证' : '暂未验证'}</i>
                  </span>
                  <span className="skill-runtime-line">对应 Runtime：{group.adapterKinds.map(adapterLabel).join('、') || '暂无'}</span>
                  <span className="skill-member-line">
                    {group.members.length > 0
                      ? <><span className="skill-member-stack">{group.members.slice(0, 4).map((member) => <MemberAvatar key={member.agentId} agentId={member.agentId} avatarRef={member.avatarRef} displayName={member.displayName} size="mention" decorative />)}</span><span>{group.members.map((member) => member.displayName).join('、')}</span></>
                      : <span className="skill-no-member">当前没有对应队员</span>}
                  </span>
                </span>
              </DropdownMenu.CheckboxItem>
            ))}
          </div>
          <div className="skill-group-menu-footer">没有队员的分组仍然显示。关闭 Skill 只暂停投递，不会清除这里的选择。</div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function ImportHelp({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="skill-import-help"><b aria-hidden="true">?</b><span role="tooltip">{children}</span></span>
}

function SkillRisk({ summary }: { summary: SkillRiskSummary }): React.JSX.Element {
  const hasRisk = summary.executableFileCount > 0 || summary.scriptFileCount > 0 || summary.binaryCandidateCount > 0 || summary.declaredTools.length > 0
  return (
    <div className={`skill-risk ${hasRisk ? 'has-risk' : ''}`}>
      <strong>{hasRisk ? '内容提示' : '未发现脚本或可执行内容'}</strong>
      {hasRisk && <span>{summary.scriptFileCount} 个脚本 · {summary.executableFileCount} 个可执行文件 · {summary.binaryCandidateCount} 个二进制候选{summary.declaredTools.length > 0 ? ` · 声明工具：${summary.declaredTools.join('、')}` : ''}</span>}
    </div>
  )
}

function ImportInspectionDialog({ inspection, busy, onClose, onCommit }: {
  inspection: SkillImportInspection | null
  busy: string | null
  onClose(): void
  onCommit(candidate: SkillImportCandidate): void
}): React.JSX.Element {
  return (
    <Dialog.Root open={inspection !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content skill-import-dialog">
          <div className="dialog-heading">
            <Dialog.Title>检查 Skill 导入</Dialog.Title>
            <Dialog.Close className="dialog-close" aria-label="关闭" disabled={busy !== null}>×</Dialog.Close>
          </div>
          <Dialog.Description>确认后写入 Rovai Skill Library。新 Skill 默认启用，但不会默认选择任何 Runtime 生效组。</Dialog.Description>
          {inspection && <>
            <code className="inspection-path">{inspection.sourcePath}</code>
            <div className="import-candidate-list">
              {inspection.candidates.map((candidate) => {
                const blocked = candidate.importAction === 'official_conflict'
                return (
                  <article className="import-candidate" key={candidate.name}>
                    <div>
                      <strong>{candidate.name}</strong><span>{importActionLabel(candidate.importAction)}</span>
                      <p>{candidate.description || '未提供说明。'}</p>
                      <small>{candidate.fileCount} 个文件 · {formatBytes(candidate.totalBytes)} · {shortDigest(candidate.contentDigest)}</small>
                      <SkillRisk summary={candidate.riskSummary} />
                    </div>
                    <button className={candidate.importAction === 'update' ? 'approve-button' : 'primary-button'} type="button" disabled={busy !== null || blocked} onClick={() => onCommit(candidate)}>
                      {busy === `import-${candidate.name}` ? '正在保存…' : blocked ? '与内置 Skill 冲突' : candidate.importAction === 'update' ? '检查并更新' : candidate.importAction === 'unchanged' ? '确认现有版本' : '导入'}
                    </button>
                  </article>
                )
              })}
            </div>
            {inspection.candidates.length === 0 && <div className="skill-empty">没有可导入的候选 Skill。</div>}
            {inspection.rejectedCandidates.length > 0 && <div className="rejected-candidates"><strong>未通过检查（{inspection.rejectedCandidates.length}）</strong>{inspection.rejectedCandidates.map((candidate) => <div key={`${candidate.sourcePath}:${candidate.code}`}><code>{candidate.sourcePath}</code><span>{candidate.code}：{candidate.message}</span></div>)}</div>}
            <p className="inspection-expiry">本次预览有效至 {formatTimestamp(inspection.expiresAt)}。</p>
          </>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ConfirmationDialog({ confirmation, busy, onClose, onConfirm }: {
  confirmation: Confirmation
  busy: string | null
  onClose(): void
  onConfirm(): void
}): React.JSX.Element {
  const deleting = confirmation?.kind === 'delete'
  return (
    <Dialog.Root open={confirmation !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content camp-action-dialog">
          <Dialog.Title>{deleting ? '删除导入的 Skill？' : '更新现有 Skill？'}</Dialog.Title>
          <Dialog.Description>{deleting ? `“${confirmation?.kind === 'delete' ? confirmation.skill.name : ''}”会停止新投递，并在现有执行释放后删除受管内容；不会删除 Runtime 原生的同名 Skill。` : `“${confirmation?.kind === 'update' ? confirmation.candidate.name : ''}”将创建新的不可变 Revision；已有生效组会保留，正在进行的执行不会切换版本。`}</Dialog.Description>
          <div className="dialog-actions">
            <Dialog.Close className="quiet-button" disabled={busy !== null}>取消</Dialog.Close>
            <button className={deleting ? 'danger-button' : 'primary-button'} type="button" onClick={onConfirm} disabled={busy !== null}>{busy?.startsWith(deleting ? 'delete-' : 'import-') ? deleting ? '正在删除…' : '正在更新…' : deleting ? '确认删除' : '确认更新'}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SearchIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>
}

function ChevronIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
}

function CheckIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
}

export function importActionLabel(action: SkillImportCandidate['importAction']): string {
  return ({ create: '新 Skill', update: '同名 Skill 已存在，将创建新 Revision', unchanged: '内容与当前 Revision 相同', official_conflict: '不能覆盖 Rovai 内置 Skill' } as const)[action]
}

export function projectionStateLabel(state: string): string {
  return ({ shadowed: '被项目同名 Skill 遮蔽', stale: '等待下次运行生效', pending_removal: '等待现有运行释放', error: '投递失败' } as Record<string, string>)[state] ?? state
}

export function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KB`
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`
}

function sourceTypeLabel(sourceType: SkillView['currentRevision']['sourceType']): string {
  return ({ bundled: '随 Rovai 安装', local_folder: '本地文件夹导入', github: 'GitHub 导入' } as const)[sourceType]
}

function adapterLabel(adapter: AdapterKind): string {
  return ({ 'codex-cli': 'Codex', 'opencode-cli': 'OpenCode', 'copilot-cli': 'Copilot', 'claude-code-cli': 'Claude Code', 'antigravity-app': 'Antigravity', 'kiro-cli': 'Kiro', 'qoder-cli': 'Qoder', 'codebuddy-cli': 'CodeBuddy', 'qwen-code': 'Qwen' } as Partial<Record<AdapterKind, string>>)[adapter] ?? adapter
}

function parseGithubImportInput(input: string): { repositoryUrl: string; subdirectory?: string; gitRef?: string } {
  let url: URL
  try { url = new URL(input.trim()) } catch { throw new Error('请输入有效的 GitHub HTTPS 链接。') }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') throw new Error('仅支持 https://github.com/ 链接。')
  const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  if (segments.length < 2) throw new Error('GitHub 链接需要包含 owner 和 repository。')
  const [owner, rawRepository, marker, gitRef, ...subdirectory] = segments
  const repository = rawRepository.endsWith('.git') ? rawRepository.slice(0, -4) : rawRepository
  if (marker && marker !== 'tree') throw new Error('请使用仓库链接，或 /tree/<ref>/<子目录> 形式的链接。')
  if (marker === 'tree' && !gitRef) throw new Error('GitHub 子目录链接缺少 branch、tag 或 commit ref。')
  return {
    repositoryUrl: `https://github.com/${owner}/${repository}`,
    ...(gitRef ? { gitRef: decodeURIComponent(gitRef) } : {}),
    ...(subdirectory.length > 0 ? { subdirectory: subdirectory.map(decodeURIComponent).join('/') } : {})
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function shortDigest(value: string): string {
  return value.length > 20 ? `${value.slice(0, 19)}…` : value
}

function assertCommandApplied(result: StoredCommandResult): void {
  if (result.status === 'rejected') {
    const message = typeof result.payload.message === 'string' ? result.payload.message : `Core 拒绝了命令：${result.code}`
    throw new Error(message)
  }
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error))
}
