import { contextBridge, ipcRenderer } from 'electron'
import type { CoreEvent, CoreMethod, LumenApi } from '@contracts'

const api: LumenApi = {
  request<T>(method: CoreMethod, params?: unknown): Promise<T> {
    return ipcRenderer.invoke('lumen:request', method, params) as Promise<T>
  },
  onEvent(listener: (event: CoreEvent) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, value: CoreEvent): void => listener(value)
    ipcRenderer.on('lumen:event', handler)
    return () => ipcRenderer.removeListener('lumen:event', handler)
  },
  selectProject() {
    return ipcRenderer.invoke('lumen:select-project')
  },
  selectRuntimeExecutable() {
    return ipcRenderer.invoke('lumen:select-runtime-executable')
  },
  revealTaskWorkspace(taskId: string) {
    return ipcRenderer.invoke('lumen:reveal-task-workspace', taskId)
  },
  exportDiagnostics() {
    return ipcRenderer.invoke('lumen:export-diagnostics')
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('lumen', api)
