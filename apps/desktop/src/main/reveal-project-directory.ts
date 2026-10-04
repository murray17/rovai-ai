import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

/** Reveal the root itself in its parent folder, matching Finder's Reveal action. */
export async function revealProjectDirectory(
  projectPath: unknown,
  reveal: (path: string) => void,
  inspect: (path: string) => Promise<{ isDirectory(): boolean }> = stat
): Promise<void> {
  if (typeof projectPath !== 'string' || !isAbsolute(projectPath) || projectPath.includes('\0')) {
    throw new Error('项目目录无效。')
  }
  try {
    if (!(await inspect(projectPath)).isDirectory()) throw new Error('Not a directory')
  } catch {
    throw new Error('项目目录已不可用，请重新选择工作目录。')
  }
  reveal(projectPath)
}
