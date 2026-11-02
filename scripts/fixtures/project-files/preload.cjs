const { contextBridge, ipcRenderer } = require('electron')
const files = Object.fromEntries(['bindThread','open','restore','reopen','readEditableFile','saveTextFile','readText','readPage','resolveLine','readBinary','prepareHtmlSite','releaseHtmlSite','prepareHtml','reload','release','openInSystem','revealInFolder','copyPath','chooseAuthorizedRoot'].map(action => [action, request => ipcRenderer.invoke('files', action, request)]))
files.projectFiles = { request: request => ipcRenderer.invoke('project-files', request) }
files.onExternalUpdate = listener => { const handler = (_event, value) => listener(value); ipcRenderer.on('file-update', handler); return () => ipcRenderer.removeListener('file-update', handler) }
contextBridge.exposeInMainWorld('fixtureApi', { files, platform: process.platform, thread: () => ipcRenderer.invoke('thread') })
