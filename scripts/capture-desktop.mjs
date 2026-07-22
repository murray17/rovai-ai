import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const appPath = process.argv[2]
const outputPrefix = process.argv[3] ?? '/tmp/lumen-desktop'
const port = Number(process.env.LUMEN_DEBUG_PORT ?? 9333)
const captureWidth = Number(process.env.LUMEN_CAPTURE_WIDTH ?? 1440)
const captureHeight = Number(process.env.LUMEN_CAPTURE_HEIGHT ?? 920)
const targetRuntimeKind = process.env.LUMEN_CAPTURE_RUNTIME_KIND ?? null
const targetRuntimeLabel = targetRuntimeKind && ({
  'codex-cli': 'Codex CLI',
  'opencode-cli': 'OpenCode CLI',
  'copilot-cli': 'GitHub Copilot CLI',
  'agy-cli': 'Antigravity CLI'
})[targetRuntimeKind]
if (!appPath) throw new Error('Usage: node scripts/capture-desktop.mjs <Lumen AI.app> [output-prefix]')
if (targetRuntimeKind && !targetRuntimeLabel) throw new Error(`Unknown LUMEN_CAPTURE_RUNTIME_KIND: ${targetRuntimeKind}`)

const executable = join(appPath, 'Contents', 'MacOS', 'Lumen AI')
const launchArguments = [`--remote-debugging-port=${port}`]
if (process.env.LUMEN_CAPTURE_USER_DATA_DIR) {
  launchArguments.push(`--user-data-dir=${process.env.LUMEN_CAPTURE_USER_DATA_DIR}`)
}
const app = spawn(executable, launchArguments, {
  stdio: ['ignore', 'ignore', 'pipe']
})
const stderr = []
app.stderr.on('data', (chunk) => stderr.push(String(chunk)))

try {
  const target = await waitForTarget(port)
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  await cdp.send('Page.bringToFront')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: captureWidth,
    height: captureHeight,
    deviceScaleFactor: 1,
    mobile: false
  })
  await waitForAppReady(cdp, 15_000)
  await capture(cdp, `${outputPrefix}-home.png`)

  let capturedMembers = false
  let capturedMemberDetail = false
  let capturedRuntimeDiagnostics = false
  let configuredMemberRuntime = false
  let capturedLobbyComposer = false
  let capturedDialog = false
  let capturedTask = false
  let capturedChanges = false
  let capturedAudit = false

  const openedMembers = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const button = [...document.querySelectorAll('.sidebar nav button')]
        .find((candidate) => candidate.textContent?.trim() === '◎成员')
      if (!button) return false
      button.click()
      return true
    })()`,
    returnByValue: true
  })
  if (openedMembers.result?.result?.value) {
    await waitForSelector(cdp, '.member-workbench', 5_000)
    const initialMemberState = await cdp.send('Runtime.evaluate', {
      expression: `({
        selected: document.querySelectorAll('.member-list-item.selected').length,
        empty: Boolean(document.querySelector('.member-empty')),
        members: document.querySelectorAll('.member-list-item').length
      })`,
      returnByValue: true
    })
    const initial = initialMemberState.result?.result?.value
    if (initial?.selected !== 0 || !initial?.empty || initial?.members !== 4) {
      throw new Error(`Members view did not preserve explicit selection: ${JSON.stringify(initial)}`)
    }
    await capture(cdp, `${outputPrefix}-members.png`)
    capturedMembers = true

    const selectedMember = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const member = document.querySelector('.member-list-item')
        if (!member) return false
        member.click()
        return true
      })()`,
      returnByValue: true
    })
    if (selectedMember.result?.result?.value) {
      await waitForSelector(cdp, '.member-identity-section', 5_000)
      await capture(cdp, `${outputPrefix}-member-detail.png`)
      capturedMemberDetail = true
    }
  }

  const openedDiagnostics = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const button = [...document.querySelectorAll('.sidebar nav button')]
        .find((candidate) => candidate.textContent?.trim() === '◌诊断')
      if (!button) return false
      button.click()
      return true
    })()`,
    returnByValue: true
  })
  if (openedDiagnostics.result?.result?.value) {
    await waitForSelector(cdp, '.runtime-installations', 5_000)
    await capture(cdp, `${outputPrefix}-runtime-diagnostics.png`)
    capturedRuntimeDiagnostics = true
    if (targetRuntimeLabel) {
      const runtimePresence = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const targetLabel = ${JSON.stringify(targetRuntimeLabel)}
          return [...document.querySelectorAll('.runtime-candidate, .runtime-installation-row')]
            .some((candidate) => candidate.textContent?.includes(targetLabel))
        })()`,
        returnByValue: true
      })
      if (!runtimePresence.result?.result?.value) {
        throw new Error(`${targetRuntimeLabel} was neither discovered nor registered`)
      }
    }
    const registeredDetectedRuntime = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const targetLabel = ${JSON.stringify(targetRuntimeLabel)}
        const cards = [...document.querySelectorAll('.runtime-candidate')]
        const card = targetLabel
          ? cards.find((candidate) => candidate.textContent?.includes(targetLabel))
          : cards[0]
        const button = [...(card?.querySelectorAll('button') ?? [])]
          .find((candidate) => candidate.textContent?.includes('纳入 Lumen'))
        if (!button || button.disabled) return false
        button.click()
        return true
      })()`,
      returnByValue: true
    })
    if (registeredDetectedRuntime.result?.result?.value) {
      await waitForSelector(cdp, '.runtime-installation-row', 60_000)
    }
    if (targetRuntimeLabel) {
      await waitForExpression(cdp, `(() => {
        const targetLabel = ${JSON.stringify(targetRuntimeLabel)}
        const rows = [...document.querySelectorAll('.runtime-installation-row')]
        const row = rows.find((candidate) => candidate.textContent?.includes(targetLabel))
        return Boolean(row?.querySelector('.runtime-snapshot-badge.ready'))
      })()`, 60_000)
    } else if (registeredDetectedRuntime.result?.result?.value) {
      await waitForExpression(cdp, `Boolean(document.querySelector('.runtime-snapshot-badge.ready'))`, 60_000)
    }

    const reopenedMembers = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const button = [...document.querySelectorAll('.sidebar nav button')]
          .find((candidate) => candidate.textContent?.trim() === '◎成员')
        if (!button) return false
        button.click()
        return true
      })()`,
      returnByValue: true
    })
    if (reopenedMembers.result?.result?.value) {
      await waitForSelector(cdp, '.member-workbench', 5_000)
      await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector('.member-list-item')?.click()`,
        returnByValue: true
      })
      await waitForSelector(cdp, '.member-identity-section', 5_000)
      const selectedInstallation = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const select = document.querySelector('.member-detail form .field-label select')
          if (!select || select.options.length < 2) return false
          const targetLabel = ${JSON.stringify(targetRuntimeLabel)}
          const option = targetLabel
            ? [...select.options].find((candidate) => candidate.textContent?.includes(targetLabel))
            : select.options[1]
          if (!option) return false
          select.value = option.value
          select.dispatchEvent(new Event('change', { bubbles: true }))
          return true
        })()`,
        returnByValue: true
      })
      if (targetRuntimeLabel && !selectedInstallation.result?.result?.value) {
        throw new Error(`${targetRuntimeLabel} installation was unavailable in the member form`)
      }
      if (selectedInstallation.result?.result?.value) {
        if (targetRuntimeKind === 'agy-cli') {
          await waitForExpression(cdp, `(() => {
            const labels = [...document.querySelectorAll('.member-detail form .field-label')]
            const value = (key) => labels.find((label) => label.textContent?.includes(key))?.querySelector('select')?.value
            return value('mode') === 'accept-edits'
              && value('sandbox') === 'on'
              && value('dangerously-skip-permissions') === 'off'
          })()`, 5_000)
          const modelCatalog = await cdp.send('Runtime.evaluate', {
            expression: `(() => {
              const labels = [...document.querySelectorAll('.member-detail form .field-label')]
              const strategy = labels.find((label) => label.textContent?.trim().startsWith('模型策略'))?.querySelector('select')
              if (!strategy) return null
              strategy.value = 'explicit'
              strategy.dispatchEvent(new Event('change', { bubbles: true }))
              return true
            })()`,
            returnByValue: true
          })
          if (!modelCatalog.result?.result?.value) throw new Error('AGY model strategy selector is unavailable')
          await waitForExpression(cdp, `(() => {
            const labels = [...document.querySelectorAll('.member-detail form .field-label')]
            const model = labels
              .map((label) => label.querySelector('select'))
              .find((select) => [...(select?.options ?? [])].some((option) => option.textContent?.trim() === '选择模型'))
            return model && model.options.length > 1
              && ![...model.options].some((option) => option.value === 'agy://runtime-default')
          })()`, 5_000)
          const permissionWarning = await cdp.send('Runtime.evaluate', {
            expression: `(() => {
              const labels = [...document.querySelectorAll('.member-detail form .field-label')]
              const skip = labels.find((label) => label.textContent?.includes('dangerously-skip-permissions'))?.querySelector('select')
              if (!skip) return false
              skip.value = 'on'
              skip.dispatchEvent(new Event('change', { bubbles: true }))
              return true
            })()`,
            returnByValue: true
          })
          if (!permissionWarning.result?.result?.value) throw new Error('AGY dangerous permission selector is unavailable')
          await waitForExpression(cdp, `Boolean(document.querySelector('.danger-notice[role="alert"]'))`, 5_000)
          await cdp.send('Runtime.evaluate', {
            expression: `(() => {
              const labels = [...document.querySelectorAll('.member-detail form .field-label')]
              const strategy = labels.find((label) => label.textContent?.trim().startsWith('模型策略'))?.querySelector('select')
              const skip = labels.find((label) => label.textContent?.includes('dangerously-skip-permissions'))?.querySelector('select')
              if (!strategy || !skip) return false
              strategy.value = 'runtime_default'
              strategy.dispatchEvent(new Event('change', { bubbles: true }))
              skip.value = 'off'
              skip.dispatchEvent(new Event('change', { bubbles: true }))
              return true
            })()`,
            returnByValue: true
          })
          await waitForExpression(cdp, `!document.querySelector('.danger-notice[role="alert"]')`, 5_000)
        } else if (!targetRuntimeKind || targetRuntimeKind === 'codex-cli') {
          await waitForExpression(cdp, `(() => {
            const labels = [...document.querySelectorAll('.member-detail form .field-label')]
            const sandbox = labels.find((label) => label.textContent?.includes('sandbox_mode'))?.querySelector('select')
            const approval = labels.find((label) => label.textContent?.includes('approval_policy'))?.querySelector('select')
            return sandbox?.value === 'workspace-write' && approval?.value === 'on-request'
          })()`, 5_000)
        }
        const saved = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const button = [...document.querySelectorAll('.member-form-actions button')]
              .find((candidate) => candidate.textContent?.includes('保存运行配置'))
            if (!button || button.disabled) return false
            button.click()
            return true
          })()`,
          returnByValue: true
        })
        if (!saved.result?.result?.value) throw new Error('Configured member Runtime could not be saved')
        await waitForSelector(cdp, '.runtime-readiness-badge.readiness-ready', 10_000)
        await capture(cdp, `${outputPrefix}-member-configured.png`)
        configuredMemberRuntime = true
      }
    }
    if (targetRuntimeLabel && !configuredMemberRuntime) {
      throw new Error(`${targetRuntimeLabel} member Runtime configuration did not complete`)
    }
  }

  const openedLobbyEntry = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const create = [...document.querySelectorAll('.topbar-actions button')]
        .find((button) => button.textContent?.includes('新对话'))
      if (!create || create.disabled) return false
      create.click()
      return true
    })()`,
    returnByValue: true
  })
  if (openedLobbyEntry.result?.result?.value) {
    await wait(300)
    const lobbyEntry = await cdp.send('Runtime.evaluate', {
      expression: `({
        composer: Boolean(document.querySelector('.new-conversation-workspace #new-lobby-message')),
        dialog: Boolean(document.querySelector('[role="dialog"]')),
        focused: document.activeElement?.id === 'new-lobby-message'
      })`,
      returnByValue: true
    })
    const lobbyEntryState = lobbyEntry.result?.result?.value
    if (!lobbyEntryState?.composer || lobbyEntryState?.dialog || !lobbyEntryState?.focused) {
      throw new Error(`New conversation did not enter the lobby composer directly: ${JSON.stringify(lobbyEntryState)}`)
    }
    await capture(cdp, `${outputPrefix}-new-conversation.png`)
    capturedLobbyComposer = true
  }
  const openedProject = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const project = document.querySelector('.sidebar-row')
      if (!project) return false
      project.click()
      return true
    })()`,
    returnByValue: true
  })
  if (openedProject.result?.result?.value) {
    await wait(500)
    if (process.env.LUMEN_CAPTURE_LAYOUT_DIAGNOSTICS === '1') {
      const layout = await cdp.send('Runtime.evaluate', {
        expression: `(() => [...document.querySelectorAll('*')]
          .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.closest('.task-card'))
          .map((element) => ({
            tag: element.tagName,
            className: element.className,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            left: Math.round(element.getBoundingClientRect().left),
            right: Math.round(element.getBoundingClientRect().right),
            width: Math.round(element.getBoundingClientRect().width),
            flex: getComputedStyle(element).flex,
            minWidth: getComputedStyle(element).minWidth,
            overflow: getComputedStyle(element).overflow
          })))()`,
        returnByValue: true
      })
      process.stdout.write(`${JSON.stringify(layout.result?.result?.value, null, 2)}\n`)
    }
    await capture(cdp, `${outputPrefix}-project.png`)
    const openedDialog = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const create = [...document.querySelectorAll('button')]
          .find((button) => button.textContent?.includes('新建项目任务'))
        if (!create || create.disabled) return false
        create.click()
        return true
      })()`,
      returnByValue: true
    })
    if (openedDialog.result?.result?.value) {
      await wait(300)
      await capture(cdp, `${outputPrefix}-create-task.png`)
      capturedDialog = true
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
      await wait(200)
    }

    const openedTask = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const task = document.querySelector('.sidebar-task')
        if (!task) return false
        task.click()
        return true
      })()`,
      returnByValue: true
    })
    if (openedTask.result?.result?.value) {
      await waitForSelector(cdp, '.workspace-shell', 5_000)
      await wait(700)
      if (process.env.LUMEN_CAPTURE_LAYOUT_DIAGNOSTICS === '1') {
        const layout = await cdp.send('Runtime.evaluate', {
          expression: `(() => ({
            viewport: { width: innerWidth, height: innerHeight },
            document: {
              clientWidth: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              clientHeight: document.documentElement.clientHeight,
              scrollHeight: document.documentElement.scrollHeight
            },
            escaped: [...document.querySelectorAll('body *')]
              .filter((element) => {
                const rect = element.getBoundingClientRect()
                const style = getComputedStyle(element)
                return style.position !== 'fixed' && (rect.left < -1 || rect.right > innerWidth + 1)
              })
              .slice(0, 30)
              .map((element) => ({
                tag: element.tagName,
                className: element.className,
                left: Math.round(element.getBoundingClientRect().left),
                right: Math.round(element.getBoundingClientRect().right),
                overflow: getComputedStyle(element).overflow
              }))
          }))()`,
          returnByValue: true
        })
        process.stdout.write(`task-layout ${JSON.stringify(layout.result?.result?.value, null, 2)}\n`)
      }
      await capture(cdp, `${outputPrefix}-task.png`)
      capturedTask = true

      if (await activateTab(cdp, '变更')) {
        await wait(200)
        await capture(cdp, `${outputPrefix}-task-changes.png`)
        capturedChanges = true
      }
      if (await activateTab(cdp, '审计')) {
        await wait(200)
        await capture(cdp, `${outputPrefix}-task-audit.png`)
        capturedAudit = true
      }
    }
  }
  cdp.close()
  process.stdout.write(`${outputPrefix}-home.png\n`)
  if (capturedMembers) process.stdout.write(`${outputPrefix}-members.png\n`)
  if (capturedMemberDetail) process.stdout.write(`${outputPrefix}-member-detail.png\n`)
  if (capturedRuntimeDiagnostics) process.stdout.write(`${outputPrefix}-runtime-diagnostics.png\n`)
  if (configuredMemberRuntime) process.stdout.write(`${outputPrefix}-member-configured.png\n`)
  if (capturedLobbyComposer) process.stdout.write(`${outputPrefix}-new-conversation.png\n`)
  if (openedProject.result?.result?.value) process.stdout.write(`${outputPrefix}-project.png\n`)
  if (capturedDialog) process.stdout.write(`${outputPrefix}-create-task.png\n`)
  if (capturedTask) process.stdout.write(`${outputPrefix}-task.png\n`)
  if (capturedChanges) process.stdout.write(`${outputPrefix}-task-changes.png\n`)
  if (capturedAudit) process.stdout.write(`${outputPrefix}-task-audit.png\n`)
} finally {
  app.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveClose) => app.once('close', resolveClose)),
    wait(2_000)
  ])
  if (app.exitCode === null) app.kill('SIGKILL')
}

async function capture(cdp, path) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  })
  await writeFile(path, Buffer.from(result.result.data, 'base64'))
}

async function waitForAppReady(cdp, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const state = await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('.sidebar-footer strong')?.textContent ?? ''`,
      returnByValue: true
    })
    if (state.result?.result?.value === 'Core 已连接') return
    await wait(150)
  }
  throw new Error(`Lumen did not become ready within ${timeoutMs}ms. ${stderr.join('')}`)
}

async function waitForSelector(cdp, selector, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const state = await cdp.send('Runtime.evaluate', {
      expression: `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      returnByValue: true
    })
    if (state.result?.result?.value) return
    await wait(100)
  }
  throw new Error(`Selector did not appear within ${timeoutMs}ms: ${selector}`)
}

async function waitForExpression(cdp, expression, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const state = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true
    })
    if (state.result?.result?.value) return
    await wait(100)
  }
  throw new Error(`Expression did not become true within ${timeoutMs}ms: ${expression}`)
}

async function activateTab(cdp, label) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')]
        .find((element) => element.textContent?.trim().startsWith(${JSON.stringify(label)}))
      if (!tab) return false
      tab.focus()
      tab.click()
      return true
    })()`,
    returnByValue: true
  })
  if (!result.result?.result?.value) return false

  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' })
  const startedAt = Date.now()
  while (Date.now() - startedAt < 2_000) {
    const selected = await cdp.send('Runtime.evaluate', {
      expression: `(() => [...document.querySelectorAll('[role="tab"]')]
        .some((element) => element.textContent?.trim().startsWith(${JSON.stringify(label)}) && element.getAttribute('aria-selected') === 'true'))()`,
      returnByValue: true
    })
    if (selected.result?.result?.value) return true
    await wait(50)
  }
  return false
}

async function waitForTarget(debugPort) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 15_000) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => response.json())
      const target = targets.find((candidate) => candidate.type === 'page')
      if (target) return target
    } catch {
      // Electron is still starting.
    }
    await wait(150)
  }
  throw new Error(`Electron DevTools target did not appear. ${stderr.join('')}`)
}

async function connectCdp(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 1
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', rejectOpen, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message)
  })
  return {
    send(method, params = {}) {
      return new Promise((resolveSend, rejectSend) => {
        const id = nextId++
        pending.set(id, { resolve: resolveSend, reject: rejectSend })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() {
      socket.close()
    }
  }
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
