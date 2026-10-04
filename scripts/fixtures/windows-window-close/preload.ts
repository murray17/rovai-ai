import { contextBridge, ipcRenderer } from 'electron'
import { createWindowCloseApi } from '../../../apps/desktop/src/preload/window-close-api'
// Exercise the Windows capability through a real isolated contextBridge on every host.
contextBridge.exposeInMainWorld('closeTestApi', createWindowCloseApi(ipcRenderer, 'win32'))
