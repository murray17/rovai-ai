const assert = require('node:assert/strict')

module.exports = async function verifyFolderOrder({ run, other, mouse, key, frame, settle, point, context, selectItem }) {
  const paths = ['/fixture/rovai-ai', '/b', '/c', '/d']
  const [a, b, c, d] = paths.map(path => 'directory:' + path)
  const row = id => `[data-group="${id}"] .project-select-row`
  const domOrder = () => run("Array.from(document.querySelectorAll('.navigation-projects > [data-project-sort-key]'), group => group.dataset.group)")
  const savedOrder = () => other('window.navigationTest.preferences.get().then(snapshot => snapshot.projectOrder)')
  // X is present in Core's legacy projection, but has not been registered yet.
  const initial = await other('window.navigationTest.preferences.get()')
  const seed = snapshot => other(`localStorage.setItem('rovai.presentation:navigation-shell-fixture:navigation', ${JSON.stringify(JSON.stringify(snapshot))})`)
  const legacyKeys = [b, c, a, d]
  await seed({ ...initial, registeredProjects: ['/b', '/c', '/d'], legacyProjectsSynced: false,
    pins: legacyKeys.map((targetKey, i) => ({ kind: 'project', targetKey, pinnedAt: new Date(i * 1000).toISOString() })),
    pinnedProjectOrder: legacyKeys })
  await run('window.navigationTest.setFolderOrderFixture(true)')
  await settle()
  const pinnedOrder = () => run("Array.from(document.querySelectorAll('.pinned-navigation > .camp-nav-group'), group => group.dataset.group)")
  assert.deepEqual(await pinnedOrder(), legacyKeys)
  assert.equal(await run(`document.querySelector('[data-group="${a}"]').hasAttribute('data-project-sort-key')`), false)
  const legacyTarget = await point(row(d))
  legacyTarget.y -= 8
  mouse('mouseDown', await point(row(b)))
  mouse('mouseMove', legacyTarget)
  await frame()
  assert.equal(await run(`(() => {
    const line = document.querySelector('.project-insertion-line')
    const above = document.querySelector('[data-group="${a}"]').getBoundingClientRect().bottom
    const below = document.querySelector('[data-group="${d}"]').getBoundingClientRect().top
    return line && !line.hidden && Math.abs(parseFloat(line.style.top) - (above + below) / 2) <= 1
  })()`), true, 'The line is between the visible legacy folder and the registered anchor')
  mouse('mouseUp', legacyTarget)
  await settle()
  assert.deepEqual(await pinnedOrder(), [c, a, b, d])
  assert.deepEqual(await other('window.navigationTest.preferences.get().then(snapshot => snapshot.pinnedProjectOrder)'), [c, a, b, d])
  await seed(initial)
  await settle()
  await run(`window.navigationTest.preferences.registerProjects(${JSON.stringify(paths)}, true)`)
  await settle()
  const held = await point(row(a))
  const sourceC = await point(row(c))
  const overB = await point(row(b))
  const beforeB = { ...overB, y: overB.y - 8 }
  const beforeA = { ...held, y: held.y - 8 }
  // Release in the native move's event turn, before Chromium can present a frame.
  for (const previous of [{ ...sourceC, x: sourceC.x + 10 }, beforeA]) {
    mouse('mouseDown', sourceC)
    mouse('mouseMove', previous)
    await frame()
    await run(`document.addEventListener('pointermove', event => {
      event.target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true,
        pointerId: event.pointerId, pointerType: event.pointerType, isPrimary: true,
        clientX: event.clientX, clientY: event.clientY, button: 0, buttons: 0 }))
    }, { once: true })`)
    mouse('mouseMove', beforeB)
    mouse('mouseUp', beforeB)
    await settle()
    assert.deepEqual(await savedOrder(), [a, b, c, d], 'An unpainted final move cannot become the drop target')
  }
  // A pointerup can arrive at a new coordinate without a preceding pointermove.
  for (const [hover, hidden] of [[{ ...sourceC, x: sourceC.x + 10 }, true], [beforeB, false]]) {
    mouse('mouseDown', sourceC)
    mouse('mouseMove', hover)
    await frame()
    assert.equal(await run("document.querySelector('.project-insertion-line')?.hidden"), hidden)
    mouse('mouseUp', beforeA)
    await settle()
    assert.deepEqual(await savedOrder(), [a, b, c, d], 'Release cannot introduce a destination that was never indicated')
    assert.deepEqual(await domOrder(), [a, b, c, d])
  }
  const previousScroll = await run("document.querySelector('.navigation-scroll').scrollTop")
  const tail = await run(`(() => {
    const last = document.querySelector('[data-group="${d}"]')
    last.scrollIntoView({ block: 'center' })
    const rect = last.getBoundingClientRect()
    return { x: Math.round(rect.left + 30), y: Math.floor(rect.bottom - 3) }
  })()`)
  mouse('mouseDown', await point(row(c)))
  mouse('mouseMove', tail)
  await frame()
  assert.equal(await run("document.querySelector('.project-insertion-line')?.hidden"), false)
  mouse('mouseUp', tail)
  await settle()
  assert.deepEqual(await savedOrder(), [a, b, d, c], 'The visible line after the last folder accepts a drop')
  await other(`window.navigationTest.preferences.moveProject(${JSON.stringify({ section: 'projects', projectKey: c, beforeProjectKey: d })})`)
  await run(`document.querySelector('.navigation-scroll').scrollTop = ${previousScroll}`)
  await settle()
  const target = await point(row(d))
  target.y -= 8
  mouse('mouseDown', held)
  mouse('mouseMove', target)
  await frame()
  assert.equal(await run("document.querySelector('.project-drag-preview')?.textContent"), 'rovai-ai')
  assert.equal(await run("getComputedStyle(document.querySelector('[data-project-drag-source] .camp-group-children')).filter"), 'blur(0.65px)')
  assert.deepEqual(await savedOrder(), [a, b, c, d])
  // The other tab swaps C and D underneath the stationary pointer.
  await other(`window.navigationTest.preferences.moveProject(${JSON.stringify({ section: 'projects', projectKey: d, beforeProjectKey: c })})`)
  await settle()
  assert.deepEqual(await domOrder(), [a, b, d, c])
  assert.equal(await run(`(() => {
    const line = document.querySelector('.project-insertion-line')
    const left = document.querySelector('[data-group="${d}"]').getBoundingClientRect()
    const right = document.querySelector('[data-group="${c}"]').getBoundingClientRect()
    return !line.hidden && Math.abs(parseFloat(line.style.top) - (left.bottom + right.top) / 2) <= 1
      && getComputedStyle(line).backgroundColor === 'rgb(0, 0, 0)'
  })()`), true, 'The line marks the boundary immediately above the current folder')
  mouse('mouseUp', target)
  await settle()
  assert.deepEqual(await savedOrder(), [b, d, a, c])
  assert.deepEqual(await domOrder(), [b, d, a, c])
  assert.equal(await run(`document.querySelector('${row(a)}').getAttribute('aria-expanded')`), 'true')
  assert.equal(await run("document.querySelector('[data-group=\"quick-chat\"]').hasAttribute('data-project-sort-key')"), false)
  await run(`document.querySelector('${row(a)}').focus()`)
  await key('Up', ['alt'])
  assert.deepEqual(await savedOrder(), [b, a, d, c])
  assert.equal(await run(`document.activeElement === document.querySelector('${row(a)}')`), true, 'Keyboard movement keeps the folder focused')
  const start = await point(row(c))
  const end = await point(row(b))
  mouse('mouseDown', start)
  mouse('mouseMove', end)
  await frame()
  await key('Escape')
  mouse('mouseUp', end)
  await settle()
  assert.deepEqual(await savedOrder(), [b, a, d, c])
  assert.equal(await run("document.querySelector('.project-drag-preview') === null"), true)
  // The source and its indicated anchor must both remain in their original section.
  mouse('mouseDown', start)
  mouse('mouseMove', { ...end, y: end.y - 8 })
  await frame()
  assert.equal(await run("!!document.querySelector('.project-insertion-line:not([hidden])')"), true)
  const pins = [b, d].map((targetKey, i) => ({ kind: 'project', targetKey, pinnedAt: `2026-11-24T00:00:0${i}Z` }))
  await other(`window.navigationTest.preferences.replacePins(${JSON.stringify(pins)})`)
  await settle()
  assert.equal(await run("document.querySelector('.project-drag-preview') === null"), true)
  mouse('mouseUp', end)
  await settle()
  await context(row(b))
  assert.equal(await run("Array.from(document.querySelectorAll('[role=menuitem]')).find(item => item.textContent === '上移项目').getAttribute('aria-disabled')"), 'true')
  await selectItem('下移项目')
  assert.equal(await run(`document.activeElement === document.querySelector('${row(b)}')`), false, 'A pointer menu move does not force focus onto the folder')
  assert.deepEqual(await run("Array.from(document.querySelectorAll('.pinned-navigation > [data-project-sort-key]'), group => group.dataset.group)"), [d, b])
  assert.deepEqual(await other('window.navigationTest.preferences.get().then(snapshot => snapshot.pinnedProjectOrder)'), [d, b])
  assert.deepEqual(await savedOrder(), [b, a, d, c])
  await run("window.navigationTest.preferences.replacePins([])")
  await settle()
  // A tall first group can still be under the pointer while its insertion boundary is clipped.
  await run(`document.querySelector('.navigation-scroll').style.maxHeight = '200px'
    document.querySelector('[data-group="${b}"]').style.minHeight = '240px'
    document.querySelector('${row(c)}').scrollIntoView({ block: 'center' })`)
  const source = await point(row(c))
  mouse('mouseDown', source)
  mouse('mouseMove', { ...source, x: source.x + 10 })
  await frame()
  const clipped = await run(`(() => {
    const rail = document.querySelector('.navigation-scroll')
    const bounds = rail.getBoundingClientRect()
    rail.scrollTop += document.querySelector('[data-group="${b}"]').getBoundingClientRect().top - bounds.top + 30
    return { x: Math.round(bounds.left + 45), y: Math.round(bounds.top + 65) }
  })()`)
  mouse('mouseMove', clipped)
  await frame()
  assert.equal(await run("document.querySelector('.project-insertion-line')?.hidden"), true)
  mouse('mouseUp', clipped)
  await settle()
  assert.deepEqual(await savedOrder(), [b, a, d, c])
  await run("document.querySelector('.navigation-scroll').style.maxHeight = ''")
  await run('window.navigationTest.setFolderOrderFixture(false)')
  await settle()
}
