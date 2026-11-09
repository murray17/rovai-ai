/** Link text escaping; URI encoding and caller-specific whitespace rules stay separate. */
export function escapeReferenceLinkLabel(label: string): string {
  return label.replace(/[\\[\]`*_~<&|]/gu, '\\$&')
}
