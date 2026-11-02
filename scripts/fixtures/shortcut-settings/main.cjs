const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow, ipcMain, Menu } = require('electron')
const [renderer, userData, nativeModule] = process.argv.slice(2)
assert(isAbsolute(renderer) && isAbsolute(userData) && isAbsolute(nativeModule))
mkdirSync(join(userData, 'managed-skill-library'), { recursive: true })
app.setPath('userData', userData); app.setPath('sessionData', join(userData, 'session'))
const { ShortcutPreferencesStore, installShortcutInput, installCloseTabShortcut, installPageZoomShortcut, FilePreviewService } = require(nativeModule)
const filesRoot = join(userData, 'files')
mkdirSync(join(filesRoot, 'docs'), { recursive: true })
writeFileSync(join(filesRoot, 'docs/interaction-review.md'), '# Interaction review\nShortcut acceptance content.\n')
writeFileSync(join(filesRoot, 'docs/shortcut.html'), '<!doctype html><button id="inside">HTML preview input target</button><p>Searchable preview content</p><iframe title="Child" src="./child.html"></iframe>')
writeFileSync(join(filesRoot, 'docs/child.html'), '<!doctype html><button id="inside">Nested preview input target</button>')
const files = new FilePreviewService({ async resolve(request) {
  if (request.kind !== 'camp_workspace') return null
  return { kind: 'file_target', sourceKind: request.kind, threadId: request.threadId, sourceIdentity: request.rawReference,
    rootPath: filesRoot, basePath: filesRoot, rawReference: request.rawReference, allowChildren: true }
} }, { selectRoot: async () => null, confirmOpen: async () => true, openPath: async () => '', revealPath() {}, copyText() {}, publishExternalUpdate() {} })
const previewCalls = ['updateRetention', 'bindThread', 'open', 'restore', 'reopen', 'readText', 'readPage', 'resolveLine', 'readBinary', 'prepareHtml', 'prepareHtmlSite', 'releaseHtmlSite', 'reload', 'release']
ipcMain.handle('shortcuts:preview', (event, method, args) => {
  assert.equal(event.senderFrame, event.sender.mainFrame)
  assert(previewCalls.includes(method))
  return files[method](event.sender.id, args)
})
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  const inputs = new Map()
  let window, store, input, failSave = false, closedTabs = 0
  ipcMain.handle('shortcuts:get', () => store.get())
  ipcMain.handle('shortcuts:save', async (_event, value) => {
    if (failSave) throw new Error('测试保存失败')
    const snapshot = await store.save(value); window.webContents.send('shortcuts:changed', snapshot); return snapshot
  })
  ipcMain.handle('shortcuts:tasks', (event, value) => inputs.get(event.sender.id)?.setTasksEnabled(value))
  ipcMain.handle('shortcuts:record', (event, value) => inputs.get(event.sender.id)?.setRecording(value))
  try {
    for (const platform of ['darwin', 'win32']) {
      const path = join(userData, `${platform}-shortcuts.json`)
      store = new ShortcutPreferencesStore(path, platform); await store.load()
      window = new BrowserWindow({ show: process.platform === 'linux', width: 1440, height: 1000, useContentSize: true, webPreferences: {
        contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, preload: join(__dirname, 'preload.cjs')
      } })
      input = installShortcutInput(window, platform, () => store.get().preferences)
      inputs.set(window.webContents.id, input)
      installCloseTabShortcut(window.webContents, platform, () => { closedTabs++ }, input.isRecording)
      const zoomChanges = []
      installPageZoomShortcut(window.webContents, platform, input.isRecording, percentage => zoomChanges.push(percentage))
      const run = async code => { try { return await window.webContents.executeJavaScript(code, true) } catch (error) { console.error("Failed script:", code); throw error } }
      const settle = () => run('window.shortcutTest.settle()')
      const click = async selector => { await run(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle() }
      const key = async (keyCode, modifiers = []) => {
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
        if (keyCode === 'Enter' && modifiers.length === 0) window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await settle()
      }
      const nativeClick = async selector => {
        const point = await run(`(() => {
          const button = document.querySelector(${JSON.stringify(selector)}), rect = button.getBoundingClientRect()
          const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2)
          return { x, y, reachable: button.contains(document.elementFromPoint(x, y)) }
        })()`)
        assert(point.reachable, `The control is hit-testable: ${selector}`)
        window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
        window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
        window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
        await settle()
      }
      const text = () => run('document.querySelector(".shortcut-inline-feedback")?.textContent || ""')
      const primary = platform === 'darwin' ? 'meta' : 'control'
      const capture = async name => writeFileSync(join(dirname(userData), `${platform}-${name}.png`), (await window.webContents.capturePage()).toPNG())
      await window.loadFile(renderer, { query: { platform } }); await settle()
      assert.equal(await run('document.querySelectorAll("[data-command]").length'), 25)
      assert.equal(await run('!!document.querySelector("[data-command=quick-open]")'), false)
      await run('document.activeElement?.blur()'); await capture('day')
      assert.equal(await run('getComputedStyle(document.querySelector(".shortcut-field-control")).borderTopColor'), 'rgba(0, 0, 0, 0)')
      const defaults = store.get().preferences
      await click('[data-edit="latest"]'); assert(input.isRecording())
      assert.equal(await run('document.querySelector(".shortcut-inline-recorder").textContent'), '请按下快捷键')
      assert.equal(await text(), '')
      await key('Control', ['control']); assert.equal(await text(), '')
      await key('K'); assert.equal(await text(), platform === 'darwin' ? '请搭配 ⌘、⌃ 或 ⌥ 使用。' : '请搭配 Ctrl 或 Alt 使用。')
      await key('K', ['shift']); assert.match(await text(), /请搭配/)
      if (platform === 'win32') { await key('K', ['meta']); assert.match(await text(), /暂不支持 Win/) }
      await key('K', platform === 'darwin' ? ['control'] : ['control', 'alt', 'shift'])
      assert.equal(await run('document.querySelector(".shortcut-validation-error") === null'), true)
      assert.equal(await run('document.querySelector(".shortcut-inline-recorder").textContent'), platform === 'darwin' ? '⌃K' : 'CtrlAltShiftK')
      failSave = true; await click('.shortcut-inline-actions .primary-button')
      assert.equal(store.get().preferences.bindings.latest, null); assert(await run('!!document.querySelector(".shortcut-inline-recorder")'))
      failSave = false; await click('.shortcut-inline-actions .primary-button')
      assert.equal(store.get().preferences.bindings.latest, platform === 'darwin' ? 'Ctrl+K' : 'Mod+Alt+Shift+K')
      assert(!input.isRecording())
      await click('[data-edit="latest"]')
      if (platform === 'win32') window.emit('app-command', { preventDefault() {} }, 'browser-backward')
      else await run('document.dispatchEvent(new MouseEvent("mousedown", {button:3, bubbles:true, cancelable:true}))')
      await settle(); assert.match(await run('document.querySelector(".shortcut-inline-recorder").textContent'), /侧键 1/)
      await click('.shortcut-inline-actions .primary-button')
      assert.equal(store.get().preferences.mouse.side1, 'latest'); assert(store.get().preferences.bindings.latest)
      // Keyboard-only clear keeps focus in the row on both failure and success.
      failSave = true
      await run('document.querySelector("[data-command=latest] .shortcut-clear").focus()'); await key('Enter')
      assert(store.get().preferences.bindings.latest)
      assert.equal(await run('document.activeElement.dataset.edit'), 'latest')
      assert(await run('!!document.querySelector("[data-command=latest] .shortcut-inline-feedback [role=alert]")'))
      failSave = false
      await run('document.querySelector("[data-command=latest] .shortcut-clear").focus()'); await key('Enter')
      assert.equal(store.get().preferences.bindings.latest, null); assert.equal(store.get().preferences.mouse.side1, 'latest')
      assert.equal(await run('document.activeElement.dataset.edit'), 'latest')
      await run('document.querySelector("[data-command=latest] .shortcut-mouse-control .shortcut-clear").focus()'); await key('Enter')
      assert.equal(store.get().preferences.mouse.side1, null)
      assert.equal(await run('document.activeElement.dataset.edit'), 'latest')
      // Save failure remains beside the lower editor, with candidate and scroll retained.
      await run('document.querySelector("[data-edit=open-file]").scrollIntoView({block:"center"})')
      await click('[data-edit="open-file"]'); await key('O', ['alt'])
      const scrollBefore = await run('[...document.querySelectorAll(".settings-content, .settings-workbench, .settings-panel")].map(e => e.scrollTop)')
      assert(scrollBefore.some(top => top > 0), 'The lower field is tested after scrolling')
      failSave = true; await click('.shortcut-inline-actions .primary-button')
      assert.equal(store.get().preferences.bindings['open-file'], null)
      assert.equal(await run('document.querySelector(".shortcut-inline-recorder").textContent'), platform === 'darwin' ? '⌥O' : 'AltO')
      assert(await run('(()=>{const e=document.querySelector("[data-command=open-file] .shortcut-inline-feedback [role=alert]");const r=e?.getBoundingClientRect();return r && r.top >= 0 && r.bottom <= innerHeight})()'))
      assert.deepEqual(await run('[...document.querySelectorAll(".settings-content, .settings-workbench, .settings-panel")].map(e => e.scrollTop)'), scrollBefore)
      assert(!await run('!!document.querySelector(".shortcut-toast.is-visible")'), 'A previous success toast cannot accompany a failed save')
      await capture('save-failure')
      failSave = false; await click('.shortcut-inline-actions .primary-button')
      assert.equal(store.get().preferences.bindings['open-file'], 'Alt+O')
      await run('document.querySelectorAll(".settings-content, .settings-workbench, .settings-panel").forEach(e => e.scrollTop=0)')
      await click('[data-edit="tasks"]'); await key('1', [primary]); assert.match(await text(), /已用于/)
      await click('.shortcut-inline-actions .primary-button'); assert.equal(store.get().preferences.bindings.execution, null); assert.equal(store.get().preferences.bindings.tasks, 'Mod+1')
      await click('[data-edit="latest"]'); await key('W', [primary]); assert.match(await text(), /关闭当前文件/); assert.equal(closedTabs, 0)
      await key('Escape'); assert(!input.isRecording())
      await click('[data-edit="latest"]'); await run('window.dispatchEvent(new Event("blur"))'); await settle(); assert(!input.isRecording()); assert(!await run('!!document.querySelector(".shortcut-inline-recorder")'))
      await run(`window.shortcutTest.save(${JSON.stringify(defaults)})`); await settle()
      // A capability change cancels only a Task recorder, retains other recording and permits hidden-key transfer.
      await click('[data-edit="tasks"]')
      await run('window.shortcutTest.tasks(false)'); await settle()
      assert(!input.isRecording()); assert(!await run('!!document.querySelector("[data-command=tasks]")'))
      assert.equal(await run(`(() => { const event=new KeyboardEvent('keydown',{ key:'4', code:'Digit4', bubbles:true,cancelable:true,${platform === 'darwin' ? 'metaKey' : 'ctrlKey'}:true }); document.body.dispatchEvent(event); return event.defaultPrevented })()`), false)
      if (platform === 'win32') {
        const before=store.get().preferences; const next=structuredClone(before); next.mouse.side1='tasks'
        await run(`window.shortcutTest.save(${JSON.stringify(next)})`); await settle()
        let consumed=false; window.emit('app-command', { preventDefault() { consumed=true } }, 'browser-backward'); await settle()
        assert.equal(consumed,false)
      }
      await click('[data-edit="latest"]'); await key('4', [primary])
      assert.doesNotMatch(await text(), /已用于/)
      await click('.shortcut-inline-actions .primary-button')
      assert.equal(store.get().preferences.bindings.tasks, null)
      assert.equal(store.get().preferences.bindings.latest, 'Mod+4')
      await run('window.shortcutTest.tasks(true)'); await settle()
      assert.equal(store.get().preferences.bindings.tasks, null)
      await run(`window.shortcutTest.save(${JSON.stringify(defaults)})`); await settle()
      await run('window.shortcutTest.theme("night")'); window.setContentSize(980, 820); await settle(); await capture('night-compact')
      assert(await run('[...document.querySelectorAll(".shortcut-field")].every(e => e.scrollWidth <= e.clientWidth + 1)'))
      window.setContentSize(1440, 1000); await run('window.shortcutTest.theme("day");window.shortcutTest.screen("workspace")'); await settle()
      await key('4', [primary]); assert(await run('!document.querySelector(".task-panel-scroll").hidden'))
      await key('2', [primary]); assert(await run('!document.querySelector(".camp-members-panel").hidden'))
      await key('3', [primary]); assert(await run('!document.querySelector(".single-chat-popover").hidden'))
      await key('3', [primary]); assert(await run('document.querySelector(".single-chat-popover").hidden'))
      await key('1', [primary]); assert(await run('!document.querySelector(".execution-sidecar-panel").hidden'))
      await run('window.shortcutTest.placement("bottom")'); await settle()
      // Measure the real drawer: its display:contents host has no box even while open.
      const measureDrawer = () => run(`(() => {
        const drawer = document.querySelector('.execution-drawer-host-bottom .execution-drawer')
        return { visible: drawer.checkVisibility(), height: drawer.getBoundingClientRect().height,
          rects: drawer.getClientRects().length,
          conversationHeight: document.querySelector('.camp-conversation-stage').getBoundingClientRect().height }
      })()`)
      const expandedDrawer = await measureDrawer()
      assert(expandedDrawer.visible && expandedDrawer.height > 0, 'The actual bottom drawer starts visible')
      // Establish the actual pointer target and focus BEFORE collapsing; do not move either between shortcuts.
      const toggle = '.execution-drawer-host-bottom .execution-run-toggle'
      await nativeClick(toggle)
      assert(await run(`document.activeElement === document.querySelector(${JSON.stringify(toggle)})`))
      await run('window.shortcutTest.drawerBeforeCollapse = document.querySelector(".execution-drawer-host-bottom .execution-drawer")')
      await capture('bottom-expanded')
      await key('1', [primary])
      const collapsedDrawer = await measureDrawer()
      const collapsedFocus = await run('document.activeElement.className')
      console.log(`Bottom drawer collapse (${platform}): ${JSON.stringify({ expanded: expandedDrawer, collapsed: collapsedDrawer })}`)
      await capture('bottom-collapsed')
      assert.equal(collapsedDrawer.visible, false, 'Collapsed bottom drawer must actually be invisible')
      assert.equal(collapsedDrawer.rects, 0, 'Collapsed bottom drawer must have no layout boxes')
      assert.equal(collapsedDrawer.height, 0, 'Collapsed bottom drawer must occupy no height')
      assert(collapsedDrawer.conversationHeight >= expandedDrawer.conversationHeight + expandedDrawer.height - 2,
        'Collapsing returns the drawer space to the conversation')
      await key('1', [primary])
      const reopenedDrawer = await measureDrawer()
      console.log(`Bottom drawer re-entry (${platform}): ${JSON.stringify({ collapsedFocus, reopened: reopenedDrawer })}`)
      assert(reopenedDrawer.visible && reopenedDrawer.height > 0, 'The bottom drawer reopens after an internal click without moving focus')
      assert.match(collapsedFocus, /execution-bottom-collapse-button/, 'Collapse returns internal focus to the external entry')
      await key('1', [primary])
      assert.equal((await measureDrawer()).visible, false, 'The third consecutive shortcut collapses again')
      await key('4', [primary])
      assert(await run('!document.querySelector(".task-panel-scroll").hidden'), 'Other shortcuts still work after collapse')
      await key('4', [primary])
      await key('1', [primary])
      assert((await measureDrawer()).visible, 'The drawer can reopen again')
      assert(await run('window.shortcutTest.drawerBeforeCollapse === document.querySelector(".execution-drawer-host-bottom .execution-drawer")'), 'Reopening preserves the mounted drawer')
      // Use native pointer and keyboard input, since element.click() bypasses inert hit testing.
      const toggleBefore = await run(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded')`)
      await nativeClick(toggle)
      assert.notEqual(await run(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded')`), toggleBefore,
        'The reopened drawer button responds to native pointer input')
      await run(`document.querySelector(${JSON.stringify(toggle)}).focus()`)
      assert(await run(`document.activeElement === document.querySelector(${JSON.stringify(toggle)})`), 'The reopened drawer button accepts focus')
      await key('Enter')
      assert.equal(await run(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded')`), toggleBefore,
        'The reopened drawer button responds to native keyboard input')
      await capture('bottom-reopened')
      await key('L', [primary])
      await key('1', [primary])
      assert(await run('!!document.activeElement.closest(".structured-mention-editor")'), 'Collapse preserves focus already outside the drawer')
      await key('1', [primary])

      // Bound side buttons trigger exactly once; unbound DOM side buttons do nothing.
      const mousePreferences = structuredClone(defaults); mousePreferences.mouse.side1 = 'tasks'
      await run(`window.shortcutTest.save(${JSON.stringify(mousePreferences)})`); await settle()
      if (platform === 'win32') {
        await run('document.dispatchEvent(new MouseEvent("mousedown", {button:3,bubbles:true,cancelable:true}))'); await settle()
        window.emit('app-command', { preventDefault() {} }, 'browser-backward')
      } else await run('document.querySelector(".camp-workspace").dispatchEvent(new MouseEvent("mousedown", {button:3,bubbles:true,cancelable:true}))')
      await settle(); assert(await run('!document.querySelector(".task-panel-scroll").hidden'))
      // Exercise cached-target validity separately from the workspace's focus restoration.
      await run(`window.shortcutProbeTargets = [];
        window.stopShortcutProbe = window.shortcutTest.probeTarget(target => {
          window.shortcutProbeTargets.push(target instanceof Element ? target.id || target.tagName : null)
        });
        window.shortcutProbeSurface = document.createElement('div');
        window.shortcutProbeSurface.style.cssText = 'position:fixed;left:300px;top:20px;z-index:100000';
        window.shortcutProbeSurface.innerHTML = '<button id="shortcut-target-probe" type="button"><svg width="12" height="12"><rect id="shortcut-target-icon" width="12" height="12" /></svg> Target probe</button>';
        document.body.appendChild(window.shortcutProbeSurface)`)
      const targets = () => run('window.shortcutProbeTargets')
      await nativeClick('#shortcut-target-icon')
      await run('document.activeElement.blur()')
      await key('4', [primary])
      assert.deepEqual(await targets(), ['shortcut-target-icon'], 'Visible SVG reading targets remain valid')
      for (const [name, invalidate, restore] of [
        ['hidden', 'surface.hidden = true', 'surface.hidden = false'],
        ['inert', 'surface.inert = true', 'surface.inert = false'],
        ['display', 'surface.style.display = "none"', 'surface.style.display = ""'],
        ['visibility', 'surface.style.visibility = "hidden"', 'surface.style.visibility = ""'],
        ['opacity', 'surface.style.opacity = "0"', 'surface.style.opacity = ""'],
        ['detached', 'surface.remove()', 'document.body.appendChild(surface)']
      ]) {
        await nativeClick('#shortcut-target-probe')
        await run('document.activeElement.blur(); window.shortcutProbeTargets = []')
        await key('4', [primary])
        assert.deepEqual(await targets(), ['shortcut-target-probe'], 'A visible cached reading target is retained')
        await run(`(() => { const surface = window.shortcutProbeSurface; ${invalidate} })()`)
        await key('4', [primary])
        assert.deepEqual(await targets(), ['shortcut-target-probe', 'BODY'], `${name}: stale target falls back to the real event target`)
        if (platform === 'win32') {
          window.emit('app-command', { preventDefault() {} }, 'browser-backward'); await settle()
          assert.equal((await targets()).at(-1), 'BODY', `${name}: native side button uses the same fallback`)
          assert.equal((await targets()).length, 3)
        }
        await run(`(() => { const surface = window.shortcutProbeSurface; ${restore} })()`)
        const count = (await targets()).length
        await key('4', [primary])
        assert.equal((await targets()).length, count + 1)
        assert.equal((await targets()).at(-1), 'BODY', `${name}: the invalidated cache stays cleared when the old surface returns`)
      }
      // The actual event target still obeys terminal and inert guards.
      await run('window.shortcutProbeSurface.className = "xterm"; document.querySelector("#shortcut-target-probe").focus(); window.shortcutProbeTargets = []')
      await key('4', [primary]); assert.deepEqual(await targets(), [])
      await run(`window.shortcutProbeSurface.className = ''; window.shortcutProbeSurface.inert = true;
        document.querySelector('#shortcut-target-probe').dispatchEvent(new KeyboardEvent('keydown', {
          key: '4', code: 'Digit4', bubbles: true, cancelable: true, ${platform === 'darwin' ? 'metaKey' : 'ctrlKey'}: true
        }))`)
      await settle(); assert.deepEqual(await targets(), [], 'An actual inert event target remains blocked')
      await run('window.stopShortcutProbe(); window.shortcutProbeSurface.remove()')
      console.log(`Reading target boundaries (${platform}): visible cache retained; hidden, inert, display, visibility, opacity and detached targets cleared; terminal/inert guards retained`)
      // A modal blocks application shortcuts, including the native side-button path.
      await run('const blocker=document.createElement("div");blocker.className="app-dialog";blocker.id="shortcut-test-modal";document.body.appendChild(blocker)')
      await key('2', [primary]); assert(await run('!document.querySelector(".task-panel-scroll").hidden'))
      await run('document.querySelector("#shortcut-test-modal").remove()')
      await run(`window.shortcutTest.save(${JSON.stringify(defaults)})`); await settle()
      await key('L', [primary]); assert(await run('!!document.activeElement.closest(".structured-mention-editor")'))
      await run('document.activeElement.blur()'); await key('B', [primary, 'shift']); assert(await run('!!document.querySelector(".file-preview-pane")'))
      await run('document.querySelector(".timeline-pane").focus()'); await key('F', [primary]); assert(await run('!!document.querySelector(".conversation-find-surface")'))
      await click('[aria-label="关闭会话查找"]')
      await run('window.shortcutTest.openFile()'); await settle()
      await run('const pane=document.querySelector(".file-preview-pane");pane.tabIndex=-1;pane.focus()'); await key('F', [primary])
      assert(await run('!!document.querySelector(".file-find-surface")'), 'Find targets the active file')
      await key('Escape')
      const fileFind = structuredClone(defaults); fileFind.bindings.find = 'Alt+F'
      await run(`window.shortcutTest.save(${JSON.stringify(fileFind)})`); await settle()
      await key('F', [primary]); assert(!await run('!!document.querySelector(".file-find-surface")'), 'Former file shortcut no longer triggers')
      await key('F', ['alt']); assert(await run('!!document.querySelector(".file-find-surface")'), 'Remapped file shortcut triggers')
      await key('Escape')
      await require('./html-find.cjs')({ window, run, settle, key, platform, defaults })
      await require('./zoom.cjs')({ window, run, settle, click, key, text, platform, primary, store, input, defaults, zoomChanges })
      // Remapping removes the former key and dispatches the new key to the actual task panel.
      const changed = structuredClone(defaults); changed.bindings.tasks = 'Alt+T'
      await run(`window.shortcutTest.save(${JSON.stringify(changed)})`); await settle()
      await run('document.activeElement.blur()'); await key('T', ['alt']); assert(await run('!document.querySelector(".task-panel-scroll").hidden'))
      await key('4', [primary]); assert(await run('!document.querySelector(".task-panel-scroll").hidden'))
      await run('window.shortcutTest.screen("composer")'); await settle()
      const sendPreferences = structuredClone(defaults); sendPreferences.sendMode = 'primary-enter'
      await run(`window.shortcutTest.save(${JSON.stringify(sendPreferences)});window.shortcutTest.composer('原消息')`); await settle()
      await run('document.querySelector("#send-composer").focus()'); await key('Enter'); assert.equal(await run('window.shortcutTest.sends()'), 0)
      await key('Enter', ['shift']); assert.equal(await run('window.shortcutTest.sends()'), 0)
      await key('Enter', [primary]); assert.equal(await run('window.shortcutTest.sends()'), 1)
      assert.match(await run('document.querySelector(".composer-primary-action").title'), platform === 'darwin' ? /⌘ \+ Enter/ : /Ctrl \+ Enter/)
      const persisted = JSON.parse(readFileSync(path, 'utf8')); assert.equal(persisted.sendMode, 'primary-enter')
      await run('window.shortcutTest.screen("settings")'); await settle()
      await click('.shortcut-page-footer button'); await click('.shortcut-reset-dialog .primary-button'); assert.deepEqual(store.get().preferences, defaults)
      await require('./task-drafts.cjs')({ run, settle, click, capture })
      await run('window.shortcutTest.language("en")'); await settle(); await run('new Promise(resolve => setTimeout(resolve, 2600))'); await capture('english')
      const multiple = structuredClone(defaults); multiple.bindings.latest = 'Mod+Alt+Shift+J'; multiple.mouse = {side1:'latest',side2:'latest'}
      await run(`window.shortcutTest.save(${JSON.stringify(multiple)})`); window.setContentSize(960, 820); await settle()
      assert(await run('[...document.querySelectorAll(".shortcut-field")].every(e => e.scrollWidth <= e.clientWidth + 1)'), 'Multiple bindings fit at the compact width')
      await capture('english-multiple')
      await click('[data-edit="latest"]'); await key('K', ['shift']); await capture('modifier-error')
      await key('K', [primary]); await capture('conflict')
      await key('Escape'); await run(`window.shortcutTest.save(${JSON.stringify(defaults)})`); await settle()
      assert.deepEqual(await run('window.shortcutTest.errors'), [])
      await files.closeAll(); window.destroy()
    }
    console.log(JSON.stringify({ ok: true, platforms: ['darwin', 'win32'], nativeKeyboard: true, physicalMouse: false }))
    app.exit(0)
  } catch (error) { await files.closeAll(); console.error(error); if (window && !window.isDestroyed()) writeFileSync(join(dirname(userData), 'failure.png'), (await window.webContents.capturePage()).toPNG()); app.exit(1) }
})
