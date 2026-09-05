import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFilePreviewRequest } from '@contracts'
import { RootWatchRegistry } from './file-preview-watchers'
import {
  FilePreviewService,
  type FilePreviewNativeActions,
  type FilePreviewSourceAuthority
} from './file-preview-service'

vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>()
  return { ...os, homedir: vi.fn(os.homedir) }
})

class FakeWatcher extends EventEmitter {
  close = vi.fn()
}

let directories: string[] = []
let services: FilePreviewService[] = []

beforeEach(() => {
  directories = []
  services = []
})

afterEach(async () => {
  await Promise.all(services.map((service) => service.closeAll()))
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
      if (request.kind !== 'camp_workspace' && request.kind !== 'message_reference') return null
      return {
        kind: 'file_target',
        campId: request.campId,
        sourceKind: request.kind,
        sourceIdentity: request.kind === 'message_reference'
          ? `message:${request.messageId}`
          : `${request.campId}:${request.rawReference}`,
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
    publishExternalUpdate: vi.fn()
  }
  const registry = new RootWatchRegistry({
    notify: vi.fn(),
    watchFactory: () => new FakeWatcher() as never
  })
  const service = new FilePreviewService(authority, native, registry)
  services.push(service)
  await service.bindCamp(1, 'camp-1')
  return { root, authority, native, openPath, registry, service }
}

function request(rawReference: string): OpenFilePreviewRequest {
  return { kind: 'camp_workspace', campId: 'camp-1', rawReference }
}

describe('FilePreviewService', () => {
  it('repairs a prose colon only after verifying the file and keeps the original message authority', async () => {
    vi.useFakeTimers()
    try {
      const { root, service, authority, native } = await fixture()
      await mkdir(join(root, 'tests'))
      const path = join(root, 'tests', 'test_accrual_supporting_audit_script.py')
      await writeFile(path, 'assert True')
      const originalRequest: OpenFilePreviewRequest = {
        kind: 'message_reference', campId: 'camp-1', messageId: 'message-1',
        rawReference: 'tests/test_accrual_supporting_audit_script.py:'
      }
      const resolveSource = vi.spyOn(authority, 'resolve')
      const opened = await service.open(1, originalRequest)
      expect(opened).toMatchObject({ ok: true, value: { kind: 'file_preview', file: {
        fileName: 'test_accrual_supporting_audit_script.py', target: undefined
      } } })
      if (!opened.ok || opened.value.kind !== 'file_preview') return
      const file = opened.value.file
      vi.setSystemTime(Date.now() + 31 * 60 * 1_000)
      expect(await service.readText(1, { handleId: file.handleId, expectedGeneration: file.contentGeneration }))
        .toMatchObject({ ok: true, value: { text: 'assert True' } })
      expect(await service.revealInFolder(1, { handleId: file.handleId })).toEqual({ ok: true, value: { revealed: true } })
      expect(native.revealPath).toHaveBeenCalledWith(await realpath(path))
      await writeFile(path, 'assert 1 == 1')
      const reloaded = await service.reload(1, {
        handleId: file.handleId, reopenToken: file.reopenToken, expectedGeneration: file.contentGeneration
      })
      expect(reloaded).toMatchObject({ ok: true, value: { fileName: file.fileName } })
      expect(resolveSource.mock.calls.every(([input]) => input === originalRequest)).toBe(true)
      resolveSource.mockResolvedValueOnce(null)
      expect(await service.revealInFolder(1, { handleId: file.handleId })).toMatchObject({ ok: false })
      expect(native.revealPath).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    './missing.py:', './report.py::', './report.py:1:', './report.py:1:2:', './report.py:1-2:',
    './report.py:#L1', './report.py:#L1C2', './report.py:#L1-L2', './folder:', './javascript:payload:'
  ])('does not guess a different file for %s', async (rawReference) => {
    const { root, service, native, registry } = await fixture()
    await writeFile(join(root, 'report.py'), 'assert True')
    await mkdir(join(root, 'folder'))
    const opened = await service.open(1, request(rawReference))
    expect(opened).toMatchObject({ ok: false, error: { code: 'file_not_found' } })
    expect(service.handleCount).toBe(0)
    expect(registry.rootCount).toBe(0)
    expect(native.revealPath).not.toHaveBeenCalled()
    expect(native.openPath).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')('prefers an existing literal colon filename to a punctuation correction', async () => {
    const { root, service, native } = await fixture()
    await writeFile(join(root, 'notes.txt'), 'without colon')
    await writeFile(join(root, 'notes.txt:'), 'literal filename')
    const opened = await service.open(1, request('./notes.txt:'))
    expect(opened).toMatchObject({ ok: true, value: { kind: 'file_preview', file: { fileName: 'notes.txt:' } } })
    if (!opened.ok || opened.value.kind !== 'file_preview') return
    expect(await service.readText(1, {
      handleId: opened.value.file.handleId, expectedGeneration: opened.value.file.contentGeneration
    })).toMatchObject({ ok: true, value: { text: 'literal filename' } })
    expect(native.openPath).not.toHaveBeenCalled()
  })

  it('opens repaired references when they resolve to one concrete external file', async () => {
    const { root, service, native, registry } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'rovai-preview-colon-outside-'))
    directories.push(outside)
    const path = join(outside, 'notes.txt')
    await writeFile(path, 'outside')
    await symlink(path, join(root, 'link.txt'))
    for (const rawReference of [`${path}:`, './link.txt:']) {
      const opened = await service.open(1, request(rawReference))
      expect(opened).toMatchObject({ ok: true, value: { kind: 'file_preview', file: {
        displayPath: 'notes.txt', fileName: 'notes.txt'
      } } })
      if (!opened.ok || opened.value.kind !== 'file_preview') continue
      expect(await service.readText(1, {
        handleId: opened.value.file.handleId,
        expectedGeneration: opened.value.file.contentGeneration
      })).toMatchObject({ ok: true, value: { text: 'outside' } })
    }
    expect(service.handleCount).toBe(2)
    expect(registry.rootCount).toBe(1)
    expect(native.selectRoot).not.toHaveBeenCalled()
    expect(native.openPath).not.toHaveBeenCalled()
    expect(native.revealPath).not.toHaveBeenCalled()
  })

  it('reveals explicit outside directories without granting read access or launching app bundles', async () => {
    const { service, authority, registry, native } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'rovai-preview-directory-home-'))
    directories.push(outside)
    const downloads = join(outside, 'Downloads')
    const bundle = join(outside, 'Untrusted.app')
    await mkdir(downloads)
    await mkdir(bundle)
    await writeFile(join(downloads, 'private.txt'), 'not authorized by a directory reveal')
    vi.mocked(homedir).mockReturnValueOnce(outside)
    const resolveSource = vi.spyOn(authority, 'resolve')
    for (const rawReference of ['~/Downloads/', downloads, pathToFileURL(downloads).href, bundle]) {
      const input: OpenFilePreviewRequest = {
        kind: 'message_reference', campId: 'camp-1', messageId: 'message-1', rawReference
      }
      expect(await service.open(1, input)).toMatchObject({ ok: true, value: { kind: 'opened_in_system' } })
      expect(resolveSource).toHaveBeenLastCalledWith(input)
    }
    expect(native.revealPath).toHaveBeenCalledTimes(4)
    expect(native.revealPath).toHaveBeenCalledWith(await realpath(downloads))
    expect(native.openPath).not.toHaveBeenCalled()
    expect(native.selectRoot).not.toHaveBeenCalled()
    expect(service.handleCount).toBe(0)
    expect(registry.rootCount).toBe(0)
    expect(await service.open(1, request(join(downloads, 'private.txt'))))
      .toMatchObject({ ok: true, value: { kind: 'file_preview', file: { fileName: 'private.txt' } } })
    expect(native.selectRoot).not.toHaveBeenCalled()
    resolveSource.mockResolvedValueOnce(null)
    expect(await service.open(1, request(downloads))).toMatchObject({ ok: false, error: { code: 'source_not_authorized' } })
    expect(native.revealPath).toHaveBeenCalledTimes(4)
  })

  it('shows authorized directories in the file manager without a tab, watcher, or app launch', async () => {
    const { root, service, registry, native, openPath } = await fixture()
    await mkdir(join(root, 'reports'))
    await mkdir(join(root, 'Untrusted.app'))
    for (const path of [root, 'reports', 'Untrusted.app']) {
      expect(await service.open(1, request(path))).toMatchObject({ ok: true, value: { kind: 'opened_in_system' } })
    }
    expect(native.revealPath).toHaveBeenCalledTimes(3)
    expect(openPath).not.toHaveBeenCalled()
    expect(service.handleCount).toBe(0)
    expect(registry.rootCount).toBe(0)
    await service.closeAll()
  })

  it('does not reveal missing, escaped, or inactive-Camp directories', async () => {
    const { root, service, native } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'rovai-preview-directory-outside-'))
    directories.push(outside)
    await symlink(outside, join(root, 'outside'))
    expect(await service.open(1, request('missing'))).toMatchObject({ ok: false, error: { code: 'file_not_found' } })
    for (const path of ['outside', join(root, 'outside'), join(await realpath(root), 'outside')]) {
      expect(await service.open(1, request(path))).toMatchObject({ ok: false, error: { code: 'authorization_required' } })
    }
    await service.bindCamp(1, 'camp-2')
    expect(await service.open(1, request(root))).toMatchObject({ ok: false })
    expect(native.revealPath).not.toHaveBeenCalled()
    await service.closeAll()
  })

  it.each(['attachment', 'run_evidence'] as const)('does not reveal a directory from %s', async (kind) => {
    const { root, service, authority, native } = await fixture()
    vi.spyOn(authority, 'resolve').mockResolvedValue({
      kind: 'file_target', campId: 'camp-1', sourceKind: kind, sourceIdentity: 'source-1',
      rootPath: root, basePath: root, candidatePath: root, allowChildren: kind !== 'attachment'
    })
    const input: OpenFilePreviewRequest = kind === 'attachment'
      ? { kind, campId: 'camp-1', locator: { owner: 'message', campId: 'camp-1', messageId: 'message-1', attachmentRefId: 'attachment-1' } }
      : { kind, campId: 'camp-1', agentRunId: 'run-1', executionEpoch: 1, evidenceFileId: 'file-1', action: 'open_current' }
    expect(await service.open(1, input)).toMatchObject({ ok: false, error: { code: 'not_regular_file' } })
    expect(native.revealPath).not.toHaveBeenCalled()
  })

  it('keeps noninteractive preview children from opening a directory in the file manager', async () => {
    const { root, service, native } = await fixture()
    await writeFile(join(root, 'README.md'), '# Guide')
    await mkdir(join(root, 'reports'))
    const opened = await service.open(1, request('README.md'))
    expect(opened.ok).toBe(true)
    if (!opened.ok || opened.value.kind !== 'file_preview') return
    expect(await service.open(1, {
      kind: 'child_of_handle', parentHandleId: opened.value.file.handleId,
      rawReference: './reports', allowSystemOpen: false
    })).toMatchObject({ ok: false, error: { code: 'reference_not_clickable' } })
    expect(native.revealPath).not.toHaveBeenCalled()
    await service.closeAll()
  })

  it('opens and reads supported files through an opaque handle', async () => {
    const { root, service, registry } = await fixture()
    await writeFile(join(root, 'README.md'), '# Hello')
    const opened = await service.open(1, request('README.md'))
    expect(opened.ok).toBe(true)
    if (!opened.ok || opened.value.kind !== 'file_preview') return
    expect(opened.value.file).toMatchObject({
      displayPath: 'README.md',
      pathPresentation: 'project_relative',
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

  it('deduplicates the verified file across messages and locations without reusing source authority', async () => {
    const { root, service, authority, registry } = await fixture()
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'app.ts'), 'const value = 1')
    const resolveSource = vi.spyOn(authority, 'resolve')
    const firstRequest: OpenFilePreviewRequest = {
      kind: 'message_reference', campId: 'camp-1', messageId: 'message-1', rawReference: 'src/app.ts:1'
    }
    const secondRequest: OpenFilePreviewRequest = {
      kind: 'message_reference', campId: 'camp-1', messageId: 'message-2', rawReference: './src/app.ts:20'
    }
    try {
      const first = await service.open(1, firstRequest)
      const second = await service.open(1, secondRequest)
      expect(first).toMatchObject({ ok: true, value: { kind: 'file_preview' } })
      expect(second).toMatchObject({ ok: true, value: { kind: 'file_preview' } })
      if (!first.ok || first.value.kind !== 'file_preview' || !second.ok || second.value.kind !== 'file_preview') return
      const firstFile = first.value.file
      const secondFile = second.value.file
      expect(firstFile).toMatchObject({ displayPath: 'src/app.ts', pathPresentation: 'project_relative' })
      expect(secondFile.previewKey).toBe(firstFile.previewKey)
      expect(secondFile.handleId).not.toBe(firstFile.handleId)
      expect(secondFile.reopenToken).not.toBe(firstFile.reopenToken)
      expect(secondFile.target).toMatchObject({ line: 20 })
      expect(resolveSource).toHaveBeenNthCalledWith(1, firstRequest)
      expect(resolveSource).toHaveBeenNthCalledWith(2, secondRequest)
      await service.release(1, { handleId: secondFile.handleId })
      expect(service.handleCount).toBe(1)
      expect(registry.rootCount).toBe(1)
      expect(await service.readText(1, { handleId: firstFile.handleId, expectedGeneration: firstFile.contentGeneration }))
        .toMatchObject({ ok: true, value: { text: 'const value = 1' } })
      resolveSource.mockResolvedValueOnce(null)
      expect((await service.open(1, secondRequest)).ok).toBe(false)
      expect(resolveSource).toHaveBeenCalledTimes(3)
      expect(service.handleCount).toBe(1)
    } finally {
      await service.closeAll()
    }
  })

  it('keeps different files, windows and Camps distinct while preserving identity after a disk update', async () => {
    const { root, service } = await fixture()
    await mkdir(join(root, 'first'))
    await mkdir(join(root, 'second'))
    await writeFile(join(root, 'first', 'app.ts'), 'first')
    await writeFile(join(root, 'second', 'app.ts'), 'second')
    const openKey = async (windowId: number, campId: string, rawReference: string): Promise<string> => {
      const opened = await service.open(windowId, { kind: 'camp_workspace', campId, rawReference })
      if (!opened.ok || opened.value.kind !== 'file_preview') throw new Error('Expected a preview')
      return opened.value.file.previewKey
    }
    try {
      const original = await openKey(1, 'camp-1', 'first/app.ts')
      expect(await openKey(1, 'camp-1', 'second/app.ts')).not.toBe(original)
      await writeFile(join(root, 'first', 'app.ts'), 'updated first file')
      expect(await openKey(1, 'camp-1', './first/app.ts:20')).toBe(original)
      await service.bindCamp(2, 'camp-1')
      expect(await openKey(2, 'camp-1', 'first/app.ts')).not.toBe(original)
      await service.bindCamp(1, 'camp-2')
      expect(await openKey(1, 'camp-2', 'first/app.ts')).not.toBe(original)
    } finally {
      await service.closeAll()
    }
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

  it('routes an unsupported external file to the system without creating a preview handle or root grant', async () => {
    const { service, native, openPath, registry } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'rovai-file-preview-system-'))
    directories.push(outside)
    const report = join(outside, 'report.pdf')
    await writeFile(report, '%PDF-1.7')
    const opened = await service.open(1, request(report))
    expect(opened).toEqual({
      ok: true,
      value: { kind: 'opened_in_system', fileName: 'report.pdf' }
    })
    expect(basename(openPath.mock.calls[0]?.[0] as string)).toBe('report.pdf')
    expect(native.selectRoot).not.toHaveBeenCalled()
    expect(service.handleCount).toBe(0)
    expect(registry.rootCount).toBe(0)
  })

  it('restores only previewable files without native actions or authorization prompts', async () => {
    const { root, service, native, openPath } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'rovai-file-preview-restore-outside-'))
    directories.push(outside)
    await writeFile(join(root, 'README.md'), '# Restored')
    await writeFile(join(root, 'installer.exe'), new Uint8Array([0, 1, 2]))
    await mkdir(join(root, 'reports'))
    await symlink(outside, join(root, 'external-directory'))

    expect(await service.restore(1, request('README.md'))).toMatchObject({
      ok: true,
      value: { kind: 'file_preview', file: { fileName: 'README.md' } }
    })
    expect(await service.restore(1, request('installer.exe'))).toMatchObject({
      ok: false,
      error: { code: 'reference_not_clickable' }
    })
    expect(await service.restore(1, request('reports'))).toMatchObject({
      ok: false,
      error: { code: 'reference_not_clickable' }
    })
    const outsideResult = await service.restore(1, request('external-directory'))
    expect(outsideResult).toMatchObject({
      ok: false,
      error: { code: 'outside_authorized_root' }
    })
    if (!outsideResult.ok) expect(outsideResult.error.authorizationChallenge).toBeUndefined()

    expect(native.confirmOpen).not.toHaveBeenCalled()
    expect(native.revealPath).not.toHaveBeenCalled()
    expect(native.selectRoot).not.toHaveBeenCalled()
    expect(openPath).not.toHaveBeenCalled()
    expect(service.handleCount).toBe(1)
  })

  it('rejects a late Camp result even after switching back to the same Camp id', async () => {
    const { root, service, authority, native } = await fixture()
    await writeFile(join(root, 'notes.txt'), 'notes')
    type AuthorityResult = Awaited<ReturnType<FilePreviewSourceAuthority['resolve']>>
    let completeAuthority!: (result: AuthorityResult) => void
    const delayedAuthority = new Promise<AuthorityResult>((resolveResult) => {
      completeAuthority = resolveResult
    })
    const resolveSource = vi.spyOn(authority, 'resolve').mockReturnValueOnce(delayedAuthority)

    const opening = service.open(1, request('notes.txt'))
    await vi.waitFor(() => expect(resolveSource).toHaveBeenCalledOnce())
    await service.bindCamp(1, 'camp-2')
    await service.bindCamp(1, 'camp-1')
    completeAuthority({
      kind: 'file_target',
      campId: 'camp-1',
      sourceKind: 'camp_workspace',
      sourceIdentity: 'camp-1:notes.txt',
      rootPath: root,
      basePath: root,
      rawReference: 'notes.txt',
      allowChildren: true
    })

    expect(await opening).toMatchObject({ ok: false, error: { code: 'read_failed' } })
    expect(service.handleCount).toBe(0)
    expect(native.revealPath).not.toHaveBeenCalled()
    expect(native.openPath).not.toHaveBeenCalled()
  })

  it('rechecks the Camp generation after native confirmation before opening', async () => {
    const { root, service, native, openPath } = await fixture()
    await writeFile(join(root, 'installer.exe'), new Uint8Array([0, 1, 2]))
    let completeConfirmation!: (confirmed: boolean) => void
    vi.mocked(native.confirmOpen).mockReturnValueOnce(new Promise<boolean>((resolveConfirmation) => {
      completeConfirmation = resolveConfirmation
    }))

    const opening = service.open(1, request('installer.exe'))
    await vi.waitFor(() => expect(native.confirmOpen).toHaveBeenCalledOnce())
    await service.bindCamp(1, 'camp-2')
    await service.bindCamp(1, 'camp-1')
    completeConfirmation(true)

    expect(await opening).toMatchObject({ ok: false, error: { code: 'open_failed' } })
    expect(openPath).not.toHaveBeenCalled()
    expect(service.handleCount).toBe(0)
  })

  it('opens absolute, Home-relative, and file-URI references to one external file without choosing a root', async () => {
    const { service, native, registry } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'rovai-file-preview-outside-'))
    directories.push(outside)
    const outsideFile = join(outside, 'notes.txt')
    await writeFile(outsideFile, 'notes')
    vi.mocked(homedir).mockReturnValue(outside)
    const requests: OpenFilePreviewRequest[] = [
      request(outsideFile),
      { kind: 'message_reference', campId: 'camp-1', messageId: 'message-file-uri', rawReference: pathToFileURL(outsideFile).href },
      { kind: 'message_reference', campId: 'camp-1', messageId: 'message-home', rawReference: '~/notes.txt' }
    ]

    for (const input of requests) {
      const opened = await service.open(1, input)
      expect(opened).toMatchObject({ ok: true, value: { kind: 'file_preview', file: {
        displayPath: 'notes.txt', pathPresentation: 'file_name_only', fileName: 'notes.txt', kind: 'text'
      } } })
      if (!opened.ok || opened.value.kind !== 'file_preview') continue
      expect(await service.readText(1, {
        handleId: opened.value.file.handleId,
        expectedGeneration: opened.value.file.contentGeneration
      })).toMatchObject({ ok: true, value: { text: 'notes' } })
    }

    expect(service.handleCount).toBe(3)
    expect(registry.rootCount).toBe(1)
    expect(native.selectRoot).not.toHaveBeenCalled()
  })

  it.each(['attachment', 'run_evidence'] as const)('opens an exact external file resolved by %s authority', async (kind) => {
    const { root, service, authority, native } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), `rovai-file-preview-${kind}-`))
    directories.push(outside)
    const outsideFile = join(outside, 'notes.txt')
    await writeFile(outsideFile, kind)
    vi.spyOn(authority, 'resolve').mockResolvedValue({
      kind: 'file_target', campId: 'camp-1', sourceKind: kind, sourceIdentity: `${kind}-source`,
      rootPath: root, basePath: root, candidatePath: outsideFile, allowChildren: kind !== 'attachment'
    })
    const input: OpenFilePreviewRequest = kind === 'attachment'
      ? { kind, campId: 'camp-1', locator: { owner: 'message', campId: 'camp-1', messageId: 'message-1', attachmentRefId: 'attachment-1' } }
      : { kind, campId: 'camp-1', agentRunId: 'run-1', executionEpoch: 1, evidenceFileId: 'file-1', action: 'open_current' }

    const opened = await service.open(1, input)
    expect(opened).toMatchObject({ ok: true, value: { kind: 'file_preview', file: {
      displayPath: 'notes.txt', pathPresentation: 'file_name_only', fileName: 'notes.txt'
    } } })
    if (!opened.ok || opened.value.kind !== 'file_preview') return
    expect(await service.readText(1, {
      handleId: opened.value.file.handleId,
      expectedGeneration: opened.value.file.contentGeneration
    })).toMatchObject({ ok: true, value: { text: kind } })
    expect(native.selectRoot).not.toHaveBeenCalled()
  })

  it('keeps root grants for an explicit external directory operation', async () => {
    const { root, service, native } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'rovai-file-preview-grant-'))
    directories.push(outside)
    await symlink(outside, join(root, 'external-directory'))
    vi.mocked(native.selectRoot).mockResolvedValue(outside)
    const opened = await service.open(1, request('external-directory'))
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
    expect(granted.value.result.kind).toBe('opened_in_system')
    expect(native.revealPath).toHaveBeenCalledWith(await realpath(outside))
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

  it('preserves an exact external-file capability across descriptor recovery, reload, and system actions', async () => {
    vi.useFakeTimers()
    try {
      const { service, native, openPath } = await fixture()
      const outside = await mkdtemp(join(tmpdir(), 'rovai-file-preview-reopen-outside-'))
      directories.push(outside)
      const path = join(outside, 'notes.txt')
      await writeFile(path, 'first')
      const opened = await service.open(1, request(path))
      expect(opened).toMatchObject({ ok: true, value: { kind: 'file_preview' } })
      if (!opened.ok || opened.value.kind !== 'file_preview') return

      vi.setSystemTime(Date.now() + 31 * 60 * 1_000)
      expect(await service.readText(1, {
        handleId: opened.value.file.handleId,
        expectedGeneration: opened.value.file.contentGeneration
      })).toMatchObject({ ok: true, value: { text: 'first' } })
      expect(await service.openInSystem(1, { handleId: opened.value.file.handleId }))
        .toEqual({ ok: true, value: { opened: true } })
      expect(openPath).toHaveBeenCalledWith(await realpath(path))

      await writeFile(path, 'second version')
      const reloaded = await service.reload(1, {
        handleId: opened.value.file.handleId,
        reopenToken: opened.value.file.reopenToken,
        expectedGeneration: opened.value.file.contentGeneration
      })
      expect(reloaded).toMatchObject({ ok: true, value: {
        displayPath: 'notes.txt', pathPresentation: 'file_name_only'
      } })
      if (!reloaded.ok) return
      expect(await service.readText(1, {
        handleId: reloaded.value.handleId,
        expectedGeneration: reloaded.value.contentGeneration
      })).toMatchObject({ ok: true, value: { text: 'second version' } })
      expect(await service.revealInFolder(1, { handleId: reloaded.value.handleId }))
        .toEqual({ ok: true, value: { revealed: true } })
      expect(native.revealPath).toHaveBeenCalledWith(await realpath(path))
      expect(native.selectRoot).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
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
          sourceIdentity: input.locator.attachmentRefId,
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
      kind: 'attachment', campId: 'camp-1',
      locator: { owner: 'message', campId: 'camp-1', messageId: 'message-1', attachmentRefId: 'attachment-1' }
    })
    expect(opened.ok && opened.value.kind === 'file_preview'
      ? opened.value.file
      : { fileName: basename(file) }).toMatchObject({
      displayPath: 'Design Notes.md',
      pathPresentation: 'file_name_only',
      fileName: 'Design Notes.md'
    })
    await service.closeAll()
  })

  it('restores a project child independently after its parent is deleted and the Camp changes', async () => {
    const { root, service, authority } = await fixture()
    const docs = join(root, 'docs')
    await mkdir(docs)
    const parentPath = join(docs, 'README.md')
    await writeFile(parentPath, '[设计说明](./design.md)')
    await writeFile(join(docs, 'design.md'), '# Design')
    const resolveSource = vi.spyOn(authority, 'resolve')
    const parent = await service.open(1, request('docs/README.md'))
    expect(parent).toMatchObject({ ok: true, value: { kind: 'file_preview' } })
    if (!parent.ok || parent.value.kind !== 'file_preview') return

    const child = await service.open(1, {
      kind: 'child_of_handle',
      parentHandleId: parent.value.file.handleId,
      rawReference: './design.md',
      allowSystemOpen: true
    })
    expect(child).toMatchObject({ ok: true, value: { kind: 'file_preview', file: {
      restoreRequest: { kind: 'camp_workspace', campId: 'camp-1', rawReference: 'docs/design.md' }
    } } })
    if (!child.ok || child.value.kind !== 'file_preview' || !child.value.file.restoreRequest) {
      throw new Error('Expected an independently restorable child')
    }
    expect(resolveSource).toHaveBeenCalledWith({
      kind: 'camp_workspace', campId: 'camp-1', rawReference: '.'
    })

    await service.release(1, { handleId: parent.value.file.handleId })
    await rm(parentPath)
    await service.bindCamp(1, 'camp-2')
    await service.bindCamp(1, 'camp-1')
    const restored = await service.restore(1, child.value.file.restoreRequest)
    expect(restored).toMatchObject({ ok: true, value: { kind: 'file_preview', file: {
      displayPath: 'docs/design.md', pathPresentation: 'project_relative', fileName: 'design.md'
    } } })
    if (!restored.ok || restored.value.kind !== 'file_preview') return
    expect(await service.readText(1, {
      handleId: restored.value.file.handleId,
      expectedGeneration: restored.value.file.contentGeneration
    })).toMatchObject({ ok: true, value: { text: '# Design' } })

    await rm(join(docs, 'design.md'))
    await service.bindCamp(1, 'camp-2')
    await service.bindCamp(1, 'camp-1')
    expect(await service.restore(1, child.value.file.restoreRequest)).toMatchObject({
      ok: false,
      error: { code: 'file_not_found' }
    })
  })

  it('gives each link in a project child chain its own workspace restore source', async () => {
    const { root, service } = await fixture()
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'A.md'), '[B](docs/B.md)')
    await writeFile(join(root, 'docs', 'B.md'), '[C](C.md)')
    await writeFile(join(root, 'docs', 'C.md'), '# C')
    const parent = await service.open(1, request('A.md'))
    if (!parent.ok || parent.value.kind !== 'file_preview') throw new Error('Expected A preview')
    const child = await service.open(1, {
      kind: 'child_of_handle', parentHandleId: parent.value.file.handleId,
      rawReference: 'docs/B.md', allowSystemOpen: true
    })
    if (!child.ok || child.value.kind !== 'file_preview') throw new Error('Expected B preview')
    const grandchild = await service.open(1, {
      kind: 'child_of_handle', parentHandleId: child.value.file.handleId,
      rawReference: 'C.md', allowSystemOpen: true
    })
    if (!grandchild.ok || grandchild.value.kind !== 'file_preview') throw new Error('Expected C preview')

    expect(child.value.file.restoreRequest).toEqual({
      kind: 'camp_workspace', campId: 'camp-1', rawReference: 'docs/B.md'
    })
    expect(grandchild.value.file.restoreRequest).toEqual({
      kind: 'camp_workspace', campId: 'camp-1', rawReference: 'docs/C.md'
    })
  })

  it('encodes a project child restore reference without changing its file identity', async () => {
    const { root, service } = await fixture()
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'docs', 'README.md'), '[Draft](./design%20%28draft%29%231.md)')
    await writeFile(join(root, 'docs', 'design (draft)#1.md'), '# Draft')
    const parent = await service.open(1, request('docs/README.md'))
    if (!parent.ok || parent.value.kind !== 'file_preview') throw new Error('Expected parent preview')
    const child = await service.open(1, {
      kind: 'child_of_handle', parentHandleId: parent.value.file.handleId,
      rawReference: './design%20%28draft%29%231.md', allowSystemOpen: true
    })
    if (!child.ok || child.value.kind !== 'file_preview' || !child.value.file.restoreRequest) {
      throw new Error('Expected an independently restorable child')
    }

    expect(child.value.file.restoreRequest).toEqual({
      kind: 'camp_workspace',
      campId: 'camp-1',
      rawReference: 'docs/design%20%28draft%29%231.md'
    })
    await service.bindCamp(1, 'camp-2')
    await service.bindCamp(1, 'camp-1')
    expect(await service.restore(1, child.value.file.restoreRequest)).toMatchObject({
      ok: true,
      value: { kind: 'file_preview', file: { displayPath: 'docs/design (draft)#1.md' } }
    })
  })

  it('rechecks the Camp generation after resolving a child workspace restore source', async () => {
    const { root, service, authority } = await fixture()
    await writeFile(join(root, 'README.md'), '[Notes](notes.md)')
    await writeFile(join(root, 'notes.md'), 'notes')
    const parent = await service.open(1, request('README.md'))
    if (!parent.ok || parent.value.kind !== 'file_preview') throw new Error('Expected parent preview')
    type AuthorityResult = Awaited<ReturnType<FilePreviewSourceAuthority['resolve']>>
    let completeAuthority!: (result: AuthorityResult) => void
    const delayedAuthority = new Promise<AuthorityResult>((resolveResult) => {
      completeAuthority = resolveResult
    })
    const resolveSource = vi.spyOn(authority, 'resolve').mockReturnValueOnce(delayedAuthority)

    const opening = service.open(1, {
      kind: 'child_of_handle', parentHandleId: parent.value.file.handleId,
      rawReference: 'notes.md', allowSystemOpen: true
    })
    await vi.waitFor(() => expect(resolveSource).toHaveBeenCalledWith({
      kind: 'camp_workspace', campId: 'camp-1', rawReference: '.'
    }))
    await service.bindCamp(1, 'camp-2')
    await service.bindCamp(1, 'camp-1')
    completeAuthority({
      kind: 'file_target', campId: 'camp-1', sourceKind: 'camp_workspace',
      sourceIdentity: 'camp:camp-1', rootPath: root, basePath: root,
      rawReference: '.', allowChildren: true
    })

    expect(await opening).toMatchObject({ ok: false, error: { code: 'read_failed' } })
    expect(service.handleCount).toBe(0)
  })

  it('opens a Markdown relative link next to an external parent without a root grant', async () => {
    const { service, native } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'rovai-file-preview-markdown-outside-'))
    directories.push(outside)
    await mkdir(join(outside, 'guides'))
    await writeFile(join(outside, 'README.md'), '[设计说明](guides/design.md)')
    await writeFile(join(outside, 'guides', 'design.md'), '# Design')
    const parent = await service.open(1, request(join(outside, 'README.md')))
    expect(parent).toMatchObject({ ok: true, value: { kind: 'file_preview' } })
    if (!parent.ok || parent.value.kind !== 'file_preview') return

    const child = await service.open(1, {
      kind: 'child_of_handle',
      parentHandleId: parent.value.file.handleId,
      rawReference: 'guides/design.md',
      allowSystemOpen: true
    })
    expect(child).toMatchObject({ ok: true, value: { kind: 'file_preview', file: {
      displayPath: 'design.md', pathPresentation: 'file_name_only', fileName: 'design.md'
    } } })
    if (!child.ok || child.value.kind !== 'file_preview') return
    expect(child.value.file).not.toHaveProperty('restoreRequest')
    expect(await service.readText(1, {
      handleId: child.value.file.handleId,
      expectedGeneration: child.value.file.contentGeneration
    })).toMatchObject({ ok: true, value: { text: '# Design' } })
    expect(native.selectRoot).not.toHaveBeenCalled()
  })

  it('derives an external HTML tab resource scope from its own directory and releases it with the tab', async () => {
    const { root, service, native } = await fixture()
    const outside = await mkdtemp(join(tmpdir(), 'rovai-file-preview-html-outside-'))
    directories.push(outside)
    const pages = join(outside, 'pages')
    await mkdir(join(pages, 'assets'), { recursive: true })
    await mkdir(join(pages, 'images'), { recursive: true })
    await writeFile(join(pages, 'index.html'), '<link rel="stylesheet" href="./assets/site.css"><a href="details.html">Details</a>')
    await writeFile(join(pages, 'details.html'), '<h1>Details</h1>')
    await writeFile(join(pages, 'assets', 'site.css'), 'body{background:url(../images/bg.png)}')
    await writeFile(join(pages, 'images', 'bg.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    await writeFile(join(root, 'not-in-html-scope.css'), 'body{color:red}')

    const opened = await service.open(1, request(join(pages, 'index.html')))
    expect(opened.ok).toBe(true)
    if (!opened.ok || opened.value.kind !== 'file_preview') return
    const prepared = await service.prepareHtml(1, {
      handleId: opened.value.file.handleId,
      expectedGeneration: opened.value.file.contentGeneration
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.value).toMatchObject({
      html: '<link rel="stylesheet" href="./assets/site.css"><a href="details.html">Details</a>',
      assetBasePath: ''
    })
    const assetUrl = `rovai-preview://asset/${prepared.value.tabToken}/assets/site.css`
    expect(service.authorizeHtmlAsset(2, 'GET', assetUrl)).toBe(false)
    expect(service.authorizeHtmlAsset(1, 'POST', assetUrl)).toBe(false)
    expect(service.authorizeHtmlAsset(1, 'GET', assetUrl)).toBe(true)
    const response = await service.serveHtmlAsset(new Request(assetUrl))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toContain(
      `rovai-preview://asset/${prepared.value.tabToken}/images/bg.png`
    )
    expect((await service.serveHtmlAsset(new Request(
      `rovai-preview://asset/${prepared.value.tabToken}/not-in-html-scope.css`
    ))).status).toBe(404)

    const child = await service.open(1, {
      kind: 'child_of_handle', parentHandleId: opened.value.file.handleId,
      rawReference: 'details.html', allowSystemOpen: true
    })
    expect(child).toMatchObject({ ok: true, value: { kind: 'file_preview', file: {
      displayPath: 'details.html', pathPresentation: 'file_name_only', fileName: 'details.html'
    } } })
    expect(native.selectRoot).not.toHaveBeenCalled()
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

})
