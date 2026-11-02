import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import react from '@vitejs/plugin-react'
import electron from 'electron'
import { build } from 'vite'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

const root = resolve(import.meta.dirname, '../..')
const fixtureSource = join(root, 'scripts/fixtures/single-chat-panel')

test('Single Chat entry count loads and stays current while the panel is closed', { timeout: 90_000 }, t => runFixture(t, '--entry-count'))
test('Single Chat input history preserves drafts and sends preview as a new pending input', { timeout: 90_000 }, t => runFixture(t, '--input-history'))

test('production Single Chat panel preserves private conversation layout and terminal disclosure', { timeout: 90_000 }, t => runFixture(t))
test('Single Chat return to latest keeps reading and pressed geometry stable', { timeout: 90_000 }, t => runFixture(t, '--return-latest'))
test('Single Chat pending withdrawal recovers a lost receipt and fences navigation', { timeout: 90_000 }, t => runFixture(t, '--pending-return'))
test('Single Chat literal links and native textarea gestures preserve editing and recovery', { timeout: 90_000 }, t => runFixture(t, '--web-links'))

async function runFixture(t, mode = '--panel') {
  if (!admitElectronIntegrationTest(t)) return
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-single-chat-panel-test-'))
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
    const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
    delete environment.ELECTRON_RUN_AS_NODE
    child = spawn(electron, [
      join(fixtureSource, 'main.cjs'),
      join(fixture, 'renderer/index.html'),
      join(fixture, 'user-data'),
      mode,
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
    ], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    closed = once(child, 'close')
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk.toString() })
    child.stderr.on('data', (chunk) => { output += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 75_000)
    let code
    try {
      [code] = await closed
    } finally {
      clearTimeout(timeout)
    }
    assert.equal(code, 0, `Single Chat native UI regression failed:\n${output}`)
    const reportLine = output.split('\n').find((line) => line.startsWith('{') && line.includes('"verified"'))
    assert.ok(reportLine, `Single Chat native UI report was missing:\n${output}`)
    const report = JSON.parse(reportLine)
    assert.equal(report.ok, true)
    if (mode === '--entry-count') {
      assert.deepEqual(report.verified, {
        initialCount: true, closedPanelEvents: true, invalidation: true,
        noIdlePolling: true, noHiddenTranscriptReads: true, runningState: true, lateReadFence: true
      })
      process.stdout.write(`${JSON.stringify(report)}\n`)
      return
    }
    if (mode === '--input-history') {
      assert.deepEqual(report.verified, { inputHistory: true, previewSend: true, draftRecovery: true })
      return
    }
    if (mode === '--web-links') {
      assert.deepEqual(report.verified, { literalMessages: true, textareaLinks: true, blankAreaEditing: true, editingRecovery: true, noExtraWrites: true })
      process.stdout.write(`${JSON.stringify(report)}\n`)
      return
    }
    if (mode === '--return-latest') {
      assert.deepEqual(report.verified, { readingPosition: true, pressedGeometry: true, localReturn: true, keyboardReturn: true })
      process.stdout.write(`${JSON.stringify(report)}\n`)
      return
    }
    if (mode === '--pending-return') {
      assert.deepEqual(report.verified, { withdrawalRecovery: true, navigationFence: true, identicalCommandReplay: true })
      process.stdout.write(`${JSON.stringify(report)}\n`)
      return
    }
    assert.deepEqual(report.verified, {
      selectorTriggerAndOptionAvatars: true,
      transcriptAvatarFree: true,
      rightUserLeftAgentLayout: true,
      chineseTerminalDuration: true,
      terminalExecutionAutoCollapse: true,
      groupedCommands: 3,
      thinkingLifecycle: true,
      sendAcknowledgementAndRejection: true,
      sharedToolRows: true,
      liveTailAndNarrationBoundary: true,
      resultRetryKeyboardAndPersistence: true,
      consoleTerminalAutoCollapse: true,
      waitingAndFailureStates: true,
      finalMessageExpanded: true,
      directEndConfirmation: true,
      campComposerParity: true,
      composerKeyboardSemantics: true,
      privateAttachments: true,
      privateAttachmentDragBoundary: true,
      agentMessagesWithoutFill: true,
      runningStopAndQueueComposer: true,
      dayAndNight: true,
      compactNoOverflow: true
    })
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await closed
    }
    if (process.env.ROVAI_KEEP_SINGLE_CHAT_FIXTURE === '1') {
      process.stdout.write(`Single Chat fixture: ${fixture}\n`)
    } else {
      await rm(fixture, { recursive: true, force: true })
    }
  }
}

test('Single Chat Web links open new tabs from the production messages and textarea', { timeout: 90_000 }, async t => {
  const executable = process.env.ROVAI_TEST_CHROME ?? (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome')
  if (!await access(executable).then(() => true, () => false)) { t.skip('Chrome unavailable'); return }
  const fixture = await mkdtemp(join(tmpdir(), 'rovai-single-chat-web-'))
  let browser, server
  const requests = []
  try {
    await build({ configFile:false, root:fixtureSource, base:'./', logLevel:'error', plugins:[react()],
      resolve:{alias:{'@contracts':join(root,'packages/contracts/src/index.ts')}},
      build:{outDir:join(fixture,'renderer'),minify:false} })
    server = createServer(async (req,res) => {
      const url = new URL(req.url,'http://localhost')
      if (url.pathname === '/opened') { requests.push(req.url); res.end('Opened from Single Chat.'); return }
      const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      try {
        res.setHeader('Content-Type',path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':'text/html')
        res.end(await readFile(join(fixture,'renderer',path)))
      } catch { res.writeHead(404); res.end() }
    })
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
    const origin = 'http://127.0.0.1:'+server.address().port
    const url = origin+'/opened?x=1&y=%E4%B8%AD%E6%96%87#part'
    browser = await launchAcceptanceBrowser({executable,args:[
      '--headless=new','--user-data-dir='+join(fixture,'profile'),'--no-first-run','--no-default-browser-check',
      '--disable-background-networking','--remote-debugging-port=0',...(process.platform==='linux'?['--no-sandbox']:[]),'about:blank']})
    await browser.send('Emulation.setFocusEmulationEnabled',{enabled:true})
    await browser.send('Page.navigate',{url:origin+'/'})
    await browser.wait('!!document.querySelector(".single-chat-final")')
    await browser.evaluate('window.singleChatTest.showWebLinks('+JSON.stringify(url)+')')
    await browser.wait('!!document.querySelector(".single-chat-user-bubble a")')
    const expectOpen = async action => {
      const count = requests.length
      await action()
      let targets = []
      for (let i=0;i<40;i++) {
        targets = (await browser.send('Target.getTargets')).targetInfos.filter(info=>info.url===url)
        if (targets.length && requests.length>count) break
        await pause(50)
      }
      assert.equal(targets.length,1,JSON.stringify({requests,targets,errors:browser.errors}))
      assert.equal(requests.length,count+1)
      assert.equal(requests.at(-1),'/opened?x=1&y=%E4%B8%AD%E6%96%87')
      assert.equal(await browser.evaluate('location.href'),origin+'/')
      assert.equal(await browser.evaluate('!!document.querySelector(".app-toast")'),false)
      await browser.send('Target.closeTarget',{targetId:targets[0].targetId})
    }
    const clickLink = async selector => {
      const expression = 'document.querySelector('+JSON.stringify(selector)+')'
      await browser.evaluate(expression+'.scrollIntoView({block:"center",behavior:"instant"})')
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))')
      // Wrapped inline anchors have empty space inside their union bounding box.
      const point = await browser.evaluate('(()=>{const r='+expression+'.getClientRects()[0];return {x:r.left+5,y:r.top+r.height/2}})()')
      await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point})
      await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1})
      await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1})
    }
    await expectOpen(()=>clickLink('.single-chat-user-bubble a'))
    await expectOpen(()=>clickLink('.single-chat-final a'))
    const input = 'document.querySelector(".single-chat-composer textarea")'
    await browser.evaluate(input+'.focus()')
    await browser.send('Input.insertText',{text:url})
    await browser.wait(input+'.value==='+JSON.stringify(url))
    const before = await browser.evaluate('window.singleChatTest.webState()')
    const clickInput = async (modifiers=0) => {
      const point = await browser.evaluate('(()=>{const n='+input+',r=n.getBoundingClientRect(),s=getComputedStyle(n);return {x:r.left+parseFloat(s.paddingLeft)+14,y:r.top+parseFloat(s.paddingTop)+parseFloat(s.lineHeight)/2}})()')
      await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1,modifiers})
      await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1,modifiers})
    }
    await clickInput()
    await browser.wait('!!document.querySelector(".composer-web-link-actions")')
    const selected = await browser.evaluate('window.singleChatTest.webState()')
    assert.equal(selected.focused,true)
    assert.equal(selected.start,selected.end)
    await browser.click('document.querySelector(".composer-web-link-buttons button:nth-child(2)")')
    assert.equal((await browser.evaluate('window.singleChatTest.webState()')).copied.at(-1),url)
    for (const theme of ['day','night']) {
      await browser.evaluate('document.documentElement.dataset.theme='+JSON.stringify(theme))
      const geometry = await browser.evaluate('(()=>{const r=document.querySelector(".composer-web-link-actions").getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}})()')
      assert.ok(geometry.x>=0 && geometry.y>=0 && geometry.right<=1440 && geometry.bottom<=920)
      if (process.env.ROVAI_WEB_LINK_OUTPUT) {
        await mkdir(process.env.ROVAI_WEB_LINK_OUTPUT,{recursive:true})
        await browser.capture(join(process.env.ROVAI_WEB_LINK_OUTPUT,'single-chat-web-links-'+theme+'.png'))
      }
    }
    await expectOpen(()=>browser.click('document.querySelector(".composer-web-link-buttons button:first-child")'))
    await expectOpen(()=>clickInput(4)) // The fixture advertises the macOS platform.
    const after = await browser.evaluate('window.singleChatTest.webState()')
    assert.equal(after.value,before.value)
    assert.equal(after.recoveryWrites,before.recoveryWrites)
    assert.equal(after.revision,before.revision)
    assert.equal(after.sends.length,0)
    assert.deepEqual(browser.errors,[])
    console.log(JSON.stringify({singleChatWeb:true,newTabs:requests.length,literalMessages:true,nativeTextarea:true,draftUnchanged:true}))
  } finally {
    await browser?.close()
    await new Promise(resolve => server ? server.close(resolve) : resolve())
    await rm(fixture,{recursive:true,force:true})
  }
})
