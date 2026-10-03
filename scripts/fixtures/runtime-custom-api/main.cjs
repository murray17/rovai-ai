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
  console.error('settings fixture: Electron ready')
  const window = new BrowserWindow({ show: process.platform === 'linux', width: 1440, height: 920, useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } })
  window.webContents.on('console-message', event => console.error(event.message))
  const run = code => window.webContents.executeJavaScript(code, true)
  const settle = () => run('window.settingsTest.settle()')
  const waitFor = async expression => {
    for(let attempt=0;attempt<40;attempt++){
      if(await run(`Boolean(${expression})`)) return
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    throw Error('UI did not settle: '+expression)
  }
  const navigate = async (page, scenario = 'normal') => {
    console.error('settings fixture: ' + page)
    await run(`window.settingsTest.navigate(${JSON.stringify(page)},${JSON.stringify(scenario)})`)
    await settle()
  }
  const key = async keyCode => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    await settle()
  }
  const click = async selector => {
    const point = await run(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)})
      if (!node) throw Error('Missing control: ' + ${JSON.stringify(selector)})
      node.scrollIntoView({block:'center'})
      const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)
      if (!node.contains(hit)) throw Error('Covered control: ' + ${JSON.stringify(selector)})
      return {x:r.x+r.width/2,y:r.y+r.height/2}
    })()`)
    const zoom = window.webContents.getZoomFactor()
    point.x = Math.round(point.x * zoom); point.y = Math.round(point.y * zoom)
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
    await settle()
  }
  const capture = async name => writeFileSync(join(dirname(userData), `${name}.png`), (await window.webContents.capturePage()).toPNG())
  const noOverflow = async label => {
    assert.equal(await run(`(() => {
      const panel=document.querySelector('.settings-panel')
      const overflow = panel.scrollWidth > panel.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1
      if(overflow) console.log(JSON.stringify([...panel.querySelectorAll('*')].filter(n=>n.getBoundingClientRect().right>innerWidth).slice(0,12).map(n=>({tag:n.tagName,class:n.className,width:n.clientWidth,scroll:n.scrollWidth}))))
      return overflow
    })()`), false, label + ' must contain horizontal overflow')
  }
  try {
    await window.loadFile(renderer)
    await waitFor("window.settingsTest")
    await require('./interactions.cjs')({window,run,click,settle,waitFor,navigate,capture,noOverflow})
    console.log(JSON.stringify({ok:true}))
    app.exit(0)
  } catch(error) { console.error(error); await capture('failure'); app.exit(1) }
})
