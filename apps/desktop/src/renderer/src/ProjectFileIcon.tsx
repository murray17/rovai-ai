import { FileIcon } from '@react-symbols/icons/utils'
import './project-file-icon.css'

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
