import type { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ServerResponse } from 'node:http'

export async function lifecycleAcceptance(window: BrowserWindow, userData: string): Promise<{ name: string; ok: boolean; evidence: unknown }[]> {
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const wait = async (code: string): Promise<void> => {
    for (let count = 0; count < 300; count++) {
      if (await run(code)) return
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error(`Lifecycle prerequisite failed: ${code}`)
  }
  const stage = `document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-html-stage')`
  const cases: { name: string; ok: boolean; evidence: unknown }[] = []
  const streams = new Set<ServerResponse>()
  const writeHead = ServerResponse.prototype.writeHead
  // Observe only this fixture's supplemental endpoint, then restore the native
  // server method. Ending these responses leaves the site and author resources alive.
  ServerResponse.prototype.writeHead = function(this: ServerResponse, ...args: unknown[]) {
    if (this.req.url?.startsWith('/__rovai-preview/events?')) streams.add(this)
    return Reflect.apply(writeHead, this, args)
  } as typeof writeHead
  try {
    await run(`window.previewAcceptance.open({kind:'camp_workspace',threadId:'preview-test',rawReference:'history.html'})`)
    await wait(`${stage}?.dataset.documentState==='loaded' && ${stage}?.dataset.serverDiagnosticsState==='connected'`)
  } finally { ServerResponse.prototype.writeHead = writeHead }
  if (!streams.size) throw new Error('Fixture did not observe the diagnostic stream')
  await run(`window.lifecycleFrame=${stage}.querySelector('iframe')`)
  const origin = await run('window.previewAcceptance.activeTab.content.preview.origin')
  const frame = window.webContents.mainFrame.framesInSubtree.find(frame => frame.url.startsWith(origin))!
  await frame.executeJavaScript(`window.retainedValue=42;document.body.style.minHeight='2000px';const input=document.createElement('input');input.id='retained-input';input.value='诊断断流后保留的输入';input.style.cssText='position:fixed;top:80px;left:24px;width:300px';document.body.append(input);document.body.offsetHeight;window.scrollTo(0,150)`)
  // A hidden Linux Chromium window can defer layout until the next frame.
  // Establish the scroll position before testing whether diagnostic loss keeps it.
  for (let count = 0; count < 40; count++) {
    if (await frame.executeJavaScript('scrollY === 150')) break
    await new Promise(resolve => setTimeout(resolve, 25))
    await frame.executeJavaScript('window.scrollTo(0,150)')
  }
  const scrollBefore = await frame.executeJavaScript('scrollY')
  if (scrollBefore !== 150) throw new Error(`Fixture could not establish preview scroll position: ${scrollBefore}`)
  const timeOrigin = await frame.executeJavaScript('performance.timeOrigin')
  const snapshot = () => run(`(() => {const stage=${stage}; return {document:stage?.dataset.documentState, channel:stage?.dataset.channelState,
    diagnostics:stage?.dataset.serverDiagnosticsState, summary:stage?.querySelector('.file-preview-html-feedback')?.textContent ?? '',
    warning:Boolean(stage?.querySelector('.file-preview-html-feedback.is-problem')), alert:Boolean(stage?.querySelector('[role="alert"]')),
    expanded:stage?.querySelector('[aria-expanded]')?.getAttribute('aria-expanded'), sameFrame:stage?.querySelector('iframe')===window.lifecycleFrame,
    text:stage?.textContent}})()`)
  {
    for (const stream of streams) stream.end()
    await wait(`${stage}?.dataset.serverDiagnosticsState==='unavailable'`)
    const interrupted = await snapshot()
    await run(`${stage}.querySelector('.file-preview-html-feedback').click()`)
    await wait(`${stage}.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')==='true'`)
    await new Promise(resolve => setTimeout(resolve, 100))
    await writeFile(join(userData, 'diagnostic-interrupted-day.png'), (await window.webContents.capturePage()).toPNG())
    const retained = await frame.executeJavaScript('({value:window.retainedValue,input:document.querySelector("#retained-input").value,top:scrollY,timeOrigin:performance.timeOrigin})')
    cases.push({ name: 'HTTP diagnostic loss leaves the loaded page interactive and uses collapsed neutral details',
      ok: interrupted.document === 'loaded' && interrupted.channel === 'connected' && interrupted.sameFrame
        && interrupted.summary === '诊断详情' && interrupted.expanded === 'false' && !interrupted.warning && !interrupted.alert
        && interrupted.text.includes('资源诊断连接中断，部分资源错误信息可能不完整')
        && retained.value === 42 && retained.input === '诊断断流后保留的输入' && retained.top === 150 && retained.timeOrigin === timeOrigin,
      evidence: { interrupted, scrollBefore, retained } })
  }
  await wait(`${stage}?.dataset.serverDiagnosticsState==='connected'`)
  const recovered = await snapshot()
  cases.push({ name: 'diagnostic recovery clears transient feedback without replacing the iframe',
    ok: recovered.sameFrame && recovered.document === 'loaded' && recovered.channel === 'connected' && !recovered.summary
      && !recovered.text.includes('资源诊断连接中断'), evidence: recovered })

  // A fresh candidate can load its root while the supplemental endpoint fails.
  let diagnosticRequests = 0
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*'] }, (details, callback) => {
    const diagnostic = details.url.includes('/__rovai-preview/events?')
    if (diagnostic) diagnosticRequests++
    callback({ cancel: diagnostic })
  })
  try {
    await run('window.previewAcceptance.reload(window.previewAcceptance.activeTabId)')
    await wait(`window.previewAcceptance.activeTab?.content?.preview?.origin!==${JSON.stringify(origin)} && !window.previewAcceptance.activeTab?.candidate && !window.previewAcceptance.activeTab?.isRefreshing && ${stage}?.dataset.documentState==='loaded' && ${stage}?.dataset.serverDiagnosticsState==='unavailable'`)
    const candidate = await snapshot()
    cases.push({ name: 'candidate refresh commits with loaded root and valid page channel despite diagnostic failure',
      ok: !candidate.sameFrame && candidate.document === 'loaded' && candidate.channel === 'connected'
        && !candidate.warning && !candidate.alert && !await run('Boolean(window.previewAcceptance.activeTab.refreshError)'), evidence: candidate })
    await run(`document.documentElement.dataset.theme='night'`)
    await new Promise(resolve => setTimeout(resolve, 100))
    await writeFile(join(userData, 'diagnostic-candidate-night.png'), (await window.webContents.capturePage()).toPNG())
    await run('window.previewAcceptance.close(window.previewAcceptance.activeTabId)')
    await wait(`!document.querySelector('iframe.file-preview-html')`)
    const requestsAtClose = diagnosticRequests
    await new Promise(resolve => setTimeout(resolve, 4500))
    cases.push({ name: 'closing the preview stops pending diagnostic reconnects',
      ok: diagnosticRequests === requestsAtClose, evidence: { requestsAtClose, requestsAfterClose: diagnosticRequests } })
  } finally { window.webContents.session.webRequest.onBeforeRequest(null) }
  return cases
}
