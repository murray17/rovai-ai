import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { expect, it } from 'vitest'

const renderer = fileURLToPath(new URL('.', import.meta.url))
const web = fileURLToPath(new URL('../../../../web/src/', import.meta.url))
const setters = new Set(['setError', 'setIssue', 'onNotify', 'notify', 'notifyError', 'publish'])
const errorReaders = new Set(['errorMessage', 'readErrorMessage'])
const feedbackCalls = new Set(['onError', 'onNotifyError', 'setComposerInviteMessage', 'uiAttribute', 'translateUi'])
const feedbackState = /^(?:on|set)(?:[A-Z]\w*)?(?:Error|Issue|Notice|Feedback|Toast)$/u
const feedbackFields = new Set(['message', 'error', 'errorDetail', 'detail'])

function accessName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text
  return undefined
}

function callName(node: ts.Expression): string | undefined {
  return ts.isIdentifier(node) ? node.text : accessName(node)
}

function isFeedbackCall(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isFeedbackCall(node.expression)
  if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    || node.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
    return isFeedbackCall(node.left) || isFeedbackCall(node.right)
  }
  const name = callName(node)
  return !!name && (setters.has(name) || feedbackCalls.has(name) || feedbackState.test(name))
}

function rawErrorFeedbackSink(node: ts.CallExpression): ts.Node | undefined {
  if (!errorReaders.has(callName(node.expression) ?? '')) return undefined
  for (let parent = node.parent; parent; parent = parent.parent) {
    // Error objects and thrown values can carry raw details to a later interpreter.
    if (ts.isNewExpression(parent) || ts.isThrowStatement(parent)) return undefined
    if (ts.isCallExpression(parent) && isFeedbackCall(parent.expression)) return parent
    if (ts.isJsxExpression(parent)) {
      if (!ts.isJsxAttribute(parent.parent) || !/^on[A-Z]/u.test(parent.parent.name.getText())) return parent
    }
    if (ts.isPropertyAssignment(parent) && (ts.isIdentifier(parent.name) || ts.isStringLiteralLike(parent.name))
      && feedbackFields.has(parent.name.text)) return parent
  }
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

function unsafeFeedbackLocations(directory: string): { existing: string[]; rawErrorReaders: string[] } {
  const existing: string[] = []
  const rawErrorReaders: string[] = []
  for (const path of sourceFiles(directory)) {
    const file = relative(directory, path)
    if (file === 'operation-failure.ts') continue
    const source = ts.createSourceFile(file, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    const flag = (node: ts.Node): void => { existing.push(`${file}: ${node.getText(source)}`) }
    const visit = (node: ts.Node): void => {
      if (isPayloadMessage(node)) flag(node)
      if (ts.isCallExpression(node)) {
        const name = callName(node.expression)
        if (name === 'uiAttribute') {
          for (const argument of node.arguments.slice(1)) {
            if (contains(argument, child => accessName(child) === 'code')) flag(argument)
          }
        }
        if (name && setters.has(name) && node.arguments.some(argument => contains(argument, stringifiesError))) flag(node)
        const rawSink = rawErrorFeedbackSink(node)
        if (rawSink) rawErrorReaders.push(`${file}: ${rawSink.getText(source)}`)
      }
      if (ts.isJsxAttribute(node) && node.parent.parent.tagName.getText(source) === 'UiText'
        && node.name.getText(source) !== 'zh' && node.initializer && contains(node.initializer, child => accessName(child) === 'code')) {
        flag(node)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return { existing, rawErrorReaders }
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

// Existing direct reads, matched by their exact expressions and multiplicity.
const remainingRawErrorFeedback = [
  "App.tsx: setStartupError(errorMessage(error))",
  "ArchiveSettings.tsx: onError(readErrorMessage(error))",
  "ArchiveSettings.tsx: onError(readErrorMessage(error))",
  "ArchiveSettings.tsx: setActionError(readErrorMessage(error))",
  "ArchiveSettings.tsx: setError(readErrorMessage(error))",
  "ArchiveSettings.tsx: setError(readErrorMessage(error))",
  "AutomationEditor.tsx: setError(readErrorMessage(nextError))",
  "AutomationWorkspace.tsx: message: readErrorMessage(nextError)",
  "AutomationWorkspace.tsx: message: readErrorMessage(nextError)",
  "AutomationWorkspace.tsx: message: readErrorMessage(nextError)",
  "AutomationWorkspace.tsx: message: readErrorMessage(nextError)",
  "AutomationWorkspace.tsx: message: readErrorMessage(nextError)",
  "AutomationWorkspace.tsx: message: readErrorMessage(nextError)",
  "BusinessApp.tsx: message: errorMessage(error)",
  "BusinessApp.tsx: message: errorMessage(error)",
  "BusinessApp.tsx: notify(errorMessage(nextError))",
  "BusinessApp.tsx: notifyError(errorMessage(error))",
  "BusinessApp.tsx: notifyError(errorMessage(error))",
  "BusinessApp.tsx: notifyError(errorMessage(error))",
  "BusinessApp.tsx: notifyError(errorMessage(nextError))",
  "BusinessApp.tsx: notifyError(errorMessage(nextError))",
  "BusinessApp.tsx: setLocationSaveError(errorMessage(nextError))",
  "BusinessApp.tsx: setOnboardingError(errorMessage(nextError))",
  "BusinessApp.tsx: setOnboardingError(errorMessage(nextError))",
  "BusinessApp.tsx: setOnboardingError(errorMessage(nextError))",
  "BusinessApp.tsx: setOnboardingError(errorMessage(nextError))",
  "BusinessApp.tsx: setStartupError(errorMessage(nextError))",
  "BusinessApp.tsx: setStartupError(errorMessage(nextError))",
  "BusinessApp.tsx: uiAttribute(\"一键创建未完成：{0} 请重新确认项目、队员与默认负责人。\", String(errorMessage(nextError)))",
  "BusinessApp.tsx: uiAttribute(\"暂时无法打开通知来源：{0}\", String(errorMessage(nextError)))",
  "CommonEnvironmentEditor.tsx: setError(readErrorMessage(e))",
  "CoreSubsystemNotice.tsx: setError(readErrorMessage(failure))",
  "CurrentUserProfile.tsx: setError(readErrorMessage(failure))",
  "CurrentUserProfileEditor.tsx: setImageError(readErrorMessage(failure))",
  "CurrentUserProfileEditor.tsx: setImageError(readErrorMessage(failure).replaceAll(uiAttribute('角色图片'), uiAttribute('图片')))",
  "DiagnosticsCenter.tsx: detail: errorMessage(error)",
  "DiagnosticsCenter.tsx: setInitialError(errorMessage(error))",
  "DiagnosticsCenter.tsx: uiAttribute(\"{0} 最近一次成功检查结果仍然保留。\", String(errorMessage(error)))",
  "ExecutionToolGroup.tsx: errorDetail: readErrorMessage(error, '').trim()",
  "GeneralSettings.tsx: setDefaultsError(errorMessage(error))",
  "GeneralSettings.tsx: setDefaultsError(errorMessage(error))",
  "GeneralSettings.tsx: setExecutionAutoOpenError(errorMessage(error))",
  "GeneralSettings.tsx: setPreferenceError(errorMessage(error))",
  "GeneralSettings.tsx: setPreferenceError(errorMessage(error))",
  "GeneralSettings.tsx: setPreferenceError(errorMessage(error))",
  "GeneralSettings.tsx: setResetError(errorMessage(error))",
  "GeneralSettings.tsx: setResetError(errorMessage(error))",
  "GeneralSettings.tsx: setWorldMapError(errorMessage(error))",
  "HostWebSettings.tsx: setError(readErrorMessage(failure))",
  "HostWebSettings.tsx: setError(readErrorMessage(failure))",
  "LegacyEnvironmentIssue.tsx: setError(readErrorMessage(error))",
  "LegacyEnvironmentIssue.tsx: setError(readErrorMessage(error))",
  "McpSettings.tsx: setError(errorMessage(reason))",
  "McpSettings.tsx: setError(errorMessage(reason))",
  "MemberAvatarEditor.tsx: setError(`${uiAttribute('更换未应用，原头像已保留。')} ${readErrorMessage(failure)}`)",
  "MemberAvatarEditor.tsx: setError(`${uiAttribute('更换未应用，原头像已保留。')} ${readErrorMessage(failure)}`)",
  "MemberEnvironmentEditor.tsx: error: readErrorMessage(error)",
  "MemberIdentityEditor.tsx: message: readErrorMessage(issue)",
  "MemberManagement.tsx: message: errorMessage(nextError)",
  "MemberManagement.tsx: setError(`${appliedReloadFailurePrefix}：${errorMessage(reloadError)}`)",
  "MemberManagement.tsx: setError(errorMessage(nextError))",
  "MemberManagement.tsx: setError(errorMessage(nextError))",
  "MemberManagement.tsx: setError(errorMessage(nextError))",
  "MemberManagement.tsx: setError(errorMessage(nextError))",
  "MemberManagement.tsx: setSubmitError(errorMessage(nextError))",
  "MemberManagement.tsx: uiAttribute(\"队员信息已保存，列表暂未刷新：{0}\", String(errorMessage(issue)))",
  "MemberSidebar.tsx: setError(errorMessage(nextError))",
  "MemoryLibrary.tsx: setError(errorMessage(nextError))",
  "MemoryLibrary.tsx: setError(errorMessage(nextError))",
  "MemoryLibrary.tsx: setError(errorMessage(nextError))",
  "MemoryLibrary.tsx: setError(errorMessage(nextError))",
  "MemoryLibrary.tsx: setError(errorMessage(nextError))",
  "MemoryLibrary.tsx: uiAttribute(\"{0}仍无法刷新最新状态：{1}。请稍后只重试刷新。\", String(editorState.phase === 'applied-refresh-failed' ? uiAttribute('设置已经生效，但') : ''), String(errorMessage(refreshError)))",
  "MemoryLibrary.tsx: uiAttribute(\"{0}，但列表刷新失败：{1}。请只重试刷新，不要重复提交设置。\", String(completion), String(errorMessage(refreshError)))",
  "MemoryLibrary.tsx: uiAttribute(\"状态冲突，且刷新失败：{0}\", String(errorMessage(refreshError)))",
  "MemoryLibrary.tsx: uiAttribute(\"记忆版本已变化，但无法刷新最新状态：{0}。当前选择仍保留；请先重新获取最新状态，不要在版本未知时重试提交。\", String(errorMessage(refreshError)))",
  "MemoryLibrary.tsx: uiAttribute(\"设置未完成：{0}。当前选择已保留，请核对后重试。\", String(errorMessage(nextError)))",
  "MemoryLibrary.tsx: uiAttribute('无法确认最新审核状态，请刷新后再处理。{0}', errorMessage(nextError))",
  "MemoryLibrary.tsx: uiAttribute('无法确认最新审核状态，请刷新后再处理。{0}', errorMessage(nextError))",
  "MemoryLibrary.tsx: uiAttribute('无法确认最新审核状态，请刷新后再处理。{0}', errorMessage(nextError))",
  "NewConversationDialog.tsx: setSubmitError(errorMessage(error))",
  "NewConversationDialog.tsx: setSubmitError(errorMessage(error))",
  "NotificationAttentionController.tsx: uiAttribute(\"提醒已标记为已读，但打开失败：{0}\", String(errorMessage(nextError)))",
  "NotificationAttentionController.tsx: uiAttribute(\"提醒操作未完成：{0}\", String(errorMessage(nextError)))",
  "NotificationSettings.tsx: setError(errorMessage(nextError))",
  "RebuiltSkillsSettings.tsx: setContentError(readErrorMessage(reason))",
  "RebuiltSkillsSettings.tsx: setCopyError(readErrorMessage(reason))",
  "RebuiltSkillsSettings.tsx: setDescriptionError(readErrorMessage(reason))",
  "RebuiltSkillsSettings.tsx: setError(readErrorMessage(reason))",
  "RebuiltSkillsSettings.tsx: setError(readErrorMessage(reason))",
  "RebuiltSkillsSettings.tsx: setLoadingError(readErrorMessage(reason))",
  "RuntimeMonitoring.tsx: setExportError(errorMessage(reason))",
  "RuntimeStartupSettings.tsx: setError(readErrorMessage(nextError))",
  "RuntimeStartupSettings.tsx: setError(readErrorMessage(nextError))",
  "RuntimeStartupSettings.tsx: setLoadError(readErrorMessage(nextError))",
  "SingleChatPanel.tsx: onNotify(readErrorMessage(error, uiAttribute('待发送消息操作未完成。')))",
  "SingleChatPanel.tsx: setError(readErrorMessage(nextError))",
  "SingleChatPanel.tsx: setError(readErrorMessage(nextError, uiAttribute('停止请求未完成，请重试。')))",
  "SingleChatPanel.tsx: setError(readErrorMessage(nextError, uiAttribute('单聊列表暂时无法读取。')))",
  "SingleChatPanel.tsx: setError(readErrorMessage(nextError, uiAttribute('单聊暂时无法读取。')))",
  "SingleChatPanel.tsx: setError(readErrorMessage(nextError, uiAttribute('单聊未结束，请重试。')))",
  "SingleChatPanel.tsx: setError(readErrorMessage(nextError, uiAttribute('无法打开原单聊。')))",
  "SingleChatPanel.tsx: setError(readErrorMessage(nextError, uiAttribute('无法打开这段单聊。')))",
  "SingleChatPanel.tsx: setError(readErrorMessage(nextError, uiAttribute('消息未发送，请重试。')))",
  "SingleChatPanel.tsx: setError(readErrorMessage(nextError, uiAttribute('附件未能移除，请重试。')))",
  "TeamWorkspace.tsx: setError(messages[result.code] ?? readErrorMessage(result.payload.message ?? result.code))",
  "TeamWorkspace.tsx: setError(readErrorMessage(error))",
  "ThreadMessageEditor.tsx: setError(readErrorMessage(failure, uiAttribute('保存失败，请重试。')))",
  "ThreadWorkspace.tsx: (onNotifyError ?? onNotify)(readErrorMessage(error))",
  "ThreadWorkspace.tsx: detail: readErrorMessage(nextError, null)",
  "ThreadWorkspace.tsx: error: client.attachments.kind === 'download' ? readErrorMessage(error) : attachmentErrorMessage(error)",
  "ThreadWorkspace.tsx: error: localizeExecutionEngineTerms(readErrorMessage(error))",
  "ThreadWorkspace.tsx: message: readErrorMessage(error, uiAttribute('无法读取 Core 权威影响，请重试。'))",
  "ThreadWorkspace.tsx: message: readErrorMessage(error, uiAttribute('移出未完成，请重试。'))",
  "ThreadWorkspace.tsx: message: readErrorMessage(error, uiAttribute('邀请队员失败，请重试。'))",
  "ThreadWorkspace.tsx: notifyError(readErrorMessage(error, uiAttribute('复制失败')))",
  "ThreadWorkspace.tsx: setComposerInviteMessage(readErrorMessage(error, uiAttribute('邀请未完成，消息未发送。草稿已保留。')))",
  "ThreadWorkspace.tsx: setFormError(localizeExecutionEngineTerms(readErrorMessage(error)))",
  "ThreadWorkspace.tsx: setWithdrawalError(readErrorMessage(error, kind === 'delete'\n        ? uiAttribute('删除失败，请重试。') : uiAttribute('撤回失败，请重试。')))",
  "member-identity-save.ts: uiAttribute('队员文字信息已保存，头像未保存：{0}', readErrorMessage(error))",
  "useArchiveRecords.ts: error: readErrorMessage(error)",
  "useTeams.ts: setError(readErrorMessage(error))",
  "useThreadMemberFast.ts: onNotify(readErrorMessage(error, '响应模式未保存，请重试。'))"
]

it('finds direct raw error rendering and leaves diagnostic reads available', () => {
  const source = ts.createSourceFile('sample.tsx', `
  const fragment = (error: unknown) => {
    notifyError(errorMessage(error));
    setArchiveReadError(readErrorMessage(error));
    (onNotifyError ?? onNotify)(helpers?.readErrorMessage(error));
    console.warn(readErrorMessage(error));
    const cause = new Error(readErrorMessage(error));
    return <p title={readErrorMessage(error)} onClick={() => console.warn(readErrorMessage(error))}>{errorMessage(error)}</p>
  }
  `, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const sink = rawErrorFeedbackSink(node)
      if (sink) found.push(sink.getText(source))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(found).toEqual([
    'notifyError(errorMessage(error))',
    'setArchiveReadError(readErrorMessage(error))',
    '(onNotifyError ?? onNotify)(helpers?.readErrorMessage(error))',
    '{readErrorMessage(error)}',
    '{errorMessage(error)}'
  ])
})

it('does not add Renderer exits that expose backend messages or codes', () => {
  const desktop = unsafeFeedbackLocations(renderer)
  const browser = unsafeFeedbackLocations(web)
  expect([...desktop.existing, ...browser.existing].sort()).toEqual(remainingLegacyFeedback.sort())
  expect([...desktop.rawErrorReaders, ...browser.rawErrorReaders].sort()).toEqual(remainingRawErrorFeedback.sort())
})
