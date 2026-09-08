import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  SkillDeliveryGroupKey,
  SkillDeliveryGroupView,
  SkillImportCandidate,
  SkillImportInspection,
  SkillView,
  StoredCommandResult
} from '@contracts'
import { NewConversationQuickHelp } from './NewConversationQuickHelp'
import { MemberAvatar } from './MemberAvatar'
import { SkillIdentityMark } from './SkillIdentityMark'
import { SkillContentPreview } from './SkillContentPreview'
import {
  CapabilityError,
  CapabilityListItem,
  CapabilityToggle,
  CapabilityWorkspace,
  matchesCapabilityFilter,
  type CapabilityFilter
} from './CapabilityWorkspace'
import { localizeExecutionEngineTerms } from './product-copy'
import { readErrorMessage } from './error-message'
import { CapabilityDeleteDialog } from './CapabilityDeleteDialog'

export function SkillSettings(): React.JSX.Element {
  const [skills, setSkills] = useState<SkillView[] | null>(null)
  const [groups, setGroups] = useState<SkillDeliveryGroupView[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<CapabilityFilter>('all')
  const [tab, setTab] = useState<'content' | 'groups'>('content')
  const [importTab, setImportTab] = useState<'local' | 'github'>('local')
  const [githubInput, setGithubInput] = useState('')
  const [inspection, setInspection] = useState<SkillImportInspection | null>(null)
  const [candidateName, setCandidateName] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<'update' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Pick<SkillView, 'id' | 'name' | 'version'> | null>(
    null
  )
  const [busy, setBusy] = useState<string | null>(null)
  const locked = useRef(false)
  const generation = useRef(0)
  const editorSession = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async (): Promise<void> => {
    const request = ++generation.current
    const [nextSkills, nextGroups] = await Promise.all([
      window.rovai.request<SkillView[]>('skills.list'),
      window.rovai.request<SkillDeliveryGroupView[]>('skills.deliveryGroups.list')
    ])
    if (request !== generation.current) return
    setSkills(nextSkills)
    setGroups(nextGroups)
  }, [])
  useEffect(() => {
    const refresh = (): void => {
      if (!locked.current) void load().catch((reason) => setError(errorMessage(reason)))
    }
    refresh()
    window.addEventListener('focus', refresh)
    const unsubscribe = window.rovai.onEvent((event) => {
      if (
        !locked.current &&
        event.method === 'runtime.state' &&
        (event.params as { status?: string })?.status === 'ready'
      )
        void load().catch((reason) => setError(errorMessage(reason)))
    })
    return () => {
      generation.current++
      choose('')
      window.removeEventListener('focus', refresh)
      unsubscribe()
    }
  }, [load])
  const allSkills = useMemo(() => settingsVisibleSkills(skills, '') ?? [], [skills])
  const visible = useMemo(
    () => settingsVisibleSkills(skills, search, filter) ?? [],
    [skills, search, filter]
  )
  const selected =
    selectedId === 'new'
      ? undefined
      : (allSkills.find((skill) => skill.id === selectedId) ?? allSkills[0])
  const candidate =
    inspection?.candidates.find((value) => value.name === candidateName) ??
    inspection?.candidates[0]
  const choose = (id: string): void => {
    setSelectedId(id)
    selectedRef.current = id
    editorSession.current++
    setInspection(null)
    setCandidateName(null)
    setGithubInput('')
    setImportTab('local')
    setTab('content')
    setConfirmation(null)
    setDeleteTarget(null)
    setError(null)
  }
  const run = async (key: string, action: () => Promise<void>): Promise<void> => {
    if (locked.current) return
    locked.current = true
    generation.current++
    setBusy(key)
    setError(null)
    try {
      await action()
    } catch (reason) {
      if (['toggle', 'groups', 'delete'].includes(key)) await load().catch(() => undefined)
      setError(errorMessage(reason))
    } finally {
      locked.current = false
      setBusy(null)
    }
  }
  const inspect = (): void => {
    const session = editorSession.current
    void run('inspect', async () => {
      let next: SkillImportInspection
      if (importTab === 'local') {
        const path = await window.rovai.selectSkillImportDirectory()
        if (!path) return
        next = await window.rovai.request<SkillImportInspection>('skills.import.inspect', { path })
      } else
        next = await window.rovai.request<SkillImportInspection>(
          'skills.import.github.inspect',
          parseGithubImportInput(githubInput)
        )
      if (editorSession.current !== session) return
      setInspection(next)
      setCandidateName(next.candidates[0]?.name ?? null)
      setConfirmation(null)
    })
  }
  const commit = (confirmUpdate: boolean): void => {
    if (!candidate || !inspection) return
    void run('import', async () => {
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
      const remaining = inspection.candidates.filter((value) => value.name !== candidate.name)
      setInspection(remaining.length ? { ...inspection, candidates: remaining } : null)
      await load()
      setFilter('all')
      setSearch('')
      if (selectedRef.current === 'new' && remaining.length) {
        setCandidateName(remaining[0].name)
        setConfirmation(null)
      } else if (selectedRef.current === 'new')
        choose(
          typeof result.payload.skillId === 'string'
            ? result.payload.skillId
            : (candidate.existingSkillId ?? '')
        )
    })
  }
  const toggle = (skill: SkillView): void => {
    void run('toggle', async () => {
      const result = await window.rovai.request<StoredCommandResult>('skills.setEnabled', {
        commandId: crypto.randomUUID(),
        command: {
          skillId: skill.id,
          expectedVersion: skill.version,
          enabled: !skill.enabled
        }
      })
      assertCommandApplied(result)
      setSkills((values) => (values ? patchSkillEnabledResult(values, skill.id, result) : values))
    })
  }
  const assign = (skill: SkillView, keys: SkillDeliveryGroupKey[]): void => {
    void run('groups', async () => {
      const result = await window.rovai.request<StoredCommandResult>('skills.setGroupAssignments', {
        commandId: crypto.randomUUID(),
        command: {
          skillId: skill.id,
          expectedVersion: skill.version,
          groupKeys: keys
        }
      })
      assertCommandApplied(result)
      const updated = await window.rovai.request<SkillView>('skills.get', {
        skillId: skill.id
      })
      setSkills((values) => (values ? replaceSkillRow(values, updated) : values))
    })
  }
  const deleteSkill = (): void => {
    if (!deleteTarget) return
    const skill = deleteTarget
    void run('delete', async () => {
      const result = await window.rovai.request<StoredCommandResult>('skills.delete', {
        commandId: crypto.randomUUID(),
        command: { skillId: skill.id, expectedVersion: skill.version }
      })
      assertCommandApplied(result)
      setDeleteTarget(null)
      setSkills((values) => values?.filter((value) => value.id !== skill.id) ?? null)
      if (selectedRef.current === skill.id || selectedRef.current === null) choose('')
    })
  }
  return (
    <CapabilityWorkspace
      title="Skills"
      count={
        search || filter !== 'all'
          ? `${visible.length}/${allSkills.length}`
          : skills
            ? allSkills.length
            : '—'
      }
      search={search}
      onSearch={setSearch}
      filter={filter}
      onFilter={setFilter}
      onAdd={() => choose('new')}
      addDisabled={busy !== null}
      selectionKey={selectedId === 'new' ? 'new' : (selected?.id ?? null)}
      header={
        selectedId === 'new' ? (
          <>
            <header className="capability-detail-heading">
              <div>
                <h2>导入 Skill</h2>
                <p className="capability-note">从本地文件夹或 GitHub 导入</p>
              </div>
              <div className="capability-actions">
                <button
                  className="quiet-button compact"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => choose('')}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={
                    busy !== null || !candidate || candidate.importAction === 'official_conflict'
                  }
                  onClick={() =>
                    candidate?.importAction === 'update' ? setConfirmation('update') : commit(false)
                  }
                >
                  {busy === 'import'
                    ? '正在保存…'
                    : candidate?.importAction === 'update'
                      ? '更新 Skill'
                      : '导入 Skill'}
                </button>
              </div>
            </header>
            {confirmation === 'update' && candidate && (
              <div
                className="capability-confirm capability-header-confirm"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setConfirmation(null)
                }}
              >
                <span>更新 {candidate.name}？现有启停状态和生效组将保留。</span>
                <div className="capability-actions">
                  <button
                    autoFocus
                    className="quiet-button compact"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => setConfirmation(null)}
                  >
                    取消更新
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => commit(true)}
                  >
                    确认更新
                  </button>
                </div>
              </div>
            )}
          </>
        ) : selected ? (
          <>
            <header className="capability-detail-heading">
              <div className="capability-title">
                <h2>{selected.name}</h2>
                {skillSourcePresentation(selected).badgeLabel && (
                  <span className="capability-source">
                    {skillSourcePresentation(selected).badgeLabel}
                  </span>
                )}
                <span className="capability-note">r{selected.currentRevision.revision}</span>
              </div>
              <div className="capability-actions">
                <CapabilityToggle
                  name={selected.name}
                  enabled={selected.enabled}
                  disabled={busy !== null}
                  onToggle={() => toggle(selected)}
                />
                {selected.origin === 'imported' && (
                  <>
                    <span className="capability-action-divider" aria-hidden="true" />
                    <button
                      className="quiet-button compact danger-text"
                      type="button"
                      aria-label="删除 Skill"
                      disabled={busy !== null}
                      onClick={() => {
                        setError(null)
                        setDeleteTarget({
                          id: selected.id,
                          name: selected.name,
                          version: selected.version
                        })
                      }}
                    >
                      删除
                    </button>
                  </>
                )}
              </div>
            </header>
          </>
        ) : (
          <header className="capability-detail-heading">
            <h2>Skills</h2>
          </header>
        )
      }
      list={
        <>
          {skills === null ? (
            <div className="capability-empty" role="status">
              正在读取 Skill Library…
            </div>
          ) : visible.length ? (
            visible.map((skill) => (
              <SkillListItem
                key={skill.id}
                skill={skill}
                selected={skill.id === selected?.id}
                onSelect={() => choose(skill.id)}
              />
            ))
          ) : (
            <div className="capability-empty">
              {allSkills.length ? '没有匹配的 Skill。' : '还没有 Skill。'}
            </div>
          )}
        </>
      }
    >
      <CapabilityDeleteDialog
        open={deleteTarget !== null}
        title={deleteSkillConfirmationCopy(deleteTarget?.name ?? '').title}
        description={deleteSkillConfirmationCopy(deleteTarget?.name ?? '').description}
        busy={busy === 'delete'}
        error={error}
        onCancel={() => {
          setDeleteTarget(null)
          setError(null)
        }}
        onConfirm={deleteSkill}
      />
      <CapabilityError
        error={deleteTarget ? null : error}
        onRetry={
          skills === null
            ? () => {
                setError(null)
                void load().catch((reason) => setError(errorMessage(reason)))
              }
            : undefined
        }
      />
      {selectedId === 'new' ? (
        <>
          <div className="capability-tabs" role="group" aria-label="Skill 导入方式">
            <button
              type="button"
              aria-pressed={importTab === 'local'}
              disabled={busy !== null}
              onClick={() => {
                if (importTab !== 'local') {
                  setImportTab('local')
                  setInspection(null)
                  setConfirmation(null)
                }
              }}
            >
              本地文件夹
            </button>
            <button
              type="button"
              aria-pressed={importTab === 'github'}
              disabled={busy !== null}
              onClick={() => {
                if (importTab !== 'github') {
                  setImportTab('github')
                  setInspection(null)
                  setConfirmation(null)
                }
              }}
            >
              GitHub
            </button>
          </div>
          {importTab === 'local' ? (
            <div className="capability-folder-import">
              <p>选择包含 SKILL.md 的文件夹，预览后导入。</p>
              <button
                type="button"
                className="primary-button"
                disabled={busy !== null}
                onClick={inspect}
              >
                {busy === 'inspect' ? '正在读取…' : '选择文件夹'}
              </button>
            </div>
          ) : (
            <div className="capability-import-source">
              <label>
                GitHub 链接
                <input
                  aria-label="GitHub Skill 链接"
                  value={githubInput}
                  placeholder="https://github.com/owner/repository"
                  onChange={(event) => setGithubInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !busy && githubInput.trim()) inspect()
                  }}
                />
              </label>
              <button
                type="button"
                className="primary-button"
                disabled={busy !== null || !githubInput.trim()}
                onClick={inspect}
              >
                {busy === 'inspect' ? '正在读取…' : '读取'}
              </button>
            </div>
          )}
          {inspection && (
            <>
              {inspection.candidates.length > 1 && (
                <div className="capability-candidates" role="group" aria-label="待导入 Skills">
                  {inspection.candidates.map((value) => (
                    <button
                      type="button"
                      key={value.name}
                      disabled={busy !== null}
                      aria-pressed={candidate?.name === value.name}
                      onClick={() => {
                        setCandidateName(value.name)
                        setConfirmation(null)
                      }}
                    >
                      {value.name}
                    </button>
                  ))}
                </div>
              )}
              {candidate ? (
                <section className="capability-section">
                  <div className="capability-detail-heading">
                    <h3>{candidate.name}</h3>
                    <span className="capability-note">{candidate.fileCount} 个文件</span>
                  </div>
                  <p className="capability-note">{candidate.description}</p>
                  <SkillContentPreview
                    key={`${inspection.stagingToken}:${candidate.name}`}
                    target={{
                      source: 'import',
                      stagingToken: inspection.stagingToken,
                      candidateName: candidate.name,
                      expectedDigest: candidate.contentDigest
                    }}
                  />
                </section>
              ) : (
                <p className="capability-note">没有可导入的 Skill。</p>
              )}
              {inspection.rejectedCandidates.length > 0 && (
                <details className="capability-section">
                  <summary>其他 {inspection.rejectedCandidates.length} 项暂不可导入</summary>
                  <p className="capability-note">
                    请检查文件夹是否包含有效的 SKILL.md，且内容不含符号链接或超出大小限制。
                  </p>
                </details>
              )}
            </>
          )}
        </>
      ) : selected ? (
        <>
          <div className="capability-tabs" role="group" aria-label="Skill 详情">
            <button
              type="button"
              aria-pressed={tab === 'content'}
              onClick={() => setTab('content')}
            >
              内容
            </button>
            <button type="button" aria-pressed={tab === 'groups'} onClick={() => setTab('groups')}>
              生效范围{' '}
              <span>{groupAssignmentSummary(selected.groupAssignments.length, groups.length)}</span>
            </button>
          </div>
          <div hidden={tab !== 'content'}>
            <SkillContentPreview
              key={`${selected.id}:${selected.currentRevision.id}`}
              target={{
                source: 'installed',
                skillId: selected.id,
                revisionId: selected.currentRevision.id
              }}
            />
          </div>
          {tab === 'groups' && (
            <SkillGroupChoices
              skill={selected}
              groups={groups}
              disabled={busy !== null}
              onChange={(keys) => assign(selected, keys)}
            />
          )}
        </>
      ) : (
        <div className="capability-empty">从左侧选择 Skill，或导入新的 Skill。</div>
      )}
    </CapabilityWorkspace>
  )
}

export function SkillListItem({
  skill,
  selected,
  onSelect
}: {
  skill: SkillView
  selected: boolean
  onSelect(): void
}): React.JSX.Element {
  return (
    <CapabilityListItem
      name={skill.name}
      mark={<SkillIdentityMark skillId={skill.id} name={skill.name} />}
      source={skillSourcePresentation(skill).badgeLabel}
      enabled={skill.enabled}
      summary={skill.currentRevision.description || '未提供说明。'}
      selected={selected}
      onSelect={onSelect}
    />
  )
}
export function SkillGroupChoices({
  skill,
  groups,
  disabled,
  onChange
}: {
  skill: SkillView
  groups: SkillDeliveryGroupView[]
  disabled: boolean
  onChange(keys: SkillDeliveryGroupKey[]): void
}): React.JSX.Element {
  const selected = new Set(skill.groupAssignments.map((assignment) => assignment.groupKey))
  return (
    <section>
      <div className="capability-scope-heading">
        <div className="capability-title">
          <h3>生效组</h3>
          <NewConversationQuickHelp label="Skill 生效组说明">
            新导入的 Skill 默认对全部组生效。停用后保留已选组。
          </NewConversationQuickHelp>
        </div>
        <button
          type="button"
          className="quiet-button compact"
          disabled={disabled}
          onClick={() =>
            onChange(selected.size === groups.length ? [] : groups.map((group) => group.key))
          }
        >
          {selected.size === groups.length ? '清除选择' : '选择全部'}
        </button>
      </div>
      <div className="capability-group-options">
        {skillDeliveryGroupsForDisplay(groups).map((group) => (
          <button
            type="button"
            className="capability-choice capability-group-choice"
            key={group.key}
            aria-pressed={selected.has(group.key)}
            disabled={disabled}
            onClick={() =>
              onChange(
                groups
                  .map((value) => value.key)
                  .filter((key) => (key === group.key ? !selected.has(key) : selected.has(key)))
              )
            }
          >
            <span>
              <strong>{group.label}</strong>
              <span className="capability-group-members">
                {group.members.length ? (
                  <>
                    <span className="skill-member-stack">
                      {group.members.slice(0, 4).map((member) => (
                        <MemberAvatar
                          key={member.agentId}
                          agentId={member.agentId}
                          avatarRef={member.avatarRef}
                          displayName={member.displayName}
                          size="mention"
                          decorative
                        />
                      ))}
                    </span>
                    <span>{group.members.map((member) => member.displayName).join('、')}</span>
                  </>
                ) : (
                  <span>暂无队员</span>
                )}
              </span>
            </span>
            <span className="capability-check" aria-hidden="true">
              ✓
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
export function deleteSkillConfirmationCopy(name: string): {
  title: string
  description: string
  confirmLabel: string
} {
  return {
    title: `删除 Skill “${name}”？`,
    description: '删除后，此 Skill 将不再对任何生效组可用。原始导入文件会保留。',
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
    description:
      '将把已检查的内容保存为新的 Revision。现有生效组保持不变，已经开始的执行继续使用原版本。',
    confirmLabel: '更新 Skill'
  }
}

export function settingsVisibleSkills(
  skills: SkillView[] | null,
  search: string,
  filter: CapabilityFilter = 'all'
): SkillView[] | null {
  if (!skills) return null
  const configurable = skills.filter(
    (skill) =>
      skill.managementPolicy === 'user_managed' &&
      skill.lifecycleStatus === 'active' &&
      matchesCapabilityFilter(skill.enabled, filter)
  )
  const query = search.trim().toLocaleLowerCase('zh-CN')
  if (query.length === 0) return configurable
  return configurable.filter((skill) =>
    skillSearchText(skill).toLocaleLowerCase('zh-CN').includes(query)
  )
}

const SKILL_DELIVERY_GROUP_DISPLAY_RANK: Record<SkillDeliveryGroupKey, number> = {
  claude_compatible: 0,
  codex: 1,
  copilot: 2,
  opencode: 3,
  kiro: 4,
  qoder: 5,
  codebuddy: 6,
  qwen: 7,
  trae: 8,
  cursor: 9,
  kimi: 10,
  grok: 11,
  antigravity: 12,
  pi: 13
}

export function skillDeliveryGroupsForDisplay(
  groups: SkillDeliveryGroupView[]
): SkillDeliveryGroupView[] {
  return groups
    .map((group, index) => ({ group, index }))
    .sort(
      (left, right) =>
        SKILL_DELIVERY_GROUP_DISPLAY_RANK[left.group.key] -
          SKILL_DELIVERY_GROUP_DISPLAY_RANK[right.group.key] || left.index - right.index
    )
    .map(({ group }) => group)
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
  return skills.map((skill) => (skill.id === skillId ? { ...skill, enabled, version } : skill))
}

function replaceSkillRow(skills: SkillView[], updated: SkillView): SkillView[] {
  return skills.map((skill) => (skill.id === updated.id ? updated : skill))
}

export type SkillSourcePresentation = {
  kind: 'bundled' | 'imported'
  badgeLabel?: 'Rovai'
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
        kind: 'bundled',
        badgeLabel: 'Rovai',
        sourceLabel: '随 Rovai 安装',
        repositoryUrl: repository.url,
        repositoryLabel: repository.label,
        revisionLabel: shortGitRevision(revision),
        detailNote: '由 Rovai 维护并随应用更新；包内保留上游来源、许可与署名。'
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
  const repository =
    skill.currentRevision.sourceType === 'github'
      ? githubRepository(metadataString(importedSource, 'repositoryUrl'))
      : null
  const revision =
    metadataString(importedSource, 'resolvedCommit') ?? metadataString(importedSource, 'gitRef')

  return {
    kind: 'imported',
    badgeLabel: undefined,
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
  ]
    .filter(Boolean)
    .join('\n')
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
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
    const segments = url.pathname
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean)
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
  if (total > 0 && selected === total) return '全部组'
  if (selected === 0) return '未选择'
  return `${selected} 个组`
}

export function importActionLabel(action: SkillImportCandidate['importAction']): string {
  return (
    {
      create: '新 Skill',
      update: '同名 Skill 已存在，将创建新 Revision',
      unchanged: '内容与当前 Revision 相同',
      official_conflict: '不能覆盖 Rovai 内置 Skill'
    } as const
  )[action]
}

export function projectionStateLabel(state: string): string {
  return (
    (
      {
        shadowed: '被项目同名 Skill 遮蔽',
        stale: '等待下次运行生效',
        pending_removal: '等待现有运行释放',
        error: '投递失败'
      } as Record<string, string>
    )[state] ?? state
  )
}

export function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KB`
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`
}

function sourceTypeLabel(sourceType: SkillView['currentRevision']['sourceType']): string {
  return (
    {
      bundled: '随 Rovai 安装',
      local_folder: '本地文件夹导入',
      github: 'GitHub 导入'
    } as const
  )[sourceType]
}

function parseGithubImportInput(input: string): {
  repositoryUrl: string
  subdirectory?: string
  gitRef?: string
} {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('请输入有效的 GitHub HTTPS 链接。')
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com')
    throw new Error('仅支持 https://github.com/ 链接。')
  const segments = url.pathname
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
  if (segments.length < 2) throw new Error('GitHub 链接需要包含 owner 和 repository。')
  const [owner, rawRepository, marker, gitRef, ...subdirectory] = segments
  const repository = rawRepository.endsWith('.git') ? rawRepository.slice(0, -4) : rawRepository
  if (marker && marker !== 'tree')
    throw new Error('请使用仓库链接，或 /tree/<ref>/<子目录> 形式的链接。')
  if (marker === 'tree' && !gitRef)
    throw new Error('GitHub 子目录链接缺少 branch、tag 或 commit ref。')
  return {
    repositoryUrl: `https://github.com/${owner}/${repository}`,
    ...(gitRef ? { gitRef: decodeURIComponent(gitRef) } : {}),
    ...(subdirectory.length > 0
      ? { subdirectory: subdirectory.map(decodeURIComponent).join('/') }
      : {})
  }
}

function assertCommandApplied(result: StoredCommandResult): void {
  if (result.status === 'rejected') {
    const message =
      typeof result.payload.message === 'string'
        ? result.payload.message
        : `操作未完成：${result.code}`
    throw new Error(message)
  }
}

function errorMessage(error: unknown): string {
  return localizeExecutionEngineTerms(readErrorMessage(error))
}
