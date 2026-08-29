import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFilePreviewRequest } from '@contracts'
import { RootWatchRegistry } from './file-preview-watchers'
import {
  FilePreviewService,
  type FilePreviewNativeActions,
  type FilePreviewSourceAuthority
} from './file-preview-service'

class FakeWatcher extends EventEmitter {
  close = vi.fn()
}

let directories: string[] = []

beforeEach(() => {
  directories = []
})

afterEach(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixture(): Promise<{
  root: string
  authority: FilePreviewSourceAuthority
  native: FilePreviewNativeActions
  openPath: ReturnType<typeof vi.fn>
  registry: RootWatchRegistry
  service: FilePreviewService
}> {
  const root = await mkdtemp(join(tmpdir(), 'rovai-file-preview-'))
  directories.push(root)
  const authority: FilePreviewSourceAuthority = {
    async resolve(request) {
      if (request.kind !== 'camp_workspace') return null
      return {
        kind: 'file_target',
        campId: request.campId,
        sourceKind: request.kind,
        sourceIdentity: `${request.campId}:${request.rawReference}`,
        rootPath: root,
        basePath: root,
        rawReference: request.rawReference,
        allowChildren: true
      }
    }
  }
  const openPath = vi.fn(async () => '')
  const native: FilePreviewNativeActions = {
    selectRoot: vi.fn(async () => null),
    confirmOpen: vi.fn(async () => true),
    openPath,
    revealPath: vi.fn(),
    copyText: vi.fn(),
    publishExternalUpdate: vi.fn(),
    attachSelection: vi.fn(async () => ({
      campId: 'camp-1',
      body: '',
      content: [],
      revision: 1,
      attachments: [],
      replyIntent: null,
      continuationIntent: null,
      updatedAt: null,
      expiresAt: null
    }))
  }
  const registry = new RootWatchRegistry({
    notify: vi.fn(),
    watchFactory: () => new FakeWatcher() as never
  })
  const service = new FilePreviewService(authority, native, registry)
  await service.bindCamp(1, 'camp-1')
  return { root, authority, native, openPath, registry, service }
}

function request(rawReference: string): OpenFilePreviewRequest {
  return { kind: 'camp_workspace', campId: 'camp-1', rawReference }
}

describe('FilePreviewService', () => {
  it('opens and reads supported files through an opaque handle', async () => {
    const { root, service, registry } = await fixture()
    await writeFile(join(root, 'README.md'), '# Hello')
    const opened = await service.open(1, request('README.md'))
    expect(opened.ok).toBe(true)
    if (!opened.ok || opened.value.kind !== 'file_preview') return
    expect(opened.value.file).toMatchObject({
      displayPath: 'README.md',
      fileName: 'README.md',
      kind: 'markdown'
    })
    expect(opened.value.file).not.toHaveProperty('canonicalPath')
    expect(registry.rootCount).toBe(1)
    const content = await service.readText(1, {
      handleId: opened.value.file.handleId,
      expectedGeneration: opened.value.file.contentGeneration
    })
    expect(content).toMatchObject({ ok: true, value: { text: '# Hello' } })
    await service.release(1, { handleId: opened.value.file.handleId })
    expect(registry.rootCount).toBe(0)
  })

  it('silently reopens an expired file descriptor while keeping the tab watcher alive', async () => {
    vi.useFakeTimers()
    try {
      const { root, service, registry } = await fixture()
      await writeFile(join(root, 'README.md'), '# Hello')
      const opened = await service.open(1, request('README.md'))
      expect(opened.ok).toBe(true)
      if (!opened.ok || opened.value.kind !== 'file_preview') return

      vi.setSystemTime(Date.now() + 31 * 60 * 1_000)
      const content = await service.readText(1, {
        handleId: opened.value.file.handleId,
        expectedGeneration: opened.value.file.contentGeneration
      })

      expect(content).toMatchObject({ ok: true, value: { text: '# Hello' } })
      expect(registry.rootCount).toBe(1)
      expect(service.handleCount).toBe(1)
      await service.closeAll()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not read a newer file version while recovering an expired descriptor', async () => {
    vi.useFakeTimers()
    try {
      const { root, service } = await fixture()
      const file = join(root, 'notes.txt')
      await writeFile(file, 'old')
      const opened = await service.open(1, request('notes.txt'))
      expect(opened.ok).toBe(true)
      if (!opened.ok || opened.value.kind !== 'file_preview') return

      await writeFile(file, 'new version')
      vi.setSystemTime(Date.now() + 31 * 60 * 1_000)
      const staleRead = await service.readText(1, {
        handleId: opened.value.file.handleId,
        expectedGeneration: opened.value.file.contentGeneration
      })
      expect(staleRead).toMatchObject({
        ok: false,
        error: { code: 'read_failed', message: '文件已有更新，请重新加载。' }
      })

      const reloaded = await service.reload(1, {
        handleId: opened.value.file.handleId,
        reopenToken: opened.value.file.reopenToken,
        expectedGeneration: opened.value.file.contentGeneration
      })
      expect(reloaded.ok).toBe(true)
      if (!reloaded.ok) return
      const current = await service.readText(1, {
        handleId: reloaded.value.handleId,
        expectedGeneration: reloaded.value.contentGeneration
      })
      expect(current).toMatchObject({ ok: true, value: { text: 'new version' } })
      await service.closeAll()
    } finally {
      vi.useRealTimers()
    }
  })

  it('routes unsupported files to the system without creating a preview handle', async () => {
    const { root, service, openPath, registry } = await fixture()
    await writeFile(join(root, 'report.pdf'), '%PDF-1.7')
    const opened = await service.open(1, request('report.pdf'))
    expect(opened).toEqual({
      ok: true,
      value: { kind: 'opened_in_system', fileName: 'report.pdf' }
    })
    expect(basename(openPath.mock.calls[0]?.[0] as string)).toBe('report.pdf')
    expect(service.handleCount).toBe(0)
    expect(registry.rootCount).toBe(0)
  })

  it('does not authorize an absolute path outside the root without user consent', async () => {
    const { root, service } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'rovai-file-preview-outside-'))
    directories.push(outside)
    const outsideFile = join(outside, 'notes.txt')
    await writeFile(outsideFile, 'notes')
    const opened = await service.open(1, request(outsideFile))
    expect(opened.ok).toBe(false)
    if (opened.ok) return
    expect(opened.error.code).toBe('authorization_required')
    expect(opened.error.authorizationChallenge?.displayReference).toBe(outsideFile)
    expect(opened.error.message).not.toContain(root)
  })

  it('returns only a safe root label after the user authorizes an outside directory', async () => {
    const { service, native } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'rovai-file-preview-grant-'))
    directories.push(outside)
    const outsideFile = join(outside, 'notes.txt')
    await writeFile(outsideFile, 'notes')
    vi.mocked(native.selectRoot).mockResolvedValue(outside)
    const opened = await service.open(1, request(outsideFile))
    expect(opened.ok).toBe(false)
    if (opened.ok || !opened.error.authorizationChallenge) return

    const granted = await service.chooseAuthorizedRoot(1, {
      campId: 'camp-1',
      pendingOpenId: opened.error.authorizationChallenge.pendingOpenId
    })
    expect(granted.ok).toBe(true)
    if (!granted.ok || !granted.value) return
    expect(granted.value.displayName).toBe(basename(outside))
    expect(granted.value.displayName).not.toContain(outside)
    expect(granted.value.result.kind).toBe('file_preview')
    await service.closeAll()
  })

  it('revalidates the file before a system action', async () => {
    const { root, service, openPath } = await fixture()
    const file = join(root, 'notes.txt')
    await writeFile(file, 'notes')
    const opened = await service.open(1, request('notes.txt'))
    expect(opened.ok).toBe(true)
    if (!opened.ok || opened.value.kind !== 'file_preview') return
    await rm(file)

    const system = await service.openInSystem(1, { handleId: opened.value.file.handleId })
    expect(system.ok).toBe(false)
    expect(openPath).not.toHaveBeenCalled()
    await service.closeAll()
  })

  it('releases all handles when the active Camp changes', async () => {
    const { root, service, registry } = await fixture()
    await writeFile(join(root, 'one.txt'), 'one')
    await writeFile(join(root, 'two.txt'), 'two')
    await service.open(1, request('one.txt'))
    await service.open(1, request('two.txt'))
    expect(service.handleCount).toBe(2)
    expect(registry.rootCount).toBe(1)
    await service.bindCamp(1, 'camp-2')
    expect(service.handleCount).toBe(0)
    expect(registry.rootCount).toBe(0)
  })

  it('keeps the authority-provided attachment display name', async () => {
    const { root, native, registry } = await fixture()
    const file = join(root, 'payload.md')
    await writeFile(file, 'attachment')
    const authority: FilePreviewSourceAuthority = {
      async resolve(input) {
        if (input.kind !== 'attachment') return null
        return {
          kind: 'file_target',
          campId: input.campId,
          sourceKind: input.kind,
          sourceIdentity: input.attachmentId,
          rootPath: root,
          basePath: root,
          candidatePath: file,
          displayName: 'Design Notes.md',
          allowChildren: false
        }
      }
    }
    const service = new FilePreviewService(authority, native, registry)
    await service.bindCamp(1, 'camp-1')
    const opened = await service.open(1, {
      kind: 'attachment', campId: 'camp-1', attachmentId: 'attachment-1'
    })
    expect(opened.ok && opened.value.kind === 'file_preview'
      ? opened.value.file.fileName
      : basename(file)).toBe('Design Notes.md')
    await service.closeAll()
  })

  it('serves HTML assets only through a live window-bound token', async () => {
    const { root, service } = await fixture()
    await mkdir(join(root, 'pages', 'assets'), { recursive: true })
    await mkdir(join(root, 'pages', 'images'), { recursive: true })
    await writeFile(join(root, 'pages', 'index.html'), '<link rel="stylesheet" href="./assets/site.css">')
    await writeFile(join(root, 'pages', 'assets', 'site.css'), 'body{background:url(../images/bg.png)}')
    await writeFile(join(root, 'pages', 'images', 'bg.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]))

    const opened = await service.open(1, request('pages/index.html'))
    expect(opened.ok).toBe(true)
    if (!opened.ok || opened.value.kind !== 'file_preview') return
    const prepared = await service.prepareHtml(1, {
      handleId: opened.value.file.handleId,
      expectedGeneration: opened.value.file.contentGeneration
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.value).toMatchObject({
      html: '<link rel="stylesheet" href="./assets/site.css">',
      assetBasePath: 'pages'
    })
    const assetUrl = `rovai-preview://asset/${prepared.value.tabToken}/pages/assets/site.css`
    expect(service.authorizeHtmlAsset(2, 'GET', assetUrl)).toBe(false)
    expect(service.authorizeHtmlAsset(1, 'POST', assetUrl)).toBe(false)
    expect(service.authorizeHtmlAsset(1, 'GET', assetUrl)).toBe(true)
    const response = await service.serveHtmlAsset(new Request(assetUrl))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toContain(
      `rovai-preview://asset/${prepared.value.tabToken}/pages/images/bg.png`
    )
    await service.release(1, { handleId: opened.value.file.handleId })
    expect(service.authorizeHtmlAsset(1, 'GET', assetUrl)).toBe(false)
  })

  it('does not let an untrusted HTML bridge open unsupported child files', async () => {
    const { root, service, openPath } = await fixture()
    await writeFile(join(root, 'index.html'), '<a href="report.pdf">report</a>')
    await writeFile(join(root, 'report.pdf'), '%PDF-1.7')
    const parent = await service.open(1, request('index.html'))
    expect(parent.ok).toBe(true)
    if (!parent.ok || parent.value.kind !== 'file_preview') return
    const denied = await service.open(1, {
      kind: 'child_of_handle',
      parentHandleId: parent.value.file.handleId,
      rawReference: 'report.pdf',
      allowSystemOpen: false
    })
    expect(denied).toMatchObject({ ok: false, error: { code: 'reference_not_clickable' } })
    expect(openPath).not.toHaveBeenCalled()
  })

  it('freezes a verified text selection without persisting handle authority', async () => {
    const { root, service, native } = await fixture()
    await writeFile(join(root, 'notes.txt'), 'first line\nsecond line\n')
    const opened = await service.open(1, request('notes.txt'))
    expect(opened.ok).toBe(true)
    if (!opened.ok || opened.value.kind !== 'file_preview') return
    const attached = await service.attachSelection(1, {
      campId: 'camp-1',
      expectedDraftRevision: 0,
      handleId: opened.value.file.handleId,
      expectedGeneration: opened.value.file.contentGeneration,
      selectedText: 'second',
      startLine: 2,
      startColumn: 1,
      endLine: 2,
      endColumn: 7,
      attachMode: 'verified_current'
    })
    expect(attached.ok).toBe(true)
    const snapshot = vi.mocked(native.attachSelection).mock.calls[0]?.[2]
    expect(snapshot).toMatchObject({
      displayPath: 'notes.txt',
      selectedText: 'second',
      verification: 'current_file',
      positionEncoding: 'utf-16',
      rangeEnd: 'exclusive'
    })
    expect(snapshot).not.toHaveProperty('handleId')
    expect(snapshot).not.toHaveProperty('contentGeneration')
    expect(snapshot?.sourceIdentityDigest).toMatch(/^sha256:[a-f0-9]{64}$/u)
  })

  it('verifies multiline UTF-16 selection text against the current file', async () => {
    const { root, service, native } = await fixture()
    await writeFile(join(root, 'unicode.txt'), 'first\n😀second\n')
    const opened = await service.open(1, request('unicode.txt'))
    expect(opened.ok).toBe(true)
    if (!opened.ok || opened.value.kind !== 'file_preview') return
    const base = {
      campId: 'camp-1',
      expectedDraftRevision: 0,
      handleId: opened.value.file.handleId,
      expectedGeneration: opened.value.file.contentGeneration,
      startLine: 1,
      startColumn: 1,
      endLine: 2,
      endColumn: 3,
      attachMode: 'verified_current' as const
    }
    const attached = await service.attachSelection(1, {
      ...base,
      selectedText: 'first\n😀'
    })
    expect(attached.ok).toBe(true)
    expect(vi.mocked(native.attachSelection).mock.calls[0]?.[2].selectedText).toBe('first\n😀')

    const forged = await service.attachSelection(1, {
      ...base,
      selectedText: 'first\n伪造'
    })
    expect(forged).toMatchObject({
      ok: false,
      error: { code: 'read_failed', message: '选区内容与当前文件不一致，请重新选择。' }
    })
    await service.closeAll()
  })

  it('requires an explicit visible-snapshot action after the file changes', async () => {
    const { root, service, native } = await fixture()
    const file = join(root, 'notes.txt')
    await writeFile(file, 'old')
    const opened = await service.open(1, request('notes.txt'))
    expect(opened.ok).toBe(true)
    if (!opened.ok || opened.value.kind !== 'file_preview') return
    await writeFile(file, 'new version with a different size')
    const base = {
      campId: 'camp-1',
      expectedDraftRevision: 0,
      handleId: opened.value.file.handleId,
      expectedGeneration: opened.value.file.contentGeneration,
      selectedText: 'old',
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 4
    }
    const verified = await service.attachSelection(1, {
      ...base,
      attachMode: 'verified_current'
    })
    expect(verified).toMatchObject({ ok: false, error: { code: 'read_failed' } })
    const snapshot = await service.attachSelection(1, {
      ...base,
      attachMode: 'visible_snapshot'
    })
    expect(snapshot.ok).toBe(true)
    expect(vi.mocked(native.attachSelection).mock.calls[0]?.[2].verification)
      .toBe('viewer_snapshot_after_change')
  })
})
