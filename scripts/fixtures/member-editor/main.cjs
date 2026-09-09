const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow, nativeImage } = require('electron')
const [renderer, userData] = process.argv.slice(2)
assert.ok(isAbsolute(renderer) && isAbsolute(userData))
mkdirSync(userData, { recursive: true })
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
    const errors = []
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') errors.push(event.message)
    })
    await window.loadFile(renderer)
    const run = async (expression) => {
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
    const selectPermission = async (index, value) => {
      await run(
        `(() => { const select = document.querySelectorAll(${JSON.stringify(active + '.runtime-parameter-form select')})[${index}]; select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', { bubbles: true })) })()`
      )
      await settle()
    }
    const roleValue = () =>
      run(`document.querySelectorAll(${JSON.stringify(textInput)})[1].value`)
    const geometry = () =>
      run(
        `(() => { const q = selector => document.querySelector(selector); const box = selector => q(selector).getBoundingClientRect(); return { appRail: box('.unified-sidebar').width, roster: box('.member-sidebar').width, avatar: box('.member-sidebar-select .member-avatar').width, portrait: box('${active}.member-portrait').width, overflow: document.documentElement.scrollWidth > innerWidth || q('.members-view').scrollWidth > q('.members-view').clientWidth, tabCount: q('.members-view').querySelectorAll('[role=tab]').length, modal: !!q('[aria-modal=true]') } })()`
      )
    const reloadPage = async () => {
      const loaded = require('node:events').once(window.webContents, 'did-finish-load')
      window.webContents.reload()
      await loaded
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
      for (const width of widths) {
        window.webContents.sendInputEvent({ type: 'mouseMove', x: start.x + width - start.width, y: start.y, button: 'left', modifiers: ['leftButtonDown'] })
        await settle()
        observed.push(await rosterWidth())
      }
      window.webContents.sendInputEvent({ type: 'mouseUp', x: start.x + widths.at(-1) - start.width, y: start.y, button: 'left', clickCount: 1 })
      await settle()
      assert.equal(await run('document.querySelector(".member-editor-roster-shell").classList.contains("is-resizing")'), false)
      return observed
    }
    await wait(`document.querySelector(${JSON.stringify(textInput)})`)
    await settle()
    const cases = []
    const check = async (name, action) => {
      console.log(`Checking: ${name}`)
      await action()
      cases.push(name)
    }
    await check('approved day geometry and native fields', async () => {
      assert.deepEqual(await geometry(), {
        appRail: 270,
        roster: 256,
        avatar: 40,
        portrait: 182,
        overflow: false,
        tabCount: 0,
        modal: false
      })
      await capture('member-day')
      const options = await run(
        `[...document.querySelectorAll('${active}.runtime-parameter-form select')].map(select => [...select.options].map(option => [option.value, option.textContent]))`
      )
      assert.deepEqual(options, [
        [
          ['read-only', 'read-only'],
          ['workspace-write', 'workspace-write'],
          ['danger-full-access', 'danger-full-access (no sandbox)']
        ],
        [
          ['untrusted', 'untrusted'],
          ['on-request', 'on-request'],
          ['never', 'never (no approval prompts)']
        ]
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
    await check('roster snaps in both directions and restores its useful width', async () => {
      assert.deepEqual(await dragRoster([179, 170, 190, 216]), [192, 76, 76, 216])
      await key('Home')
      assert.deepEqual(await dragRoster([170]), [76])
      assert.equal(await run('!!document.querySelector(".member-sidebar.is-collapsed")'), true)
      await click('.member-sidebar-actions button[aria-label="展开队员名册"]')
      assert.equal(await rosterWidth(), 256)
      assert.deepEqual(await dragRoster([330]), [330])
      await reloadPage()
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
      await click('.member-sidebar-actions button[aria-label="名册选项"]')
      await click('.member-roster-width-option', '较窄192 px')
      assert.equal(await rosterWidth(), 192)
      await click('.member-roster-resizer')
      await key('Left')
      assert.equal(await rosterWidth(), 76)
      await key('Right')
      assert.equal(await rosterWidth(), 192)
      await key('Home')
      await click('.member-sidebar-actions button[aria-label="名册选项"]')
      await click('.member-roster-options .member-editor-menu-item', '调整队员顺序')
      assert.equal(await run('document.querySelector(".member-roster-resizer").getAttribute("aria-disabled")'), 'true')
      assert.equal(await run(`document.querySelector('.member-sidebar-actions button[aria-label="折叠队员名册"]').disabled`), true)
      await click('.member-sidebar-actions button[aria-label="完成调整队员顺序"]')
      assert.equal(await run('document.querySelector(".member-roster-resizer").hasAttribute("aria-disabled")'), false)
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
    await check('roster preferences preserve old collapse and tolerate corrupt storage', async () => {
      await run(`localStorage.removeItem('rovai-member-roster-width-v2'); localStorage.setItem('rovai-member-roster-width-v1', 'collapsed')`)
      await reloadPage()
      assert.equal(await rosterWidth(), 76)
      await click('.member-sidebar-actions button[aria-label="展开队员名册"]')
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
      assert.equal(await run(`document.querySelector('${active}.member-header-runtime').textContent.trim()`), '未配置运行时')
      await click('.member-sidebar-filter button[aria-label="清除队员筛选"]')
      await click('.member-sidebar-select', '芝士鉴定士')
      assert.equal(await run(`document.querySelector('${active}.member-header-runtime').textContent.trim()`), 'Claude Code')
      await run('window.memberFixture.roster(2)')
      await settle()
      assert.deepEqual(await run('[...document.querySelectorAll(".member-sidebar-group-heading")].map(node => node.textContent)'), ['在队14', '暂离2'])
      await run("window.memberFixture.theme('night')")
      await click('.member-sidebar-actions button[aria-label="折叠队员名册"]')
      await capture('member-roster-night-collapsed')
      await click('.member-sidebar-actions button[aria-label="展开队员名册"]')
      await reloadPage()
    })
    await check(
      'runtime menu has every admitted product icon and keyboard focus return',
      async () => {
        await click(`${active}[data-member-runtime-select]`)
        await wait(
          'document.querySelectorAll(".member-runtime-menu-item").length === 14'
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
          14
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
            `document.querySelector('${active}.runtime-parameter-form select').value`
          ),
          'read-only'
        )
        await saveIdentity()
        await wait(
          `window.memberFixture.profiles()[0].displayName === '叮叮新名称' && document.querySelector('${active}.member-identity-form button[type=submit]').disabled`
        )
        assert.equal(
          await run(
            `document.querySelector('${active}.runtime-parameter-form select').value`
          ),
          'read-only'
        )
        await fill(
          `${active}.member-editor-two-columns > div:nth-child(2) input`,
          '保留职责草稿'
        )
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
        await click(`${active}.member-editor-avatar-option`, '芝士')
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
      'new teammate is inline and counted only after creation, including its selected portrait',
      async () => {
        await click('.member-sidebar-actions button[aria-label="新增队员"]')
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
        await click(`${active}.member-editor-avatar-option`, '叮叮')
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
              `(() => { const status = document.querySelector('${active}.member-editor-runtime-status'); const range = document.createRange(); range.selectNodeContents(status); return range.getBoundingClientRect().height <= status.getBoundingClientRect().height && status.scrollWidth <= status.clientWidth })()`
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
      assert.equal(await run('document.querySelector(".profile-mention").textContent'), '@Murray')
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
      assert.equal(await run('document.querySelector(".profile-preview-meta").textContent'), 'Murray09:41')
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
      await click('.member-sidebar-actions button[aria-label="新增队员"]')
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
    assert.deepEqual(errors, [])
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
