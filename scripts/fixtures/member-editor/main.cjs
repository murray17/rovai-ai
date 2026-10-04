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
    const parameterButtons = active + '.runtime-parameter-form .field-label:not(.runtime-model-field) .runtime-model-picker-trigger'
    const openParameter = async index => {
      const label = await run(`document.querySelectorAll(${JSON.stringify(parameterButtons)})[${index}].getAttribute('aria-label')`)
      await click(`button[aria-label=${JSON.stringify(label)}]`)
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
        `(() => { const q = selector => document.querySelector(selector); const box = selector => q(selector).getBoundingClientRect(); return { appRail: box('.unified-sidebar').width, roster: box('.member-sidebar').width, avatar: box('.member-sidebar-select .member-avatar').width, portrait: box('${active}.member-portrait').width, overflow: document.documentElement.scrollWidth > innerWidth || q('.members-view').scrollWidth > q('.members-view').clientWidth, tabCount: q('.members-view').querySelectorAll('[role=tab]').length, modal: !!q('[aria-modal=true]') } })()`
      )
    const reloadPage = async () => {
      const loaded = require('node:events').once(window.webContents, 'did-finish-load')
      // A fixture reset deliberately discards its own draft; normal UI guard
      // behavior is exercised separately above and below these reset points.
      window.webContents.once('will-prevent-unload', (event) => event.preventDefault())
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
    await check('roster snaps in both directions and restores its useful width', async () => {
      assert.deepEqual(await dragRoster([179, 170, 190, 216]), [192, 76, 76, 216])
      await key('Home')
      assert.deepEqual(await dragRoster([170]), [76])
      assert.equal(await run('!!document.querySelector(".member-sidebar.is-collapsed")'), true)
      await click('.member-roster-resizer'); await key('Right')
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
      assert.equal(await run(`document.querySelector('${active}.member-header-runtime').textContent.trim()`), '未配置智能体')
      await click('.member-sidebar-filter button[aria-label="清除队员筛选"]')
      await click('.member-sidebar-select', '芝士鉴定士')
      assert.equal(await run(`document.querySelector('${active}.member-header-runtime').textContent.trim()`), 'Claude Code')
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
      'new teammate is inline and counted only after creation, including its selected portrait',
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
