const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
const { isDeepStrictEqual } = require('node:util')
const { clipboard } = require('electron')

// Preserve all macOS pasteboard items and flavors, including files and rich text.
function macClipboard(input = '') {
  const source = `import AppKit
import Foundation
let input = FileHandle.standardInput.readDataToEndOfFile()
let pb = NSPasteboard.general
if !input.isEmpty {
  let archive = try JSONSerialization.jsonObject(with: input) as! [[[String: String]]]
  let items = archive.map { flavors -> NSPasteboardItem in
    let item = NSPasteboardItem()
    for flavor in flavors {
      guard item.setData(Data(base64Encoded: flavor["data"]!)!, forType: NSPasteboard.PasteboardType(flavor["type"]!)) else { fatalError("Cannot restore flavor") }
    }
    return item
  }
  pb.clearContents()
  if !items.isEmpty && !pb.writeObjects(items) { fatalError("Cannot restore clipboard") }
}
let archive = (pb.pasteboardItems ?? []).map { item in
  item.types.sorted { $0.rawValue < $1.rawValue }.map { type -> [String: String] in
    guard let data = item.data(forType: type) else { fatalError("Cannot archive flavor") }
    return ["type": type.rawValue, "data": data.base64EncodedString()]
  }
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: archive))`
  const result = spawnSync('/usr/bin/xcrun', ['swift', '-e', source], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  assert.equal(result.status, 0, 'Clipboard archive/restore must succeed')
  return JSON.parse(result.stdout)
}

module.exports = async (window, run, capture, output) => {
  const archive = process.platform === 'darwin' ? macClipboard()
    : clipboard.availableFormats().map(format => [format, clipboard.readBuffer(format)])
  const settle = () => run('window.campOpenTest.settle()')
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await run(expression)) return
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error(`Image menu condition timed out: ${expression}`)
  }
  const labels = () => run('Array.from(document.querySelectorAll(".image-context-menu [role=menuitem]"), item => item.textContent)')
  const choose = async label => {
    await run(`Array.from(document.querySelectorAll('.image-context-menu [role=menuitem]')).find(item => item.textContent === ${JSON.stringify(label)}).click()`)
    await settle()
  }
  const key = async (keyCode, modifiers = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await settle()
    await new Promise(resolve => setTimeout(resolve, 140))
  }
  const openMenu = async (selector, keyboard = false) => {
    await run(`(() => { const target = document.querySelector(${JSON.stringify(selector)}); target.scrollIntoView({block:'center'}); target.focus(); })()`)
    await settle()
    if (keyboard) {
      await run(`document.querySelector(${JSON.stringify(selector)}).focus()`)
      await key('F10', ['shift'])
    }
    else {
      const point = await run(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:Math.round(r.left+24), y:Math.round(r.top+24)}; })()`)
      window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
      window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'right', clickCount: 1 })
      window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'right', clickCount: 1 })
    }
    await waitFor('document.querySelector(".image-context-menu") !== null')
    await settle()
    await new Promise(resolve => setTimeout(resolve, 180))
  }
  const userTile = '.image-gallery-user-attachment .image-tile-preview'
  const agentTile = '.image-gallery-agent-output .image-tile:last-child .image-tile-preview'
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect x="32" y="32" width="576" height="296" rx="24" fill="#526f88"/><text x="80" y="194" fill="white" font-size="40">MESSAGE IMAGE</text></svg>'
  const image = { displayName: 'message-image.svg', mediaType: 'image/svg+xml', data: Buffer.from(svg).toString('base64') }
  try {
    window.show()
    window.focus()
    await run(`(() => {
      const request = window.rovai.request;
      window.imageLocationCalls = []; window.imageRevealCalls = [];
      window.rovai.request = async (method, params) => {
        if (method === 'thread.attachments.location') { window.imageLocationCalls.push(params); return '/fixture/message-image.svg'; }
        return request(method, params);
      };
      window.rovai.attachments = { reveal: async locator => { window.imageRevealCalls.push(locator); return {availability:'available', error:null}; } };
      window.campOpenTest.showAttachmentSurfaces(${JSON.stringify(image)});
    })()`)
    await settle()
    await new Promise(resolve => setTimeout(resolve, 350))
    await run('window.campOpenTest.scrollAttachmentSurface("user")')
    await waitFor(`document.querySelector(${JSON.stringify(userTile + ' img')})?.naturalWidth === 640`)
    await openMenu(userTile, true)
    assert.deepEqual(await labels(), ['复制图片', '保存图片…', '复制完整路径', '在 Finder 中显示'])
    await key('End')
    assert.equal(await run('document.activeElement.textContent'), '在 Finder 中显示')
    await key('Down')
    assert.equal(await run('document.activeElement.textContent'), '复制图片', 'keyboard navigation loops')
    await capture('image-menu-day')
    await key('Escape')
    assert.equal(await run(`document.activeElement.matches(${JSON.stringify(userTile)})`), true, 'Escape returns to the real image')

    await openMenu(userTile)
    await choose('复制图片')
    await waitFor('document.querySelector(".image-action-notice")?.textContent === "已复制图片"')
    assert.deepEqual(clipboard.readImage().getSize(), { width: 640, height: 360 }, '72px thumbnail copies the full image')
    assert.equal(clipboard.readImage().toBitmap()[3], 0, 'transparent image corner stays transparent')
    await run(`(() => {
      const input = document.createElement('textarea'); input.id = 'image-paste-target'; document.body.appendChild(input);
      input.addEventListener('paste', event => { window.imagePasteTypes = [...event.clipboardData.files].map(file => file.type); event.preventDefault(); });
      input.focus();
    })()`)
    window.webContents.paste()
    await waitFor('window.imagePasteTypes?.includes("image/png")')
    await run('document.querySelector("#image-paste-target").remove()')

    const saved = new Promise(resolve => {
      const timer = setTimeout(() => resolve('timeout'), 5000)
      window.webContents.session.once('will-download', (_event, item) => {
        assert.equal(item.getFilename(), '参考界面.svg')
        item.setSavePath(join(output, 'saved-image.svg'))
        item.once('done', (_event, state) => { clearTimeout(timer); resolve(state) })
      })
    })
    await openMenu(userTile)
    await choose('保存图片…')
    assert.equal(await saved, 'completed')
    assert.equal(readFileSync(join(output, 'saved-image.svg'), 'utf8'), svg, 'saving retains original bytes and format')
    await openMenu(userTile)
    await choose('在 Finder 中显示')
    assert.equal(await run('window.imageRevealCalls[0].owner'), 'message')
    assert.equal(await run('window.imageRevealCalls[0].attachmentRefId'), 'user-image-one')

    await run(`document.querySelector(${JSON.stringify(userTile)}).click()`)
    await waitFor('document.querySelector(".image-gallery-lightbox") !== null')
    await openMenu('.image-gallery-lightbox')
    const previewMenu = await run(`(() => {const p=document.querySelector('.image-gallery-lightbox').getBoundingClientRect(),m=document.querySelector('.image-context-menu').getBoundingClientRect();return {expectedX:Math.round(p.left+24)+5,expectedY:Math.round(p.top+24),x:m.left,y:m.top}})()`)
    assert.ok(Math.abs(previewMenu.x-previewMenu.expectedX) <= 2 && Math.abs(previewMenu.y-previewMenu.expectedY) <= 2, 'lightbox transforms do not offset the pointer menu')
    await capture('image-menu-lightbox')
    assert.deepEqual(await labels(), ['复制图片', '保存图片…', '复制完整路径', '在 Finder 中显示'], 'thumbnail and lightbox share the same image actions')
    await choose('复制图片')
    await waitFor('document.querySelector(".image-gallery-lightbox [role=status]")?.textContent === "已复制图片"')
    assert.deepEqual(clipboard.readImage().getSize(), { width: 640, height: 360 })
    await openMenu('.image-gallery-lightbox', true)
    await key('Escape')
    assert.equal(await run('Boolean(document.querySelector(".image-gallery-lightbox"))'), true, 'first Escape only dismisses the menu')
    await run('document.querySelector(".attachment-lightbox-close").click()')
    await settle()

    await run('document.documentElement.dataset.theme = "night"')
    await openMenu(agentTile)
    assert.deepEqual(await labels(), ['复制图片', '保存图片…'], 'Runtime images only offer copy and save')
    assert.equal(await run('document.querySelectorAll(".image-context-menu [role=separator]").length'), 0, 'no empty file-action group')
    await capture('image-menu-night-runtime')
    await key('Escape')

    await run(`window.originalImageClipboardWrite = navigator.clipboard.write.bind(navigator.clipboard); navigator.clipboard.write = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; void 0`)
    await openMenu(userTile)
    await choose('复制图片')
    await waitFor('document.querySelector(".image-action-notice")?.textContent.includes("未能复制图片")')
    await capture('image-menu-copy-failure')
    await run('navigator.clipboard.write = window.originalImageClipboardWrite; void 0')

    await run(`window.campOpenTest.showImages({displayName:'broken.png',mediaType:'image/png',data:'AQID'})`)
    const broken = '[data-message-id="image-message-1"] .image-tile-preview'
    await run(`document.querySelector(${JSON.stringify(broken)}).scrollIntoView({block:'center'})`)
    await waitFor(`document.querySelector(${JSON.stringify(broken)})?.textContent.includes("不可用")`)
    await openMenu(broken, true)
    assert.equal(await run('document.querySelector(".image-context-menu [role=menuitem]").getAttribute("aria-disabled")'), 'true')
    assert.equal((await labels()).includes('刷新图片'), false)
    await key('Escape')
    await run(`window.campOpenTest.showImages(${JSON.stringify(image)})`)
    await run('window.dispatchEvent(new Event("focus"))')
    await waitFor(`document.querySelector(${JSON.stringify(broken + ' img')})?.naturalWidth === 640`)

    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    window.setContentSize(1040, 700)
    window.webContents.setZoomFactor(2)
    await settle()
    await run(`document.querySelector(${JSON.stringify(broken)}).dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true,clientX:innerWidth-2,clientY:innerHeight-2}))`)
    await settle()
    await waitFor(`(() => {const r=document.querySelector('.image-context-menu')?.getBoundingClientRect();return r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight})()`)
    const bounds = await run(`(() => {const r=document.querySelector('.image-context-menu').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`)
    assert.ok(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height, 'menu stays in the viewport at 200% zoom')
    assert.equal(await run('getComputedStyle(document.querySelector(".image-context-menu")).animationName'), 'none')
    await capture('image-menu-night-200-percent')
    await key('Escape')
    return { checks: ['full-size-native-image-copy', 'transparent-pixels', 'native-paste', 'original-byte-download', 'exact-owner-reveal', 'keyboard-loop-and-escape', 'lightbox-menu', 'runtime-menu-without-refresh', 'copy-denied', 'broken-attachment-auto-recovery', 'day-night', '200-percent-collision', 'reduced-motion'], clipboardRestored: true }
  } finally {
    if (process.platform === 'darwin') assert.ok(isDeepStrictEqual(macClipboard(JSON.stringify(archive)), archive), 'restore every original clipboard item and flavor')
    else { clipboard.clear(); for (const [format, buffer] of archive) clipboard.writeBuffer(format, buffer) }
  }
}
