import { useEffect, useRef, useState } from 'react'
import type { SkillContentRequest, SkillContentView } from '@contracts'
import { CapabilityError } from './CapabilityWorkspace'
import { SafeMarkdown } from './SafeMarkdown'
import { readErrorMessage } from './error-message'
import { SkillFileNavigation } from './SkillFileNavigation'

export function skillReadingContent(content: string): string {
  return content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '')
}

export function SkillContentPreview({
  target
}: {
  target: SkillContentRequest
}): React.JSX.Element {
  return <SkillContentPreviewSession key={JSON.stringify(target)} target={target} />
}

function SkillContentPreviewSession({ target }: { target: SkillContentRequest }): React.JSX.Element {
  const preview = useRef<HTMLDivElement>(null)
  const [path, setPath] = useState('SKILL.md')
  const [raw, setRaw] = useState(false)
  const [view, setView] = useState<SkillContentView | null>(null)
  const [files, setFiles] = useState<SkillContentView['files']>([])
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const targetKey = JSON.stringify(target)
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
    <div ref={preview} className="skill-content-preview">
      <SkillFileNavigation
        files={files}
        path={path}
        onSelect={(nextPath) => {
          if (nextPath !== path) {
            setView(null)
            setError(null)
            setPath(nextPath)
          }
          setRaw(false)
          preview.current?.closest('.capability-detail-scroll')?.scrollTo({ top: 0, behavior: 'instant' })
        }}
      >
        {/\.(?:md|markdown)$/iu.test(path) && (
          <div className="capability-view-modes" role="group" aria-label="Skill 预览方式">
            <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>
              阅读
            </button>
            <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>
              源码
            </button>
          </div>
        )}
      </SkillFileNavigation>
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
        (raw || !/\.(?:md|markdown)$/iu.test(path) ? (
          <pre className="capability-source-code">{view.content}</pre>
        ) : (
          <SafeMarkdown className="capability-reading">
            {skillReadingContent(view.content)}
          </SafeMarkdown>
        ))}
    </div>
  )
}
