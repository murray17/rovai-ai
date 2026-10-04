import type { ThreadClient } from './camp-client'

/** Lazy Desktop-only compatibility adapter; importing it never accesses Electron. */
export const desktopThreadClient: ThreadClient = {
  exportMonitoring: async filter => { const path = await window.rovai.exportMonitoring(filter); return { exported: Boolean(path), ...(path ? { path } : {}) } },
  revealMonitoringExport: path => window.rovai.revealMonitoringExport(path),
  exportDiagnostics: async () => { const path = await window.rovai.exportDiagnostics(); return { exported: Boolean(path), ...(path ? { path } : {}) } },
  revealDiagnosticsExport: path => window.rovai.revealDiagnosticsExport(path),
  get memberAvatars() { return window.rovai.memberAvatars },
  selectSkillImportDirectory: () => window.rovai.selectSkillImportDirectory(),
  selectRuntimeExecutable: () => window.rovai.selectRuntimeExecutable(),
  revealMcpConfig: () => window.rovai.revealMcpConfig(),
  channels: {
    get: () => window.rovai.channels.get(), onChanged: listener => window.rovai.channels.onChanged(listener),
    publishMemberBot: (agentId, kind) => window.rovai.channels.publishMemberBot(agentId, kind),
    retryMemberBot: (agentId, kind) => window.rovai.channels.retryMemberBot(agentId, kind),
    selectPublicationApprover: (agentId, userId, kind) => window.rovai.channels.selectPublicationApprover(agentId, userId, kind),
    native: {
      connect: kind => window.rovai.channels.connect(kind), disconnect: kind => window.rovai.channels.disconnect(kind),
      cancelQrAttempt: id => window.rovai.channels.cancelQrAttempt(id), refreshLoginQr: id => window.rovai.channels.refreshLoginQr(id)
    }
  },
  request: (method, params) => window.rovai.request(method, params),
  onEvent: (listener) => window.rovai.onEvent(listener),
  onClosePreviewRequested: listener => window.rovai.windowControls.onCloseTabRequested(listener),
  get singleChatAttachments() { return window.rovai.singleChatAttachments },
  get missionAttachments() { return window.rovai.missionAttachments },
  get composerAttachments() { return window.rovai.composerAttachments },
  attachmentLocation: async locator => {
    if (locator.owner === 'composer') {
      const path = await window.rovai.composerAttachments.location?.(locator)
      return path ? { path, location: 'local' } : null
    }
    const path = await window.rovai.request<string | null>('thread.attachments.location', locator)
    return path ? { path, location: 'local' } : null
  },
  attachments: { kind: 'native',
    open: locator => window.rovai.attachments.open(locator),
    reveal: locator => window.rovai.attachments.reveal(locator)
  },
  get platform() { return window.rovai.platform }
}
