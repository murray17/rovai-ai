import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PendingInputEditorActions } from './PendingCampInputs'

describe('PendingInputEditorActions', () => {
  it('offers only cancel and save while a queued message is being edited', () => {
    const markup = renderToStaticMarkup(createElement(PendingInputEditorActions, {
      busy: false,
      saveDisabled: false,
      onCancel: () => undefined,
      onSave: () => undefined
    }))

    expect(markup).toContain('>取消</button>')
    expect(markup).toContain('>保存</button>')
    expect(markup).not.toContain('停止')
    expect(markup).not.toContain('composer-stop')
    expect(markup).not.toContain('danger-button')
  })
})
