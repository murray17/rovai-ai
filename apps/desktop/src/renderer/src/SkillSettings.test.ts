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
  settingsVisibleSkills,
  skillSourcePresentation
} from './SkillSettings'
import { identityColorToken } from './theme'

describe('Skill settings', () => {
  it('renders the Skill Library as the safe default settings surface', () => {
    const markup = renderToStaticMarkup(createElement(SkillSettings))

    expect(markup).toContain('已安装 Skills')
    expect(markup).toContain('添加 Skill')
    expect(markup).toContain('正在读取 Skill Library')
    expect(markup).toContain('应用全局配置')
    expect(markup).toContain('管理 Rovai AI 和队员可使用的 Skill。')
    expect(markup).toContain('class="settings-page-heading"')
    expect(markup).toContain('<h1>Skills</h1>')
    expect(markup).toContain('id="skill-import-local-tab"')
    expect(markup).toContain('aria-controls="skill-import-local-panel"')
    expect(markup).toContain('aria-labelledby="skill-import-local-tab"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('id="skill-import-panel" class="skill-import-panel" hidden')
    expect(markup).toContain('检查来源与内容后，再保存到 Rovai 的本机受管仓库。')
    expect(markup).toContain('先生成安全预览；确认后复制完整内容')
    expect(markup).toContain('搜索 Skill，调整运行时生效组，或查看来源详情。')
    expect(markup).toContain('class="skill-library-toolbar"')
    expect(markup).toContain('class="skill-library-legend"')
    expect(markup).not.toContain('skill-library-columns')
    expect(markup).not.toContain('class="skill-import-help"')
    expect(markup).not.toContain('允许执行')
  })

  it('keeps system-required Skills out of the settings list and search results', () => {
    const configurable = skillFixture(true)
    const cliOperations = {
      ...skillFixture(true),
      id: 'skill-cli-operations',
      name: 'cli-operations',
      managementPolicy: 'system_required'
    } satisfies SkillView
    const memoryStewardship = {
      ...skillFixture(true),
      id: 'skill-memory-stewardship',
      name: 'memory-stewardship',
      managementPolicy: 'system_required'
    } satisfies SkillView

    expect(settingsVisibleSkills(
      [configurable, cliOperations, memoryStewardship],
      ''
    )).toEqual([configurable])
    expect(settingsVisibleSkills(
      [configurable, cliOperations, memoryStewardship],
      'memory'
    )).toEqual([])
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

  it('uses an accessible switch without visible enabled-state copy', () => {
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
    const saving = renderToStaticMarkup(createElement(SkillCard, {
      skill: skillFixture(true),
      groups: [],
      operation: 'toggle',
      busy: null,
      onToggleEnabled: () => {},
      onToggleGroup: () => {},
      onDelete: () => {}
    }))

    expect(enabled).toContain('role="switch"')
    expect(enabled).toContain('aria-checked="true"')
    expect(enabled).toContain('aria-label="停用 skill-one"')
    expect(disabled).toContain('aria-label="启用 skill-one"')
    expect(enabled).not.toContain('已启用')
    expect(disabled).not.toContain('已停用')
    expect(saving).toContain('aria-label="正在保存 skill-one"')
    expect(saving).not.toContain('保存中…')
    expect(enabled).not.toContain('<b>')
    expect(enabled).not.toContain('status-badge')
    expect(disabled).not.toContain('status-badge')
    expect(enabled).toContain('aria-label="查看 skill-one 详情"')
    expect(enabled).not.toContain('<span>详情</span>')
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
    const mattThirdParty = {
      ...skillFixture(true),
      name: 'diagnosing-bugs',
      currentRevision: {
        ...skillFixture(true).currentRevision,
        name: 'diagnosing-bugs',
        sourceMetadata: {
          upstream: {
            repository: 'https://github.com/mattpocock/skills',
            revision: '84fdeffd12f2ee307994d1eb6feb48173b6e0502'
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
      badgeLabel: 'Rovai',
      sourceLabel: '随 Rovai 安装',
      repositoryUrl: null,
      revisionLabel: 'Revision r1'
    })
    expect(skillSourcePresentation(thirdParty)).toMatchObject({
      kind: 'third-party',
      badgeLabel: 'GitHub',
      repositoryUrl: 'https://github.com/DonkeyKing01/tasteful-ui-skill',
      repositoryLabel: 'DonkeyKing01/tasteful-ui-skill',
      revisionLabel: '159ccd47'
    })
    expect(skillSourcePresentation(mattThirdParty)).toMatchObject({
      kind: 'third-party',
      badgeLabel: 'GitHub',
      repositoryUrl: 'https://github.com/mattpocock/skills',
      repositoryLabel: 'mattpocock/skills',
      revisionLabel: '84fdeffd'
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

  it('keeps short source labels in the row and full provenance inside named details', () => {
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
    const imported = {
      ...skillFixture(true),
      origin: 'imported',
      currentRevision: {
        ...skillFixture(true).currentRevision,
        sourceType: 'local_folder',
        sourceMetadata: { source: { sourcePath: '/private/example' } }
      }
    } satisfies SkillView
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
    const detailsStart = thirdPartyMarkup.indexOf('<div class="skill-card-details"')
    const thirdPartyPrimary = thirdPartyMarkup.slice(0, detailsStart)
    const thirdPartyDetails = thirdPartyMarkup.slice(detailsStart)
    const importedDetailsStart = importedMarkup.indexOf('<div class="skill-card-details"')
    const importedPrimary = importedMarkup.slice(0, importedDetailsStart)
    const importedDetails = importedMarkup.slice(importedDetailsStart)

    expect(thirdPartyPrimary).toContain('>GitHub<')
    expect(thirdPartyPrimary).not.toContain('GitHub 三方')
    expect(thirdPartyPrimary).not.toContain('skill-card-provenance')
    expect(thirdPartyPrimary).not.toContain('DonkeyKing01/tasteful-ui-skill')
    expect(thirdPartyPrimary).not.toContain('159ccd47')
    expect(thirdPartyDetails).toContain('DonkeyKing01/tasteful-ui-skill')
    expect(thirdPartyDetails).toContain('159ccd47')
    expect(thirdPartyDetails).toContain('target="_blank"')
    expect(thirdPartyMarkup).toContain('aria-expanded="false"')
    expect(thirdPartyMarkup).toContain('随 Rovai 安装的固定上游副本')
    expect(thirdPartyMarkup).not.toContain('删除 Skill…')
    expect(importedPrimary).toContain('用户导入')
    expect(importedPrimary).not.toContain('本地文件夹导入')
    expect(importedPrimary).not.toContain('Revision r1')
    expect(importedDetails).toContain('本地文件夹导入')
    expect(importedDetails).toContain('删除 Skill…')
  })

  it('derives the identity color from the persistent Skill UUID across edits and revisions', () => {
    const skillId = '019ff120-6051-7c63-a88f-eff3ecc059fb'
    const original = {
      ...skillFixture(true),
      id: skillId,
      currentRevision: {
        ...skillFixture(true).currentRevision,
        skillId
      }
    } satisfies SkillView
    const edited = {
      ...original,
      name: 'renamed-skill',
      version: original.version + 1,
      currentRevision: {
        ...original.currentRevision,
        id: 'revision-2',
        revision: 2,
        name: 'renamed-skill',
        description: 'Edited without changing identity'
      }
    } satisfies SkillView
    const render = (skill: SkillView): string => renderToStaticMarkup(createElement(SkillCard, {
      skill,
      groups: [],
      operation: null,
      busy: null,
      onToggleEnabled: () => {},
      onToggleGroup: () => {},
      onDelete: () => {}
    }))
    const expectedStyle = `style="--skill-identity:${identityColorToken(skillId)}"`

    expect(render(original)).toContain(expectedStyle)
    expect(render(edited)).toContain(expectedStyle)
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
    managementPolicy: 'user_managed',
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
