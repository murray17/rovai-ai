/** Prefer the filename over directory prefixes, retaining meaningful test/declaration extensions. */
export function ProjectFileReferenceLabel({ label, fileName }: { label: string; fileName: string }) {
  const prefix = label.endsWith(fileName) ? label.slice(0, -fileName.length) : ''
  const extension = fileName.match(/(?:\.(?:test|spec|d))?\.[^./]+$/u)?.[0] ?? ''
  const suffix = extension.length < fileName.length ? extension : ''
  return <span className="reference-token-label">
    {prefix && <span className="file-reference-directory">{prefix}</span>}
    <span className="file-reference-name"><span className="file-reference-stem">{suffix ? fileName.slice(0, -suffix.length) : fileName}</span>{suffix && <span className="file-reference-extension">{suffix}</span>}</span>
  </span>
}
