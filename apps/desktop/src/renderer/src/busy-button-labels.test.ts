import { readdirSync, readFileSync } from 'node:fs'
import * as ts from 'typescript'
import { expect, it } from 'vitest'

const renderer = new URL('.', import.meta.url)
const busyCopy = /^正在.+…$|^.{1,6}中…$/u
const allowedLoadingCopy = new Set([
  'AutomationEditor.tsx · 正在读取…',
  'ConversationRunSource.tsx · 正在读取原消息…',
  'ExecutionToolGroup.tsx · 正在加载…',
  'ImageGallery.tsx · 正在读取图片…',
  'ThreadNavigation.tsx · 正在读取…',
  'ThreadReferenceMenu.tsx · 加载中…',
  'ThreadWorkspace.tsx · 正在加载更早消息…',
  'ThreadWorkspace.tsx · 正在载入引用…',
  'ThreadWorkspace.tsx · 正在加载执行记录…',
  'ThreadWorkspace.tsx · 正在加载…'
])

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

it('keeps action labels stable while submissions are busy', () => {
  const violations: string[] = []
  const files = readdirSync(renderer, { encoding: 'utf8', recursive: true }).filter(file => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))

  for (const file of files.sort()) {
    const source = ts.createSourceFile(file, readFileSync(new URL(file, renderer), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node): void => {
      if (isButton(node)) {
        for (const phrase of visibleBusyCopy(node)) {
          const violation = `${file} · ${phrase}`
          if (!allowedLoadingCopy.has(violation)) violations.push(violation)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }

  expect(violations, violations.join('\n')).toEqual([])
})
