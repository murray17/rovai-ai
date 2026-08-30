import type { StructuredCampMessageContent } from '@contracts'
import { useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { StructuredMentionComposer } from '../../../apps/desktop/src/renderer/src/StructuredMentionComposer'

const errors: string[] = []
window.addEventListener('error', event => errors.push(String(event.error?.stack ?? event.message)))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
let capturedEditor: HTMLElement | null = null

function editor(): HTMLElement {
  const element = document.getElementById('composer')
  if (!element) throw new Error('The Composer disappeared')
  return element
}

function focusEnd(): void {
  const element = editor()
  element.focus()
  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
}

function Harness() {
  const [content, setContent] = useState<StructuredCampMessageContent>([])
  const [generation, setGeneration] = useState(0)
  useLayoutEffect(() => {
    Object.assign(window, {
      composerTest: {
        reset(text: string) {
          errors.length = 0
          setContent(text ? [{ kind: 'text', text }] : [])
          setGeneration(value => value + 1)
        },
        refresh() { setContent([...content]) },
        focusEnd,
        captureEditor() { capturedEditor = editor() },
        state() {
          const element = document.getElementById('composer')
          return {
            content,
            text: element?.innerText.replaceAll('\u200B', '') ?? null,
            errors: [...errors],
            focused: document.activeElement === element,
            sameEditor: capturedEditor === element
          }
        }
      }
    })
  })
  return <StructuredMentionComposer
    key={generation}
    id="composer"
    value={content}
    members={[]}
    ariaLabel="Native Composer regression"
    onChange={setContent}
    onSubmit={() => { throw new Error('This fixture must never submit a message') }}
  />
}

createRoot(document.getElementById('root')!).render(<Harness />)
