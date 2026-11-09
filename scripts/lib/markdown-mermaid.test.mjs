import assert from 'node:assert/strict'
import test from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import electron from 'electron'
import { admitElectronIntegrationTest } from './electron-sandbox-capability.mjs'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

const repo = resolve(import.meta.dirname, '../..')
const run = promisify(execFile)

test('production Mermaid reading, recovery and resource boundary on Web and Electron', { timeout: 240_000 }, async t => {
  if (!admitElectronIntegrationTest(t)) return
  const root = await mkdtemp(join(tmpdir(), 'rovai-mermaid-'))
  const build = join(root, 'build')
  const evidence = process.env.ROVAI_MERMAID_OUTPUT ?? join(root, 'evidence')
  await mkdir(evidence, { recursive: true })
  await run(process.execPath, [join(repo, 'scripts/fixtures/markdown-mermaid/build.mjs'), build], { maxBuffer: 4 * 1024 * 1024 })
  const leaks = []
  const server = createServer(async (request, response) => {
    if (request.url.startsWith('/leak/')) { leaks.push(request.url); response.end('<svg xmlns="http://www.w3.org/2000/svg"/>'); return }
    if (request.url === '/health') { response.end('ready'); return }
    try {
      // Match the production Host policy: srcdoc inherits this script restriction.
      response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
      const file = join(build, request.url === '/' ? 'index.html' : request.url)
      response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html')
      response.end(await readFile(file))
    } catch { response.statusCode = 404; response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  assert.equal(await fetch(origin + '/health').then(response => response.text()), 'ready')
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })

  for (const host of ['web', 'desktop']) await t.test(host, async () => {
    const profile = join(root, host, 'user-data')
    await mkdir(join(profile, 'managed-skill-library'), { recursive: true })
    console.log(JSON.stringify({ channel: 'automatic_acceptance', host, userData: profile, skillLibraryRoot: join(profile, 'managed-skill-library'), runtime: false }))
    const browser = await launchAcceptanceBrowser({
      executable: host === 'desktop' ? electron : (process.env.ROVAI_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      args: host === 'desktop'
        ? [join(repo, 'scripts/fixtures/markdown-mermaid/main.cjs'), `--mermaid-page=${join(build, 'index.html')}`, `--user-data-dir=${profile}`, '--remote-debugging-port=0']
        : ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', 'about:blank']
    })
    const b = browser
    try {
      if (host === 'web') await b.send('Page.navigate', { url: origin })
      await b.wait('!!window.mermaidFixture')
      await b.send('Emulation.setFocusEmulationEnabled', { enabled: true })
      await b.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })
      await b.evaluate(`window.liveURLs=new Set(); window.svgSources=[]; window.originalCreate=URL.createObjectURL; window.originalRevoke=URL.revokeObjectURL;
        URL.createObjectURL=function(blob){const url=originalCreate.call(URL,blob);liveURLs.add(url);svgSources.push(blob.text());return url};
        URL.revokeObjectURL=function(url){liveURLs.delete(url);return originalRevoke.call(URL,url)};`)
      const button = (label, scope = '.markdown-mermaid') => b.click(`Array.from(document.querySelectorAll(${JSON.stringify(scope + ' button')})).find(e => e.textContent.trim() === ${JSON.stringify(label)} || e.getAttribute('aria-label') === ${JSON.stringify(label)})`)
      const setSample = name => b.evaluate(`mermaidFixture.setSource(mermaidFixture.fence(mermaidFixture.samples.${name}))`)
      const ready = () => b.wait(`document.querySelector('.markdown-mermaid')?.dataset.mermaidState === 'ready'`)
      const error = () => b.wait(`document.querySelector('.markdown-mermaid')?.dataset.mermaidState === 'error'`)
      const readerChecks = { sourceTheme: [], keyboardFocus: [], failedSource: [] }
      const tab = async () => {
        for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
      }
      const visibleFocus = async label => {
        const focus = await b.evaluate(`(() => { const e=document.activeElement; const style=getComputedStyle(e); return {
          label:e.getAttribute('aria-label'),visible:e.matches(':focus-visible'),outline:style.outlineStyle,width:parseFloat(style.outlineWidth)}})()`)
        assert.equal(focus.label, label)
        assert.equal(focus.visible, true)
        assert.equal(focus.outline, 'solid')
        assert.equal(focus.width, 2, 'Keyboard focus must have a visible outline')
        readerChecks.keyboardFocus.push(focus)
      }
      const expandFailedSource = async reason => {
        const count = await b.evaluate('svgSources.length')
        await button('展开源码')
        await b.wait('!!document.querySelector(".markdown-mermaid-dialog .cm-content")')
        assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid").dataset.mermaidView'), 'source')
        assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid-reader-source").dataset.active'), 'true')
        assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid-dialog [aria-label=查看图形]").disabled'), true)
        assert.equal(await b.evaluate('!!document.querySelector(".markdown-mermaid-reader-image img")'), false)
        await b.click('document.querySelector(".markdown-mermaid-dialog .markdown-code-copy")')
        await b.wait('document.querySelector(".markdown-mermaid-dialog .markdown-code-copy").dataset.copyState==="copied"')
        assert.equal(await b.evaluate('navigator.clipboard.readText()'), await b.evaluate('document.querySelector(".markdown-mermaid pre").textContent'))
        assert.equal(await b.evaluate('svgSources.length'), count, 'Reading failed source must not retry rendering')
        await b.key('Escape'); await b.wait('!document.querySelector(".markdown-mermaid-dialog")')
        await b.wait('document.activeElement?.getAttribute("aria-label")==="展开源码"')
        readerChecks.failedSource.push({ reason, expanded: true, copied: true, rerendered: false, focusReturned: true })
      }

      assert.equal(await b.evaluate('!!document.querySelector("[data-mermaid-renderer]")'), false)
      assert.equal(await b.evaluate('performance.getEntriesByType("resource").some(e=>e.name.includes("mermaid-sandbox"))'), false)
      await b.evaluate('mermaidFixture.setMessage(true);mermaidFixture.setSource(mermaidFixture.fence(mermaidFixture.samples.flow))')
      await b.wait('!!document.querySelector("pre")')
      assert.equal(await b.evaluate('!!document.querySelector(".markdown-mermaid, [data-mermaid-renderer]")'), false)
      assert.equal(await b.evaluate('performance.getEntriesByType("resource").some(e=>e.name.includes("mermaid-sandbox"))'), false)
      await b.evaluate('mermaidFixture.setChat(true);mermaidFixture.setSource("```mermaid\\ngraph TD\\n A-->B")')
      await b.wait('document.querySelector(".markdown-mermaid")?.dataset.mermaidState==="pending"')
      await pause(80)
      assert.equal(await b.evaluate('!!document.querySelector("[data-mermaid-renderer]")'), false, 'An open streaming block does not start the engine')
      assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid").textContent.includes("正在绘制")'), false)
      assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid [aria-label=展开源码]").disabled'), true)
      await b.evaluate('mermaidFixture.setChat(false)')
      if (host === 'desktop') {
        // The first local read never settles. A new generation must read again.
        await b.evaluate(`window.originalFetch=window.fetch; window.originalTimeout=window.setTimeout; window.scriptReads=0;
          window.fetch=(url,...args)=>{if(String(url).includes('mermaid.min')){scriptReads++;if(scriptReads===1)return new Promise(()=>{})}return originalFetch(url,...args)};
          window.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===15000?300:ms,...args);
          mermaidFixture.setMessage(false);mermaidFixture.setSource(mermaidFixture.fence(mermaidFixture.samples.flow))`)
        await error()
        await b.evaluate('window.setTimeout=originalTimeout')
        await button('重试'); await ready()
        assert.equal(await b.evaluate('scriptReads'), 2)
        await b.evaluate('window.fetch=originalFetch;mermaidFixture.setSource("普通文档");svgSources=[]')
      }
      await b.evaluate('mermaidFixture.setMessage(false);mermaidFixture.setSource(mermaidFixture.document)')
      await b.wait('document.querySelectorAll("[data-mermaid-state=ready]").length===8 && document.querySelectorAll("[data-mermaid-state=error]").length===1', 30_000)
      assert.equal(await b.evaluate('document.querySelectorAll("[data-mermaid-renderer]").length'), 1)
      assert.equal(await b.evaluate('typeof window.mermaid'), 'undefined')
      assert.equal(await b.evaluate('document.querySelector("[data-mermaid-renderer]").contentDocument'), null)
      const svg = await b.evaluate('svgSources[0]')
      assert.ok(svg.includes('入口') && svg.includes('中文标签') && svg.includes('<marker'))
      assert.ok(!/foreignObject|<script|<image\b/.test(svg))
      const labels = await b.evaluate(`Promise.all(svgSources).then(svgs=>svgs.map(svg=>[...new DOMParser().parseFromString(svg,'image/svg+xml').querySelectorAll('text')].map(e=>e.textContent).join(' ')))`)
      for (const [index, expected] of [['入口', '中文标签'], ['开始', '结束'], ['用户', '系统', '打开文档'],
        ['Document', 'Preview', 'title'], ['Ready', 'Loading', '刷新'], ['DOCUMENT', 'DIAGRAM', 'contains'],
        ['步骤', '文档审阅'], ['步骤', '继续审阅']].entries()) {
        for (const label of expected) assert.ok(labels[index].includes(label), `Diagram ${index} retained label ${label}`)
      }
      await b.capture(join(evidence, `${host}-document.png`))

      // Stable component identity, explicit source preference, and original copy.
      await setSample('flow'); await ready()
      await button('查看源码')
      await b.evaluate('window.oldBlock=document.querySelector(".markdown-mermaid");mermaidFixture.setTheme("night")')
      await ready()
      assert.equal(await b.evaluate('oldBlock===document.querySelector(".markdown-mermaid")'), true)
      assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid").dataset.mermaidView'), 'source')
      await setSample('graph'); await ready()
      assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid").dataset.mermaidView'), 'source')
      assert.ok((await b.evaluate('mermaidFixture.findText()')).includes('graph LR'))
      assert.ok(!(await b.evaluate('mermaidFixture.findText()')).includes('查看图形'))
      await b.click('document.querySelector(".markdown-code-copy")')
      await b.wait('document.querySelector(".markdown-code-copy").dataset.copyState === "copied"')
      assert.equal(await b.evaluate('navigator.clipboard.readText()'), await b.evaluate('mermaidFixture.samples.graph+"\\n"'))
      await button('查看图形')
      assert.ok(!(await b.evaluate('mermaidFixture.findText()')).includes('graph LR'))

      // Theme restoration must retain both axes in the source reader, not only the image.
      const longSource = 'flowchart TD\n A[开始] --> B[完成]\n' + Array.from({ length: 100 }, (_, i) => `%% ${i}: ${'long Mermaid source '.repeat(15)}`).join('\n')
      assert.ok(Buffer.byteLength(longSource) < 32_000)
      readerChecks.sourceBytes = Buffer.byteLength(longSource)
      await b.evaluate(`mermaidFixture.setTheme('day');mermaidFixture.setSource(mermaidFixture.fence(${JSON.stringify(longSource)}))`); await ready()
      await button('查看源码'); await button('展开源码')
      await b.wait('document.querySelector(".markdown-mermaid-reader-source .cm-scroller")?.scrollHeight>1000')
      await b.evaluate('window.sourceEditor=document.querySelector(".markdown-mermaid-reader-source .cm-editor");window.sourceScroll=sourceEditor.querySelector(".cm-scroller");sourceScroll.scrollTop=800;sourceScroll.scrollLeft=240')
      await pause(100)
      const sourceReading = () => b.evaluate(`(() => {const line=[...sourceEditor.querySelectorAll('.cm-line')].find(e=>e.getBoundingClientRect().bottom>sourceScroll.getBoundingClientRect().top);return {left:sourceScroll.scrollLeft,line:line?.textContent}})()`)
      const sourcePosition = await sourceReading()
      assert.equal(sourcePosition.left, 240)
      for (const theme of ['night', 'day']) {
        await b.evaluate(`mermaidFixture.setTheme(${JSON.stringify(theme)})`); await ready(); await pause(100)
        assert.equal(await b.evaluate('sourceEditor===document.querySelector(".markdown-mermaid-reader-source .cm-editor")'), true)
        const after = await sourceReading()
        assert.deepEqual(after, sourcePosition, 'Theme replacement retains the source line and horizontal offset')
        readerChecks.sourceTheme.push({ theme, before: sourcePosition.left, after: after.left, visibleLineRetained: after.line === sourcePosition.line })
      }
      await b.capture(join(evidence, `${host}-source-theme.png`))
      await b.key('Escape'); await b.wait('!document.querySelector(".markdown-mermaid-dialog")')
      await setSample('graph'); await ready(); await button('查看图形')

      // Real Tab navigation checks visible styling as well as the focus target.
      await b.evaluate('document.querySelector(".markdown-mermaid [aria-label=查看图形]").focus()')
      for (const label of ['查看源码', '查看大图', '查看 Mermaid 大图']) { await tab(); await visibleFocus(label) }
      await b.capture(join(evidence, `${host}-image-focus.png`))
      await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
      await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await b.wait('!!document.querySelector(".markdown-mermaid-dialog")')
      await b.evaluate('document.querySelector(".markdown-mermaid-dialog [aria-label=查看图形]").focus()')
      for (const label of ['查看源码', '关闭大图']) { await tab(); await visibleFocus(label) }
      await b.evaluate('Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))')
      await b.capture(join(evidence, `${host}-dialog-focus.png`))
      await b.key('Escape'); await b.wait('!document.querySelector(".markdown-mermaid-dialog")')
      await b.evaluate('mermaidFixture.setTheme("night")'); await ready()

      // Same decoded URL in the dialog, full overflow access and keyboard closure.
      for (const name of ['wide', 'tall']) {
        await setSample(name); await ready()
        assert.equal(await b.evaluate('mermaidFixture.findSupported()'), true)
        assert.ok(await b.evaluate('document.querySelector(".markdown-mermaid-image").getBoundingClientRect().height') <= 360)
        await button('查看大图')
        await b.wait('!!document.querySelector(".markdown-mermaid-dialog img")')
        assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid-dialog img").src===document.querySelector(".markdown-mermaid-image").src'), true)
        await button('100%', '.markdown-mermaid-dialog')
        await b.wait('document.querySelector(".file-preview-image-content img").naturalWidth>0')
        await pause(80)
        assert.equal(await b.evaluate(`(() => {const e=document.querySelector('.file-preview-image-scroll');return ${name === 'wide' ? 'e.scrollWidth>e.clientWidth' : 'e.scrollHeight>e.clientHeight'}})()`), true)
        await b.evaluate(`document.querySelector('.file-preview-image-scroll').${name === 'wide' ? 'scrollLeft' : 'scrollTop'}=100000`)
        assert.ok(await b.evaluate(`document.querySelector('.file-preview-image-scroll').${name === 'wide' ? 'scrollLeft' : 'scrollTop'}`) > 0)
        const reading = () => b.evaluate(`(() => {const e=document.querySelector('.file-preview-image-scroll');return {
          left:e.scrollLeft,top:e.scrollTop,scale:document.querySelector('.file-preview-image-info').textContent.split(' · ').at(-1)}})()`)
        const before = await reading()
        const renderCount = await b.evaluate('svgSources.length')
        await button('查看源码', '.markdown-mermaid-dialog')
        await b.wait('!!document.querySelector(".markdown-mermaid-reader-source .cm-content")')
        assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid-reader-image").inert'), true)
        await b.click('document.querySelector(".markdown-mermaid-dialog .markdown-code-copy")')
        await b.wait('document.querySelector(".markdown-mermaid-dialog .markdown-code-copy").dataset.copyState==="copied"')
        assert.equal(await b.evaluate('navigator.clipboard.readText()'), await b.evaluate(`mermaidFixture.samples.${name}+"\\n"`))
        if (name === 'wide') {
          await b.evaluate(`window.originalWrite=navigator.clipboard.writeText.bind(navigator.clipboard);window.originalExec=document.execCommand.bind(document);
            navigator.clipboard.writeText=async()=>{throw Error('denied')};document.execCommand=()=>false;`)
          await b.click('document.querySelector(".markdown-mermaid-dialog .markdown-code-copy")')
          await b.wait('!!document.querySelector(".markdown-code-manual textarea")')
          await b.wait('document.activeElement===document.querySelector(".markdown-code-manual textarea")')
          assert.equal(await b.evaluate('document.querySelector(".markdown-code-manual textarea").value'), await b.evaluate('mermaidFixture.samples.wide+"\\n"'))
          await b.evaluate('navigator.clipboard.writeText=originalWrite;document.execCommand=originalExec')
          await b.evaluate('Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))')
          await b.key('Escape'); await b.wait('!document.querySelector(".markdown-code-manual")')
          await b.wait('document.activeElement===document.querySelector(".markdown-mermaid-dialog .markdown-code-copy")')
        }
        await b.capture(join(evidence, `${host}-${name}-source.png`))
        await button('查看图形', '.markdown-mermaid-dialog')
        assert.deepEqual(await reading(), before, 'Switching to source and back retains the image viewport')
        assert.equal(await b.evaluate('svgSources.length'), renderCount, 'Opening and switching the reader does not render again')
        const previousUrl = await b.evaluate('document.querySelector(".markdown-mermaid-dialog img").src')
        await b.evaluate(`mermaidFixture.setTheme(${JSON.stringify(name === 'wide' ? 'day' : 'night')})`)
        await ready()
        await b.wait(`document.querySelector('.markdown-mermaid-dialog img')?.src !== ${JSON.stringify(previousUrl)}`)
        await pause(100)
        assert.deepEqual(await reading(), before, 'Theme replacement retains the enlarged image reading position')
        await b.capture(join(evidence, `${host}-${name}.png`))
        await b.key('Escape'); await b.wait('!document.querySelector(".markdown-mermaid-dialog")')
        await b.wait('document.activeElement?.getAttribute("aria-label") === "查看大图"')
        assert.equal(await b.evaluate('mermaidFixture.findSupported()'), true, 'Closing the reader retains the original file search adapter')
      }
      await b.evaluate('window.imageOpener=document.querySelector(".markdown-mermaid-image-trigger");true')
      await b.click('imageOpener'); await b.wait('!!document.querySelector(".markdown-mermaid-dialog")')
      await b.key('Escape'); await b.wait('document.activeElement===imageOpener')
      await b.click('imageOpener'); await b.wait('!!document.querySelector(".markdown-mermaid-dialog")')
      await button('查看源码', '.markdown-mermaid-dialog')
      await b.key('Escape'); await b.wait('document.activeElement?.getAttribute("aria-label")==="展开源码"')
      await button('查看图形')
      await b.evaluate('mermaidFixture.setChat(true);mermaidFixture.setComplete(false);mermaidFixture.setSource(mermaidFixture.fence(mermaidFixture.samples.tall)+"\\n")'); await ready()
      await button('查看大图'); await b.wait('!!document.querySelector(".markdown-mermaid-dialog")')
      await b.evaluate('mermaidFixture.setSource("```mermaid\\n"+mermaidFixture.samples.tall+"\\n")')
      await b.wait('!document.querySelector(".markdown-mermaid-dialog")')
      await b.evaluate('mermaidFixture.setSource(mermaidFixture.fence(mermaidFixture.samples.tall)+"\\n")'); await ready()
      assert.equal(await b.evaluate('!!document.querySelector(".markdown-mermaid-dialog")'), false, 'A new readiness generation must not reopen an invalidated reader')
      await b.evaluate('mermaidFixture.setChat(false)'); await ready()
      await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: false })
      assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth'), false)
      await button('查看大图'); await b.wait('!!document.querySelector(".markdown-mermaid-dialog")')
      assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid-dialog").getBoundingClientRect().width<=innerWidth'), true)
      await b.evaluate('Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))')
      await b.capture(join(evidence, `${host}-narrow.png`)); await b.key('Escape')
      await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false })
      await writeFile(join(evidence, `${host}-svg-samples.json`), JSON.stringify(await b.evaluate('Promise.all(svgSources)')))

      // Actual SVG decode failure has a manual recovery path.
      await b.evaluate('window.originalDecode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=()=>Promise.reject(Error("decode"))')
      await setSample('flow'); await error()
      assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid pre").textContent'), await b.evaluate('mermaidFixture.samples.flow+"\\n"'))
      await expandFailedSource('decode')
      await b.evaluate('HTMLImageElement.prototype.decode=originalDecode')
      await button('重试'); await ready()
      assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid").dataset.mermaidView'), 'source', 'Expanding failed source records the source preference through recovery')
      await setSample('invalid'); await error(); await expandFailedSource('syntax')

      // Lose one generation's frame, without a CPU-hanging graph or network interception.
      await b.evaluate(`window.originalTimeout=window.setTimeout; window.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===15000?100:ms,...args);
        document.querySelector('[data-mermaid-renderer]').remove()`)
      await setSample('graph'); await error()
      await b.evaluate('window.setTimeout=originalTimeout')
      await button('重试'); await ready()
      await button('查看图形')

      // A superseded decode can only dispose its own candidate.
      await b.evaluate(`window.heldDecode=null;HTMLImageElement.prototype.decode=function(){HTMLImageElement.prototype.decode=originalDecode;return new Promise(resolve=>{window.heldDecode=resolve})}`)
      await setSample('flow'); await b.wait('typeof heldDecode === "function"')
      await setSample('graph'); await ready()
      const current = await b.evaluate('document.querySelector(".markdown-mermaid-image").src')
      await b.evaluate('heldDecode()'); await pause(100)
      assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid-image").src'), current)
      assert.equal(await b.evaluate('liveURLs.has(document.querySelector(".markdown-mermaid-image").src)'), true)

      // Mention projection outside a graph must not make copy depend on hidden pre.
      await b.evaluate('mermaidFixture.setChat(true);mermaidFixture.setComplete(true);mermaidFixture.setInlineMention(true);mermaidFixture.setSource("MENTION\\n\\n"+mermaidFixture.fence(mermaidFixture.samples.flow))'); await ready()
      assert.equal(await b.evaluate('!!document.querySelector(".markdown-mermaid-image") && !document.querySelector(".markdown-mermaid pre")'), true)
      await b.click('document.querySelector(".markdown-code-copy")')
      await b.wait('document.querySelector(".markdown-code-copy").dataset.copyState === "copied"')
      assert.equal(await b.evaluate('navigator.clipboard.readText()'), await b.evaluate('mermaidFixture.samples.flow+"\\n"'))
      await b.evaluate('mermaidFixture.setInlineMention(false)')

      // Feed actual chunks: the closing line is not committed until its newline.
      await b.evaluate('mermaidFixture.setChat(true);mermaidFixture.setComplete(false);window.stream="```mermaid\\n";mermaidFixture.setSource(stream)')
      const renders = await b.evaluate('svgSources.length')
      for (const chunk of ['flowchart TD\n', ' A[实时] --> B[已闭合]\n', '`', '``', '  ']) {
        await b.evaluate(`stream+=${JSON.stringify(chunk)};mermaidFixture.setSource(stream)`)
        assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid").dataset.mermaidState'), 'pending')
      }
      await pause(100)
      assert.equal(await b.evaluate('svgSources.length'), renders)
      await button('查看源码')
      await b.evaluate('stream+="\\n";mermaidFixture.setSource(stream)'); await ready()
      assert.equal(await b.evaluate('svgSources.length'), renders + 1, 'Graph appears before body completion')
      assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid").dataset.mermaidView'), 'source', 'An explicit source choice while pending survives completion')
      await button('查看图形')
      await b.evaluate('window.streamBlock=document.querySelector(".markdown-mermaid");window.streamURL=document.querySelector(".markdown-mermaid-image").src')
      await button('查看源码')
      for (const chunk of ['\n后续解释还在生成。\n\n', '```js\nconsole.log(1)\n```\n\n', '~~~mermaid\nsequenceDiagram\n A->>B: 未完成']) {
        await b.evaluate(`stream+=${JSON.stringify(chunk)};mermaidFixture.setSource(stream)`)
      }
      await pause(100)
      assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid")===streamBlock && streamBlock.dataset.mermaidView==="source"'), true)
      assert.equal(await b.evaluate('svgSources.length'), renders + 1, 'Appending prose and an unfinished second graph does not redraw the first')
      assert.equal(await b.evaluate('document.querySelectorAll("[data-mermaid-state=pending]").length'), 1)
      await b.evaluate('mermaidFixture.setTheme("day")'); await ready()
      assert.equal(await b.evaluate('streamBlock.dataset.mermaidView'), 'source')
      await b.evaluate('mermaidFixture.setComplete(true)')
      await b.wait('document.querySelectorAll("[data-mermaid-state=ready]").length===2')
      assert.equal(await b.evaluate('streamBlock.dataset.mermaidView'), 'source')
      await b.capture(join(evidence, `${host}-streaming.png`))

      for (const [opening, closing] of [
        ['> ```mermaid\n> graph TD\n> A-->B\n', '> ```'],
        ['> 1. ~~~~mermaid\n>    graph TD\n>    A-->B\n', '>    ~~~~~']
      ]) {
        await b.evaluate(`mermaidFixture.setComplete(false);mermaidFixture.setSource(${JSON.stringify(opening)})`)
        await b.wait('document.querySelector(".markdown-mermaid").dataset.mermaidState==="pending"')
        for (let count = 1; count <= closing.length; count++) {
          await b.evaluate(`mermaidFixture.setSource(${JSON.stringify(opening + closing.slice(0, count))})`)
          assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid").dataset.mermaidState'), 'pending')
        }
        await b.evaluate(`mermaidFixture.setSource(${JSON.stringify(opening + closing + '\r\n')})`); await ready()
      }

      // Removing readiness invalidates a held result even when code text is equal.
      await b.evaluate(`window.heldDecode=null;HTMLImageElement.prototype.decode=function(){HTMLImageElement.prototype.decode=originalDecode;return new Promise(resolve=>{window.heldDecode=resolve})};
        mermaidFixture.setComplete(false);mermaidFixture.setSource("\x60\x60\x60mermaid\\ngraph LR\\n A-->B\\n\x60\x60\x60\\n")`)
      await b.wait('typeof heldDecode === "function"')
      await b.evaluate('mermaidFixture.setSource("```mermaid\\ngraph LR\\n A-->B\\n")')
      await b.wait('document.querySelector(".markdown-mermaid").dataset.mermaidState==="pending"')
      await b.evaluate('heldDecode()'); await pause(100)
      assert.equal(await b.evaluate('!!document.querySelector(".markdown-mermaid-image")'), false)
      await b.evaluate('mermaidFixture.setChat(false)')

      // Real engine, reachable server, product CSP. There is no request-aborting test hook.
      const url = origin + '/leak/' + host
      const attacks = [
        `flowchart LR\n A["<script>parent.postMessage({attack:true},'*')</script>"] --> B[正常]`,
        `flowchart TD\n A[正常] --> B@{ img: "${url}/image", label: "图片", w: 80, h: 80 }`,
        `%%{init: {"securityLevel":"loose","htmlLabels":true,"dompurifyConfig":{"ADD_TAGS":["script"],"ADD_ATTR":["onerror"]},"flowchart":{"htmlLabels":true},"themeCSS":"@import url('${url}/style');"}}%%\nflowchart LR\n A["<img src='${url}/html' onerror='parent.postMessage({attack:true}, \\\"*\\\")'>"] --> B[正常]\n click B "${url}/click"`,
        `---\nconfig:\n  securityLevel: loose\n  htmlLabels: true\n  themeCSS: "@import url('${url}/frontmatter');"\n---\nflowchart LR\n A[正常] --> B[正常]`,
        `flowchart LR\n A[正常] --> B[正常]\n classDef default fill:url(${url}/css);`
      ]
      await b.evaluate('window.attacks=0;window.addEventListener("message",e=>{if(e.data?.attack)attacks++})')
      for (const source of attacks) {
        await b.evaluate(`mermaidFixture.setSource(mermaidFixture.fence(${JSON.stringify(source)}))`)
        await b.wait(`document.querySelector('.markdown-mermaid').dataset.mermaidState!=='loading'`)
      }
      await pause(100)
      assert.deepEqual(leaks, [])
      assert.equal(await b.evaluate('attacks'), 0)
      await b.evaluate('mermaidFixture.setSource(mermaidFixture.fence("x".repeat(50001)))'); await error()
      await expandFailedSource('length-limit')
      const edges = 'flowchart TD\n' + Array.from({ length: 501 }, (_, i) => `A${i}-->A${i+1}`).join('\n')
      assert.equal(await b.evaluate(`mermaidFixture.render(${JSON.stringify(edges)},'day').then(()=>false,()=>true)`), true)
      await b.evaluate('mermaidFixture.setMounted(false)'); await b.wait('liveURLs.size===0')
      assert.deepEqual(b.errors, [])
      await writeFile(join(evidence, `${host}-result.json`), JSON.stringify({ host, passed: true, externalRequests: leaks, version: '12.2.0', readerChecks }, null, 2))
    } finally { await b.close() }
  })
})
