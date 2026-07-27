import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppearanceSnapshot,
  CoreEvent,
  CoreMethod,
  RovaiApi,
  ThemePreference
} from '@contracts'

const api: RovaiApi = {
  request<T>(method: CoreMethod, params?: unknown): Promise<T> {
    return ipcRenderer.invoke('rovai:request', method, params) as Promise<T>
  },
  onEvent(listener: (event: CoreEvent) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, value: CoreEvent): void => listener(value)
    ipcRenderer.on('rovai:event', handler)
    return () => ipcRenderer.removeListener('rovai:event', handler)
  },
  appearance: {
    get() {
      return ipcRenderer.invoke('rovai:appearance-get') as Promise<AppearanceSnapshot>
    },
    setPreference(preference: ThemePreference) {
      return ipcRenderer.invoke('rovai:appearance-set', preference) as Promise<AppearanceSnapshot>
    },
    onChanged(listener: (snapshot: AppearanceSnapshot) => void): () => void {
      const handler = (
        _event: Electron.IpcRendererEvent,
        value: AppearanceSnapshot
      ): void => listener(value)
      ipcRenderer.on('rovai:appearance-changed', handler)
      return () => ipcRenderer.removeListener('rovai:appearance-changed', handler)
    }
  },
  selectProject() {
    return ipcRenderer.invoke('rovai:select-project')
  },
  selectRuntimeExecutable() {
    return ipcRenderer.invoke('rovai:select-runtime-executable')
  },
  selectSkillImportDirectory() {
    return ipcRenderer.invoke('rovai:select-skill-import-directory')
  },
  revealSkill(skillId: string) {
    return ipcRenderer.invoke('rovai:reveal-skill', skillId)
  },
  revealMcpConfig() {
    return ipcRenderer.invoke('rovai:reveal-mcp-config')
  },
  exportMemory() {
    return ipcRenderer.invoke('rovai:export-memory')
  },
  exportDiagnostics() {
    return ipcRenderer.invoke('rovai:export-diagnostics')
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('rovai', api)
