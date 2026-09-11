import { describe, expect, it } from 'vitest'
import type { NavigationSnapshot } from '@contracts'
import { navigationIncludingCurrentWorkspace, navigationWithProjectNames } from './new-conversation-preferences'
import { projectDirectoryName } from '../../shared/project-display-name'

describe('project display names', () => {
  it('changes only the display projection and preserves Core identity, Camp objects and activity order', () => {
    const camp = Object.freeze({ id: 'camp-1', projectPath: '/a/frontend', title: '会话', marker: 'loading' })
    const core = Object.freeze({ schemaVersion: 3, throughGlobalSequence: 42,
      quickChat: Object.freeze({ totalCount: 0, recentCamps: [] }),
      projects: Object.freeze(['/a/frontend', '/b/frontend'].map((projectPath) => Object.freeze({
        projectKey: `directory:${projectPath}`, projectPath, name: 'frontend', lastActivityAt: '2026-09-10T00:00:00Z',
        lastActivityGlobalSequence: 42, totalCount: 1, recentCamps: Object.freeze([camp])
      })))
    }) as unknown as NavigationSnapshot
    const display = navigationWithProjectNames(core, { 'directory:/a/frontend': '官网前端' })!
    expect(display.projects.map((project) => project.name)).toEqual(['官网前端', 'frontend'])
    expect(core.projects[0].name).toBe('frontend')
    expect(display.projects[0]).toEqual({ ...core.projects[0], name: '官网前端' })
    expect(display.projects[0].recentCamps).toBe(core.projects[0].recentCamps)
    expect(display.projects[1]).toBe(core.projects[1])
    expect(display.quickChat).toBe(core.quickChat)
    expect(display.throughGlobalSequence).toBe(42)
    expect(navigationWithProjectNames(core, {})).toBe(core)
  })

  it('applies saved names to a selected empty directory without creating a Camp', () => {
    const core: NavigationSnapshot = { schemaVersion: 3, throughGlobalSequence: 0, projects: [], quickChat: { totalCount: 0, recentCamps: [] } }
    const display = navigationWithProjectNames(navigationIncludingCurrentWorkspace(core,
      { kind: 'directory', projectPath: '/empty/frontend' }, { projectPath: '/empty/frontend', name: 'frontend' }
    ), { 'directory:/empty/frontend': '试验前端' })!
    expect(display.projects[0]).toMatchObject({ name: '试验前端', projectPath: '/empty/frontend', projectKey: 'directory:/empty/frontend', totalCount: 0, recentCamps: [] })
    expect(core.projects).toEqual([])
    expect(projectDirectoryName('C:\\work\\frontend')).toBe('frontend')
  })
})
