import assert from 'node:assert/strict'
import test from 'node:test'
import { cp, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchHost, within } from './host-test-client.mjs'
import { launchAcceptanceBrowser } from './host-web-browser.mjs'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './runtime-camp-files-root.mjs'

test('phone Memory uses production Web navigation and real Host writes', { timeout: 90_000 }, async () => {
  const repository = resolve(import.meta.dirname, '../..')
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-memory-web-')))
  const dataDir = join(fixture, 'core'), output = process.env.ROVAI_MEMORY_WEB_OUTPUT ?? join(fixture, 'evidence')
  await mkdir(output, { recursive: true })
  console.log(JSON.stringify({ dataDir, skillLibraryRoot: join(dataDir,'skills'), mcpConfigPath: join(dataDir,'mcp.json'), runtime: false }))
  const host = launchHost(process.env.ROVAI_HOST_BIN ?? join(repository,'target/debug/rovai-host'), [...coreDataDirectoryArguments(dataDir),'--skill-library-root',join(dataDir,'skills'),'--mcp-config-path',join(dataDir,'mcp.json')], { cwd: repository })
  let b
  try {
    await within(host.ready)
    const uiDirectory = join(fixture,'web')
    await cp(process.env.ROVAI_WEB_UI ?? join(repository,'out/web'),uiDirectory,{recursive:true})
    const service = await host.request('host.web.start',{listen:'127.0.0.1:0',uiDirectory})
    b = await launchAcceptanceBrowser({ executable: process.env.ROVAI_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args:['--headless=new',`--user-data-dir=${join(fixture,'chrome')}`,'--no-first-run','--disable-background-networking','--remote-debugging-port=0',...(process.platform==='linux'?['--no-sandbox']:[]),'about:blank'] })
    await b.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
    await b.send('Emulation.setTouchEmulationEnabled',{enabled:true})
    const click = selector => b.click(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(element => element.getClientRects().length)`)
    const button = async label => { const target=`[...document.querySelectorAll('button')].find(e=>e.getClientRects().length && e.textContent.trim()===${JSON.stringify(label)})`; await b.wait(`Boolean(${target}) && !(${target}).disabled`); await b.click(target) }
    const fill = async (selector,value) => { await click(selector); await b.evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`); await b.send('Input.insertText',{text:value}) }
    const page = async label => {
      if (await b.evaluate('[...document.querySelectorAll("[aria-label=返回设置]")].some(element => element.getClientRects().length)')) await click('[aria-label="返回设置"]')
      await click('[aria-label="打开主菜单"]'); await b.wait('!!document.querySelector("#mobile-app-menu")')
      await button(label === '记忆' ? '设置' : label); await b.wait('!document.querySelector("#mobile-app-menu")?.getClientRects().length')
      if (label === '记忆') {
        await b.wait('[...document.querySelectorAll("[data-setting=memory]")].some(element => element.getClientRects().length)')
        await click('[data-setting="memory"]')
      }
    }
    await b.send('Page.navigate',{url:service.origin})
    await b.wait('!!document.querySelector("#administrator-token")')
    await fill('#administrator-token',service.administratorToken); await click('.web-login button[type=submit]')
    await b.wait('!!document.querySelector("[aria-label=打开主菜单]")')
    await page('记忆'); await b.wait('!!document.querySelector(".memory-library:not([aria-busy=true])")')
    assert.equal(await b.evaluate('document.querySelector("[data-memory-scope=all]").getAttribute("aria-pressed")'),'true')
    assert.equal(await b.evaluate('!!document.querySelector(".memory-capacity-strip,.memory-governance-tabs")'),false)
    await button('新增'); await fill('.memory-editor-dialog textarea','手机创建的正文，完整保留。'); await fill('#memory-key-input','手机记忆'); await button('保存记忆')
    await b.wait('!document.querySelector(".memory-editor-dialog") && !!document.querySelector(".memory-library[data-mobile-detail]")')
    assert.equal(await b.evaluate('document.querySelector(".memory-detail-body").textContent'),'手机创建的正文，完整保留。')
    assert.ok((await host.request('memory.list')).memories.some(m=>m.currentBody==='手机创建的正文，完整保留。'))
    await click('[aria-label="返回记忆列表"]'); await b.wait('!document.querySelector(".memory-library[data-mobile-detail]")')
    await page('队员'); await page('记忆'); await b.wait('!!document.querySelector(".memory-catalog-item")')
    assert.equal(await b.evaluate('!!document.querySelector(".memory-library[data-mobile-detail]")'),false)
    await click('.memory-catalog-item'); await b.wait('!!document.querySelector(".memory-library[data-mobile-detail]")')
    await button('修订'); await fill('.memory-editor-dialog textarea','手机修订后的完整正文。'); await button('保存修订')
    await b.wait('document.querySelector(".memory-detail-body")?.textContent === "手机修订后的完整正文。"')
    const record=(await host.request('memory.list')).memories.find(m=>m.currentBody==='手机修订后的完整正文。')
    assert.equal(record.revisions.length,2)
    await click('.memory-detail-disclosure > summary'); await click('.memory-revisions > summary')
    assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth'),false)
    await b.capture(join(output,'phone-memory-details.png'))
    await click('[aria-label="返回记忆列表"]'); await b.wait('!document.querySelector(".memory-library[data-mobile-detail]")')
    await b.capture(join(output,'phone-memory-list.png'))
    const capability = await host.request('preferences.memory.get')
    assert.deepEqual(Object.keys(capability).sort(), ['enabled','headsUpAfterGlobalSequence','observedThroughChangeSequence'].sort())
    await host.request('preferences.memory.set',{enabled:false})
    await b.wait('document.querySelector(".memory-capability-state")?.textContent.includes("已关闭")')
    assert.equal(await b.evaluate('!!document.querySelector(".memory-catalog,.memory-detail")'),false)
    await click('.memory-capability-switch')
    await b.wait('!!document.querySelector(".memory-catalog-item")')
    assert.equal((await host.request('preferences.memory.get')).enabled,true)
    assert.ok((await host.request('memory.list')).memories.some(m=>m.currentBody==='手机修订后的完整正文。'))
    assert.deepEqual(b.errors,[])
    await writeFile(join(output,'report.json'),JSON.stringify({productionWeb:true,realHost:true,runtime:false,create:true,revise:true,revisions:2,backAndReentry:true,noOverflow:true,threeFieldCapability:true,remoteDisableAndPageEnable:true},null,2))
  } catch(error) { await b?.capture(join(output,'failure.png')).catch(()=>{}); throw error }
  finally { await b?.close(); await host.close(); await removeEphemeralRuntimeCampFilesRoot(dataDir,{temporaryDirectory:fixture}); await rm(fixture,{recursive:true,force:true}) }
})
