import { useEffect, useState } from 'react'
import type { SkillContentRequest, SkillContentView } from '@contracts'
import { CapabilityError } from './CapabilityWorkspace'
import { SafeMarkdown } from './SafeMarkdown'
import { readErrorMessage } from './error-message'

export function skillReadingContent(content: string): string {
  return content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '')
}

export function SkillContentPreview({
  target
}: {
  target: SkillContentRequest
}): React.JSX.Element {
  const [path, setPath] = useState('SKILL.md')
  const [raw, setRaw] = useState(false)
  const [view, setView] = useState<SkillContentView | null>(null)
  const [files, setFiles] = useState<SkillContentView['files']>([])
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const targetKey = JSON.stringify(target)
  useEffect(() => {
    setFiles([])
  }, [targetKey])
  useEffect(() => {
    let cancelled = false
    setView(null)
    setError(null)
    void window.rovai
      .request<SkillContentView>('skills.content.read', { ...JSON.parse(targetKey), path })
      .then((next) => {
        if (!cancelled) {
          setView(next)
          setFiles(next.files)
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(readErrorMessage(reason))
      })
    return () => {
      cancelled = true
    }
  }, [targetKey, path, retry])
  return (
    <div className="skill-content-preview">
      <div className="capability-filebar">
        <code>{path}</code>
        <button
          type="button"
          className="quiet-button compact"
          aria-pressed={raw}
          onClick={() => setRaw((value) => !value)}
        >
          {raw ? '阅读视图' : '查看源码'}
        </button>
      </div>
      {files.length > 1 && (
        <details className="capability-files">
          <summary>文件 · {files.length}</summary>
          <div>
            {files.map((file) => (
              <button
                type="button"
                key={file.path}
                aria-pressed={path === file.path}
                onClick={() => {
                  setPath(file.path)
                  setRaw(false)
                }}
              >
                {file.path}
              </button>
            ))}
          </div>
        </details>
      )}
      <CapabilityError error={error} onRetry={() => setRetry((value) => value + 1)} />
      {!view && !error && (
        <div className="capability-empty" role="status">
          正在读取内容…
        </div>
      )}
      {view?.status === 'too_large' && (
        <p className="capability-note">该文件较大，暂不支持正文预览。</p>
      )}
      {view?.status === 'binary' && <p className="capability-note">该文件不是文本文件。</p>}
      {view?.content !== null &&
        view?.content !== undefined &&
        (raw || !/\.md$/iu.test(path) ? (
          <pre className="capability-source-code">{view.content}</pre>
        ) : (
          <SafeMarkdown className="capability-reading">
            {skillReadingContent(view.content)}
          </SafeMarkdown>
        ))}
    </div>
  )
}
