const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { isAbsolute, join, dirname } = require('node:path')
const { app, BrowserWindow } = require('electron')
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
      click(`${active}.member-identity-form button`, '保存队员信息')
    const saveRuntime = () =>
      click(`${active}.member-runtime-form button`, '保存运行配置')
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
        roster: 236,
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
