import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, realpath, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import test from 'node:test'
import { build } from 'vite'

const root = resolve(import.meta.dirname, '../..')
test('ordinary browser embeds isolated preview sites and uses the shared diagnostic/find channel without Electron', { timeout: 90_000 }, async t => {
  const chrome = process.env.ROVAI_TEST_CHROME ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome')
  if (!await access(chrome).then(() => true, () => false)) { t.skip('Chrome is not installed; browser acceptance did not run'); return }
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-html-browser-'))
  let child, socket, server
  const sites = []
  try {
    for (const [name, entry, platform] of [['site','packages/html-preview/src/site.ts','node'],['source','packages/html-preview/src/file-source.ts','node'],['host','scripts/fixtures/html-preview/browser-host.ts','browser']]) {
      await build({ configFile:false, logLevel:'error', ssr:{noExternal:['parse5','entities']}, build:{ ...(platform === 'node' ? {ssr:join(root,entry)} : {lib:{entry:join(root,entry),formats:['iife'],name:'PreviewHost'}}), outDir:join(fixture,name), minify:false, rollupOptions:{output:{entryFileNames: `${name}.${platform === 'node' ? 'cjs' : 'js'}`, ...(platform==='node'?{format:'cjs'}:{})}} } })
    }
    const { HtmlPreviewSite } = createRequire(import.meta.url)(join(fixture,'site/site.cjs'))
    const { createPreviewFileSource } = createRequire(import.meta.url)(join(fixture,'source/source.cjs'))
    const hostScript = await readFile(join(fixture,'host/host.js'))
    server = createServer((request,response) => {
      if (request.url === '/host.js') {response.writeHead(200,{'Content-Type':'text/javascript'});response.end(hostScript);return}
      response.writeHead(200, {'Content-Type':'text/html'})
      response.end(`<!doctype html><h1>Browser preview acceptance</h1><pre id="result"></pre><script>window.previews=${JSON.stringify(sites.map((site,index)=>({...site.descriptor,name:['history','canvas','assets'][index]})))}</script><script src="/host.js"></script>`)
    })
    server.listen(0,'127.0.0.1'); await once(server,'listening')
    const hostOrigin = `http://localhost:${server.address().port}`
    const files = await realpath(join(root,'scripts/fixtures/html-preview'))
    for (const file of ['history.html','canvas.html','assets.html']) sites.push(await HtmlPreviewSite.create({generation:'browser',hostOrigin,entryPath:`/${file}`,validate:async()=>{},openResource:createPreviewFileSource(files,join(files,file),true)}))
    child = spawn(chrome,['--headless=new',`--user-data-dir=${join(fixture,'browser-data')}`,'--no-first-run','--no-default-browser-check','--remote-debugging-port=0',...(process.platform === 'linux' ? ['--no-sandbox'] : []),'about:blank'],{stdio:['ignore','pipe','pipe']})
    let errors=''
    const endpoint = await new Promise((resolve,reject) => {
      const timer=setTimeout(()=>reject(new Error(errors || 'Chrome did not start')),15000)
      child.stderr.on('data',chunk=>{errors+=chunk;const match=/DevTools listening on (ws:\/\/[^\s]+)/u.exec(errors);if(match){clearTimeout(timer);resolve(match[1])}})
      child.once('error',reject)
    })
    socket = new WebSocket(endpoint); await once(socket,'open')
    let sequence=0; const pending=new Map()
    socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const request=pending.get(data.id);pending.delete(data.id);if(data.error)request?.reject(new Error(data.error.message));else request?.resolve(data.result)}})
    const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId}))})
    const target=await call('Target.createTarget',{url:hostOrigin})
    const {sessionId}=await call('Target.attachToTarget',{targetId:target.targetId,flatten:true})
    let results=[]
    const deadline=Date.now()+20000
    while(Date.now()<deadline){
      const value=await call('Runtime.evaluate',{expression:'JSON.stringify(window.previewBrowserResults ?? [])',returnByValue:true},sessionId)
      results=JSON.parse(value.result.value ?? '[]')
      if(results.length===3 && results.find(item=>item.name==='assets')?.text.includes('module dynamic JSON classic'))break
      await new Promise(resolve=>setTimeout(resolve,100))
    }
    console.log(JSON.stringify({browserHtmlAcceptance:results}))
    assert.ok(results.find(item=>item.name==='history')?.text.includes('运行时'))
    assert.ok(results.find(item=>item.name==='canvas')?.text.includes('Canvas ready'))
    assert.ok(results.find(item=>item.name==='assets')?.text.includes('module dynamic JSON classic'))
    assert.ok(results.every(item=>item.diagnostics.length===0))
    await call('Browser.close').catch(()=>{})
  } finally {
    socket?.close(); child?.kill('SIGKILL')
    await Promise.all(sites.map(site=>site.close()))
    if(server) {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
    if(process.env.ROVAI_KEEP_HTML_PREVIEW_FIXTURE==='1')console.log(`Browser fixture: ${fixture}`)
    else await rm(fixture,{recursive:true,force:true})
  }
})
