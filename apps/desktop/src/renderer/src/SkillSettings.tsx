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
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogImpact,
  AppDialogImpactList
} from './AppDialog'
import { MemberAvatar } from './MemberAvatar'
import { SettingsPageHeader } from './SettingsPageHeader'
import { SkillIdentityMark } from './SkillIdentityMark'
import { localizeExecutionEngineTerms } from './product-copy'

type ImportTab = 'local' | 'github'
type SkillRowOperation = 'toggle' | 'groups'

export function deleteSkillConfirmationCopy(name: string): {
  title: string
  description: string
  confirmLabel: string
} {
  return {
    title: `删除导入的 Skill “${name}”？`,
    description: '将停止新投递，并在现有执行释放后删除 Rovai 管理的内容。',
    confirmLabel: '确认删除 Skill'
  }
}

export function updateSkillConfirmationCopy(name: string): {
  title: string
  description: string
  confirmLabel: string
} {
  return {
    title: `更新现有 Skill “${name}”？`,
    description: '将把已检查的内容保存为新的 Revision。现有生效组保持不变，已经开始的执行继续使用原版本。',
    confirmLabel: '更新 Skill'
  }
}

export function SkillSettings(): React.JSX.Element {
  const [skills, setSkills] = useState<SkillView[] | null>(null)
  const [groups, setGroups] = useState<SkillDeliveryGroupView[]>([])
  const [inspection, setInspection] = useState<SkillImportInspection | null>(null)
  const [deletingSkill, setDeletingSkill] = useState<SkillView | null>(null)
  const [updatingCandidate, setUpdatingCandidate] = useState<SkillImportCandidate | null>(null)
  const [importTab, setImportTab] = useState<ImportTab>('local')
  const [importOpen, setImportOpen] = useState(false)
  const [githubInput, setGithubInput] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [skillRowOperations, setSkillRowOperations] = useState<Record<string, SkillRowOperation>>({})
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

  const visibleSkills = useMemo(
    () => settingsVisibleSkills(skills, search),
    [search, skills]
  )
  const configurableSkillCount = useMemo(
    () => settingsVisibleSkills(skills, '')?.length ?? null,
    [skills]
  )

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
      setUpdatingCandidate(null)
      await load()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const setEnabled = async (skill: SkillView): Promise<void> => {
    const current = skills?.find((value) => value.id === skill.id) ?? skill
    setSkillRowOperations((operations) => ({ ...operations, [current.id]: 'toggle' }))
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('skills.setEnabled', {
        commandId: crypto.randomUUID(),
        command: {
          skillId: current.id,
          expectedVersion: current.version,
          enabled: !current.enabled
        }
      })
      assertCommandApplied(result)
      setSkills((currentSkills) => currentSkills
        ? patchSkillEnabledResult(currentSkills, current.id, result)
        : currentSkills)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setSkillRowOperations((operations) => withoutSkillRowOperation(operations, current.id))
    }
  }

  const toggleGroup = async (skill: SkillView, groupKey: SkillDeliveryGroupKey): Promise<void> => {
    const current = skills?.find((value) => value.id === skill.id) ?? skill
    setSkillRowOperations((operations) => ({ ...operations, [current.id]: 'groups' }))
    setError(null)
    try {
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
      const updated = await window.rovai.request<SkillView>('skills.get', { skillId: current.id })
      setSkills((currentSkills) => currentSkills
        ? replaceSkillRow(currentSkills, updated)
        : currentSkills)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setSkillRowOperations((operations) => withoutSkillRowOperation(operations, current.id))
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
      setSkills((currentSkills) => currentSkills
        ? currentSkills.filter((value) => value.id !== current.id)
        : currentSkills)
      setDeletingSkill(null)
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
        title="Skills"
        description="管理 Rovai AI 和队员可使用的 Skill。"
        aside={(
          <>
            <span className="settings-page-note">应用全局配置</span>
            <button
              className="primary-button"
              type="button"
              aria-expanded={importOpen}
              aria-controls="skill-import-panel"
              onClick={() => setImportOpen((open) => !open)}
            >
              添加 Skill
            </button>
          </>
        )}
      />

      {error && (
        <div className="skill-page-error" role="alert">
          <strong>操作未完成</strong>
          <span>{error}</span>
          <button className="quiet-button compact" type="button" onClick={() => setError(null)}>关闭</button>
        </div>
      )}

      <div className="skill-section-stack">
        <section id="skill-import-panel" className="skill-import-panel" hidden={!importOpen}>
          <div className="skill-import-heading">
            <div>
              <h2>添加 Skill</h2>
              <p>检查来源与内容后，再保存到 Rovai 的本机受管仓库。</p>
            </div>
            <button className="skill-import-close" type="button" aria-label="关闭添加 Skill" onClick={() => setImportOpen(false)}>
              <CloseIcon />
            </button>
          </div>
          <div
            className="skill-import-tabs"
            role="tablist"
            aria-label="Skill 添加方式"
            onKeyDown={(event) => {
              const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'End'
                ? 'github'
                : event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'Home'
                  ? 'local'
                  : null
              if (!next) return
              event.preventDefault()
              setImportTab(next)
              requestAnimationFrame(() => document.getElementById(`skill-import-${next}-tab`)?.focus())
            }}
          >
            <button id="skill-import-local-tab" className={importTab === 'local' ? 'active' : ''} type="button" role="tab" aria-selected={importTab === 'local'} aria-controls="skill-import-local-panel" tabIndex={importTab === 'local' ? 0 : -1} onClick={() => setImportTab('local')}>本地文件夹</button>
            <button id="skill-import-github-tab" className={importTab === 'github' ? 'active' : ''} type="button" role="tab" aria-selected={importTab === 'github'} aria-controls="skill-import-github-panel" tabIndex={importTab === 'github' ? 0 : -1} onClick={() => setImportTab('github')}>GitHub</button>
          </div>
          {importTab === 'local'
            ? (
              <div id="skill-import-local-panel" className="skill-import-body" role="tabpanel" aria-labelledby="skill-import-local-tab">
                <div className="skill-import-copy">
                  <strong>选择包含 <code>SKILL.md</code> 的完整目录</strong>
                  <small>先生成安全预览；确认后复制完整内容，不再依赖原始文件夹。</small>
                </div>
                <button className="primary-button" type="button" disabled={busy !== null} onClick={() => void inspectLocalImport()}>
                  {busy === 'inspect-local' ? '正在检查…' : '选择文件夹'}
                </button>
              </div>
              )
            : (
              <div id="skill-import-github-panel" className="skill-import-body" role="tabpanel" aria-labelledby="skill-import-github-tab">
                <label className="skill-import-github-field">
                  <span>GitHub Skill 链接</span>
                  <input className="skill-text-input" value={githubInput} onChange={(event) => setGithubInput(event.target.value)} placeholder="粘贴仓库或带 ref / 子目录的链接" />
                </label>
                <button className="primary-button skill-import-github-submit" type="button" disabled={busy !== null || githubInput.trim().length === 0} onClick={() => void inspectGithubImport()}>
                  {busy === 'inspect-github' ? '正在检查…' : '检查并导入'}
                </button>
              </div>
              )}
        </section>

        <section className="skill-section skill-library-section">
          <div className="skill-section-heading">
            <div>
              <h2>已安装 Skills</h2>
              <p>搜索 Skill，调整运行时生效组，或查看来源详情。</p>
            </div>
            <span className="skill-section-count">{configurableSkillCount ?? '—'} 项</span>
          </div>
          <div className="skill-library-toolbar">
            <label className="skill-search-row">
              <SearchIcon />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 Skill 名称、简介或来源" aria-label="搜索 Skill" />
            </label>
          </div>
          {skills === null && <div className="skill-empty" aria-live="polite">正在读取 Skill Library…</div>}
          {skills?.length === 0 && <div className="skill-empty">还没有可用的 Skill。可以导入包含 <code>SKILL.md</code> 的目录。</div>}
          {skills && skills.length > 0 && visibleSkills?.length === 0 && <div className="skill-empty">没有匹配“{search.trim()}”的 Skill。</div>}
          {visibleSkills && visibleSkills.length > 0 && (
            <div className="skill-card-grid">
              <SkillLibraryColumns />
              {visibleSkills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  groups={groups}
                  operation={skillRowOperations[skill.id] ?? null}
                  busy={busy === `delete-${skill.id}` ? busy : null}
                  onToggleEnabled={() => void setEnabled(skill)}
                  onToggleGroup={(groupKey) => void toggleGroup(skill, groupKey)}
                  onDelete={() => setDeletingSkill(skill)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <ImportInspectionDialog
        inspection={inspection}
        busy={busy}
        onClose={() => !busy && setInspection(null)}
        onCommit={(candidate) => {
          if (candidate.importAction === 'update') setUpdatingCandidate(candidate)
          else void commitCandidate(candidate, false)
        }}
      />
      <DeleteSkillDialog
        skill={deletingSkill}
        busy={busy}
        onClose={() => !busy && setDeletingSkill(null)}
        onConfirm={() => deletingSkill && void deleteSkill(deletingSkill)}
      />
      <UpdateSkillDialog
        candidate={updatingCandidate}
        busy={busy}
        onClose={() => !busy && setUpdatingCandidate(null)}
        onConfirm={() => updatingCandidate && void commitCandidate(updatingCandidate, true)}
      />
    </div>
  )
}

export function SkillLibraryColumns(): React.JSX.Element {
  return (
    <div className="skill-library-columns" aria-hidden="true">
      <span />
      <span>Skill</span>
      <div className="skill-card-controls skill-library-legend">
        <span>生效范围</span><span>状态</span><span>查看</span>
      </div>
    </div>
  )
}

export function settingsVisibleSkills(
  skills: SkillView[] | null,
  search: string
): SkillView[] | null {
  if (!skills) return null
  const configurable = skills.filter((skill) => (
    skill.managementPolicy === 'user_managed' && skill.lifecycleStatus === 'active'
  ))
  const query = search.trim().toLocaleLowerCase('zh-CN')
  if (query.length === 0) return configurable
  return configurable.filter((skill) => skillSearchText(skill)
    .toLocaleLowerCase('zh-CN')
    .includes(query))
}

export function SkillCard({
  skill,
  groups,
  operation,
  busy,
  onToggleEnabled,
  onToggleGroup,
  onDelete
}: {
  skill: SkillView
  groups: SkillDeliveryGroupView[]
  operation: SkillRowOperation | null
  busy: string | null
  onToggleEnabled(): void
  onToggleGroup(groupKey: SkillDeliveryGroupKey): void
  onDelete(): void
}): React.JSX.Element {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const selected = new Set(skill.groupAssignments.map((assignment) => assignment.groupKey))
  const deleting = skill.lifecycleStatus === 'deleting'
  const rowBusy = operation !== null || busy !== null
  const source = skillSourcePresentation(skill)
  const detailsId = `skill-details-${skill.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  return (
    <article
      className={`skill-card ${!skill.enabled ? 'is-disabled' : ''} ${detailsOpen ? 'is-expanded' : ''}`}
      data-skill-name={skill.name}
      aria-busy={rowBusy}
    >
      <div className="skill-card-primary">
        <SkillIdentityMark skillId={skill.id} name={skill.name} />
        <div className="skill-card-heading">
          <div className="skill-card-title">
            <strong title={skill.name}>{skill.name}</strong>
            <span className={`skill-source source-${source.kind}`}>{source.badgeLabel}</span>
          </div>
          <p>{skill.currentRevision.description || '未提供说明。'}</p>
        </div>
        <div className="skill-card-controls">
          <SkillGroupMenu
            skill={skill}
            groups={groups}
            selected={selected}
            disabled={rowBusy || deleting}
            onToggle={onToggleGroup}
          />
          <button
            className="skill-toggle"
            type="button"
            role="switch"
            aria-checked={skill.enabled}
            aria-label={operation === 'toggle'
              ? `正在保存 ${skill.name}`
              : `${skill.enabled ? '停用' : '启用'} ${skill.name}`}
            disabled={rowBusy || deleting}
            onClick={onToggleEnabled}
          >
            <span aria-hidden="true" />
          </button>
          <button
            className="skill-detail-button"
            type="button"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            aria-label={`${detailsOpen ? '收起' : '查看'} ${skill.name} 详情`}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <ChevronIcon />
          </button>
        </div>
      </div>
      <div className="skill-card-details" id={detailsId} hidden={!detailsOpen}>
        <SkillDetailSource source={source} />
        <DetailFact label="Library Revision" value={`r${skill.currentRevision.revision}`} mono />
        <DetailFact
          label={skill.currentRevision.sourceType === 'bundled' ? '安装时间' : '更新时间'}
          value={formatTimestamp(skill.currentRevision.installedAt)}
        />
        <DetailFact label="内容" value={`${skill.currentRevision.fileCount} 个文件 · ${formatBytes(skill.currentRevision.totalBytes)}`} />
        <DetailFact label="内容摘要" value={shortDigest(skill.currentRevision.contentDigest)} mono title={skill.currentRevision.contentDigest} />
        <p className="skill-detail-note">{source.detailNote}</p>
        {skill.origin === 'imported' && (
          <div className="skill-detail-footer">
            <button className="skill-delete-button" type="button" disabled={rowBusy || deleting} onClick={onDelete}>删除</button>
          </div>
        )}
      </div>
    </article>
  )
}

export function patchSkillEnabledResult(
  skills: SkillView[],
  skillId: string,
  result: StoredCommandResult
): SkillView[] {
  const enabled = result.payload.enabled
  const version = result.payload.version
  if (typeof enabled !== 'boolean' || typeof version !== 'number') {
    throw new Error('Skill 启停结果无效，请重试。')
  }
  return skills.map((skill) => skill.id === skillId
    ? { ...skill, enabled, version }
    : skill)
}

function replaceSkillRow(skills: SkillView[], updated: SkillView): SkillView[] {
  return skills.map((skill) => skill.id === updated.id ? updated : skill)
}

function withoutSkillRowOperation(
  operations: Record<string, SkillRowOperation>,
  skillId: string
): Record<string, SkillRowOperation> {
  if (!(skillId in operations)) return operations
  const next = { ...operations }
  delete next[skillId]
  return next
}

export type SkillSourcePresentation = {
  kind: 'bundled' | 'third-party' | 'imported'
  badgeLabel: 'Rovai' | 'GitHub' | '用户导入'
  sourceLabel: string
  repositoryUrl: string | null
  repositoryLabel: string | null
  revisionLabel: string
  detailNote: string
}

export function skillSourcePresentation(skill: SkillView): SkillSourcePresentation {
  const metadata = metadataRecord(skill.currentRevision.sourceMetadata)
  const internalRevision = `Revision r${skill.currentRevision.revision}`

  if (skill.origin === 'official') {
    const upstream = metadataRecord(metadata?.upstream)
    const repository = githubRepository(metadataString(upstream, 'repository'))
    const revision = metadataString(upstream, 'revision')
    if (repository && revision) {
      return {
        kind: 'third-party',
        badgeLabel: 'GitHub',
        sourceLabel: '固定上游副本',
        repositoryUrl: repository.url,
        repositoryLabel: repository.label,
        revisionLabel: shortGitRevision(revision),
        detailNote: '随 Rovai 安装的固定上游副本；启动和使用时不访问 GitHub，也不会随上游自动更新。'
      }
    }
    return {
      kind: 'bundled',
      badgeLabel: 'Rovai',
      sourceLabel: '随 Rovai 安装',
      repositoryUrl: null,
      repositoryLabel: null,
      revisionLabel: internalRevision,
      detailNote: '随 Rovai 发布并由应用更新；启用不代表获得额外工具或权限。'
    }
  }

  const importedSource = metadataRecord(metadata?.source)
  const repository = skill.currentRevision.sourceType === 'github'
    ? githubRepository(metadataString(importedSource, 'repositoryUrl'))
    : null
  const revision = metadataString(importedSource, 'resolvedCommit')
    ?? metadataString(importedSource, 'gitRef')

  return {
    kind: 'imported',
    badgeLabel: '用户导入',
    sourceLabel: sourceTypeLabel(skill.currentRevision.sourceType),
    repositoryUrl: repository?.url ?? null,
    repositoryLabel: repository?.label ?? null,
    revisionLabel: revision ? shortGitRevision(revision) : internalRevision,
    detailNote: 'Rovai 已保存独立副本，不依赖原始来源；后续不会自动同步，启停和生效范围仍由你管理。'
  }
}

function skillSearchText(skill: SkillView): string {
  const source = skillSourcePresentation(skill)
  return [
    skill.name,
    skill.currentRevision.description,
    source.badgeLabel,
    source.sourceLabel,
    source.repositoryLabel,
    source.revisionLabel
  ].filter(Boolean).join('\n')
}

function SkillDetailSource({ source }: { source: SkillSourcePresentation }): React.JSX.Element {
  return (
    <div className="skill-detail-fact skill-detail-source">
      <span>来源</span>
      {source.repositoryUrl && source.repositoryLabel
        ? (
          <div className="skill-detail-source-value">
            <a
              className="skill-source-link"
              href={source.repositoryUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`${source.repositoryLabel}，在浏览器打开`}
            >
              <span>{source.repositoryLabel}</span><ExternalLinkIcon />
            </a>
            <span aria-hidden="true">·</span>
            <code className="skill-detail-source-revision">{source.revisionLabel}</code>
          </div>
          )
        : <strong>{source.sourceLabel}</strong>}
    </div>
  )
}

function DetailFact({ label, value, mono = false, title }: {
  label: string
  value: string
  mono?: boolean
  title?: string
}): React.JSX.Element {
  return <div className="skill-detail-fact"><span>{label}</span><strong className={mono ? 'mono' : ''} title={title}>{value}</strong></div>
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function metadataString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function githubRepository(value: string | null): { url: string; label: string } | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null
    const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
    if (segments.length < 2) return null
    const repository = segments[1].endsWith('.git') ? segments[1].slice(0, -4) : segments[1]
    return {
      url: `https://github.com/${segments[0]}/${repository}`,
      label: `${segments[0]}/${repository}`
    }
  } catch {
    return null
  }
}

function shortGitRevision(value: string): string {
  return Array.from(value).slice(0, 8).join('')
}

export function groupAssignmentSummary(selected: number, total: number): string {
  if (total > 0 && selected === total) return `全部 ${total} 组`
  if (selected === 0) return '未选择'
  return `${selected} / ${total} 组`
}

function SkillGroupMenu({ skill, groups, selected, disabled, onToggle }: {
  skill: SkillView
  groups: SkillDeliveryGroupView[]
  selected: Set<SkillDeliveryGroupKey>
  disabled: boolean
  onToggle(groupKey: SkillDeliveryGroupKey): void
}): React.JSX.Element {
  const summary = groupAssignmentSummary(selected.size, groups.length)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="skill-group-select" type="button" disabled={disabled} aria-label={`${skill.name} 生效范围，${summary}`}>
          <span>{summary}</span><ChevronIcon />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="skill-group-menu" align="start" sideOffset={5} collisionPadding={12}>
          <div className="skill-group-menu-header">
            <div><strong>选择 Agent 运行时生效组</strong><small>可多选。队员根据当前 Agent 运行时实时计算，仅用于展示。</small></div>
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
                  <span className="skill-runtime-line">对应 Agent 运行时：{group.adapterKinds.map(adapterLabel).join('、') || '暂无'}</span>
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
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent className="skill-import-dialog" width="wide" tone="info">
          <AppDialogHeader
            title="检查 Skill 导入"
            description="确认后写入 Rovai Skill Library。新 Skill 默认启用并选择全部 Agent 运行时生效组；之后仍可逐项调整。"
            icon="sparkles"
            kicker="安全预览"
            closeDisabled={busy !== null}
          />
          {inspection && (
            <AppDialogBody>
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
            </AppDialogBody>
          )}
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function DeleteSkillDialog({ skill, busy, onClose, onConfirm }: {
  skill: SkillView | null
  busy: string | null
  onClose(): void
  onConfirm(): void
}): React.JSX.Element {
  const copy = deleteSkillConfirmationCopy(skill?.name ?? '')
  return (
    <Dialog.Root open={skill !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent tone="danger">
          <AppDialogHeader
            title={copy.title}
            description={copy.description}
            icon="sparkles"
            kicker="受管内容"
            closeDisabled={busy !== null}
          />
          <AppDialogBody>
            <AppDialogImpactList>
              <AppDialogImpact tone="delete" icon="trash" label="Rovai 管理内容">当前 Revision 与受管文件将在安全释放后删除。</AppDialogImpact>
              <AppDialogImpact tone="keep" icon="keep" label="原生 Skill">Agent 运行时原生的同名 Skill 不会被删除。</AppDialogImpact>
              <AppDialogImpact tone="keep" icon="shield" label="当前执行">已经开始的执行继续使用启动时冻结的版本。</AppDialogImpact>
            </AppDialogImpactList>
          </AppDialogBody>
          <AppDialogFooter>
            <Dialog.Close asChild><button className="quiet-button" type="button" autoFocus data-dialog-autofocus disabled={busy !== null}>取消</button></Dialog.Close>
            <button className="danger-button" type="button" onClick={onConfirm} disabled={busy !== null}>{busy?.startsWith('delete-') ? '正在删除…' : copy.confirmLabel}</button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function UpdateSkillDialog({ candidate, busy, onClose, onConfirm }: {
  candidate: SkillImportCandidate | null
  busy: string | null
  onClose(): void
  onConfirm(): void
}): React.JSX.Element {
  const copy = updateSkillConfirmationCopy(candidate?.name ?? '')
  return (
    <Dialog.Root open={candidate !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent tone="info">
          <AppDialogHeader
            title={copy.title}
            description={copy.description}
            icon="sparkles"
            kicker="版本更新"
            closeDisabled={busy !== null}
          />
          <AppDialogBody>
            <AppDialogImpactList>
              <AppDialogImpact icon="sparkles" label="将创建">一个新的不可变 Revision，并将其设为之后投递使用的版本。</AppDialogImpact>
              <AppDialogImpact tone="keep" icon="keep" label="生效组">当前分配到的 Agent 运行时生效组保持不变。</AppDialogImpact>
              <AppDialogImpact tone="keep" icon="shield" label="当前执行">已经开始的执行继续使用启动时选择的原版本。</AppDialogImpact>
            </AppDialogImpactList>
          </AppDialogBody>
          <AppDialogFooter>
            <Dialog.Close asChild><button className="quiet-button" type="button" autoFocus data-dialog-autofocus disabled={busy !== null}>取消</button></Dialog.Close>
            <button className="primary-button" type="button" onClick={onConfirm} disabled={busy !== null}>{busy?.startsWith('import-') ? '正在更新…' : copy.confirmLabel}</button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function SearchIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>
}

function CloseIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
}

function ExternalLinkIcon(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M14 5h5v5M10 14l9-9M19 13v6H5V5h6" /></svg>
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
  return ({ 'codex-cli': 'Codex', 'opencode-cli': 'OpenCode', 'copilot-cli': 'Copilot', 'claude-code-cli': 'Claude Code', 'antigravity-app': 'Antigravity', 'kiro-cli': 'Kiro', 'qoder-cli': 'Qoder', 'codebuddy-cli': 'CodeBuddy', 'qwen-code': 'Qwen', 'trae-cn-cli': 'TRAE CLI', 'cursor-agent': 'Cursor Agent', 'kimi-code-cli': 'Kimi Code', 'grok-build': 'Grok Build' } as Partial<Record<AdapterKind, string>>)[adapter] ?? adapter
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
    const message = typeof result.payload.message === 'string' ? result.payload.message : `操作未完成：${result.code}`
    throw new Error(message)
  }
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error))
}
