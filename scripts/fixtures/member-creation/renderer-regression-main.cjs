const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow } = require('electron')
const [renderer, userData, flow] = process.argv.slice(2)
assert(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))

const imageTest = flow === 'user-images'
if (imageTest) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('force-device-scale-factor', '1')
  app.commandLine.appendSwitch('force-color-profile', 'srgb')
}
app.on('window-all-closed', () => {})

const surfaces = [
  { name: 'timeline', attribute: 'data-message-id', flag: 'before', x: 0, color: [255, 0, 192] },
  { name: 'reply', attribute: 'data-reply-message-id', flag: 'after', x: 16, color: [0, 255, 97] }
]

function rgbaAt(image, x, y) {
  const [b, g, r, a] = image.crop({ x, y, width: 1, height: 1 }).toBitmap()
  return [r, g, b, a]
}

async function markImageRows(contents) {
  const id = await contents.executeJavaScript('CSS.escape(window.userImageFrames.messageId)')
  const css = surfaces.map(({ attribute, flag, x, color }) => {
    const row = '[' + attribute + '="' + id + '"]'
    const rgb = 'rgb(' + color.join(',') + ')'
    // The flag tracks the row independently of image visibility. The outline locates the tile in that same frame.
    return 'body:has(' + row + ')::' + flag + ' {content:""; position:fixed; top:0; left:' + x + 'px;' +
      'width:12px; height:12px; background:' + rgb + '; z-index:2147483647; pointer-events:none}' +
      row + ' .image-tile-preview {outline:2px solid ' + rgb + '; outline-offset:-2px}'
  }).join('\n')
  await contents.insertCSS(css)
  await contents.executeJavaScript('window.userImageFrames.armed = true')
}

function tilePixel(frame, { name, color: [r, g, b] }) {
  const { width, height } = frame.getSize()
  const pixels = frame.toBitmap()
  let left = width, right = -1, top = height, bottom = -1
  // Skip the first 12 rows containing the fixed flag. Only the matching tile has this outline.
  for (let i = 12 * width * 4; i < pixels.length; i += 4) {
    if (pixels[i] !== b || pixels[i + 1] !== g || pixels[i + 2] !== r || pixels[i + 3] !== 255) continue
    const x = (i / 4) % width, y = Math.floor(i / 4 / width)
    left = Math.min(left, x); right = Math.max(right, x)
    top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  assert.ok(right > left && bottom > top, name + ' tile was absent from its first composited row')
  return rgbaAt(frame, Math.floor((left + right) / 2), Math.floor((top + bottom) / 2))
}

async function run(query) {
  const window = new BrowserWindow({ show: false, ...(imageTest && { width: 1600, height: 980, useContentSize: true }),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false,
      offscreen: imageTest, partition: [flow, query.preview, query.order].join('-') } })
  const contents = window.webContents
  const firstFrames = new Map()
  if (imageTest) {
    contents.on('paint', (_event, _dirty, frame) => {
      if (firstFrames.size === surfaces.length) return
      for (const { name, x, color } of surfaces) {
        if (!firstFrames.has(name) && rgbaAt(frame, x + 5, 5).join() === [...color, 255].join()) firstFrames.set(name, frame)
      }
      if (firstFrames.size === surfaces.length) void contents.executeJavaScript('window.userImageFrames.captured = true')
    })
  }
  try {
    await window.loadFile(renderer, { query })
    if (imageTest) await markImageRows(contents)
    const result = await contents.executeJavaScript('window.regressionResult.catch(error => ({ok:false,error:error.stack}))', true)
    assert.equal(result?.ok, true, result?.error)
    if (imageTest) {
      result.firstFramePixels = {}
      for (const surface of surfaces) {
        const pixel = tilePixel(firstFrames.get(surface.name), surface)
        assert.deepEqual(pixel, [51, 102, 153, 255], surface.name + ' first composited frame has the wrong visible pixel')
        result.firstFramePixels[surface.name] = pixel
      }
    }
    console.log(JSON.stringify(result))
  } finally { window.destroy() }
}
app.whenReady().then(async () => {
  if (imageTest) {
    for (const preview of ['bytes', 'blob']) {
      for (const order of ['projection-first', 'receipt-first']) await run({ flow, preview, order })
    }
  } else await run({ flow })
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
