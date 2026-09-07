import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DialogControlIcon } from './AppDialog'
import { writeClipboardText } from './clipboard'
import { runtimeInstallGuide } from './runtime-install-guide'

function GuideLink({ href, children }: { href: string; children: ReactNode }): React.JSX.Element {
  return <a className="runtime-guide-link" href={href} target="_blank" rel="noopener noreferrer">{children}<span aria-hidden="true">↗</span></a>
}

function Command({ command, label }: { command: string; label: string }): React.JSX.Element {
  const [feedback, setFeedback] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const copy = async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    setFeedback(await writeClipboardText(command) ? '已复制' : '复制失败，请手动选择命令')
    timer.current = setTimeout(() => setFeedback(''), 2500)
  }
  return <div className="runtime-guide-command">
    <span aria-hidden="true">$</span><code>{command}</code>
    <button type="button" className="runtime-guide-copy" aria-label={`复制 ${label}`} onClick={() => void copy()}>
      {feedback === '已复制' ? '已复制' : feedback ? '复制失败' : '复制'}
    </button>
    <span className="sr-only" role="status">{feedback}</span>
  </div>
}

export function RuntimeInstallationGuide({ id, label, guide, mode, busy, checking, feedback, onCheck }: {
  id: string
  label: string
  guide: NonNullable<ReturnType<typeof runtimeInstallGuide>>
  mode: 'install' | 'login'
  busy: boolean
  checking: boolean
  feedback: ReactNode
  onCheck(): void
}): React.JSX.Element {
  const loginHint = guide.connectModel ? '输入 /connect 连接模型。' : '按提示完成账号登录。'
  return <div id={id} className="runtime-install-guide" role="region" aria-label={`${label} ${mode === 'install' ? '安装' : '登录'}指南`}>
    {mode === 'install' && guide.command ? <>
      <div className="runtime-guide-step">
        <span className="runtime-guide-number" aria-hidden="true">1</span>
        <div>
          <div className="runtime-guide-heading"><h3>在终端粘贴并运行</h3><GuideLink href={guide.docs}>官方文档</GuideLink></div>
          <Command command={guide.command} label={`${label} 安装命令`} />
          {guide.alternatives?.length ? <details className="runtime-guide-alternatives">
            <summary>其他安装方式<DialogControlIcon name="chevron" /></summary>
            {guide.alternatives.map(method => <div className="runtime-guide-alternative" key={method.name}>
              <div className="runtime-guide-heading"><span>{method.name}</span><GuideLink href={method.prerequisiteUrl}>{method.prerequisite}</GuideLink></div>
              <Command command={method.command} label={`${label} ${method.name} 安装命令`} />
            </div>)}
          </details> : null}
        </div>
      </div>
      <div className="runtime-guide-step">
        <span className="runtime-guide-number" aria-hidden="true">2</span>
        <div className="runtime-guide-login"><h3>{guide.connectModel ? '启动并连接模型' : '启动并登录'}</h3>
          {guide.launch && <Command command={guide.launch} label={`${label} 启动命令`} />}
          <p>{loginHint}</p>
        </div>
      </div>
    </> : <div className="runtime-guide-download">
      <div><h3>{mode === 'login' ? '已安装，完成登录后继续' : guide.desktop ? '下载并安装应用' : '按照官方说明安装'}</h3>
        <p>{mode === 'login' ? guide.launch ? loginHint : '请按照官方说明完成账号或模型配置。' : guide.desktop ? '选择适合你电脑的版本，安装后打开应用并登录。' : '安装并完成账号或模型配置后，回到这里检测。'}</p>
        {mode === 'login' && guide.launch && <Command command={guide.launch} label={`${label} 启动命令`} />}
      </div>
      <GuideLink href={guide.docs}>{mode === 'login' ? '登录帮助' : guide.desktop ? '前往官网下载' : '查看官方说明'}</GuideLink>
    </div>}
    {feedback}
    <div className="runtime-guide-footer"><p>完成后，回到这里检测。</p>
      <button type="button" className="primary-button" aria-disabled={busy} aria-busy={checking} onClick={() => { if (!busy) onCheck() }}>
        {checking ? '正在检测…' : mode === 'login' ? '我已登录，重新检测' : '我已安装，重新检测'}
      </button>
    </div>
  </div>
}
