import { FileIcon } from '@react-symbols/icons/utils'
import './project-file-icon.css'

export function DirectoryTreeIcon({ className }: { className?: string }): React.JSX.Element {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M4 7v10M4 7h5M4 17h5"/><rect x="9" y="4" width="11" height="6" rx="1.5"/><rect x="9" y="14" width="11" height="6" rx="1.5"/></svg>
}

/** Filename-based visual shared by the directory, search results and current-file tabs. */
export function ProjectFileIcon({ fileName }: { fileName: string }): React.JSX.Element {
  return <FileIcon
    fileName={fileName}
    autoAssign={false}
    width={16}
    height={16}
    className="project-file-icon"
    aria-hidden="true"
    focusable="false"
  />
}
