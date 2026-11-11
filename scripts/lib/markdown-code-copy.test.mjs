import assert from 'node:assert/strict'
import test from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

const repo = resolve(import.meta.dirname, '../..')
const chrome = process.env.ROVAI_TEST_CHROME ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : process.platform === 'win32' ? join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe')
    : '/usr/bin/google-chrome')
const run = promisify(execFile)

async function fixture(t, name) {
  if (!await access(chrome).then(() => true, () => false)) {
    t.skip('Chrome is not installed; code copy acceptance did not run')
    return null
  }
  const root = await mkdtemp(join(tmpdir(), 'rovai-code-copy-'))
  const out = process.env.ROVAI_CODE_COPY_OUTPUT ? join(process.env.ROVAI_CODE_COPY_OUTPUT, name) : join(root, 'evidence')
  await mkdir(out, { recursive: true })
  const b = await launchAcceptanceBrowser({ executable: chrome, args: [
    '--headless=new', `--user-data-dir=${join(root, 'profile')}`, '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-crash-reporter', '--disable-breakpad', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'
  ] })
  t.after(async () => { await b.close(); await rm(root, { recursive: true, force: true }) })
  await b.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await b.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })
  const click = selector => b.click(`document.querySelector(${JSON.stringify(selector)})`)
  const clipboard = () => b.evaluate('navigator.clipboard.readText()')
  const copied = selector => b.wait(`document.querySelector(${JSON.stringify(selector)})?.dataset.copyState === 'copied'`)
  const enter = async () => {
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  }
  return { b, root, out, click, clipboard, copied, enter }
}

test('production Markdown code copy preserves text, reading controls and recovery', { timeout: 180_000 }, async t => {
  const f = await fixture(t, 'app')
  if (!f) return
  const { b, root, out, click, clipboard, copied, enter } = f
  await run(process.execPath, [join(repo, 'scripts/fixtures/markdown-code-copy/build.mjs'), root])
  const url = pathToFileURL(join(root, 'markdown-code-copy.html')).href
  await b.send('Page.navigate', { url })
  await b.wait('!!window.__codeCopy && document.querySelectorAll(".file-preview-tab-panel:not([hidden]) .file-preview-markdown .markdown-code-copy").length === 3')
  const message = '.conversation-bubble.agent .markdown-code-copy'
  const file = '.file-preview-tab-panel:not([hidden]) .file-preview-markdown .markdown-code-copy'
  const expected = await b.evaluate('__codeCopy.snippets')
  const before = await b.evaluate('({ quote: __codeCopy.quote(), find: __codeCopy.find() })')
  await click(message); await copied(message)
  assert.equal(await clipboard(), expected.short)
  await click(file); await copied(file)
  assert.equal(await clipboard(), expected.short)
  assert.deepEqual(await b.evaluate('({ quote: __codeCopy.quote(), find: __codeCopy.find() })'), before)
  await b.wait(`document.querySelector('${message}').dataset.copyState === 'idle'`)
  await click('.conversation-bubble.agent .message-copy-button')
  assert.equal(await clipboard(), await b.evaluate('__codeCopy.getState().snapshot.messages[1].body'))
  await b.evaluate(`document.querySelector('${file}').focus()`)
  await enter(); await copied(file)
  assert.equal(await clipboard(), expected.short)

  for (const theme of ['day', 'night']) {
    await b.evaluate(`__codeCopy.setTheme('${theme}')`)
    await pause(200)
    const layers = await b.evaluate(`(() => {
      const probe=document.createElement('span');
      probe.style.cssText='background:var(--conversation-code-block-canvas);border:1px solid var(--conversation-code-line)';
      document.body.append(probe);
      const expected={background:getComputedStyle(probe).backgroundColor,border:getComputedStyle(probe).borderTopColor};
      probe.remove();
      const frames=Array.from(document.querySelectorAll('.conversation-bubble.agent .markdown-code-frame, .file-preview-tab-panel:not([hidden]) .markdown-code-frame'));
      return frames.map(frame => {
        const outer=getComputedStyle(frame), inner=getComputedStyle(frame.querySelector('pre'));
        return {background:outer.backgroundColor===expected.background,border:outer.borderTopColor===expected.border,
          radius:outer.borderRadius,innerBackground:inner.backgroundColor,innerBorder:inner.borderTopWidth,
          padding:inner.padding,document:!!frame.closest('.file-preview-markdown')};
      });
    })()`)
    assert.equal(layers.length, 5)
    for (const layer of layers) {
      assert.deepEqual(layer, { background:true, border:true, radius:'8px', innerBackground:'rgba(0, 0, 0, 0)',
        innerBorder:'0px', padding:layer.document ? '13px 14px' : '11px 12px', document:layer.document })
    }
    await b.capture(join(out, `app-${theme}.png`))
  }
  // Force both available browser paths to fail. This must never show a checkmark.
  await b.evaluate(`window.originalWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
    window.originalExec = document.execCommand.bind(document);
    navigator.clipboard.writeText = async () => { throw Error('denied') };
    document.execCommand = () => false;`)
  await click(file)
  await b.wait('!!document.querySelector(".markdown-code-manual textarea")')
  assert.deepEqual(await b.evaluate(`(() => { const e=document.querySelector('.markdown-code-manual textarea'); const r=e.getBoundingClientRect(); return {
    value:e.value, selected:e.selectionEnd-e.selectionStart, focused:document.activeElement===e,
    topmost:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e
  } })()`), { value: expected.short, selected: expected.short.length, focused: true, topmost: true })
  assert.equal(await b.evaluate(`document.querySelector('${file}').dataset.copyState`), 'failed')
  await b.capture(join(out, 'manual-copy.png'))
  await b.evaluate('navigator.clipboard.writeText = window.originalWrite; document.execCommand = window.originalExec')
  await click('.markdown-code-manual .dialog-actions > button:last-child')
  await b.wait('!document.querySelector(".markdown-code-manual")')
  await copied(file)
  assert.equal(await clipboard(), expected.short)
  assert.equal(await b.evaluate(`document.activeElement === document.querySelector('${file}')`), true)
  // Existing execCommand fallback still succeeds before manual recovery is offered.
  await b.evaluate('navigator.clipboard.writeText = async () => { throw Error("denied") }')
  await click(message); await copied(message)
  assert.equal(await clipboard(), expected.short)
  await b.evaluate('navigator.clipboard.writeText = window.originalWrite')

  await b.evaluate(`window.rovai = { clipboard: { write: () => new Promise((resolve, reject) => { window.failCopy = reject }) } };
    navigator.clipboard.writeText = async () => { throw Error('denied') }; document.execCommand = () => false;`)
  await click(file)
  await b.evaluate('__codeCopy.openDocument("long")')
  await b.wait('document.querySelectorAll(".file-preview-tab-panel:not([hidden]) .file-preview-markdown .markdown-code-copy").length === 4')
  await b.evaluate('failCopy(Error("denied"))')
  await b.wait('!document.querySelector(".file-preview-tab-panel[hidden] .markdown-code-copy:disabled")')
  assert.equal(await b.evaluate('!!document.querySelector(".markdown-code-manual")'), false)
  await b.evaluate('delete window.rovai; navigator.clipboard.writeText = window.originalWrite; document.execCommand = window.originalExec')
  for (const [index, text] of [expected.long, 'const items = [\n' + expected.tall + ']\n', expected.unknown, expected.plain].entries()) {
    const selector = `.file-preview-tab-panel:not([hidden]) .file-preview-markdown .markdown-code-frame:nth-of-type(${index + 1}) .markdown-code-copy`
    await click(selector); await copied(selector)
    assert.equal(await clipboard(), text)
  }
  assert.equal(await b.evaluate(`(() => { const p=document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-markdown pre'); const button=p.parentElement.querySelector('button'); const x=button.getBoundingClientRect().x; p.scrollLeft=1000; return p.scrollLeft>0 && button.getBoundingClientRect().x===x && p.getBoundingClientRect().right<=x })()`), true)
  // The same controls survive preview replacement, touch and 200% effective zoom.
  for (const [width, height] of [[1040, 700], [1440, 920], [2560, 1440], [1280, 720]]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: width === 1280 ? 2 : 1, mobile: false })
    await pause(180)
    assert.equal(await b.evaluate('document.documentElement.scrollWidth > innerWidth'), false)
    await b.capture(join(out, `app-${width}.png`))
  }
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  assert.ok(await b.evaluate(`document.querySelector('${file}').getBoundingClientRect().width`) >= 36)
  await b.evaluate('__codeCopy.language("en")')
  await b.wait(`document.querySelector('${file}').getAttribute('aria-label') === 'Copy code'`)

  // Keep the production frame mounted while source text changes during a write.
  await b.send('Page.navigate', { url: url + '?edge' })
  await b.wait('!!window.__edge')
  const edge = '.edge-cases > .markdown-code-frame .markdown-code-copy'
  await b.evaluate('window.rovai = { clipboard: { write: () => new Promise(resolve => { window.finishCopy = resolve }) } }')
  await click(edge)
  assert.equal(await b.evaluate(`document.querySelector('${edge}').disabled`), true)
  await b.evaluate('__edge.setCode("updated\\n")')
  await pause(80)
  await b.evaluate('finishCopy()')
  await pause(80)
  assert.equal(await b.evaluate(`document.querySelector('${edge}').dataset.copyState`), 'idle')
  await b.evaluate('delete window.rovai')
  await click(edge); await copied(edge)
  assert.equal(await clipboard(), 'updated\n')
  await click('.edge-cases > .safe-markdown .markdown-code-copy')
  assert.equal(await clipboard(), 'Hello @当前用户\n')
  for (const [index, text] of ['indented\n', '\t中文 & <tag>  \n\nend\n', ''].entries()) {
    const selector = `.edge-cases > .safe-markdown:last-child .markdown-code-frame:nth-of-type(${index + 1}) .markdown-code-copy`
    await click(selector); await copied(selector)
    assert.equal(await clipboard(), text)
  }
  assert.equal(await b.evaluate('document.querySelector(".edge-cases > .safe-markdown:last-child p code").textContent'), 'inline')
  assert.deepEqual(b.errors, [])
  await writeFile(join(out, 'result.json'), JSON.stringify({ passed: true, assertions: 'exact clipboard on both surfaces, quote/find exclusion, whole-message copy, keyboard, reset, recovery/retry, fallback, long lines, whitespace, Unicode, unknown/empty/indented fences, trusted mentions, streaming race, themes, responsive, touch, locale' }, null, 2))
})

test('production Markdown CJK emphasis synthesizes italics without changing plain or bold text', { timeout: 120_000 }, async t => {
  const f = await fixture(t, 'typography')
  if (!f) return
  const { b, root, out } = f
  await run(process.execPath, [join(repo, 'scripts/fixtures/markdown-code-copy/build.mjs'), root])
  await b.send('Page.navigate', { url: pathToFileURL(join(root, 'markdown-code-copy.html')).href + '?table' })
  await b.wait('!!window.__tableCopy')
  const source = [
    '普通中文与 English 123。', '*中文斜体*', '*English italic*', '*中文 English 123 混合斜体*',
    '**中文加粗**', '***中文加粗斜体***',
    '普通文字中包含*斜体片段*，结束后恢复普通文字。',
    '`*这里是代码，不应解析为斜体*`', '> 引用中的 *中文斜体*。',
    `这是一段包含*${'较长中文斜体内容，用于检查跨行显示以及行首行尾是否出现裁切。'.repeat(4)}*的普通段落。`,
    '```text\n*这里是代码块，不应解析为斜体*\n```'
  ].join('\n\n')
  await b.evaluate(`__tableCopy.setSource(${JSON.stringify(source)}); __tableCopy.setDocumentSource(${JSON.stringify(source)})`)
  await b.wait('document.querySelectorAll(".safe-markdown em").length === 14')
  await b.evaluate('document.fonts.ready.then(() => true)')
  const inspect = () => b.evaluate(`Array.from(document.querySelectorAll('.safe-markdown')).map(root => ({
    styles: Array.from(root.querySelectorAll('em')).map(e => getComputedStyle(e).fontStyle),
    synthesis: Array.from(root.querySelectorAll('em, strong, code')).map(e => {
      const s=getComputedStyle(e); return [s.fontSynthesisStyle, s.fontSynthesisWeight];
    }),
    weights: Array.from(root.querySelectorAll('strong')).map(e => getComputedStyle(e).fontWeight),
    plain: getComputedStyle(root.querySelector('p')).fontStyle,
    trailing: getComputedStyle(root.querySelectorAll(':scope > p')[6]).fontStyle,
    code: Array.from(root.querySelectorAll('code')).map(e => ({text:e.textContent, style:getComputedStyle(e).fontStyle, emphasis:e.querySelectorAll('em').length})),
    overflow: root.scrollWidth > root.clientWidth + 1
  }))`)
  const crop = async (selector, name) => {
    const clip = await b.evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x:r.x+scrollX-3,y:r.y+scrollY-3,width:r.width+6,height:r.height+6,scale:1}})()`)
    const { data } = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip })
    await writeFile(join(out, name + '.png'), Buffer.from(data, 'base64'))
    return data
  }
  const evidence = []
  for (const theme of ['day', 'night', 'horizon', 'classic-red', 'ember']) {
    await b.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}; document.documentElement.style.fontSynthesis='none'`)
    await pause(100)
    const before = await inspect()
    const selectors = {
      plain: '.table-message .safe-markdown > p:first-child',
      bold: '.table-message .safe-markdown > p:nth-child(5)',
      italic: '.table-message .safe-markdown > p:nth-child(2)',
      boldItalic: '.table-message .safe-markdown > p:nth-child(6)'
    }
    const baseline = {}
    for (const [name, selector] of Object.entries(selectors)) baseline[name] = await crop(selector, `${theme}-${name}-before`)
    await b.evaluate("document.documentElement.style.removeProperty('font-synthesis')")
    await pause(100)
    const after = await inspect()
    for (const [index, surface] of after.entries()) {
      assert.deepEqual(surface.styles, Array(7).fill('italic'))
      assert.ok(surface.synthesis.every(([style, weight]) => style === 'auto' && weight === 'none'))
      assert.deepEqual(surface.weights, before[index].weights)
      assert.ok(surface.weights.every(weight => Number(weight) >= 600))
      assert.equal(surface.plain, 'normal')
      assert.equal(surface.trailing, 'normal')
      assert.deepEqual(surface.code, [
        { text: '*这里是代码，不应解析为斜体*', style: 'normal', emphasis: 0 },
        { text: '*这里是代码块，不应解析为斜体*\n', style: 'normal', emphasis: 0 }
      ])
      assert.equal(surface.overflow, false)
    }
    // Compare real rasterized Chinese glyphs, beyond the presence of <em>.
    for (const [name, selector] of Object.entries(selectors)) {
      const pixels = await crop(selector, `${theme}-${name}-after`)
      if (name === 'plain' || name === 'bold') assert.equal(pixels, baseline[name], `${theme}: ${name} pixels must stay unchanged`)
      else assert.notEqual(pixels, baseline[name], `${theme}: ${name} must visibly differ when synthesis is allowed`)
    }
    await b.capture(join(out, `${theme}.png`))
    evidence.push({ theme, surfaces: after, plainAndBoldPixelsUnchanged: true, chineseItalicPixelsChanged: true })
  }
  // Incremental body updates and remounting retain the inherited font policy.
  await b.evaluate("__tableCopy.setSource('*中文斜')")
  await b.wait('document.querySelector(".table-message .safe-markdown")?.textContent === "*中文斜"')
  assert.equal(await b.evaluate('document.querySelectorAll(".table-message em").length'), 0)
  for (const text of ['*中文斜体*', '*中文斜体*，后续普通文字。', '***中文加粗斜体***']) {
    await b.evaluate(`__tableCopy.setSource(${JSON.stringify(text)})`)
    await b.wait('document.querySelector(".table-message em")?.textContent.includes("中文")')
    assert.equal(await b.evaluate('getComputedStyle(document.querySelector(".table-message em")).fontSynthesisStyle'), 'auto')
  }
  await b.evaluate('__tableCopy.setVisible(false)')
  await b.wait('!document.querySelector(".table-message")')
  await b.evaluate('__tableCopy.setVisible(true)')
  await b.wait('document.querySelector(".table-message em strong")?.textContent === "中文加粗斜体"')
  assert.equal(await b.evaluate('getComputedStyle(document.querySelector(".table-message em")).fontStyle'), 'italic')
  assert.equal(await b.evaluate('getComputedStyle(document.querySelector(".table-message em")).fontSynthesisWeight'), 'none')
  assert.deepEqual(b.errors, [])
  await writeFile(join(out, 'result.json'), JSON.stringify({ passed: true, platform: process.platform, evidence }, null, 2))
})

test('published website code and request copy use the same corner interaction', { timeout: 180_000 }, async t => {
  const f = await fixture(t, 'website')
  if (!f) return
  const { b, out, click, clipboard, copied, enter } = f
  await run('npm', ['run', 'build', '--prefix', 'website'], { cwd: repo })
  const dist = join(repo, 'website/site/.vitepress/dist')
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      const path = resolve(dist, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '')
      if (!path.startsWith(dist + '/')) { res.writeHead(404).end(); return }
      const content = await readFile(path)
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' })[extname(path)] ?? 'application/octet-stream')
      res.end(content)
    } catch { res.writeHead(404).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const origin = `http://127.0.0.1:${server.address().port}`
  for (const lang of ['zh', 'en']) {
    for (const topic of ['server-install', 'agent-setup', 'collaboration']) {
      await b.send('Page.navigate', { url: `${origin}${lang === 'zh' ? '/zh' : ''}/docs/${topic}.html` })
      await b.wait(`document.body?.dataset.lang === '${lang}' && !!document.querySelector('.prompt-copy')`)
      const count = await b.evaluate('document.querySelectorAll(".prompt-copy").length')
      for (let index = 0; index < count; index++) {
        const button = `document.querySelectorAll('.prompt-copy')[${index}]`
        const expected = await b.evaluate(`${button}.closest('.doc-prompt').querySelector('pre').textContent`)
        await b.click(button)
        await b.wait(`${button}.dataset.copyState === 'copied'`)
        assert.equal(await clipboard(), expected)
      }
      await b.capture(join(out, `${lang}-${topic}.png`))
    }
  }
  await b.evaluate('document.querySelector(".prompt-copy").focus()')
  await enter(); await copied('.prompt-copy')
  const text = await b.evaluate('document.querySelector(".doc-prompt pre").textContent')
  assert.equal(await clipboard(), text)
  await b.evaluate('window.originalWrite = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = async () => { throw Error("denied") }')
  await click('.prompt-copy')
  await b.wait('!!document.querySelector(".code-copy-dialog[open] textarea")')
  assert.deepEqual(await b.evaluate('({ value: document.activeElement.value, selection: document.activeElement.selectionEnd-document.activeElement.selectionStart })'), { value: text, selection: text.length })
  await b.capture(join(out, 'manual-copy.png'))
  await b.evaluate('navigator.clipboard.writeText = window.originalWrite')
  await click('.code-copy-dialog-actions button:last-child')
  await b.wait('!document.querySelector(".code-copy-dialog")')
  await copied('.prompt-copy')
  assert.equal(await clipboard(), text)
  await b.wait('document.querySelector(".prompt-copy").dataset.copyState === "idle"')
  assert.equal(await b.evaluate('document.querySelector(".prompt-copy").getAttribute("aria-label")'), 'Copy request')
  await b.evaluate('navigator.clipboard.writeText = () => new Promise(resolve => { window.finishCopy = resolve })')
  await click('.prompt-copy')
  await click('.language-link')
  await b.wait('document.body?.dataset.lang === "zh"')
  await b.evaluate('finishCopy(); navigator.clipboard.writeText = window.originalWrite')
  await pause(100)
  assert.equal(await b.evaluate('document.querySelector(".prompt-copy").dataset.copyState'), 'idle')
  await click('.prompt-copy'); await copied('.prompt-copy')
  for (const width of [390, 768, 1440]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 })
    await pause(180)
    assert.equal(await b.evaluate('document.documentElement.scrollWidth > innerWidth'), false)
    assert.equal(await b.evaluate(`Array.from(document.querySelectorAll('.code-copy-frame')).every(frame => {
      const button=frame.querySelector('.prompt-copy'); const gap=frame.getBoundingClientRect().right-button.getBoundingClientRect().right;
      return frame.querySelector(':scope > pre') && gap>=7 && gap<=9;
    })`), true)
    await b.capture(join(out, `website-${width}.png`))
  }
  assert.deepEqual(b.errors, [])
  await writeFile(join(out, 'result.json'), JSON.stringify({ passed: true, assertions: 'real VitePress output, every code/request block in three bilingual guides, exact clipboard, keyboard, manual recovery/retry, reset, route race, mobile/desktop overflow' }, null, 2))
})
