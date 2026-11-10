import type { BrowserWindow } from 'electron'
import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function layoutAcceptance(window: BrowserWindow, userData: string, root: string): Promise<{ name: string; ok: boolean; evidence: unknown }[]> {
  // The hidden fixture needs a focused page for native CSS focus/tooltip behavior.
  window.webContents.debugger.attach('1.3')
  await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  const run = (code: string) => window.webContents.executeJavaScript(code).catch(error => { throw new Error(`Layout step failed: ${code}`, { cause: error }) })
  const panel = `document.querySelector('.file-preview-tab-panel:not([hidden])')`
  const stage = `document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-html-stage')`
  const wait = async (code: string): Promise<void> => {
    for (let count = 0; count < 300; count++) {
      if (await run(code)) return
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error(`Layout prerequisite failed: ${code}`)
  }
  const snapshot = () => run(`(() => { const stage=${stage}, panel=${panel}, info=panel.querySelector('.file-preview-html-info'), feedback=panel.querySelector('.file-preview-html-feedback,.file-preview-html-info'); return {
    document:stage?.dataset.documentState,script:stage?.dataset.scriptState,resource:stage?.dataset.resourceState,
    summary:feedback?.textContent??'',
    expanded:feedback?.getAttribute('aria-expanded'),
    info:Boolean(info),iconOnly:Boolean(info && !info.textContent && info.querySelector('circle')),
    infoLabel:info?.getAttribute('aria-label'),inToolbar:Boolean(info?.closest('.file-preview-path-row')),
    warning:Boolean(stage?.querySelector('.file-preview-html-feedback.is-problem')),
    retry:Boolean(stage?.querySelector('.file-preview-html-diagnostics button')),
    issues:Array.from(stage?.querySelectorAll('ol>li')??[],item=>item.textContent)
  } })()`)
  const cases: { name: string; ok: boolean; evidence: unknown }[] = []
  await run(`window.previewAcceptance.open({kind:'camp_workspace',threadId:'preview-test',rawReference:'layout.html'})`)
  await wait(`${stage}?.dataset.documentState==='loaded' && ${stage}?.dataset.serverDiagnosticsState==='connected'`)
  const origin = await run('window.previewAcceptance.activeTab.content.preview.origin')
  const frame = window.webContents.mainFrame.framesInSubtree.find(frame => frame.url.startsWith(origin + '/'))!
  await frame.executeJavaScript(`document.getElementById('retained-input').value='布局通知后保留的输入';scrollTo(0,150);document.getElementById('layout').click()`)
  await wait(`${stage}?.querySelectorAll('ol>li').length===1`)
  const native = await frame.executeJavaScript('({events:window.layoutEvents,versions:navigator.userAgent,timeOrigin:performance.timeOrigin})')
  const neutral = await snapshot()
  await run(`${panel}.querySelector('.file-preview-html-info').focus()`)
  await wait(`getComputedStyle(${panel}.querySelector('.file-preview-html-info-tooltip')).visibility==='visible'`)
  const focused = await run(`(() => {const info=${panel}.querySelector('.file-preview-html-info'); return {
    active:document.activeElement===info,tooltip:getComputedStyle(info.nextElementSibling).visibility,
    hint:info.nextElementSibling.textContent}})()`)
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
  await wait(`${panel}.querySelector('.file-preview-html-info')?.getAttribute('aria-expanded')==='true' && !${stage}.querySelector('.file-preview-html-diagnostics').hidden`)
  cases.push({ name: 'native ResizeObserver notification is retained as neutral layout detail',
    ok: native.events.length === 1 && native.events[0].trusted && neutral.summary === ''
      && neutral.info && neutral.iconOnly && neutral.inToolbar && neutral.infoLabel === '查看诊断详情'
      && focused.active && focused.tooltip === 'visible' && focused.hint === '查看诊断详情'
      && !neutral.warning && !neutral.retry && neutral.expanded === 'false' && neutral.script === 'no-error-observed'
      && neutral.issues[0].includes('浏览器布局提示') && neutral.issues[0].includes(native.events[0].message),
    evidence: { native, neutral, focused } })
  await new Promise(resolve => setTimeout(resolve, 100))
  await writeFile(join(userData, 'layout-neutral.png'), (await window.webContents.capturePage()).toPNG())
  await run(`${panel}.querySelector('.file-preview-html-info').click();${panel}.querySelector('[aria-label="查看源码"]').click()`)
  await wait(`Boolean(${panel}?.querySelector('.cm-editor'))`)
  await run(`${panel}.querySelector('[aria-label="交互预览"]').click()`)
  await frame.executeJavaScript(`document.getElementById('layout').click()`)
  await new Promise(resolve => setTimeout(resolve, 150))
  const retained = await frame.executeJavaScript(`({timeOrigin:performance.timeOrigin,input:document.getElementById('retained-input').value,top:scrollY,events:window.layoutEvents.length})`)
  const deduplicated = await snapshot()
  cases.push({ name: 'layout disclosure, source switching and duplicate notification preserve the interactive document',
    ok: retained.timeOrigin === native.timeOrigin && retained.input === '布局通知后保留的输入' && retained.top === 150
      && retained.events === 2 && deduplicated.issues.length === 1 && deduplicated.info && deduplicated.summary === '' && !deduplicated.warning,
    evidence: { retained, deduplicated } })
  await frame.executeJavaScript(`document.getElementById('business').click()`)
  await wait(`${stage}?.querySelectorAll('ol>li').length===5 && ${stage}?.textContent.includes('HTTP 404')`)
  const mixed = await snapshot()
  const business = await frame.executeJavaScript('window.layoutEvents')
  cases.push({ name: 'same-name business errors and a missing resource stay problems alongside layout detail',
    ok: mixed.summary === '4 项问题' && mixed.warning && !mixed.info && mixed.retry && mixed.script === 'error'
      && mixed.resource === 'partial-failure' && mixed.issues.filter((text: string) => text.includes('浏览器布局提示')).length === 1
      && mixed.issues.filter((text: string) => text.startsWith('脚本错误')).length === 3
      && business.some((event: { trusted: boolean; errorIsNull: boolean }) => !event.trusted && event.errorIsNull),
    evidence: { mixed, business } })
  const sampleName = 'model-selector-v3-en.html'
  const samplePath = join(root, sampleName)
  if (await access(samplePath).then(() => true, () => false)) {
    const original = await readFile(samplePath, 'utf8')
    await run(`window.previewAcceptance.open({kind:'camp_workspace',threadId:'preview-test',rawReference:'${sampleName}'})`)
    await wait(`${stage}?.dataset.documentState==='loaded' && ${stage}?.dataset.serverDiagnosticsState==='unavailable'`)
    const sampleOrigin = await run('window.previewAcceptance.activeTab.content.preview.origin')
    const sampleFrame = window.webContents.mainFrame.framesInSubtree.find(frame => frame.url.startsWith(sampleOrigin + '/'))!
    const before = await sampleFrame.executeJavaScript(`(() => {
      window.retainedSampleInput=document.querySelector('input:not([disabled]):not([type="hidden"])');
      if(window.retainedSampleInput) window.retainedSampleInput.value='sample input retained';
      return {timeOrigin:performance.timeOrigin,csp:document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
        title:document.title,rootText:document.getElementById('root')?.textContent.slice(0,500),hasInput:Boolean(window.retainedSampleInput)}
    })()`)
    // Give the real attachment a rendering turn after its initial layout.
    await new Promise(resolve => setTimeout(resolve, 250))
    const sample = await snapshot()
    if (sample.info) {
      await run(`${panel}.querySelector('.file-preview-html-info').click()`)
      await wait(`${panel}.querySelector('.file-preview-html-info')?.getAttribute('aria-expanded')==='true'`)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
    await writeFile(join(userData, 'model-selector-v3-diagnostics.png'), (await window.webContents.capturePage()).toPNG())
    const after = await sampleFrame.executeJavaScript(`({timeOrigin:performance.timeOrigin,input:window.retainedSampleInput?.value,csp:document.querySelector('meta[http-equiv="Content-Security-Policy"]').content})`)
    cases.push({ name: 'original model-selector-v3 attachment retains policy and interaction without a policy-only entry',
      ok: sample.summary === '' && sample.info === (sample.issues.length > 0)
        && (!sample.info || (sample.inToolbar && sample.infoLabel === '查看诊断详情'))
        && !sample.warning && !sample.retry && sample.script === 'no-error-observed'
        && before.csp.includes("connect-src 'none'") && before.csp === after.csp && before.timeOrigin === after.timeOrigin
        && before.hasInput && after.input === 'sample input retained' && Boolean(before.rootText)
        && await readFile(samplePath, 'utf8') === original,
      evidence: { before, sample, after, layoutNotificationReproduced: sample.issues.some((text: string) => text.includes('浏览器布局提示')) } })
  }
  window.webContents.debugger.detach()
  return cases
}
