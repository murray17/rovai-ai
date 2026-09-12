import { expect, it } from 'vitest'
import { FilePreviewFrameNavigation } from './file-preview-navigation'

it('permits normal navigation only in an admitted preview subtree and revokes it with its site', () => {
  let active = true
  const origin = 'http://preview.localhost:9000'
  const gate = new FilePreviewFrameNavigation(url => active && new URL(url).origin === origin)
  const main = { frameTreeNodeId:1,url:'http://localhost:5173',parent:null }
  const frame = { frameTreeNodeId:2,url:'about:blank',parent:main }
  const child = { frameTreeNodeId:3,url:'about:blank',parent:frame }
  const outsider = { frameTreeNodeId:4,url:'about:blank',parent:main }
  const frames = [main,frame,child,outsider]
  expect(gate.allows(origin+'/entry',frame,main,frames)).toBe(true)
  expect(gate.allows('https://example.test/page',child,main,frames)).toBe(true)
  expect(gate.allows('about:blank',child,main,frames)).toBe(true)
  for (const url of [main.url,'file:///tmp/test.html','javascript:alert(1)','rovai-preview://asset/x','about:config']) expect(gate.allows(url,child,main,frames)).toBe(false)
  expect(gate.allows('https://example.test',outsider,main,frames)).toBe(false)
  expect(gate.allows(origin,main,main,frames)).toBe(false)
  frame.url = 'https://example.test'
  expect(gate.allows('https://example.test/next',frame,main,frames)).toBe(true)
  active = false
  expect(gate.allows('https://example.test/next',frame,main,frames)).toBe(false)
})
