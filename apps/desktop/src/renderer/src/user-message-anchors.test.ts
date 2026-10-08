import { expect, it } from 'vitest'
import { userAnchorStackHeight } from './user-message-anchors'

it('bounds 240 individual anchors by the available stage height, on complete rows', () => {
  expect(userAnchorStackHeight(240, 900)).toBe(360)
  expect(userAnchorStackHeight(240, 500)).toBe(350)
  expect(userAnchorStackHeight(240, 301)).toBe(210)
  expect(userAnchorStackHeight(4, 900)).toBe(40)
  expect(userAnchorStackHeight(240, 10)).toBe(0)
})
