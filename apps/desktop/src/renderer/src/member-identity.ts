export function firstGrapheme(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '·'
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const first = segmenter.segment(trimmed)[Symbol.iterator]().next()
  return first.done ? '·' : first.value.segment
}
