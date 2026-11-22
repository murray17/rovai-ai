import { readdirSync, readFileSync } from 'node:fs'
import * as ts from 'typescript'
import { expect, it } from 'vitest'

const renderer = new URL('.', import.meta.url)
const busyCopy = /^正在.+…$|^.{1,6}中…$/u
// Keep each loading label tied to its action and occurrence count.
const allowedLoadingCopy = [
  "AutomationEditor.tsx · className=\"quiet-button compact\" onClick={() => void load(cursor)} · 正在读取…",
  "ConversationRunSource.tsx · onClick={() => { navigating.current = true setOpen(false) onReveal(id) }} · 正在读取原消息…",
  "ExecutionToolGroup.tsx · className=\"camp-history-text-button\" onClick={onLoad} · 正在加载…",
  "ImageGallery.tsx · className=\"image-tile-preview\" onClick={() => { if (canOpen) showPreview() }} · 正在读取图片…",
  "ThreadNavigation.tsx · className=\"show-more-camps\" onClick={onShowMore} · 正在读取…",
  "ThreadReferenceMenu.tsx · className=\"ref-load-more\" onClick={() => { void picker.more() }} · 加载中…",
  "ThreadWorkspace.tsx · className=\"camp-history-text-button\" onClick={() => void loadEarlierMessages()} · 正在加载更早消息…",
  "ThreadWorkspace.tsx · className=\"camp-history-text-button\" onClick={() => { void windowPage.move(earlierLoadError ? 'retry' : windowPage.evidence.length ? 'earlier' : 'latest') }} · 正在加载…",
  "ThreadWorkspace.tsx · className=\"camp-history-text-button\" onClick={() => { void windowPage.move(earlierLoadError ? 'retry' : windowPage.evidence.length ? 'earlier' : 'latest') }} · 正在加载执行记录…",
  "ThreadWorkspace.tsx · onClick={onReveal} className={`reply-parent-quote${unavailable ? ' is-unavailable' : ''}`} · 正在载入引用…"
]

function isButton(node: ts.Node): node is ts.JsxElement {
  return ts.isJsxElement(node)
    && ts.isIdentifier(node.openingElement.tagName)
    && node.openingElement.tagName.text === 'button'
}

function visibleBusyCopy(button: ts.JsxElement): Set<string> {
  const phrases = new Set<string>()
  const visit = (node: ts.Node, inBranch = false): void => {
    if (isButton(node)) return
    if (ts.isJsxAttribute(node)) {
      const element = node.parent.parent
      if (node.name.getText() !== 'zh' || element.tagName.getText() !== 'UiText') return
    }
    if (ts.isConditionalExpression(node)) {
      visit(node.whenTrue, true)
      visit(node.whenFalse, true)
      return
    }
    if (inBranch && ts.isStringLiteralLike(node) && busyCopy.test(node.text)) {
      phrases.add(node.text)
    }
    ts.forEachChild(node, child => visit(child, inBranch))
  }
  button.children.forEach(child => visit(child))
  return phrases
}

function loadingCopyOccurrences(source: ts.SourceFile): string[] {
  const occurrences: string[] = []
  const visit = (node: ts.Node): void => {
    if (isButton(node)) {
      const phrases = visibleBusyCopy(node)
      if (phrases.size > 0) {
        const action = node.openingElement.attributes.properties
          .filter(prop => ts.isJsxAttribute(prop) && ['className', 'onClick'].includes(prop.name.getText(source)))
          .map(prop => prop.getText(source).replace(/\s+/gu, ' '))
          .join(' ')
        for (const phrase of phrases) occurrences.push(`${source.fileName} · ${action} · ${phrase}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return occurrences
}

it('records each button separately even when a loading label is reused', () => {
  const source = ts.createSourceFile('sample.tsx', `
    <><button className="show-more" onClick={showMore}>{loading ? '正在读取…' : '查看更多'}</button>
      <button className="save" onClick={save}>{busy ? '正在读取…' : '保存'}</button>
      <button className="show-more" onClick={showMore}>{loading ? '正在读取…' : '查看更多'}</button></>
  `, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  expect(loadingCopyOccurrences(source)).toEqual([
    'sample.tsx · className="show-more" onClick={showMore} · 正在读取…',
    'sample.tsx · className="save" onClick={save} · 正在读取…',
    'sample.tsx · className="show-more" onClick={showMore} · 正在读取…'
  ])
})

it('keeps action labels stable while submissions are busy', () => {
  const files = readdirSync(renderer, { encoding: 'utf8', recursive: true }).filter(file => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
  expect(files.length).toBeGreaterThan(0)
  const occurrences = files.flatMap(file => loadingCopyOccurrences(
    ts.createSourceFile(file, readFileSync(new URL(file, renderer), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  ))
  expect(occurrences.sort()).toEqual([...allowedLoadingCopy].sort())
})
