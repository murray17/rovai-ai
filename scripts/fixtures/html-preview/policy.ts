import type { BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function policyAcceptance(window: BrowserWindow, userData: string, root: string): Promise<{ name: string; ok: boolean; evidence: unknown }[]> {
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const stage = `document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-html-stage')`
  const wait = async (code: string): Promise<void> => {
    for (let count = 0; count < 300; count++) {
      if (await run(code)) return
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error(`CSP prerequisite failed: ${code}`)
  }
  const snapshot = () => run(`(() => {const stage=${stage};return {
    document:stage?.dataset.documentState,channel:stage?.dataset.channelState,resource:stage?.dataset.resourceState,
    diagnostics:stage?.dataset.serverDiagnosticsState,issues:Array.from(stage?.querySelectorAll('ol>li')??[],item=>item.textContent),
    summary:stage?.querySelector('.file-preview-html-feedback')?.textContent??'',
    expanded:stage?.querySelector('[aria-expanded]')?.getAttribute('aria-expanded'),
    warning:Boolean(stage?.querySelector('.file-preview-html-feedback.is-problem')),
    alert:Boolean(stage?.querySelector('[role="alert"]')),text:stage?.textContent}})()`)
  const original = await readFile(join(root, 'policy.html'), 'utf8')
  const cases: { name: string; ok: boolean; evidence: unknown }[] = []
  await run(`window.previewAcceptance.open({kind:'camp_workspace',threadId:'preview-test',rawReference:'policy.html'})`)
  await wait(`${stage}?.dataset.documentState==='loaded' && ${stage}?.textContent.includes('资源诊断受此页面策略限制')`)
  const origin = await run('window.previewAcceptance.activeTab.content.preview.origin')
  const frame = () => window.webContents.mainFrame.framesInSubtree.find(frame => frame.url.startsWith(origin + '/'))!
  const limited = await snapshot()
  const before = await frame().executeJavaScript(`({timeOrigin:performance.timeOrigin,csp:document.querySelector('meta[http-equiv="Content-Security-Policy"]').content})`)
  await frame().executeJavaScript(`document.getElementById('retained-input').value='诊断受限后保留的输入';document.getElementById('increment').click();scrollTo(0,150)`)
  // Observe browser CSP events beyond all three former backoffs. Server request
  // counts alone cannot prove this: CSP prevents those requests reaching it.
  await new Promise(resolve => setTimeout(resolve, 8500))
  const retained = await frame().executeJavaScript(`({timeOrigin:performance.timeOrigin,input:document.getElementById('retained-input').value,count:document.getElementById('count').textContent,top:scrollY,events:window.policyEvents,csp:document.querySelector('meta[http-equiv="Content-Security-Policy"]').content})`)
  cases.push({ name: 'real CSP denial is neutral, attempted once, and preserves author policy and interaction',
    ok: limited.document === 'loaded' && limited.channel === 'connected' && limited.resource === 'no-error-observed'
      && limited.diagnostics === 'unavailable' && limited.issues.length === 0 && limited.summary === '诊断详情'
      && limited.expanded === 'false' && !limited.warning && !limited.alert
      && retained.events.length === 1 && retained.events[0].trusted && retained.events[0].directive === 'connect-src'
      && retained.events[0].sourceFile.includes('/__rovai-preview/bridge/')
      && retained.csp === "connect-src 'none'" && retained.csp === before.csp
      && retained.timeOrigin === before.timeOrigin && retained.input === '诊断受限后保留的输入' && retained.count === '1' && retained.top === 150,
    evidence: { limited, before, retained } })
  await run(`${stage}.querySelector('.file-preview-html-feedback').click()`)
  await wait(`${stage}.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')==='true'`)
  await new Promise(resolve => setTimeout(resolve, 100))
  await writeFile(join(userData, 'diagnostic-policy-day.png'), (await window.webContents.capturePage()).toPNG())
  await run(`document.documentElement.dataset.theme='night'`)
  await new Promise(resolve => setTimeout(resolve, 100))
  await writeFile(join(userData, 'diagnostic-policy-night.png'), (await window.webContents.capturePage()).toPNG())

  await frame().executeJavaScript(`location.search='?errors=1'`)
  await wait(`${stage}?.querySelectorAll('ol>li').length===4 && ${stage}?.dataset.documentState==='loaded'`)
  const mixed = await snapshot()
  cases.push({ name: 'author script, missing resource, business CSP and author request to the diagnostic URL remain visible',
    ok: mixed.diagnostics === 'unavailable' && mixed.resource === 'partial-failure' && mixed.summary === '4 项问题'
      && mixed.issues.some((text: string) => text.includes('author csp fixture'))
      && mixed.issues.some((text: string) => text.includes('missing-policy.png'))
      && mixed.issues.some((text: string) => text.includes('business.json'))
      && mixed.issues.some((text: string) => text.includes('/__rovai-preview/events?documentId=')),
    evidence: mixed })
  await frame().executeJavaScript(`location.href='./history.html'`)
  await wait(`${stage}?.dataset.documentState==='loaded' && ${stage}?.dataset.serverDiagnosticsState==='connected'`)
  const next = await snapshot()
  cases.push({ name: 'a new document reconnects diagnostics without inheriting policy denial or author errors',
    ok: next.issues.length === 0 && !next.summary && !next.text.includes('资源诊断受此页面策略限制')
      && next.channel === 'connected' && next.resource === 'no-error-observed'
      && await readFile(join(root, 'policy.html'), 'utf8') === original,
    evidence: next })
  await run('window.previewAcceptance.close(window.previewAcceptance.activeTabId)')
  await wait(`!document.querySelector('iframe.file-preview-html')`)
  return cases
}
