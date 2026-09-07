import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RuntimeInstallationGuide } from './RuntimeInstallationGuide'
import { runtimeInstallGuide } from './runtime-install-guide'
import type { AdapterKind, HostPlatformKey } from '@contracts'

function render(kind: AdapterKind, platform: HostPlatformKey, mode: 'install' | 'login' = 'install'): string {
  return renderToStaticMarkup(createElement(RuntimeInstallationGuide, {
    id: 'guide', label: kind, guide: runtimeInstallGuide(kind, platform)!, mode,
    busy: false, checking: false, feedback: null, onCheck() {}
  }))
}

describe('Runtime installation guidance', () => {
  it.each(['claude-code-cli', 'codex-cli', 'opencode-cli'] as const)('provides installation and launch steps for %s on macOS', kind => {
    const markup = render(kind, 'macos-arm64')
    expect(markup).toContain('在终端粘贴并运行')
    expect(markup).toContain('其他安装方式')
    expect(markup).toContain('我已安装，重新检测')
    expect(markup).toContain(`复制 ${kind} 启动命令`)
    expect(markup).toContain('rel="noopener noreferrer"')
    expect(markup).not.toContain('<details class="runtime-guide-alternatives" open')
  })

  it('uses official instructions without macOS commands on Windows', () => {
    const markup = render('codex-cli', 'windows-x64')
    expect(markup).toContain('查看官方说明')
    expect(markup).not.toContain('curl')
    expect(markup).not.toContain('brew')
    expect(markup).not.toContain('runtime-guide-command')
  })

  it('keeps login recovery separate from reinstalling', () => {
    const markup = render('opencode-cli', 'macos-x64', 'login')
    expect(markup).toContain('/connect')
    expect(markup).toContain('我已登录，重新检测')
    expect(markup).not.toContain('curl')
    expect(markup).not.toContain('其他安装方式')
  })

  it('links a desktop Runtime to its download page', () => {
    expect(render('antigravity-app', 'macos-arm64')).toContain('前往官网下载')
    expect(runtimeInstallGuide('cursor-agent', 'macos-arm64')).toBeNull()
  })
})
