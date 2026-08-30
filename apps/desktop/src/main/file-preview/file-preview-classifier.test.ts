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
})
