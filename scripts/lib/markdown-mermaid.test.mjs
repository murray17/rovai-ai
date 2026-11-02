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
      const button = (label, scope = '.markdown-mermaid') => b.click(`Array.from(document.querySelectorAll(${JSON.stringify(scope + ' button')})).find(e => e.textContent.trim() === ${JSON.stringify(label)})`)
      const setSample = name => b.evaluate(`mermaidFixture.setSource(mermaidFixture.fence(mermaidFixture.samples.${name}))`)
      const ready = () => b.wait(`document.querySelector('.markdown-mermaid')?.dataset.mermaidState === 'ready'`)
      const error = () => b.wait(`document.querySelector('.markdown-mermaid')?.dataset.mermaidState === 'error'`)

      assert.equal(await b.evaluate('!!document.querySelector("[data-mermaid-renderer]")'), false)
      assert.equal(await b.evaluate('performance.getEntriesByType("resource").some(e=>e.name.includes("mermaid-sandbox"))'), false)
      await b.evaluate('mermaidFixture.setMessage(true);mermaidFixture.setSource(mermaidFixture.fence(mermaidFixture.samples.flow))')
      await b.wait('!!document.querySelector("pre")')
      assert.equal(await b.evaluate('!!document.querySelector(".markdown-mermaid, [data-mermaid-renderer]")'), false)
      assert.equal(await b.evaluate('performance.getEntriesByType("resource").some(e=>e.name.includes("mermaid-sandbox"))'), false)
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

      // Same decoded URL in the dialog, full overflow access and keyboard closure.
      for (const name of ['wide', 'tall']) {
        await setSample(name); await ready(); await button('查看大图')
        await b.wait('!!document.querySelector(".markdown-mermaid-dialog img")')
        assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid-dialog img").src===document.querySelector(".markdown-mermaid-image").src'), true)
        await button('100%', '.markdown-mermaid-dialog')
        await b.wait('document.querySelector(".file-preview-image-content img").naturalWidth>0')
        await pause(80)
        assert.equal(await b.evaluate(`(() => {const e=document.querySelector('.file-preview-image-scroll');return ${name === 'wide' ? 'e.scrollWidth>e.clientWidth' : 'e.scrollHeight>e.clientHeight'}})()`), true)
        await b.evaluate(`document.querySelector('.file-preview-image-scroll').${name === 'wide' ? 'scrollLeft' : 'scrollTop'}=100000`)
        assert.ok(await b.evaluate(`document.querySelector('.file-preview-image-scroll').${name === 'wide' ? 'scrollLeft' : 'scrollTop'}`) > 0)
        await b.capture(join(evidence, `${host}-${name}.png`))
        await b.key('Escape'); await b.wait('!document.querySelector(".markdown-mermaid-dialog")')
        await b.wait('document.activeElement?.textContent === "查看大图"')
      }
      await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: false })
      assert.equal(await b.evaluate('document.documentElement.scrollWidth>innerWidth'), false)
      await button('查看大图'); await b.wait('!!document.querySelector(".markdown-mermaid-dialog")')
      assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid-dialog").getBoundingClientRect().width<=innerWidth'), true)
      await b.capture(join(evidence, `${host}-narrow.png`)); await b.key('Escape')
      await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 920, deviceScaleFactor: 1, mobile: false })

      // Actual SVG decode failure has a manual recovery path.
      await b.evaluate('window.originalDecode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=()=>Promise.reject(Error("decode"))')
      await setSample('flow'); await error()
      assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid pre").textContent'), await b.evaluate('mermaidFixture.samples.flow+"\\n"'))
      await b.evaluate('HTMLImageElement.prototype.decode=originalDecode')
      await button('重试'); await ready()

      // Lose one generation's frame, without a CPU-hanging graph or network interception.
      await b.evaluate(`window.originalTimeout=window.setTimeout; window.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===15000?100:ms,...args);
        document.querySelector('[data-mermaid-renderer]').remove()`)
      await setSample('graph'); await error()
      await b.evaluate('window.setTimeout=originalTimeout')
      await button('重试'); await ready()

      // A superseded decode can only dispose its own candidate.
      await b.evaluate(`window.heldDecode=null;HTMLImageElement.prototype.decode=function(){HTMLImageElement.prototype.decode=originalDecode;return new Promise(resolve=>{window.heldDecode=resolve})}`)
      await setSample('flow'); await b.wait('typeof heldDecode === "function"')
      await setSample('graph'); await ready()
      const current = await b.evaluate('document.querySelector(".markdown-mermaid-image").src')
      await b.evaluate('heldDecode()'); await pause(100)
      assert.equal(await b.evaluate('document.querySelector(".markdown-mermaid-image").src'), current)
      assert.equal(await b.evaluate('liveURLs.has(document.querySelector(".markdown-mermaid-image").src)'), true)

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
      const edges = 'flowchart TD\n' + Array.from({ length: 501 }, (_, i) => `A${i}-->A${i+1}`).join('\n')
      assert.equal(await b.evaluate(`mermaidFixture.render(${JSON.stringify(edges)},'day').then(()=>false,()=>true)`), true)
      await b.evaluate('mermaidFixture.setMounted(false)'); await b.wait('liveURLs.size===0')
      assert.deepEqual(b.errors, [])
      await writeFile(join(evidence, `${host}-result.json`), JSON.stringify({ host, passed: true, externalRequests: leaks, version: '12.2.0' }, null, 2))
    } finally { await b.close() }
  })
})
