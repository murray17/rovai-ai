const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
mkdirSync(join(userData, 'managed-skill-library'), { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: process.platform === 'linux', width: 1440, height: 920, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  const run = code => window.webContents.executeJavaScript(code, true)
  const settle = () => run('window.releaseNotesTest.settle()')
  const visibleNotes = () => run(`(() => {
    const notes = [...document.querySelectorAll('.about-release-notes')].find(node => !node.closest('[hidden]'))
    return { text: notes?.textContent, guide: notes?.querySelector('a')?.getAttribute('href') }
  })()`)
  const assertNotes = async (expected, excluded) => {
    const result = await visibleNotes()
    assert.ok(result.text.includes(expected), JSON.stringify(result))
    assert.ok(!result.text.includes(excluded), JSON.stringify(result))
    assert.equal(result.guide, 'https://example.com/guide')
    assert.ok(!result.text.includes('lang:'))
  }
  const capture = async name => writeFileSync(join(dirname(userData), `${name}.png`), (await window.webContents.capturePage()).toPNG())
  try {
    await window.loadFile(renderer)
    await settle()
    const original = await run('window.releaseNotesTest.source()')
    for (const theme of ['day', 'night']) {
      await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
      await run("document.querySelector('[data-app-update-release-tab=available]').click()")
      await run("window.releaseNotesTest.language('zh-CN')"); await settle()
      await assertNotes('Candidate 中文说明', 'English notes')
      await capture(`release-notes-${theme}-zh-CN`)
      await run("window.releaseNotesTest.language('en')"); await settle()
      await assertNotes('Candidate English notes', '中文说明')
      await run("document.querySelector('[data-app-update-release-tab=current]').click()")
      await settle()
      await assertNotes('Installed English notes', '中文说明')
      await run("window.releaseNotesTest.language('zh-CN')"); await settle()
      await assertNotes('Installed 中文说明', 'English notes')
      assert.equal(await run("document.querySelector('[data-app-update-release-tab=current]').getAttribute('aria-selected')"), 'true')
      assert.equal(await run("document.querySelectorAll('[data-markdown-heading^=\"Rovai AI v\"]').length"), 0)
      await run("window.releaseNotesTest.language('en')"); await settle()
      await capture(`release-notes-${theme}-en`)
      window.setContentSize(1040, 700)
      window.webContents.setZoomFactor(2)
      assert.equal(await run('document.documentElement.scrollWidth > innerWidth + 1'), false)
      window.webContents.setZoomFactor(1)
      window.setContentSize(1440, 920)
    }
    assert.deepEqual(await run('window.releaseNotesTest.source()'), original)
    assert.deepEqual(await run('window.releaseNotesTest.requests'), [])
    await run("document.querySelector('[data-app-update-release-tab=available]').click()")
    await run(`window.releaseNotesTest.notes(${JSON.stringify('<!-- lang:en -->\n\nEnglish fallback')})`)
    await run("window.releaseNotesTest.language('zh-CN')"); await settle()
    assert.ok((await visibleNotes()).text.includes('English fallback'))
    const legacy = 'Legacy complete\n\n### 升级提醒\n\n最后一条'
    await run(`window.releaseNotesTest.notes(${JSON.stringify(legacy)})`); await settle()
    assert.ok((await visibleNotes()).text.includes('最后一条'))
    await run("window.releaseNotesTest.language('en')"); await settle()
    assert.ok((await visibleNotes()).text.includes('最后一条'))
    const boundaryCases = [
      { language: 'zh-CN', source: '<!-- lang:en -->\n\nEnglish fallback\n\n<!-- lang:zh-CN -->\n\n> <!-- Coming soon -->', expected: 'English fallback', excluded: 'Coming soon' },
      { language: 'en', source: '<!-- lang:en -->\n\nRead [guide][docs].\n\n```md\n[docs]: https://example.com/guide\n```\n\n<!-- lang:zh-CN -->\n\n中文\n\n[docs]: https://example.com/guide', expected: 'Read guide.', excluded: '中文', href: 'https://example.com/guide' },
      { language: 'en', source: '<!-- lang:en -->\n\nRead [guide][docs].\n\n<!-- lang:zh-CN -->\n\n中文\n\n> [docs]: https://example.com/guide', expected: 'Read guide.', excluded: '中文', href: 'https://example.com/guide' },
      { language: 'zh-CN', source: '<!-- lang:en -->\n\nEnglish\n\n[docs]: https://example.com/first\n\n<!-- lang:zh-CN -->\n\n阅读[指南][docs]。\n\n[docs]: https://example.com/second', expected: '阅读指南。', excluded: 'English', href: 'https://example.com/first' },
      { language: 'en', source: '<!-- lang:en -->\n\nRead[^details].\n\n<!-- lang:zh-CN -->\n\n中文\n\n[^details]: First paragraph\n\n    Second paragraph', expected: 'Second paragraph', excluded: '中文' },
      { language: 'en', source: '<!-- lang:en -->\n\nRead [guide][docs].[^outer]\n\n[^outer]: First footnote\n\n<!-- lang:zh-CN -->\n\n中文\n\n[^outer]: Duplicate footnote\n\n    [docs]: https://example.com/guide', expected: 'First footnote', excluded: 'Duplicate footnote', href: 'https://example.com/guide' },
      { language: 'zh-CN', source: '<!-- lang:en -->\n\nEnglish fallback\n\n[img]: https://example.com/image.png\n\n<!-- lang:zh-CN -->\n\n![Hidden image][img]', expected: 'English fallback', excluded: 'Hidden image' }
    ]
    for (const boundary of boundaryCases) {
      await run(`window.releaseNotesTest.notes(${JSON.stringify('# Rovai AI v0.0.3\n\n' + boundary.source)})`)
      await run(`window.releaseNotesTest.language(${JSON.stringify(boundary.language)})`); await settle()
      const result = await visibleNotes()
      assert.ok(result.text.includes(boundary.expected), JSON.stringify(result))
      assert.ok(!result.text.includes(boundary.excluded), JSON.stringify(result))
      if (boundary.href) assert.equal(result.guide, boundary.href)
      assert.equal(await run("document.querySelectorAll('[data-markdown-heading^=\"Rovai AI v\"]').length"), 0)
    }
    assert.deepEqual(await run('window.releaseNotesTest.requests'), [])
    const mixed = '# Rovai AI v0.0.3\n\n<!-- lang:en -->\n\nEnglish notes\n\n说明文字 <!-- lang:fr -->\nContenu français.\n\n<!-- lang:zh-CN -->\n\n中文说明'
    await run(`window.releaseNotesTest.notes(${JSON.stringify(mixed)})`)
    await run("window.releaseNotesTest.language('en')"); await settle()
    const mixedNotes = await visibleNotes()
    for (const text of ['English notes', 'Contenu français.', '中文说明']) assert.ok(mixedNotes.text.includes(text), JSON.stringify(mixedNotes))
    const titleOnly = '<!-- lang:en -->\n\nEnglish title-cleanup fallback\n\n<!-- lang:zh-CN -->\n\n# Rovai AI v0.0.3\n'
    await run(`window.releaseNotesTest.notes(${JSON.stringify(titleOnly)})`)
    await run("window.releaseNotesTest.language('zh-CN')"); await settle()
    assert.ok((await visibleNotes()).text.includes('English title-cleanup fallback'))
    await run(`window.releaseNotesTest.notes(${JSON.stringify('# Rovai AI v0.0.3\n\n[docs]: https://example.com/guide')})`); await settle()
    assert.equal(await run("document.querySelector('#about-release-panel-available .about-release-notes') === null"), true)
    assert.ok(await run("document.querySelector('#about-release-panel-available .about-release-empty').textContent.includes('此版本没有提供更新日志')"))
    assert.equal(await run("document.querySelector('[data-app-update-release-tab=available]').getAttribute('aria-selected')"), 'true')
    assert.deepEqual(await run('window.releaseNotesTest.requests'), [])
    await run(`window.releaseNotesTest.notes(${JSON.stringify('<!-- lang:en -->\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1)) ![pixel](https://example.com/pixel.png)\n\n<!-- lang:zh-CN -->\n\n安全正文')})`)
    await settle()
    assert.equal(await run("document.querySelectorAll('.about-release-notes script, .about-release-notes img, .about-release-notes a[href^=\"javascript:\"]').length"), 0)
    process.stdout.write(JSON.stringify({ ok: true, verified: ['即时语言切换', '两个日志版本', 'tab 选择保留', '原始快照保留', '零更新请求', '历史与单语回退', '引用链接保留', '七项 Markdown 边界', '行内异常标记全文回退', '标题清理后语言回退', '无可见正文空态', '安全 Markdown', '日夜主题及紧凑缩放'] }) + '\n')
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
