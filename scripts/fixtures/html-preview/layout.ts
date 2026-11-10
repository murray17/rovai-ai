import type { BrowserWindow } from 'electron'
import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function layoutAcceptance(window: BrowserWindow, userData: string, root: string): Promise<{ name: string; ok: boolean; evidence: unknown }[]> {
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
  const snapshot = () => run(`(() => { const stage=${stage}; return {
    document:stage?.dataset.documentState,script:stage?.dataset.scriptState,resource:stage?.dataset.resourceState,
    summary:stage?.querySelector('.file-preview-html-feedback')?.textContent??'',
    expanded:stage?.querySelector('[aria-expanded]')?.getAttribute('aria-expanded'),
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
  await run(`${stage}.querySelector('.file-preview-html-feedback').click()`)
  await wait(`${stage}?.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')==='true' && !${stage}.querySelector('.file-preview-html-diagnostics').hidden`)
  cases.push({ name: 'native ResizeObserver notification is retained as neutral layout detail',
    ok: native.events.length === 1 && native.events[0].trusted && neutral.summary === '诊断详情'
      && !neutral.warning && !neutral.retry && neutral.expanded === 'false' && neutral.script === 'no-error-observed'
      && neutral.issues[0].includes('浏览器布局提示') && neutral.issues[0].includes(native.events[0].message),
    evidence: { native, neutral } })
  await new Promise(resolve => setTimeout(resolve, 100))
  await writeFile(join(userData, 'layout-neutral.png'), (await window.webContents.capturePage()).toPNG())
  await run(`${stage}.querySelector('.file-preview-html-feedback').click();${panel}.querySelector('[aria-label="查看源码"]').click()`)
  await wait(`Boolean(${panel}?.querySelector('.cm-editor'))`)
  await run(`${panel}.querySelector('[aria-label="交互预览"]').click()`)
  await frame.executeJavaScript(`document.getElementById('layout').click()`)
  await new Promise(resolve => setTimeout(resolve, 150))
  const retained = await frame.executeJavaScript(`({timeOrigin:performance.timeOrigin,input:document.getElementById('retained-input').value,top:scrollY,events:window.layoutEvents.length})`)
  const deduplicated = await snapshot()
  cases.push({ name: 'layout disclosure, source switching and duplicate notification preserve the interactive document',
    ok: retained.timeOrigin === native.timeOrigin && retained.input === '布局通知后保留的输入' && retained.top === 150
      && retained.events === 2 && deduplicated.issues.length === 1 && deduplicated.summary === '诊断详情' && !deduplicated.warning,
    evidence: { retained, deduplicated } })
  await frame.executeJavaScript(`document.getElementById('business').click()`)
  await wait(`${stage}?.querySelectorAll('ol>li').length===5 && ${stage}?.textContent.includes('HTTP 404')`)
  const mixed = await snapshot()
  const business = await frame.executeJavaScript('window.layoutEvents')
  cases.push({ name: 'same-name business errors and a missing resource stay problems alongside layout detail',
    ok: mixed.summary === '4 项问题' && mixed.warning && mixed.retry && mixed.script === 'error'
      && mixed.resource === 'partial-failure' && mixed.issues.filter((text: string) => text.includes('浏览器布局提示')).length === 1
      && mixed.issues.filter((text: string) => text.startsWith('脚本错误')).length === 3
      && business.some((event: { trusted: boolean; errorIsNull: boolean }) => !event.trusted && event.errorIsNull),
    evidence: { mixed, business } })
  const sampleName = 'model-selector-v3-en.html'
  const samplePath = join(root, sampleName)
  if (await access(samplePath).then(() => true, () => false)) {
    const original = await readFile(samplePath, 'utf8')
    await run(`window.previewAcceptance.open({kind:'camp_workspace',threadId:'preview-test',rawReference:'${sampleName}'})`)
    await wait(`${stage}?.dataset.documentState==='loaded' && ${stage}?.textContent.includes('资源诊断：受页面策略限制')`)
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
    await run(`${stage}.querySelector('.file-preview-html-feedback').click()`)
    await wait(`${stage}?.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')==='true'`)
    await new Promise(resolve => setTimeout(resolve, 100))
    await writeFile(join(userData, 'model-selector-v3-diagnostics.png'), (await window.webContents.capturePage()).toPNG())
    const after = await sampleFrame.executeJavaScript(`({timeOrigin:performance.timeOrigin,input:window.retainedSampleInput?.value,csp:document.querySelector('meta[http-equiv="Content-Security-Policy"]').content})`)
    cases.push({ name: 'original model-selector-v3 attachment retains its policy and interaction with neutral diagnostics',
      ok: sample.summary === '诊断详情' && !sample.warning && !sample.retry && sample.script === 'no-error-observed'
        && before.csp.includes("connect-src 'none'") && before.csp === after.csp && before.timeOrigin === after.timeOrigin
        && before.hasInput && after.input === 'sample input retained' && Boolean(before.rootText)
        && await readFile(samplePath, 'utf8') === original,
      evidence: { before, sample, after, layoutNotificationReproduced: sample.issues.some((text: string) => text.includes('浏览器布局提示')) } })
  }
  return cases
}
