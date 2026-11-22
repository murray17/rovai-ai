import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Check only status elements owned by the public Thread. User text and tool output are unrestricted.
export async function verifyRunStatus(b, root, out) {
  const page = pathToFileURL(join(root, 'rovai-teammate-presence.html'))
  page.search = 'pure=1'
  const viewport = (width, height) => b.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  const text = selector => b.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`)
  const hasText = (selector, value) => b.wait(`document.querySelector(${JSON.stringify(selector)})?.textContent === ${JSON.stringify(value)}`)
  const show = kind => b.evaluate(`__presence.showStatusCase(${JSON.stringify(kind)})`)
  const receipt = id => `[data-message-id="${id}"] .user-message-receipt`
  const preview = id => `[data-presence-run="${id}"] .run-presence-preview`
  await viewport(1280, 800)
  await b.send('Page.navigate', { url: page.href })
  await b.wait('!!window.__presence && !!document.querySelector(".composer-box")')

  await b.evaluate('__presence.showReceiptCase(["steer-pending"])')
  await hasText(receipt('receipt-example'), '插话 · 待发送')
  assert.ok(await b.evaluate(`!!document.querySelector('${receipt('receipt-example')} circle')`))
  await b.capture(join(out, 'r5-pending-steer.png'))

  await show('wait')
  await hasText(preview('status-run'), '执行中')
  await hasText(preview('question-run'), '需要你处理 · 等你回答')
  assert.equal(await text(receipt('status-input')), null)
  await b.capture(join(out, 'r5-automatic-wait.png'))
  for (const theme of ['day', 'night', 'horizon', 'classic-red', 'ember']) {
    await b.evaluate(`__presence.setTheme('${theme}')`)
    await b.wait(`document.documentElement.dataset.themeId === '${theme}'`)
    await b.evaluate(`Promise.all(document.querySelector('.run-presence-line').getAnimations().map(animation => animation.finished))`)
    const ratios = await b.evaluate(`(() => {
      const row = document.querySelector('[data-presence-run="question-run"]')
      const glyph = row.querySelector('.run-presence-status.is-attention')
      const label = row.querySelector('.run-presence-label')
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      const paint = color => { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1) }
      const light = () => {
        const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(c => {
          const v = c / 255
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
        })
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
      }
      const contrast = node => {
        paint('white')
        const layers = []
        for (let el = node; el; el = el.parentElement) layers.unshift(getComputedStyle(el).backgroundColor)
        layers.forEach(paint)
        const background = light()
        paint(getComputedStyle(node).color)
        const foreground = light()
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)
      }
      return [contrast(glyph), contrast(label)]
    })()`)
    assert.ok(ratios[0] >= 3 && ratios[1] >= 4.5, `${theme} attention icon/text contrast: ${ratios.join('/')}`)
  }
  await b.evaluate('__presence.setTheme("day")')
  await b.click('.native-question-actions .primary-button:not(:disabled)')
  await b.wait(`!document.querySelector('[data-presence-run="question-run"] .run-presence-label')`)
  await show('recovery')
  await hasText(preview('status-run'), '执行失败 · 查看原因')
  await hasText(receipt('next-input'), '排队中')
  assert.equal(await text(receipt('status-input')), null)
  assert.ok(await b.evaluate('!!document.querySelector(\'[data-presence-run="status-run"] button[aria-label="重试"]\')'))
  await b.capture(join(out, 'r5-recovery-failed.png'))

  page.search = 'pure=1&mobile=1'
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await b.send('Page.navigate', { url: page.href })
  await b.wait('!!window.__presence && document.documentElement?.dataset.mobileWeb === "true" && !!document.querySelector(".composer-box")')
  await show('configuration')
  await hasText(receipt('status-input'), '执行失败')
  assert.equal(await text(preview('status-run')), null)
  await b.click(receipt('status-input'))
  const openRun = '.user-message-receipt-recipient button'
  await hasText(openRun, '查看执行')
  await b.click(openRun)
  await hasText('[data-agent-run-id="status-run"] .execution-run-status', '执行失败 · 未设置智能体')
  assert.ok(await b.evaluate(`(() => {
    const r = document.querySelector('[data-agent-run-id="status-run"] .execution-run-status').getBoundingClientRect()
    return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
  })()`), 'mobile execution card status is in the viewport')
  await b.capture(join(out, 'r5-mobile-card.png'))

  page.searchParams.set('case', 'mobile-steer')
  await b.send('Page.navigate', { url: page.href })
  await b.wait('!!window.__presence && document.documentElement?.dataset.mobileWeb === "true" && !!document.querySelector(".composer-box")')
  await b.evaluate('__presence.showSteerTimeline()')
  await b.wait('!!document.querySelector(".run-presence-open")')
  await b.click('.run-presence-open')
  const inputTitle = '.run-input-row .tool-call-title'
  await b.wait(`!!document.querySelector('${inputTitle}')`)
  await b.evaluate('__presence.updateSteerTimeline("delivery_unknown")')
  await b.wait(`document.querySelector('${inputTitle}')?.textContent.startsWith('插话 · 未确认送达 · ')`)
  assert.equal(await b.evaluate('document.querySelector(".run-input-row .tool-call-state").getAttribute("aria-label")'), '未确认送达')
}
