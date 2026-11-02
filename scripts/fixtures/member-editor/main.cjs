const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow, nativeImage } = require('electron')
const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
mkdirSync(join(userData, 'managed-skill-library'), { recursive: true })
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))
const active = '.member-editor-page:not([hidden]) '
let window
app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      show: process.platform === 'linux',
      width: 1440,
      height: 920,
      useContentSize: true,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    // Hidden Windows windows run animation frames at 1 Hz even without background throttling.
    // Show without activating so native input and real animation frames remain exercised.
    if (process.platform === 'win32') window.showInactive()
    const errors = []
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') { errors.push(event.message); console.error(event.message) }
    })
    await window.loadFile(renderer)
    // Keep focus stable without stealing the active desktop window.
    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    const run = async (expression) => {
      const started = Date.now()
      if (process.env.ROVAI_UI_FIXTURE_TRACE === '1') console.error('member run: ' + expression)
      let timer
      try {
        return await Promise.race([
          window.webContents.executeJavaScript(expression, true),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Renderer did not settle: ${expression}`)),
              12_000
            )
          })
        ])
      } catch (error) {
        throw new Error(`Renderer expression failed: ${expression}`, { cause: error })
      } finally {
        clearTimeout(timer)
        if (process.env.ROVAI_UI_FIXTURE_TRACE === '1') console.error(`member done (${Date.now() - started}ms)`)
      }
    }
    const wait = async (expression) => {
      for (let i = 0; i < 150; i++) {
        if (await run(expression)) return
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      throw new Error(`Timed out: ${expression}`)
    }
    const settle = () =>
      run(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
    const capture = async (name) =>
      writeFileSync(
        join(dirname(userData), `${name}.png`),
        (await window.webContents.capturePage()).toPNG()
      )
    const click = async (selector, text) => {
      const expression = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(node => !node.closest('[hidden]') ${text ? `&& node.textContent.trim() === ${JSON.stringify(text)}` : ''})`
      await run(`${expression}?.scrollIntoView({ block: 'nearest' })`)
      await settle()
      const point = await run(
        `(() => { const node = ${expression}; if (!node) throw new Error('Missing ' + ${JSON.stringify(selector + ':' + (text ?? ''))}); node.scrollIntoView({ block: 'nearest' }); const box = node.getBoundingClientRect(); return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) } })()`
      )
      window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        ...point,
        button: 'left',
        clickCount: 1
      })
      window.webContents.sendInputEvent({
        type: 'mouseUp',
        ...point,
        button: 'left',
        clickCount: 1
      })
      await settle()
    }
    const key = async (keyCode, modifiers = []) => {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
      await settle()
    }
    const fill = async (selector, value) => {
      await click(selector)
      await run('document.activeElement.select()')
      await window.webContents.insertText(value)
      await settle()
    }
    const textInput = `${active}.member-identity-form input`
    const saveIdentity = () =>
      click(`${active}.member-identity-form button[aria-label="保存队员信息"]`)
    const saveRuntime = () =>
      click(`${active}.member-runtime-form button[aria-label="保存运行配置"]`)
    const parameterButtons = active + '.runtime-parameter-form .field-label:not(.runtime-model-field) .runtime-model-picker-trigger'
    const openParameter = async index => {
      const label = await run(`document.querySelectorAll(${JSON.stringify(parameterButtons)})[${index}].getAttribute('aria-label')`)
      await click(`button[aria-label=${JSON.stringify(label)}]`)
      await wait("document.querySelector('[role=menuitemradio] .runtime-model-picker-copy strong')")
    }
    const selectPermission = async (index, value) => {
      await openParameter(index)
      const label = await run(`window.memberFixture.installations.flatMap(item => [...(item.snapshot?.permissionOptions ?? []).flatMap(option => option.choices ?? []), ...(item.snapshot?.models ?? []).flatMap(model => model.options.flatMap(option => option.values))]).find(choice => choice.value === ${JSON.stringify(value)})?.label ?? ${JSON.stringify(value)}`)
      assert.ok(label, `Missing parameter choice: ${value}`)
      await click('[role=menuitemradio] .runtime-model-picker-copy strong', label)
    }
    const roleValue = () =>
      run(`document.querySelectorAll(${JSON.stringify(textInput)})[1].value`)
    const geometry = () =>
      run(
        `(() => { const q = selector => document.querySelector(selector); const box = selector => q(selector).getBoundingClientRect(); return { appRail: box('.unified-sidebar').width, roster: box('.member-sidebar').width, avatar: box('.member-sidebar-select .member-avatar').width, portrait: !!q('${active}.member-portrait'), overflow: document.documentElement.scrollWidth > innerWidth || q('.members-view').scrollWidth > q('.members-view').clientWidth, tabCount: q('.members-view').querySelectorAll('[role=tab]').length, modal: !!q('[aria-modal=true]') } })()`
      )
    const reloadPage = async () => {
      const loaded = require('node:events').once(window.webContents, 'did-finish-load')
      // A fixture reset deliberately discards its own draft; normal UI guard
      // behavior is exercised separately above and below these reset points.
      const discardDraft = event => event.preventDefault()
      window.webContents.once('will-prevent-unload', discardDraft)
      let timer
      try {
        window.webContents.reload()
        await Promise.race([loaded, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Reload did not finish')), 12_000)
        })])
      } finally {
        clearTimeout(timer)
        window.webContents.removeListener('will-prevent-unload', discardDraft)
      }
      await wait(`document.querySelector(${JSON.stringify(textInput)})`)
      await settle()
    }
    const rosterWidth = () => run('Number(document.querySelector(".member-roster-resizer").getAttribute("aria-valuenow"))')
    const dragRoster = async (widths) => {
      const start = await run(`(() => { const node = document.querySelector('.member-roster-resizer'); const box = node.getBoundingClientRect(); return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + 180), width: Number(node.getAttribute('aria-valuenow')) } })()`)
      window.webContents.sendInputEvent({ type: 'mouseMove', x: start.x, y: start.y })
      window.webContents.sendInputEvent({ type: 'mouseDown', x: start.x, y: start.y, button: 'left', clickCount: 1 })
      await settle()
      const observed = []
      for (const step of widths) {
        const [width, delay] = Array.isArray(step) ? step : [step, 0]
        window.webContents.sendInputEvent({ type: 'mouseMove', x: start.x + width - start.width, y: start.y, button: 'left', modifiers: ['leftButtonDown'] })
        await settle()
        if (delay) { await new Promise(resolve => setTimeout(resolve, delay)); await settle() }
        observed.push(await rosterWidth())
      }
      window.webContents.sendInputEvent({ type: 'mouseUp', x: start.x + (Array.isArray(widths.at(-1)) ? widths.at(-1)[0] : widths.at(-1)) - start.width, y: start.y, button: 'left', clickCount: 1 })
      await wait('!document.querySelector(".member-editor-roster-shell").classList.contains("is-resizing")')
      await settle()
      // A released pointer may still be finishing the accepted collapse animation.
      await wait('!document.querySelector(".member-editor-roster-shell").classList.contains("is-resizing")')
      assert.equal(await run('document.querySelector(".member-editor-roster-shell").classList.contains("is-resizing")'), false)
      return observed
    }
    await wait(`document.querySelector(${JSON.stringify(textInput)})`)
    await settle()
    const cases = []
    const check = async (name, action) => {
      if (process.env.ROVAI_MEMBER_EDITOR_CASE && !name.includes(process.env.ROVAI_MEMBER_EDITOR_CASE)) return
      console.log(`Checking: ${name}`)
      const started = Date.now()
      await action()
      console.log(`Passed (${Date.now() - started}ms): ${name}`)
      cases.push(name)
    }
    await check('chat materials hint and independent folder/switch interaction', async () => {
      const chat = `${active}.member-chat-bot`
      const input = `${chat} input`
      await wait(`document.querySelector(${JSON.stringify(input)})`)
      assert.equal(await run(`document.querySelector(${JSON.stringify(input)}).disabled`), true)
      assert.equal(await run(`document.querySelector(${JSON.stringify(chat)}).textContent.includes('请先选择资料文件夹，再开启聊天 Bot。')`), true)
      for (const theme of ['day', 'night']) {
        await run(`window.memberFixture.theme('${theme}')`)
        for (const width of [1440, 1040]) {
          window.setContentSize(width, 920)
          await run(`document.querySelector(${JSON.stringify(chat)}).scrollIntoView({ block: 'center' })`)
          await settle()
          const rect = await run(`(() => { const n = document.querySelector(${JSON.stringify(chat)}); const b = n.getBoundingClientRect(); const button = n.querySelector('button').getBoundingClientRect(); const hint = n.querySelector('.member-chat-bot-hint'); return { x: Math.floor(b.x), y: Math.floor(b.y), width: Math.ceil(b.width), height: Math.ceil(b.height), buttonHeight: button.height, overflow: n.scrollWidth > n.clientWidth, hintVisible: !!hint && hint.getBoundingClientRect().height > 0 } })()`)
          assert.equal(rect.overflow, false)
          assert.equal(rect.hintVisible, true)
          assert.ok(rect.buttonHeight < 45)
          const { buttonHeight, overflow, hintVisible, ...clip } = rect
          writeFileSync(join(dirname(userData), `chat-materials-${theme}-${width}.png`), (await window.webContents.capturePage(clip)).toPNG())
        }
      }
      window.setContentSize(1440, 920)
      await run("window.memberFixture.theme('day')")
      await click(input)
      assert.equal(await run('window.memberFixture.calls.filter(call => call.method === \"channels.selectChatMaterialsDirectory\").length'), 0)
      await click(`${chat} button`, '资料文件夹')
      await wait(`!document.querySelector(${JSON.stringify(input)}).disabled`)
      assert.equal(await run(`document.querySelector(${JSON.stringify(input)}).checked`), false)
      assert.equal(await run(`!!document.querySelector(${JSON.stringify(chat + ' .member-chat-bot-hint')})`), false)
      await click(input)
      await wait('window.memberFixture.profiles()[0].chatBotEnabled === true')
      assert.equal(await run('window.memberFixture.calls.filter(call => call.method === \"channels.selectChatMaterialsDirectory\").length'), 1)
      assert.equal(await run('window.memberFixture.profiles()[0].chatMaterialsPath'), 'C:/验收资料/团队备忘录')
      await reloadPage()
    })
    await check('approved day geometry and native fields', async () => {
      assert.deepEqual(await geometry(), {
        appRail: 270,
        roster: 256,
        avatar: 40,
        portrait: false,
        overflow: false,
        tabCount: 0,
        modal: false
      })
      await capture('member-day')
      const options = []
      for (const index of [0, 1]) {
        await openParameter(index)
        options.push(await run(`[...document.querySelectorAll('[role=menuitemradio] .runtime-model-picker-copy strong')].map(node => node.textContent.trim())`))
        await key('Escape')
      }
      assert.deepEqual(options, [
        ['read-only', 'workspace-write', 'danger-full-access (no sandbox)'],
        ['untrusted', 'on-request', 'never (no approval prompts)']
      ])
    })
    await check('sidebar dialogs dismiss without refocusing ellipsis and jump search keeps keyboard input', async () => {
      for (const label of ['重命名', '删除']) {
        await run("document.querySelector('.camp-menu-trigger').focus()")
        await key('Space')
        await wait("document.querySelector('.sidebar-action-menu')")
        await click('.sidebar-action-menu-item', label)
        await wait("document.querySelector('.camp-action-dialog')")
        if (label === '重命名') {
          assert.equal(await run("document.activeElement.matches('.camp-action-dialog input')"), true)
          await window.webContents.insertText('中文重命名草稿')
        }
        await click('.camp-action-dialog button', '取消')
        await wait("!document.querySelector('.camp-action-dialog')")
        await new Promise(resolve => setTimeout(resolve, 350))
        assert.equal(await run("document.activeElement.matches('.camp-menu-trigger')"), false)
      }
      for (const [label, method, action] of [['重命名', 'navigation.rename', '保存名称'], ['删除', 'navigation.delete', '删除']]) {
        await run("document.querySelector('.camp-menu-trigger').focus()")
        await key('Space')
        await wait("document.querySelector('.sidebar-action-menu')")
        await click('.sidebar-action-menu-item', label)
        await wait("document.querySelector('.camp-action-dialog')")
        if (label === '重命名') await fill('#rename-camp-title', '中文草稿保留')
        await run(`window.memberFixture.fail(${JSON.stringify(method)})`)
        await click('.camp-action-dialog button', action)
        await settle()
        assert.equal(await run("!!document.querySelector('.camp-action-dialog')"), true, 'Failed action keeps the dialog open')
        if (label === '重命名') assert.equal(await run("document.querySelector('#rename-camp-title').value"), '中文草稿保留')
        await click('.camp-action-dialog button', action)
        await wait("!document.querySelector('.camp-action-dialog')")
        await new Promise(resolve => setTimeout(resolve, 350))
        assert.equal(await run("document.activeElement.matches('.camp-menu-trigger')"), false)
        assert.equal(await run(`window.memberFixture.calls.filter(call => call.method === ${JSON.stringify(method)}).length`), 2)
      }
      await key('k', ['meta'])
      await wait("document.activeElement.matches('.command-palette-input')")
      await window.webContents.insertText('会话')
      await settle()
      assert.equal(await run("document.querySelectorAll('.command-palette-item').length"), 1)
      await capture('jump-search')
      await key('Enter')
      await wait("!document.querySelector('.command-palette')")
      assert.equal(await run("document.activeElement.matches('.conversation-jump')"), false)
    })
    await check('roster holds its minimum, folds to avatars and reverses with its useful width intact', async () => {
      assert.deepEqual(await dragRoster([179, 170]), [192, 192])
      await new Promise(resolve => setTimeout(resolve, 400))
      assert.equal(await rosterWidth(), 192)
      assert.deepEqual(await dragRoster([[120, 400], 190, 216]), [76, 192, 218])
      await key('Home')
      await dragRoster([120])
      assert.equal(await rosterWidth(), 76, 'Fast release folds without a dwell requirement')
      assert.equal(await run('!!document.querySelector(".member-sidebar.is-collapsed")'), true)
      await click('.member-roster-resizer'); await key('Right')
      assert.equal(await rosterWidth(), 256)
      assert.deepEqual(await dragRoster([330]), [330])
      await reloadPage()
      assert.equal(await rosterWidth(), 330)
      window.setContentSize(900, 700); await settle()
      assert.ok(await rosterWidth() < 330, 'The small viewport clamps only the visible width')
      await click('.member-roster-resizer')
      assert.equal(await run('JSON.parse(localStorage.getItem("rovai-member-roster-width-v2")).width'), 330,
        'Cancelling a no-move gesture preserves the preferred width beyond the viewport clamp')
      window.setContentSize(1440, 920); await settle()
      assert.equal(await rosterWidth(), 330)
      await click('.member-roster-resizer')
      await key('Enter')
      await reloadPage()
      assert.equal(await rosterWidth(), 76)
      await click('.member-roster-resizer')
      await key('Right')
      assert.equal(await rosterWidth(), 330)
      await key('Home')
      await key('Left')
      assert.equal(await rosterWidth(), 240)
      await key('Home')
      await key('Home'); for (let n=0; n<4; n++) await key('Left')
      assert.equal(await rosterWidth(), 192)
      await click('.member-roster-resizer')
      await key('Left')
      assert.equal(await rosterWidth(), 76)
      await key('Right')
      assert.equal(await rosterWidth(), 192)
      await key('Home')
      assert.equal(await run('document.querySelectorAll(".member-order-handle, .member-roster-options").length'), 0)
      assert.equal(await run('document.querySelectorAll(".member-sidebar-actions > button").length'), 2)
      window.setContentSize(1040, 700)
      await settle()
      await click('.member-roster-resizer')
      await key('End')
      assert.equal(await rosterWidth(), 360)
      assert.equal((await geometry()).overflow, false)
      assert.equal(await run('document.querySelector(".members-view").getBoundingClientRect().width'), 410)
      await key('Home')
      window.setContentSize(1440, 920)
      await settle()
    })
    await check('roster rows reorder directly and rejected writes restore the saved order', async () => {
      const order=()=>run('[...document.querySelectorAll("[data-member-id]")].map(row=>row.dataset.memberId)')
      const before=await order()
      const dragMember=async()=>{
        const points=await run(`[...document.querySelectorAll('.member-sidebar-select')].slice(0,2).map(node=>{const r=node.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})`)
        window.webContents.sendInputEvent({type:'mouseMove',...points[0]})
        window.webContents.sendInputEvent({type:'mouseDown',...points[0],button:'left',clickCount:1})
        window.webContents.sendInputEvent({type:'mouseMove',...points[1],button:'left',modifiers:['leftButtonDown']})
        await settle()
        assert.equal(await run('document.querySelector(".member-roster-resizer").getAttribute("aria-disabled")'),'true')
        window.webContents.sendInputEvent({type:'mouseUp',...points[1],button:'left',clickCount:1})
        await new Promise(resolve=>setTimeout(resolve,200));await settle()
      }
      await dragMember()
      assert.deepEqual(await order(),[before[1],before[0],...before.slice(2)])
      await run("window.memberFixture.fail('members.reorder')")
      await dragMember()
      assert.deepEqual(await order(),[before[1],before[0],...before.slice(2)])
      assert.ok(await run('!!document.querySelector(".member-sidebar-error")'))
      await run('document.querySelector(".member-sidebar-select").focus()')
      await key('Down',['alt'])
      await new Promise(resolve=>setTimeout(resolve,200))
      assert.deepEqual(await order(),before)
      assert.equal(await run('document.querySelector(".member-roster-resizer").hasAttribute("aria-disabled")'),false)
    })
    await check('roster preferences preserve old collapse and tolerate corrupt storage', async () => {
      await run(`localStorage.removeItem('rovai-member-roster-width-v2'); localStorage.setItem('rovai-member-roster-width-v1', 'collapsed')`)
      await reloadPage()
      assert.equal(await rosterWidth(), 76)
      await click('.member-roster-resizer'); await key('Right')
      assert.equal(await rosterWidth(), 256)
      await run(`localStorage.setItem('rovai-member-roster-width-v2', '{broken')`)
      await reloadPage()
      assert.equal(await rosterWidth(), 76)
      await run(`localStorage.setItem('rovai-member-roster-width-v2', JSON.stringify({ width: 999999, collapsed: false }))`)
      await reloadPage()
      assert.equal(await rosterWidth(), 360)
      await run(`localStorage.removeItem('rovai-member-roster-width-v1'); localStorage.removeItem('rovai-member-roster-width-v2')`)
      await reloadPage()
      assert.equal(await rosterWidth(), 256)
    })
    await check('roster counts, filtering and runtime captions match the proposal', async () => {
      await run('window.memberFixture.roster()')
      await settle()
      assert.equal(await run('document.querySelectorAll(".member-sidebar-group-heading").length'), 0)
      assert.equal(await run('document.querySelector(".member-sidebar-title").textContent'), '队员16')
      assert.equal(await run('getComputedStyle(document.querySelector(".member-sidebar")).backgroundColor'), 'rgb(255, 255, 255)')
      assert.equal(await run('document.querySelector(".member-sidebar-row").getBoundingClientRect().height'), 60)
      await capture('member-roster-day')
      await fill('#member-sidebar-filter', '产品设计')
      assert.equal(await run('document.querySelectorAll(".member-sidebar-row").length'), 1)
      assert.equal(await run('document.querySelector(".member-sidebar-title").textContent'), '队员1 / 16')
      await click('.member-sidebar-select', '队员 5产品设计与用户研究')
      assert.equal(await run(`!!document.querySelector('${active}.member-header-runtime')`), false)
      await click('.member-sidebar-filter button[aria-label="清除队员筛选"]')
      await click('.member-sidebar-select', '芝士鉴定士')
      assert.equal(await run(`!!document.querySelector('${active}.member-header-runtime')`), false)
      await run('window.memberFixture.roster(2)')
      await settle()
      assert.deepEqual(await run('[...document.querySelectorAll(".member-sidebar-group-heading")].map(node => node.textContent)'), ['在队14', '暂离2'])
      await run("window.memberFixture.theme('night')")
      await click('.member-roster-resizer'); await key('Enter')
      await capture('member-roster-night-collapsed')
      await click('.member-roster-resizer'); await key('Right')
      await reloadPage()
    })
    await check(
      'runtime menu has every admitted product icon and keyboard focus return',
      async () => {
        await click(`${active}[data-member-runtime-select]`)
        const menuCount = await run('window.memberFixture.installations.length + 1')
        await wait(
          `document.querySelectorAll(".member-runtime-menu-item").length === ${menuCount}`
        )
        const labels = await run(
          '[...document.querySelectorAll(".member-runtime-menu-item")].map(node => node.textContent.trim())'
        )
        assert.equal(labels[0], '暂不配置')
        assert.equal(labels.at(-1), 'PI')
        assert.ok(!labels.includes('Cursor Agent'))
        assert.equal(
          await run(
            'document.querySelectorAll(".member-runtime-menu-item .member-runtime-glyph").length'
          ),
          menuCount
        )
        await capture('runtime-menu')
        await key('Escape')
        assert.equal(
          await run(
            'document.activeElement.hasAttribute("data-member-runtime-select")'
          ),
          true
        )
      }
    )
    await check(
      'two saves and roster selection preserve independent drafts',
      async () => {
        await fill(
          `${active}.member-editor-two-columns input:nth-of-type(1)`,
          '叮叮新名称'
        )
        await selectPermission(0, 'read-only')
        await click('.member-sidebar-select', '芝士鉴定士')
        await click('.member-sidebar-select', '叮叮游学者')
        assert.equal(
          await run(`document.querySelector('${textInput}').value`),
          '叮叮新名称'
        )
        assert.equal(
          await run(
            `document.querySelector(${JSON.stringify(parameterButtons)}).textContent.trim()`
          ),
          'read-only'
        )
        await saveIdentity()
        await wait(
          `window.memberFixture.profiles()[0].displayName === '叮叮新名称' && document.querySelector('${active}.member-identity-form button[type=submit]').disabled`
        )
        assert.equal(
          await run(
            `document.querySelector(${JSON.stringify(parameterButtons)}).textContent.trim()`
          ),
          'read-only'
        )
        await fill(
          `${active}.member-editor-two-columns > div:nth-child(2) input`,
          '保留职责草稿'
        )
        await wait(`!document.querySelector('${active}.member-runtime-form button[aria-label="保存运行配置"]').disabled`)
        await saveRuntime()
        await wait(
          `window.memberFixture.profiles()[0].runtimeConfiguration.permissions.values.sandbox_mode === 'read-only'`
        )
        assert.equal(await roleValue(), '保留职责草稿')
        assert.equal(
          await run(
            `document.querySelectorAll('.member-sidebar-select[aria-label*="有未保存更改"]').length`
          ),
          1
        )
      }
    )
    await check(
      'disclosure, save failure and retry preserve draft values',
      async () => {
        await click(`${active}.member-editor-disclosure`)
        await fill(
          `${active}.member-editor-extra-fields textarea`,
          '认真验证交付'
        )
        await click(`${active}.member-editor-disclosure`)
        await click(`${active}.member-editor-disclosure`)
        assert.equal(
          await run(
            `document.querySelector('${active}.member-editor-extra-fields textarea').value`
          ),
          '认真验证交付'
        )
        await run('window.memberFixture.fail("members.update")')
        await saveIdentity()
        await wait(
          `document.querySelector('${active}.member-editor-submit-error')`
        )
        assert.equal(await roleValue(), '保留职责草稿')
        await saveIdentity()
        await wait(
          `window.memberFixture.profiles()[0].teamRole === '保留职责草稿'`
        )
      }
    )
    await check(
      'an avatar failure commits text once and retains only the unsaved image',
      async () => {
        await click(`${active}.member-editor-image-button`)
        await click('.avatar-picker-preset-toggle')
        await click('.avatar-picker-options .member-editor-avatar-option', '芝士')
        await fill(
          `${active}.member-editor-two-columns > div:nth-child(2) input`,
          '部分保存后的职责'
        )
        await run('window.memberFixture.fail("members.avatar.set")')
        await saveIdentity()
        await wait(
          `document.querySelector('${active}.member-editor-submit-error')?.textContent.includes('队员文字信息已保存')`
        )
        assert.equal(await roleValue(), '部分保存后的职责')
        assert.equal(
          await run('window.memberFixture.profiles()[0].avatarRef'),
          'rovai://member-avatar/builtin/luoke/v1'
        )
        const updates = await run(
          'window.memberFixture.calls.filter(call => call.method === "members.update").length'
        )
        await saveIdentity()
        await wait(
          `window.memberFixture.profiles()[0].avatarRef === 'rovai://member-avatar/builtin/muwa/v1' && document.querySelector('${active}.member-identity-form button[type=submit]').disabled`
        )
        assert.equal(
          await run(
            'window.memberFixture.calls.filter(call => call.method === "members.update").length'
          ),
          updates
        )
      }
    )
    await check('uploaded avatars confirm once, preserve drafts on cancel/error and discard late reads', async () => {
      const before = await run('window.memberFixture.profiles()[0].avatarRef')
      const png = nativeImage.createFromBuffer(readFileSync(join(__dirname, '../../../apps/desktop/src/renderer/src/assets/characters/muwa/icon-192.png'))).resize({ width: 480, height: 320 }).toPNG().toString('base64')
      const source = `{ bytes: Uint8Array.from(atob('${png}'), c => c.charCodeAt(0)), byteLength: atob('${png}').length, inspectedWidth: 480, inspectedHeight: 320, mediaType: 'image/png', displayName: 'fixture.png' }`
      const open = async () => { await click(`${active}.member-editor-image-button`); await wait('document.querySelector(".avatar-picker-upload")'); assert.equal(await run('document.querySelector(".avatar-picker-preset-toggle").getAttribute("aria-expanded")'), 'false') }
      await run(`window.memberFixture.source(${source})`)
      await open(); await click('.avatar-picker-upload'); await wait('document.querySelector(".avatar-crop-stage img")?.naturalWidth === 480')
      assert.equal(await run('document.querySelector(".avatar-crop-zoom input").getAttribute("aria-valuetext")'), '100% 放大')
      await run('document.querySelector(".avatar-crop-zoom input").focus()'); await key('End')
      await wait('document.querySelector(".avatar-crop-zoom output").textContent === "833%"')
      assert.equal(await run('document.querySelector(".avatar-crop-zoom input").getAttribute("aria-valuetext")'), '833% 放大')
      await key('Home'); await run('document.querySelector(".avatar-crop-stage").focus()')
      await key('Right'); await key('Escape'); await wait('!document.querySelector(".avatar-picker-dialog")')
      await wait(`document.activeElement === document.querySelector('${active}.member-editor-image-button')`)
      assert.equal(await run('window.memberFixture.profiles()[0].avatarRef'), before)
      await run('window.memberFixture.source({bytes: new Uint8Array([1,2,3]), byteLength:3, inspectedWidth:480, inspectedHeight:320, mediaType:"image/png", displayName:"broken.png"})')
      await open(); await click('.avatar-picker-upload'); await wait('document.querySelector(".avatar-picker-dialog [role=alert]")')
      assert.equal(await run('!!document.querySelector(".avatar-crop-stage")'), false)
      await key('Escape'); await wait('!document.querySelector(".avatar-picker-dialog")')
      await run('window.memberFixture.holdSource()'); await open(); await click('.avatar-picker-upload')
      await key('Escape'); await wait('!document.querySelector(".avatar-picker-dialog")')
      await run(`window.memberFixture.releaseSource(${source})`); await settle()
      assert.equal(await run('!!document.querySelector(".avatar-picker-dialog")'), false)
      assert.equal(await run('window.memberFixture.profiles()[0].avatarRef'), before)
      await run(`window.memberFixture.source(${source})`)
      await open(); await click('.avatar-picker-upload'); await wait('document.querySelector(".avatar-crop-stage img")?.naturalWidth === 480')
      await run('window.memberFixture.fail("memberAvatars.save")')
      await click('.avatar-cut-dialog .member-editor-primary'); await wait('document.querySelector(".avatar-cut-dialog [role=alert]")')
      assert.equal(await run('window.memberFixture.profiles()[0].avatarRef'), before)
      await click('.avatar-cut-dialog .member-editor-primary'); await wait('!document.querySelector(".avatar-picker-dialog")')
      assert.equal(await run('window.memberFixture.profiles()[0].avatarRef'), before)
      assert.equal(await run(`document.querySelector('${active}.member-identity-form button[type=submit]').disabled`), false)
      await saveIdentity(); await wait(`window.memberFixture.profiles()[0].avatarRef.includes('/managed/') && document.querySelector('${active}.member-identity-form button[type=submit]').disabled`)
      assert.match(await run('window.memberFixture.profiles()[0].avatarRef'), /managed/)
      assert.equal(await run(`!!document.querySelector('${active}.member-identity-form .member-editor-save-status.is-dirty')`), false)
      await wait(`document.querySelector('${active}.member-avatar img')?.naturalWidth === 480`)
      await capture('member-upload-saved')
      await open(); await click('.avatar-picker-preset-toggle'); await click('.avatar-picker-options .member-editor-avatar-option', '芝士')
      await saveIdentity(); await wait(`window.memberFixture.profiles()[0].avatarRef === ${JSON.stringify(before)} && document.querySelector('${active}.member-identity-form button[type=submit]').disabled`)
      await run('window.memberFixture.source(null)')
    })
    await check(
      'an external identity update during save preserves the local draft as a conflict',
      async () => {
        await fill(
          `${active}.member-editor-two-columns > div:nth-child(2) input`,
          '本地职责'
        )
        await run(
          `window.memberFixture.afterUpdate({ teamRole: '外部更新的职责' })`
        )
        await saveIdentity()
        await wait(
          `document.querySelector('${active}.member-editor-submit-error')?.textContent.includes('队员信息已在其他操作中更新')`
        )
        assert.equal(await roleValue(), '本地职责')
        assert.equal(
          await run(
            `document.querySelector('${active}.member-identity-form button[type=submit]').disabled`
          ),
          true
        )
        await wait(
          `!document.querySelector('${active}.member-editor-submit-error button').disabled`
        )
        await click(
          `${active}.member-editor-submit-error button`,
          '放弃此处修改，读取已保存信息'
        )
        assert.equal(await roleValue(), '外部更新的职责')
      }
    )
    await check(
      'external runtime conflict cannot be dismissed by choosing another runtime',
      async () => {
        await selectPermission(0, 'workspace-write')
        await run(
          `window.memberFixture.change('prototype-luoke', { runtimeConfiguration: { ...window.memberFixture.profiles()[0].runtimeConfiguration, permissions: { ...window.memberFixture.profiles()[0].runtimeConfiguration.permissions, values: { sandbox_mode: 'danger-full-access', approval_policy: 'never' } } } })`
        )
        await wait(
          `document.querySelector('${active}.member-runtime-conflict')`
        )
        await click(`${active}[data-member-runtime-select]`)
        await click('.member-runtime-menu-item', 'Claude Code')
        assert.equal(
          await run(
            `document.querySelector('${active}.member-runtime-form button[type=submit], ${active}.member-runtime-form button.member-editor-primary').disabled`
          ),
          true
        )
        await click(`${active}.member-runtime-conflict button`)
      }
    )
    await check(
      'manual model IDs save as current intent, discard cleanly and never enter the native catalog',
      async () => {
        await reloadPage()
        const modelTrigger = `${active}.runtime-model-field .runtime-model-picker-trigger`
        const nativeCatalog = await run('JSON.stringify(window.memberFixture.installations)')
        await click(modelTrigger)
        await fill('.runtime-model-search input', '  provider/private-model  ')
        await click('[data-specify-candidate]')
        await saveRuntime()
        await wait(`window.memberFixture.profiles()[0].runtimeConfiguration.model.modelId === 'provider/private-model'`)
        const submission = await run('window.memberFixture.calls.filter(call => call.method === "members.runtime.set").at(-1)')
        assert.deepEqual(submission.command.model, { mode: 'explicit', modelId: 'provider/private-model', options: {} })
        await wait(`!document.querySelector('${modelTrigger}').disabled`)
        await click(modelTrigger)
        assert.equal(await run('document.querySelector("[data-manual-current]").textContent'), 'provider/private-model')
        await fill('.runtime-model-search input', 'provider/unsaved-model')
        await run("window.memberFixture.language('en')")
        await settle()
        assert.equal(await run('document.querySelector(".runtime-model-search input").value'), 'provider/unsaved-model')
        assert.equal(await run('document.querySelector("[data-specify-candidate]").getAttribute("aria-label")'), 'Use model provider/unsaved-model')
        await capture('manual-model-inline-english')
        await click('[data-specify-candidate]')
        await run("window.memberFixture.language('zh-CN')")
        await settle()
        await click(`${active}.member-runtime-form button`, '放弃更改')
        assert.equal(await run(`document.querySelector('${modelTrigger} strong').textContent`), 'provider/private-model')
        await click(modelTrigger)
        await fill('.runtime-model-search input', 'gpt-5.4-mini')
        assert.equal(await run('Boolean(document.querySelector("[data-specify-candidate]"))'), false)
        await key('Enter')
        await saveRuntime()
        await wait(`window.memberFixture.profiles()[0].runtimeConfiguration.model.modelId === 'gpt-5.4-mini'`)
        await wait(`!document.querySelector('${modelTrigger}').disabled`)
        await click(modelTrigger)
        assert.equal(await run('Boolean(document.querySelector("[data-manual-current]"))'), false)
        assert.equal(await run('document.querySelector(".runtime-picker-scroll").textContent.includes("provider/private-model")'), false)
        assert.equal(await run('JSON.stringify(window.memberFixture.installations)'), nativeCatalog)
        await key('Escape')
      }
    )
    await check(
      'expired catalogs stay interactive and a continuous save recovers once without losing drafts',
      async () => {
        await reloadPage()
        await run(`window.memberFixture.catalogScenario({ hold: true, refreshStatus: 'failed' })`)
        await click(`${active}.runtime-model-picker-trigger`)
        assert.equal(await run(`document.querySelector('.runtime-model-picker-menu').textContent.includes('gpt-5.4-mini')`), true)
        assert.equal(await run(`document.querySelector('.runtime-model-picker-menu').textContent.includes('24 小时')`), false)
        assert.equal(await run(`document.querySelector('.runtime-model-picker-menu').textContent.includes('正在更新模型列表')`), false)
        await capture('model-catalog-expired-visible')
        console.log(JSON.stringify({ modelCatalogDisplay: await run('window.memberFixture.catalogDisplayTimings') }))
        await run('window.memberFixture.releaseCatalog()')
        await wait(`document.querySelector('.runtime-model-picker-notice')?.textContent.includes('已保留上次结果')`)
        await capture('model-catalog-refresh-failed')
        await click('.runtime-model-picker-item', 'gpt-5.4-mini')
        await selectPermission(0, 'high')
        const draft = await run(`window.memberFixture.profiles()[0].runtimeConfiguration`)
        await run(`window.memberFixture.catalogScenario({ hold: true, refreshStatus: 'completed', rejectCodes: ['runtime_model_catalog_refresh_required'] }); window.memberFixture.calls.splice(0); window.memberFixture.catalogCalls.splice(0)`)
        await saveRuntime()
        await wait('window.memberFixture.catalogCalls.length === 1')
        assert.equal(await run(`document.querySelector('${active}.member-runtime-form').textContent.includes('正在保存')`), true)
        assert.equal(await run(`!!document.querySelector('${active}.member-runtime-form [role=alert]')`), false)
        assert.deepEqual(await run('window.memberFixture.profiles()[0].runtimeConfiguration'), draft)
        await run(`document.querySelector('${active}.member-runtime-form').requestSubmit()`)
        assert.equal(await run('window.memberFixture.calls.length'), 1)
        await run('window.memberFixture.releaseCatalog()')
        await wait(`window.memberFixture.profiles()[0].runtimeConfiguration.model.modelId === 'gpt-5.4-mini'`)
        const submissions = await run('window.memberFixture.calls')
        assert.equal(submissions.length, 2)
        assert.deepEqual(submissions[0].command, submissions[1].command)
        assert.notEqual(submissions[0].commandId, submissions[1].commandId)
        assert.equal(submissions[1].command.model.options.reasoning_effort, 'high')
        // Refresh failure and confirmed invalid parameter both retain the entire
        // local draft; only the transient case offers in-place retry.
        for (const [refreshStatus, code, text, retry] of [
          ['failed', null, '暂时无法验证所选模型', true],
          ['completed', 'runtime_model_option_invalid', '「推理强度」', false]
        ]) {
          await selectPermission(0, 'low')
          await run(`window.memberFixture.catalogScenario({ refreshStatus: '${refreshStatus}', rejectCodes: ['runtime_model_catalog_refresh_required', ${code ? `'${code}'` : "'runtime_model_catalog_refresh_required'"}] }); window.memberFixture.calls.splice(0)`)
          await saveRuntime()
          await wait(`document.querySelector('${active}.member-runtime-form [role=alert]')?.textContent.includes('${text}')`)
          assert.equal(await run(`document.querySelector(${JSON.stringify(parameterButtons)}).textContent.trim()`), '低')
          assert.equal(await run('window.memberFixture.profiles()[0].runtimeConfiguration.model.options.reasoning_effort'), 'high')
          assert.equal(await run(`!!document.querySelector('${active}.member-runtime-form [role=alert] button')`), retry)
          await capture(`model-save-${refreshStatus}`)
        }
        await reloadPage()
      }
    )
    await check(
      'new teammate is inline and counted only after creation, including its selected avatar',
      async () => {
        await click('.member-sidebar-actions button[aria-label="添加队员"]')
        assert.equal(
          await run('document.querySelectorAll(".member-sidebar-row").length'),
          4
        )
        assert.equal(
          await run('!!document.querySelector(".member-editor-draft-row")'),
          true
        )
        assert.equal(
          await run('!!document.querySelector("[aria-modal=true]")'),
          false
        )
        await fill(textInput, '只填名称的新队员')
        await click(`${active}.member-editor-image-button`)
        await click('.avatar-picker-preset-toggle')
        await click('.avatar-picker-options .member-editor-avatar-option', '叮叮')
        await click(`${active}.member-identity-form button`, '创建队员')
        await wait(
          'document.querySelectorAll(".member-sidebar-row").length === 5 && !document.querySelector(".member-editor-draft-row")'
        )
        const created = await run('window.memberFixture.profiles().at(-1)')
        assert.equal(created.runtimeConfiguration, null)
        assert.equal(
          created.avatarRef,
          'rovai://member-avatar/builtin/luoke/v1'
        )
        await capture('member-create-saved')
        await click(`${active}[data-member-runtime-select]`)
        await click('.member-runtime-menu-item', 'Claude Code')
        await click(active + '.member-environment-entry')
        const area = active + '.member-environment-json'
        await wait(`!document.querySelector(${JSON.stringify(area)}).disabled`)
        await fill(area, '{ "TIMEOUT_MS":60000, "ENABLED":false, "RETRY_COUNT":0, "EMPTY":"", "API_KEY":"fixture-created-key" }')
        await saveRuntime()
        await wait(`window.memberFixture.environment(${JSON.stringify(created.agentId)},'claude-code-cli').revision === 1`)
        assert.deepEqual(await run(`window.memberFixture.environment(${JSON.stringify(created.agentId)},'claude-code-cli').environment`), {
          TIMEOUT_MS: '60000', ENABLED: 'false', RETRY_COUNT: '0', EMPTY: '', API_KEY: 'fixture-created-key'
        })
        await wait(`JSON.parse(document.querySelector(${JSON.stringify(area)}).value).TIMEOUT_MS === '60000'`)
        assert.equal(await run(`document.querySelector('${active}.member-runtime-form button[aria-label="保存运行配置"]').disabled`), true)

      }
    )
    await check(
      'boolean Runtime permissions use the neutral action colors in both themes',
      async () => {
        await click('.member-sidebar-select', '咕咕巡夜人')
        const expected = {
          day: {
            track: 'rgb(43, 43, 44)',
            thumb: 'rgb(255, 255, 255)'
          },
          night: {
            track: 'rgb(229, 229, 231)',
            thumb: 'rgb(23, 23, 25)'
          }
        }
        for (const theme of ['day', 'night']) {
          await run(`window.memberFixture.theme('${theme}')`)
          await settle()
          await run(
            'Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined)))'
          )
          const colors = await run(`(() => {
            const control = document.querySelector('${active}.runtime-parameter-switch input:checked')
            return {
              track: getComputedStyle(control).backgroundColor,
              thumb: getComputedStyle(control, '::after').backgroundColor
            }
          })()`)
          assert.deepEqual(colors, expected[theme])
          await capture(`member-runtime-switch-${theme}`)
        }
      }
    )
    await check('day/night, minimum window, 2K and zoom geometry', async () => {
      await click('.member-sidebar-select', '芝士鉴定士')
      for (const theme of ['day', 'night']) {
        await run(`window.memberFixture.theme('${theme}')`)
        for (const [width, height] of [
          [1440, 920],
          [1040, 700],
          [2560, 1440]
        ]) {
          window.setContentSize(width, height)
          await settle()
          assert.equal((await geometry()).overflow, false)
          assert.equal(
            await run(
              `(() => { const control = document.querySelector('${active}.member-runtime-picker'); const range = document.createRange(); range.selectNodeContents(control); return range.getBoundingClientRect().height <= control.getBoundingClientRect().height && control.scrollWidth <= control.clientWidth })()`
            ),
            true
          )
          await run(
            'Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined)))'
          )
          await capture(`member-${theme}-${width}`)
        }
        window.setContentSize(1440, 920)
        window.webContents.setZoomFactor(2)
        await settle()
        assert.equal((await geometry()).overflow, false)
        await capture(`member-${theme}-zoom`)
        window.webContents.setZoomFactor(1)
      }
    })
    await check('personal profile saves independently, preserves drafts, crops, retries and restores after reload', async () => {
      const personal = '.personal-roster-button'
      const profileInput = '#profile-name'
      const coreCalls = await run('window.memberFixture.calls.length')
      const rosterCount = await run('document.querySelectorAll(".member-sidebar-row").length')
      await click(personal)
      await wait('document.querySelector("#profile-name") && !document.querySelector("#profile-name").disabled')
      assert.equal(await run('document.querySelector(".profile-avatar-button .profile-portrait").textContent'), '你')
      await fill(profileInput, 'Murray')
      assert.equal(await run('document.querySelector(".personal-roster-display").textContent'), '你')
      await click('.member-sidebar-select')
      await click(personal)
      assert.equal(await run('document.querySelector("#profile-name").value'), 'Murray')
      await run('window.memberFixture.fail("currentUserProfile.save")')
      await click('button[aria-label="保存个人资料"]')
      await wait('document.querySelector("button[aria-label=重试保存个人资料]")')
      assert.equal(await run('document.querySelector(".personal-roster-display").textContent'), '你')
      await click('button[aria-label="重试保存个人资料"]')
      await wait('document.querySelector(".personal-roster-display").textContent === "Murray"')
      assert.equal(await run('document.querySelector(".personal-roster-name").textContent'), 'Murray')
      const png = nativeImage.createFromBuffer(readFileSync(join(__dirname, '../../../apps/desktop/src/renderer/src/assets/characters/muwa/icon-192.png'))).resize({ width: 512, height: 512 }).toPNG().toString('base64')
      await run(`window.memberFixture.source({ bytes: Uint8Array.from(atob('${png}'), c => c.charCodeAt(0)), byteLength: atob('${png}').length, inspectedWidth: 512, inspectedHeight: 512, mediaType: 'image/png', displayName: 'fixture.png' })`)
      await click('.profile-avatar-actions button', '更换头像')
      await wait('document.querySelector(".profile-crop-dialog .avatar-crop-stage")')
      await click('.avatar-crop-stage')
      await key('Right')
      await click('.profile-crop-footer button', '使用此头像')
      await wait('!document.querySelector(".profile-crop-dialog") && document.querySelector(".profile-avatar-button img")')
      await click('button[aria-label="保存个人资料"]')
      await wait('document.querySelector(".personal-roster-avatar img") && document.querySelector("button[aria-label=保存个人资料]").disabled')
      assert.equal(await run('window.memberFixture.calls.length'), coreCalls)
      assert.equal(await run('document.querySelectorAll(".member-sidebar-row").length'), rosterCount)
      for (const theme of ['day', 'night']) {
        await run(`window.memberFixture.theme('${theme}')`)
        for (const [width, height] of [[1440, 920], [1040, 700], [2560, 1440]]) {
          window.setContentSize(width, height)
          await settle()
          assert.equal(await run('document.documentElement.scrollWidth > innerWidth || document.querySelector(".personal-editor-page").scrollWidth > document.querySelector(".personal-editor-page").clientWidth'), false)
          await capture(`personal-${theme}-${width}`)
        }
        window.setContentSize(1440, 920)
        window.webContents.setZoomFactor(2)
        await settle()
        assert.equal(await run('document.documentElement.scrollWidth > innerWidth'), false)
        await capture(`personal-${theme}-zoom`)
        window.webContents.setZoomFactor(1)
      }
      await reloadPage()
      await click(personal)
      await wait('document.querySelector("#profile-name") && !document.querySelector("#profile-name").disabled')
      assert.equal(await run('document.querySelector("#profile-name").value'), 'Murray')
      assert.equal(await run('!!document.querySelector(".profile-avatar-button img")'), true)
      await fill(profileInput, '名'.repeat(33))
      await key('Tab')
      assert.equal(await run('document.querySelector("#profile-name").getAttribute("aria-invalid")'), 'true')
      await fill(profileInput, '')
      await key('Backspace')
      await click('.profile-avatar-actions button', '恢复默认')
      await click('button[aria-label="保存个人资料"]')
      await wait('document.querySelector("button[aria-label=保存个人资料]").disabled && document.querySelector(".personal-roster-display").textContent === "你"')
      assert.equal(await run('document.querySelector(".personal-roster-display").textContent'), '你')
      assert.equal(await run('document.querySelector(".personal-roster-avatar .profile-portrait").textContent'), '你')
      await fill(profileInput, '未保存的个人资料')
      await run('void window.memberFixture.leave()')
      await wait('document.querySelector(".member-leave-dialog")')
      await click('.member-leave-dialog button', '继续编辑')
      assert.equal(await run('document.querySelector("#profile-name").value'), '未保存的个人资料')
      await click('.profile-save-row button', '放弃更改')
      await click('.member-sidebar-actions button[aria-label="添加队员"]')
      await click(personal)
      assert.equal(await run('document.querySelectorAll(".member-editor-page:not([hidden])").length'), 1)
      await run('void window.memberFixture.leave()')
      await wait('document.querySelector(".member-leave-dialog")')
      await click('.member-leave-dialog button', '放弃更改')
      await wait('!document.querySelector(".members-view")')
      await click('.unified-sidebar button', '队员')
      await wait(`document.querySelector(${JSON.stringify(textInput)})`)
    })
    await check('leaving the workspace protects identity drafts', async () => {
      await fill(
        `${active}.member-editor-two-columns > div:nth-child(2) input`,
        '离开前的草稿'
      )
      await run('void window.memberFixture.leave()')
      await wait('document.querySelector(".member-leave-dialog")')
      await click('.member-leave-dialog button', '继续编辑')
      assert.equal(await roleValue(), '离开前的草稿')
      await run('void window.memberFixture.leave()')
      await wait('document.querySelector(".member-leave-dialog")')
      await click('.member-leave-dialog button', '放弃更改')
      await wait('!document.querySelector(".members-view")')
    })
    await check('permission guidance preserves selection and language drafts with 36px switches', async () => {
      for (const kind of ['copilot-cli', 'kiro-cli', 'antigravity-app']) {
        await reloadPage()
        await run(`(() => {
          const member = window.memberFixture.profiles()[0]
          const configuration = structuredClone(window.memberFixture.installations.find(item => item.adapterKind === '${kind}').memberRuntimeDefaults)
          const key = '${kind}' === 'copilot-cli' ? 'allow_all' : '${kind}' === 'kiro-cli' ? 'trust_all_tools' : 'dangerously_skip_permissions'
          configuration.permissions.values[key] = 'off'
          window.memberFixture.change(member.agentId, { runtimeConfiguration: configuration })
        })()`)
        await wait(`document.querySelector('${active}.runtime-parameter-switch input')`)
        const baseline = await run('JSON.stringify(window.memberFixture.profiles())')
        for (const language of ['zh-CN', 'en']) {
          await run(`window.memberFixture.language('${language}')`)
          await settle()
          const heights = await run(`[...document.querySelectorAll('${active}.member-editor-runtime-fields .runtime-model-picker-trigger, ${active}.runtime-parameter-switch')].map(node => node.getBoundingClientRect().height)`)
          assert.ok(heights.every(height => height === 36), `${kind}: ${heights}`)
          assert.equal(await run(`document.querySelector('${active}.permission-switch-guidance').textContent`), language === 'en' ? 'Enable for a smoother experience.' : '建议开启，体验更顺畅。')
          assert.equal(await run(`document.querySelector('${active}.runtime-parameter-switch-state').textContent`), language === 'en' ? 'Off' : '关闭')
          assert.equal(await run('JSON.stringify(window.memberFixture.profiles())'), baseline)
        }
        await click(`${active}.runtime-parameter-switch input`)
        await run(`window.permissionDraftNode = document.querySelector('${active}.runtime-parameter-switch input')`)
        await run("window.memberFixture.language('zh-CN')")
        await settle()
        assert.equal(await run(`window.permissionDraftNode === document.querySelector('${active}.runtime-parameter-switch input') && window.permissionDraftNode.checked`), true)
        assert.equal(await run('JSON.stringify(window.memberFixture.profiles())'), baseline)
        assert.equal(await run('window.memberFixture.calls.length'), 0)
      }
      await reloadPage()
      await run(`(() => {
        const member = window.memberFixture.profiles()[0]
        window.memberFixture.change(member.agentId, { runtimeConfiguration: { ...member.runtimeConfiguration, permissions: { ...member.runtimeConfiguration.permissions, values: { sandbox_mode: 'workspace-write', approval_policy: 'on-request' } } } })
      })()`)
      await settle()
      const baseline = await run('JSON.stringify(window.memberFixture.profiles())')
      await openParameter(0)
      assert.deepEqual(await run(`(() => {
        const note = document.querySelector('.permission-option-note')
        return { text: note.textContent, value: note.closest('[role=menuitemradio]').querySelector('strong').textContent, selected: note.closest('[role=menuitemradio]').getAttribute('aria-checked'), background: getComputedStyle(note).backgroundColor, border: getComputedStyle(note).borderWidth, footer: document.querySelector('.permission-menu-guidance').textContent }
      })()`), { text: '推荐', value: 'danger-full-access (no sandbox)', selected: 'false', background: 'rgba(0, 0, 0, 0)', border: '0px', footer: '建议使用最高权限，体验更顺畅。' })
      await key('Escape')
      await run("window.memberFixture.language('en')")
      await settle()
      await openParameter(0)
      assert.equal(await run("document.querySelector('.permission-option-note').textContent"), 'Recommended')
      assert.equal(await run("document.querySelector('.permission-menu-guidance').textContent"), 'For a smoother experience, use full permissions.')
      await key('Escape')
      assert.equal(await run('JSON.stringify(window.memberFixture.profiles())'), baseline)
      assert.equal(await run('window.memberFixture.calls.length'), 0)
    })
    await check('permanent removal explains empty conversations and retains Chinese confirmation across recovery', async () => {
      await reloadPage()
      window.setContentSize(1040, 700)
      await run(`window.memberFixture.language('zh-CN'); window.memberFixture.change(window.memberFixture.profiles()[0].agentId, { displayName: '研究员' }); window.memberFixture.removalRunning(true)`)
      await wait(`document.querySelector('${active}h1')?.textContent === '研究员'`)
      await click(`${active}.member-editor-icon-button`)
      await click('.member-editor-menu-item', '永久移除队员')
      await wait(`document.querySelector('.app-dialog-confirm-field input')`)
      await fill('.app-dialog-confirm-field input', '研究员')
      assert.equal(await run(`document.querySelector('.app-dialog-footer .danger-button').disabled`), true)
      assert.ok(await run(`document.querySelector('.app-dialog-blocker').textContent.includes('未结束的执行')`))
      assert.ok(await run(`document.querySelector('.member-removal-threads').textContent.includes('研究资料整理')`))
      assert.ok(await run(`document.querySelector('.member-removal-threads').textContent.includes('队长交给爱丽丝')`))
      await run('window.memberFixture.removalRunning(false)')
      await click('.app-dialog-footer button', '重新读取影响')
      await wait(`!document.querySelector('.app-dialog-footer .danger-button').disabled`)
      assert.equal(await run(`document.querySelector('.app-dialog-confirm-field input').value`), '研究员')
      for (const theme of ['day', 'night']) {
        await run(`window.memberFixture.theme('${theme}')`)
        await settle()
        await capture(`member-removal-${theme}`)
      }
      await run(`window.memberFixture.fail('members.remove')`)
      await click('.app-dialog-footer .danger-button')
      await wait(`document.querySelector('[aria-describedby="remove-member-description"] .inline-error')`)
      assert.equal(await run(`document.querySelector('.app-dialog-confirm-field input').value`), '研究员')
      await run(`window.memberFixture.change(window.memberFixture.profiles()[0].agentId, { displayName: '研究员二' })`)
      await click('.app-dialog-footer button', '重新读取影响')
      await wait(`document.querySelector('.app-dialog-confirm-field').textContent.includes('研究员二')`)
      assert.equal(await run(`document.querySelector('.app-dialog-confirm-field input').value`), '')
      await fill('.app-dialog-confirm-field input', '研究员二')
      await click('.app-dialog-footer .danger-button')
      await wait(`!document.querySelector('.app-dialog-confirm-field')`)
      assert.equal(await run(`window.memberFixture.profiles()[0].presence`), 'removed')
      assert.equal(await run(`window.memberFixture.calls.filter(call => call.method === 'members.remove').at(-1).command.confirmationName`), '研究员二')
    })
    await check('late member read preserves refreshed common values in the merged preview', async () => {
      await reloadPage()
      await run("window.memberFixture.common('codex-cli', { SHARED: 'before-refresh' })")
      const area = active + '.member-environment-json'
      await click(active + '.member-environment-entry')
      await wait(`document.querySelector('${active}.environment-inherit-row')`)
      await fill(area, '{"API_KEY":"fixture-member-key","LOCAL":"saved"}')
      await saveRuntime()
      await wait(`!document.querySelector(${JSON.stringify(area)}).disabled && document.querySelector('${active}.member-runtime-form button[aria-label="保存运行配置"]').disabled && window.memberFixture.environment(window.memberFixture.profiles()[0].agentId,'codex-cli').revision === 1`)
      await fill(area, '{"API_KEY":"fixture-member-key","LOCAL":"draft"}')
      await run('window.memberFixture.holdEnvironmentRead()')
      await run('window.memberFixture.change(window.memberFixture.profiles()[0].agentId, {})')
      await wait('window.memberFixture.environmentReadPending()')
      await run("window.memberFixture.common('codex-cli', { SHARED: 'after-refresh', NEW: 'current' })")
      await click(active + '.environment-text-link', '查看合并结果')
      await wait(`JSON.parse(document.querySelector(${JSON.stringify(area)}).value).SHARED === 'after-refresh'`)
      await run('window.memberFixture.releaseEnvironmentRead()')
      await settle()
      assert.deepEqual(await run(`JSON.parse(document.querySelector(${JSON.stringify(area)}).value)`), {
        SHARED: 'after-refresh', NEW: 'current', API_KEY: 'fixture-member-key', LOCAL: 'draft'
      })
      await click(active + '.environment-text-link', '编辑')
      assert.equal(await run(`document.querySelectorAll('${active}.environment-reveal').length`), 0)
      assert.deepEqual(await run(`JSON.parse(document.querySelector(${JSON.stringify(area)}).value)`), {
        API_KEY: 'fixture-member-key', LOCAL: 'draft'
      })
    })
    await check('shared variables appear only when saved and merged preview preserves the exact local draft', async () => {
      await reloadPage()
      await run("window.memberFixture.common('codex-cli', { SHARED: 'one', API_KEY: 'fixture-secret', EMPTY: 'default' })")
      const area = active + '.member-environment-json'
      await click(active + '.member-environment-entry')
      await wait(`document.querySelector('${active}.environment-inherit-row')`)
      const draft = '{  "LOCAL" : "draft", "EMPTY" : "", "RETRY_COUNT": 0, "ENABLED": false, "PADDED": "00123"  }'
      await fill(area, draft)
      await run(`window.originalEnvironmentTextarea=document.querySelector(${JSON.stringify(area)})`)
      await click(active + '.environment-text-link', '查看合并结果')
      assert.equal(await run(`document.querySelector(${JSON.stringify(area)}) === window.originalEnvironmentTextarea`), true)
      assert.equal(await run(`document.querySelector(${JSON.stringify(area)}).readOnly`), true)
      const result = await run(`JSON.parse(document.querySelector(${JSON.stringify(area)}).value)`)
      assert.deepEqual(result, { SHARED: 'one', API_KEY: 'fixture-secret', EMPTY: '', LOCAL: 'draft', RETRY_COUNT: '0', ENABLED: 'false', PADDED: '00123' })
      await click(active + '.environment-text-link', '编辑')
      assert.equal(await run(`document.querySelector(${JSON.stringify(area)}).value`), draft)
      await click(active + '.environment-text-link', '查看合并结果')
      await capture('environment-merged-day')
    })
    await check('common settings keep member drafts, check the unsaved values, save and return inline', async () => {
      await click(active + '.environment-text-link', '编辑通用配置')
      await wait("document.querySelector('.runtime-startup-page') && !document.querySelector('.common-environment-section textarea').disabled")
      assert.match(await run("document.querySelector('.runtime-startup-back').textContent"), /返回 .* 的队员配置/)
      await click('.common-environment-help')
      await wait("document.querySelector('[role=tooltip]')")
      assert.equal(await run("document.querySelector('[role=tooltip]').textContent"), '用于在不同队员之间共享一些配置变量。')
      await key('Escape')
      assert.equal(await run("!!document.querySelector('[role=tooltip]')"), false)
      await click('.runtime-startup-inspection button', '检查状态')
      await wait("document.querySelector('.runtime-startup-result').textContent.includes('检查通过')")
      const checksBeforeReload = await run("window.memberFixture.calls.filter(item=>item.method==='runtime.startup.check').length")
      await run("window.memberFixture.common('codex-cli', { SHARED: 'refreshed', API_KEY: 'fixture-refreshed-key', EMPTY: 'default' })")
      await fill('.common-environment-section textarea', '{"SHARED":"stale-save"}')
      await click('.runtime-startup-actions button', '保存')
      await wait("document.querySelector('.common-environment-section .environment-error')")
      await click('.common-environment-section .environment-error button', '重新读取')
      await wait("JSON.parse(document.querySelector('.common-environment-section textarea').value).SHARED === 'refreshed'")
      assert.equal(await run("document.querySelector('.runtime-startup-result').textContent.includes('检查通过')"), false)
      assert.equal(await run("window.memberFixture.calls.filter(item=>item.method==='runtime.startup.check').length"), checksBeforeReload)
      const invalidCommon = '{ "OPTIONS":null, "SHARED":"kept" }'
      const savesBeforeInvalid = await run("window.memberFixture.calls.filter(item=>item.method==='runtime.startup.save').length")
      await fill('.common-environment-section textarea', invalidCommon)
      await click('.runtime-startup-actions button', '保存')
      await wait("document.querySelector('.common-environment-section .environment-error')")
      assert.match(await run("document.querySelector('.common-environment-section .environment-error').textContent"), /OPTIONS/)
      assert.equal(await run("document.querySelector('.common-environment-section textarea').value"), invalidCommon)
      assert.equal(await run("window.memberFixture.calls.filter(item=>item.method==='runtime.startup.save').length"), savesBeforeInvalid)
      const commonDraft = '{ "SHARED":"two", "API_KEY":"fixture-refreshed-key", "EMPTY":"updated", "TIMEOUT_MS":60000, "RETRY_COUNT":2, "ENABLED":true, "ZERO":0, "DISABLED":false, "BLANK":"" }'
      await fill('.common-environment-section textarea', commonDraft)
      await click('.runtime-startup-inspection button', '检查状态')
      await wait("document.querySelector('.runtime-startup-result').textContent.includes('检查通过')")
      const checkRequest = await run("window.memberFixture.calls.findLast(item=>item.method==='runtime.startup.check').command")
      assert.equal(JSON.parse(checkRequest.commonEnvironment.json).SHARED, 'two')
      assert.deepEqual(checkRequest.configuration.environment, [])
      assert.equal(JSON.parse(checkRequest.commonEnvironment.json).TIMEOUT_MS, '60000')
      assert.equal(await run("document.querySelector('.common-environment-section textarea').value"), commonDraft)
      await run("window.memberFixture.fail('runtime.startup.save')")
      await click('.runtime-startup-actions button', '保存')
      await wait("document.querySelector('.runtime-startup-page .inline-error')")
      assert.equal(await run("document.querySelector('.common-environment-section textarea').value"), commonDraft)
      await click('.runtime-startup-actions button', '保存')
      await wait("document.querySelector('.runtime-startup-actions [role=status]')?.textContent === '已保存'")
      assert.deepEqual(await run("JSON.parse(document.querySelector('.common-environment-section textarea').value)"), {
        SHARED: 'two', API_KEY: 'fixture-refreshed-key', EMPTY: 'updated', TIMEOUT_MS: '60000', RETRY_COUNT: '2', ENABLED: 'true', ZERO: '0', DISABLED: 'false', BLANK: ''
      })
      assert.equal(await run("document.querySelector('.runtime-startup-actions button[type=submit]').disabled"), true)
      await capture('environment-common-day')
      await click('.runtime-startup-back')
      await wait("!document.querySelector('.runtime-startup-page')")
      const area = active + '.member-environment-json'
      assert.equal(await run(`document.querySelector(${JSON.stringify(area)}).readOnly`), true)
      await wait(`JSON.parse(document.querySelector(${JSON.stringify(area)}).value).SHARED === 'two'`)
      await click(active + '.environment-text-link', '编辑')
      assert.equal(await run(`document.querySelector(${JSON.stringify(area)}).value`), '{  "LOCAL" : "draft", "EMPTY" : "", "RETRY_COUNT": 0, "ENABLED": false, "PADDED": "00123"  }')
      const rawMemberDraft = await run(`document.querySelector(${JSON.stringify(area)}).value`)
      for (const value of ['null', '[]', '{}', '9007199254740993', '1e400']) {
        const invalid = `{ "OPTIONS":${value}, "LOCAL":"kept" }`
        const before = await run("window.memberFixture.calls.filter(item=>item.method==='members.runtime.set').length")
        await fill(area, invalid)
        await saveRuntime()
        await wait(`document.querySelector('${active}.environment-error')`)
        assert.match(await run(`document.querySelector('${active}.environment-error').textContent`), /OPTIONS/)
        assert.equal(await run(`document.querySelector(${JSON.stringify(area)}).value`), invalid)
        assert.equal(await run("window.memberFixture.calls.filter(item=>item.method==='members.runtime.set').length"), before)
      }
      await fill(area, rawMemberDraft)
      await run("window.memberFixture.fail('members.runtime.set')")
      await saveRuntime()
      await wait(`document.querySelector('${active}.member-runtime-form [role=alert]')`)
      assert.equal(await run(`document.querySelector(${JSON.stringify(area)}).value`), rawMemberDraft)
      await click(active + '.environment-text-link', '查看合并结果')
      await saveRuntime()
      await wait("window.memberFixture.environment(window.memberFixture.profiles()[0].agentId,'codex-cli').environment.LOCAL === 'draft'")
      const own = await run("window.memberFixture.environment(window.memberFixture.profiles()[0].agentId,'codex-cli')")
      assert.deepEqual(own.environment, { LOCAL: 'draft', EMPTY: '', RETRY_COUNT: '0', ENABLED: 'false', PADDED: '00123' })
      assert.equal(own.inheritCommon, true)
      await click(active + '.environment-text-link', '编辑')
      await wait(`document.querySelector(${JSON.stringify(area)}).value === ${JSON.stringify(JSON.stringify({ LOCAL: 'draft', EMPTY: '', RETRY_COUNT: '0', ENABLED: 'false', PADDED: '00123' }, null, 2))}`)
      await click(active + '.environment-text-link', '查看合并结果')
    })
    await check('independent variables, discard guard, and removing common settings restore the compact editor', async () => {
      await click(active + '.environment-inherit-row input')
      const area = active + '.member-environment-json'
      await wait(`!Object.hasOwn(JSON.parse(document.querySelector(${JSON.stringify(area)}).value),'SHARED')`)
      await click(active + '.environment-text-link', '编辑通用配置')
      await wait("document.querySelector('.runtime-startup-page') && !document.querySelector('.common-environment-section textarea').disabled")
      await fill('.common-environment-section textarea', '{"SHARED":"discard-this"}')
      await click('.runtime-startup-back')
      await wait("document.querySelector('[role=dialog]')")
      await click('[role=dialog] button', '放弃更改')
      await wait("!document.querySelector('.runtime-startup-page')")
      assert.equal(await run(`document.querySelector('${active}.environment-inherit-row input').checked`), false)
      await click(active + '.environment-text-link', '编辑通用配置')
      await wait("document.querySelector('.runtime-startup-page') && !document.querySelector('.common-environment-section textarea').disabled")
      assert.equal(await run("JSON.parse(document.querySelector('.common-environment-section textarea').value).SHARED"), 'two')
      await fill('.common-environment-section textarea', '{"SHARED":"local-conflict"}')
      await run("window.memberFixture.common('codex-cli', { SHARED: 'external', API_KEY: 'fixture-external-key' })")
      await click('.runtime-startup-actions button', '保存')
      await wait("document.querySelector('.common-environment-section .environment-error')")
      assert.equal(await run("JSON.parse(document.querySelector('.common-environment-section textarea').value).SHARED"), 'local-conflict')
      await click('.common-environment-section .environment-error button', '重新读取')
      await wait("JSON.parse(document.querySelector('.common-environment-section textarea').value).SHARED === 'external'")
      await fill('.common-environment-section textarea', '{"SHARED":"discard-after-reload"}')
      await click('.runtime-startup-actions button', '放弃更改')
      assert.deepEqual(await run("JSON.parse(document.querySelector('.common-environment-section textarea').value)"), {
        SHARED: 'external', API_KEY: 'fixture-external-key'
      })
      assert.equal(await run("document.querySelector('.runtime-startup-actions button[type=submit]').disabled"), true)
      assert.equal(await run("!!document.querySelector('.common-environment-section .environment-error')"), false)
      await fill('.common-environment-section textarea', '{}')
      await click('.runtime-startup-actions button', '保存')
      await wait("document.querySelector('.runtime-startup-actions [role=status]')?.textContent === '已保存'")
      await click('.runtime-startup-back')
      await wait(`!document.querySelector('${active}.environment-inherit-row')`)
      assert.equal(await run(`document.querySelector(${JSON.stringify(area)}).readOnly`), false)
      assert.deepEqual(await run(`JSON.parse(document.querySelector(${JSON.stringify(area)}).value)`), { LOCAL: 'draft', EMPTY: '', RETRY_COUNT: '0', ENABLED: 'false', PADDED: '00123' })
      await run("window.memberFixture.theme('night')")
      window.setContentSize(1040,700)
      await settle()
      await capture('environment-independent-night-minimum')
      assert.equal((await geometry()).overflow, false)
    })
    assert.deepEqual(errors, [])
    assert.ok(cases.length > 0, 'At least one member editor case must run')
    console.log(JSON.stringify({ ok: true, cases }))
    window.destroy()
    app.exit(0)
  })
  .catch(async (error) => {
    console.error(error.stack)
    if (window) {
      try {
        writeFileSync(
          join(dirname(userData), 'failure.png'),
          (await window.webContents.capturePage()).toPNG()
        )
      } catch {}
      window.destroy()
    }
    app.exit(1)
  })
