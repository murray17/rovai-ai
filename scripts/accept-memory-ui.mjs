import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { seedCompletedOnboardingForAcceptance } from './lib/dev-desktop.mjs'

const root = resolve(import.meta.dirname, '..')
const appPath = resolve(process.argv[2] ?? join(root, 'dist', 'mac-arm64', 'Rovai-ai.app'))
const dataDir = process.env.ROVAI_MEMORY_ACCEPT_DATA_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-memory-ui-accept-'))
const outputDir = process.env.ROVAI_MEMORY_ACCEPT_OUTPUT_DIR
  ?? await mkdtemp(join(tmpdir(), 'rovai-memory-ui-captures-'))
const firstPort = Number(process.env.ROVAI_MEMORY_ACCEPT_DEBUG_PORT ?? 9441)
const initialBody = '实际验收：重要改动应提供明确验证结果。'
const revisedBody = '实际验收：重要改动应提供明确、可复现的验证结果。'
const forgottenBody = '实际验收临时项：完成后应被永久遗忘。'

seedCompletedOnboardingForAcceptance(dataDir)
await mkdir(outputDir, { recursive: true })

let first = null
let second = null
let dayHeaderGeometry = null
let compactHeaderGeometry = null
try {
  first = await launchApp(firstPort, 1440, 920)
  await setTheme(first.cdp, 'day')
  await assertNoMemoryOnboarding(first.cdp, 'Fresh database')
  await openMemory(first.cdp)
  dayHeaderGeometry = await assertMemoryPageHeaderGeometry(first.cdp, '1440×920 Memory')

  await createHearthMemory(first.cdp, initialBody)
  await chooseMemoryTab(first.cdp, '共同记忆')
  await waitForText(first.cdp, '.memory-catalog-item > strong', initialBody)
  await assertNoHorizontalOverflow(first.cdp, 'day Memory Library')

  await clickMemoryAction(first.cdp, initialBody, '修订')
  await waitForSelector(first.cdp, '.memory-editor-dialog textarea')
  await replaceTextarea(first.cdp, revisedBody)
  await clickButton(first.cdp, '.memory-editor-dialog button', '保存修订')
  await waitForText(first.cdp, '.memory-catalog-item > strong', revisedBody)

  const revisedRecord = await request(first.cdp, 'memory.list')
  const durable = revisedRecord.memories.find((memory) => memory.currentBody === revisedBody)
  assert(durable?.revisions.length === 2, 'UI revision did not preserve two authoritative Revisions')

  await openReviewSchedule(first.cdp, revisedBody)
  await assertReviewScheduleDialogContract(first.cdp, { hasReminder: false })
  const reviewDialogDayCapture = join(outputDir, 'memory-review-schedule-day.png')
  await wait(240)
  await capture(first.cdp, reviewDialogDayCapture)
  await pressKey(first.cdp, 'Escape', 'Escape')
  await waitForExpression(first.cdp, `!document.querySelector('.memory-review-schedule-dialog')`)
  await assertReviewScheduleFocusReturn(first.cdp)

  await openReviewSchedule(first.cdp, revisedBody)
  await selectReviewScheduleMode(first.cdp, 'custom')
  const pastSelection = await browserLocalDateTime(first.cdp, -1)
  await replaceReviewScheduleDateTime(first.cdp, pastSelection.local)
  await waitForExpression(first.cdp, `document.querySelector('#memory-review-schedule-time')
    ?.getAttribute('aria-invalid') === 'true'
    && [...document.querySelectorAll('.memory-review-schedule-dialog button')]
      .some((button) => button.textContent?.trim() === '保存设置' && button.disabled)`)
  assert(await hasText(first.cdp, '.memory-review-schedule-dialog', '请选择晚于当前时间'),
    'Review schedule dialog did not explain why a past local time is invalid')

  const firstCustomSelection = await browserLocalDateTime(first.cdp, 45)
  await replaceReviewScheduleDateTime(first.cdp, firstCustomSelection.local)
  await clickButton(first.cdp, '.memory-review-schedule-dialog button', '保存设置')
  await waitForExpression(first.cdp, `!document.querySelector('.memory-review-schedule-dialog')`)
  await waitForText(first.cdp, '.memory-feedback', '下次复核已设置')
  let scheduledMemory = (await request(first.cdp, 'memory.list')).memories
    .find((memory) => memory.currentBody === revisedBody)
  assert(new Date(scheduledMemory?.reviewAfter ?? '').getTime() === new Date(firstCustomSelection.iso).getTime(),
    'Custom review schedule did not persist through packaged Core')

  await openReviewSchedule(first.cdp, revisedBody)
  await assertReviewScheduleDialogContract(first.cdp, { hasReminder: true })
  await waitForExpression(first.cdp, `document.querySelector('#memory-review-schedule-time')?.value
    === ${JSON.stringify(firstCustomSelection.local)}`)
  assert(await hasText(first.cdp, '.memory-review-schedule-dialog', '无需重复保存'),
    'Unchanged review schedule did not explain its disabled Save state')
  await pressKey(first.cdp, 'Escape', 'Escape')
  await waitForExpression(first.cdp, `!document.querySelector('.memory-review-schedule-dialog')`)

  await openReviewSchedule(first.cdp, revisedBody)
  await clickButton(first.cdp, '.memory-review-schedule-dialog button', '清除提醒')
  await waitForExpression(first.cdp, `!document.querySelector('.memory-review-schedule-dialog')`)
  await waitForText(first.cdp, '.memory-feedback', '复核提醒已清除')
  scheduledMemory = (await request(first.cdp, 'memory.list')).memories
    .find((memory) => memory.currentBody === revisedBody)
  assert(scheduledMemory?.reviewAfter === null,
    'Clear review reminder did not submit reviewAfter: null')

  await openReviewSchedule(first.cdp, revisedBody)
  await selectReviewScheduleMode(first.cdp, 'custom')
  const rebasedSelection = await browserLocalDateTime(first.cdp, 60)
  const competingSelection = await browserLocalDateTime(first.cdp, 75)
  await replaceReviewScheduleDateTime(first.cdp, rebasedSelection.local)
  scheduledMemory = (await request(first.cdp, 'memory.list')).memories
    .find((memory) => memory.currentBody === revisedBody)
  await scheduleMemoryDirect(first.cdp, scheduledMemory, competingSelection.iso)
  await clickButton(first.cdp, '.memory-review-schedule-dialog button', '保存设置')
  await waitForExpression(first.cdp, `document.querySelector('.memory-review-schedule-alert')
    ?.textContent?.includes('版本已变化') === true`)
  assert(await evaluate(first.cdp, `document.querySelector('#memory-review-schedule-time')?.value
      === ${JSON.stringify(rebasedSelection.local)}
    && [...document.querySelectorAll('.memory-review-schedule-dialog button')]
      .some((button) => button.textContent?.trim() === '保存设置' && !button.disabled)`),
  'Version-conflict rebase did not preserve the selected value and enable an explicit retry')
  await wait(450)
  assert(await hasText(first.cdp, '.memory-review-schedule-alert', '版本已变化'),
    'Version-conflict guidance was not durable inside the dialog')
  await clickButton(first.cdp, '.memory-review-schedule-dialog button', '保存设置')
  await waitForExpression(first.cdp, `!document.querySelector('.memory-review-schedule-dialog')`)
  scheduledMemory = (await request(first.cdp, 'memory.list')).memories
    .find((memory) => memory.currentBody === revisedBody)
  assert(new Date(scheduledMemory?.reviewAfter ?? '').getTime() === new Date(rebasedSelection.iso).getTime(),
    'Rebased review schedule was not applied with the refreshed Memory version')

  await openReviewSchedule(first.cdp, revisedBody)
  const alreadyAppliedSelection = await browserLocalDateTime(first.cdp, 90)
  await replaceReviewScheduleDateTime(first.cdp, alreadyAppliedSelection.local)
  scheduledMemory = (await request(first.cdp, 'memory.list')).memories
    .find((memory) => memory.currentBody === revisedBody)
  await scheduleMemoryDirect(first.cdp, scheduledMemory, alreadyAppliedSelection.iso)
  await clickButton(first.cdp, '.memory-review-schedule-dialog button', '保存设置')
  await waitForExpression(first.cdp, `document.querySelector('.memory-review-schedule-alert')
    ?.textContent?.includes('已经是你选择的时间') === true`)
  assert(await evaluate(first.cdp, `[...document.querySelectorAll('.memory-review-schedule-dialog button')]
    .some((button) => button.textContent?.trim() === '保存设置' && button.disabled)`),
  'Already-applied conflict did not disable duplicate command submission')

  await setPageZoom(first.cdp, 200)
  await assertNoHorizontalOverflow(first.cdp, '200% review schedule dialog')
  const reviewDialogZoomCapture = join(outputDir, 'memory-review-schedule-200-percent.png')
  await capture(first.cdp, reviewDialogZoomCapture)
  await pressKey(first.cdp, 'Escape', 'Escape')
  await waitForExpression(first.cdp, `!document.querySelector('.memory-review-schedule-dialog')`)
  await setPageZoom(first.cdp, 100)

  const dayCapture = join(outputDir, 'memory-day.png')
  await capture(first.cdp, dayCapture)

  await openReviewSchedule(first.cdp, revisedBody)
  await selectReviewScheduleMode(first.cdp, '30')
  scheduledMemory = (await request(first.cdp, 'memory.list')).memories
    .find((memory) => memory.currentBody === revisedBody)
  await retireMemoryDirect(first.cdp, scheduledMemory)
  await clickButton(first.cdp, '.memory-review-schedule-dialog button', '保存设置')
  await waitForExpression(first.cdp, `document.querySelector('.memory-review-schedule-alert')
    ?.textContent?.includes('已停止沿用') === true`)
  assert(await evaluate(first.cdp, `[...document.querySelectorAll('.memory-review-schedule-dialog button')]
    .some((button) => button.textContent?.trim() === '保存设置' && button.disabled)`),
  'Retired Memory conflict did not block review schedule submission')
  await clickButton(first.cdp, '.memory-review-schedule-dialog button', '取消')
  await waitForExpression(first.cdp, `!document.querySelector('.memory-review-schedule-dialog')`)
  await chooseMemoryTab(first.cdp, '已停止沿用')
  await waitForText(first.cdp, '.memory-catalog-item > strong', revisedBody)
  await clickMemoryAction(first.cdp, revisedBody, '重新沿用')
  await waitForTextToDisappear(first.cdp, '.memory-catalog-item > strong', revisedBody)
  await chooseMemoryTab(first.cdp, '全部')
  await chooseMemoryTab(first.cdp, '共同记忆')
  await waitForText(first.cdp, '.memory-catalog-item > strong', revisedBody)

  scheduledMemory = (await request(first.cdp, 'memory.list')).memories
    .find((memory) => memory.currentBody === revisedBody)
  const dueSelection = await browserLocalDateTime(first.cdp, -1)
  await scheduleMemoryDirect(first.cdp, scheduledMemory, dueSelection.iso)

  await createHearthMemory(first.cdp, forgottenBody)
  await waitForText(first.cdp, '.memory-catalog-item > strong', forgottenBody)
  await clickMemoryAction(first.cdp, forgottenBody, '永久遗忘')
  await waitForSelector(first.cdp, '.memory-confirm-dialog')
  assert((await hasText(first.cdp, '.memory-confirm-dialog', '不能恢复'))
      || (await hasText(first.cdp, '.memory-confirm-dialog', '不可撤销')),
    'Forget confirmation did not communicate irreversibility')
  await clickButton(first.cdp, '.memory-confirm-dialog button', '永久遗忘')
  await waitForTextToDisappear(first.cdp, '.memory-catalog-item > strong', forgottenBody)
  await chooseMemoryTab(first.cdp, '已停止沿用')
  const forgottenRecord = (await request(first.cdp, 'memory.list')).memories
    .find((memory) => memory.lifecycle === 'forgotten')
  assert(forgottenRecord?.currentBody === null
      && forgottenRecord.revisions.every((revision) => revision.body === null),
  'UI forget left readable Revision text in SQLite reads')

  await closeApp(first)
  first = null
  await wait(750)

  second = await launchApp(firstPort + 1, 1040, 700)
  await assertNoMemoryOnboarding(second.cdp, 'Restarted database')
  await setTheme(second.cdp, 'night')
  await openMemory(second.cdp)
  compactHeaderGeometry = await assertMemoryPageHeaderGeometry(second.cdp, '1040×700 Memory')
  const restartedLibrary = await request(second.cdp, 'memory.list')
  const restartedMemory = restartedLibrary.memories.find((memory) => memory.currentBody === revisedBody)
  assert(restartedMemory?.lifecycle === 'active' && restartedMemory.reviewDue === true,
    'Packaged Core did not return the active Memory after App restart')
  await chooseMemoryTab(second.cdp, '待复核')
  await chooseMemoryTab(second.cdp, '共同记忆')
  await waitForText(second.cdp, '.memory-catalog-item > strong', revisedBody)
  await chooseMemoryTab(second.cdp, '全部')
  await chooseMemoryTab(second.cdp, '共同记忆')
  await waitForText(second.cdp, '.memory-catalog-item > strong', revisedBody)
  await openReviewSchedule(second.cdp, revisedBody)
  await assertReviewScheduleDialogContract(second.cdp, { hasReminder: true })
  const reviewDialogNightCapture = join(outputDir, 'memory-review-schedule-night.png')
  await wait(240)
  await capture(second.cdp, reviewDialogNightCapture)
  await pressKey(second.cdp, 'Escape', 'Escape')
  await waitForExpression(second.cdp, `!document.querySelector('.memory-review-schedule-dialog')`)
  assert(!(await hasText(second.cdp, 'body', forgottenBody)),
    'Forgotten Memory body returned after packaged App restart')
  await assertNoHorizontalOverflow(second.cdp, 'compact night Memory Library')
  const nightCapture = join(outputDir, 'memory-night-compact.png')
  await capture(second.cdp, nightCapture)

  console.log(JSON.stringify({
    ok: true,
    app: basename(appPath),
    dataDir,
    outputDir,
    verified: {
      packagedRendererToCoreIpc: true,
      noStartupMemorySettingsDialog: true,
      firstClassLongTermMemoryNavigation: true,
      freshDatabaseAgentWritesDefaultOn: true,
      restartedDatabaseAgentWritesDefaultOn: true,
      createReviseRevisionHistory: true,
      retireReactivate: true,
      irreversibleForget: true,
      reviewScheduleDialog: true,
      reviewScheduleDefaultAndCustomPersistence: true,
      reviewScheduleClearNull: true,
      reviewScheduleValidationAndUnchangedState: true,
      reviewScheduleConflictRebase: true,
      reviewScheduleAlreadyAppliedConflict: true,
      reviewScheduleRetiredConflict: true,
      reviewScheduleKeyboardFocusAndEscape: true,
      reviewScheduleDueMemoryRemainsActive: true,
      reviewScheduleAtTwoHundredPercentZoom: true,
      sqliteIsTheOnlyMemoryAuthority: true,
      restartPersistence: true,
      dayAndNightLayouts: true,
      sharedWindowDragStripAndClickableHeaderActions: true,
      horizontalOverflow: false
    },
    headerGeometry: {
      day: dayHeaderGeometry,
      compact: compactHeaderGeometry
    },
    captures: {
      day: dayCapture,
      compactNight: nightCapture,
      reviewDialogDay: reviewDialogDayCapture,
      reviewDialogNight: reviewDialogNightCapture,
      reviewDialogZoom200: reviewDialogZoomCapture
    }
  }, null, 2))
} finally {
  if (first) await closeApp(first)
  if (second) await closeApp(second)
}

async function openReviewSchedule(cdp, body) {
  await clickMemoryAction(cdp, body, '设置下次复核')
  await waitForSelector(cdp, '.memory-review-schedule-dialog')
  await waitForExpression(cdp, `document.querySelector('.memory-review-schedule-dialog [role="radio"][aria-checked="true"]')
    === document.activeElement`)
}

async function assertReviewScheduleDialogContract(cdp, { hasReminder }) {
  const state = await evaluate(cdp, `(() => {
    const dialog = document.querySelector('.memory-review-schedule-dialog')
    const selected = dialog?.querySelector('[role="radio"][aria-checked="true"]')
    const clear = [...(dialog?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent?.trim() === '清除提醒')
    const save = [...(dialog?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent?.trim() === '保存设置')
    return {
      text: dialog?.textContent ?? '',
      selectedMode: selected?.getAttribute('data-review-schedule-mode') ?? null,
      selectedFocused: selected === document.activeElement,
      customValue: dialog?.querySelector('#memory-review-schedule-time')?.value ?? null,
      clearVisible: Boolean(clear),
      saveDisabled: save?.disabled ?? null,
      hasKicker: Boolean(dialog?.querySelector('.app-dialog-kicker')),
      hasInvalidCurrentBlock: Boolean(dialog?.querySelector('.memory-review-current'))
    }
  })()`)
  assert(state.text.includes('设置下次复核')
      && state.text.includes('到期后仍会继续沿用')
      && state.text.includes('不会修改记忆正文、沿用状态或适用范围'),
  `Review schedule dialog omitted required scope copy: ${JSON.stringify(state)}`)
  assert(!state.text.includes('当前提醒')
      && !state.text.includes('已设置')
      && !state.text.includes('未设置')
      && !state.text.includes(revisedBody)
      && !state.text.includes('Retrieval Keys')
      && !state.hasKicker
      && !state.hasInvalidCurrentBlock,
  `Review schedule dialog restored removed or out-of-scope content: ${JSON.stringify(state)}`)
  assert(state.selectedFocused,
    `Review schedule dialog did not autofocus its selected option: ${JSON.stringify(state)}`)
  if (hasReminder) {
    assert(state.selectedMode === 'custom' && state.customValue && state.clearVisible,
      `Existing reminder was not represented through the custom field: ${JSON.stringify(state)}`)
  } else {
    assert(state.selectedMode === '90' && !state.clearVisible && state.saveDisabled === false,
      `Unset reminder did not default to 90 days: ${JSON.stringify(state)}`)
  }
}

async function assertReviewScheduleFocusReturn(cdp) {
  try {
    await waitForExpression(cdp, `document.activeElement?.textContent?.trim() === '设置下次复核'`)
  } catch {
    const state = await evaluate(cdp, `({
      activeTag: document.activeElement?.tagName ?? null,
      activeText: document.activeElement?.textContent?.trim() ?? null,
      activeClass: document.activeElement?.className ?? null,
      triggerConnected: [...document.querySelectorAll('.memory-detail-actions button')]
        .some((button) => button.textContent?.trim() === '设置下次复核')
    })`)
    throw new Error(`Review schedule focus did not return to its trigger: ${JSON.stringify(state)}`)
  }
}

async function selectReviewScheduleMode(cdp, mode) {
  const selected = await evaluate(cdp, `(() => {
    const button = document.querySelector(
      ${JSON.stringify(`.memory-review-schedule-dialog [data-review-schedule-mode="${mode}"]`)}
    )
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert(selected, `Could not select review schedule mode ${mode}`)
  await waitForExpression(cdp, `document.querySelector(
    ${JSON.stringify(`.memory-review-schedule-dialog [data-review-schedule-mode="${mode}"]`)}
  )?.getAttribute('aria-checked') === 'true'`)
}

async function replaceReviewScheduleDateTime(cdp, value) {
  const changed = await evaluate(cdp, `(() => {
    const input = document.querySelector('#memory-review-schedule-time')
    if (!input || input.disabled) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  assert(changed, 'Review schedule datetime-local input was unavailable')
  await waitForExpression(cdp, `document.querySelector('#memory-review-schedule-time')?.value
    === ${JSON.stringify(value)}`)
}

async function browserLocalDateTime(cdp, calendarDays) {
  return evaluate(cdp, `(() => {
    const date = new Date()
    date.setDate(date.getDate() + ${Number(calendarDays)})
    date.setSeconds(0, 0)
    const pad = (value) => String(value).padStart(2, '0')
    return {
      local: String(date.getFullYear()).padStart(4, '0')
        + '-' + pad(date.getMonth() + 1)
        + '-' + pad(date.getDate())
        + 'T' + pad(date.getHours())
        + ':' + pad(date.getMinutes()),
      iso: date.toISOString()
    }
  })()`)
}

async function scheduleMemoryDirect(cdp, memory, reviewAfter) {
  assert(memory, 'Could not find the Memory for a direct schedule concurrency step')
  const result = await request(cdp, 'memory.review.schedule', {
    commandId: crypto.randomUUID(),
    command: {
      memoryId: memory.id,
      expectedVersion: memory.version,
      reviewAfter
    }
  })
  assert(result.status === 'applied',
    `Direct review schedule setup failed: ${JSON.stringify(result)}`)
}

async function retireMemoryDirect(cdp, memory) {
  assert(memory, 'Could not find the Memory for a direct retire concurrency step')
  const result = await request(cdp, 'memory.retire', {
    commandId: crypto.randomUUID(),
    command: {
      memoryId: memory.id,
      expectedVersion: memory.version
    }
  })
  assert(result.status === 'applied',
    `Direct Memory retirement setup failed: ${JSON.stringify(result)}`)
}

async function setPageZoom(cdp, percentage) {
  const factor = percentage / 100
  const width = Math.round(1440 / factor)
  const height = Math.round(920 / factor)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: factor,
    mobile: false
  })
  await waitForExpression(cdp, `window.innerWidth === ${width} && window.innerHeight === ${height}`)
}

async function pressKey(cdp, key, code) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code })
}

async function createHearthMemory(cdp, body) {
  await clickButton(cdp, '.memory-library-header button', '新增记忆')
  await waitForSelector(cdp, '.memory-editor-dialog textarea')
  await replaceTextarea(cdp, body)
  await replaceRetrievalKeys(cdp, '验收记忆')
  await clickButton(cdp, '.memory-editor-dialog button', '保存记忆')
  await waitForEditorOutcome(cdp, 'create')
}

async function assertNoMemoryOnboarding(cdp, context) {
  const dialogOpen = await evaluate(cdp,
    `Boolean(document.querySelector('.memory-onboarding-dialog'))`)
  assert(dialogOpen === false,
    `${context} unexpectedly showed a removed Memory permission onboarding dialog`)
}

async function openMemory(cdp) {
  const navigation = await evaluate(cdp, `(() => {
    const memory = [...document.querySelectorAll('.unified-sidebar button')]
      .find((candidate) => candidate.getAttribute('aria-label')?.startsWith('记忆'))
    if (!memory || memory.disabled) return null
    memory.click()
    return { height: memory.getBoundingClientRect().height }
  })()`)
  assert(navigation, 'Could not open long-term Memory from global navigation')
  assert(navigation.height <= 40,
    `Memory navigation label wrapped unexpectedly (${navigation.height}px high)`)
  await waitForSelector(cdp, '.memory-library')
  await waitForExpression(cdp, `!document.querySelector('.memory-library .memory-error')`)
}

async function assertMemoryPageHeaderGeometry(cdp, context) {
  const state = await evaluate(cdp, `(() => {
    const content = document.querySelector('.content.memory-content')
    const library = document.querySelector('.memory-library')
    const header = document.querySelector('.memory-library-header')
    const heading = header?.firstElementChild
    const actions = document.querySelector('.memory-header-actions')
    const contentBounds = content?.getBoundingClientRect()
    const libraryBounds = library?.getBoundingClientRect()
    const headerBounds = header?.getBoundingClientRect()
    const headingBounds = heading?.getBoundingClientRect()
    const actionBounds = actions?.getBoundingClientRect()
    const dragStrip = document.querySelector('.window-drag-strip-memory')
    const dragStripBounds = dragStrip?.getBoundingClientRect()
    const firstAction = actions?.querySelector('button')
    const firstActionBounds = firstAction?.getBoundingClientRect()
    const firstActionHit = firstActionBounds
      ? document.elementFromPoint(
          firstActionBounds.left + firstActionBounds.width / 2,
          firstActionBounds.top + firstActionBounds.height / 2
        )
      : null
    const round = (value) => value == null ? null : Math.round(value * 10) / 10
    return {
      hasWindowDragStrip: Boolean(dragStrip),
      dragStripTop: round(dragStripBounds?.top),
      dragStripLeft: round(dragStripBounds?.left),
      dragStripWidth: round(dragStripBounds?.width),
      dragStripHeight: round(dragStripBounds?.height),
      dragStripRegion: dragStrip
        ? getComputedStyle(dragStrip).getPropertyValue('-webkit-app-region')
        : null,
      contentTop: round(contentBounds?.top),
      contentWidth: round(contentBounds?.width),
      libraryTop: round(libraryBounds?.top),
      headerTop: round(headerBounds?.top),
      headerRegion: header
        ? getComputedStyle(header).getPropertyValue('-webkit-app-region')
        : null,
      topBorderWidth: content ? getComputedStyle(content).borderTopWidth : null,
      headerAlignment: header ? getComputedStyle(header).alignItems : null,
      hasKicker: Boolean(document.querySelector('.memory-page-kicker')),
      firstActionClickable: Boolean(firstAction && firstActionHit
        && (firstActionHit === firstAction || firstAction.contains(firstActionHit))),
      actionBottomDelta: headingBounds && actionBounds
        ? round(actionBounds.bottom - headingBounds.bottom)
        : null
    }
  })()`)
  assert(
    state.hasWindowDragStrip
      && Math.abs(state.dragStripTop) <= 0.5
      && Math.abs(state.dragStripLeft - 270) <= 0.5
      && Math.abs(state.dragStripWidth - state.contentWidth) <= 0.5
      && Math.abs(state.dragStripHeight - 50) <= 0.5
      && state.dragStripRegion === 'drag'
      && Math.abs(state.contentTop) <= 0.5
      && Math.abs(state.libraryTop) <= 0.75
      && Math.abs(state.headerTop - 34) <= 0.75
      && state.headerRegion !== 'drag'
      && state.topBorderWidth === '0px'
      && state.headerAlignment === 'flex-end'
      && !state.hasKicker
      && state.firstActionClickable
      && Math.abs(state.actionBottomDelta) <= 0.75,
    `${context} did not match the full-height rule-free header contract: ${JSON.stringify(state)}`
  )
  return state
}

async function chooseMemoryTab(cdp, label) {
  await clickButton(cdp, '.memory-scope-tabs button, .memory-governance-tabs button', label)
  await waitForExpression(cdp, `[
    ...document.querySelectorAll('.memory-scope-tabs button, .memory-governance-tabs button')
  ].some((button) => (button.textContent?.trim() === ${JSON.stringify(label)}
      || [...button.childNodes].some((node) =>
        node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === ${JSON.stringify(label)}))
    && (button.getAttribute('aria-current') === 'page'
      || button.getAttribute('aria-pressed') === 'true'))`)
}

async function clickMemoryAction(cdp, body, label) {
  const selected = await evaluate(cdp, `(() => {
    const row = [...document.querySelectorAll('.memory-catalog-item')]
      .find((candidate) => candidate.querySelector(':scope > strong')?.textContent
        === ${JSON.stringify(body)})
    if (!row) return false
    row.click()
    return true
  })()`)
  assert(selected, `Could not select Memory "${body}"`)
  await waitForExpression(cdp, `document.querySelector('.memory-detail > header h3')?.textContent
    === ${JSON.stringify(body)}`)
  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.memory-detail-actions button')]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)})
    if (!button) return false
    button.focus()
    button.click()
    return true
  })()`)
  assert(clicked, `Could not click Memory action "${label}" for "${body}"`)
}

async function waitForEditorOutcome(cdp, operation) {
  await waitForExpression(cdp, `!document.querySelector('.memory-editor-dialog')
    || Boolean(document.querySelector('.memory-error'))`, 60_000)
  const state = await evaluate(cdp, `({
    dialogOpen: Boolean(document.querySelector('.memory-editor-dialog')),
    error: document.querySelector('.memory-error')?.textContent ?? null
  })`)
  assert(!state.dialogOpen, `Memory ${operation} failed in the packaged UI: ${state.error ?? 'unknown error'}`)
}

async function replaceTextarea(cdp, value) {
  const changed = await evaluate(cdp, `(() => {
    const textarea = document.querySelector('.memory-editor-dialog textarea')
    if (!textarea) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, ${JSON.stringify(value)})
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  assert(changed, 'Memory editor textarea was unavailable')
  await waitForExpression(cdp, `document.querySelector('.memory-editor-dialog textarea')?.value
    === ${JSON.stringify(value)}`)
}

async function replaceRetrievalKeys(cdp, value) {
  const changed = await evaluate(cdp, `(() => {
    const input = [...document.querySelectorAll('.memory-editor-dialog input')]
      .find((candidate) => candidate.closest('label')?.textContent?.includes('Retrieval Keys'))
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  assert(changed, 'Memory editor Retrieval Keys input was unavailable')
  await waitForExpression(cdp, `[...document.querySelectorAll('.memory-editor-dialog input')]
    .some((input) => input.value === ${JSON.stringify(value)})`)
}

async function clickButton(cdp, selector, label) {
  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)}
        || [...candidate.childNodes].some((node) =>
          node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === ${JSON.stringify(label)}))
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
  assert(clicked, `Could not click enabled button "${label}" within ${selector}`)
}

async function request(cdp, method, params = {}) {
  return evaluate(cdp, `window.rovai.request(${JSON.stringify(method)}, ${JSON.stringify(params)})`, true)
}

async function setTheme(cdp, preference) {
  await evaluate(cdp, `window.rovai.appearance.setPreference(${JSON.stringify(preference)})`, true)
  const expectedTheme = preference === 'night' ? 'night' : 'day'
  await waitForExpression(cdp,
    `document.documentElement.dataset.theme === ${JSON.stringify(expectedTheme)}`)
}

async function hasText(cdp, selector, text) {
  return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.textContent
    ?.includes(${JSON.stringify(text)}) === true`)
}

async function waitForText(cdp, selector, text) {
  try {
    await waitForExpression(cdp, `[...document.querySelectorAll(${JSON.stringify(selector)})]
      .some((node) => node.textContent === ${JSON.stringify(text)})`, 30_000)
  } catch {
    const visible = await evaluate(cdp, `document.querySelector('.memory-library')?.textContent ?? ''`)
    throw new Error(`Memory UI did not show ${JSON.stringify(text)}. Visible content: ${JSON.stringify(visible)}`)
  }
}

async function waitForTextToDisappear(cdp, selector, text) {
  await waitForExpression(cdp, `![...document.querySelectorAll(${JSON.stringify(selector)})]
    .some((node) => node.textContent === ${JSON.stringify(text)})`)
}

async function assertNoHorizontalOverflow(cdp, context) {
  const state = await evaluate(cdp, `({
    documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
    contentOverflow: [...document.querySelectorAll('.content, .memory-library, .memory-workbench, .memory-detail, .memory-review-schedule-dialog, .memory-review-schedule-dialog .app-dialog-body')]
      .some((node) => node.scrollWidth > node.clientWidth + 1)
  })`)
  assert(!state.documentOverflow && !state.contentOverflow,
    `${context} has horizontal overflow: ${JSON.stringify(state)}`)
}

async function launchApp(port, width, height) {
  const executable = join(appPath, 'Contents', 'MacOS', 'Rovai-ai')
  const stderr = []
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`
  ], {
    cwd: root,
    env: { ...process.env, ROVAI_ALLOW_ISOLATED_INSTANCE: '1' },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  let cdp = null
  try {
    const target = await waitForTarget(port, stderr)
    cdp = await connectCdp(target.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Page.bringToFront')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    })
    await waitForExpression(cdp, `Boolean(window.rovai && document.querySelector('.app-shell'))`, 45_000)
    await waitForExpression(cdp, `Boolean(
      document.querySelector('.unified-sidebar button[aria-label="新对话"]:not(:disabled)')
    )`, 45_000)
    const health = await request(cdp, 'health.check')
    const expectedDatabasePath = await realpath(join(dataDir, 'rovai.sqlite'))
    const actualDatabasePath = await realpath(health.database.path)
    assert(actualDatabasePath === expectedDatabasePath,
      `Isolated App opened the wrong database: ${JSON.stringify({ expectedDatabasePath, actualDatabasePath })}`)
    return { cdp, child, port, stderr }
  } catch (error) {
    cdp?.close()
    await terminateChild(child)
    throw error
  }
}

async function closeApp(running) {
  try {
    await Promise.race([
      running.cdp.send('Browser.close'),
      wait(1_000)
    ])
  } catch {
    // The isolated test instance may already have exited.
  }
  running.cdp.close()
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5_000) {
    try {
      await fetch(`http://127.0.0.1:${running.port}/json`)
    } catch {
      await terminateChild(running.child)
      return
    }
    await wait(100)
  }
  await terminateChild(running.child)
  throw new Error(`Isolated packaged App did not close on debug port ${running.port}`)
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    wait(3_000)
  ])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

async function capture(cdp, path) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true
  })
  await writeFile(path, Buffer.from(result.result.data, 'base64'))
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  })
  if (response.result?.exceptionDetails) {
    throw new Error(response.result.exceptionDetails.exception?.description
      ?? response.result.exceptionDetails.text
      ?? `Evaluation failed: ${expression}`)
  }
  return response.result?.result?.value
}

async function waitForSelector(cdp, selector, timeoutMs = 10_000) {
  await waitForExpression(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`, timeoutMs)
}

async function waitForExpression(cdp, expression, timeoutMs = 10_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(cdp, expression)) return
    await wait(100)
  }
  if (await evaluate(cdp, expression)) return
  throw new Error(`Expression did not become true within ${timeoutMs}ms: ${expression}`)
}

async function waitForTarget(port, stderr) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
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
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('CDP connection closed'))
    pending.clear()
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
