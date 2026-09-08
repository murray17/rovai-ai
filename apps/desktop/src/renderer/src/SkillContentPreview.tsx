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
      .request<SkillContentView>('skills.content.read', {
        ...JSON.parse(targetKey),
        path
      })
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
        <label className="capability-file-select">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6" />
          </svg>
          <select
            aria-label="Skill 预览文件"
            value={path}
            onChange={(event) => {
              setPath(event.target.value)
              setRaw(false)
            }}
          >
            {(files.length ? files : [{ path }]).map((file) => (
              <option key={file.path} value={file.path}>
                {file.path}
              </option>
            ))}
          </select>
          <svg
            className="capability-file-chevron"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </label>
        <div className="capability-view-modes" role="group" aria-label="Skill 预览方式">
          <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>
            阅读
          </button>
          <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>
            源码
          </button>
        </div>
      </div>
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
