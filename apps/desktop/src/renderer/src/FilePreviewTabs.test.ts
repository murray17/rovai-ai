import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useFilePreview,
  type FilePreviewContextValue,
  type FilePreviewOpenFeedback,
  type FilePreviewTabModel
} from './FilePreviewContext'
import { FilePreviewPane } from './FilePreviewPane'
import { FilePreviewTabs } from './FilePreviewTabs'

vi.mock('./FilePreviewContext', () => ({ useFilePreview: vi.fn() }))

function tab(id: string): FilePreviewTabModel {
  const file = {
    previewKey: id,
    handleId: `handle-${id}`,
    reopenToken: `reopen-${id}`,
    displayPath: `src/${id}.ts`,
    pathPresentation: 'project_relative' as const,
    fileName: `${id}.ts`,
    size: 10,
    mime: 'text/plain',
    extension: '.ts',
    kind: 'code' as const,
    hasExternalUpdate: false,
    contentVersion: { size: 10, mtimeMs: 1 },
    contentGeneration: 'generation-1',
    capabilities: ['read' as const]
  }
  return {
    kind: 'file',
    id,
    sourceKey: `workspace:camp-1:src/${id}.ts`,
    sourceRequest: { kind: 'camp_workspace', campId: 'camp-1', rawReference: `src/${id}.ts` },
    previewKey: id,
    presentation: {
      fileName: file.fileName,
      displayPath: file.displayPath,
      pathPresentation: file.pathPresentation
    },
    file,
    loadState: 'ready',
    content: { kind: 'code', text: 'const a = 1' },
    error: null,
    requestGeneration: 1,
    hasExternalUpdate: false,
    externalUpdateVersion: 0,
    isRefreshing: false,
    refreshError: null,
    pageOffsets: [],
    pageIndex: 0
  }
}

function updateFile(
  target: FilePreviewTabModel,
  update: Partial<NonNullable<FilePreviewTabModel['file']>>
): void {
  if (!target.file) throw new Error('Expected an open file')
  target.file = { ...target.file, ...update }
  target.previewKey = target.file.previewKey
  target.presentation = {
    fileName: target.file.fileName,
    displayPath: target.file.displayPath,
    pathPresentation: target.file.pathPresentation
  }
}

function renderTabs(openFeedback: FilePreviewOpenFeedback | null = null): string {
  vi.mocked(useFilePreview).mockReturnValue({ ...preview, openFeedback })
  return renderToStaticMarkup(createElement(FilePreviewTabs))
}

function renderPane(): string {
  vi.mocked(useFilePreview).mockReturnValue(preview)
  return renderToStaticMarkup(createElement(FilePreviewPane))
}

let preview: FilePreviewContextValue

beforeEach(() => {
  const tabs = [tab('first'), tab('second')]
  preview = {
    tabs,
    activeTab: tabs[1],
    activeTabId: 'second',
    openFeedback: null,
    paneVisible: true,
    resolvedTheme: 'day',
    open: vi.fn(),
    openFileChanges: vi.fn(),
    selectChangedFile: vi.fn(),
    showPane: vi.fn(),
    hidePane: vi.fn(),
    activate: vi.fn(),
    move: vi.fn(),
    close: vi.fn(),
    closeMany: vi.fn(),
    openInSystem: vi.fn(),
    revealInFolder: vi.fn(),
    copyPath: vi.fn(),
    reload: vi.fn(),
    reopen: vi.fn(),
    retry: vi.fn(),
    changePage: vi.fn()
  }
})

describe('FilePreviewTabs open feedback', () => {
  it('does not announce a lazy background tab as actively opening', () => {
    const cold = tab('background')
    cold.file = null
    cold.previewKey = null
    cold.loadState = 'cold'
    cold.content = null
    preview.tabs = [cold]
    preview.activeTab = cold
    preview.activeTabId = cold.id

    const markup = renderTabs()

    expect(markup).toContain('aria-label="background.ts"')
    expect(markup).not.toContain('background.ts，正在打开')
  })

  it('uses the shared filename visual instead of the preview classifier kind', () => {
    const config = tab('config')
    updateFile(config, {
      fileName: 'config.toml',
      displayPath: 'config.toml',
      extension: '.toml',
      kind: 'text'
    })
    preview.tabs = [config]
    preview.activeTab = config
    preview.activeTabId = config.id

    const markup = renderTabs()

    expect(markup).toContain('data-resource-type="config"')
    expect(markup).not.toContain('data-resource-type="text"')
  })

  it('distinguishes a historical review from the same current file without changing accessible tab names', () => {
    const currentFile = tab('readme')
    updateFile(currentFile, { kind: 'markdown', fileName: 'readme.md', displayPath: 'docs/readme.md' })
    const review = {
      kind: 'file_change' as const, id: 'review-1', campId: 'camp-1', selectedEvidenceFileId: 'evidence-1',
      changes: {
        schemaVersion: 2 as const, agentRunId: 'run-1', executionEpoch: 1,
        fileCount: 1, operationCount: 1, completedAt: '2026-08-30T08:00:00Z',
        files: [{ evidenceFileId: 'evidence-1', path: 'docs/readme.md', changeKind: 'update' as const, presentationKind: 'full_net_diff' as const, operationCount: 1 }]
      }
    }
    preview.tabs = [currentFile, review]
    preview.activeTab = review
    preview.activeTabId = review.id
    const markup = renderTabs()
    expect(markup).toContain('aria-label="readme.md"')
    expect(markup).toContain('aria-label="File Change·readme.md"')
    expect(markup).toContain('aria-label="关闭 File Change·readme.md"')
    expect(markup).toContain('data-file-type="markdown" viewBox="0 0 24 24" aria-hidden="true"')
    expect(markup).toContain('data-file-type="file_change" viewBox="0 0 24 24" aria-hidden="true"')
    expect(markup).not.toContain('File Change·docs/readme.md')
  })

  it('preserves selected state, keyboard activation and named close controls', () => {
    const markup = renderTabs()
    expect(markup).toContain('aria-label="first.ts" aria-selected="false" aria-controls="file-preview-panel-first" tabindex="-1"')
    expect(markup).toContain('aria-label="second.ts" aria-selected="true" aria-controls="file-preview-panel-second" tabindex="0"')
    expect(markup).toContain('aria-label="关闭 first.ts"')
    expect(markup).toContain('aria-label="关闭 second.ts"')
  })

  it('marks only the newly opened tab for arrival and one decorative feedback layer', () => {
    const markup = renderTabs({ tabId: 'second', sequence: 2, isNew: true })
    expect(markup.match(/is-arriving/g)).toHaveLength(1)
    expect(markup).toContain('class="file-preview-tab is-active is-arriving"')
    expect(markup.match(/class="file-preview-tab-open-feedback"/g)).toHaveLength(1)
    expect(markup).toContain('data-open-sequence="2" aria-hidden="true"')
  })

  it('gives a repeated open a new feedback identity without an arrival or duplicate tab', () => {
    const markup = renderTabs({ tabId: 'second', sequence: 3, isNew: false })
    expect(markup).not.toContain('is-arriving')
    expect(markup).toContain('data-open-sequence="3"')
    expect(markup.match(/role="tab"/g)).toHaveLength(2)
    expect(markup.match(/class="file-preview-tab-open-feedback"/g)).toHaveLength(1)
  })

  it('does not create opening feedback from selection, file updates or refreshing alone', () => {
    const file = preview.tabs[1] as FilePreviewTabModel
    file.hasExternalUpdate = true
    file.isRefreshing = true
    const markup = renderTabs()
    expect(markup).toContain('aria-label="second.ts，有更新"')
    expect(markup).not.toContain('file-preview-tab-open-feedback')
    expect(markup).not.toContain('is-arriving')
  })

  it('uses safe ordinals when same-name files have no parent path to disclose', () => {
    const first = tab('external-first')
    const second = tab('external-second')
    updateFile(first, { fileName: 'hui.html', displayPath: 'hui.html', pathPresentation: 'file_name_only' })
    updateFile(second, { fileName: 'hui.html', displayPath: 'hui.html', pathPresentation: 'file_name_only' })
    preview.tabs = [first, second]
    preview.activeTab = second
    preview.activeTabId = second.id

    const markup = renderTabs()

    expect(markup).toContain('aria-label="hui.html · 1"')
    expect(markup).toContain('aria-label="hui.html · 2"')
    expect(markup).toContain('title="hui.html · 1"')
    expect(markup).toContain('title="hui.html · 2"')
  })

  it('keeps parent-qualified labels for same-name project files', () => {
    const docs = tab('docs')
    const prototypes = tab('prototypes')
    updateFile(docs, { fileName: 'hui.html', displayPath: 'docs/hui.html' })
    updateFile(prototypes, { fileName: 'hui.html', displayPath: 'prototypes/hui.html' })
    preview.tabs = [docs, prototypes]
    preview.activeTab = prototypes
    preview.activeTabId = prototypes.id

    const markup = renderTabs()

    expect(markup).toContain('aria-label="docs/hui.html"')
    expect(markup).toContain('aria-label="prototypes/hui.html"')
  })

  it('uses the shortest unique directory suffix for same-name external files', () => {
    const desktop = tab('desktop-report')
    const downloads = tab('downloads-report')
    updateFile(desktop, {
      fileName: 'report.html',
      displayPath: '~/Desktop/report.html',
      pathPresentation: 'external'
    })
    updateFile(downloads, {
      fileName: 'report.html',
      displayPath: '~/Downloads/report.html',
      pathPresentation: 'external'
    })
    preview.tabs = [desktop, downloads]
    preview.activeTab = downloads
    preview.activeTabId = downloads.id

    const markup = renderTabs()

    expect(markup).toContain('aria-label="Desktop/report.html"')
    expect(markup).toContain('aria-label="Downloads/report.html"')
    expect(markup).toContain('title="~/Desktop/report.html"')
    expect(markup).toContain('title="~/Downloads/report.html"')
  })

  it('adds more parent segments until repeated directory suffixes are unique', () => {
    const personal = tab('personal-report')
    const archive = tab('archive-report')
    updateFile(personal, {
      fileName: 'report.html',
      displayPath: '/Users/murray/Desktop/output/report.html',
      pathPresentation: 'external'
    })
    updateFile(archive, {
      fileName: 'report.html',
      displayPath: '/Volumes/archive/Desktop/output/report.html',
      pathPresentation: 'external'
    })
    preview.tabs = [personal, archive]
    preview.activeTab = archive
    preview.activeTabId = archive.id

    const markup = renderTabs()

    expect(markup).toContain('aria-label="murray/Desktop/output/report.html"')
    expect(markup).toContain('aria-label="archive/Desktop/output/report.html"')
  })
})

describe('FilePreviewPane path presentation', () => {
  it('shows a path row for a nested project file', () => {
    const projectFile = tab('project-file')
    updateFile(projectFile, {
      fileName: 'hui.html',
      displayPath: 'docs/prototypes/hui.html',
      kind: 'html'
    })
    preview.tabs = [projectFile]
    preview.activeTab = projectFile
    preview.activeTabId = projectFile.id

    const markup = renderPane()

    expect(markup).toContain('class="file-preview-path-row"')
    expect(markup).toContain('aria-label="在文件夹中显示 docs/prototypes/hui.html"')
    expect(markup).toContain('role="tooltip">docs/prototypes/hui.html</span>')
  })

  it.each([
    ['a project-root file', 'README.md', 'project_relative' as const],
    ['an external file', '~/Desktop/report.html', 'external' as const]
  ])('shows the path row for %s', (_label, displayPath, pathPresentation) => {
    const file = tab('path-visible')
    updateFile(file, { fileName: displayPath.split('/').at(-1)!, displayPath, pathPresentation })
    preview.tabs = [file]
    preview.activeTab = file
    preview.activeTabId = file.id

    const markup = renderPane()

    expect(markup).toContain('class="file-preview-path-row"')
    expect(markup).toContain(`title="${displayPath}"`)
  })

  it('keeps attachment storage paths out of the path row', () => {
    const file = tab('attachment')
    updateFile(file, { fileName: 'report.html', displayPath: 'report.html', pathPresentation: 'file_name_only' })
    preview.tabs = [file]
    preview.activeTab = file
    preview.activeTabId = file.id

    const markup = renderPane()

    expect(markup).not.toContain('file-preview-path-row')
    expect(markup).not.toContain('file-preview-update-row')
  })

  it('keeps reload available in a transient update row when the path is hidden', () => {
    const external = tab('updated-external')
    updateFile(external, {
      fileName: 'hui.html',
      displayPath: 'hui.html',
      pathPresentation: 'file_name_only'
    })
    external.hasExternalUpdate = true
    preview.tabs = [external]
    preview.activeTab = external
    preview.activeTabId = external.id

    const markup = renderPane()

    expect(markup).not.toContain('file-preview-path-row')
    expect(markup).toContain('class="file-preview-update-row"')
    expect(markup).toContain('>有更新</button>')
  })
})

describe('FilePreviewPane recovery state', () => {
  it('shows only the generic file outline and one-line missing copy in the content area', () => {
    const missing = tab('missing-report')
    missing.file = null
    missing.loadState = 'missing'
    missing.content = null
    missing.error = {
      code: 'file_not_found',
      message: '找不到这个文件',
      retryable: false
    }
    preview.tabs = [missing]
    preview.activeTab = missing
    preview.activeTabId = missing.id

    const paneMarkup = renderPane()
    const tabsMarkup = renderTabs()

    expect(paneMarkup).toContain('class="file-preview-recovery" role="status" aria-live="polite"')
    expect(paneMarkup).toContain('class="file-preview-recovery-icon" data-resource-type="file"')
    expect(paneMarkup).toContain('<p>找不到这个文件</p>')
    expect(paneMarkup.match(/找不到这个文件/gu)).toHaveLength(1)
    expect(paneMarkup).not.toContain('<strong>')
    expect(paneMarkup).not.toContain('>重试</button>')
    expect(paneMarkup).not.toContain('file-preview-path-row')
    expect(tabsMarkup).toContain('aria-label="missing-report.ts，找不到文件"')
    expect(tabsMarkup).not.toContain('file-preview-tab-error')
  })
})
