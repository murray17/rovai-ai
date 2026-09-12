import { describe, expect, it } from 'vitest'
import { classifyFilePreview } from './file-preview-classifier'

describe('classifyFilePreview', () => {
  it('classifies supported source and image formats', () => {
    expect(classifyFilePreview('/repo/README.md', 10, Buffer.from('# Hi'))).toMatchObject({
      kind: 'markdown', mime: 'text/markdown'
    })
    expect(classifyFilePreview('/repo/src/app.tsx', 10, Buffer.from('export {}'))).toMatchObject({
      kind: 'code'
    })
    expect(classifyFilePreview('/repo/logo.png', 10, Buffer.from([0x89, 0x50]))).toMatchObject({
      kind: 'image', mime: 'image/png'
    })
  })

  it('falls back to paged text and the system application', () => {
    expect(classifyFilePreview('/repo/big.md', 5 * 1024 * 1024, Buffer.from('hello')).kind)
      .toBe('paged_text')
    expect(classifyFilePreview('/repo/report.pdf', 10, Buffer.from('%PDF')).kind).toBe('system')
    expect(classifyFilePreview('/repo/data.bin', 2, Buffer.from([0xff, 0xfe])).kind).toBe('system')
  })

  it('requires confirmation for executable file types', () => {
    expect(classifyFilePreview('/repo/install.exe', 10, Buffer.alloc(0)).openRisk).toBe('confirm')
    expect(classifyFilePreview('/repo/script.sh', 10, Buffer.from('#!/bin/sh')).openRisk).toBe('confirm')
  })

  it('uses a separate HTML document budget from whole-source rendering', () => {
    for (const path of ['/repo/index.html', '/repo/index.HTM']) {
      for (const size of [4 * 1024 * 1024 + 1, 32 * 1024 * 1024]) {
        expect(classifyFilePreview(path, size, Buffer.from('<h1>Preview</h1>')))
          .toMatchObject({ kind: 'html', mime: 'text/html' })
      }
      expect(classifyFilePreview(path, 32 * 1024 * 1024 + 1, Buffer.alloc(0)).kind)
        .toBe('paged_text')
    }
    for (const path of ['large.md', 'large.ts', 'large.txt']) {
      expect(classifyFilePreview(path, 4 * 1024 * 1024 + 1, Buffer.from('text')).kind)
        .toBe('paged_text')
    }
  })
})
