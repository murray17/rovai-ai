import { nativeImage, type NativeImage } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareDingTalkAvatarPng } from './dingtalk-avatar'

vi.mock('electron', () => ({ nativeImage: { createFromBuffer: vi.fn() } }))
beforeEach(() => { vi.mocked(nativeImage.createFromBuffer).mockReset() })

describe('DingTalk upload avatar rendition', () => {
  it.each([192, 239])('upscales a %ipx icon to 240px without changing the original bytes', (edge) => {
    const f = fixture(edge)
    const original = f.source.slice()

    const result = prepareDingTalkAvatarPng(f.source)

    expect(result).toEqual(png(240))
    expect(f.image.resize).toHaveBeenCalledExactlyOnceWith({ width: 240, height: 240, quality: 'best' })
    expect(f.resized.toPNG).toHaveBeenCalledOnce()
    expect(f.source).toEqual(original)
    const decodedBytes = vi.mocked(nativeImage.createFromBuffer).mock.calls[0]![0]
    expect(decodedBytes.buffer).not.toBe(f.source.buffer)
    expect(new Uint8Array(decodedBytes)).toEqual(original)
  })

  it.each([240, 512, 2048])('preserves an already compliant %ipx PNG without resizing or re-encoding', (edge) => {
    const f = fixture(edge)

    expect(prepareDingTalkAvatarPng(f.source)).toBe(f.source)
    expect(f.image.resize).not.toHaveBeenCalled()
    expect(f.resized.toPNG).not.toHaveBeenCalled()
  })

  it.each([
    ['empty', new Uint8Array()],
    ['not PNG', new Uint8Array([1, 2, 3])],
    ['truncated PNG', png(192).subarray(0, 24)],
    ['zero dimensions', png(0)],
    ['non-square', png(192, 240)],
    ['excessive decoded dimensions', png(2049)],
    ['oversized file', new Uint8Array(2 * 1024 * 1024 + 1)]
  ])('rejects %s before native decoding', (_name, bytes) => {
    expect(prepareDingTalkAvatarPng(bytes as Uint8Array)).toBeNull()
    expect(nativeImage.createFromBuffer).not.toHaveBeenCalled()
  })

  it('rejects a structurally valid PNG that the native decoder cannot decode', () => {
    const f = fixture()
    f.image.isEmpty.mockReturnValue(true)

    expect(prepareDingTalkAvatarPng(f.source)).toBeNull()
    expect(f.image.resize).not.toHaveBeenCalled()
  })

  it('rejects a decoded size that differs from the PNG header', () => {
    const f = fixture()
    f.image.getSize.mockReturnValue({ width: 96, height: 96 })

    expect(prepareDingTalkAvatarPng(f.source)).toBeNull()
    expect(f.image.resize).not.toHaveBeenCalled()
  })

  it('rejects an empty resize result', () => {
    const f = fixture()
    f.resized.isEmpty.mockReturnValue(true)

    expect(prepareDingTalkAvatarPng(f.source)).toBeNull()
    expect(f.resized.toPNG).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid encoding', new Uint8Array([1, 2, 3])],
    ['wrong dimensions', png(192)],
    ['non-square', png(240, 192)],
    ['oversized encoding', new Uint8Array(2 * 1024 * 1024 + 1)]
  ])('rejects a resize result with %s', (_name, output) => {
    const f = fixture()
    f.resized.toPNG.mockReturnValue(Buffer.from(output as Uint8Array))

    expect(prepareDingTalkAvatarPng(f.source)).toBeNull()
  })

  it.each(['decode', 'resize', 'encode'] as const)('does not expose %s errors or fall back to the original undersized icon', (stage) => {
    const f = fixture()
    const fail = (): never => { throw new Error('private codec diagnostic') }
    if (stage === 'decode') vi.mocked(nativeImage.createFromBuffer).mockImplementation(fail)
    if (stage === 'resize') f.image.resize.mockImplementation(fail)
    if (stage === 'encode') f.resized.toPNG.mockImplementation(fail)

    expect(prepareDingTalkAvatarPng(f.source)).toBeNull()
  })
})

function fixture(edge = 192) {
  const source = png(edge)
  const resized = {
    isEmpty: vi.fn(() => false),
    toPNG: vi.fn(() => Buffer.from(png(240)))
  }
  const image = {
    isEmpty: vi.fn(() => false),
    getSize: vi.fn(() => ({ width: edge, height: edge })),
    resize: vi.fn(() => resized)
  }
  vi.mocked(nativeImage.createFromBuffer).mockReturnValue(image as unknown as NativeImage)
  return { source, image, resized }
}

// Headers only: these unit tests stub the native codec, not PNG pixel decoding.
function png(width: number, height = width): Uint8Array {
  const bytes = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 0, 0, 0, 0, 0,
    8, 6, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0
  ])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}
