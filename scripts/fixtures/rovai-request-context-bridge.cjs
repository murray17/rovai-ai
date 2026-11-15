const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const [preload, userData] = process.argv.slice(2)
assert.ok(isAbsolute(preload) && isAbsolute(userData), 'The bridge test requires isolated absolute paths')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

const failures = [
  { kind: 'domain_rejection', code: 'camp_not_open', retryable: false },
  { kind: 'infrastructure_failure', code: 'core_request_superseded', retryable: true },
  { kind: 'full_core_unavailable', code: 'full_core_unavailable', retryable: true },
  { kind: 'shutdown', code: 'desktop_shutdown', retryable: false }
].map((failure, index) => ({
  ...failure,
  message: `Structured failure ${index}: 工作区暂不可用`,
  generation: index + 1,
  details: { method: 'navigation.snapshot', nested: { retained: true }, values: [index, null] }
}))
ipcMain.handle('rovai:request', (_event, _method, params) => params?.kind === 'value'
  ? { kind: 'value', value: { unchanged: true, values: [1, null, 'ok'] } }
  : { kind: 'failure', failure: failures[params.index] })

const hostWebFailure = { ...failures[0], code: 'HOST_WEB_AUTH_READ_FAILED', message: '无法读取登录凭据：操作系统拒绝访问。原文件已保留。' }
ipcMain.handle('rovai:host-web', (_event, operation, params) => operation === 'token'
  ? { kind: 'failure', failure: hostWebFailure }
  : { kind: 'value', value: { operation, params } })

ipcMain.handle('rovai:general-preferences-set-new-conversation-defaults', (_event, defaults, enableOneClick) => ({ defaults, enableOneClick }))
ipcMain.handle('rovai:general-preferences-invalidate-new-conversation-defaults', (_event, expected) => expected)
ipcMain.handle('rovai:navigation-preferences-set-project-name', (_event, targetKey, name) => ({ targetKey, name }))
ipcMain.handle('rovai:onboarding-prepare-runtime-copies', (_event, targets) => ({ targets }))
ipcMain.handle('rovai:onboarding-record-runtime-copy', (_event, agentId, commandId, outcome) => ({ agentId, commandId, outcome }))
ipcMain.handle('rovai:onboarding-begin-provisioning', (_event, agentId, threadId, interfaceLanguage) => ({ agentId, threadId, interfaceLanguage }))
let language = { interfaceLanguagePreference: 'system', interfaceLanguage: 'en', systemLanguage: 'en', languageRevision: 0, readError: null }
ipcMain.handle('rovai:desktop-session-get-interface-language', () => language)
ipcMain.handle('rovai:general-preferences-set-language', (event, preference) => {
  language = { ...language, interfaceLanguagePreference: preference, interfaceLanguage: preference === 'system' ? 'en' : preference, languageRevision: language.languageRevision + 1 }
  event.sender.send('rovai:interface-language-changed', language)
  return language
})

const pastedText = ' \t\r\n' + '😀'.repeat(10_001) + '\n '
const pastedId = '11111111-1111-4111-8111-111111111111'
let pastedPreparations = 0
const saveLocator = { owner: 'message', threadId: 'save-thread', messageId: 'save-message', attachmentRefId: pastedId }
ipcMain.handle('rovai:attachment-save', (_event, locator) => {
  assert.deepEqual(locator, saveLocator)
  return { saved: true, error: null, availability: 'available' }
})
ipcMain.handle('rovai:composer-attachment-prepare-pasted-text', (_event, threadId, displayName, bytes) => {
  pastedPreparations += 1
  assert.equal(threadId, 'paste-thread')
  assert.equal(displayName, '粘贴内容-1.txt')
  assert.ok(bytes instanceof Uint8Array)
  assert.equal(Buffer.from(bytes).toString('utf8'), pastedText)
  return { id: pastedId, generatedBy: 'long_text_paste' }
})
ipcMain.handle('rovai:composer-attachment-remove-pasted-text', (_event, threadId, id) => {
  assert.equal(threadId, 'paste-thread')
  assert.equal(id, pastedId)
  return 'retained'
})

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  try {
    await window.loadURL('data:text/html,<html><body>Isolated contextBridge regression</body></html>')
    const observations = await window.webContents.executeJavaScript(`(async () => {
      const value = await window.rovai.request('navigation.snapshot', { kind: 'value' })
      const savedAttachment = await window.rovai.attachments.save(${JSON.stringify(saveLocator)})
      const hostWeb = [await window.rovai.hostWeb.status(), await window.rovai.hostWeb.start({ listen: '127.0.0.1:4317' }), await window.rovai.hostWeb.rotate(), await window.rovai.hostWeb.stop()]
      let hostWebFailure
      try { await window.rovai.hostWeb.token() } catch (error) { hostWebFailure = error }
      const defaults = { memberAgentIds: ['agent-a'], defaultLeadAgentId: 'agent-a' }
      const initialLanguage = await window.rovai.generalPreferences.getInterfaceLanguage()
      const startupLanguage = await window.rovai.desktopSession.getInterfaceLanguage()
      const languageEvents = []
      let languageChanged
      const changed = new Promise(resolve => { languageChanged = resolve })
      const stopLanguage = window.rovai.generalPreferences.onInterfaceLanguageChanged(snapshot => {
        languageEvents.push(snapshot); languageChanged()
      })
      const manualLanguage = await window.rovai.generalPreferences.setInterfaceLanguagePreference('zh-CN')
      await changed
      stopLanguage()
      const systemLanguage = await window.rovai.generalPreferences.setInterfaceLanguagePreference('system')
      await window.rovai.generalPreferences.getInterfaceLanguage()
      const provisioning = await window.rovai.onboarding.beginProvisioning('language-agent', 'language-thread', 'en')
      const savedOnly = await window.rovai.generalPreferences.setNewConversationDefaults(defaults)
      const enabled = await window.rovai.generalPreferences.setNewConversationDefaults(defaults, true)
      const invalidation = await window.rovai.generalPreferences.invalidateNewConversationDefaults({ expectedTeamId: 'team-A', expectedDefaults: defaults })
      const projectName = await window.rovai.navigationPreferences.setProjectName('directory:/fixture/frontend', '官网前端')
      const restoredName = await window.rovai.navigationPreferences.setProjectName('directory:/fixture/frontend', null)
      const copyPlan = await window.rovai.onboarding.prepareRuntimeCopies([{ agentId: 'agent-b', expectedVersion: 4 }])
      const copyResults = []
      const pasted = await window.rovai.composerAttachments.preparePastedText(
        'paste-thread', new File([${JSON.stringify(pastedText)}], '粘贴内容-1.txt', { type: 'text/plain;charset=utf-8' })
      )
      let oversizedReads = 0
      let oversizedError = ''
      try {
        await window.rovai.composerAttachments.preparePastedText('paste-thread', {
          name: '粘贴内容-1.txt', size: 25 * 1024 * 1024 + 1,
          arrayBuffer: async () => { oversizedReads++; throw new Error('Oversized text must not be read') }
        })
      } catch (error) { oversizedError = error.message }
      let boundaryReads = 0
      await window.rovai.composerAttachments.preparePastedText('paste-thread', {
        name: '粘贴内容-1.txt', size: 25 * 1024 * 1024,
        arrayBuffer: async () => { boundaryReads++; return new TextEncoder().encode(${JSON.stringify(pastedText)}).buffer }
      })
      const removedPaste = await window.rovai.composerAttachments.removePastedText('paste-thread', pasted.id)
      for (const outcome of ['applied', 'skipped', 'retry']) {
        copyResults.push(await window.rovai.onboarding.recordRuntimeCopy('agent-b', 'copy-command', outcome))
      }
      const failures = []
      for (let index = 0; index < 4; index++) {
        const pending = window.rovai.request('navigation.snapshot', { index })
        if (!(pending instanceof Promise)) throw new Error('Public API must remain Promise<T>')
        try {
          await pending
          throw new Error('Expected request rejection')
        } catch (failure) {
          failures.push(Object.fromEntries(
            ['kind', 'code', 'message', 'retryable', 'generation', 'details']
              .map(key => [key, failure[key] ?? null])
          ))
        }
      }
      return { value, savedAttachment, failures, savedOnly, enabled, invalidation, projectName, restoredName, hostWeb, hostWebFailure, copyPlan, copyResults, pasted, removedPaste, oversizedReads, oversizedError, boundaryReads,
        initialLanguage, startupLanguage, manualLanguage, systemLanguage, languageEvents, provisioning }
    })()`)
    assert.deepEqual(observations.hostWeb, [
      { operation: 'status', params: undefined },
      { operation: 'start', params: { listen: '127.0.0.1:4317' } },
      { operation: 'rotate', params: undefined },
      { operation: 'stop', params: undefined }
    ])
    assert.deepEqual(observations.value, { unchanged: true, values: [1, null, 'ok'] })
    assert.deepEqual(observations.savedAttachment, { saved: true, error: null, availability: 'available' })
    assert.deepEqual(observations.initialLanguage, observations.startupLanguage)
    assert.equal(observations.initialLanguage.interfaceLanguagePreference, 'system')
    assert.equal(observations.manualLanguage.interfaceLanguage, 'zh-CN')
    assert.deepEqual(observations.languageEvents, [observations.manualLanguage], 'Unsubscribing removes the real IPC listener')
    assert.equal(observations.systemLanguage.interfaceLanguagePreference, 'system')
    assert.equal(observations.systemLanguage.interfaceLanguage, 'en')
    assert.equal(observations.systemLanguage.languageRevision, 2)
    assert.deepEqual(observations.provisioning, { agentId: 'language-agent', threadId: 'language-thread', interfaceLanguage: 'en' })
    assert.deepEqual(observations.pasted, { id: pastedId, generatedBy: 'long_text_paste' })
    assert.equal(observations.oversizedReads, 0, 'Reject oversized text before reading its bytes')
    assert.match(observations.oversizedError, /25 MiB/u)
    assert.equal(observations.boundaryReads, 1, 'The existing byte limit remains inclusive')
    assert.equal(pastedPreparations, 2, 'Oversized text never crosses the Main IPC')
    assert.equal(observations.removedPaste, 'retained')
    assert.deepEqual(observations.hostWebFailure, hostWebFailure, 'Host Web failures must cross the bridge without an Electron exception prefix')
    assert.deepEqual(observations.failures, failures, 'Renderer must receive every structured failure field')
    const defaults = { memberAgentIds: ['agent-a'], defaultLeadAgentId: 'agent-a' }
    assert.deepEqual(observations.savedOnly, { defaults, enableOneClick: false })
    assert.deepEqual(observations.enabled, { defaults, enableOneClick: true })
    assert.deepEqual(observations.invalidation, { expectedTeamId: 'team-A', expectedDefaults: defaults })
    assert.deepEqual(observations.projectName, { targetKey: 'directory:/fixture/frontend', name: '官网前端' })
    assert.deepEqual(observations.restoredName, { targetKey: 'directory:/fixture/frontend', name: null })
    assert.deepEqual(observations.copyPlan, { targets: [{ agentId: 'agent-b', expectedVersion: 4 }] })
    assert.deepEqual(observations.copyResults, ['applied', 'skipped', 'retry'].map(outcome => ({
      agentId: 'agent-b', commandId: 'copy-command', outcome
    })))
    console.log(JSON.stringify({
      ok: true,
      electron: process.versions.electron,
      contextIsolation: window.webContents.getLastWebPreferences().contextIsolation,
      failureKinds: failures.length
    }))
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}).catch(error => { console.error(error); app.exit(1) })
