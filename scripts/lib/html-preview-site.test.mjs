import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, cp, copyFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'electron'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'

const root = resolve(import.meta.dirname, '../..')
test('production HTML preview runs History initialization and a query-addressed nested canvas independently', { timeout: 90_000 }, async t => {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-html-site-'))
  const source = join(root, 'scripts/fixtures/html-preview')
  let child, network
  try {
    const resources = join(fixture, 'resources')
    await cp(source, resources, {recursive:true})
    for (const [key, name] of [['ROVAI_HTML_HISTORY_SAMPLE','original-history.html'],['ROVAI_HTML_CANVAS_SAMPLE','original-canvas.html']]) {
      if (process.env[key]) { await copyFile(process.env[key], join(resources,name)); console.log(`${name} sha256 ${createHash('sha256').update(await readFile(join(resources,name))).digest('hex')}`) }
    }
    network = createServer((request,response) => {
      if(request.url === '/hang.js') return // Deliberately pending; fixture teardown cancels it.
      const routes = {
        '/app.js':['text/javascript','window.networkScript="network script"'],
        '/app.css':['text/css','#network-result { color: rgb(11, 22, 33); }'],
        '/data.json':['application/json','{"value":"network JSON"}'],
        '/denied.json':['application/json','{}'],
        '/frame.html':['text/html','<h1>network frame</h1>']
      }
      const route=routes[request.url]
      if(!route){response.writeHead(404);response.end('not found');return}
      response.writeHead(200,{'Content-Type':route[0],...(request.url==='/data.json'?{'Access-Control-Allow-Origin':'*'}:{})})
      response.end(route[1])
    })
    network.listen(0,'127.0.0.1');await once(network,'listening')
    const networkOrigin=`http://localhost:${network.address().port}`
    const fontPath=process.env.ROVAI_TEST_FONT ?? '/System/Library/Fonts/Supplemental/Arial.ttf'
    const font=await access(fontPath).then(()=>true,()=>false)
    if(font) await copyFile(fontPath,join(resources,'assets/font.ttf'))
    await writeFile(join(resources,'network.html'),`<!doctype html><link rel="stylesheet" href="${networkOrigin}/app.css"><style>${font?'@font-face{font-family:PreviewFixture;src:url(./assets/font.ttf)}#network-result{font-family:PreviewFixture}':''}</style><h1 id="network-result">loading</h1><script src="${networkOrigin}/app.js"></script><iframe src="${networkOrigin}/frame.html"></iframe><script>fetch('${networkOrigin}/data.json').then(r=>r.json()).then(d=>document.querySelector('#network-result').textContent=window.networkScript+' '+d.value);fetch('${networkOrigin}/denied.json').then(()=>window.corsBlocked=false,()=>window.corsBlocked=true);document.fonts.ready.then(()=>window.fontLoaded=${font?"document.fonts.check('16px PreviewFixture')":'null'});</script>`)
    await writeFile(join(resources,'stalled.html'),`<!doctype html><h1 id="partial">Partial content remains</h1><script src="${networkOrigin}/hang.js"></script>`)
    const userData = join(fixture, 'user-data')
    await mkdir(join(userData, 'managed-skill-library'), { recursive: true })
    await writeFile(join(fixture, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('previewFixture',{call:(method,args)=>ipcRenderer.invoke('preview-fixture',method,args)});`)
    const alias = { '@contracts': join(root, 'packages/contracts/src/index.ts') }
    await build({ configFile: false, root: source, base: './', logLevel: 'error', plugins: [react()], resolve: { alias }, build: { outDir: join(fixture, 'renderer'), minify: false } })
    await build({ configFile: false, logLevel: 'error', resolve: { alias }, ssr: { noExternal: ['parse5', 'entities'] }, build: { ssr: join(source, 'main.ts'), outDir: join(fixture, 'main'), minify: false, rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: 'main.cjs' } } } })
    const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete env.ELECTRON_RUN_AS_NODE
    console.log(`Isolated HTML acceptance: ${userData}; Skill Library: ${join(userData, 'managed-skill-library')}; no Core/Runtime`)
    child = spawn(electron, [join(fixture, 'main/main.cjs'), join(fixture, 'renderer/index.html'), userData, resources, join(fixture, 'preload.cjs'), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', report
    const timeout = setTimeout(() => child.kill('SIGKILL'), 50_000)
    child.stdout.on('data', chunk => {
      output += chunk.toString()
      const line = output.split('\n').find(line => line.startsWith('{"htmlPreviewAcceptance":'))
      if (line) { try { report = JSON.parse(line); setTimeout(() => child.kill('SIGKILL'), 1000).unref() } catch {} }
    })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    await new Promise(resolve => child.once('exit', resolve))
    clearTimeout(timeout)
    assert.ok(report, output)
    console.log(JSON.stringify(report))
    assert.equal(report.ok, true, JSON.stringify(report))
  } finally {
    if(network){network.closeAllConnections();await new Promise(resolve=>network.close(resolve))}
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    if (process.env.ROVAI_KEEP_HTML_PREVIEW_FIXTURE === '1') console.log(`HTML fixture: ${fixture}`)
    else await rm(fixture, { recursive: true, force: true })
  }
})
