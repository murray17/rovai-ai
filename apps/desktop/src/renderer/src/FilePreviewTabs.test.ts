import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useFilePreview,
  type FilePreviewContextValue,
  type FilePreviewOpenFeedback,
  type FilePreviewTabModel
} from './FilePreviewContext'
import { FilePreviewTabs } from './FilePreviewTabs'

vi.mock('./FilePreviewContext', () => ({ useFilePreview: vi.fn() }))

function tab(id: string): FilePreviewTabModel {
  return {
    id,
    file: {
      previewKey: id,
      handleId: `handle-${id}`,
      reopenToken: `reopen-${id}`,
      displayPath: `src/${id}.ts`,
      fileName: `${id}.ts`,
      size: 10,
      mime: 'text/plain',
      extension: '.ts',
      kind: 'code',
      hasExternalUpdate: false,
      contentVersion: { size: 10, mtimeMs: 1 },
      contentGeneration: 'generation-1',
      capabilities: ['read']
    },
    loadState: 'ready',
    content: { kind: 'code', text: 'const a = 1' },
    error: null,
    hasExternalUpdate: false,
    externalUpdateVersion: 0,
    isRefreshing: false,
    refreshError: null,
    pageOffsets: [],
    pageIndex: 0
  }
}

function renderTabs(openFeedback: FilePreviewOpenFeedback | null = null): string {
  vi.mocked(useFilePreview).mockReturnValue({ ...preview, openFeedback })
  return renderToStaticMarkup(createElement(FilePreviewTabs))
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
    returnTarget: null,
    open: vi.fn(),
    setReturnTarget: vi.fn(),
    returnToTarget: vi.fn(),
    showPane: vi.fn(),
    hidePane: vi.fn(),
    activate: vi.fn(),
    move: vi.fn(),
    close: vi.fn(),
    closeMany: vi.fn(),
    openInSystem: vi.fn(),
    revealInFolder: vi.fn(),
    copyDisplayPath: vi.fn(),
    reload: vi.fn(),
    retry: vi.fn(),
    changePage: vi.fn()
  }
})

describe('FilePreviewTabs open feedback', () => {
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
    preview.tabs[1].hasExternalUpdate = true
    preview.tabs[1].isRefreshing = true
    const markup = renderTabs()
    expect(markup).toContain('aria-label="second.ts，有更新"')
    expect(markup).not.toContain('file-preview-tab-open-feedback')
    expect(markup).not.toContain('is-arriving')
  })
})
