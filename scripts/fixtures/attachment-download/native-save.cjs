const assert = require('node:assert/strict')
const { mkdir, readFile, writeFile } = require('node:fs/promises')
const { isAbsolute, join } = require('node:path')
const { app, BrowserWindow, dialog } = require('electron')
const [bundle, userData, root] = process.argv.slice(2)
assert.equal(process.platform, 'linux')
assert.ok([bundle, userData, root].every(isAbsolute))
app.setPath('userData', userData)
app.setPath('sessionData', join(userData, 'session'))
app.commandLine.appendSwitch('gtk-version', '3')
app.commandLine.appendSwitch('xdg-portal-required-version', '999')
const { attachmentSaveDialogOptions, saveDesktopAttachment } = require(bundle)
const source = join(root, 'source.txt')
const destination = join(root, 'edited.txt')
const original = 'User-edited destination: must survive cancellation.\n'
const copied = 'Current source bytes after native confirmation.\n'
const status = value => writeFile(join(root, 'status.json'), JSON.stringify(value))

app.whenReady().then(async () => {
  await mkdir(root, { recursive: true })
  const window = new BrowserWindow({ width: 720, height: 480, title: 'Attachment save acceptance',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadURL('data:text/html,<p>Isolated native attachment save acceptance</p>')
  let resolveCalls = 0
  const cases = []
  for (const scenario of ['cancel', 'confirm']) {
    await writeFile(source, 'Initial source bytes.\n')
    await writeFile(destination, original)
    const result = await saveDesktopAttachment(async () => {
      resolveCalls++
      return { target: { attachmentId: 'native-fixture', displayName: 'edited.txt', kind: 'file', mediaType: 'text/plain',
        path: source, openRisk: 'normal', canShowPath: true }, availability: 'available' }
    }, async name => {
      const options = attachmentSaveDialogOptions(root, name)
      assert.ok(options.properties.includes('showOverwriteConfirmation'))
      await status({ scenario, phase: 'dialog-open' })
      const selected = await dialog.showSaveDialog(window, { ...options, title: 'Attachment save overwrite acceptance' })
      await status({ scenario, phase: 'dialog-closed', canceled: selected.canceled })
      if (selected.canceled) return null
      assert.equal(selected.filePath, destination)
      await writeFile(source, copied)
      return selected.filePath
    })
    if (scenario === 'cancel') {
      assert.deepEqual(result, { saved: false, error: null, availability: 'available' })
      assert.equal(await readFile(destination, 'utf8'), original)
    } else {
      assert.deepEqual(result, { saved: true, error: null, availability: 'available' })
      assert.equal(await readFile(destination, 'utf8'), copied)
    }
    cases.push({ scenario, result })
  }
  assert.equal(resolveCalls, 3)
  const report = { commit: process.env.GITHUB_SHA ?? null, platform: process.platform, electron: process.versions.electron,
    backend: 'GTK 3; forced portal fallback', cases, resolveCalls }
  await writeFile(join(root, 'native-report.json'), JSON.stringify(report, null, 2))
  await status({ phase: 'done' })
  console.log(JSON.stringify(report))
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
