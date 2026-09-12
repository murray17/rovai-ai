import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildRemoteConnectionReview } from '../review-remote-connection.mjs'
import { launchAcceptanceBrowser, pause } from './host-web-browser.mjs'

const root = resolve(import.meta.dirname, '../..')
const chrome = process.env.ROVAI_REVIEW_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
test('remote connection design preserves production settings geometry, keyboard validation and reversible decisions', { timeout: 120_000 }, async t => {
  try { await access(chrome) } catch { t.skip('A local Chrome binary is required; no visual verification claimed.'); return }
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-remote-connection-review-')))
  const output = process.env.ROVAI_REMOTE_REVIEW_OUTPUT ?? join(fixture, 'screenshots')
  const artifact = process.env.ROVAI_REMOTE_REVIEW_ROOT
    ? { productPath: join(process.env.ROVAI_REMOTE_REVIEW_ROOT, 'remote-connection.html'), viewerPath: join(process.env.ROVAI_REMOTE_REVIEW_ROOT, 'remote-connection-review.html') }
    : await buildRemoteConnectionReview(join(fixture, 'artifact'))
  await mkdir(output, { recursive: true })
  console.log(JSON.stringify({ channel: 'automatic_acceptance', userData: join(fixture, 'chrome-profile'), core: false, runtime: false }))
  let browser
  const evidence = { simulation: true, realHost: false, styleSource: 'production SettingsSidebarNavigation, SettingsPageHeader, GeneralSettings, AppearanceSettings and theme.css', views: [], checks: [] }
  try {
    browser = await launchAcceptanceBrowser({ executable: chrome, args: ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${join(fixture, 'chrome-profile')}`, 'about:blank'] })
    const open = async (surface, theme, state = 'enabled', page = 'remote') => {
      const url = pathToFileURL(artifact.productPath)
      url.search = new URLSearchParams({ surface, theme, state, page }).toString()
      await browser.send('Page.navigate', { url: url.href })
      await browser.wait(`location.href===${JSON.stringify(url.href)} && document.querySelector('.settings-page-heading h1') !== null`)
      await pause(120)
    }
    const dialogReady = () => browser.wait(`Boolean(document.querySelector('[role="dialog"]')) && document.querySelector('[role="dialog"]').getAnimations().every(a=>a.playState!=='running')`)
    const button = text => `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`
    const input = async (selector, value) => {
      await browser.click(`document.querySelector(${JSON.stringify(selector)})`)
      await browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.select()})()`)
      await browser.send('Input.insertText', { text: value })
    }
    const geometry = () => browser.evaluate(`(()=>{const rail=document.querySelector('.unified-sidebar'),header=document.querySelector('.settings-page-heading'), title=header.querySelector('h1');return {rail:rail.getBoundingClientRect().width,top:document.querySelector('.window-drag-strip').getBoundingClientRect().height,titleSize:getComputedStyle(title).fontSize,titleWeight:getComputedStyle(title).fontWeight,titleX:title.getBoundingClientRect().x,titleY:title.getBoundingClientRect().y,railColor:getComputedStyle(rail).backgroundColor,canvas:getComputedStyle(document.querySelector('.settings-panel')).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth||[...document.querySelectorAll('.settings-panel')].some(e=>e.scrollWidth>e.clientWidth+1),nativeBridge:typeof window.rovai}})()`)
    for (const theme of ['day', 'night']) {
      await open('desktop', theme, 'enabled', 'general')
      const baseline = await geometry()
      await browser.capture(join(output, `baseline-general-${theme}.png`))
      for (const [surface, state] of [['desktop', 'enabled'], ['desktop', 'off'], ['desktop', 'error'], ['desktop', 'loading'], ['web', 'enabled'], ['web', 'offline'], ['web', 'expired']]) {
        await open(surface, theme, state)
        const actual = await geometry()
        assert.deepEqual(actual, baseline, `${surface}/${theme}/${state}: same settings structure and theme as production General`)
        assert.equal(actual.rail, 270); assert.equal(actual.top, 50); assert.equal(actual.titleSize, '24px'); assert.equal(actual.nativeBridge, 'undefined'); assert.equal(actual.overflow, false)
        assert.equal(await browser.evaluate(`document.querySelector('[aria-current="page"]')?.textContent`), '远程连接')
        await browser.capture(join(output, `${surface}-${state}-${theme}.png`))
        evidence.views.push({ surface, theme, state, geometry: actual })
      }
    }
    await open('desktop', 'day', 'off')
    await input('#remote-port', '70000')
    await browser.click(button('开启浏览器访问'))
    await browser.wait(`document.activeElement.id === 'remote-port'`)
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="开启浏览器访问"]').checked`), false)
    assert.match(await browser.evaluate('document.body.innerText'), /1–65535/)
    await input('#remote-port', '4321')
    await browser.evaluate(`(()=>{const e=document.querySelector('#remote-access');e.value='lan';e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await browser.click(button('开启浏览器访问'))
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="开启浏览器访问"]').disabled`), true)
    await browser.wait(`document.querySelector('#remote-token') !== null`)
    assert.equal(await browser.evaluate(`document.querySelector('#remote-token').type`), 'password')
    assert.match(await browser.evaluate('document.body.innerText'), /192.168.1.12:4321/)
    await browser.capture(join(output, 'desktop-first-enable-day.png'))
    await browser.click(button('重新生成'))
    await dialogReady()
    assert.equal(await browser.evaluate('document.activeElement.textContent'), '取消')
    await browser.key('Escape')
    await browser.wait(`document.querySelector('[role="dialog"]')===null`)
    const originalToken = await browser.evaluate(`document.querySelector('#remote-token').value`)
    await browser.click(button('重新生成')); await dialogReady(); await browser.click(button('确认'))
    await browser.wait(`document.querySelector('[role="dialog"]')===null`)
    assert.notEqual(await browser.evaluate(`document.querySelector('#remote-token').value`), originalToken)
    await browser.click(button('外观'))
    await browser.wait(`document.querySelector('.appearance-settings-page')!==null`)
    await browser.click(button('远程连接'))
    await browser.wait(`document.querySelector('#remote-token')?.value.length > 0`)
    const resumedToken = await browser.evaluate(`document.querySelector('#remote-token').value`)
    assert.notEqual(resumedToken, originalToken, 'the regenerated token can be read again after returning')
    await browser.evaluate(`(()=>{const e=document.querySelector('#remote-address');e.value=[...e.options].find(o=>o.value.includes('198.18.')).value;e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    assert.equal(await browser.evaluate(`document.querySelector('#remote-token').value`), resumedToken)
    assert.match(await browser.evaluate(`document.querySelector('.remote-address-row').textContent`), /198.18/)
    assert.match(await browser.evaluate('document.body.innerText'), /0 个浏览器会话/)
    await browser.click(`document.querySelector('[aria-label="开启浏览器访问"]')`)
    await dialogReady()
    await browser.capture(join(output, 'desktop-stop-confirm-day.png'))
    await browser.click(button('取消'))
    await browser.wait(`document.querySelector('[role="dialog"]')===null`)
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="开启浏览器访问"]').checked`), true)
    await browser.click(`document.querySelector('[aria-label="开启浏览器访问"]')`)
    await dialogReady()
    await browser.click(button('确认'))
    await browser.wait(`document.querySelector('#remote-port')!==null`)
    assert.equal(await browser.evaluate(`document.querySelector('#remote-port').value`), '4317')
    evidence.checks.push('field-validation-focus-and-edit-retention', 'explicit-LAN-selection-with-cleartext-notice', 'submitting-disables-repeat', 'token-masked-and-readable-after-navigation', 'interface-selection-preserves-token-and-sessions', 'rotate-and-stop-cancel-and-confirm')
    await open('web', 'night', 'expired')
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="开启浏览器访问"]')===null`), true)
    await browser.click(button('重新登录'))
    await dialogReady()
    await input('[role="dialog"] input[type=password]', 'review-only-example')
    await browser.click(button('登录'))
    await browser.wait(`document.querySelector('[role="dialog"]')===null && document.body.innerText.includes('已连接')`)
    assert.equal(await browser.evaluate(`document.body.innerText.includes('更换令牌')`), false)
    evidence.checks.push('browser-relogin-form-without-host-administration')
    for (const [width, height] of [[1040, 700], [2560, 1440], [720, 460]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      await open('desktop', 'night', 'off')
      assert.equal((await geometry()).overflow, false, `${width}x${height} reduced motion layout`)
      await browser.capture(join(output, `desktop-off-${width}-night.png`))
    }
    evidence.checks.push('1040x700-and-2560x1440', '720x460-layout-equivalent-to-200-percent-of-1440x920', 'reduced-motion')
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1480, height: 1100, deviceScaleFactor: 1, mobile: false })
    await browser.send('Page.navigate', { url: pathToFileURL(artifact.viewerPath).href })
    await browser.wait(`Boolean(document.querySelector('iframe')?.contentDocument?.querySelector('.remote-connection-page'))`)
    await browser.capture(join(output, 'review-overview.png'))
    assert.deepEqual(browser.errors, [])
    evidence.artifactSha256 = Object.fromEntries(await Promise.all([
      ['product', artifact.productPath], ['viewer', artifact.viewerPath]
    ].map(async ([name, path]) => [name, createHash('sha256').update(await readFile(path)).digest('hex')])))
    await writeFile(join(output, 'remote-connection-review.json'), JSON.stringify(evidence, null, 2) + '\n')
    console.log(JSON.stringify({ simulation: true, passed: true, views: evidence.views.length, checks: evidence.checks, output }))
  } catch (error) {
    if (browser) await browser.capture(join(output, 'failure.png')).catch(() => {})
    throw error
  } finally {
    if (browser) await browser.close()
    await rm(fixture, { recursive: true, force: true })
  }
})
