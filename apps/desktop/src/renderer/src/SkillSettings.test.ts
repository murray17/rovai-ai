import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SkillDeliveryGroupView, SkillView, StoredCommandResult } from '@contracts'
import {
  SkillListItem,
  SkillGroupChoices,
  SkillSettings,
  deleteSkillConfirmationCopy,
  formatBytes,
  groupAssignmentSummary,
  importActionLabel,
  patchSkillEnabledResult,
  projectionStateLabel,
  settingsVisibleSkills,
  skillDeliveryGroupsForDisplay,
  skillSourcePresentation,
  updateSkillConfirmationCopy
} from './SkillSettings'
import { identityColorToken } from './theme'

describe('Skill settings', () => {
  it('renders a loading-safe white workspace with enabled-state filters', () => {
    const markup = renderToStaticMarkup(createElement(SkillSettings))
    expect(markup).toContain('aria-label="Skills 列表"')
    expect(markup).toContain('正在读取 Skill Library')
    expect(markup).toContain('已启用')
    expect(markup).toContain('已停用')
    expect(markup).toContain('role="separator"')
    expect(markup).not.toContain('role="dialog"')
    expect(markup).not.toContain('配置源文件')
  })

  it('combines status and search without exposing system Skills', () => {
    const enabled = skillFixture(true),
      disabled = { ...skillFixture(false), id: 'disabled' }
    expect(settingsVisibleSkills([enabled, disabled], '', 'disabled')).toEqual([disabled])
    expect(settingsVisibleSkills([enabled, disabled], 'missing', 'enabled')).toEqual([])
    expect(settingsVisibleSkills(null, '', 'all')).toBeNull()
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

    expect(settingsVisibleSkills([configurable, cliOperations, memoryStewardship], '')).toEqual([
      configurable
    ])
    expect(
      settingsVisibleSkills([configurable, cliOperations, memoryStewardship], 'memory')
    ).toEqual([])
  })

  it('removes deleting Skills from the visible settings projection', () => {
    const deleting = {
      ...skillFixture(true),
      lifecycleStatus: 'deleting'
    } satisfies SkillView

    expect(settingsVisibleSkills([deleting], '')).toEqual([])
    expect(settingsVisibleSkills([deleting], 'skill-one')).toEqual([])
  })

  it('explains import and projection states without relying on color', () => {
    expect(importActionLabel('create')).toBe('新 Skill')
    expect(importActionLabel('update')).toContain('新 Revision')
    expect(importActionLabel('official_conflict')).toContain('不能覆盖')
    expect(projectionStateLabel('shadowed')).toContain('项目同名')
    expect(projectionStateLabel('stale')).toContain('下次运行')
    expect(projectionStateLabel('pending_removal')).toContain('释放')
  })

  it('keeps Skill deletion and update as separate confirmation contracts', () => {
    expect(deleteSkillConfirmationCopy('ui-audit')).toEqual({
      title: '删除导入的 Skill “ui-audit”？',
      description: '将停止新投递，并在现有执行释放后删除 Rovai 管理的内容。',
      confirmLabel: '确认删除 Skill'
    })
    expect(updateSkillConfirmationCopy('ui-audit')).toEqual({
      title: '更新现有 Skill “ui-audit”？',
      description:
        '将把已检查的内容保存为新的 Revision。现有生效组保持不变，已经开始的执行继续使用原版本。',
      confirmLabel: '更新 Skill'
    })
  })

  it('formats import sizes compactly and deterministically', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1_536)).toBe('1.5 KB')
    expect(formatBytes(2 * 1_024 * 1_024)).toBe('2.0 MB')
  })

  it('uses avatar group rows as the selection target and retains disabled Skill assignments', () => {
    const skill = { ...skillFixture(false), groupAssignments: [{ groupKey: 'codex' }] } as SkillView
    const groups = [
      {
        key: 'codex',
        label: 'Codex',
        members: [{ agentId: 'member-1', displayName: '沐瓦', avatarRef: null }]
      }
    ] as SkillDeliveryGroupView[]
    const markup = renderToStaticMarkup(
      createElement(SkillGroupChoices, { skill, groups, disabled: false, onChange: () => {} })
    )
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('class="member-avatar')
    expect(markup).toContain('沐瓦')
    expect(markup).not.toContain('type="checkbox"')
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
      badgeLabel: '本地导入',
      sourceLabel: '本地文件夹导入',
      repositoryUrl: null
    })
    expect(skillSourcePresentation(importedGithub)).toMatchObject({
      kind: 'imported',
      badgeLabel: 'GitHub',
      repositoryUrl: 'https://github.com/example/team-skill',
      repositoryLabel: 'example/team-skill',
      revisionLabel: 'abcdef12'
    })
  })

  it('keeps source and status beside the name without exposing source paths', () => {
    const imported = {
      ...skillFixture(true),
      origin: 'imported',
      currentRevision: {
        ...skillFixture(true).currentRevision,
        sourceType: 'local_folder',
        sourceMetadata: { source: { sourcePath: '/private/example' } }
      }
    } satisfies SkillView
    const markup = renderToStaticMarkup(
      createElement(SkillListItem, { skill: imported, selected: true, onSelect: () => {} })
    )
    expect(markup).toContain('>本地导入<')
    expect(markup).toContain('>已启用<')
    expect(markup).toContain('aria-current="true"')
    expect(markup).not.toContain('/private/example')
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
    const render = (skill: SkillView): string =>
      renderToStaticMarkup(
        createElement(SkillListItem, { skill, selected: false, onSelect: () => {} })
      )
    const expectedStyle = `style="--skill-identity:${identityColorToken(skillId)}"`

    expect(render(original)).toContain(expectedStyle)
    expect(render(edited)).toContain(expectedStyle)
  })

  it('summarizes the delivery scope without an ambiguous action label', () => {
    expect(groupAssignmentSummary(9, 9)).toBe('全部 9 组')
    expect(groupAssignmentSummary(6, 9)).toBe('6 / 9 组')
    expect(groupAssignmentSummary(0, 9)).toBe('未选择')
  })

  it('orders delivery groups like the Runtime catalog and keeps Pi at the end', () => {
    const group = (key: SkillDeliveryGroupView['key']): SkillDeliveryGroupView => ({
      key,
      label: key,
      relativePath: `.${key}/skills`,
      adapterKinds: [],
      verification: 'verified',
      members: []
    })
    const keys: SkillDeliveryGroupView['key'][] = [
      'pi',
      'antigravity',
      'grok',
      'kimi',
      'cursor',
      'trae',
      'qwen',
      'codebuddy',
      'qoder',
      'kiro',
      'opencode',
      'copilot',
      'codex',
      'claude_compatible'
    ]
    const groups = keys.map(group)

    expect(skillDeliveryGroupsForDisplay(groups).map(({ key }) => key)).toEqual([
      'claude_compatible',
      'codex',
      'copilot',
      'opencode',
      'kiro',
      'qoder',
      'codebuddy',
      'qwen',
      'trae',
      'cursor',
      'kimi',
      'grok',
      'antigravity',
      'pi'
    ])
    expect(groups[0]?.key).toBe('pi')
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
