import { app, BrowserWindow, ipcMain } from 'electron'
import { access, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FilePreviewFrameNavigation } from '../../../apps/desktop/src/main/file-preview/file-preview-navigation'
import { FilePreviewService } from '../../../apps/desktop/src/main/file-preview/file-preview-service'

const [renderer, userData, root, preload] = process.argv.slice(2)
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))
const service = new FilePreviewService({ async resolve(request) {
  if (request.kind !== 'camp_workspace') return null
  return { kind: 'file_target', sourceKind: request.kind, campId: request.campId,
    sourceIdentity: request.rawReference, rootPath: root, basePath: root,
    rawReference: request.rawReference, allowChildren: true }
} }, { selectRoot: async () => null, confirmOpen: async () => true, openPath: async () => '', revealPath() {}, copyText() {}, publishExternalUpdate() {} })
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: {
    preload, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
  } })
  const navigation = new FilePreviewFrameNavigation(url => service.ownsHtmlPreviewOrigin(window.webContents.id, url))
  window.webContents.on('will-frame-navigate', details => { if (!details.isMainFrame && !navigation.allows(details.url, details.frame, window.webContents.mainFrame, window.webContents.mainFrame.framesInSubtree)) details.preventDefault() })
  window.webContents.on('will-redirect', details => { if (!details.isMainFrame && !navigation.allows(details.url, details.frame, window.webContents.mainFrame, window.webContents.mainFrame.framesInSubtree)) details.preventDefault() })
  const calls = ['bindCamp', 'open', 'restore', 'reopen', 'readText', 'readPage', 'resolveLine', 'readBinary', 'prepareHtml', 'prepareHtmlSite', 'releaseHtmlSite', 'reload', 'release']
  ipcMain.handle('preview-fixture', (event, method: string, args: unknown) => {
    if (event.senderFrame !== window.webContents.mainFrame || !calls.includes(method)) throw new Error('Invalid fixture call')
    return (service as unknown as Record<string, (id: number, args: unknown) => unknown>)[method](event.sender.id, args)
  })
  const errors: string[] = []
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message.slice(0, 1000)) })
  await window.loadFile(renderer)
  const run = (code: string) => window.webContents.executeJavaScript(code)
  for (let n = 0; n < 50 && !await run('Boolean(window.previewAcceptance)'); n++) await new Promise(resolve => setTimeout(resolve, 40))
  const cases: { name: string; ok: boolean; evidence: unknown }[] = []
  const names = ['history.html', 'canvas.html', 'assets.html', 'errors.html', 'network.html', 'stalled.html', 'many-frames.html']
  for (const name of ['original-history.html','original-canvas.html']) if (await access(join(root,name)).then(()=>true,()=>false)) names.push(name)
  for (const name of names) {
    const started = performance.now()
    await run(`window.previewAcceptance.open({kind:'camp_workspace',campId:'preview-test',rawReference:${JSON.stringify(name)}})`)
    const frames = () => window.webContents.mainFrame.framesInSubtree.filter(frame => frame !== window.webContents.mainFrame)
    const deadline = performance.now() + 10_000
    for (;;) {
      let ready = false
      if (name === 'many-frames.html') ready = (await Promise.all(frames().filter(frame=>frame.url.includes('/child.html')).map(frame=>frame.executeJavaScript(`document.querySelector('#child-ready')?.textContent === 'child ready'`).catch(()=>false)))).filter(Boolean).length === 8
      else if (name === 'errors.html') ready = await run(`(() => { const text = document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-html-stage')?.textContent ?? ''; return text.includes('child fixture') && (text.match(/HTTP 404/g) ?? []).length === 2 })()`)
      else for (const frame of frames()) {
        if (!frame.url.includes('/'+name)) continue
        const selector = name === 'history.html' ? '#rendered' : name === 'canvas.html' ? '#canvas' : name === 'assets.html' ? '#assets-result' : name === 'original-history.html' ? '#view' : name === 'network.html' ? '#network-result' : name === 'stalled.html' ? '#partial' : '#root'
        const expected = name === 'assets.html' ? 'module dynamic JSON classic' : name === 'original-canvas.html' ? '管理连接' : name === 'original-history.html' ? '运行时' : name === 'network.html' ? 'network script network JSON' : ''
        if (name === 'original-canvas.html' && !frame.url.includes('?canvas=1')) continue
        ready = await frame.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)})?.textContent.includes(${JSON.stringify(expected)}))`).catch(()=>false)
        if (ready) break
      }
      if (ready || performance.now() > deadline) break
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    if (name === 'history.html') {
      let evidence: unknown = null
      for (const frame of frames()) {
        const value = await frame.executeJavaScript('({rendered:document.querySelector("#rendered")?.textContent, hash:location.hash})').catch(() => null)
        if (value?.rendered) evidence = value
      }
      cases.push({ name, ok: (evidence as { rendered?: string } | null)?.rendered === '运行时', evidence })
    } else if (name === 'canvas.html') {
      let canvasReady = false
      for (const frame of frames()) {
        if (await frame.executeJavaScript('document.querySelector("#canvas")?.textContent === "Canvas ready"').catch(() => false)) canvasReady = true
      }
      for (const frame of frames()) await frame.executeJavaScript('document.querySelector("#theme")?.click()').catch(() => undefined)
      await new Promise(resolve => setTimeout(resolve, 100))
      let linked = false
      for (const frame of frames()) if (await frame.executeJavaScript('document.querySelector("#result")?.textContent === "Canvas linked"').catch(() => false)) linked = true
      cases.push({ name, ok: canvasReady && linked, evidence: { canvasReady, linked, elapsedMs: Math.round(performance.now()-started) } })    } else if (name === 'assets.html') {
      let evidence: any = null
      for (const frame of frames()) {
        const result = await frame.executeJavaScript(`document.querySelector('#assets-result') ? ({text:document.querySelector('#assets-result').textContent,color:getComputedStyle(document.querySelector('#styled')).color,image:document.querySelector('#logo').naturalWidth}) : null`).catch(()=>null)
        if (result) evidence = result
      }
      cases.push({name,ok:evidence?.text === 'module dynamic JSON classic' && evidence?.color === 'rgb(1, 2, 3)' && evidence?.image === 12,evidence})
    } else if (name === 'errors.html') {
      const evidence = await run(`({text:document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-html-stage')?.textContent,state:document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-html-stage')?.dataset})`)
      cases.push({name,ok:['synchronous fixture','promise fixture','missing.css','missing.png','child fixture','此页面有 5 项加载问题','HTTP 404'].every(text=>evidence.text?.includes(text)) && !evidence.text?.includes('状态码未知') && evidence.state?.documentState === 'loaded',evidence})
      await run(`document.querySelector('.file-preview-tab-panel:not([hidden]) details')?.setAttribute('open','')`)
      await writeFile(join(userData,'diagnostics.png'), (await window.webContents.capturePage()).toPNG())
    } else if (name === 'many-frames.html') {
      const children=await Promise.all(frames().filter(frame=>frame.url.includes('/child.html')).map(frame=>frame.executeJavaScript(`document.querySelector('#child-ready')?.textContent`).catch(()=>null)))
      cases.push({name,ok:children.length===8 && children.every(text=>text==='child ready'),evidence:{readyChildren:children.filter(text=>text==='child ready').length}})
    } else if (name === 'stalled.html') {
      let state: any
      for(let count=0;count<150;count++) {
        state=await run(`({document:document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-html-stage')?.dataset.documentState,channel:document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-html-stage')?.dataset.channelState,notice:document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-html-notice')?.textContent,overlay:Boolean(document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-html-failure'))})`)
        if(state.document === 'unresponsive') break
        await new Promise(resolve=>setTimeout(resolve,100))
      }
      cases.push({name,ok:state.document === 'unresponsive' && state.channel === 'connected' && !state.overlay && state.notice.includes('尚未完成'),evidence:state})
    } else if (name === 'network.html') {
      const outer = frames().find(frame=>frame.url.includes('/network.html'))
      let evidence: any
      for(let count=0;count<100;count++) {
        evidence=await outer?.executeJavaScript(`({text:document.querySelector('#network-result')?.textContent,color:getComputedStyle(document.querySelector('#network-result')).color,corsBlocked:window.corsBlocked,font:window.fontLoaded})`)
        if(evidence?.corsBlocked && evidence?.font !== undefined) break
        await new Promise(resolve=>setTimeout(resolve,50))
      }
      let embedded: boolean[] = []
      for (let count=0; count<100; count++) {
        embedded=await Promise.all(frames().map(frame=>frame.executeJavaScript(`document.body.textContent.includes('network frame')`).catch(()=>false)))
        if(embedded.includes(true)) break
        await new Promise(resolve=>setTimeout(resolve,50))
      }
      cases.push({name,ok:evidence?.text === 'network script network JSON' && evidence?.color === 'rgb(11, 22, 33)' && evidence?.corsBlocked && evidence?.font !== false && embedded.includes(true),evidence:{...evidence,embedded:embedded.includes(true),frames:frames().map(frame=>frame.url)}})
    } else if (name === 'original-history.html') {
      let evidence: any = null
      for (const frame of frames()) {
        const result = await frame.executeJavaScript(`document.querySelector('#view') ? ({text:document.querySelector('#view').textContent.slice(0,600),hash:location.hash,children:document.querySelector('#view').childElementCount,historyNative:history.replaceState.toString().includes('[native code]')}) : null`).catch(()=>null)
        if (result) evidence=result
      }
      cases.push({name,ok:evidence?.children > 0 && evidence?.historyNative,evidence:{...evidence,elapsedMs:Math.round(performance.now()-started)}})
      await writeFile(join(userData,'original-history.png'), (await window.webContents.capturePage()).toPNG())
    } else {
      const canvas = frames().find(frame=>frame.url.includes('original-canvas.html?canvas=1'))
      const outer = frames().find(frame=>{try { const url=new URL(frame.url); return url.pathname === '/original-canvas.html' && !url.searchParams.has('canvas') } catch{return false} })
      const geometry = await outer?.executeJavaScript(`({viewport:innerHeight,stage:document.querySelector('.connection-review-stage')?.getBoundingClientRect().toJSON(),frame:document.querySelector('iframe')?.getBoundingClientRect().toJSON()})`)
      const before = await canvas?.executeJavaScript(`({text:document.body.innerText.slice(0,600),theme:document.documentElement.dataset.theme,children:document.querySelector('#root')?.childElementCount})`)
      await outer?.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='切换夜间')?.click()`)
      await new Promise(resolve=>setTimeout(resolve,300))
      const after = await canvas?.executeJavaScript(`({theme:document.documentElement.dataset.theme,text:document.body.innerText.slice(0,600)})`)
      cases.push({name,ok:Boolean(before?.children && before?.theme !== after?.theme && geometry?.frame?.height > 200),evidence:{geometry,before,after,elapsedMs:Math.round(performance.now()-started)}})
      await writeFile(join(userData,'original-canvas.png'), (await window.webContents.capturePage()).toPNG())
    }
  }
  await run(`window.previewAcceptance.activate(window.previewAcceptance.tabs.find(tab=>tab.presentation?.fileName==='history.html').id)`)
  await new Promise(resolve=>setTimeout(resolve,80))
  const historyFrame = window.webContents.mainFrame.framesInSubtree.find(frame=>frame.url.includes('/history.html'))!
  await historyFrame.executeJavaScript(`window.fixtureKept=73;document.querySelector('#navigate').click()`)
  const routed=await historyFrame.executeJavaScript(`({query:location.search,title:document.querySelector('#rendered').textContent})`)
  cases.push({name:'author History navigation',ok:routed.query==='?tab=all' && routed.title==='启动设置',evidence:routed})
  await run(`Array.from(document.querySelectorAll('.file-preview-tab-panel:not([hidden]) .file-preview-html-status button')).find(button=>button.textContent==='查看源码').click()`)
  let sourceText=''
  for(let count=0;count<100;count++) {
    sourceText=await run(`Array.from(document.querySelectorAll('.file-preview-tab-panel:not([hidden]) .cm-line')).map(line=>line.textContent).join('\\n')`)
    if(sourceText.includes('history.replaceState')) break
    await new Promise(resolve=>setTimeout(resolve,50))
  }
  const rawSource=await readFile(join(root,'history.html'),'utf8')
  await run(`Array.from(document.querySelectorAll('.file-preview-tab-panel:not([hidden]) .file-preview-html-status button')).find(button=>button.textContent==='交互预览').click()`)
  const retained=await historyFrame.executeJavaScript('window.fixtureKept')
  cases.push({name:'author source and preserved interactive document',ok:sourceText.trim()===rawSource.trim() && !sourceText.includes('data-rovai-preview-diagnostic') && retained===73,evidence:{exactSource:sourceText.trim()===rawSource.trim(),retained}})
  const previousOrigin = new URL(historyFrame.url).origin
  await run('window.previewAcceptance.reload(window.previewAcceptance.activeTabId)')
  let freshFrame: Electron.WebFrameMain | undefined
  for(let count=0;count<100;count++) {
    freshFrame=window.webContents.mainFrame.framesInSubtree.find(frame=>frame.url.includes('/history.html') && !frame.url.startsWith(previousOrigin+'/'))
    if(freshFrame && await freshFrame.executeJavaScript('Boolean(document.querySelector("#rendered"))').catch(()=>false)) break
    await new Promise(resolve=>setTimeout(resolve,50))
  }
  const freshOrigin=freshFrame ? new URL(freshFrame.url).origin : ''
  const reset=await freshFrame?.executeJavaScript(`({hash:location.hash,oldState:window.fixtureKept ?? null})`)
  cases.push({name:'refresh replaces and revokes generation',ok:Boolean(freshOrigin && freshOrigin!==previousOrigin && !service.ownsHtmlPreviewOrigin(window.webContents.id,previousOrigin) && reset?.hash==='#runtimes' && reset?.oldState===null),evidence:{reset,oldOriginRevoked:!service.ownsHtmlPreviewOrigin(window.webContents.id,previousOrigin)}})
  await freshFrame?.executeJavaScript(`location.href='./missing-page.html'`).catch(()=>undefined)
  let documentFailure: any
  for(let count=0;count<100;count++) {
    documentFailure=await run(`({state:document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-html-stage')?.dataset.documentState,text:document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-html-failure')?.textContent})`)
    if(documentFailure.state==='failed') break
    await new Promise(resolve=>setTimeout(resolve,50))
  }
  cases.push({name:'missing navigation remains a real document failure',ok:documentFailure.state==='failed' && documentFailure.text?.includes('HTTP 404'),evidence:documentFailure})
  await run('window.previewAcceptance.close(window.previewAcceptance.activeTabId)')
  for(let count=0;count<100 && service.ownsHtmlPreviewOrigin(window.webContents.id,freshOrigin);count++) await new Promise(resolve=>setTimeout(resolve,20))
  cases.push({name:'closed tab revokes its site',ok:!service.ownsHtmlPreviewOrigin(window.webContents.id,freshOrigin),evidence:{revoked:!service.ownsHtmlPreviewOrigin(window.webContents.id,freshOrigin)}})
  const channels = await run(`Array.from(document.querySelectorAll('.file-preview-html-stage')).map(el => ({document:el.dataset.documentState,channel:el.dataset.channelState}))`)
  cases.push({name:'diagnostic connections',ok:channels.length === names.length - 1 && channels.every((state: {channel:string}) => state.channel === 'connected'),evidence:channels})
  console.log(JSON.stringify({ htmlPreviewAcceptance: true, ok: cases.every(result => result.ok), cases, errors }))
  await service.closeAll()
  window.destroy()
  app.exit(cases.every(result => result.ok) ? 0 : 1)
}).catch(error => { console.error(error); app.exit(2) })
