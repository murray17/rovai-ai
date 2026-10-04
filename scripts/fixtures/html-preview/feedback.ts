import type { BrowserWindow } from 'electron'
import { rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function feedbackAcceptance(window: BrowserWindow, userData: string, root: string): Promise<{ name: string; ok: boolean; evidence: unknown }[]> {
  const run = (code: string) => window.webContents.executeJavaScript(code).catch(error => { throw new Error(`Feedback step failed: ${code}`, { cause: error }) })
  const pause = () => new Promise(resolve => setTimeout(resolve, 20))
  const wait = async (predicate: () => Promise<boolean>): Promise<void> => {
    for (let count = 0; count < 250; count++) { if (await predicate()) return; await pause() }
    throw new Error('HTML feedback fixture did not reach its prerequisite')
  }
  const stage = `document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-html-stage')`
  const snapshot = () => run(`(() => { const el=${stage}, details=el?.querySelector('.file-preview-html-diagnostics'), frame=el?.querySelector('iframe');return {
    text:el?.textContent, summary:el?.querySelector('.file-preview-html-feedback')?.textContent ?? '',
    expanded:el?.querySelector('[aria-expanded]')?.getAttribute('aria-expanded'), detailsVisible:Boolean(details && !details.hidden),
    path:Boolean(el?.querySelector('.file-preview-path-row')), extraRow:Boolean(el?.querySelector('.file-preview-html-feedback-row')),
    disabled:details?.querySelector('button')?.disabled, frameRetained:frame===window.previewBookmarkedFrame,
    source:Boolean(el?.querySelector('.file-preview-html-source')), frameVisible:Boolean(frame && !frame.hidden),
    overflow:el.scrollWidth > el.clientWidth, frameHeight:frame?.getBoundingClientRect().height,
    detailsHeight:details?.getBoundingClientRect().height
  } })()`)
  const cases: { name: string; ok: boolean; evidence: unknown }[] = []
  await wait(() => run(`!${stage}.querySelector('iframe').hidden`))
  await pause()
  const quiet = await snapshot()
  cases.push({ name: 'healthy workspace HTML has only the existing path and source action', ok: quiet.path && !quiet.extraRow && !quiet.summary && !quiet.detailsVisible && !quiet.text.includes('页面已加载') && !quiet.text.includes('查看详情'), evidence: quiet })
  await writeFile(join(userData, 'feedback-healthy.png'), (await window.webContents.capturePage()).toPNG())

  await run(`window.previewAcceptance.open({kind:'attachment',threadId:'preview-test',locator:{owner:'message',threadId:'preview-test',messageId:'fixture-message',attachmentRefId:'history'}})`)
  await wait(() => run(`${stage}?.dataset.documentState==='loaded' && ${stage}?.dataset.channelState==='connected'`))
  const attachment = await snapshot()
  await run(`window.previewBookmarkedFrame=${stage}.querySelector('iframe');undefined`)
  const attachmentOrigin = await run('window.previewAcceptance.activeTab.content.preview.origin')
  const frame = window.webContents.mainFrame.frames.find(frame => frame.url.startsWith(attachmentOrigin))!
  await frame.executeJavaScript(`document.body.style.minHeight='2000px';const input=document.createElement('input');input.id='retained-input';input.value='已填写';document.body.prepend(input);window.scrollTo(0,120);window.fixtureKept=91`)
  const before = await frame.executeJavaScript('window.scrollY')
  const openMenu = async () => {
    await run(`document.querySelector('.file-preview-tab:has([aria-selected="true"])').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:0,clientY:0}))`)
    await wait(() => run(`Boolean(document.querySelector('[role="menu"]'))`))
  }
  await openMenu()
  await run(`Array.from(document.querySelectorAll('[role="menuitem"]')).find(button=>button.textContent==='查看源码').click()`)
  await wait(() => run(`Boolean(${stage}.querySelector('.cm-editor'))`))
  const source = await snapshot()
  await openMenu()
  await run(`Array.from(document.querySelectorAll('[role="menuitem"]')).find(button=>button.textContent==='交互预览').click()`)
  await wait(() => run(`!${stage}.querySelector('iframe').hidden`))
  const retained = await frame.executeJavaScript(`({input:document.querySelector('#retained-input').value,scroll:window.scrollY,state:window.fixtureKept})`)
  const returned = await snapshot()
  cases.push({ name: 'attachment source menu preserves the page, input and scroll without a path row', ok: !attachment.path && !attachment.extraRow && !attachment.summary && source.source && !source.frameVisible && source.frameRetained && returned.frameRetained && returned.frameVisible && retained.input === '已填写' && before === 120 && retained.scroll === before && retained.state === 91, evidence: { attachment, source, returned, before, retained } })
  // A no-path document gains only a temporary problem entry when an error arrives.
  await frame.executeJavaScript(`setTimeout(()=>{throw new Error('attachment failure fixture')},0)`)
  await wait(() => run(`${stage}.textContent.includes('attachment failure fixture')`))
  const attachmentIssue = await snapshot()
  cases.push({ name: 'attachment problems remain reachable without fabricating a path', ok: !attachmentIssue.path && attachmentIssue.extraRow && attachmentIssue.summary === '1 项问题' && !attachmentIssue.detailsVisible, evidence: attachmentIssue })
  await run('window.previewAcceptance.close(window.previewAcceptance.activeTabId)')

  await run(`window.previewAcceptance.activate(window.previewAcceptance.tabs.find(tab=>tab.file?.fileName==='errors.html').id)`)
  await wait(() => run(`${stage}?.dataset.documentState==='loaded' && ${stage}?.textContent.includes('5 项问题')`))
  // The basic diagnostic case left details open; close it before testing disclosure.
  await run(`if(${stage}.querySelector('[aria-expanded="true"]')) ${stage}.querySelector('button.file-preview-html-feedback').click()`)
  const collapsed = await snapshot()
  await run(`${stage}.querySelector('button.file-preview-html-feedback').focus()`)
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
  await wait(() => run(`${stage}.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')==='true'`))
  const expanded = await snapshot()
  cases.push({ name: 'problem details are collapsed by default and open with the keyboard', ok: collapsed.summary === '5 项问题' && !collapsed.detailsVisible && expanded.detailsVisible && expanded.detailsHeight <= 260 && expanded.frameHeight > 0, evidence: { collapsed, expanded } })
  for (const theme of ['day', 'night']) {
    await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('#preview-fixture').style.maxWidth='420px'`)
    window.setContentSize(1040, 700)
    window.webContents.setZoomFactor(theme === 'night' ? 2 : 1)
    await pause()
    const layout = await snapshot()
    cases.push({ name: `problem details fit a 420px pane in ${theme}${theme === 'night' ? ' at 200% zoom' : ''}`, ok: !layout.overflow && layout.frameHeight > 0 && layout.detailsHeight <= 260, evidence: layout })
    await writeFile(join(userData, `feedback-${theme}.png`), (await window.webContents.capturePage()).toPNG())
  }
  window.webContents.setZoomFactor(1)
  window.setContentSize(1280, 900)
  await run(`document.documentElement.dataset.theme='day';document.querySelector('#preview-fixture').style.maxWidth=''`)

  // Hold a real reload at the public API, then remove only the fixture's source.
  // Main produces the actual read failure after release; the old document stays native.
  await run(`window.previewBookmarkedFrame=${stage}.querySelector('iframe');window.previewOriginalReload=window.rovai.filePreview.reload;window.rovai.filePreview.reload=async args=>{await new Promise(resolve=>window.previewRetryContinue=resolve);return window.previewOriginalReload(args)};undefined`)
  await rename(join(root, 'errors.html'), join(root, 'errors.html.saved'))
  try {
    await run(`${stage}.querySelector('.file-preview-html-diagnostics button').click()`)
    await wait(() => run(`Boolean(window.previewRetryContinue) && window.previewAcceptance.activeTab.isRefreshing`))
    const pending = await snapshot()
    await run('window.previewRetryContinue()')
    await wait(() => run('Boolean(window.previewAcceptance.activeTab.refreshError)'))
    const failed = await snapshot()
    cases.push({ name: 'retry pending and real read failure preserve the page and diagnostics', ok: pending.disabled && pending.summary.includes('重新加载中') && pending.text.includes('synchronous fixture') && pending.frameRetained && failed.summary.includes('重新加载失败') && !failed.disabled && failed.frameRetained && failed.text.includes('synchronous fixture'), evidence: { pending, failed } })
    await writeFile(join(userData, 'feedback-retry-failed.png'), (await window.webContents.capturePage()).toPNG())
  } finally {
    await rename(join(root, 'errors.html.saved'), join(root, 'errors.html'))
    await run('window.rovai.filePreview.reload=window.previewOriginalReload;undefined')
  }
  await run(`${stage}.querySelector('.file-preview-html-diagnostics button').click()`)
  await wait(() => run(`!window.previewAcceptance.activeTab.isRefreshing && !window.previewAcceptance.activeTab.refreshError && ${stage}.dataset.documentState==='loaded' && ${stage}.textContent.includes('5 项问题')`))
  const recovered = await snapshot()
  cases.push({ name: 'successful retry resets disclosure and removes the reload failure', ok: !recovered.text.includes('重新加载失败') && !recovered.detailsVisible && recovered.frameVisible, evidence: recovered })
  return cases
}
