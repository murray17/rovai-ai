import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { BusyLabel } from './BusyLabel'

it.each([false, true])('keeps the accessible label and hides the spinner from assistive technology (busy: %s)', busy => {
  const markup = renderToStaticMarkup(createElement(BusyLabel, { busy, children: '保存' }))
  expect(markup.includes('data-busy')).toBe(busy)
  if (busy) expect(markup).toContain('data-busy="true"')
  expect(markup).toContain('<span class="busy-label-content">保存</span>')
  expect(markup).toContain('<span class="busy-label-spinner" aria-hidden="true"><svg')
  expect(markup.replace(/<[^>]+>/g, '')).toBe('保存')
})
