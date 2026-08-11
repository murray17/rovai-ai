import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SkillView, StoredCommandResult } from '@contracts'
import {
  SkillCard,
  SkillSettings,
  formatBytes,
  groupAssignmentSummary,
  importActionLabel,
  patchSkillEnabledResult,
  projectionStateLabel,
  skillSourcePresentation
} from './SkillSettings'

describe('Skill settings', () => {
  it('renders the Skill Library as the safe default settings surface', () => {
    const markup = renderToStaticMarkup(createElement(SkillSettings))

    expect(markup).toContain('已安装 Skills')
    expect(markup).toContain('添加 Skill')
    expect(markup).toContain('正在读取 Skill Library')
    expect(markup).toContain('应用全局配置')
    expect(markup).toContain('管理 Rovai 内置、固定上游的第三方与用户导入 Skill')
    expect(markup).toContain('class="settings-page-heading"')
    expect(markup).toContain('<h1>Skill 管理</h1>')
    expect(markup).toContain('id="skill-import-local-tab"')
    expect(markup).toContain('aria-controls="skill-import-local-panel"')
    expect(markup).toContain('aria-labelledby="skill-import-local-tab"')
    expect(markup).toContain('导入前会先生成安全预览')
    expect(markup).not.toContain('class="skill-import-help"')
    expect(markup).not.toContain('允许执行')
  })

  it('explains import and projection states without relying on color', () => {
    expect(importActionLabel('create')).toBe('新 Skill')
    expect(importActionLabel('update')).toContain('新 Revision')
    expect(importActionLabel('official_conflict')).toContain('不能覆盖')
    expect(projectionStateLabel('shadowed')).toContain('项目同名')
    expect(projectionStateLabel('stale')).toContain('下次运行')
    expect(projectionStateLabel('pending_removal')).toContain('释放')
  })

  it('formats import sizes compactly and deterministically', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1_536)).toBe('1.5 KB')
    expect(formatBytes(2 * 1_024 * 1_024)).toBe('2.0 MB')
  })

  it('uses the switch as the sole enabled-state label', () => {
    const enabled = renderToStaticMarkup(createElement(SkillCard, {
      skill: skillFixture(true),
      groups: [],
      operation: null,
      busy: null,
      onToggleEnabled: () => {},
      onToggleGroup: () => {},
      onDelete: () => {}
    }))
    const disabled = renderToStaticMarkup(createElement(SkillCard, {
      skill: skillFixture(false),
      groups: [],
      operation: null,
      busy: null,
      onToggleEnabled: () => {},
      onToggleGroup: () => {},
      onDelete: () => {}
    }))

    expect(enabled).toContain('role="switch"')
    expect(enabled).toContain('aria-checked="true"')
    expect(enabled).toContain('<b>已启用</b>')
    expect(disabled).toContain('<b>已停用</b>')
    expect(enabled).not.toContain('status-badge')
    expect(disabled).not.toContain('status-badge')
    expect(enabled).toContain('<span>详情</span>')
    expect(enabled).not.toContain('•••')
    expect(enabled).not.toContain('更多操作')
  })

  it('distinguishes bundled, pinned third-party, and user-imported provenance', () => {
    const bundled = skillFixture(true)
    const thirdParty = {
      ...skillFixture(true),
      name: 'tasteful-ui',
      currentRevision: {
        ...skillFixture(true).currentRevision,
        name: 'tasteful-ui',
        sourceMetadata: {
          upstream: {
            repository: 'https://github.com/DonkeyKing01/tasteful-ui-skill',
            revision: '159ccd47a320f3a7bd0289d07366d422211895a1'
          }
        }
      }
    } satisfies SkillView
    const importedLocal = {
      ...skillFixture(true),
      origin: 'imported',
      currentRevision: {
        ...skillFixture(true).currentRevision,
        sourceType: 'local_folder',
        sourceMetadata: { source: { sourcePath: '/private/example' } }
      }
    } satisfies SkillView
    const importedGithub = {
      ...skillFixture(true),
      origin: 'imported',
      currentRevision: {
        ...skillFixture(true).currentRevision,
        sourceType: 'github',
        sourceMetadata: {
          source: {
            repositoryUrl: 'https://github.com/example/team-skill',
            resolvedCommit: 'abcdef1234567890'
          }
        }
      }
    } satisfies SkillView

    expect(skillSourcePresentation(bundled)).toMatchObject({
      kind: 'bundled',
      badgeLabel: 'Rovai 内置',
      sourceLabel: '随 Rovai 安装',
      repositoryUrl: null,
      revisionLabel: 'Revision r1'
    })
    expect(skillSourcePresentation(thirdParty)).toMatchObject({
      kind: 'third-party',
      badgeLabel: 'GitHub 三方',
      repositoryUrl: 'https://github.com/DonkeyKing01/tasteful-ui-skill',
      repositoryLabel: 'DonkeyKing01/tasteful-ui-skill',
      revisionLabel: '159ccd47'
    })
    expect(skillSourcePresentation(importedLocal)).toMatchObject({
      kind: 'imported',
      badgeLabel: '用户导入',
      sourceLabel: '本地文件夹导入',
      repositoryUrl: null
    })
    expect(skillSourcePresentation(importedGithub)).toMatchObject({
      kind: 'imported',
      badgeLabel: '用户导入',
      repositoryUrl: 'https://github.com/example/team-skill',
      repositoryLabel: 'example/team-skill',
      revisionLabel: 'abcdef12'
    })
  })

  it('renders pinned GitHub provenance inline and keeps deletion inside named details', () => {
    const thirdParty = {
      ...skillFixture(true),
      name: 'tasteful-ui',
      currentRevision: {
        ...skillFixture(true).currentRevision,
        name: 'tasteful-ui',
        sourceMetadata: {
          upstream: {
            repository: 'https://github.com/DonkeyKing01/tasteful-ui-skill',
            revision: '159ccd47a320f3a7bd0289d07366d422211895a1'
          }
        }
      }
    } satisfies SkillView
    const imported = { ...skillFixture(true), origin: 'imported' } satisfies SkillView
    const thirdPartyMarkup = renderToStaticMarkup(createElement(SkillCard, {
      skill: thirdParty,
      groups: [],
      operation: null,
      busy: null,
      onToggleEnabled: () => {},
      onToggleGroup: () => {},
      onDelete: () => {}
    }))
    const importedMarkup = renderToStaticMarkup(createElement(SkillCard, {
      skill: imported,
      groups: [],
      operation: null,
      busy: null,
      onToggleEnabled: () => {},
      onToggleGroup: () => {},
      onDelete: () => {}
    }))

    expect(thirdPartyMarkup).toContain('GitHub 三方')
    expect(thirdPartyMarkup).toContain('DonkeyKing01/tasteful-ui-skill')
    expect(thirdPartyMarkup).toContain('159ccd47')
    expect(thirdPartyMarkup).toContain('target="_blank"')
    expect(thirdPartyMarkup).toContain('aria-expanded="false"')
    expect(thirdPartyMarkup).toContain('随 Rovai 安装的固定上游副本')
    expect(thirdPartyMarkup).not.toContain('删除 Skill…')
    expect(importedMarkup).toContain('用户导入')
    expect(importedMarkup).toContain('删除 Skill…')
  })

  it('summarizes the delivery scope without an ambiguous action label', () => {
    expect(groupAssignmentSummary(9, 9)).toBe('全部 9 组')
    expect(groupAssignmentSummary(6, 9)).toBe('6 / 9 组')
    expect(groupAssignmentSummary(0, 9)).toBe('未选择')
  })

  it('patches only the toggled row without reordering the Skill list', () => {
    const first = skillFixture(true)
    const second = { ...skillFixture(true), id: 'skill-2', name: 'skill-two' }
    const result = commandResult({ enabled: false, version: 8 })

    const updated = patchSkillEnabledResult([first, second], first.id, result)

    expect(updated.map((skill) => skill.id)).toEqual([first.id, second.id])
    expect(updated[0]).toMatchObject({ enabled: false, version: 8 })
    expect(updated[1]).toBe(second)
  })
})

function skillFixture(enabled: boolean): SkillView {
  return {
    id: 'skill-1',
    name: 'skill-one',
    origin: 'official',
    enabled,
    lifecycleStatus: 'active',
    currentRevision: {
      id: 'revision-1',
      skillId: 'skill-1',
      revision: 1,
      name: 'skill-one',
      description: 'Skill fixture',
      sourceType: 'bundled',
      contentDigest: 'sha256:fixture',
      sourceMetadata: {},
      riskSummary: {
        executableFileCount: 0,
        scriptFileCount: 0,
        binaryCandidateCount: 0,
        declaredTools: []
      },
      fileCount: 1,
      totalBytes: 128,
      installedAt: '2026-08-11T00:00:00Z'
    },
    groupAssignments: [],
    version: 7,
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
    deletionRequestedAt: null
  }
}

function commandResult(payload: Record<string, unknown>): StoredCommandResult {
  return {
    commandId: 'command-1',
    commandType: 'skill.enabled.set',
    requestDigest: 'sha256:request',
    requestDigestVersion: 1,
    status: 'applied',
    code: 'skill_disabled',
    payload,
    resultEntity: { entityType: 'skill', entityId: 'skill-1' },
    recordedAt: '2026-08-11T00:00:00Z'
  }
}
