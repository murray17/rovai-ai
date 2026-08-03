import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const appPath = process.argv[2]
const outputPrefix = process.argv[3] ?? '/tmp/rovai-camp-inspectors'
const userDataDir = process.env.ROVAI_CAPTURE_USER_DATA_DIR
const port = Number(process.env.ROVAI_DEBUG_PORT ?? 9433)
const width = Number(process.env.ROVAI_CAPTURE_WIDTH ?? 1440)
const height = Number(process.env.ROVAI_CAPTURE_HEIGHT ?? 920)
const theme = process.env.ROVAI_CAPTURE_THEME ?? null
const relaxed = process.env.ROVAI_CAPTURE_RELAXED === '1'
const expectsComposerAttachments =
  process.env.ROVAI_CAPTURE_EXPECT_COMPOSER_ATTACHMENTS !== undefined
const expectsTimelineAttachments =
  process.env.ROVAI_CAPTURE_EXPECT_TIMELINE_ATTACHMENTS !== undefined
const expectedComposerAttachments = Number(
  process.env.ROVAI_CAPTURE_EXPECT_COMPOSER_ATTACHMENTS ?? 0
)
const expectedTimelineAttachments = Number(
  process.env.ROVAI_CAPTURE_EXPECT_TIMELINE_ATTACHMENTS ?? 0
)
const captureAttachmentLightbox =
  process.env.ROVAI_CAPTURE_ATTACHMENT_LIGHTBOX === '1'
const previewAttachmentId =
  process.env.ROVAI_CAPTURE_PREVIEW_ATTACHMENT_ID ?? null
const exerciseAttachmentInputs =
  process.env.ROVAI_CAPTURE_EXERCISE_ATTACHMENT_INPUTS === '1'
const attachmentCampId =
  process.env.ROVAI_CAPTURE_CAMP_ID ?? null

if (!appPath || !userDataDir) {
  throw new Error('Usage: ROVAI_CAPTURE_USER_DATA_DIR=<data> node scripts/capture-camp-inspectors.mjs <Rovai-ai.app> [output-prefix]')
}
if (theme && !['system', 'day', 'night'].includes(theme)) {
  throw new Error(`Unknown ROVAI_CAPTURE_THEME: ${theme}`)
}

const executable = join(appPath, 'Contents', 'MacOS', 'Rovai-ai')
const app = spawn(executable, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`
], {
  stdio: ['ignore', 'ignore', 'pipe'],
  env: { ...process.env, ROVAI_ALLOW_ISOLATED_INSTANCE: '1' }
})
const stderr = []
app.stderr.on('data', (chunk) => stderr.push(String(chunk)))

try {
  const target = await waitForTarget(port)
  const cdp = await connectCdp(target.webSocketDebuggerUrl)
  await cdp.send('Page.bringToFront')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  })
  if (theme) {
    await cdp.send('Runtime.evaluate', {
      expression: `window.rovai.appearance.setPreference(${JSON.stringify(theme)})`,
      awaitPromise: true,
      returnByValue: true
    })
    await waitForExpression(cdp, `document.documentElement.dataset.theme === 'day'`, 5_000)
  }
  await waitForExpression(cdp, `Boolean(document.querySelector('.camp-nav-row'))`, 45_000)
  await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      document.querySelector('.camp-nav-row .camp-nav-open')?.click()
    })()`,
    returnByValue: true
  })
  await waitForExpression(cdp, `Boolean(document.querySelector('.camp-workspace'))`, 30_000)
  await waitForExpression(cdp, `Boolean(document.querySelector('.topbar-inspector-toggle'))`, 5_000)
  await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const toggle = document.querySelector('.topbar-inspector-toggle')
      if (toggle?.getAttribute('aria-pressed') === 'false') toggle.click()
    })()`,
    returnByValue: true
  })
  await waitForExpression(cdp, `Boolean(document.querySelector('.activity-pane'))`, 5_000)
  const visibleInspectorInspection = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const track = document.querySelector('.timeline-track')?.getBoundingClientRect()
      const composer = document.querySelector('.composer-box')?.getBoundingClientRect()
      const grid = document.querySelector('.workspace-grid')?.getBoundingClientRect()
      const inspector = document.querySelector('.activity-pane')?.getBoundingClientRect()
      const copy = document.querySelector('.conversation-bubble .message-copy-button')
      return {
        togglePressed: document.querySelector('.topbar-inspector-toggle')?.getAttribute('aria-pressed'),
        aligned: Boolean(track && composer)
          && Math.abs(track.left - composer.left) <= 2
          && Math.abs(track.width - composer.width) <= 2,
        inspectorSpansControls: Boolean(grid && inspector)
          && Math.abs(grid.bottom - inspector.bottom) <= 2,
        copyInsideContent: !copy || Boolean(copy.closest('.message-surface')),
        copyAbsentFromMetadata: !document.querySelector('.bubble-meta .message-copy-button'),
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
      }
    })()`,
    returnByValue: true
  })
  const visibleInspector = visibleInspectorInspection.result?.result?.value
  if (visibleInspector?.togglePressed !== 'true'
      || !visibleInspector?.aligned
      || !visibleInspector?.inspectorSpansControls
      || !visibleInspector?.copyInsideContent
      || !visibleInspector?.copyAbsentFromMetadata
      || visibleInspector?.horizontalOverflow) {
    throw new Error(`Visible Camp Inspector acceptance failed: ${JSON.stringify(visibleInspector)}`)
  }
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('.topbar-inspector-toggle')?.click()`,
    returnByValue: true
  })
  await waitForExpression(
    cdp,
    `!document.querySelector('.activity-pane')
      && document.querySelector('.workspace-grid')?.classList.contains('inspector-collapsed')
      && localStorage.getItem('rovai.camp.inspector.visibility') === 'hidden'`,
    5_000
  )
  const hiddenInspectorInspection = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const track = document.querySelector('.timeline-track')?.getBoundingClientRect()
      const composer = document.querySelector('.composer-box')?.getBoundingClientRect()
      return {
        togglePressed: document.querySelector('.topbar-inspector-toggle')?.getAttribute('aria-pressed'),
        aligned: Boolean(track && composer)
          && Math.abs(track.left - composer.left) <= 2
          && Math.abs(track.width - composer.width) <= 2,
        inspector: Boolean(document.querySelector('.activity-pane')),
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
      }
    })()`,
    returnByValue: true
  })
  const hiddenInspector = hiddenInspectorInspection.result?.result?.value
  if (hiddenInspector?.togglePressed !== 'false'
      || !hiddenInspector?.aligned
      || hiddenInspector?.inspector
      || hiddenInspector?.horizontalOverflow) {
    throw new Error(`Hidden Camp Inspector acceptance failed: ${JSON.stringify(hiddenInspector)}`)
  }
  await capture(cdp, `${outputPrefix}-inspector-hidden.png`)
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('.topbar-inspector-toggle')?.click()`,
    returnByValue: true
  })
  await waitForExpression(
    cdp,
    `Boolean(document.querySelector('.activity-pane'))
      && localStorage.getItem('rovai.camp.inspector.visibility') === 'visible'`,
    5_000
  )
  if (previewAttachmentId) {
    const previewProbe = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const preview = await window.rovai.composerAttachments.preview(
            ${JSON.stringify(previewAttachmentId)}
          )
          return {
            ok: Boolean(preview),
            mediaType: preview?.mediaType ?? null,
            byteLength: preview?.bytes?.byteLength ?? preview?.bytes?.length ?? null,
            bytesType: preview?.bytes?.constructor?.name ?? null
          }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    })
    const probe = previewProbe.result?.result?.value
    if (!probe?.ok) throw new Error(`Camp attachment preview IPC failed: ${JSON.stringify(probe)}`)
  }
  if (expectedComposerAttachments > 0) {
    await waitForExpression(
      cdp,
      `document.querySelectorAll('.composer-attachment-strip .attachment-card').length === ${expectedComposerAttachments}`,
      30_000
    )
    await waitForExpression(
      cdp,
      `document.querySelectorAll('.composer-attachment-strip .attachment-card img').length > 0`,
      30_000
    )
  }
  if (expectedTimelineAttachments > 0) {
    await waitForExpression(
      cdp,
      `document.querySelectorAll('.timeline-attachment-card').length === ${expectedTimelineAttachments}`,
      30_000
    )
    if (captureAttachmentLightbox) {
      await waitForExpression(
        cdp,
        `document.querySelectorAll('.timeline-attachment-card img').length > 0`,
        30_000
      )
    }
  }
  let attachmentInspection = await cdp.send('Runtime.evaluate', {
    expression: `({
      composerAttachments: document.querySelectorAll('.composer-attachment-strip .attachment-card').length,
      timelineAttachments: document.querySelectorAll('.timeline-attachment-card').length,
      composerImages: document.querySelectorAll('.composer-attachment-strip .attachment-card img').length,
      leakedAbsolutePath: document.querySelector('.camp-workspace')?.textContent?.includes('/camp-attachments/')
        || document.querySelector('.camp-workspace')?.textContent?.includes('/Users/')
    })`,
    returnByValue: true
  })
  let attachments = attachmentInspection.result?.result?.value
  if (attachments?.leakedAbsolutePath
      || (expectsComposerAttachments
        && attachments?.composerAttachments !== expectedComposerAttachments)
      || (expectsTimelineAttachments
        && attachments?.timelineAttachments !== expectedTimelineAttachments)) {
    throw new Error(`Camp attachment acceptance failed: ${JSON.stringify(attachments)}`)
  }
  if (captureAttachmentLightbox) {
    const openedLightbox = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const trigger = document.querySelector('button[aria-label^="预览附件"]')
        trigger?.focus()
        trigger?.click()
        return Boolean(trigger)
      })()`,
      returnByValue: true
    })
    if (!openedLightbox.result?.result?.value) {
      throw new Error('Camp attachment image preview was not keyboard reachable')
    }
    await waitForExpression(cdp, `Boolean(document.querySelector('.attachment-lightbox img'))`, 5_000)
    await capture(cdp, `${outputPrefix}-attachment-lightbox.png`)
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    await waitForExpression(cdp, `!document.querySelector('.attachment-lightbox')`, 5_000)
  }
  if (exerciseAttachmentInputs) {
    const inputExercise = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const composer = document.querySelector('.composer')
        const editor = document.querySelector('#camp-message')
        if (!composer
            || !editor
            || editor.getAttribute('contenteditable') !== 'true') return { started: false }

        const ordinaryClipboard = new DataTransfer()
        ordinaryClipboard.setData('text/plain', '普通文字粘贴')
        const ordinaryPaste = new ClipboardEvent('paste', {
          clipboardData: ordinaryClipboard,
          bubbles: true,
          cancelable: true
        })
        const ordinaryPasteHandled = !editor.dispatchEvent(ordinaryPaste)

        const pngBase64 =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
        const pngBytes = Uint8Array.from(atob(pngBase64), (character) => character.charCodeAt(0))
        const dropData = new DataTransfer()
        dropData.items.add(new File(['drag-one'], '拖入说明.txt', { type: 'text/plain' }))
        dropData.items.add(new File([pngBytes], '拖入截图.png', { type: 'image/png' }))
        composer.dispatchEvent(new DragEvent('dragenter', {
          dataTransfer: dropData,
          bubbles: true,
          cancelable: true
        }))
        composer.dispatchEvent(new DragEvent('drop', {
          dataTransfer: dropData,
          bubbles: true,
          cancelable: true
        }))

        const pasteData = new DataTransfer()
        pasteData.items.add(new File(['paste-one'], '粘贴日志.txt', { type: 'text/plain' }))
        editor.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: pasteData,
          bubbles: true,
          cancelable: true
        }))
        return { started: true, ordinaryPasteHandled }
      })()`,
      returnByValue: true
    })
    const exercise = inputExercise.result?.result?.value
    if (!exercise?.started || !exercise?.ordinaryPasteHandled) {
      throw new Error(`Camp attachment input exercise did not start: ${JSON.stringify(exercise)}`)
    }
    const finalComposerCount = expectedComposerAttachments + 3
    const finalComposerImageCount = (attachments?.composerImages ?? 0) + 1
    await waitForExpression(
      cdp,
      `document.querySelectorAll('.composer-attachment-strip .attachment-card').length === ${finalComposerCount}
        && !document.querySelector('.attachment-preparing, .attachment-error')`,
      45_000
    )
    await waitForExpression(
      cdp,
      `document.querySelectorAll('.composer-attachment-strip .attachment-card img').length >= ${finalComposerImageCount}`,
      30_000
    )
    const originalBody = await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('#camp-message')?.textContent ?? ''`,
      returnByValue: true
    })
    const body = originalBody.result?.result?.value
    await replaceCampComposerText(cdp, '')
    await waitForExpression(
      cdp,
      `document.querySelector('.composer button[type="submit"]')?.disabled === true`,
      5_000
    )
    await replaceCampComposerText(cdp, body)

    if (attachmentCampId) {
      const rejectionProbe = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          const campId = ${JSON.stringify(attachmentCampId)}
          const before = await window.rovai.request('camp.composerDraft.get', { campId })
          let rejected = false
          try {
            await window.rovai.request('camp.messages.send', {
              commandId: crypto.randomUUID(),
              campId,
              draftRevision: before.revision + 1,
              replyToCampMessageId: null,
              execution: null
            })
          } catch {
            rejected = true
          }
          const after = await window.rovai.request('camp.composerDraft.get', { campId })
          return {
            rejected,
            retained: before.body === after.body
              && before.attachments.map((attachment) => attachment.id).join(',')
                === after.attachments.map((attachment) => attachment.id).join(',')
          }
        })()`,
        awaitPromise: true,
        returnByValue: true
      })
      const rejection = rejectionProbe.result?.result?.value
      if (!rejection?.rejected || !rejection?.retained) {
        throw new Error(`Rejected send did not retain the Camp Draft: ${JSON.stringify(rejection)}`)
      }
    }

    await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('.unified-primary-nav button[aria-label="队员"]')?.click()`,
      returnByValue: true
    })
    await waitForExpression(cdp, `Boolean(document.querySelector('.member-workbench'))`, 10_000)
    await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('.camp-nav-row .camp-nav-open')?.click()`,
      returnByValue: true
    })
    await waitForExpression(
      cdp,
      `document.querySelectorAll('.composer-attachment-strip .attachment-card').length === ${finalComposerCount}
        && document.querySelector('#camp-message')?.textContent === ${JSON.stringify(body)}`,
      30_000
    )
    await waitForExpression(
      cdp,
      `document.querySelectorAll('.composer-attachment-strip .attachment-card img').length >= ${finalComposerImageCount}`,
      30_000
    )
    attachmentInspection = await cdp.send('Runtime.evaluate', {
      expression: `({
        composerAttachments: document.querySelectorAll('.composer-attachment-strip .attachment-card').length,
        timelineAttachments: document.querySelectorAll('.timeline-attachment-card').length,
        composerImages: document.querySelectorAll('.composer-attachment-strip .attachment-card img').length,
        leakedAbsolutePath: document.querySelector('.camp-workspace')?.textContent?.includes('/camp-attachments/')
          || document.querySelector('.camp-workspace')?.textContent?.includes('/Users/')
      })`,
      returnByValue: true
    })
    attachments = {
      ...attachmentInspection.result?.result?.value,
      dragAndPasteAccepted: true,
      ordinaryTextPastePreserved: true,
      pureAttachmentSendBlocked: true,
      rejectedSendRetainedDraft: Boolean(attachmentCampId),
      navigationRestoredDraft: true
    }
  }
  if (!relaxed) {
    await waitForExpression(cdp, `document.querySelectorAll('.a2a-row').length === 2`, 30_000)
  }
  const activityInspection = await cdp.send('Runtime.evaluate', {
    expression: `document.querySelectorAll('.a2a-row').length`,
    returnByValue: true
  })
  const a2aRows = activityInspection.result?.result?.value
  await capture(cdp, `${outputPrefix}-activity.png`)

  if (relaxed) {
    const panelCounts = {}
    for (const tabName of ['任务', '上下文', '审批', '审计']) {
      await openTab(cdp, tabName)
      const tabSlug = ({ 任务: 'tasks', 上下文: 'context', 审批: 'approvals', 审计: 'audit' })[tabName]
      const selector = ({
        任务: '.task-list-row',
        上下文: '.context-card',
        审批: '.approval-card',
        审计: '.audit-row'
      })[tabName]
      const count = await cdp.send('Runtime.evaluate', {
        expression: `document.querySelectorAll(${JSON.stringify(selector)}).length`,
        returnByValue: true
      })
      panelCounts[tabSlug] = count.result?.result?.value
      await capture(cdp, `${outputPrefix}-${tabSlug}.png`)
    }
    const relaxedInspection = await cdp.send('Runtime.evaluate', {
      expression: `({
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        theme: document.documentElement.dataset.theme,
        viewport: { width: window.innerWidth, height: window.innerHeight }
      })`,
      returnByValue: true
    })
    const result = {
      a2aRows,
      ...panelCounts,
      ...attachments,
      ...relaxedInspection.result?.result?.value
    }
    if (result.horizontalOverflow || (theme && result.theme !== 'day')) {
      throw new Error(`Camp workspace acceptance failed: ${JSON.stringify(result)}`)
    }
    cdp.close()
    console.log(JSON.stringify({ ok: true, ...result }, null, 2))
    process.stdout.write(`${outputPrefix}-activity.png\n`)
    process.stdout.write(`${outputPrefix}-tasks.png\n`)
    process.stdout.write(`${outputPrefix}-context.png\n`)
    process.stdout.write(`${outputPrefix}-approvals.png\n`)
    process.stdout.write(`${outputPrefix}-audit.png\n`)
    if (captureAttachmentLightbox) {
      process.stdout.write(`${outputPrefix}-attachment-lightbox.png\n`)
    }
    process.stdout.write(`${outputPrefix}-inspector-hidden.png\n`)
  }

  if (!relaxed) {
    await openTab(cdp, '上下文')
    await waitForExpression(cdp, `document.querySelectorAll('.context-card').length === 3`, 10_000)
    const inspection = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const panel = document.querySelector('.context-panel')
        const text = panel?.textContent ?? ''
        return {
          contextCards: document.querySelectorAll('.context-card').length,
          compactions: document.querySelectorAll('.compaction-row').length,
          leakedFrozenPrompt: text.includes('[CURRENT_INPUT]') || text.includes('执行 A2A 验收协议'),
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
          activeTab: document.activeElement?.textContent?.includes('上下文') ?? false,
          viewport: { width: window.innerWidth, height: window.innerHeight }
        }
      })()`,
      returnByValue: true
    })
    const result = { a2aRows, ...inspection.result?.result?.value }
    if (result.a2aRows !== 2
        || result?.contextCards !== 3
        || result?.compactions !== 0
        || result?.leakedFrozenPrompt
        || result?.horizontalOverflow
        || !result?.activeTab) {
      throw new Error(`Camp Inspector acceptance failed: ${JSON.stringify(result)}`)
    }
    await capture(cdp, `${outputPrefix}-context.png`)
    cdp.close()
    console.log(JSON.stringify({ ok: true, ...result }, null, 2))
    process.stdout.write(`${outputPrefix}-activity.png\n${outputPrefix}-context.png\n${outputPrefix}-inspector-hidden.png\n`)
  }
} finally {
  app.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveClose) => app.once('close', resolveClose)),
    wait(2_000)
  ])
  if (app.exitCode === null) app.kill('SIGKILL')
}

async function replaceCampComposerText(cdp, text) {
  const selected = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const editor = document.querySelector('#camp-message')
      if (!editor
          || editor.getAttribute('contenteditable') !== 'true'
          || editor.getAttribute('aria-disabled') === 'true') return false
      editor.focus()
      const range = document.createRange()
      range.selectNodeContents(editor)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return document.activeElement === editor
    })()`,
    returnByValue: true
  })
  if (!selected.result?.result?.value) {
    throw new Error('Structured Camp composer was not editable')
  }
  if (text) {
    await cdp.send('Input.insertText', { text })
  } else {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Backspace',
      code: 'Backspace'
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Backspace',
      code: 'Backspace'
    })
  }
  await waitForExpression(
    cdp,
    `document.querySelector('#camp-message')?.textContent === ${JSON.stringify(text)}`,
    5_000
  )
}

async function capture(cdp, path) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  })
  await writeFile(path, Buffer.from(result.result.data, 'base64'))
}

async function openTab(cdp, label) {
  const opened = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const tab = [...document.querySelectorAll('.tabs-list button')]
        .find((button) => button.textContent?.includes(${JSON.stringify(label)}))
      tab?.focus()
      tab?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
      tab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      tab?.click()
      return Boolean(tab) && document.activeElement === tab
    })()`,
    returnByValue: true
  })
  if (!opened.result?.result?.value) throw new Error(`${label} tab was not keyboard-focusable`)
  await waitForExpression(cdp, `(() => {
    const tab = [...document.querySelectorAll('.tabs-list button')]
      .find((button) => button.textContent?.includes(${JSON.stringify(label)}))
    return tab?.getAttribute('data-state') === 'active'
  })()`, 5_000)
}

async function waitForExpression(cdp, expression, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const state = await cdp.send('Runtime.evaluate', { expression, returnByValue: true })
    if (state.result?.result?.value) return
    await wait(100)
  }
  throw new Error(`Expression did not become true within ${timeoutMs}ms: ${expression}`)
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
