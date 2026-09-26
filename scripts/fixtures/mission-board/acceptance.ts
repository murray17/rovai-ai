export async function runMissionAcceptance(): Promise<{ ok: true; cases: string[] }> {
  const qa = (window as any).missionQA
  const check = (value: unknown, message: string): void => { if (!value) throw new Error(message) }
  const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const until = async (condition: () => unknown, message: string): Promise<void> => {
    for (let i = 0; i < 180; ++i) { await frames(); if (condition()) return }
    throw new Error(`${message}${qa.errors.length ? `\n${qa.errors.join('\n')}` : ''}\n${JSON.stringify({ drawer: !!document.querySelector('.mission-drawer'), full: !!document.querySelector('.mission-full'), focus: document.activeElement?.outerHTML.slice(0, 300), feedback: [...document.querySelectorAll('[role=alert],.toast')].map(node => node.textContent), recentMethods: qa.calls.slice(-12).map((call:any) => call.method) })}`)
  }
  const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find(el => el.getAttribute('aria-label') === label || el.textContent?.trim() === label)!
  const switchMissionView = async (label: '看板' | '列表'): Promise<void> => {
    document.querySelector<HTMLButtonElement>('.mission-view-trigger')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await until(() => document.querySelector('[role=menuitemradio]'), 'View menu opens')
    Array.from(document.querySelectorAll<HTMLElement>('[role=menuitemradio]')).find(node => node.textContent === label)!.click()
    await until(() => label === '看板' ? document.querySelectorAll('.mission-column').length > 0 : document.querySelectorAll('.mission-list-group').length > 0, `${label} view renders`)
  }
  const tab = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(el => el.textContent === label)
  const visiblePreview = () => document.querySelector<HTMLElement>('.file-preview-retained-host:not([hidden])')
  const fill = (element: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const cases: string[] = []
  const missionNavigation = document.querySelector<HTMLButtonElement>('button[title^="使命板"]')!
  check(missionNavigation && missionNavigation.textContent?.trim() === '使命板', 'Mission navigation is visible without a numeric badge')
  const missionReminder = missionNavigation.querySelector<HTMLElement>('.mission-rail-badge-dot')!
  const missionNavigationBounds = missionNavigation.getBoundingClientRect(), missionReminderBounds = missionReminder.getBoundingClientRect()
  check(Math.abs(missionReminderBounds.y + missionReminderBounds.height / 2 - (missionNavigationBounds.y + missionNavigationBounds.height / 2)) <= 1 && missionNavigationBounds.right - missionReminderBounds.right <= 12, 'Needs-you state uses a right-aligned, vertically centered blue reminder dot')
  await until(() => document.querySelector('.mission-board-card'), 'The Mission board must load')
  const card = document.querySelector<HTMLElement>('.mission-board-card')!
  await until(() => card.querySelector('.mission-avatars[data-visible-count="5"]'), 'Mission roster fits its regular card width')
  check(card.querySelector('.mission-card-meta > span')?.textContent === 'M-018', 'Mission card uses the stable display number')
  const cardRoster = card.querySelector<HTMLElement>('.mission-avatars')!
  check(card.querySelectorAll('.mission-avatar-item').length === 5 && card.querySelector('.mission-avatar-overflow')?.textContent === '+3', 'Mission card shows five overlapping members and a hidden-member +N')
  const cardAvatarItems = Array.from(card.querySelectorAll<HTMLElement>('.mission-avatar-item'))
  const firstAvatarBounds = cardAvatarItems[0].getBoundingClientRect(), secondAvatarBounds = cardAvatarItems[1].getBoundingClientRect()
  check(Math.abs(secondAvatarBounds.left - firstAvatarBounds.left - 16) <= 1, 'Mission card keeps 23px avatars with 7px overlap')
  const rosterOverflowBounds = card.querySelector('.mission-avatar-overflow')!.getBoundingClientRect()
  check(Math.abs(rosterOverflowBounds.y + rosterOverflowBounds.height / 2 - (firstAvatarBounds.y + firstAvatarBounds.height / 2)) <= 1, 'Roster +N is vertically centered with 23px avatars')
  check(card.querySelector('.mission-card-project')?.nextElementSibling?.classList.contains('mission-tags'), 'Tags follow the project')
  const cardTags = Array.from(card.querySelectorAll<HTMLElement>('.mission-tag.is-colored'))
  check(cardTags.length === 2 && cardTags.every(tag => tag.style.getPropertyValue('--mission-tag-color').startsWith('var(--mission-label-')), 'Mission cards use the dedicated label palette')
  const unread = card.querySelector<HTMLElement>('.mission-unread-message')!, unreadDot = card.querySelector<HTMLElement>('.mission-unread-dot')!
  const unreadStyle = getComputedStyle(unread), unreadDotBounds = unreadDot.getBoundingClientRect()
  check(unread.textContent === '未读' && unreadDotBounds.width === 8 && unreadDotBounds.height === 8 && unreadStyle.fontSize === '12px' && unreadStyle.fontWeight === '600', 'Unread Mission uses an 8px blue dot and 12px semibold label')
  check(getComputedStyle(card.querySelector('.mission-card-open h3')!).fontWeight === '600', 'Unread Mission title gains the approved emphasis')
  check(getComputedStyle(unread).backgroundColor === 'rgba(0, 0, 0, 0)', 'Unread state remains unboxed')
  check(!card.querySelector('.mission-card-more'), 'Mission cards expose actions only through right click and Shift+F10')
  const running = Array.from(document.querySelectorAll<HTMLElement>('.mission-board-card')).find(node => node.querySelector('.mission-running'))!
  const runningChildren = Array.from(running.querySelector('.mission-running')!.children).filter(node => !node.classList.contains('camp-execution-orbits')).map(node => node.getBoundingClientRect())
  check(running.querySelectorAll('.mission-running-avatars .member-avatar').length === 3, 'Running state shows at most three avatars')
  check(running.querySelector('.mission-running > small')?.textContent === '+1', 'Additional running members collapse into +N')
  check(!running.querySelector('.running-text-highlight'), 'Running label stays stationary without a text sweep')
  check(running.querySelectorAll('.camp-execution-orbits rect[pathLength="100"]').length === 2, 'Running state reuses the execution-console dual orbit')
  const runningOverflowBounds = running.querySelector('.mission-running > small')!.getBoundingClientRect(), runningAvatarBounds = running.querySelector('.mission-running-avatars .member-avatar')!.getBoundingClientRect()
  check(Math.abs(runningOverflowBounds.y + runningOverflowBounds.height / 2 - (runningAvatarBounds.y + runningAvatarBounds.height / 2)) <= 1, 'Running +N is vertically centered with 18px avatars')
  check(new Set(runningChildren.map(bounds => Math.round(bounds.y))).size === 1, '+N and running text share one vertical row')
  const footer = card.querySelector<HTMLElement>('.mission-card-footer')!
  footer.style.width = '124px'
  await until(() => Number(cardRoster.dataset.visibleCount) < 5, 'Narrow Mission footer reduces visible avatars')
  check(Number(cardRoster.dataset.overflowCount) === 8 - Number(cardRoster.dataset.visibleCount) && footer.scrollWidth <= footer.clientWidth + 1, 'Narrow roster recalculates +N without squeezing unread or time')
  footer.style.width = ''
  await until(() => cardRoster.dataset.visibleCount === '5', 'Mission roster restores five avatars after width recovers')
  const lanes = [...document.querySelectorAll<HTMLElement>('.mission-column')]
  check(lanes.length === 4 && new Set(lanes.map(n => n.clientHeight)).size === 1, 'Four equal lanes')
  check(!document.querySelector('.mission-column header button'), 'No create control in status lanes')
  check(document.querySelector('.mission-page-header h1')?.textContent === '使命板', 'Board page title')
  const boardPage = document.querySelector<HTMLElement>('.mission-board-page')!
  const boardScroll = document.querySelector<HTMLElement>('.mission-board-scroll')!
  const boardPageStyle = getComputedStyle(boardPage)
  const availableBoardWidth = boardPage.clientWidth - parseFloat(boardPageStyle.paddingLeft) - parseFloat(boardPageStyle.paddingRight)
  check(parseFloat(boardPageStyle.paddingTop) >= 30, 'Board title keeps overview-page top spacing')
  check(getComputedStyle(boardScroll).maxWidth === 'none' && Math.abs(boardScroll.getBoundingClientRect().width - availableBoardWidth) <= 1, 'Board uses the full available page width')
  check(lanes.every(lane => parseFloat(getComputedStyle(lane.querySelector('header')!).borderBottomWidth) === 0), 'Lane headings flow into cards without horizontal dividers')
  document.documentElement.style.zoom = '2'; await frames()
  check(card.clientWidth >= 170 && card.scrollWidth <= card.clientWidth + 1, 'Zoom keeps readable cards without overlapping content')
  check(boardScroll.scrollWidth > boardScroll.clientWidth, 'Narrow board scrolls across lanes')
  document.documentElement.style.zoom = ''; await frames()
  const dragged = Array.from(document.querySelectorAll<HTMLElement>('.mission-board-card')).find(node => node.textContent?.includes('M-016'))!
  const progressLane = Array.from(document.querySelectorAll<HTMLElement>('.mission-column')).find(node => node.querySelector('h2')?.textContent === '进行中')!
  const transfer = new DataTransfer()
  dragged.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  await frames()
  progressLane.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  progressLane.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  await until(() => qa.items[2].status === 'in_progress' && progressLane.textContent?.includes('更新首次使用引导文案'), 'Dragging a Mission updates its status')
  check(qa.calls.some((call:any) => call.method === 'missions.status' && call.p.command?.missionId === qa.items[2].missionId), 'Drag uses the authoritative status command')
  cases.push('board has equal lanes, stable metadata, running and unread states, and status drag-and-drop')

  qa.seedScrollableLanes()
  await until(() => {
    const columns = Array.from(document.querySelectorAll<HTMLElement>('.mission-column-cards'))
    return columns.length === 4 && columns.every(column => column.scrollHeight > column.clientHeight + 40)
  }, 'Each status lane receives enough content to own vertical scrolling')
  const laneScroll = (status: string) => document.querySelector<HTMLElement>(`.mission-column-cards[data-status="${status}"]`)
    ?? Array.from(document.querySelectorAll<HTMLElement>('.mission-column')).find(column => column.querySelector('h2')?.id === `mission-lane-${status}`)!.querySelector<HTMLElement>('.mission-column-cards')!
  const needsLaneScroll = laneScroll('needs_you'), idleLaneScroll = laneScroll('not_started'), progressLaneScroll = laneScroll('in_progress'), completedLaneScroll = laneScroll('completed')
  const laneHeaderTops = Array.from(document.querySelectorAll<HTMLElement>('.mission-column > header')).map(header => header.getBoundingClientRect().top)
  needsLaneScroll.scrollTop = 88; idleLaneScroll.scrollTop = 126; completedLaneScroll.scrollTop = 164
  await frames()
  check(getComputedStyle(needsLaneScroll).overflowY === 'auto' && getComputedStyle(needsLaneScroll).overscrollBehaviorY === 'contain' && getComputedStyle(boardScroll).overflowY === 'hidden', 'Wheel ownership is contained by each lane instead of the board page')
  check(Array.from(document.querySelectorAll<HTMLElement>('.mission-column > header')).every((header,index) => Math.abs(header.getBoundingClientRect().top - laneHeaderTops[index]) <= 1), 'Lane names and counts stay fixed while cards scroll')
  const unaffectedBeforeDrag = { needsYou: needsLaneScroll.scrollTop, completed: completedLaneScroll.scrollTop }
  progressLaneScroll.scrollTop = 0
  const autoScrollSource = document.querySelector<HTMLElement>('[data-mission-id="scroll-not_started-0"]')!
  const autoScrollTransfer = new DataTransfer(), progressBounds = progressLaneScroll.getBoundingClientRect()
  autoScrollSource.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: autoScrollTransfer }))
  await frames()
  progressLaneScroll.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: progressBounds.left + progressBounds.width / 2, clientY: progressBounds.bottom - 2, dataTransfer: autoScrollTransfer }))
  await until(() => progressLaneScroll.scrollTop > 8, 'Dragging at a target lane edge automatically scrolls only that lane')
  progressLaneScroll.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: progressBounds.left + progressBounds.width / 2, clientY: progressBounds.bottom - 2, dataTransfer: autoScrollTransfer }))
  await until(() => qa.items.find((item:any) => item.missionId === 'scroll-not_started-0')?.status === 'in_progress', 'Edge-scrolled drag still commits the cross-lane status move')
  check(Math.abs(needsLaneScroll.scrollTop - unaffectedBeforeDrag.needsYou) <= 1 && Math.abs(completedLaneScroll.scrollTop - unaffectedBeforeDrag.completed) <= 1, 'Cross-lane status updates do not reset untouched lanes')
  const refreshReads = qa.calls.filter((call:any) => call.method === 'missions.list').length
  qa.invalidateMissionDetails()
  await until(() => qa.calls.filter((call:any) => call.method === 'missions.list').length > refreshReads, 'An asynchronous Mission refresh reaches the board')
  check(Math.abs(needsLaneScroll.scrollTop - unaffectedBeforeDrag.needsYou) <= 1 && Math.abs(completedLaneScroll.scrollTop - unaffectedBeforeDrag.completed) <= 1, 'Asynchronous results preserve independent lane positions')
  const positionsBeforeViewChange = new Map(Array.from(document.querySelectorAll<HTMLElement>('.mission-column-cards')).map(column => [column.getAttribute('aria-labelledby')!, column.scrollTop]))
  await switchMissionView('列表')
  await switchMissionView('看板')
  const positionsAfterViewChange = new Map(Array.from(document.querySelectorAll<HTMLElement>('.mission-column-cards')).map(column => [column.getAttribute('aria-labelledby')!, column.scrollTop]))
  check([...positionsBeforeViewChange].every(([status,position]) => Math.abs((positionsAfterViewChange.get(status) ?? -1) - position) <= 1), 'Switching to list and back restores every independent lane position')
  let lanePositionsBeforeDetails = positionsAfterViewChange

  button('状态筛选').click()
  await until(() => document.querySelector('.mission-unified-filter'), 'Status filter opens')
  check(!document.querySelector('.mission-filter-search'), 'Status filter has no search')
  check(!document.querySelector('.mission-unified-filter')?.textContent?.includes('全部'), 'No redundant all option')
  document.querySelector<HTMLButtonElement>('.mission-filter-options [role=checkbox]')!.click()
  await until(() => document.querySelector('.mission-filter-options [aria-checked=true]'), 'Status selection commits')
  await until(() => document.querySelectorAll('.mission-column-cards').length === 1, 'Status selection narrows the visible lanes')
  check(Math.abs(document.querySelector<HTMLElement>('.mission-column-cards')!.scrollTop) <= 1, 'Changing filters starts the new lane result at the top')
  check(getComputedStyle(document.querySelector('.mission-filter-options [aria-checked=true] .mission-filter-check')!).backgroundColor !== 'rgba(0, 0, 0, 0)', 'Selected checkbox is filled')
  document.querySelector<HTMLButtonElement>('.mission-filter-group button')!.click()
  button('清除筛选').click()
  await until(() => document.querySelectorAll('.mission-column-cards').length === 4, 'Clearing status filters restores every lane')
  check(Array.from(document.querySelectorAll<HTMLElement>('.mission-column-cards')).every(column => Math.abs(column.scrollTop) <= 1), 'Cleared filters keep each restored lane at the top')
  button('项目筛选').click()
  await until(() => document.querySelector('input[aria-label="搜索项目"]'), 'Project filter has search')
  button('项目筛选').click()
  cases.push('filters share multi-select checkboxes; only project and tags have search')

  card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: card.getBoundingClientRect().left + 20, clientY: card.getBoundingClientRect().top + 20 }))
  const editAction = () => Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(item => item.textContent?.trim() === '编辑')
  await until(editAction, 'Mission actions expose edit first')
  editAction()!.click()
  await until(() => document.querySelector('.mission-edit-dialog'), 'Edit dialog opens')
  const editDialog = document.querySelector<HTMLElement>('.mission-edit-dialog')!
  const editLabel = document.querySelector<HTMLElement>('label[for="mission-editor-title"]')!
  check(editLabel.textContent === '使命名称' && editLabel.getBoundingClientRect().width <= 1, 'Edit labels remain accessible without repeating the creation hierarchy')
  check(document.querySelector('.mission-edit-dialog .mission-editor-title') && document.querySelector('.mission-edit-dialog .mission-editor-description'), 'Edit uses the wide borderless writing plane')
  check(Math.abs(editDialog.getBoundingClientRect().width - 820) <= 1, 'Edit dialog matches the approved 820px writing width')
  const editTitle = document.querySelector<HTMLInputElement>('.mission-edit-dialog .mission-editor-title')!
  const editDescription = document.querySelector<HTMLTextAreaElement>('.mission-edit-dialog .mission-editor-description')!
  check(document.activeElement !== editTitle && document.activeElement !== editDescription, 'Edit opens without focusing a writing field')
  check(parseFloat(getComputedStyle(editTitle).borderTopWidth) === 0 && parseFloat(getComputedStyle(editDescription).borderTopWidth) === 0, 'Title and description have no field frame')
  editTitle.focus(); await frames()
  check(getComputedStyle(editTitle).outlineStyle === 'none' && getComputedStyle(editTitle).boxShadow === 'none', 'Focused title stays visually borderless')
  editTitle.blur()
  const properties = Array.from(document.querySelectorAll<HTMLButtonElement>('.mission-edit-dialog .mission-editor-property'))
  check(properties.length === 3 && properties[0].disabled && properties[1].disabled && !properties[2].disabled, 'Edit locks project and team while keeping tags editable')
  check(properties.every(property => !property.querySelector('.dialog-glyph')), 'Mission property controls do not show dropdown arrows')
  const propertyWidths = properties.map(property => property.getBoundingClientRect().width)
  check(propertyWidths[0] <= 157 && propertyWidths[1] <= 225 && propertyWidths[2] <= 133, 'Project, team and tag controls keep their compact width caps')
  check(properties[1].querySelector('.mission-editor-team-overflow')?.textContent === `+${qa.items[0].memberAgentIds.length - 2}`, 'Team summary collapses additional members into +N')
  const editTagTokens = Array.from(properties[2].querySelectorAll<HTMLElement>('.mission-editor-selected-tag'))
  check(editTagTokens.length === 2 && new Set(editTagTokens.map(token => getComputedStyle(token).backgroundColor)).size === 2, 'Each selected tag keeps its own visible background color')
  check(editTagTokens.every(token => token.style.getPropertyValue('--mission-tag-color').startsWith('var(--mission-label-')), 'Edit uses the dedicated Mission label palette')
  properties[2].click()
  await until(() => document.querySelector('.mission-editor-tag-popover'), 'Edit tag picker opens')
  const selectedTagOptions = Array.from(document.querySelectorAll<HTMLElement>('.mission-editor-tag-option[aria-checked=true]'))
  check(selectedTagOptions.length === 2
    && selectedTagOptions.every(option => getComputedStyle(option).backgroundColor !== 'rgba(0, 0, 0, 0)' && option.querySelector('.mission-icon'))
    && new Set(selectedTagOptions.map(option => getComputedStyle(option).backgroundColor)).size === 2, 'Selected tag rows retain individual backgrounds plus checkmarks')
  properties[2].click()
  await until(() => !document.querySelector('.mission-editor-tag-popover'), 'Edit tag picker closes')
  check(!button('添加附件').disabled, 'Edit keeps attachments editable')
  const editAttachmentStrip = document.querySelector<HTMLElement>('.mission-edit-dialog .composer-attachment-strip')!
  check(editAttachmentStrip.scrollWidth > editAttachmentStrip.clientWidth, 'Many Mission attachments stay in one bounded strip')
  check(getComputedStyle(editAttachmentStrip).scrollbarWidth === 'none', 'Mission attachment strip hides its visual scrollbar')
  check(editAttachmentStrip.querySelector('.file-extension-label')?.textContent === 'DIR', 'Mission editor recognizes a directory as DIR')
  editAttachmentStrip.focus()
  editAttachmentStrip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await frames()
  check(editAttachmentStrip.scrollLeft > 0, 'Mission editor attachment strip supports keyboard browsing')
  check(button('保存').disabled, 'Unchanged Mission cannot be saved')
  const editing = qa.items[0]
  editing.title = '另一处刚更新的标题'; editing.detailsVersion += 1
  fill(document.querySelector<HTMLInputElement>('.mission-edit-dialog input')!, '第一次编辑')
  button('保存').click()
  await until(() => document.querySelector('.mission-edit-dialog [role=alert]')?.textContent?.includes('最新内容'), 'Conflict loads latest details')
  check((document.querySelector('.mission-edit-dialog input') as HTMLInputElement).value === '另一处刚更新的标题', 'Conflict replaces stale fields')
  fill(document.querySelector<HTMLInputElement>('.mission-edit-dialog input')!, '基于最新内容编辑')
  const attachmentInput = document.querySelector<HTMLInputElement>('.mission-edit-dialog input[type=file]')!
  check(attachmentInput, 'Edit attachment input remains mounted before file selection')
  const attachmentTransfer = new DataTransfer()
  attachmentTransfer.items.add(new File(['review'], 'review-notes.md', { type: 'text/markdown' }))
  Object.defineProperty(attachmentInput, 'files', { configurable: true, value: attachmentTransfer.files })
  attachmentInput.dispatchEvent(new Event('change', { bubbles: true }))
  await until(() => document.querySelector('.mission-edit-dialog [title="review-notes.md"]'), 'Edit accepts a new attachment')
  button('保存').click()
  await until(() => !document.querySelector('.mission-edit-dialog'), 'Fresh edit saves')
  check(editing.title === '基于最新内容编辑' && editing.detailsVersion === 3 && editing.attachments.some((attachment:any) => attachment.displayName === 'review-notes.md'), 'Edit advances internal details version once and persists attachments')
  card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: card.getBoundingClientRect().left + 20, clientY: card.getBoundingClientRect().top + 20 }))
  await until(() => Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).some(item => item.textContent?.trim() === '删除'), 'Context menu can reopen for deletion')
  Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(item => item.textContent?.trim() === '删除')!.click()
  await until(() => document.querySelector('.mission-delete-dialog') && !button('删除使命').disabled, 'Delete dialog resolves the cleanup authority')
  const deleteText = document.querySelector('.mission-delete-dialog')!.textContent ?? ''
  check(deleteText.includes('此操作无法撤销') && !deleteText.includes(editing.title) && !deleteText.includes('/workspace/') && !deleteText.includes('rovai/mission/'), 'Delete dialog is concise and hides redundant Mission/worktree details')
  const deleteWorkspace = document.querySelector<HTMLInputElement>('.mission-delete-workspace-option input')!
  const deleteHelp = document.querySelector<HTMLElement>('.mission-delete-workspace-option .mission-inline-help')!
  check(deleteWorkspace && !deleteWorkspace.checked && !deleteWorkspace.disabled, 'Delete keeps workspace cleanup unchecked by default')
  check(deleteHelp.getAttribute('aria-label') === '未勾选时，Worktree 和本地分支保留在原位置。', 'Delete explains the unchecked retention choice through its help control')
  button('取消').click()
  await until(() => !document.querySelector('.mission-delete-dialog'), 'Delete dialog cancels')
  cases.push('edit is shared by card actions and reloads latest details after an optimistic conflict')

  const previewFits = () => {
    const anchor = document.querySelector('.mission-workspace-host .file-preview-anchor')?.getBoundingClientRect()
    const pane = visiblePreview()?.getBoundingClientRect()
    return anchor && pane && Math.abs(anchor.x - pane.x) < 2 && Math.abs(anchor.right - pane.right) < 2
  }
  lanePositionsBeforeDetails = new Map(Array.from(document.querySelectorAll<HTMLElement>('.mission-column-cards')).map((column,index) => {
    column.scrollTop = Math.min(column.scrollHeight - column.clientHeight, 72 + index * 29)
    return [column.getAttribute('aria-labelledby')!, column.scrollTop]
  }))
  document.querySelector<HTMLElement>('.mission-board-card')!.click()
  await until(() => document.querySelector('.mission-drawer #camp-message[contenteditable="true"]') && tab('活动'), 'Card opens the real Camp Composer and activity')
  await until(previewFits, 'Preview stays aligned after drawer entrance')
  await frames()
  check(qa.calls.filter((call:any) => call.method === 'missions.changes' || call.method === 'missions.fileDiff').length === 0, 'Opening Activity does not read Git changes')
  const editor = document.getElementById('camp-message')!
  check(document.querySelector('.mission-session-header .context-breadcrumb')?.hasAttribute('hidden'), 'Drawer hides title')
  check(!document.querySelector('.mission-intro button:not(.mission-description-toggle):not(.attachment-open)'), 'Mission intro exposes no edit or mutation action')
  const introAttachmentStrip = document.querySelector<HTMLElement>('.mission-intro .composer-attachment-strip')!
  check(introAttachmentStrip && introAttachmentStrip.querySelector('.file-extension-label')?.textContent === 'DIR', 'Mission intro displays the current source attachments with directory typing')
  check(getComputedStyle(introAttachmentStrip).scrollbarWidth === 'none', 'Mission intro reuses the hidden-scrollbar attachment strip')
  introAttachmentStrip.focus()
  introAttachmentStrip.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  await frames()
  check(introAttachmentStrip.scrollLeft > 0, 'Mission intro attachments support Home/End and arrow-key browsing')
  check(!document.querySelector('.camp-execution-drawer'), 'Opening running Mission does not open execution')
  const drawerHeader = document.querySelector('.mission-session-header')!.getBoundingClientRect()
  const preview = visiblePreview()!.getBoundingClientRect()
  const previewWorkspace = document.querySelector<HTMLElement>('.mission-drawer .workspace-grid')!.getBoundingClientRect()
  const previewToggle = button('收起文件预览').getBoundingClientRect()
  const detailEntries = [...document.querySelectorAll<HTMLElement>('.mission-session-header .camp-detail-entry')]
  check(preview.width >= 420 && Math.abs(preview.width / previewWorkspace.width - .56) <= .01, `Activity uses the shared preview ratio and 420px stable minimum (received ${preview.width}px of ${previewWorkspace.width}px)`)
  check(detailEntries.length === 4 && detailEntries.every(entry => entry.getBoundingClientRect().right <= preview.left + 1), 'Four Camp tools stay in the message area')
  check(drawerHeader.right - previewToggle.right <= 10, 'Preview toggle stays at the far right')
  check(!document.querySelector('.mission-session-actions'), 'Mission conversation has no ellipsis action')
  check(parseFloat(getComputedStyle(document.querySelector('.mission-drawer')!).borderRadius) >= 12, 'Mission drawer uses the approved rounded floating surface')
  editor.focus(); document.execCommand('insertText', false, '使命会话草稿')
  await frames()
  button('展开为完整会话').click()
  await until(() => document.querySelector('.mission-full'), 'Full conversation opens')
  check(document.getElementById('camp-message') === editor && editor.textContent?.includes('使命会话草稿'), 'Same Composer instance and draft after expanding')
  check(document.querySelector('.mission-session-header .context-project')?.textContent === 'rovai-ai', 'Full header shows project')
  check(button('折叠为使命抽屉').querySelector('path')?.getAttribute('d') === 'M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5', 'Full header uses the approved conversation-collapse glyph')
  button('折叠为使命抽屉').click()
  await until(() => document.querySelector('.mission-drawer'), 'Fold restores drawer')
  check(document.getElementById('camp-message') === editor, 'Folding retains the editor')
  cases.push('drawer/full headers and four Camp entries share one Composer without execution auto-open')

  button('活动').click()
  await until(() => !tab('活动') && !visiblePreview(), 'Second Activity click closes last tab and preview')
  button('活动').click()
  await until(() => document.querySelector('.mission-delivery-file') && visiblePreview(), 'Activity reopens')
  check(!visiblePreview()!.textContent?.includes('Pull Requests') && !button('关联 Pull Request'), 'Activity omits the unavailable Pull Requests module')
  check(document.querySelector<HTMLButtonElement>('.mission-changes-disclosure')?.getAttribute('aria-expanded') === 'false' && visiblePreview()!.textContent?.includes('点击读取当前工作区变更'), 'Cumulative changes reopen collapsed with an unread hint')
  check([...document.querySelectorAll('.mission-delivery-section .mission-evidence-row code')].some(node => node.textContent === 'rovai/mission/018'), 'Delivery shows the persisted managed Mission branch before a read')
  qa.terminalMissionRun(qa.items[0].campId)
  window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
  await new Promise(resolve => setTimeout(resolve, 180))
  check(qa.calls.filter((call:any) => call.method === 'missions.changes' || call.method === 'missions.fileDiff').length === 0, 'Run completion, focus and visibility do not read unopened changes')
  document.querySelector<HTMLButtonElement>('.mission-changes-disclosure')!.click()
  await until(() => document.querySelectorAll('#mission-detail-tree [data-file-id]').length === 7, 'Cumulative changes render the entire expanded file tree')
  check(qa.calls.filter((call:any) => call.method === 'missions.changes').length === 1 && qa.calls.every((call:any) => call.method !== 'missions.fileDiff'), 'First explicit expansion reads one changed-file view and no file Diff')
  check([...document.querySelectorAll('.mission-delivery-section .mission-evidence-row code')].some(node => node.textContent === 'rovai/mission/018-validation'), 'Activity labels the Worktree checkout observed by the read')
  document.querySelector<HTMLButtonElement>('.mission-changes-disclosure')!.click(); await frames()
  document.querySelector<HTMLButtonElement>('.mission-changes-disclosure')!.click(); await frames()
  check(qa.calls.filter((call:any) => call.method === 'missions.changes').length === 1, 'Collapsing and reopening a mounted result does not rescan Git')
  check(!document.querySelector('.mission-changed-file') && !document.querySelector('.mission-changes-more-files'), 'Cumulative changes no longer use a truncated flat list')
  check(document.querySelector('#mission-detail-tree [title="src/runtime"]')?.textContent?.includes('runtime'), 'Nested paths are grouped into directories')
  check(parseFloat(getComputedStyle(document.querySelector('#mission-detail-tree')!).maxHeight) === 480, 'Detail tree uses the approved 480px scroll ceiling')
  check(!document.querySelector('#mission-detail-tree')?.textContent?.includes('修改'), 'Tree rows use compact status glyphs without status words')
  const detailSearch = document.querySelector<HTMLInputElement>('.mission-delivery-section .changes-tree-search input')!
  fill(detailSearch, 'cache')
  await until(() => document.querySelectorAll('#mission-detail-tree [data-file-id]').length === 1, 'Detail file search filters paths')
  document.querySelector<HTMLButtonElement>('.mission-delivery-section .changes-search-clear')!.click()
  await until(() => document.querySelectorAll('#mission-detail-tree [data-file-id]').length === 7, 'Clearing detail search restores the tree')
  const originalDiffTrigger = document.querySelector<HTMLButtonElement>('#mission-detail-tree [data-file-id="file-a"]')!
  originalDiffTrigger.click()
  await until(() => document.querySelector('.mission-diff-dialog'), 'Cumulative diff dialog opens')
  await until(() => document.querySelector('.mission-diff-reading header strong')?.textContent === 'src/mission.ts', 'First selected file diff loads')
  const diffDialogWidth = document.querySelector('.mission-diff-dialog')!.getBoundingClientRect().width
  const diffReadingBounds = document.querySelector('.mission-diff-reading')!.getBoundingClientRect()
  const diffHeaderIconBounds = document.querySelector('.mission-diff-reading > header > .node-icon')!.getBoundingClientRect()
  const firstDiffLineBounds = document.querySelector('.mission-diff-reading .mission-diff-line')!.getBoundingClientRect()
  check(Math.abs(diffDialogWidth - 1320) <= 1, `Cumulative diff dialog uses the approved desktop width (${diffDialogWidth}px)`)
  check(Math.abs(diffHeaderIconBounds.width - 14) <= 1 && Math.abs(diffHeaderIconBounds.height - 16) <= 1, `Diff header file icon stays at 14×16 (${diffHeaderIconBounds.width}×${diffHeaderIconBounds.height})`)
  check(firstDiffLineBounds.top >= diffReadingBounds.top && firstDiffLineBounds.top < diffReadingBounds.bottom, 'First diff line stays inside the visible reading area')
  check(document.querySelector('.diff-dialog-baseline code')?.textContent === 'aaaaaaaaaaaa' && document.querySelector('.diff-dialog-summary')?.textContent?.includes('7 个文件'), 'Dialog header shows the fixed baseline and cumulative totals')
  check(!document.querySelector('.mission-diff-dialog .compact-footer'), 'Diff dialog closes only from the top control or Escape')
  check(!document.querySelector('.mission-diff-dialog')!.textContent?.includes('Git 文件模式'), 'Cumulative diff omits raw Git mode rows')
  const modalSearch = document.querySelector<HTMLInputElement>('.mission-diff-file-list .changes-tree-search input')!
  fill(modalSearch, 'worker')
  await until(() => document.querySelectorAll('#mission-modal-tree [data-file-id]').length === 1, 'Dialog tree search filters file paths')
  document.querySelector<HTMLButtonElement>('.mission-diff-file-list .changes-search-clear')!.click()
  await until(() => document.querySelectorAll('#mission-modal-tree [data-file-id]').length === 7, 'Dialog tree search clears without closing the reader')
  const splitter = document.querySelector<HTMLElement>('.diff-resize-handle')!, treeNavigation = document.querySelector<HTMLElement>('.mission-diff-file-list')!
  const initialTreeWidth = Math.round(treeNavigation.getBoundingClientRect().width)
  splitter.focus(); splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await until(() => Math.round(treeNavigation.getBoundingClientRect().width) > initialTreeWidth, 'Diff tree splitter supports keyboard resizing')
  splitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  const diffButton = (fileId: string) => document.querySelector<HTMLButtonElement>(`.mission-diff-file-list [data-file-id="${fileId}"]`)!
  const diffCalls = (fileId: string) => qa.calls.filter((call:any) => call.method === 'missions.fileDiff' && call.p.fileId === fileId).length
  const worker = diffButton('file-b'), mission = diffButton('file-a')
  worker.click(); mission.click()
  await new Promise(resolve => setTimeout(resolve, 70))
  check(diffCalls('file-b') === 0, 'A superseded file selection is cancelled before its Git request starts')
  worker.click()
  await until(() => diffCalls('file-b') === 1, 'The latest selected file starts one Git request')
  mission.click()
  await new Promise(resolve => setTimeout(resolve, 140))
  check(document.querySelector('.mission-diff-reading header strong')?.textContent === 'src/mission.ts', 'A late response cannot replace the current file')
  worker.click(); await frames()
  check(document.querySelector('.mission-diff-reading header strong')?.textContent === 'src/runtime/worker.ts' && !document.querySelector('.mission-diff-state'), 'Returning to a viewed file uses cache without a loading flash')
  check(diffCalls('file-b') === 1, 'Cached file Diff is not requested again')
  check(qa.calls.filter((call:any) => call.method === 'missions.fileDiff').every((call:any) => typeof call.p.viewId === 'string'), 'File Diff requests carry the current view association')
  document.querySelector<HTMLButtonElement>('.mission-diff-dialog .compact-close')!.click()
  await until(() => !document.querySelector('.mission-diff-dialog'), 'Cumulative diff dialog closes')
  check(document.activeElement === originalDiffTrigger, 'Closing the diff dialog restores focus to its detail-tree trigger')
  const changeReads = qa.calls.filter((call:any) => call.method === 'missions.changes').length
  qa.invalidateMissionDetails(); await new Promise(resolve => setTimeout(resolve, 180))
  check(qa.calls.filter((call:any) => call.method === 'missions.changes').length === changeReads, 'Mission definition invalidation does not rescan Git Diff')
  qa.delayNextMissionChanges()
  document.querySelector<HTMLButtonElement>('[aria-label="刷新累计文件变更"]')!.click()
  await until(() => qa.calls.filter((call:any) => call.method === 'missions.changes').length === changeReads + 1, 'A manual refresh starts one delayed workspace view read')
  qa.setCheckoutBranch('rovai/mission/018-live')
  qa.terminalMissionRun(qa.items[0].campId)
  window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
  await new Promise(resolve => setTimeout(resolve, 150))
  check(qa.calls.filter((call:any) => call.method === 'missions.changes').length === changeReads + 1 && qa.missionChangesInFlight() === 1 && qa.missionChangesMaxInFlight() === 1, 'Run completion, focus and visibility do not overlap or queue another workspace read')
  await until(() => qa.missionChangesInFlight() === 0 && document.querySelector('.mission-changes-read-state')?.textContent?.includes('工作区可能已变化'), 'An invalidation during refresh retains the result and marks it possibly changed')
  check(qa.calls.filter((call:any) => call.method === 'missions.changes').length === changeReads + 1, 'External invalidations never launch a follow-up Git read')
  document.querySelector<HTMLButtonElement>('.mission-changes-read-state button')!.click()
  await until(() => qa.calls.filter((call:any) => call.method === 'missions.changes').length === changeReads + 2, 'A second explicit refresh reads the newer workspace view')
  await until(() => [...document.querySelectorAll('.mission-delivery-section .mission-evidence-row code')].some(node => node.textContent === 'rovai/mission/018-live'), 'The explicitly refreshed checkout and change list commit together')
  const refreshedReads = changeReads + 2
  qa.terminalMissionRun(qa.items[0].campId); qa.terminalMissionRun(qa.items[0].campId); qa.terminalMissionRun(qa.items[0].campId)
  await new Promise(resolve => setTimeout(resolve, 180))
  check(qa.calls.filter((call:any) => call.method === 'missions.changes').length === refreshedReads && document.querySelector('.mission-changes-read-state')?.textContent?.includes('工作区可能已变化'), 'Burst workspace invalidations only mark the retained result stale')
  document.querySelector<HTMLButtonElement>('.mission-delivery-file .attachment-open')!.click()
  await until(() => visiblePreview()?.textContent?.includes('交互核对'), 'Delivery opens shared file viewer')
  const fileReader = visiblePreview()!.querySelector('.file-preview-content')!
  check(document.querySelectorAll('[role=tab]').length === 2, 'File and activity are siblings')
  button('活动').click()
  await until(() => tab('活动')?.getAttribute('aria-selected') === 'true', 'Activity entry switches from the retained file to Activity')
  check(fileReader.isConnected, 'File reader survives activity switch')
  button('活动').click()
  await until(() => !tab('活动') && visiblePreview()?.textContent?.includes('交互核对'), 'Selected Activity toggle closes its tab and restores the retained file')
  document.querySelector<HTMLButtonElement>('.file-preview-tab-close')!.click()
  await until(() => !visiblePreview(), 'Closing last file hides preview')
  cases.push('Diff switching uses bounded cache while workspace events retain results until explicit refresh')
  cases.push('activity entry switches tabs, closes the selected Activity, and retains the file until its last close')

  button('活动').click()
  await until(() => visiblePreview() && tab('活动'), 'Activity is available again')
  const handle = document.querySelector<HTMLElement>('.mission-drawer-resize-handle')!
  handle.focus(); handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  await until(() => Math.round(document.querySelector('.mission-drawer')!.getBoundingClientRect().width) === 640, 'Keyboard minimum width')
  await until(() => !visiblePreview(), 'Narrowing past the split limit hides preview first')
  check(getComputedStyle(document.querySelector('.mission-drawer .timeline-pane')!).display !== 'none', 'Narrow drawer preserves the message area')
  button('展开文件预览').click()
  await until(() => visiblePreview() && tab('活动') && document.querySelector('.workspace-grid.file-preview-compact'), 'Explicit preview reopen remains available at narrow width')
  const source = document.querySelector<HTMLElement>(`[data-message-id="${qa.sourceMessageId(qa.items[0].missionId)}"]`)!
  const scrollIntoView = source.scrollIntoView.bind(source)
  let sourceScrollCount = 0
  source.scrollIntoView = options => { ++sourceScrollCount; scrollIntoView(options) }
  button('查看来源').click()
  await until(() => !visiblePreview(), 'Source navigation returns to compact conversation')
  await until(() => document.activeElement === source, 'Source message receives focus')
  await frames()
  editor.focus()
  for (let refresh = 0; refresh < 3; ++refresh) {
    const previousReads = qa.calls.filter((call:any) => call.method === 'camps.open').length
    qa.refreshCamp(qa.items[0].campId)
    await until(() => qa.calls.filter((call:any) => call.method === 'camps.open').length > previousReads, 'Source regression refresh reaches the conversation')
    await frames(); await frames()
    check(sourceScrollCount === 1, 'Snapshot refresh must not replay source positioning')
    check(document.activeElement === editor, 'Snapshot refresh must not steal focus back from the Composer')
  }
  await new Promise(resolve => setTimeout(resolve, 1900))
  check(!source.classList.contains('notification-focus-target'), 'Source highlight ends after one pulse')
  button('展开文件预览').click()
  await until(() => visiblePreview() && tab('活动'), 'Activity can reopen for a second source request')
  button('查看来源').click()
  await until(() => sourceScrollCount === 2 && document.activeElement === source && !visiblePreview(), 'A second explicit click may focus the source again')
  source.scrollIntoView = scrollIntoView
  check(document.getElementById('camp-message') === editor, 'Source link keeps Composer')
  handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  await until(() => document.querySelector('.mission-full'), 'Keyboard expansion')
  button('返回使命板').click()
  await until(() => !document.querySelector('.mission-workspace-host'), 'Return to board')
  const lanePositionsAfterDetails = new Map(Array.from(document.querySelectorAll<HTMLElement>('.mission-column-cards')).map(column => [column.getAttribute('aria-labelledby')!, column.scrollTop]))
  check([...lanePositionsBeforeDetails].every(([status,position]) => Math.abs((lanePositionsAfterDetails.get(status) ?? -1) - position) <= 1), 'Opening details and returning preserves every lane position')
  qa.clearScrollableLanes()
  await until(() => !document.querySelector('[data-mission-id^="scroll-"]'), 'Independent-scroll fixtures clear without disturbing the real Missions')
  cases.push('status lanes scroll independently, preserve positions and auto-scroll the drag target edge')
  cases.push('drawer resize hides preview before messages; explicit compact preview and source navigation preserve state')

  await switchMissionView('列表')
  check(document.querySelectorAll('.mission-list-group').length === 4, 'List is grouped by status')
  document.querySelector<HTMLButtonElement>('.mission-group-heading')!.click()
  await until(() => document.querySelector('.mission-list-cards[hidden]'), 'List group folds')
  cases.push('list view uses independently collapsible status groups')

  const newEntry = button('新使命'), entryBounds = newEntry.getBoundingClientRect()
  const tokenProbe = document.createElement('span')
  tokenProbe.style.cssText = 'background:var(--conversation-action);color:var(--conversation-action-contrast)'
  newEntry.after(tokenProbe)
  const originalTheme = document.documentElement.dataset.theme
  for (const theme of ['day', 'night']) {
    document.documentElement.dataset.theme = theme
    const entryStyle = getComputedStyle(newEntry)
    check(entryStyle.backgroundColor === getComputedStyle(tokenProbe).backgroundColor
      && entryStyle.color === getComputedStyle(tokenProbe).color, `New Mission uses neutral primary tokens in ${theme}`)
  }
  if (originalTheme === undefined) delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = originalTheme
  tokenProbe.remove()
  check(newEntry.contains(document.elementFromPoint(entryBounds.x + entryBounds.width / 2, entryBounds.y + entryBounds.height / 2)), 'Window drag strip cannot cover creation entry')
  newEntry.click()
  await until(() => document.querySelector('input[aria-label="使命名称"]'), 'Create dialog')
  const createDialog = document.querySelector<HTMLElement>('.mission-create-dialog')!
  const createTitle = document.querySelector<HTMLInputElement>('input[aria-label="使命名称"]')!
  const createDescription = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="使命描述"]')!
  check(Math.abs(createDialog.getBoundingClientRect().width - 820) <= 1, 'Create dialog matches the approved 820px writing width')
  check(document.activeElement !== createTitle && document.activeElement !== createDescription, 'Create opens without focusing a writing field')
  check(parseFloat(getComputedStyle(createTitle).borderTopWidth) === 0 && parseFloat(getComputedStyle(createDescription).borderTopWidth) === 0, 'Create title and description have no field frame')
  createDescription.focus(); await frames()
  check(getComputedStyle(createDescription).outlineStyle === 'none' && getComputedStyle(createDescription).boxShadow === 'none', 'Focused description stays visually borderless')
  createDescription.blur()
  fill(createTitle, '草稿保留使命')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(createDescription, '关闭后仍应恢复的使命描述')
  createDescription.dispatchEvent(new Event('input', { bubbles: true }))
  const creationProperties = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.mission-create-dialog .mission-editor-property'))
  const initialCreationProperties = creationProperties()
  check(initialCreationProperties.every(property => !property.querySelector('.dialog-glyph')), 'Create property controls do not show dropdown arrows')
  const creationPropertyWidths = initialCreationProperties.map(property => property.getBoundingClientRect().width)
  check(creationPropertyWidths[0] <= 157 && creationPropertyWidths[1] <= 225 && creationPropertyWidths[2] <= 133, 'Create properties remain content-sized and bounded')
  const largeTeamCount = Number(initialCreationProperties[1].getAttribute('aria-label')?.match(/(\d+) 位队员/)?.[1] ?? 0)
  check(largeTeamCount >= 12 && initialCreationProperties[1].querySelector('.mission-editor-team-overflow')?.textContent === `+${largeTeamCount - 2}`, 'A large selected team stays compact while exposing the full count')
  creationProperties()[0].click()
  await until(() => document.querySelector('.mission-editor-project-popover'), 'Mission project picker opens')
  const projectList = document.querySelector<HTMLElement>('.mission-editor-project-list')!
  check(projectList.scrollHeight > projectList.clientHeight, 'Long project catalog remains vertically scrollable')
  fill(document.querySelector<HTMLInputElement>('input[aria-label="搜索项目"]')!, '示例项目 12')
  await until(() => document.querySelectorAll('.mission-editor-project-list .compact-option').length === 1, 'Project search filters the catalog')
  document.querySelector<HTMLButtonElement>('.mission-editor-project-list [title="/workspace/sample-12"]')!.click()
  await until(() => !document.querySelector('.mission-editor-project-popover'), 'Choosing a searched project closes only its picker')
  creationProperties()[1].click()
  await until(() => document.querySelector('.mission-editor-team-popover'), 'Mission team picker opens')
  const teamList = document.querySelector<HTMLElement>('.mission-editor-team-list')!
  check(teamList.scrollHeight > teamList.clientHeight, 'Long member catalog remains vertically scrollable')
  const teamPopover = document.querySelector<HTMLElement>('.mission-editor-team-popover')!
  const teamFooter = teamPopover.querySelector<HTMLElement>('.mission-editor-team-footer')!
  check(teamPopover.querySelector('.mission-editor-team-count')?.textContent === `已选 ${largeTeamCount} / ${largeTeamCount}`, 'Large-team picker reports selected and total counts')
  teamList.scrollTop = teamList.scrollHeight
  await frames()
  const lastTeamRow = teamList.lastElementChild as HTMLElement
  const teamListBounds = teamList.getBoundingClientRect(), lastTeamRowBounds = lastTeamRow.getBoundingClientRect()
  check(teamList.scrollTop > 0 && lastTeamRowBounds.top >= teamListBounds.top - 1 && lastTeamRowBounds.bottom <= teamListBounds.bottom + 1
    && !teamList.contains(teamFooter) && teamFooter.getClientRects().length > 0, 'Large-team picker keeps its footer fixed while the full roster scrolls')
  fill(document.querySelector<HTMLInputElement>('input[aria-label="搜索队员"]')!, '扩展队员 12')
  await until(() => document.querySelectorAll('.mission-editor-team-row').length === 1, 'Member search filters names and roles')
  button('完成').click()
  await until(() => !document.querySelector('.mission-editor-team-popover'), 'Team picker closes from its own completion action')
  creationProperties()[2].click()
  await until(() => document.querySelector('.mission-editor-tag-popover'), 'Mission tag picker opens')
  const tagSearch = document.querySelector<HTMLInputElement>('input[aria-label="搜索或新建标签"]')!
  fill(tagSearch, '交互')
  await until(() => document.querySelectorAll('.mission-editor-tag-popover .mission-tag-options [role=checkbox]').length === 1, 'Tag search filters existing tags')
  const tagOption = document.querySelector<HTMLButtonElement>('.mission-editor-tag-popover .mission-tag-options [role=checkbox]')!
  const tagDotBounds = tagOption.querySelector('.mission-tag-color-dot')!.getBoundingClientRect()
  check(tagDotBounds.width >= 14 && tagDotBounds.width <= 16 && Math.abs(tagDotBounds.width - tagDotBounds.height) <= 1, 'Tag choices use a compact circular color dot instead of a tag glyph')
  tagOption.click(); await frames()
  check(tagOption.classList.contains('is-selected') && getComputedStyle(tagOption).backgroundColor !== 'rgba(0, 0, 0, 0)' && tagOption.querySelector('.mission-icon'), 'A selected tag row uses its own background and a checkmark')
  fill(tagSearch, '体验优化')
  await until(() => document.querySelectorAll('.mission-editor-tag-popover .mission-tag-options [role=checkbox]').length === 1, 'Tag search can move to a second existing tag')
  document.querySelector<HTMLButtonElement>('.mission-editor-tag-popover .mission-tag-options [role=checkbox]')!.click(); await frames()
  const createTagTokens = Array.from(creationProperties()[2].querySelectorAll<HTMLElement>('.mission-editor-selected-tag'))
  check(createTagTokens.length === 2 && new Set(createTagTokens.map(token => getComputedStyle(token).backgroundColor)).size === 2, 'Create trigger renders each selected tag with an independent background')
  check(createTagTokens.every(token => token.style.getPropertyValue('--mission-tag-color').startsWith('var(--mission-label-')), 'Create uses the dedicated Mission label palette')
  check(document.querySelector('.mission-create-dialog') && document.querySelector('.mission-editor-tag-popover'), 'Choosing a tag stays in the current editor and picker')
  creationProperties()[2].click()
  await until(() => !document.querySelector('.mission-editor-tag-popover') && document.querySelector('.mission-create-dialog'), 'Tag picker closes back into the same Mission draft')
  const createAttachmentInput = document.querySelector<HTMLInputElement>('.mission-create-dialog input[type=file]')!
  check(createAttachmentInput, 'Mission draft remains open after closing the tag picker')
  const createAttachmentTransfer = new DataTransfer()
  createAttachmentTransfer.items.add(new File(['brief'], 'mission-brief.md', { type: 'text/markdown' }))
  Object.defineProperty(createAttachmentInput, 'files', { configurable: true, value: createAttachmentTransfer.files })
  createAttachmentInput.dispatchEvent(new Event('change', { bubbles: true }))
  await until(() => document.querySelector('.mission-create-dialog [title="mission-brief.md"]'), 'Create accepts a new attachment')
  document.querySelector<HTMLButtonElement>('.mission-create-dialog .mission-editor-footer .compact-cancel')!.click()
  await until(() => !document.querySelector('.mission-create-dialog'), 'Closing an unfinished Mission keeps its draft')
  button('新使命').click()
  await until(() => document.querySelector('.mission-create-dialog'), 'Mission creation can reopen')
  check((document.querySelector('input[aria-label="使命名称"]') as HTMLInputElement).value === '草稿保留使命'
    && (document.querySelector('textarea[aria-label="使命描述"]') as HTMLTextAreaElement).value === '关闭后仍应恢复的使命描述'
    && document.querySelector('.mission-create-dialog [title="mission-brief.md"]')
    && creationProperties()[0].textContent?.includes('示例项目 12')
    && creationProperties()[2].textContent?.includes('交互'), 'Reopening restores the one retained title, description, project, tag and attachment draft')
  fill(document.querySelector<HTMLInputElement>('input[aria-label="使命名称"]')!, '无描述使命')
  const reopenedDescription = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="使命描述"]')!
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reopenedDescription, '')
  reopenedDescription.dispatchEvent(new Event('input', { bubbles: true }))
  await frames()
  const create = button('新建')
  check(!button('保存使命') && create, 'One default create action')
  create.click()
  await until(() => qa.items.some((m: any) => m.title === '无描述使命'), 'Empty description creates Mission')
  await until(() => !document.querySelector('.new-camp-dialog'), 'Create dialog closes')
  check(!document.querySelector('.mission-workspace-host'), 'Create remains on board')
  const created = qa.items.find((m: any) => m.title === '无描述使命')
  check(created.description === '' && created.status === 'not_started' && created.projectPath === '/workspace/sample-12' && created.tags.includes('交互') && created.attachments[0]?.displayName === 'mission-brief.md', 'Default create preserves its draft properties and attachment without starting')
  check(qa.calls.some((c: any) => c.method === 'missions.createWithAttachments' && c.p.command.title === '无描述使命'), 'Create sends attachments through the private native bridge')
  check(!qa.calls.some((c: any) => c.method === 'missions.start' && c.p.command?.missionId === created.missionId), 'No start request on default create')
  button('新使命').click()
  await until(() => document.querySelector('.mission-create-dialog'), 'Creation opens again after a confirmed create')
  check((document.querySelector('input[aria-label="使命名称"]') as HTMLInputElement).value === '' && !document.querySelector('.mission-create-dialog [title="mission-brief.md"]'), 'Confirmed creation clears the retained Mission draft')
  document.querySelector<HTMLButtonElement>('.mission-create-dialog .mission-editor-footer .compact-cancel')!.click()
  await until(() => !document.querySelector('.mission-create-dialog'), 'Fresh creation dialog closes')
  Array.from(document.querySelectorAll<HTMLElement>('.mission-board-card')).find(card => card.textContent?.includes('无描述使命'))!.click()
  await until(() => document.querySelector('.mission-drawer .mission-start'), 'Created Mission opens with a start action')
  qa.failNextMissionStart()
  const rejectedStartCalls = qa.calls.filter((call:any) => call.method === 'missions.start' && call.p.command?.missionId === created.missionId).length
  button('开始使命').click()
  await until(() => button('正在开始…')?.disabled && button('正在开始…')?.getAttribute('aria-busy') === 'true', 'Start disables immediately with accessible pending feedback')
  await until(() => qa.calls.filter((call:any) => call.method === 'missions.start' && call.p.command?.missionId === created.missionId).length === rejectedStartCalls + 1 && button('开始使命') && document.querySelector('.app-toast[role=alert]')?.textContent?.includes('mission.lead_unavailable'), 'Rejected start restores the action and reports the error')
  const acceptedStartCalls = qa.calls.filter((call:any) => call.method === 'missions.start' && call.p.command?.missionId === created.missionId).length
  button('开始使命').click()
  await until(() => button('正在开始…')?.disabled, 'Accepted start also enters the immediate pending state')
  await until(() => qa.calls.filter((call:any) => call.method === 'missions.start' && call.p.command?.missionId === created.missionId).length === acceptedStartCalls + 1 && !button('开始使命') && !button('正在开始…'), 'Accepted start hides the action before any AgentRun is claimed')
  check(created.status === 'not_started', 'Start leaves the explicitly managed Mission status unchanged')
  check(created.runningAgentIds.length === 0 && !Array.from(document.querySelectorAll<HTMLElement>('.mission-board-card')).find(card => card.textContent?.includes('无描述使命'))?.querySelector('.mission-running'), 'Waiting start Delivery is not presented as executing')
  check(!document.querySelector(`[data-message-id="${created.missionId}-mission-start"]`) && !document.querySelector('.mission-commission'), 'Start does not insert a visible user-authored message')
  button('关闭使命抽屉').click()
  await until(() => !document.querySelector('.mission-workspace-host'), 'Started Mission returns to the board')
  check(qa.errors.length === 0, qa.errors.join('\n'))
  cases.push('optional description, default creation and status-independent start match the approved flow')

  const notifiedMission = qa.items.find((item:any) => item.missionId === 'mission-0')
  const firstSource = qa.admitMissionNotification(notifiedMission.missionId)
  await until(() => document.querySelector('.notification-heads-up-open'), 'Mission notification appears')
  document.querySelector<HTMLButtonElement>('.notification-heads-up-open')!.click()
  await until(() => document.querySelector('.mission-drawer') && document.activeElement?.getAttribute('data-message-id') === firstSource, 'Mission notification opens the board and drawer at its exact source')
  check(!document.querySelector('.mission-board-page')?.hasAttribute('hidden'), 'Mission board remains visible behind the notified drawer')
  const notifiedEditor = document.getElementById('camp-message')
  button('展开为完整会话').click()
  await until(() => document.querySelector('.mission-full'), 'Notified Mission can expand')
  const notificationReads = qa.calls.filter((call:any) => call.method === 'notifications.changesSince').length
  qa.admitMissionNotification(notifiedMission.missionId, 'open_camp')
  await until(() => qa.calls.filter((call:any) => call.method === 'notifications.changesSince').length > notificationReads, 'Same-Mission notification is consumed')
  await frames()
  check(!document.querySelector('.notification-heads-up-open') && !!document.querySelector('.mission-full'), 'An attentive user already reading this Mission does not receive a redundant heads-up')
  check(document.getElementById('camp-message') === notifiedEditor, 'Same-Mission attention preserves the mounted Composer')
  button('返回使命板').click()
  await until(() => !document.querySelector('.mission-workspace-host'), 'Notified drawer closes back to the board')
  check(qa.errors.length === 0, qa.errors.join('\n'))
  cases.push('notifications open Mission drawers at the exact source while the already active full Mission stays quiet')

  const cleanupMission = qa.items.find((item:any) => item.title === '基于最新内容编辑')
  const cleanupCard = Array.from(document.querySelectorAll<HTMLElement>('.mission-board-card')).find(node => node.textContent?.includes(cleanupMission.title))!
  const cleanupGroup = cleanupCard.closest<HTMLElement>('.mission-list-group')
  if (cleanupGroup?.querySelector('.mission-list-cards')?.hasAttribute('hidden')) {
    cleanupGroup.querySelector<HTMLButtonElement>('.mission-group-heading')!.click()
    await frames()
  }
  cleanupCard.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cleanupCard.getBoundingClientRect().left + 20, clientY: cleanupCard.getBoundingClientRect().top + 20 }))
  const cleanupAction = () => Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(item => item.textContent?.trim() === '清理使命 Worktree')
  await until(cleanupAction, 'Core cleanup capability exposes the existing right-click action')
  cleanupAction()!.click()
  await until(() => document.querySelector('.mission-worktree-cleanup-dialog') && !button('清理').disabled, 'Workspace cleanup dialog resolves its exact resources')
  const cleanupDialog = document.querySelector<HTMLElement>('.mission-worktree-cleanup-dialog')!
  check(cleanupDialog.textContent?.includes('将删除此使命的 Worktree 和本地分支。') && cleanupDialog.textContent?.includes('/workspace/rovai-ai-mission-018') && cleanupDialog.textContent?.includes('rovai/mission/018'), 'Cleanup dialog stays concise and identifies the exact path and branch')
  check(button('清理').classList.contains('compact-primary') && !button('清理').classList.contains('danger'), 'Cleanup uses the neutral primary action')
  qa.failNextMissionRefresh()
  button('清理').click()
  await until(() => !document.querySelector('.mission-worktree-cleanup-dialog') && qa.missionRefreshPending(), 'Accepted cleanup closes before its background refresh finishes')
  await until(() => cleanupCard.querySelector('.mission-card-cleanup-status')?.textContent?.includes('正在清理 Worktree'), 'The card owns cleanup progress after the dialog unmounts')
  await until(() => document.querySelector('.app-toast')?.textContent?.includes('使命 Worktree 清理已开始，但信息刷新失败'), 'A later refresh failure is reported separately without claiming cleanup succeeded')
  button('关闭提示').click()
  check(qa.calls.some((call:any) => call.method === 'missions.workspace.cleanup' && call.p.command?.missionId === cleanupMission.missionId), 'Cleanup uses the authoritative Mission workspace command')
  cleanupCard.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cleanupCard.getBoundingClientRect().left + 20, clientY: cleanupCard.getBoundingClientRect().top + 20 }))
  await until(() => document.querySelector('[role=menu]'), 'Mission action menu reopens while cleanup is pending')
  check(!cleanupAction(), 'Pending cleanup prevents a duplicate cleanup request')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  qa.failMissionCleanup(cleanupMission.missionId, true)
  await until(() => cleanupCard.querySelector('.mission-card-cleanup-status')?.textContent?.includes('分支清理失败'), 'Partial failure persists on the card and names the unfinished branch step')
  await until(() => document.querySelector('.app-toast')?.textContent?.includes('M-018 分支清理失败') && document.querySelector('.app-toast-action')?.textContent === '查看', 'Cleanup failure raises the existing actionable error Toast with the Mission identifier')
  document.querySelector<HTMLButtonElement>('.app-toast-action')!.click()
  await until(() => document.querySelector('.mission-drawer') && document.querySelector('.mission-workspace-cleanup-failure'), 'Toast action opens the Mission cleanup details')
  const failureDetails = document.querySelector<HTMLElement>('.mission-workspace-cleanup-failure')!
  check(failureDetails.textContent?.includes('分支清理失败') && failureDetails.textContent?.includes('mission.branch_changed') && failureDetails.textContent?.includes('Worktree已清理') && failureDetails.textContent?.includes('本地分支待清理'), 'Cleanup details show the reason and both actual resource states')
  button('重试未完成步骤').click()
  await until(() => cleanupMission.workspaceCleanup?.state === 'cleaning' && cleanupCard.querySelector('.mission-card-cleanup-status')?.textContent?.includes('正在清理本地分支'), 'Retry returns only the unfinished branch step to progress')
  check(qa.calls.filter((call:any) => call.method === 'missions.workspace.cleanup' && call.p.command?.missionId === cleanupMission.missionId).length === 2, 'Retry uses the same authoritative cleanup command exactly once')
  qa.completeMissionCleanup(cleanupMission.missionId)
  await until(() => cleanupCard.querySelector('.mission-card-cleanup-status')?.textContent?.includes('Worktree 已清理') && document.querySelector('.mission-workspace-cleared'), 'Completion gives brief card feedback while details retain the cleaned fact')
  button('展开为完整会话').click()
  await until(() => document.querySelector('.mission-full'), 'Leaving the board clears transient cleanup success feedback')
  button('返回使命板').click()
  await until(() => !document.querySelector('.mission-workspace-host'), 'Cleanup Mission returns to the board')
  check(!cleanupCard.querySelector('.mission-card-cleanup-status') && cleanupMission.workspaceCleanup?.state === 'cleaned', 'Re-entering the board does not replay cleanup success')
  cleanupCard.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cleanupCard.getBoundingClientRect().left + 20, clientY: cleanupCard.getBoundingClientRect().top + 20 }))
  await until(() => document.querySelector('[role=menu]'), 'Mission action menu reopens after cleanup')
  check(!cleanupAction(), 'Completed cleanup keeps the menu action unavailable')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  cases.push('workspace cleanup persists progress, partial failure, actionable recovery and one-shot success independently of its dialog')

  const deleteMission = qa.items.find((item:any) => item.title === '使命累计变更回归测试')
  const deleteCard = Array.from(document.querySelectorAll<HTMLElement>('.mission-board-card')).find(node => node.textContent?.includes(deleteMission.title))!
  const deleteGroup = deleteCard.closest<HTMLElement>('.mission-list-group')
  if (deleteGroup?.querySelector('.mission-list-cards')?.hasAttribute('hidden')) { deleteGroup.querySelector<HTMLButtonElement>('.mission-group-heading')!.click(); await frames() }
  deleteCard.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: deleteCard.getBoundingClientRect().left + 20, clientY: deleteCard.getBoundingClientRect().top + 20 }))
  await until(() => Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).some(item => item.textContent?.trim() === '删除'), 'Delete-with-cleanup Mission menu opens')
  Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(item => item.textContent?.trim() === '删除')!.click()
  await until(() => document.querySelector('.mission-delete-dialog') && !button('删除使命').disabled, 'Delete-with-cleanup dialog resolves')
  document.querySelector<HTMLInputElement>('.mission-delete-workspace-option input')!.click()
  button('删除使命').click()
  const deletionCommitted = () => !Array.from(document.querySelectorAll<HTMLElement>('.mission-board-card')).some(node => node.textContent?.includes(deleteMission.title)) && qa.orphanCleanups[0]?.state === 'cleanup_pending'
  const deletionError = () => document.querySelector<HTMLElement>('.mission-delete-dialog [role=alert]')?.textContent?.trim() ?? ''
  await until(() => deletionCommitted() || deletionError(), 'Mission deletion either commits or reports its request failure')
  check(!deletionError(), `Mission deletion must not fail before the command is admitted: ${deletionError()}`)
  check(deletionCommitted(), 'Mission card disappears as soon as deletion and cleanup intent commit')
  const deleteVersionRead = qa.calls.findLast((call:any) => call.method === 'camps.open' && call.p.campId === deleteMission.campId)
  check(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deleteVersionRead?.p.traceId ?? ''), 'Mission deletion reads the exact Camp version with a valid trace ID')
  qa.failOrphanCleanup(true)
  await until(() => document.querySelector('.mission-cleanup-notice')?.textContent?.includes('1 个工作区待清理'), 'Deleted Mission cleanup failure remains on the existing workspace route')
  await until(() => document.querySelector('.app-toast')?.textContent?.includes('使命 rovai/mission/015 分支清理失败'), 'Deleted Mission cleanup failure also raises an actionable Toast')
  document.querySelector<HTMLButtonElement>('.app-toast-action')!.click()
  await until(() => document.querySelector('.mission-cleanup-list')?.textContent?.includes('分支清理失败'), 'Deleted Mission Toast opens the workspace cleanup route')
  const orphanDetails = document.querySelector<HTMLElement>('.mission-cleanup-list')!
  check(orphanDetails.textContent?.includes('Worktree：已清理 · 本地分支：待清理') && orphanDetails.textContent?.includes('mission.branch_changed'), 'Orphan details preserve the partial checkpoint and failure reason without restoring the card')
  button('重试未完成步骤').click()
  await until(() => qa.orphanCleanups[0]?.state === 'cleanup_pending' && orphanDetails.textContent?.includes('正在清理本地分支'), 'Orphan retry schedules only the unfinished step')
  qa.completeOrphanCleanup()
  await until(() => orphanDetails.textContent?.includes('工作区已清理完成'), 'Orphan route observes background cleanup completion')
  check(!Array.from(document.querySelectorAll<HTMLElement>('.mission-board-card')).some(node => node.textContent?.includes(deleteMission.title)), 'Cleanup failure and success never restore the deleted Mission card')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await until(() => !document.querySelector('.mission-cleanup-list'), 'Orphan cleanup dialog closes')
  await switchMissionView('看板')
  cases.push('delete-with-cleanup removes the card before resource work and recovers later failure through the orphan cleanup route')
  return { ok: true, cases }
}

export async function runMissionDeleteTraceAcceptance(): Promise<{ ok: true; cases: string[] }> {
  const qa = (window as any).missionQA
  const check = (value: unknown, message: string): void => { if (!value) throw new Error(message) }
  const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const until = async (condition: () => unknown, message: string): Promise<void> => {
    for (let i = 0; i < 180; ++i) { await frames(); if (condition()) return }
    throw new Error(`${message}\n${JSON.stringify({
      feedback: [...document.querySelectorAll('[role=alert],.toast')].map(node => node.textContent),
      recentCalls: qa.calls.slice(-8)
    })}`)
  }
  const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find(element => element.getAttribute('aria-label') === label || element.textContent?.trim() === label)
  await until(() => document.querySelector('.mission-board-card'), 'Mission board did not load for deletion acceptance')
  const mission = qa.items.find((item:any) => item.title === '使命累计变更回归测试')
  const card = Array.from(document.querySelectorAll<HTMLElement>('.mission-board-card')).find(node => node.textContent?.includes(mission.title))
  check(card, 'Deletion acceptance Mission card is unavailable')
  card!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: card!.getBoundingClientRect().left + 20, clientY: card!.getBoundingClientRect().top + 20 }))
  await until(() => Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).some(item => item.textContent?.trim() === '删除'), 'Mission deletion action did not open')
  Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).find(item => item.textContent?.trim() === '删除')!.click()
  await until(() => document.querySelector('.mission-delete-dialog') && !button('删除使命')?.disabled, 'Mission deletion confirmation did not become available')
  button('删除使命')!.click()
  const deletionError = () => document.querySelector<HTMLElement>('.mission-delete-dialog [role=alert]')?.textContent?.trim() ?? ''
  const deletionCommitted = () => !Array.from(document.querySelectorAll<HTMLElement>('.mission-board-card')).some(node => node.textContent?.includes(mission.title))
  await until(() => deletionCommitted() || deletionError(), 'Mission deletion neither committed nor reported an error')
  check(!deletionError(), `Mission deletion must not fail before the command is admitted: ${deletionError()}`)
  check(deletionCommitted(), 'Mission deletion did not remove its card')
  const versionRead = qa.calls.findLast((call:any) => call.method === 'camps.open' && call.p.campId === mission.campId)
  check(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(versionRead?.p.traceId ?? ''), 'Mission deletion version read did not carry a valid trace ID')
  check(qa.calls.some((call:any) => call.method === 'camps.delete' && call.p.command?.campId === mission.campId), 'Mission deletion command was not admitted')
  return { ok: true, cases: ['Mission deletion reads the exact Camp version with a valid trace ID before deleting'] }
}

export async function runMissionLargeDiffAcceptance(): Promise<{ ok: true; cases: string[] }> {
  const qa = (window as any).missionQA
  const check = (value: unknown, message: string): void => { if (!value) throw new Error(message) }
  const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const until = async (condition: () => unknown, message: string): Promise<void> => {
    for (let i = 0; i < 240; ++i) { await frames(); if (condition()) return }
    throw new Error(`${message}${qa.errors.length ? `\n${qa.errors.join('\n')}` : ''}`)
  }
  const fill = (element: HTMLInputElement, value: string): void => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }

  await until(() => document.querySelector('.mission-board-card'), 'Large-diff Mission board loads')
  document.querySelector<HTMLElement>('.mission-board-card')!.click()
  await until(() => document.querySelector('.mission-changes-disclosure'), 'Large-diff disclosure loads')
  check(qa.calls.filter((call:any) => call.method === 'missions.changes').length === 0, 'Large-diff Activity stays idle before disclosure')
  document.querySelector<HTMLButtonElement>('.mission-changes-disclosure')!.click()
  await until(() => document.querySelector('#mission-detail-tree'), 'Large-diff detail tree loads')
  await until(() => document.querySelector('.mission-changes-count')?.textContent === '1200', 'Large-diff heading reports every changed file')
  const detail = document.querySelector<HTMLElement>('#mission-detail-tree')!
  await until(() => detail.scrollHeight > detail.clientHeight, 'Large-diff detail tree exposes a bounded scroll viewport')
  check(detail.querySelectorAll('[role=treeitem]').length < 80, 'Large-diff detail tree virtualizes mounted rows')
  check(!detail.querySelector('[role=treeitem][aria-expanded=false]'), 'Large-diff directories remain expanded by default')

  const first = detail.querySelector<HTMLButtonElement>('[role=treeitem]')!
  first.focus()
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  await until(() => (document.activeElement as HTMLElement | null)?.dataset.fileId === 'large-1192', 'End reveals and focuses the last logical tree row')
  check(detail.scrollTop > 0, 'Keyboard navigation scrolls the virtual detail tree')

  const search = document.querySelector<HTMLInputElement>('input[aria-controls="mission-detail-tree"]')!
  fill(search, 'file-0420.ts')
  await until(() => detail.querySelectorAll('.changes-tree-row.is-file').length === 1, 'Large-diff search narrows to one file')
  const match = detail.querySelector<HTMLButtonElement>('.changes-tree-row.is-file')!
  check(match.dataset.fileId === 'large-420', 'Large-diff search keeps the matching file identity')
  match.click()
  await until(() => document.querySelector('#mission-modal-tree'), 'Large-diff reader opens from a filtered tree result')

  const modal = document.querySelector<HTMLElement>('#mission-modal-tree')!
  await until(() => modal.scrollHeight > modal.clientHeight, 'Large-diff modal tree exposes a bounded scroll viewport')
  check(modal.querySelectorAll('[role=treeitem]').length < 80, 'Large-diff modal tree reuses virtualized rows')
  await until(() => modal.querySelector('[data-file-id="large-420"]'), 'Modal reveals its selected virtual row on open')
  check(document.querySelector('.diff-dialog-summary')?.textContent?.includes('1200 个文件'), 'Large-diff reader preserves the complete file total')
  const headingButton = document.querySelector<HTMLElement>('.modal-tree-heading > .mission-icon-button')!
  const headingStyle = getComputedStyle(headingButton)
  check(headingStyle.flexDirection !== 'column' && headingStyle.alignItems !== 'flex-start', 'Tree heading control is isolated from removed flat-list button styles')
  check(qa.errors.length === 0, qa.errors.join('\n'))
  return { ok: true, cases: ['large cumulative diffs virtualize both trees without losing search, scroll, totals or keyboard focus'] }
}

export async function runMissionCheckoutViewAcceptance(): Promise<{ ok: true; cases: string[] }> {
  const qa = (window as any).missionQA
  const check = (value: unknown, message: string): void => { if (!value) throw new Error(message) }
  const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const until = async (condition: () => unknown, message: string): Promise<void> => {
    for (let i = 0; i < 240; ++i) { await frames(); if (condition()) return }
    throw new Error(`${message}${qa.errors.length ? `\n${qa.errors.join('\n')}` : ''}\n${JSON.stringify({ recentCalls: qa.calls.slice(-12) })}`)
  }
  const checkoutLabels = () => [...document.querySelectorAll<HTMLElement>('.mission-delivery-section .mission-evidence-row code')].map(node => node.textContent)

  await until(() => document.querySelector('.mission-board-card'), 'Checkout-view Mission board loads')
  document.querySelector<HTMLElement>('.mission-board-card')!.click()
  await until(() => document.querySelector('.mission-changes-disclosure'), 'Checkout-view disclosure loads')
  check(qa.calls.filter((call: any) => call.method === 'missions.changes' || call.method === 'missions.fileDiff').length === 0, 'Opening Activity starts no change or file-Diff request')
  check(checkoutLabels().includes('rovai/mission/018') && !checkoutLabels().includes('rovai/mission/018-validation'), 'Activity reports only the managed branch before the first read')
  qa.terminalMissionRun(qa.items[0].campId)
  window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
  await new Promise(resolve => setTimeout(resolve, 180))
  check(qa.calls.filter((call: any) => call.method === 'missions.changes' || call.method === 'missions.fileDiff').length === 0, 'Run, focus and visibility signals do not read unopened changes')

  const disclosure = document.querySelector<HTMLButtonElement>('.mission-changes-disclosure')!
  disclosure.click()
  await until(() => document.querySelectorAll('#mission-detail-tree [data-file-id]').length === 7, 'First expansion loads cumulative changes')
  check(qa.calls.filter((call: any) => call.method === 'missions.changes').length === 1, 'First expansion issues one changed-file read')
  check(checkoutLabels().includes('rovai/mission/018-validation') && checkoutLabels().includes('rovai/mission/018'), 'Activity distinguishes the managed branch from the read-time checkout')
  disclosure.click(); await frames(); disclosure.click(); await frames()
  check(qa.calls.filter((call: any) => call.method === 'missions.changes').length === 1, 'Collapse and reopen reuse the mounted result')

  document.querySelector<HTMLButtonElement>('#mission-detail-tree [data-file-id="file-a"]')!.click()
  await until(() => document.querySelector('.mission-diff-reading header strong')?.textContent === 'src/mission.ts', 'A file Diff loads from the current view')
  await until(() => qa.calls.some((call: any) => call.method === 'missions.fileDiff' && call.p.fileId === 'file-a'), 'The selected file starts its associated Diff request')
  const fileDiffCall = qa.calls.findLast((call: any) => call.method === 'missions.fileDiff')
  check(typeof fileDiffCall?.p.viewId === 'string', 'File Diff requests carry their workspace view ID')
  document.querySelector<HTMLButtonElement>('.mission-diff-dialog .compact-close')!.click()
  await until(() => !document.querySelector('.mission-diff-dialog'), 'Checkout-view Diff closes')

  const changeReads = qa.calls.filter((call: any) => call.method === 'missions.changes').length
  qa.delayNextMissionChanges()
  document.querySelector<HTMLButtonElement>('[aria-label="刷新累计文件变更"]')!.click()
  await until(() => qa.calls.filter((call: any) => call.method === 'missions.changes').length === changeReads + 1, 'A delayed workspace refresh starts')
  qa.setCheckoutBranch('rovai/mission/018-live')
  qa.terminalMissionRun(qa.items[0].campId)
  window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
  await new Promise(resolve => setTimeout(resolve, 150))
  check(qa.calls.filter((call: any) => call.method === 'missions.changes').length === changeReads + 1 && qa.missionChangesInFlight() === 1 && qa.missionChangesMaxInFlight() === 1, 'Refresh signals do not overlap or queue the delayed read')
  await until(() => qa.missionChangesInFlight() === 0 && document.querySelector('.mission-changes-read-state')?.textContent?.includes('工作区可能已变化'), 'Signals during a read mark its completed result stale')
  check(qa.calls.filter((call: any) => call.method === 'missions.changes').length === changeReads + 1, 'Signals never launch a follow-up read')
  document.querySelector<HTMLButtonElement>('.mission-changes-read-state button')!.click()
  await until(() => checkoutLabels().includes('rovai/mission/018-live'), 'Explicit refresh commits the newer checkout and file list together')
  const freshReads = changeReads + 2
  check(qa.calls.filter((call: any) => call.method === 'missions.changes').length === freshReads, 'New checkout is read exactly once on demand')

  qa.failNextMissionChanges()
  document.querySelector<HTMLButtonElement>('[aria-label="刷新累计文件变更"]')!.click()
  await until(() => document.querySelector('.mission-diff-error')?.textContent?.includes('刷新失败，保留上次结果'), 'A failed refresh reports retained results')
  check(checkoutLabels().includes('rovai/mission/018-live') && document.querySelectorAll('#mission-detail-tree [data-file-id]').length === 7, 'Refresh failure retains checkout, files and reading state')
  const readsBeforeClose = qa.calls.filter((call: any) => call.method === 'missions.changes').length
  qa.delayNextMissionChanges()
  document.querySelector<HTMLButtonElement>('[aria-label="刷新累计文件变更"]')!.click()
  await until(() => qa.calls.filter((call: any) => call.method === 'missions.changes').length === readsBeforeClose + 1, 'A final delayed workspace refresh starts')
  qa.terminalMissionRun(qa.items[0].campId)
  await new Promise(resolve => setTimeout(resolve, 150))
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '活动')!.click()
  await until(() => !document.querySelector('#mission-detail-tree'), 'Closing Activity unmounts the workspace change view')
  await new Promise(resolve => setTimeout(resolve, 180))
  check(qa.calls.filter((call: any) => call.method === 'missions.changes').length === readsBeforeClose + 1, 'Unmounting ignores the late response without a follow-up read')
  check(qa.errors.length === 0, qa.errors.join('\n'))
  return { ok: true, cases: ['activity reads changes on demand, retains stale results, and ignores late workspace views'] }
}
