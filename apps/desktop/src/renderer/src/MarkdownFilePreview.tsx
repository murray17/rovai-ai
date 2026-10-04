import { useId, useMemo, type ComponentProps } from 'react'
import { SafeMarkdown } from './SafeMarkdown'
import { parseMarkdownFrontMatter, type MarkdownFrontMatter } from './markdown-front-matter'
import { UiText } from './interface-language'

type MarkdownFilePreviewProps = Omit<ComponentProps<typeof SafeMarkdown>, 'children' | 'mode'> & {
  source: string
}

function MarkdownMetadata({ frontMatter }: { frontMatter: MarkdownFrontMatter }): React.JSX.Element {
  const captionId = useId()
  return (
    <section className="file-preview-metadata" aria-labelledby={captionId}>
      <div className="file-preview-metadata-caption" id={captionId}>Metadata</div>
      {frontMatter.kind === 'error' ? <>
        <p className="file-preview-metadata-warning">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 7.25v3.5M8 4.75v.1" />
          </svg>
          <span><UiText zh={"元数据格式有误，已保留原始文件头。"} /></span>
        </p>
        <pre className="file-preview-metadata-raw"><code>{frontMatter.raw}</code></pre>
      </> : (
        <dl className="file-preview-metadata-fields">
          {frontMatter.fields.map((field, index) => (
            <div className="file-preview-metadata-row" key={`${field.key}:${index}`}>
              <dt>{field.key}</dt>
              <dd><span className="file-preview-metadata-value">{field.value}</span></dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

export function MarkdownFilePreview({ source, ...markdownProps }: MarkdownFilePreviewProps): React.JSX.Element {
  const document = useMemo(() => parseMarkdownFrontMatter(source), [source])
  return (
    <div className="file-preview-markdown-document">
      {document.frontMatter && <MarkdownMetadata frontMatter={document.frontMatter} />}
      <SafeMarkdown {...markdownProps} mode="document">{document.body}</SafeMarkdown>
    </div>
  )
}
