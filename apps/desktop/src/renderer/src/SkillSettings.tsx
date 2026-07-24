import { useCallback, useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  SkillImportCandidate,
  SkillImportInspection,
  SkillProjectionIssue,
  SkillRiskSummary,
  SkillView,
  StoredCommandResult
} from '@contracts'

type Confirmation =
  | { kind: 'delete'; skill: SkillView }
  | { kind: 'update'; candidate: SkillImportCandidate }
  | null

export function SkillSettings(): React.JSX.Element {
  const [skills, setSkills] = useState<SkillView[] | null>(null)
  const [issues, setIssues] = useState<SkillProjectionIssue[]>([])
  const [inspection, setInspection] = useState<SkillImportInspection | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    const [nextSkills, nextIssues] = await Promise.all([
      window.lumen.request<SkillView[]>('skills.list'),
      window.lumen.request<SkillProjectionIssue[]>('skills.projections.listIssues')
    ])
    setSkills(nextSkills)
    setIssues(nextIssues)
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.lumen.request<SkillView[]>('skills.list'),
      window.lumen.request<SkillProjectionIssue[]>('skills.projections.listIssues')
    ]).then(([nextSkills, nextIssues]) => {
      if (cancelled) return
      setSkills(nextSkills)
      setIssues(nextIssues)
    }).catch((nextError) => {
      if (!cancelled) setError(errorMessage(nextError))
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    return window.lumen.onEvent((event) => {
      if (event.method !== 'runtime.state') return
      const params = event.params !== null && typeof event.params === 'object'
        ? event.params as Record<string, unknown>
        : {}
      if (params.status === 'ready') void load().catch((nextError) => setError(errorMessage(nextError)))
    })
  }, [load])

  const inspectImport = async (): Promise<void> => {
    setBusy('inspect')
    setError(null)
    try {
      const path = await window.lumen.selectSkillImportDirectory()
      if (!path) return
      const nextInspection = await window.lumen.request<SkillImportInspection>(
        'skills.import.inspect',
        { path }
      )
      setInspection(nextInspection)
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
      const result = await window.lumen.request<StoredCommandResult>('skills.import.commit', {
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
        ? {
            ...current,
            candidates: current.candidates.filter((value) => value.name !== candidate.name)
          }
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
      const result = await window.lumen.request<StoredCommandResult>('skills.setEnabled', {
        commandId: crypto.randomUUID(),
        command: {
          skillId: skill.id,
          expectedVersion: skill.version,
          enabled: !skill.enabled
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
      const result = await window.lumen.request<StoredCommandResult>('skills.delete', {
        commandId: crypto.randomUUID(),
        command: {
          skillId: skill.id,
          expectedVersion: skill.version
        }
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

  const reconcile = async (): Promise<void> => {
    setBusy('reconcile')
    setError(null)
    try {
      const result = await window.lumen.request<StoredCommandResult>('skills.reconcile', {
        commandId: crypto.randomUUID(),
        command: {}
      })
      assertCommandApplied(result)
      await load()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  const reveal = async (skill: SkillView): Promise<void> => {
    setBusy(`reveal-${skill.id}`)
    setError(null)
    try {
      await window.lumen.revealSkill(skill.id)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="skill-settings">
      <section className="project-hero skill-hero">
        <div>
          <p className="eyebrow">LOCAL SKILL LIBRARY</p>
          <h2>技能</h2>
          <p>Skill 保存在 Lumen 的本机受管仓库，并按 Runtime 原生规则投影到项目。启用 Skill 不会扩大 Agent 权限。</p>
        </div>
        <div className="project-actions">
          <button
            className="quiet-button"
            type="button"
            onClick={() => void reconcile()}
            disabled={busy !== null}
          >
            {busy === 'reconcile' ? '正在重新同步…' : '重新同步项目'}
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void inspectImport()}
            disabled={busy !== null}
          >
            {busy === 'inspect' ? '正在检查…' : '导入 Skill'}
          </button>
        </div>
      </section>

      {error && (
        <div className="skill-page-error" role="alert">
          <strong>操作未完成</strong>
          <span>{error}</span>
          <button className="quiet-button compact" type="button" onClick={() => setError(null)}>关闭</button>
        </div>
      )}

      <section className="section-block">
        <div className="section-heading">
          <div><p className="eyebrow">INSTALLED</p><h2>本机技能库</h2></div>
          <span className="health-score">{skills?.length ?? '—'} 个</span>
        </div>
        {skills === null && <div className="skill-empty" aria-live="polite">正在读取 Skill Library…</div>}
        {skills?.length === 0 && <div className="skill-empty">还没有可用的 Skill。可以导入包含 <code>SKILL.md</code> 的目录。</div>}
        {skills && skills.length > 0 && (
          <div className="skill-list">
            {skills.map((skill) => {
              const deleting = skill.lifecycleStatus === 'deleting'
              const rowBusy = busy?.endsWith(skill.id) ?? false
              return (
                <article className={`skill-row ${deleting ? 'deleting' : ''}`} key={skill.id}>
                  <div className="skill-row-main">
                    <div className="skill-title-line">
                      <strong>{skill.name}</strong>
                      <span className={`skill-source source-${skill.sourceKind}`}>
                        {skill.sourceKind === 'bundled' ? 'Lumen 内置' : '用户导入'}
                      </span>
                      {deleting && <span className="status-badge status-waiting_approval"><i />等待投影排空</span>}
                    </div>
                    <p>{skill.currentRevision.description || '未提供说明。'}</p>
                    <dl>
                      <div><dt>Revision</dt><dd><code>{shortDigest(skill.currentRevision.contentDigest)}</code></dd></div>
                      <div><dt>安装时间</dt><dd>{formatTimestamp(skill.currentRevision.installedAt)}</dd></div>
                      <div><dt>内容</dt><dd>{skill.currentRevision.fileCount} 个文件 · {formatBytes(skill.currentRevision.totalBytes)}</dd></div>
                    </dl>
                    <SkillRisk summary={skill.currentRevision.riskSummary} />
                  </div>
                  <div className="skill-row-actions">
                    <button
                      className="skill-toggle"
                      type="button"
                      role="switch"
                      aria-checked={skill.enabled}
                      aria-label={`${skill.enabled ? '停用' : '启用'} ${skill.name}`}
                      onClick={() => void setEnabled(skill)}
                      disabled={busy !== null || deleting}
                    >
                      <span aria-hidden="true" />
                      {rowBusy && busy?.startsWith('toggle-') ? '保存中' : skill.enabled ? '已启用' : '已停用'}
                    </button>
                    <button
                      className="quiet-button compact"
                      type="button"
                      onClick={() => void reveal(skill)}
                      disabled={busy !== null || deleting}
                    >
                      {rowBusy && busy?.startsWith('reveal-') ? '正在打开…' : '在 Finder 中显示'}
                    </button>
                    {skill.sourceKind === 'imported' && (
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() => setConfirmation({ kind: 'delete', skill })}
                        disabled={busy !== null || deleting}
                      >
                        删除
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div><p className="eyebrow">PROJECT PROJECTIONS</p><h2>项目投影状态</h2></div>
          <span className={`health-score ${issues.length > 0 ? 'attention' : ''}`}>
            {issues.length > 0 ? `${issues.length} 项需处理` : '正常'}
          </span>
        </div>
        {issues.length === 0
          ? <div className="skill-empty">未发现 Shadowed、Stale、Unsupported 或损坏的项目 Skill 投影。</div>
          : (
            <div className="projection-issue-list">
              {issues.map((issue) => (
                <div className="projection-issue" key={`${issue.executionRoot}:${issue.nativeRootKind}:${issue.skillId}`}>
                  <span className="projection-state" aria-label={`状态：${issue.state}`}>!</span>
                  <div>
                    <strong>{issue.skillName} · {projectionStateLabel(issue.state)}</strong>
                    <code>{issue.entryPath}</code>
                    <small>{issue.errorCode ?? '投影与当前期望不一致'} · {formatTimestamp(issue.observedAt)}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
      </section>

      <ImportInspectionDialog
        inspection={inspection}
        busy={busy}
        onClose={() => !busy && setInspection(null)}
        onCommit={(candidate) => {
          if (candidate.importAction === 'update') {
            setConfirmation({ kind: 'update', candidate })
          } else {
            void commitCandidate(candidate, false)
          }
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

function SkillRisk({ summary }: { summary: SkillRiskSummary }): React.JSX.Element {
  const hasRisk = summary.executableFileCount > 0
    || summary.scriptFileCount > 0
    || summary.binaryCandidateCount > 0
    || summary.declaredTools.length > 0
  return (
    <div className={`skill-risk ${hasRisk ? 'has-risk' : ''}`}>
      <strong>{hasRisk ? '内容提示' : '未发现脚本或可执行内容'}</strong>
      {hasRisk && (
        <span>
          {summary.scriptFileCount} 个脚本 · {summary.executableFileCount} 个可执行文件 · {summary.binaryCandidateCount} 个二进制候选
          {summary.declaredTools.length > 0 ? ` · 声明工具：${summary.declaredTools.join('、')}` : ''}
        </span>
      )}
    </div>
  )
}

function ImportInspectionDialog({
  inspection,
  busy,
  onClose,
  onCommit
}: {
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
            <div><p className="eyebrow">IMPORT PREVIEW</p><Dialog.Title>检查 Skill 导入</Dialog.Title></div>
            <Dialog.Close className="dialog-close" aria-label="关闭" disabled={busy !== null}>×</Dialog.Close>
          </div>
          <Dialog.Description>
            Lumen 已复制并检查所选目录的候选内容。确认后才会写入全局 Skill Library；新导入默认停用。
          </Dialog.Description>
          {inspection && (
            <>
              <code className="inspection-path">{inspection.sourcePath}</code>
              <div className="import-candidate-list">
                {inspection.candidates.map((candidate) => {
                  const blocked = candidate.importAction === 'bundled_conflict'
                  return (
                    <article className="import-candidate" key={candidate.name}>
                      <div>
                        <strong>{candidate.name}</strong>
                        <span>{importActionLabel(candidate.importAction)}</span>
                        <p>{candidate.description || '未提供说明。'}</p>
                        <small>{candidate.fileCount} 个文件 · {formatBytes(candidate.totalBytes)} · {shortDigest(candidate.contentDigest)}</small>
                        <SkillRisk summary={candidate.riskSummary} />
                      </div>
                      <button
                        className={candidate.importAction === 'update' ? 'approve-button' : 'primary-button'}
                        type="button"
                        disabled={busy !== null || blocked}
                        onClick={() => onCommit(candidate)}
                      >
                        {busy === `import-${candidate.name}`
                          ? '正在保存…'
                          : blocked
                            ? '与内置 Skill 冲突'
                            : candidate.importAction === 'update'
                              ? '检查并更新'
                              : candidate.importAction === 'unchanged'
                                ? '确认现有版本'
                                : '导入'}
                      </button>
                    </article>
                  )
                })}
              </div>
              {inspection.candidates.length === 0 && <div className="skill-empty">没有可导入的候选 Skill。</div>}
              {inspection.rejectedCandidates.length > 0 && (
                <div className="rejected-candidates">
                  <strong>未通过检查（{inspection.rejectedCandidates.length}）</strong>
                  {inspection.rejectedCandidates.map((candidate) => (
                    <div key={`${candidate.sourcePath}:${candidate.code}`}>
                      <code>{candidate.sourcePath}</code>
                      <span>{candidate.code}：{candidate.message}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="inspection-expiry">本次预览有效至 {formatTimestamp(inspection.expiresAt)}。</p>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ConfirmationDialog({
  confirmation,
  busy,
  onClose,
  onConfirm
}: {
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
          <Dialog.Description>
            {deleting
              ? `“${confirmation?.kind === 'delete' ? confirmation.skill.name : ''}”会先从新 AgentRun 中停用，待占用它的投影排空后删除受管内容。此操作不会删除项目自有的同名目录。`
              : `“${confirmation?.kind === 'update' ? confirmation.candidate.name : ''}”将发布一个新的不可变 Revision。正在执行的 AgentRun 与现有 Native Session 不会被替换。`}
          </Dialog.Description>
          <div className="dialog-actions">
            <Dialog.Close className="quiet-button" disabled={busy !== null}>取消</Dialog.Close>
            <button
              className={deleting ? 'danger-button' : 'primary-button'}
              type="button"
              onClick={onConfirm}
              disabled={busy !== null}
            >
              {busy?.startsWith(deleting ? 'delete-' : 'import-')
                ? deleting ? '正在删除…' : '正在更新…'
                : deleting ? '确认删除' : '确认更新'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function importActionLabel(action: SkillImportCandidate['importAction']): string {
  return ({
    create: '新 Skill',
    update: '同名内容已变化，需要确认更新',
    unchanged: '内容与现有 Revision 相同',
    bundled_conflict: '不能覆盖 Lumen 内置 Skill'
  } as const)[action]
}

export function projectionStateLabel(state: string): string {
  return ({
    shadowed: '被项目同名 Skill 遮蔽',
    stale: '投影版本过期',
    unsupported: '当前 Runtime 不支持原生 Skill',
    error: '投影失败',
    corrupted: '受管内容损坏'
  } as Record<string, string>)[state] ?? state
}

export function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KB`
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`
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
    const message = typeof result.payload.message === 'string'
      ? result.payload.message
      : `Core 拒绝了命令：${result.code}`
    throw new Error(message)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
