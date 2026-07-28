import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const appPath = process.argv[2]
const outputPrefix = process.argv[3] ?? '/tmp/rovai-desktop'
const port = Number(process.env.ROVAI_DEBUG_PORT ?? 9333)
const captureWidth = Number(process.env.ROVAI_CAPTURE_WIDTH ?? 1440)
const captureHeight = Number(process.env.ROVAI_CAPTURE_HEIGHT ?? 920)
const captureTheme = process.env.ROVAI_CAPTURE_THEME ?? null
const targetRuntimeKind = process.env.ROVAI_CAPTURE_RUNTIME_KIND ?? null
const targetRuntimeLabel = targetRuntimeKind && ({
  'codex-cli': 'Codex CLI',
  'opencode-cli': 'OpenCode CLI',
  'copilot-cli': 'GitHub Copilot CLI',
  'claude-code-cli': 'Claude Code CLI',
  'antigravity-app': 'Antigravity App'
})[targetRuntimeKind]
if (!appPath) throw new Error('Usage: node scripts/capture-desktop.mjs <Rovai-ai.app> [output-prefix]')
if (targetRuntimeKind && !targetRuntimeLabel) throw new Error(`Unknown ROVAI_CAPTURE_RUNTIME_KIND: ${targetRuntimeKind}`)
if (captureTheme && !['system', 'day', 'night'].includes(captureTheme)) {
  throw new Error(`Unknown ROVAI_CAPTURE_THEME: ${captureTheme}`)
}

const executable = join(appPath, 'Contents', 'MacOS', 'Rovai-ai')
const launchArguments = [`--remote-debugging-port=${port}`]
if (process.env.ROVAI_CAPTURE_USER_DATA_DIR) {
  launchArguments.push(`--user-data-dir=${process.env.ROVAI_CAPTURE_USER_DATA_DIR}`)
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
  await waitForAppReady(cdp, 45_000)
  if (captureTheme) {
    await cdp.send('Runtime.evaluate', {
      expression: `window.rovai.appearance.setPreference(${JSON.stringify(captureTheme)})`,
      awaitPromise: true,
      returnByValue: true
    })
    const expectedTheme = captureTheme === 'system' ? null : captureTheme
    if (expectedTheme) {
      await waitForExpression(cdp, `document.documentElement.dataset.theme === ${JSON.stringify(expectedTheme)}`, 5_000)
    }
  }
  await waitForSelector(cdp, '.new-conversation-workspace', 10_000)
  const defaultLobby = await cdp.send('Runtime.evaluate', {
    expression: `({
      lobbyDraft: Boolean(document.querySelector('.new-conversation-workspace.lobby-draft')),
      projectChoice: [...document.querySelectorAll('.new-conversation-workspace button')]
        .some((button) => button.textContent?.includes('选择项目')),
      intakeBoundary: document.querySelector('.new-conversation-workspace')?.textContent?.includes('INTAKE BOUNDARY'),
      theme: document.documentElement.dataset.theme,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
    })`,
    returnByValue: true
  })
  const defaultLobbyState = defaultLobby.result?.result?.value
  if (!defaultLobbyState?.lobbyDraft
      || defaultLobbyState?.projectChoice
      || defaultLobbyState?.intakeBoundary
      || defaultLobbyState?.horizontalOverflow
      || (captureTheme && captureTheme !== 'system' && defaultLobbyState?.theme !== captureTheme)) {
    throw new Error(`Packaged App did not open the simplified Lobby by default: ${JSON.stringify(defaultLobbyState)}`)
  }
  await capture(cdp, `${outputPrefix}-home.png`)
  if (process.env.ROVAI_CAPTURE_ASSERT_EMPTY_ON_START === '1') {
    const navigationState = await cdp.send('Runtime.evaluate', {
      expression: `({
        camps: document.querySelectorAll('.camp-nav-row').length,
        projects: document.querySelectorAll('.navigation-projects .camp-nav-group').length,
        lobbyEmpty: document.querySelector('.camp-nav-group[data-group="lobby"]')?.textContent?.includes('还没有对话')
      })`,
      returnByValue: true
    })
    const navigation = navigationState.result?.result?.value
    if (navigation?.camps !== 0 || navigation?.projects !== 0 || navigation?.lobbyEmpty !== true) {
      throw new Error(`Packaged App restart restored a deleted Camp or Project group: ${JSON.stringify(navigation)}`)
    }
  }

  let capturedMembers = false
  let capturedMemberDetail = false
  let capturedMemberRuntimeSelection = false
  let capturedRuntimeDiagnostics = false
  let configuredMemberRuntime = false
  let memberRuntimeSaveMs = null
  let capturedLobbyComposer = false
  let capturedMentions = false
  let capturedCampWorkspace = false
  let capturedPermanentDelete = false
  let capturedStoppedRun = false

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
      const button = document.querySelector('.sidebar .settings-entry')
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
        } else if (!targetRuntimeKind || targetRuntimeKind === 'codex-cli') {
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
              .find((candidate) => candidate.textContent?.includes('保存 Agent运行时'))
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

  const openedLobbyEntry = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const create = [...document.querySelectorAll('.sidebar-primary-actions button')]
        .find((button) => button.textContent?.includes('新对话'))
      if (!create || create.disabled) return false
      create.click()
      return true
    })()`,
    returnByValue: true
  })
  if (openedLobbyEntry.result?.result?.value) {
    await waitForSelector(cdp, '.new-conversation-workspace #new-camp-message', 30_000)
    const composerEnabled = await cdp.send('Runtime.evaluate', {
      expression: `!document.querySelector('#new-camp-message')?.disabled`,
      returnByValue: true
    })
    if (composerEnabled.result?.result?.value) {
      await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector('#new-camp-message')?.focus()`,
        returnByValue: true
      })
      await waitForExpression(cdp, `document.activeElement?.id === 'new-camp-message'`, 10_000)
    } else if (process.env.ROVAI_CAPTURE_MENTIONS === '1' || process.env.ROVAI_CAPTURE_SEND_CAMP === '1') {
      throw new Error('New conversation requires a ready execution engine for this acceptance path')
    }
    const lobbyEntry = await cdp.send('Runtime.evaluate', {
      expression: `({
        composer: Boolean(document.querySelector('.new-conversation-workspace #new-camp-message')),
        dialog: Boolean(document.querySelector('[role="dialog"]')),
        focused: document.activeElement?.id === 'new-camp-message',
        disabled: Boolean(document.querySelector('#new-camp-message')?.disabled),
        transient: document.querySelector('.new-conversation-workspace')?.textContent?.includes('尚未保存')
      })`,
      returnByValue: true
    })
    const lobbyEntryState = lobbyEntry.result?.result?.value
    if (!lobbyEntryState?.composer
        || lobbyEntryState?.dialog
        || (!lobbyEntryState?.disabled && !lobbyEntryState?.focused)
        || !lobbyEntryState?.transient) {
      throw new Error(`New conversation did not enter a transient Camp composer directly: ${JSON.stringify(lobbyEntryState)}`)
    }
    await capture(cdp, `${outputPrefix}-new-conversation.png`)
    capturedLobbyComposer = true
    if (process.env.ROVAI_CAPTURE_MENTIONS === '1') {
      const typedMention = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const textarea = document.querySelector('#new-camp-message')
          if (!textarea) return false
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          setter?.call(textarea, '@')
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
          textarea.focus()
          textarea.setSelectionRange(1, 1)
          textarea.dispatchEvent(new Event('select', { bubbles: true }))
          return true
        })()`,
        returnByValue: true
      })
      if (!typedMention.result?.result?.value) throw new Error('Mention input was unavailable')
      await waitForSelector(cdp, '.mention-menu', 5_000)
      const mentionMenu = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const buttons = [...document.querySelectorAll('.mention-menu button')]
          const all = buttons.find((button) => button.textContent?.includes('全部就绪成员'))
          const agents = buttons.filter((button) => !button.textContent?.includes('全部就绪成员'))
          return {
            agentCount: agents.length,
            allOption: Boolean(all),
            handles: agents.map((button) => button.querySelector('small')?.textContent),
            readyMarks: agents.filter((button) => Boolean(button.querySelector('i'))).length,
            horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
          }
        })()`,
        returnByValue: true
      })
      const mentionState = mentionMenu.result?.result?.value
      const expectedMentionCount = Number(process.env.ROVAI_CAPTURE_EXPECT_MENTION_COUNT ?? 0)
      if (!mentionState?.agentCount
          || mentionState.readyMarks !== mentionState.agentCount
          || (mentionState.agentCount > 1 && !mentionState.allOption)
          || (expectedMentionCount > 0 && mentionState.agentCount !== expectedMentionCount)
          || mentionState.horizontalOverflow) {
        throw new Error(`Ready-member mention menu is incomplete: ${JSON.stringify(mentionState)}`)
      }
      await capture(cdp, `${outputPrefix}-mention-menu.png`)
      const selectedMentions = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const buttons = [...document.querySelectorAll('.mention-menu button')]
          const target = buttons.find((button) => button.textContent?.includes('全部就绪成员')) ?? buttons[0]
          target?.click()
          return Boolean(target)
        })()`,
        returnByValue: true
      })
      if (!selectedMentions.result?.result?.value) throw new Error('Mention option could not be selected')
      await waitForExpression(cdp, `!document.querySelector('.mention-menu')`, 5_000)
      const mentionSelection = await cdp.send('Runtime.evaluate', {
        expression: `(() => ({
          value: document.querySelector('#new-camp-message')?.value,
          summary: document.querySelector('.mention-target-summary')?.textContent,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
        }))()`,
        returnByValue: true
      })
      const selected = mentionSelection.result?.result?.value
      if (!selected?.value?.includes('@')
          || !selected?.summary?.includes(`唤醒 ${mentionState.agentCount} 位成员`)
          || selected.horizontalOverflow) {
        throw new Error(`Mention selection did not become an explicit target set: ${JSON.stringify(selected)}`)
      }
      await capture(cdp, `${outputPrefix}-mentions.png`)
      capturedMentions = true
    }
    if (process.env.ROVAI_CAPTURE_SEND_CAMP === '1') {
      const submitted = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const textarea = document.querySelector('#new-camp-message')
          if (!textarea) return false
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          setter?.call(textarea, '验证首条消息原子创建 Camp，并回复 APP_INTAKE_OK。不要调用工具。')
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
          return true
        })()`,
        returnByValue: true
      })
      if (!submitted.result?.result?.value) throw new Error('Camp intake could not be submitted from the packaged App')
      await wait(100)
      const requested = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const textarea = document.querySelector('#new-camp-message')
          const submit = textarea?.form?.querySelector('button[type="submit"]')
          if (!textarea?.form || !submit || submit.disabled) return false
          textarea.form.requestSubmit()
          return true
        })()`,
        returnByValue: true
      })
      if (!requested.result?.result?.value) throw new Error('Camp intake submit control did not become ready')
      await waitForSelector(cdp, '.camp-workspace', 30_000)
      const createdCamp = await cdp.send('Runtime.evaluate', {
        expression: `({
          title: document.querySelector('.topbar h1')?.textContent,
          workspace: document.querySelector('.camp-workspace')?.getAttribute('aria-label'),
          firstMessage: document.querySelector('.camp-timeline .conversation-bubble.user p')?.textContent
        })`,
        returnByValue: true
      })
      const created = createdCamp.result?.result?.value
      if (!created?.title?.includes('验证首条消息原子创建 Camp')
          || !created?.firstMessage?.includes('APP_INTAKE_OK')) {
        throw new Error(`Packaged App did not open the newly created Camp: ${JSON.stringify(created)}`)
      }
      await capture(cdp, `${outputPrefix}-camp.png`)
      capturedCampWorkspace = true
      if (process.env.ROVAI_CAPTURE_CAMP_MANAGEMENT === '1') {
        await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const group = document.querySelector('.camp-nav-group[data-group="lobby"] .camp-group-toggle')
            if (group?.getAttribute('aria-expanded') === 'false') group.click()
          })()`,
          returnByValue: true
        })
        await waitForSelector(cdp, '.camp-nav-row.selected', 5_000)
        const openedDelete = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const menu = document.querySelector('.camp-nav-row.selected .camp-row-menu')
            if (!menu) return false
            menu.open = true
            const button = [...menu.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === '删除')
            button?.click()
            return Boolean(button)
          })()`,
          returnByValue: true
        })
        if (!openedDelete.result?.result?.value) throw new Error('Camp delete menu was not keyboard/action reachable')
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
              .find((candidate) => !candidate.disabled && candidate.textContent?.includes('执行引擎未就绪'))
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
              .find((candidate) => !candidate.disabled && candidate.textContent?.includes('执行引擎已就绪'))
            button?.click()
            return Boolean(button)
          })()`,
          returnByValue: true
        })
        await waitForExpression(cdp, `!document.querySelector('.lead-readiness-warning')`, 5_000)

        const openedRename = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const menu = document.querySelector('.camp-nav-row.selected .camp-row-menu')
            if (!menu) return false
            menu.open = true
            const button = [...menu.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === '重命名')
            button?.click()
            return Boolean(button)
          })()`,
          returnByValue: true
        })
        if (!openedRename.result?.result?.value) throw new Error('Camp rename menu was unavailable')
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
          await waitForSelector(cdp, '.new-conversation-workspace.lobby-draft', 5_000)
          const emptyNavigation = await cdp.send('Runtime.evaluate', {
            expression: `({
              camps: document.querySelectorAll('.camp-nav-row').length,
              projects: document.querySelectorAll('.navigation-projects .camp-nav-group').length
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
  if (capturedLobbyComposer) process.stdout.write(`${outputPrefix}-new-conversation.png\n`)
  if (capturedMentions) process.stdout.write(`${outputPrefix}-mentions.png\n`)
  if (capturedMentions) process.stdout.write(`${outputPrefix}-mention-menu.png\n`)
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

  const opened = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const menu = document.querySelector('.camp-nav-row.selected .camp-row-menu')
      if (!menu) return false
      menu.open = true
      const button = [...menu.querySelectorAll('button')]
        .find((candidate) => candidate.textContent?.trim() === '删除')
      button?.click()
      return Boolean(button)
    })()`,
    returnByValue: true
  })
  if (!opened.result?.result?.value) throw new Error('Completed Camp delete menu was unavailable')
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
      expression: `(() => {
        const button = [...document.querySelectorAll('.sidebar-primary-actions button')]
          .find((candidate) => candidate.textContent?.includes('新对话'))
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
