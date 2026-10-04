import assert from 'node:assert/strict'
import { pause } from './host-web-browser.mjs'

// Actual production UI setup. The injected HTTP reader observes durable results;
// it never creates profiles, sets Runtime permissions or creates the Camp.
export async function configureBrowserCamp({ browser, read, workspace, name }) {
  const profiles = await read('members.list')
  const member = profiles.find(profile => profile.presence === 'present')
  assert.ok(member)
  assert.ok(!member.runtimeConfiguration, 'fresh Host must begin without a configured member')
  await browser.wait(`document.querySelector('.sidebar-settings-main')!==null`)
  await browser.click(`document.querySelector('.sidebar-settings-main')`)
  await browser.click(`[...document.querySelectorAll('.settings-sidebar-menu button')].find(e=>e.textContent.trim()==='运行时')`)
  const runtimeRow = `[...document.querySelectorAll('.runtime-product-row')].find(e=>e.querySelector('strong')?.textContent==='Codex CLI')`
  await browser.wait(`Boolean(${runtimeRow}?.querySelector('.runtime-product-check:not(:disabled)'))`)
  // Match the visible check control, not the install/settings affordances.
  const checkButton = `[...(${runtimeRow}).querySelectorAll('button')].find(e=>['检查状态','重新检测'].includes(e.textContent.trim()))`
  await browser.wait(`${checkButton} && !(${checkButton}).disabled`)
  await browser.click(checkButton)
  await browser.wait(`Boolean((${runtimeRow})?.querySelector('.runtime-product-check:not(:disabled)')) && Boolean((${runtimeRow})?.querySelector('.runtime-guide-feedback'))`, 125_000)
  const installation = (await read('runtime.installations.list')).find(item => item.adapterKind === 'codex-cli' && item.memberRuntimeDefaults)
  assert.ok(installation, 'UI Runtime check did not produce usable Codex defaults')
  await browser.click(`document.querySelector('.settings-sidebar-back')`)
  await browser.click(`document.querySelector('.rail-button[aria-label="队员"]')`)
  const memberButton = `[...document.querySelectorAll('.member-sidebar-select')].find(e=>e.getAttribute('aria-label')?.startsWith(${JSON.stringify(member.displayName + '，')}))`
  await browser.wait(`${memberButton}!==undefined`)
  await browser.click(memberButton)
  await browser.click(`document.querySelector('[aria-label="运行配置"]')`)
  await browser.wait(`document.querySelector('.member-runtime-picker-field button')!==null`)
  await browser.click(`document.querySelector('.member-runtime-picker-field button')`)
  await browser.click(`[...document.querySelectorAll('.member-runtime-menu-item')].find(e=>e.textContent.trim()==='Codex CLI')`)
  for (const [label, value] of [['文件系统访问', 'workspace-write'], ['审批策略', 'on-request']]) {
    const trigger = `document.querySelector('.member-runtime-parameters button[aria-label^="${label}，"]')`
    await browser.wait(`${trigger} && !(${trigger}).disabled`)
    await browser.click(trigger)
    const option = `[...document.querySelectorAll('[role=menuitemradio]')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(value)}))`
    await browser.wait(`Boolean(${option})`)
    await browser.click(option)
  }
  await browser.wait(`document.querySelector('[aria-label="保存运行配置"]:not(:disabled)')!==null`)
  await browser.click(`document.querySelector('[aria-label="保存运行配置"]')`)
  let configured
  for (let attempt = 0; attempt < 100; attempt++) {
    configured = (await read('members.list')).find(profile => profile.agentId === member.agentId)
    if (configured.runtimeConfiguration?.adapterKind === 'codex-cli') break
    await pause(100)
  }
  assert.equal(configured.runtimeConfiguration?.adapterKind, 'codex-cli')
  assert.equal(configured.runtimeConfiguration.permissions.values.sandbox_mode, 'workspace-write')
  assert.equal(configured.runtimeConfiguration.permissions.values.approval_policy, 'on-request')
  await browser.wait(`document.querySelector('[aria-label="保存运行配置"]').disabled`)
  await browser.click(`[...document.querySelectorAll('[aria-label="选择工作目录"]')].find(element=>element.getClientRects().length>0 && !element.disabled)`)
  await browser.wait(`document.querySelector('[aria-label="输入完整路径"]:not(:disabled)')!==null`)
  await browser.click(`document.querySelector('[aria-label="输入完整路径"]')`)
  await browser.wait(`document.querySelector('#host-workspace-path:not(:disabled)')!==null && !document.querySelector('.web-workspace-list[aria-busy=true]')`)
  await browser.click(`document.querySelector('#host-workspace-path')`)
  await browser.evaluate(`document.querySelector('#host-workspace-path').select()`)
  await browser.send('Input.insertText', { text: workspace })
  await browser.click(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='前往')`)
  await browser.wait(`document.querySelector('[role=dialog] .primary-button:not(:disabled)')!==null`)
  await browser.click(`document.querySelector('[role=dialog] .primary-button')`)
  await browser.wait(`document.querySelector('.web-workspace-picker')===null`)
  await browser.click(`document.querySelector('.rail-button[aria-label="新对话"]')`)
  await browser.wait(`document.querySelector('[aria-controls="new-camp-optional-panel"]')!==null`)
  await browser.click(`document.querySelector('[aria-controls="new-camp-optional-panel"]')`)
  await browser.click(`document.querySelector('#new-camp-name')`)
  await browser.send('Input.insertText', { text: name })
  await browser.wait(`document.querySelector('.new-camp-dialog .compact-primary:not(:disabled)')!==null`)
  await browser.click(`document.querySelector('.new-camp-dialog .compact-primary')`)
  await browser.wait(`document.querySelector('[contenteditable=true]')!==null`)
  const navigation = await read('navigation.snapshot')
  const candidates = [...navigation.quickChat.recentThreads, ...navigation.projects.flatMap(project => project.recentThreads)]
  const camp = candidates.find(item => item.title === name)
  assert.ok(camp, 'UI-created Camp was absent from the navigation projection')
  assert.equal(camp.projectPath, workspace)
  return { threadId: camp.id, member: configured }
}
