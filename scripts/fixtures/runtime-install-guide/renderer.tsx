import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AdapterKind, HealthStatus, ProductRuntimeAvailability } from '@contracts'
import { RuntimeInstallationsPanel } from '../../../apps/desktop/src/renderer/src/MemberManagement'
import '../../../apps/desktop/src/renderer/src/styles.css'

const kinds: AdapterKind[] = ['claude-code-cli', 'codex-cli', 'opencode-cli', 'copilot-cli', 'kiro-cli', 'qoder-cli', 'codebuddy-cli', 'qwen-code', 'trae-cn-cli', 'kimi-code-cli', 'grok-build', 'antigravity-app', 'pi']
const calls: string[] = []
let nextResult = 'missing'
let platform: HealthStatus['hostPlatform'] = 'macos-arm64'
let admitted = true
const availability = new Map(kinds.map(kind => [kind, snapshot(kind, kind === 'copilot-cli' ? 'ready' : 'missing')]))

function snapshot(runtimeKind: AdapterKind, status: ProductRuntimeAvailability['status']): ProductRuntimeAvailability {
  return { runtimeKind, status, checking: false, installationId: null,
    discovery: { runtimeKind, discoveryStatus: status === 'missing' ? 'missing' : 'found', executablePath: null,
      source: null, reportedVersion: null, executableFingerprint: null, searchPathSource: null, entrypointKind: null,
      candidateExtension: null, resolvedNativeTarget: false, versionProbeSucceeded: null, searchGeneration: 1,
      observedAt: '2026-09-07T00:00:00Z', diagnosticCode: null },
    reportedVersion: status === 'ready' ? '1.0.0' : null, diagnosticCode: null,
    failure: status === 'needs_attention' ? { runtimeKind, origin: 'environment', phase: 'spawn', code: 'fixture.failure',
      summary: '测试：本机运行环境暂时不可用', detail: '请在终端确认该程序可以正常启动。', retryable: true } : null }
}
function health(): HealthStatus {
  return {
    core: { ok: true, version: 'fixture', dataDir: '/tmp/rovai-runtime-install-guide-fixture' },
    database: { ok: true, path: '/tmp/rovai-runtime-install-guide-fixture/unused.db' },
    git: { installed: true, version: 'fixture' }, hostPlatform: platform, runtimeCatalog: [],
    runtimePlatformAdmission: kinds.map(runtimeKind => ({ runtimeKind, platform, status: admitted ? 'qualified' : 'not_qualified', reasonCode: admitted ? null : 'runtime_platform.qualification_evidence_missing', evidenceRevision: admitted ? 'fixture' : null })),
    runtimeAvailability: [...availability.values()],
    searchEnvironment: { generation: 1, createdAt: '2026-09-07T00:00:00Z', pathEntryCount: 0,
      shell: { status: 'captured', interactive: true, shellName: 'fixture', entryCount: 0, elapsedMillis: 0 } }
  }
}
window.rovai = {
  clipboard: { async write({ text }: { text: string }) { calls.push(`copy: ${text}`); await navigator.clipboard.writeText(text) } },
  async request(method: string, args: { runtimeKind?: AdapterKind } = {}) {
    calls.push(`${method}${args.runtimeKind ? `: ${args.runtimeKind}` : ''}`)
    await new Promise(resolve => setTimeout(resolve, 900))
    if (nextResult === 'rpc-error') throw new Error('测试：检测请求失败，请重试')
    if (method === 'runtime.discovery.rescan') return {}
    if (method === 'runtime.product.check' && args.runtimeKind) {
      availability.set(args.runtimeKind, snapshot(args.runtimeKind, nextResult as ProductRuntimeAvailability['status']))
      return { scheduled: true, completed: true, runtimeKind: args.runtimeKind, ready: nextResult === 'ready',
        outcome: nextResult === 'ready' ? 'ready' : 'stable_failure', status: nextResult === 'ready' ? 'ready' : 'stable_failure' }
    }
    throw new Error(`Unexpected fixture request: ${method}`)
  }
} as unknown as Window['rovai']

function Fixture(): React.JSX.Element {
  const [current, setCurrent] = useState(health)
  const [generation, setGeneration] = useState(0)
  const [log, setLog] = useState('')
  return <>
    <main className="settings-content" style={{ height: 'calc(100dvh - 46px)' }}>
      <div className="settings-panel settings-panel-runtime">
        <RuntimeInstallationsPanel key={generation} health={current} installations={[]} onReload={async () => { setCurrent(health()); setLog(calls.join('\n')) }} />
      </div>
    </main>
    <aside style={{ height: 46, display: 'flex', alignItems: 'center', gap: 16, padding: '0 24px', background: 'var(--rail)', borderTop: '1px solid var(--line)', fontSize: 11 }}>
      <strong>Renderer 验收</strong>
      <label>检测结果 <select aria-label="检测结果" onChange={event => { nextResult = event.target.value }}>
        <option value="missing">仍未安装</option><option value="authentication_required">需要登录</option><option value="ready">可用</option><option value="needs_attention">运行环境错误</option><option value="rpc-error">请求失败</option>
      </select></label>
      <label>平台 <select aria-label="平台" onChange={event => { platform = event.target.value === 'mac' ? 'macos-arm64' : 'windows-x64'; admitted = event.target.value !== 'windows-blocked'; setCurrent(health()); setGeneration(value => value + 1) }}>
        <option value="mac">macOS</option><option value="windows-blocked">Windows 未验证</option><option value="windows-admitted">Windows 已准入夹具</option>
      </select></label>
      <button className="quiet-button" onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'night' ? 'day' : 'night' }}>切换主题</button>
      <button className="quiet-button" onClick={() => setLog(calls.join('\n'))}>验收记录</button>
    </aside>
    {log && <pre aria-label="验收记录" style={{ position: 'fixed', bottom: 50, right: 12, maxWidth: '90vw', maxHeight: 120, overflow: 'auto', padding: 12, background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 11 }} onClick={() => setLog('')}>{log}</pre>}
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
