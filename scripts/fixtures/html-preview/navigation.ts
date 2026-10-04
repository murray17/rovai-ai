import type { BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Only the host's deadline timers use a controlled clock. The actual iframe,
// HTTP requests, parsing, author scripts and production React remain native.
function installHostClock(): void {
  const nativeSet = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window)
  let now = 0, next = -1
  const timers = new Map<number, { at: number; run: () => void }>()
  window.setTimeout = ((callback: TimerHandler, delay = 0, ...args: unknown[]) => {
    if (delay < 1000 || typeof callback !== 'function') return nativeSet(callback, delay, ...args)
    const id = next--; timers.set(id, { at: now + delay, run: () => callback(...args) }); return id
  }) as typeof window.setTimeout
  window.clearTimeout = id => { if (id !== undefined && id < 0) timers.delete(id); else nativeClear(id) }
  Object.assign(window, { previewTestClock: {
    tick(ms: number) {
      const until = now + ms
      for (let count = 0; count < 1000; count++) {
        const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        now = next[1].at; timers.delete(next[0]); next[1].run()
      }
      now = until
    },
    pending: () => timers.size
  } })
}

export async function navigationAcceptance(window: BrowserWindow, userData: string): Promise<{ name: string; ok: boolean; evidence: unknown }[]> {
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const pause = () => new Promise(resolve => setTimeout(resolve, 20))
  const wait = async (predicate: () => Promise<boolean>): Promise<void> => {
    for (let count = 0; count < 250; count++) { if (await predicate()) return; await pause() }
    throw new Error('Navigation fixture did not reach its prerequisite')
  }
  const stage = `document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-html-stage')`
  const snapshot = () => run(`(() => { const el=${stage};return {document:el?.dataset.documentState,channel:el?.dataset.channelState,text:el?.textContent,overlay:Boolean(el?.querySelector('.file-preview-html-failure')),pending:window.previewTestClock.pending()} })()`)
  const activeFrame = () => window.webContents.mainFrame.frames.find(frame => frame.url.includes('.localhost:'))!
  const cases: { name: string; ok: boolean; evidence: unknown }[] = []
  await run(`(${installHostClock.toString()})()`)
  await run(`window.previewRootHandshakes=0;window.addEventListener('message',event=>{if(event.source===${stage}?.querySelector('iframe')?.contentWindow && event.data?.type==='connected'){window.previewLastRoot=event.data;window.previewRootHandshakes++}})`)
  const open = async (name: string) => {
    await run(`window.previewAcceptance.open({kind:'camp_workspace',threadId:'preview-test',rawReference:${JSON.stringify(name)}})`)
    await wait(async () => activeFrame()?.url.includes('/' + name) && await activeFrame().executeJavaScript('document.readyState !== "loading" && Boolean(document.body)').catch(() => false) && (await snapshot()).document === 'loaded' && (await snapshot()).channel === 'connected')
  }
  const close = () => run('window.previewAcceptance.close(window.previewAcceptance.activeTabId)')

  await open('history.html')
  await activeFrame().executeJavaScript(`location.href='./stalled.html'`).catch(() => undefined)
  await wait(async () => activeFrame()?.url.endsWith('/stalled.html') && (await snapshot()).channel === 'connected' && (await snapshot()).document === 'loading')
  await run('window.previewTestClock.tick(9000)')
  const handshakes = await run('window.previewRootHandshakes')
  const rootMessage = await run('window.previewLastRoot')
  await activeFrame().executeJavaScript(`parent.postMessage({...${JSON.stringify(rootMessage)},type:'hello'},'*');const child=document.createElement('iframe');child.src='./history.html';document.body.append(child)`)
  await wait(() => run(`window.previewRootHandshakes > ${handshakes}`))
  await wait(async () => Boolean(activeFrame().frames.length) && await activeFrame().frames[0].executeJavaScript('Boolean(document.querySelector("#rendered"))').catch(() => false))
  await run('window.previewTestClock.tick(3001)'); await pause()
  await activeFrame().executeJavaScript(`const image=new Image();image.src='./stalled-missing.png';document.body.append(image)`)
  await wait(async () => (await snapshot()).text.includes('HTTP 404'))
  const stalled = await snapshot()
  cases.push({ name: 'loaded A navigates to stalled B; same-document handshake and child load do not extend its deadline', ok: stalled.document === 'unresponsive' && !stalled.overlay && stalled.text.includes('加载未完成 · 1 项问题'), evidence: stalled })
  await writeFile(join(userData, 'navigation-unresponsive.png'), (await window.webContents.capturePage()).toPNG())
  await close()

  await open('errors.html')
  await wait(async () => (await snapshot()).text.includes('HTTP 404'))
  const origin = new URL(activeFrame().url).origin
  window.webContents.session.webRequest.onBeforeSendHeaders({ urls: [`${origin}/blocked.html`] }, (details, callback) => {
    const headers = { ...details.requestHeaders }
    for (const key of Object.keys(headers)) if (key.toLowerCase() === 'cookie') delete headers[key]
    callback({ requestHeaders: headers })
  })
  await run(`${stage}.querySelector('iframe').addEventListener('load',()=>window.previewUnauthenticatedLoad=true,{once:true})`)
  await activeFrame().executeJavaScript(`location.href='./blocked.html'`).catch(() => undefined)
  await wait(() => run('window.previewUnauthenticatedLoad === true'))
  // The native load listener can precede React's delegated handler. Advance the
  // controlled clock only once the new document's actual deadline is installed.
  await wait(async () => { const state = await snapshot(); return state.document === 'loading' && state.channel === 'waiting' && state.pending > 0 })
  await run('window.previewTestClock.tick(60000)'); await pause()
  const unconfirmed = await snapshot()
  const response = await activeFrame().executeJavaScript('document.body.innerText')
  cases.push({ name: 'an unauthenticated HTTP error load stays unconfirmed and visible', ok: unconfirmed.document === 'unconfirmed' && !unconfirmed.overlay && !unconfirmed.text.includes('missing.css') && !unconfirmed.text.includes('child fixture') && response.includes('访问已失效'), evidence: { ...unconfirmed, response } })
  await writeFile(join(userData, 'navigation-unconfirmed.png'), (await window.webContents.capturePage()).toPNG())
  window.webContents.session.webRequest.onBeforeSendHeaders(null)
  await close()

  await open('errors.html')
  await wait(async () => (await snapshot()).text.includes('HTTP 404'))
  await activeFrame().executeJavaScript(`location.href='./history.html'`).catch(() => undefined)
  await wait(async () => activeFrame()?.url.includes('/history.html') && await activeFrame().executeJavaScript('Boolean(document.querySelector("#rendered"))').catch(() => false) && (await snapshot()).document === 'loaded' && (await snapshot()).channel === 'connected')
  // A fresh HTTP error is an ordered barrier: the root stream has consumed its
  // replay before this response. Only this page's error may remain afterwards.
  await activeFrame().executeJavaScript(`const image=new Image();image.src='./current-page-missing.png';document.body.append(image)`)
  await wait(async () => (await snapshot()).text.includes('current-page-missing.png') && (await snapshot()).text.includes('HTTP 404'))
  const clean = await snapshot()
  cases.push({ name: 'new root document does not replay the previous page resource failures', ok: !clean.text.includes('missing.css') && !clean.text.includes('/assets/missing.png') && !clean.text.includes('child fixture') && clean.text.includes('1 项问题'), evidence: clean })
  await close()
  return cases
}
