import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const appPath = process.argv[2]
const outputPrefix = process.argv[3] ?? '/tmp/rovai-camp-inspectors'
const userDataDir = process.env.ROVAI_CAPTURE_USER_DATA_DIR
const port = Number(process.env.ROVAI_DEBUG_PORT ?? 9433)
const width = Number(process.env.ROVAI_CAPTURE_WIDTH ?? 1440)
const height = Number(process.env.ROVAI_CAPTURE_HEIGHT ?? 920)
const zoomFactor = Number(process.env.ROVAI_CAPTURE_ZOOM_FACTOR ?? 1)
const theme = process.env.ROVAI_CAPTURE_THEME ?? null
const expectedTheme = theme === 'day' || theme === 'night' ? theme : null
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
  throw new Error('Usage: ROVAI_CAPTURE_USER_DATA_DIR=<data> node scripts/capture-camp-inspectors.mjs <Rovai AI.app> [output-prefix]')
}
if (theme && !['system', 'day', 'night'].includes(theme)) {
  throw new Error(`Unknown ROVAI_CAPTURE_THEME: ${theme}`)
}
if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
  throw new Error(`Invalid ROVAI_CAPTURE_ZOOM_FACTOR: ${zoomFactor}`)
}

const executable = join(appPath, 'Contents', 'MacOS', 'Rovai AI')
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
  const cssWidth = Math.round(width / zoomFactor)
  const cssHeight = Math.round(height / zoomFactor)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: cssWidth,
    height: cssHeight,
    deviceScaleFactor: zoomFactor,
    mobile: false,
    screenWidth: width,
    screenHeight: height
  })
  await waitForExpression(
    cdp,
    `window.innerWidth === ${cssWidth}
      && window.innerHeight === ${cssHeight}
      && Math.abs(window.devicePixelRatio - ${zoomFactor}) < 0.01`,
    5_000
  )
  if (theme) {
    await cdp.send('Runtime.evaluate', {
      expression: `window.rovai.appearance.setPreference(${JSON.stringify(theme)})`,
      awaitPromise: true,
      returnByValue: true
    })
    await waitForExpression(cdp, expectedTheme
      ? `document.documentElement.dataset.theme === ${JSON.stringify(expectedTheme)}`
      : `['day', 'night'].includes(document.documentElement.dataset.theme)`, 5_000)
  }
  await waitForExpression(cdp, `Boolean(document.querySelector('.camp-nav-row'))`, 45_000)
  await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const requested = ${JSON.stringify(attachmentCampId)}
      const trigger = requested
        ? document.querySelector(
            ${JSON.stringify('.camp-menu-trigger[data-sidebar-menu-target="camp:')} + requested + ${JSON.stringify('"]')}
          )?.closest('.camp-nav-row')?.querySelector('.camp-nav-open')
        : document.querySelector('.camp-nav-row .camp-nav-open')
      trigger?.click()
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
      const tabLabels = [...document.querySelectorAll('.activity-tabs > .tabs-list [role="tab"]')]
        .map((tab) => tab.textContent?.replace(/\\d+/g, '').replace(/\\s+/g, ' ').trim() ?? '')
      return {
        togglePressed: document.querySelector('.topbar-inspector-toggle')?.getAttribute('aria-pressed'),
        aligned: Boolean(track && composer)
          && Math.abs((track.left + track.right) / 2 - (composer.left + composer.right) / 2) <= 9
          && Math.abs(track.width - composer.width) <= 18,
        inspectorSpansControls: Boolean(grid && inspector)
          && Math.abs(grid.bottom - inspector.bottom) <= 2,
        copyInsideContent: !copy || Boolean(copy.closest('.message-surface')),
        copyAbsentFromMetadata: !document.querySelector('.bubble-meta .message-copy-button'),
        tabLabels,
        track: track ? { left: track.left, right: track.right, width: track.width } : null,
        composer: composer ? { left: composer.left, right: composer.right, width: composer.width } : null,
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
      || JSON.stringify(visibleInspector?.tabLabels) !== JSON.stringify(['队员', '任务'])
      || visibleInspector?.horizontalOverflow) {
    throw new Error(`Visible Camp Inspector acceptance failed: ${JSON.stringify(visibleInspector)}`)
  }
  let approvalRouting = { present: false }
  if (await evaluateValue(cdp, `Boolean(document.querySelector('.approval-badge'))`)) {
    const approvalBefore = await evaluateValue(cdp, `(() => ({
      togglePressed: document.querySelector('.topbar-inspector-toggle')?.getAttribute('aria-pressed'),
      activeTab: document.querySelector('.tabs-list [role="tab"][data-state="active"]')?.textContent
        ?.replace(/\\d+/g, '').replace(/\\s+/g, ' ').trim() ?? null
    }))()`)
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const collapse = document.querySelector('.approval-dock-collapse[aria-expanded="true"]')
        collapse?.click()
      })()`,
      returnByValue: true
    })
    await waitForExpression(cdp, `document.querySelector('.approval-dock')?.classList.contains('is-collapsed')`, 5_000)
    await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('.approval-badge')?.click()`,
      returnByValue: true
    })
    await waitForExpression(
      cdp,
      `!document.querySelector('.approval-dock')?.classList.contains('is-collapsed')
        && document.activeElement?.matches('.approval-dock .runtime-option:not(:disabled)')`,
      5_000
    )
    const approvalAfter = await evaluateValue(cdp, `(() => ({
      togglePressed: document.querySelector('.topbar-inspector-toggle')?.getAttribute('aria-pressed'),
      activeTab: document.querySelector('.tabs-list [role="tab"][data-state="active"]')?.textContent
        ?.replace(/\\d+/g, '').replace(/\\s+/g, ' ').trim() ?? null,
      expanded: document.querySelector('.approval-dock-collapse')?.getAttribute('aria-expanded'),
      optionFocused: document.activeElement?.matches('.approval-dock .runtime-option:not(:disabled)') ?? false
    }))()`)
    approvalRouting = {
      present: true,
      inspectorUnchanged: approvalAfter.togglePressed === approvalBefore.togglePressed
        && approvalAfter.activeTab === approvalBefore.activeTab,
      ...approvalAfter
    }
    if (!approvalRouting.inspectorUnchanged
        || approvalRouting.expanded !== 'true'
        || !approvalRouting.optionFocused) {
      throw new Error(`Approval Header-to-Dock routing failed: ${JSON.stringify(approvalRouting)}`)
    }
    await capture(cdp, `${outputPrefix}-approval-focus.png`)
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
          && Math.abs((track.left + track.right) / 2 - (composer.left + composer.right) / 2) <= 9
          && Math.abs(track.width - composer.width) <= 18,
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
  const activityInspection = await cdp.send('Runtime.evaluate', {
    expression: `document.querySelectorAll('.a2a-row').length`,
    returnByValue: true
  })
  const a2aRows = activityInspection.result?.result?.value
  await capture(cdp, `${outputPrefix}-activity.png`)

  if (relaxed) {
    const panelCounts = {}
    for (const tabName of ['队员', '任务']) {
      await openTab(cdp, tabName)
      const tabSlug = ({ 任务: 'tasks', 队员: 'members' })[tabName]
      const selector = ({
        任务: '.task-list-row',
        队员: '.camp-inspector-member-row'
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
      approvalRouting,
      ...panelCounts,
      ...attachments,
      ...relaxedInspection.result?.result?.value
    }
    if (result.horizontalOverflow
        || (expectedTheme && result.theme !== expectedTheme)
        || (theme === 'system' && !['day', 'night'].includes(result.theme))) {
      throw new Error(`Camp workspace acceptance failed: ${JSON.stringify(result)}`)
    }
    cdp.close()
    console.log(JSON.stringify({ ok: true, ...result }, null, 2))
    process.stdout.write(`${outputPrefix}-activity.png\n`)
    process.stdout.write(`${outputPrefix}-tasks.png\n`)
    process.stdout.write(`${outputPrefix}-members.png\n`)
    if (captureAttachmentLightbox) {
      process.stdout.write(`${outputPrefix}-attachment-lightbox.png\n`)
    }
    if (approvalRouting.present) process.stdout.write(`${outputPrefix}-approval-focus.png\n`)
    process.stdout.write(`${outputPrefix}-inspector-hidden.png\n`)
  }

  if (!relaxed) {
    await openTab(cdp, '队员')
    await waitForExpression(cdp, `document.querySelectorAll('.camp-inspector-member-row').length > 0`, 10_000)
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const trigger = document.querySelector('.camp-lead-picker:not(:disabled)')
        trigger?.focus()
        trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
        trigger?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
        trigger?.click()
      })()`,
      returnByValue: true
    })
    await waitForExpression(cdp, `Boolean(document.querySelector('.camp-lead-menu'))`, 5_000)
    await capture(cdp, `${outputPrefix}-members-lead-menu.png`)
    const leadCandidate = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const trigger = document.querySelector('.camp-lead-picker')
        const candidate = [...document.querySelectorAll('.camp-lead-menu-item[role="menuitemradio"]')]
          .find((item) => !item.hasAttribute('data-disabled') && item.getAttribute('data-state') !== 'checked')
        const candidateName = candidate?.getAttribute('aria-label')?.split('，')[0] ?? null
        candidate?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
        candidate?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
        candidate?.click()
        return {
          previousLead: trigger?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
          candidateName
        }
      })()`,
      returnByValue: true
    })
    const leadSelection = leadCandidate.result?.result?.value
    if (!leadSelection?.candidateName) {
      throw new Error(`No eligible alternate Default Lead was available: ${JSON.stringify(leadSelection)}`)
    }
    await waitForExpression(
      cdp,
      `document.querySelector('.camp-lead-picker')?.textContent?.includes(${JSON.stringify(leadSelection.candidateName)})
        && !document.querySelector('.camp-lead-menu')`,
      15_000
    )
    const inspection = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const tabLabels = [...document.querySelectorAll('.activity-tabs > .tabs-list [role="tab"]')]
          .map((tab) => tab.textContent?.replace(/\\d+/g, '').replace(/\\s+/g, ' ').trim() ?? '')
        const rows = [...document.querySelectorAll('.camp-inspector-member-row')]
        const triggerText = document.querySelector('.camp-lead-picker')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
        return {
          tabLabels,
          memberRows: rows.length,
          presentRows: rows.filter((row) => !row.classList.contains('is-away')).length,
          awayRows: rows.filter((row) => row.classList.contains('is-away')).length,
          summaryPresent: Boolean(document.querySelector('.camp-members-summary')),
          leadPickerPresent: Boolean(document.querySelector('.camp-lead-picker')),
          leadChanged: triggerText.includes(${JSON.stringify(leadSelection.candidateName)}),
          legacyContextTab: tabLabels.includes('上下文投递') || tabLabels.includes('上下文'),
          legacyApprovalTab: tabLabels.includes('审批'),
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
          activeTab: [...document.querySelectorAll('.tabs-list [role="tab"]')]
            .some((tab) => tab.textContent?.includes('队员') && tab.getAttribute('data-state') === 'active'),
          viewport: { width: window.innerWidth, height: window.innerHeight }
        }
      })()`,
      returnByValue: true
    })
    const result = { a2aRows, approvalRouting, ...inspection.result?.result?.value }
    if (JSON.stringify(result?.tabLabels) !== JSON.stringify(['队员', '任务'])
        || result?.memberRows < 2
        || !result?.summaryPresent
        || !result?.leadPickerPresent
        || !result?.leadChanged
        || result?.legacyContextTab
        || result?.legacyApprovalTab
        || result?.horizontalOverflow
        || !result?.activeTab) {
      throw new Error(`Camp Inspector acceptance failed: ${JSON.stringify(result)}`)
    }
    await capture(cdp, `${outputPrefix}-members.png`)
    await openTab(cdp, '任务')
    await capture(cdp, `${outputPrefix}-tasks.png`)
    cdp.close()
    console.log(JSON.stringify({ ok: true, ...result }, null, 2))
    process.stdout.write(`${outputPrefix}-activity.png\n${outputPrefix}-tasks.png\n${outputPrefix}-members.png\n${outputPrefix}-members-lead-menu.png\n${outputPrefix}-inspector-hidden.png\n`)
    if (approvalRouting.present) process.stdout.write(`${outputPrefix}-approval-focus.png\n`)
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

async function evaluateValue(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true })
  return result.result?.result?.value
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
