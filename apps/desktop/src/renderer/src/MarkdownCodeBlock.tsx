import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ResolvedTheme } from '@contracts'
import {
  highlightSourceCode,
  loadSourceLanguageForName,
  mountSourceSyntaxHighlightStyle
} from './source-preview'

interface LoadedLanguage {
  languageName: string
  support: Awaited<ReturnType<typeof loadSourceLanguageForName>>
}

export function MarkdownCodeBlock({
  code,
  languageName,
  theme
}: {
  code: string
  languageName?: string
  theme: ResolvedTheme
}): React.JSX.Element {
  const rootRef = useRef<HTMLPreElement>(null)
  const [loadedLanguage, setLoadedLanguage] = useState<LoadedLanguage | null>(null)
  const language = languageName && loadedLanguage?.languageName === languageName
    ? loadedLanguage.support
    : null

  useEffect(() => {
    if (!languageName) return undefined
    let active = true
    void loadSourceLanguageForName(languageName).then((support) => {
      if (active) setLoadedLanguage({ languageName, support })
    })
    return () => {
      active = false
    }
  }, [languageName])

  useLayoutEffect(() => {
    const root = rootRef.current?.ownerDocument
    if (root) mountSourceSyntaxHighlightStyle(theme, root)
  }, [theme])

  const highlighted = useMemo(
    () => language ? highlightSourceCode(code, language, theme) : [{ text: code }],
    [code, language, theme]
  )

  return (
    <pre ref={rootRef} className="markdown-code-block">
      <code data-code-language={languageName || undefined}>
        {highlighted.map((segment, index) => segment.className
          ? <span className={segment.className} key={`${index}:${segment.text.length}`}>{segment.text}</span>
          : segment.text)}
      </code>
    </pre>
  )
}
