import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import {
  assertUserDataIsIsolated,
  seedCompletedOnboardingForAcceptance
} from './lib/dev-desktop.mjs'

const appPath = process.argv[2]
const outputPrefix = process.argv[3] ?? '/tmp/rovai-desktop'
const port = Number(process.env.ROVAI_DEBUG_PORT ?? 9333)
const captureWidth = Number(process.env.ROVAI_CAPTURE_WIDTH ?? 1440)
const captureHeight = Number(process.env.ROVAI_CAPTURE_HEIGHT ?? 920)
const captureScale = Number(process.env.ROVAI_CAPTURE_SCALE ?? 1)
const captureTheme = process.env.ROVAI_CAPTURE_THEME ?? null
const expectedCaptureTheme = captureTheme === 'day' || captureTheme === 'night'
  ? captureTheme
  : null
const reducedMotion = process.env.ROVAI_REDUCED_MOTION === '1'
const targetRuntimeKind = process.env.ROVAI_CAPTURE_RUNTIME_KIND ?? null
const targetRuntimeLabel = targetRuntimeKind && ({
  'codex-cli': 'Codex CLI',
  'opencode-cli': 'OpenCode CLI',
  'copilot-cli': 'GitHub Copilot CLI',
  'claude-code-cli': 'Claude Code CLI',
  'antigravity-app': 'Antigravity App'
})[targetRuntimeKind]
if (!appPath) throw new Error('Usage: node scripts/capture-desktop.mjs <Rovai-ai.app> [output-prefix]')
const userDataDirectory = assertUserDataIsIsolated(process.env.ROVAI_CAPTURE_USER_DATA_DIR)
seedCompletedOnboardingForAcceptance(userDataDirectory)
if (targetRuntimeKind && !targetRuntimeLabel) throw new Error(`Unknown ROVAI_CAPTURE_RUNTIME_KIND: ${targetRuntimeKind}`)
if (captureTheme && !['system', 'day', 'night'].includes(captureTheme)) {
  throw new Error(`Unknown ROVAI_CAPTURE_THEME: ${captureTheme}`)
}
if (!Number.isFinite(captureScale) || captureScale < 1) {
  throw new Error(`Unknown ROVAI_CAPTURE_SCALE: ${captureScale}`)
}

const executable = join(appPath, 'Contents', 'MacOS', 'Rovai-ai')
const launchArguments = [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDirectory}`
]
const app = spawn(executable, launchArguments, {
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
    width: Math.floor(captureWidth / captureScale),
    height: Math.floor(captureHeight / captureScale),
    deviceScaleFactor: captureScale,
    mobile: false
  })
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{
      name: 'prefers-reduced-motion',
      value: reducedMotion ? 'reduce' : 'no-preference'
    }]
  })
  await waitForAppReady(cdp, 45_000)
  if (captureTheme) {
    await cdp.send('Runtime.evaluate', {
      expression: `window.rovai.appearance.setPreference(${JSON.stringify(captureTheme)})`,
      awaitPromise: true,
      returnByValue: true
    })
    await waitForExpression(cdp, expectedCaptureTheme
      ? `document.documentElement.dataset.theme === ${JSON.stringify(expectedCaptureTheme)}`
      : `['day', 'night'].includes(document.documentElement.dataset.theme)`, 5_000)
  }
  await waitForSelector(cdp, '.new-conversation-workspace', 10_000)
  const defaultQuickChat = await cdp.send('Runtime.evaluate', {
    expression: `({
      quickChatWorkspace: Boolean(document.querySelector('.new-conversation-workspace.quick-chat-workspace')),
      composer: Boolean(document.querySelector('.new-conversation-workspace textarea')),
      projectChoice: [...document.querySelectorAll('.new-conversation-workspace button')]
        .some((button) => button.textContent?.includes('选择项目')),
      intakeBoundary: document.querySelector('.new-conversation-workspace')?.textContent?.includes('INTAKE BOUNDARY'),
      brand: document.querySelector('.rail-logo strong')?.textContent?.trim(),
      brandSubtitle: Boolean(document.querySelector('.rail-logo small')),
      coreHealthEntry: Boolean(document.querySelector('.core-health-link')),
      lastProjectGroup: document.querySelector('.navigation-projects > .camp-nav-group:last-child')?.dataset.group,
      theme: document.documentElement.dataset.theme,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
    })`,
    returnByValue: true
  })
  const defaultQuickChatState = defaultQuickChat.result?.result?.value
  if (!defaultQuickChatState?.quickChatWorkspace
      || defaultQuickChatState?.composer
      || defaultQuickChatState?.projectChoice
      || defaultQuickChatState?.intakeBoundary
      || defaultQuickChatState?.brand !== 'Rovai AI'
      || defaultQuickChatState?.brandSubtitle
      || defaultQuickChatState?.coreHealthEntry
      || defaultQuickChatState?.lastProjectGroup !== 'quick-chat'
      || defaultQuickChatState?.horizontalOverflow
      || (expectedCaptureTheme && defaultQuickChatState?.theme !== expectedCaptureTheme)
      || (captureTheme === 'system'
        && !['day', 'night'].includes(defaultQuickChatState?.theme))) {
    throw new Error(`Packaged App did not open simplified Quick Chat by default: ${JSON.stringify(defaultQuickChatState)}`)
  }
  await capture(cdp, `${outputPrefix}-home.png`)
  if (process.env.ROVAI_CAPTURE_ASSERT_EMPTY_ON_START === '1') {
    const navigationState = await cdp.send('Runtime.evaluate', {
      expression: `({
        camps: document.querySelectorAll('.camp-nav-row').length,
        projects: document.querySelectorAll('.navigation-projects .camp-nav-group:not([data-group="quick-chat"])').length,
        quickChatEmpty: document.querySelector('.camp-nav-group[data-group="quick-chat"]')?.textContent?.includes('还没有对话')
      })`,
      returnByValue: true
    })
    const navigation = navigationState.result?.result?.value
    if (navigation?.camps !== 0 || navigation?.projects !== 0 || navigation?.quickChatEmpty !== true) {
      throw new Error(`Packaged App restart restored a deleted Camp or Project group: ${JSON.stringify(navigation)}`)
    }
  }

  let capturedMembers = false
  let capturedMemberDetail = false
  let capturedMemberRuntimeSelection = false
  let capturedRuntimeDiagnostics = false
  let configuredMemberRuntime = false
  let memberRuntimeSaveMs = null
  let capturedQuickChatComposer = false
  let capturedMentions = false
  let capturedCampWorkspace = false
  let capturedEmptyCamp = false
  let capturedEmptyCampApproval = false
  let capturedPermanentDelete = false
  let capturedStoppedRun = false

  const openedMembers = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const button = document.querySelector('.unified-primary-nav button[aria-label="队员"]')
      if (!button) return false
      button.click()
      return true
    })()`,
    returnByValue: true
  })
  if (openedMembers.result?.result?.value) {
    await waitForSelector(cdp, '.members-view', 30_000)
    const initialMemberState = await cdp.send('Runtime.evaluate', {
      expression: `({
        selected: document.querySelectorAll('.member-sidebar-row.selected').length,
        empty: Boolean(document.querySelector('.member-empty')),
        members: document.querySelectorAll('.member-sidebar-select').length
      })`,
      returnByValue: true
    })
    const initial = initialMemberState.result?.result?.value
    if (initial?.selected !== 1 || initial?.empty || initial?.members !== 4) {
      throw new Error(`Members view did not select one contextual member: ${JSON.stringify(initial)}`)
    }
    await capture(cdp, `${outputPrefix}-members.png`)
    capturedMembers = true

    const selectedMember = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const member = document.querySelector('.member-sidebar-select')
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
      if (targetRuntimeLabel) {
        await waitForExpression(cdp, `(() => {
          const targetLabel = ${JSON.stringify(targetRuntimeLabel)}
          const select = document.querySelector('.member-detail form .field-label select')
          return [...(select?.options ?? [])].some((candidate) => candidate.textContent?.includes(targetLabel))
        })()`, 45_000)
        const directRuntimeChoice = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const targetLabel = ${JSON.stringify(targetRuntimeLabel)}
            const select = document.querySelector('.member-detail form .field-label select')
            if (!select) return { selected: false, available: false }
            const option = [...select.options].find((candidate) =>
              candidate.value.startsWith('candidate:') && candidate.textContent?.includes(targetLabel)
            )
            const existing = [...select.options].some((candidate) =>
              !candidate.value.startsWith('candidate:') && candidate.value && candidate.textContent?.includes(targetLabel)
            )
            if (!option) return { selected: false, available: existing }
            select.value = option.value
            select.dispatchEvent(new Event('change', { bubbles: true }))
            return { selected: true, available: true }
          })()`,
          returnByValue: true
        })
        const choice = directRuntimeChoice.result?.result?.value
        if (!choice?.available) throw new Error(`${targetRuntimeLabel} was unavailable from the member Runtime selector`)
        if (choice.selected) {
          await waitForExpression(cdp, `(() => {
            const targetLabel = ${JSON.stringify(targetRuntimeLabel)}
            return document.querySelector('.runtime-installation-summary')?.textContent?.includes(targetLabel)
              && !document.querySelector('.member-page-error')
          })()`, 60_000)
          await capture(cdp, `${outputPrefix}-member-runtime-selected.png`)
          capturedMemberRuntimeSelection = true
        }
      }
    }
  }

  const openedDiagnostics = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const button = document.querySelector('.unified-sidebar-footer button[aria-label="设置"]')
      if (!button) return false
      button.click()
      return true
    })()`,
    returnByValue: true
  })
  if (openedDiagnostics.result?.result?.value) {
    await waitForSelector(cdp, '.settings-workbench', 5_000)
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const button = [...document.querySelectorAll('.settings-sidebar-menu button')]
          .find((candidate) => candidate.textContent?.includes('Agent 运行时'))
        button?.click()
        return Boolean(button)
      })()`,
      returnByValue: true
    })
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
          .find((candidate) => candidate.textContent?.includes('纳入 Rovai-ai'))
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

    const returnedToApp = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const button = document.querySelector('.settings-sidebar-back')
        button?.click()
        return Boolean(button)
      })()`,
      returnByValue: true
    })
    if (!returnedToApp.result?.result?.value) throw new Error('Settings did not expose Return App')
    await waitForSelector(cdp, '.unified-primary-nav', 5_000)
    await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('.unified-sidebar-footer button[aria-label="设置"]')?.click()`,
      returnByValue: true
    })
    await waitForSelector(cdp, '.settings-sidebar-menu', 5_000)
    await waitForExpression(cdp, `document.querySelector('.settings-sidebar-menu button.active')?.textContent?.includes('Agent 运行时') === true`, 5_000)
    await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('.settings-sidebar-back')?.click()`,
      returnByValue: true
    })
    await waitForSelector(cdp, '.unified-primary-nav', 5_000)

    const reopenedMembers = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const button = document.querySelector('.unified-primary-nav button[aria-label="队员"]')
        if (!button) return false
        button.click()
        return true
      })()`,
      returnByValue: true
    })
    if (reopenedMembers.result?.result?.value) {
      await waitForSelector(cdp, '.members-view', 30_000)
      await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector('.member-sidebar-select')?.click()`,
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
        if (targetRuntimeKind === 'antigravity-app') {
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
          if (!modelCatalog.result?.result?.value) throw new Error('Antigravity model strategy selector is unavailable')
          await waitForExpression(cdp, `(() => {
            const labels = [...document.querySelectorAll('.member-detail form .field-label')]
            const model = labels
              .map((label) => label.querySelector('select'))
              .find((select) => [...(select?.options ?? [])].some((option) => option.textContent?.trim() === '选择模型'))
            return model && model.options.length > 1
              && ![...model.options].some((option) => option.value === 'antigravity://runtime-default')
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
          if (!permissionWarning.result?.result?.value) throw new Error('Antigravity dangerous permission selector is unavailable')
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
        } else if (targetRuntimeKind === 'codex-cli') {
          await waitForExpression(cdp, `(() => {
            const labels = [...document.querySelectorAll('.member-detail form .field-label')]
            const sandbox = labels.find((label) => label.textContent?.includes('sandbox_mode'))?.querySelector('select')
            const approval = labels.find((label) => label.textContent?.includes('approval_policy'))?.querySelector('select')
            return sandbox?.value === 'workspace-write' && approval?.value === 'on-request'
          })()`, 5_000)
        }
        const memberRuntimeSaveStartedAt = Date.now()
        const saved = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const button = [...document.querySelectorAll('.member-form-actions button')]
              .find((candidate) => candidate.textContent?.includes('保存运行时'))
            if (!button || button.disabled) return false
            button.click()
            return true
          })()`,
          returnByValue: true
        })
        if (!saved.result?.result?.value) throw new Error('Configured member Runtime could not be saved')
        await waitForSelector(cdp, '.runtime-readiness-badge.readiness-ready', 10_000)
        memberRuntimeSaveMs = Date.now() - memberRuntimeSaveStartedAt
        await capture(cdp, `${outputPrefix}-member-configured.png`)
        configuredMemberRuntime = true
      }
    }
    if (targetRuntimeLabel && !configuredMemberRuntime) {
      throw new Error(`${targetRuntimeLabel} member Runtime configuration did not complete`)
    }
  }

  const openedQuickChatEntry = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const create = document.querySelector('.unified-primary-nav button[aria-label="新对话"]')
      if (!create || create.disabled) return false
      create.click()
      return true
    })()`,
    returnByValue: true
  })
  if (openedQuickChatEntry.result?.result?.value) {
    await waitForSelector(cdp, '.new-camp-dialog', 30_000)
    await waitForExpression(cdp,
      `document.activeElement?.classList.contains('new-camp-picker-trigger') === true`,
      10_000)
    const quickChatEntry = await cdp.send('Runtime.evaluate', {
      expression: `({
        title: document.querySelector('.new-camp-dialog h2')?.textContent,
        createLabel: document.querySelector('.new-camp-dialog .primary-button')?.textContent?.trim(),
        createEnabled: document.querySelector('.new-camp-dialog .primary-button')?.disabled === false,
        focusedProject: document.activeElement?.classList.contains('new-camp-picker-trigger'),
        collaborationRemoved: !document.querySelector('.new-camp-dialog')?.textContent?.includes('协作方式')
          && !document.querySelector('.new-camp-dialog')?.textContent?.includes('暂未开放'),
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
      })`,
      returnByValue: true
    })
    const quickChatEntryState = quickChatEntry.result?.result?.value
    if (quickChatEntryState?.title !== '创建新对话'
        || quickChatEntryState?.createLabel !== '创建'
        || !quickChatEntryState?.createEnabled
        || !quickChatEntryState?.focusedProject
        || !quickChatEntryState?.collaborationRemoved
        || quickChatEntryState?.horizontalOverflow) {
      throw new Error(`New conversation did not open the configured Camp Dialog: ${JSON.stringify(quickChatEntryState)}`)
    }
    await capture(cdp, `${outputPrefix}-new-conversation.png`)
    capturedQuickChatComposer = true
    if (process.env.ROVAI_CAPTURE_MENTIONS === '1') {
      const openedMembers = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const trigger = document.querySelector('.new-camp-picker-trigger.member-trigger')
          trigger?.click()
          return Boolean(trigger)
        })()`,
        returnByValue: true
      })
      if (!openedMembers.result?.result?.value) throw new Error('Camp member picker was unavailable')
      await waitForSelector(cdp, '.new-camp-picker-menu.member-menu', 5_000)
      const memberMenu = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const members = [...document.querySelectorAll('.new-camp-member-option')]
          const checked = members.filter((option) => option.querySelector('input')?.checked)
          return {
            memberCount: members.length,
            selectedCount: checked.length,
            horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
          }
        })()`,
        returnByValue: true
      })
      const memberState = memberMenu.result?.result?.value
      const expectedMentionCount = Number(process.env.ROVAI_CAPTURE_EXPECT_MENTION_COUNT ?? 0)
      if (!memberState?.memberCount
          || memberState.selectedCount !== memberState.memberCount
          || (expectedMentionCount > 0 && memberState.memberCount !== expectedMentionCount)
          || memberState.horizontalOverflow) {
        throw new Error(`Configured Camp member picker is incomplete: ${JSON.stringify(memberState)}`)
      }
      await capture(cdp, `${outputPrefix}-mention-menu.png`)
      await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector('.new-camp-picker-trigger.member-trigger')?.click()`,
        returnByValue: true
      })
      await waitForExpression(cdp, `!document.querySelector('.new-camp-picker-menu.member-menu')`, 5_000)
      await capture(cdp, `${outputPrefix}-mentions.png`)
      capturedMentions = true
    }
    if (process.env.ROVAI_CAPTURE_SEND_CAMP === '1') {
      const createdEmptyCamp = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const button = document.querySelector('.new-camp-dialog .primary-button')
          button?.click()
          return Boolean(button && !button.disabled)
        })()`,
        returnByValue: true
      })
      if (!createdEmptyCamp.result?.result?.value) throw new Error('Configured Camp could not be created')
      await waitForSelector(cdp, '.camp-workspace #camp-message', 30_000)
      await waitForExpression(cdp, `document.activeElement?.id === 'camp-message'`, 10_000)
      const emptyCamp = await cdp.send('Runtime.evaluate', {
        expression: `({
          title: document.querySelector('.topbar h1')?.textContent,
          messages: document.querySelectorAll('.conversation-bubble').length,
          welcomeTitle: document.querySelector('.empty-camp-welcome h2')?.textContent,
          starters: document.querySelectorAll('.starter-prompts button').length,
          context: document.querySelector('.empty-camp-context')?.textContent,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
        })`,
        returnByValue: true
      })
      const empty = emptyCamp.result?.result?.value
      if (empty?.title !== '未命名对话'
          || empty?.messages !== 0
          || empty?.welcomeTitle !== '开始这段协作'
          || empty?.starters !== 3
          || !empty?.context?.includes('快速对话')
          || !empty?.context?.includes('Lead')
          || empty?.horizontalOverflow) {
        throw new Error(`Configured Camp was not empty before first message: ${JSON.stringify(empty)}`)
      }
      const starterFilledDraft = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const starter = document.querySelector('.starter-prompts button')
          starter?.click()
          return Boolean(starter)
        })()`,
        returnByValue: true
      })
      if (!starterFilledDraft.result?.result?.value) throw new Error('Empty Camp starter prompt was unavailable')
      await waitForExpression(cdp, `document.querySelector('#camp-message')?.textContent === '先了解当前项目结构，再告诉我最值得优先处理的三件事。'
        && document.activeElement?.id === 'camp-message'`, 5_000)
      await capture(cdp, `${outputPrefix}-camp-empty.png`)
      capturedEmptyCamp = true
      await mouseClickByText(cdp, '.tabs-list button', '审批')
      await waitForExpression(cdp, `document.querySelector('.tabs-list [role="tab"][data-state="active"]')?.textContent?.includes('审批') === true`, 5_000)
      await waitForExpression(cdp, `document.querySelector('.approvals-panel .empty-inline')?.textContent?.includes('请求会固定显示在输入框正上方') === true`, 5_000)
      await capture(cdp, `${outputPrefix}-camp-empty-approval.png`)
      capturedEmptyCampApproval = true
      await replaceCampComposerText(
        cdp,
        '验证配置式创建 Camp，并回复 APP_INTAKE_OK。不要调用工具。'
      )
      const submitted = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const editor = document.querySelector('#camp-message')
          if (!editor) return false
          const form = editor.closest('form')
          const submit = form?.querySelector('button[type="submit"]')
          if (!submit || submit.disabled) return false
          form.requestSubmit()
          return true
        })()`,
        returnByValue: true
      })
      if (!submitted.result?.result?.value) throw new Error('Camp first message could not be submitted')
      await waitForSelector(cdp, '.camp-timeline .conversation-bubble.user', 30_000)
      const createdCamp = await cdp.send('Runtime.evaluate', {
        expression: `({
          title: document.querySelector('.topbar h1')?.textContent,
          workspace: document.querySelector('.camp-workspace')?.getAttribute('aria-label'),
          firstMessage: document.querySelector('.camp-timeline .conversation-bubble.user p')?.textContent
        })`,
        returnByValue: true
      })
      const created = createdCamp.result?.result?.value
      const acceptedTitle = created?.title === '未命名对话'
        || created?.title?.includes('验证配置式创建 Camp')
      if (!acceptedTitle
          || !created?.firstMessage?.includes('APP_INTAKE_OK')) {
        throw new Error(`Packaged App did not open the newly created Camp: ${JSON.stringify(created)}`)
      }
      await capture(cdp, `${outputPrefix}-camp.png`)
      capturedCampWorkspace = true
      if (process.env.ROVAI_CAPTURE_CAMP_MANAGEMENT === '1') {
        await waitForSelector(cdp, '.camp-nav-row.selected', 5_000)
        await openSelectedCampMenuItem(cdp, '删除')
        await waitForSelector(cdp, '.camp-action-dialog', 5_000)
        const requestedDelete = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const button = [...document.querySelectorAll('.camp-action-dialog button')]
              .find((candidate) => candidate.textContent?.includes('永久删除'))
            button?.click()
            return Boolean(button)
          })()`,
          returnByValue: true
        })
        if (!requestedDelete.result?.result?.value) throw new Error('Camp permanent delete confirmation was unavailable')
        await waitForSelector(cdp, '.delete-blockers', 5_000)
        await capture(cdp, `${outputPrefix}-delete-blocked.png`)
        if (process.env.ROVAI_CAPTURE_DELETE_AFTER_RUN === '1') {
          const stopRequested = await cdp.send('Runtime.evaluate', {
            expression: `(() => {
              const button = [...document.querySelectorAll('.camp-action-dialog button')]
                .find((candidate) => candidate.textContent?.trim() === '停止运行')
              button?.click()
              return Boolean(button)
            })()`,
            returnByValue: true
          })
          if (!stopRequested.result?.result?.value) throw new Error('Blocked delete did not offer an explicit stop action')
        } else {
          await cdp.send('Runtime.evaluate', {
            expression: `([...document.querySelectorAll('.camp-action-dialog button')]
              .find((candidate) => candidate.textContent?.trim() === '取消'))?.click()`,
            returnByValue: true
          })
        }
        await waitForExpression(cdp, `!document.querySelector('.camp-action-dialog')`, 5_000)
        if (process.env.ROVAI_CAPTURE_DELETE_AFTER_RUN === '1') {
          await waitForExpression(cdp, `(() => {
            const row = document.querySelector('.camp-nav-row.selected')
            return Boolean(row) && !row.querySelector('.camp-marker-loading') && !document.querySelector('.runtime-loading-mark')
          })()`, 30_000)
          await capture(cdp, `${outputPrefix}-stopped.png`)
          capturedStoppedRun = true
        }

        const changedLead = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const picker = document.querySelector('.lead-picker')
            if (!picker) return false
            picker.open = true
            const button = [...picker.querySelectorAll('.lead-picker-popup button')]
              .find((candidate) => !candidate.disabled && candidate.textContent?.includes('Agent 运行时不可用'))
            button?.click()
            return Boolean(button)
          })()`,
          returnByValue: true
        })
        if (!changedLead.result?.result?.value) throw new Error('An unready Camp member was not selectable as Default Lead')
        await waitForSelector(cdp, '.lead-readiness-warning', 5_000)
        await capture(cdp, `${outputPrefix}-lead-warning.png`)

        await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const picker = document.querySelector('.lead-picker')
            if (!picker) return false
            picker.open = true
            const button = [...picker.querySelectorAll('.lead-picker-popup button')]
              .find((candidate) => !candidate.disabled && candidate.textContent?.includes('Agent 运行时可用'))
            button?.click()
            return Boolean(button)
          })()`,
          returnByValue: true
        })
        await waitForExpression(cdp, `!document.querySelector('.lead-readiness-warning')`, 5_000)

        await openSelectedCampMenuItem(cdp, '重命名')
        await waitForSelector(cdp, '#rename-camp-title', 5_000)
        await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const input = document.querySelector('#rename-camp-title')
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
            setter?.call(input, '导航与 Camp 管理验收')
            input?.dispatchEvent(new Event('input', { bubbles: true }))
            input?.form?.requestSubmit()
          })()`,
          returnByValue: true
        })
        await waitForExpression(cdp, `document.querySelector('.topbar h1')?.textContent === '导航与 Camp 管理验收'`, 5_000)
        await capture(cdp, `${outputPrefix}-renamed.png`)

        if (process.env.ROVAI_CAPTURE_DELETE_AFTER_RUN === '1') {
          await deleteSelectedCampWhenQuiescent(cdp)
          await waitForSelector(cdp, '.new-conversation-workspace.quick-chat-workspace', 5_000)
          const emptyNavigation = await cdp.send('Runtime.evaluate', {
            expression: `({
              camps: document.querySelectorAll('.camp-nav-row').length,
              projects: document.querySelectorAll('.navigation-projects .camp-nav-group:not([data-group="quick-chat"])').length
            })`,
            returnByValue: true
          })
          const empty = emptyNavigation.result?.result?.value
          if (empty?.camps !== 0 || empty?.projects !== 0) {
            throw new Error(`Deleting the last Camp left navigation state behind: ${JSON.stringify(empty)}`)
          }
          await capture(cdp, `${outputPrefix}-deleted.png`)
          capturedPermanentDelete = true
        }
      }
    }
  }
  cdp.close()
  process.stdout.write(`${outputPrefix}-home.png\n`)
  if (capturedMembers) process.stdout.write(`${outputPrefix}-members.png\n`)
  if (capturedMemberDetail) process.stdout.write(`${outputPrefix}-member-detail.png\n`)
  if (capturedMemberRuntimeSelection) process.stdout.write(`${outputPrefix}-member-runtime-selected.png\n`)
  if (capturedRuntimeDiagnostics) process.stdout.write(`${outputPrefix}-runtime-diagnostics.png\n`)
  if (configuredMemberRuntime) process.stdout.write(`${outputPrefix}-member-configured.png\n`)
  if (memberRuntimeSaveMs !== null) process.stdout.write(`member-runtime-save-ms: ${memberRuntimeSaveMs}\n`)
  if (capturedQuickChatComposer) process.stdout.write(`${outputPrefix}-new-conversation.png\n`)
  if (capturedMentions) process.stdout.write(`${outputPrefix}-mentions.png\n`)
  if (capturedMentions) process.stdout.write(`${outputPrefix}-mention-menu.png\n`)
  if (capturedEmptyCamp) process.stdout.write(`${outputPrefix}-camp-empty.png\n`)
  if (capturedEmptyCampApproval) process.stdout.write(`${outputPrefix}-camp-empty-approval.png\n`)
  if (capturedCampWorkspace) process.stdout.write(`${outputPrefix}-camp.png\n`)
  if (capturedCampWorkspace && process.env.ROVAI_CAPTURE_CAMP_MANAGEMENT === '1') {
    process.stdout.write(`${outputPrefix}-delete-blocked.png\n`)
    process.stdout.write(`${outputPrefix}-lead-warning.png\n`)
    process.stdout.write(`${outputPrefix}-renamed.png\n`)
  }
  if (capturedPermanentDelete) process.stdout.write(`${outputPrefix}-deleted.png\n`)
  if (capturedStoppedRun) process.stdout.write(`${outputPrefix}-stopped.png\n`)
} finally {
  app.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveClose) => app.once('close', resolveClose)),
    wait(2_000)
  ])
  if (app.exitCode === null) app.kill('SIGKILL')
}

async function deleteSelectedCampWhenQuiescent(cdp) {
  await waitForExpression(cdp, `(() => {
    const row = document.querySelector('.camp-nav-row.selected')
    return Boolean(row) && !row.querySelector('.camp-marker-loading') && !document.querySelector('.runtime-loading-mark')
  })()`, 120_000)

  await openSelectedCampMenuItem(cdp, '删除')
  await waitForSelector(cdp, '.camp-action-dialog', 5_000)

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const requested = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const button = [...document.querySelectorAll('.camp-action-dialog .danger-button')]
          .find((candidate) => candidate.textContent?.includes('删除'))
        if (!button || button.disabled) return false
        button.click()
        return true
      })()`,
      returnByValue: true
    })
    if (requested.result?.result?.value) {
      await wait(300)
      const deleted = await cdp.send('Runtime.evaluate', {
        expression: `!document.querySelector('.camp-action-dialog') && !document.querySelector('.camp-nav-row.selected')`,
        returnByValue: true
      })
      if (deleted.result?.result?.value) return
    }
    await wait(500)
  }

  const blockerText = await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('.camp-action-dialog')?.textContent ?? ''`,
    returnByValue: true
  })
  throw new Error(`Camp did not become deletable after its Run completed: ${blockerText.result?.result?.value}`)
}

async function openSelectedCampMenuItem(cdp, label) {
  const opened = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const trigger = document.querySelector('.camp-nav-row.selected .camp-menu-trigger')
      trigger?.click()
      return Boolean(trigger)
    })()`,
    returnByValue: true
  })
  if (!opened.result?.result?.value) throw new Error(`Camp ${label} menu trigger was unavailable`)
  await waitForSelector(cdp, '.sidebar-action-menu', 5_000)
  await mouseClickByText(cdp, '.sidebar-action-menu-item', label)
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

async function mouseClickByText(cdp, selector, text) {
  const point = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((candidate) => candidate.textContent?.includes(${JSON.stringify(text)}))
      if (!element || element.disabled) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })()`,
    returnByValue: true
  })
  const coordinates = point.result?.result?.value
  if (!coordinates) throw new Error(`Could not click ${selector} containing ${text}`)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: coordinates.x,
    y: coordinates.y,
    button: 'left',
    clickCount: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: coordinates.x,
    y: coordinates.y,
    button: 'left',
    clickCount: 1
  })
}

async function waitForAppReady(cdp, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const state = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const button = document.querySelector('.unified-primary-nav button[aria-label="新对话"]')
        return Boolean(button && !button.disabled)
      })()`,
      returnByValue: true
    })
    if (state.result?.result?.value) return
    await wait(150)
  }
  throw new Error(`Rovai-ai did not become ready within ${timeoutMs}ms. ${stderr.join('')}`)
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
