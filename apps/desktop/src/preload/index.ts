import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppearanceSnapshot,
  CoreEvent,
  CoreMethod,
  LumenApi,
  ThemePreference
} from '@contracts'

const api: LumenApi = {
  request<T>(method: CoreMethod, params?: unknown): Promise<T> {
    return ipcRenderer.invoke('lumen:request', method, params) as Promise<T>
  },
  onEvent(listener: (event: CoreEvent) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, value: CoreEvent): void => listener(value)
    ipcRenderer.on('lumen:event', handler)
    return () => ipcRenderer.removeListener('lumen:event', handler)
  },
  appearance: {
    get() {
      return ipcRenderer.invoke('lumen:appearance-get') as Promise<AppearanceSnapshot>
    },
    setPreference(preference: ThemePreference) {
      return ipcRenderer.invoke('lumen:appearance-set', preference) as Promise<AppearanceSnapshot>
    },
    onChanged(listener: (snapshot: AppearanceSnapshot) => void): () => void {
      const handler = (
        _event: Electron.IpcRendererEvent,
        value: AppearanceSnapshot
      ): void => listener(value)
      ipcRenderer.on('lumen:appearance-changed', handler)
      return () => ipcRenderer.removeListener('lumen:appearance-changed', handler)
    }
  },
  selectProject() {
    return ipcRenderer.invoke('lumen:select-project')
  },
  selectRuntimeExecutable() {
    return ipcRenderer.invoke('lumen:select-runtime-executable')
  },
  selectSkillImportDirectory() {
    return ipcRenderer.invoke('lumen:select-skill-import-directory')
  },
  revealSkill(skillId: string) {
    return ipcRenderer.invoke('lumen:reveal-skill', skillId)
  },
  revealMcpConfig() {
    return ipcRenderer.invoke('lumen:reveal-mcp-config')
  },
  exportDiagnostics() {
    return ipcRenderer.invoke('lumen:export-diagnostics')
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('lumen', api)
