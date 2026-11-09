export function skillReadingContent(content: string): string {
  const text = content.replace(/^\uFEFF/u, '')
  const lines = text.match(/[^\n]*\n|[^\n]+$/gu) ?? []
  if (lines[0]?.replace(/[\r\n]+$/u, '') !== '---') return text
  let offset = lines[0].length
  for (const line of lines.slice(1)) {
    offset += line.length
    if (line.replace(/[\r\n]+$/u, '') === '---') return text.slice(offset)
  }
  // An unclosed header has no reliable body boundary; keep the document visible.
  return text
}
