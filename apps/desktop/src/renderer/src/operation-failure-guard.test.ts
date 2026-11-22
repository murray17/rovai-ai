import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { expect, it } from 'vitest'

const renderer = fileURLToPath(new URL('.', import.meta.url))
const web = fileURLToPath(new URL('../../../../web/src/', import.meta.url))
const setters = new Set(['setError', 'setIssue', 'onNotify', 'notify', 'notifyError', 'publish'])

function accessName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text
  return undefined
}

function isPayload(node: ts.Node): boolean {
  return accessName(node) === 'payload' || (ts.isIdentifier(node) && node.text === 'payload')
}

function isPayloadMessage(node: ts.Node): boolean {
  if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    && accessName(node) === 'message' && isPayload(node.expression)) return true
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression)
    && ['stringField', 'readString'].includes(node.expression.text)
    && Boolean(node.arguments[0] && isPayload(node.arguments[0])
      && node.arguments[1] && ts.isStringLiteralLike(node.arguments[1]) && node.arguments[1].text === 'message')
}

function contains(node: ts.Node, predicate: (node: ts.Node) => boolean): boolean {
  return predicate(node) || Boolean(ts.forEachChild(node, child => contains(child, predicate) || undefined))
}

function stringifiesError(node: ts.Node): boolean {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'String'
    && node.arguments.some(argument => contains(argument, child =>
      ts.isIdentifier(child) && /^(e|err|error|.*Error|errorMessage)$/u.test(child.text)))
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : []
  })
}

function unsafeFeedbackLocations(directory: string): string[] {
  const found: string[] = []
  for (const path of sourceFiles(directory)) {
    const file = relative(directory, path)
    if (file === 'operation-failure.ts') continue
    const source = ts.createSourceFile(file, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    const flag = (node: ts.Node): void => { found.push(`${file}: ${node.getText(source)}`) }
    const visit = (node: ts.Node): void => {
      if (isPayloadMessage(node)) flag(node)
      if (ts.isCallExpression(node)) {
        const name = ts.isIdentifier(node.expression) ? node.expression.text : accessName(node.expression)
        if (name === 'uiAttribute') {
          for (const argument of node.arguments.slice(1)) {
            if (contains(argument, child => accessName(child) === 'code')) flag(argument)
          }
        }
        if (name && setters.has(name) && node.arguments.some(argument => contains(argument, stringifiesError))) flag(node)
      }
      if (ts.isJsxAttribute(node) && node.parent.parent.tagName.getText(source) === 'UiText'
        && node.name.getText(source) !== 'zh' && node.initializer && contains(node.initializer, child => accessName(child) === 'code')) {
        flag(node)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found
}

// Existing exits to migrate in the follow-up phases of the operation feedback rollout.
const remainingLegacyFeedback = [
  `AutomationWorkspace.tsx: result.payload.message`,
  `AutomationWorkspace.tsx: result.payload.message`,
  `BusinessApp.tsx: String(result.code)`,
  `BusinessApp.tsx: notifyError(uiAttribute("使命已保存，暂时未开始：{0}", String(missionError(error))))`,
  `BusinessApp.tsx: stringField(result.payload, 'message')`,
  `MemberSidebar.tsx: String(result.code)`,
  `MemberSidebar.tsx: result.payload.message`,
  `MemberSidebar.tsx: result.payload.message`,
  `MemoryLibrary.tsx: result.payload.message`,
  `MemoryLibrary.tsx: result.payload.message`,
  `MemoryLibrary.tsx: setError(uiAttribute("状态冲突，且刷新失败：{0}", String(errorMessage(refreshError))))`,
  `MissionControls.tsx: setError(String(e instanceof Error ? e.message : e))`,
  `MissionDelivery.tsx: onNotify(uiAttribute("使命 Worktree 清理已开始，但信息刷新失败：{0}", String(missionError(error))))`,
  `SingleChatPanel.tsx: String(result.code)`,
  `SingleChatPanel.tsx: result.payload.message`,
  `TeamWorkspace.tsx: result.payload.message`,
  `ThreadMessageEditor.tsx: result.payload.message`,
  `ThreadWorkspace.tsx: String(result.code)`,
  `automation-workspace-model.ts: result.payload.message`,
  `automation-workspace-model.ts: result.payload.message`,
  `member-identity-save.ts: result.code`,
  `member-identity-save.ts: result.payload.message`,
  `member-identity-save.ts: result.payload.message`,
  `member-runtime-commands.ts: stringField(result.payload, 'message')`,
  `onboarding-provisioning.ts: result.code`,
  `onboarding-provisioning.ts: stringField(result.payload, 'message')`,
  `thread-fork.ts: result.payload.message`,
  `thread-fork.ts: this.publish({ ...this.state, error: String(error) })`,
  `thread-fork.ts: this.publish({ ...this.state, error: String(error) })`,
  `thread-fork.ts: this.publish({ phase: 'ready', saved: ready, error: String(error) })`,
  `thread-fork.ts: this.publish({ phase: 'rejected', error: String(error) })`,
  `thread-fork.ts: this.publish({ phase: 'unknown', saved, error: String(error) })`
]

it('does not add Renderer exits that expose backend messages or codes', () => {
  expect([...unsafeFeedbackLocations(renderer), ...unsafeFeedbackLocations(web)].sort()).toEqual(remainingLegacyFeedback.sort())
})
