import { describe, expect, it } from 'vitest'
import type { NavigationSnapshot } from '@contracts'
import { navigationIncludingCurrentWorkspace, navigationWithProjectNames } from './new-conversation-preferences'
import { displayProjectPath, projectDirectoryName } from '../../shared/project-display-name'

describe('project display names', () => {
  it('changes only the display projection and preserves Core identity, Thread objects and activity order', () => {
    const thread = Object.freeze({ id: 'camp-1', projectPath: '/a/frontend', title: '会话', marker: 'loading' })
    const core = Object.freeze({ schemaVersion: 3, throughGlobalSequence: 42,
      quickChat: Object.freeze({ totalCount: 0, recentThreads: [] }),
      projects: Object.freeze(['/a/frontend', '/b/frontend'].map((projectPath) => Object.freeze({
        projectKey: `directory:${projectPath}`, projectPath, name: 'frontend', lastActivityAt: '2026-09-10T00:00:00Z',
        lastActivityGlobalSequence: 42, totalCount: 1, recentThreads: Object.freeze([thread])
      })))
    }) as unknown as NavigationSnapshot
    const display = navigationWithProjectNames(core, { 'directory:/a/frontend': '官网前端' })!
    expect(display.projects.map((project) => project.name)).toEqual(['官网前端', 'frontend'])
    expect(core.projects[0].name).toBe('frontend')
    expect(display.projects[0]).toEqual({ ...core.projects[0], name: '官网前端' })
    expect(display.projects[0].recentThreads).toBe(core.projects[0].recentThreads)
    expect(display.projects[1]).toBe(core.projects[1])
    expect(display.quickChat).toBe(core.quickChat)
    expect(display.throughGlobalSequence).toBe(42)
    expect(navigationWithProjectNames(core, {})).toBe(core)
  })

  it('applies saved names to a selected empty directory without creating a Thread', () => {
    const core: NavigationSnapshot = { schemaVersion: 3, throughGlobalSequence: 0, projects: [], quickChat: { totalCount: 0, recentThreads: [] } }
    const display = navigationWithProjectNames(navigationIncludingCurrentWorkspace(core,
      { kind: 'directory', projectPath: '/empty/frontend' }, { projectPath: '/empty/frontend', name: 'frontend' }
    ), { 'directory:/empty/frontend': '试验前端' })!
    expect(display.projects[0]).toMatchObject({ name: '试验前端', projectPath: '/empty/frontend', projectKey: 'directory:/empty/frontend', totalCount: 0, recentThreads: [] })
    expect(core.projects).toEqual([])
    expect(projectDirectoryName('C:\\work\\frontend')).toBe('frontend')
  })

  it('hides Windows device prefixes without changing the stored project identity', () => {
    const local = '\\\\?\\C:\\Users\\reiam\\Downloads\\temp'
    const network = '\\\\?\\UNC\\server\\share\\project'

    expect(displayProjectPath(local)).toBe('C:\\Users\\reiam\\Downloads\\temp')
    expect(displayProjectPath(network)).toBe('\\\\server\\share\\project')
    expect(displayProjectPath('/Users/reiam/project')).toBe('/Users/reiam/project')
    expect(projectDirectoryName(local)).toBe('temp')
    expect(local).toBe('\\\\?\\C:\\Users\\reiam\\Downloads\\temp')
  })
})
