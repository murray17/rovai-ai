import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import react from '@vitejs/plugin-react'
import electron from 'electron'
import { build } from 'vite'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'

const root = resolve(import.meta.dirname, '../..')
const fixtureSource = join(root, 'scripts/fixtures/structured-mention-composer')

test('Composer edits preserve text, structured tokens and Skill query interactions', {
  timeout: 60_000
}, async (t) => {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-composer-input-test-'))
  let child
  let closed
  try {
    await build({
      configFile: false,
      root: fixtureSource,
      base: './',
      logLevel: 'error',
      plugins: [react()],
      resolve: { alias: { '@contracts': join(root, 'packages/contracts/src/index.ts') } },
      build: { outDir: join(fixture, 'renderer'), minify: false }
    })
    await build({
      configFile: false,
      logLevel: 'error',
      build: {
        outDir: join(fixture, 'main'),
        ssr: join(root, 'apps/desktop/src/main/web-link-window-handler.ts'),
        minify: false,
        rollupOptions: { output: { format: 'cjs', entryFileNames: 'web-link-window-handler.cjs' } }
      }
    })
    const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete environment.ELECTRON_RUN_AS_NODE
    child = spawn(electron, [
      join(fixtureSource, 'main.cjs'),
      join(fixture, 'renderer/index.html'),
      join(fixture, 'user-data'),
      join(fixture, 'main/web-link-window-handler.cjs'),
      // This isolated component fixture starts no Core, Runtime or network content.
      // CI/container hosts can forbid Chromium's nested process sandbox on every OS.
      '--no-sandbox'
    ], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 45_000)
    let code
    let signal
    try {
      [code, signal] = await closed
    } finally {
      clearTimeout(timeout)
    }
    assert.equal(code, 0, `Native Composer regression failed (${signal}):\n${stdout}\n${stderr}`)
    const reportLine = stdout.split('\n').find(line => line.startsWith('{'))
    assert.ok(reportLine, `Native Composer fixture produced no report:\n${stdout}\n${stderr}`)
    const report = JSON.parse(reportLine)
    assert.equal(report.ok, true)
    assert.equal(report.cases.length, process.env.ROVAI_TEST_SYSTEM_BROWSER === '1' ? 50 : 49)
    console.log(stderr.split('\n').filter(line => line.includes('Link timing')).join('\n'))
    if (process.env.ROVAI_TEST_SYSTEM_BROWSER === '1') console.log(stderr.trim())
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await closed
    }
    await rm(fixture, { recursive: true, force: true })
  }
})

test('Web URL gestures open one new tab and keep the session, draft and error feedback intact', { timeout: 90_000 }, async t => {
  const executable = process.env.ROVAI_TEST_CHROME ?? (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome')
  if (!await access(executable).then(() => true, () => false)) { t.skip('Chrome unavailable'); return }
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-composer-web-'))
  const requests = []
  let browser, server
  try {
    await build({ configFile:false, root:fixtureSource, base:'./', logLevel:'error', plugins:[react()],
      resolve:{alias:{'@contracts':join(root,'packages/contracts/src/index.ts')}},
      build:{outDir:join(fixture,'renderer'),minify:false} })
    server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/opened') { requests.push(req.url); res.end('Opened by an explicit user gesture.'); return }
      try {
        const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
        res.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html')
        res.end(await readFile(join(fixture,'renderer',path)))
      } catch { res.writeHead(404); res.end() }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = 'http://127.0.0.1:' + server.address().port
    const target = origin + '/opened?x=1&y=%E4%B8%AD%E6%96%87#part'
    const page = origin + '/?url=' + encodeURIComponent(target)
    browser = await launchAcceptanceBrowser({executable,args:[
      '--headless=new','--user-data-dir='+join(fixture,'profile'),'--no-first-run','--no-default-browser-check',
      '--disable-background-networking','--remote-debugging-port=0',...(process.platform==='linux'?['--no-sandbox']:[]),'about:blank']})
    await browser.send('Emulation.setFocusEmulationEnabled',{enabled:true})
    await browser.send('Page.navigate',{url:page})
    await browser.wait('!!window.composerTest')
    const settle = () => browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
    const state = () => browser.evaluate('window.composerTest.state(false)')
    const webState = () => browser.evaluate('window.composerTest.webState()')
    const clickUrl = async (modifiers=0) => {
      const point = await browser.evaluate('window.composerTest.webPoint('+JSON.stringify(target)+',2)')
      await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point})
      await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1,modifiers})
      await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1,modifiers})
      await settle()
    }
    const button = label => browser.click('[...document.querySelectorAll(".composer-web-link-actions button")].find(b=>b.textContent==='+JSON.stringify(label)+')')
    const expectOpen = async action => {
      const count = requests.length
      await action()
      let targets = []
      for (let i=0;i<40;i++) {
        targets = (await browser.send('Target.getTargets')).targetInfos.filter(info=>info.url===target)
        if (targets.length && requests.length > count) break
        await pause(50)
      }
      assert.equal(targets.length,1,'Exactly one new tab for one gesture')
      assert.equal(requests.length,count+1)
      assert.equal(requests.at(-1),'/opened?x=1&y=%E4%B8%AD%E6%96%87')
      assert.equal(await browser.evaluate('location.href'),page)
      assert.equal((await webState()).error,null,'A successful noopener null result must not show a failure')
      await browser.send('Target.closeTarget',{targetId:targets[0].targetId})
    }
    await expectOpen(()=>browser.click('document.querySelector("#web-user a")'))
    await expectOpen(()=>browser.click('document.querySelector("#web-agent a")'))
    await browser.evaluate('window.composerTest.reset('+JSON.stringify(target)+')')
    await settle()
    const before = await state()
    await clickUrl()
    assert.equal((await webState()).popup,target)
    assert.equal((await state()).focused,true)
    await button('复制链接')
    assert.equal((await webState()).copied.at(-1),target)
    await expectOpen(()=>button('打开链接'))
    await expectOpen(()=>clickUrl(process.platform==='darwin'?4:2))
    const after = await state()
    assert.equal(after.localVersion,before.localVersion)
    assert.equal(after.saveCount,before.saveCount)
    assert.equal(after.text,before.text)

    for (const theme of ['day','night']) {
      await browser.evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme))
      await clickUrl()
      const geometry = await browser.evaluate('(()=>{const p=document.querySelector(".composer-web-link-actions"),r=p.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:document.documentElement.scrollWidth>innerWidth,background:getComputedStyle(p).backgroundColor}})()')
      assert.ok(geometry.left>=0 && geometry.right<=1440 && geometry.top>=0 && geometry.bottom<=920,JSON.stringify(geometry))
      assert.equal(geometry.overflow,false)
      if (process.env.ROVAI_WEB_LINK_OUTPUT) {
        await mkdir(process.env.ROVAI_WEB_LINK_OUTPUT,{recursive:true})
        await browser.capture(join(process.env.ROVAI_WEB_LINK_OUTPUT,'web-links-'+theme+'.png'))
      }
    }
    await browser.evaluate('window.fixtureOpen=window.open; window.open=()=>{throw new Error("explicit failure")}; true')
    await button('打开链接')
    await browser.wait('document.querySelector(".app-toast")?.textContent.includes("无法打开链接")')
    assert.equal((await state()).localVersion,before.localVersion)
    await browser.evaluate('window.open=window.fixtureOpen; window.rovai.clipboard.write=async()=>{throw new Error("copy")}; Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async()=>{throw new Error("copy")}}}); document.execCommand=()=>false; true')
    await button('复制链接')
    await browser.wait('document.querySelector(".app-toast")?.textContent.includes("复制失败")')
    assert.equal((await state()).text,before.text)
    assert.equal((await state()).localVersion,before.localVersion)
    assert.deepEqual(browser.errors,[])
    console.log(JSON.stringify({webLinks:true,newTabs:requests.length,themeGeometry:['day','night'],draftUnchanged:true,explicitFailures:true}))
  } finally {
    await browser?.close()
    await new Promise(resolve => server ? server.close(resolve) : resolve())
    await rm(fixture,{recursive:true,force:true})
  }
})
