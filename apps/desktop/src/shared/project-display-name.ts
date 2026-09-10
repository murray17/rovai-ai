export const PROJECT_DISPLAY_NAME_MAX_LENGTH = 80

export function normalizeProjectDisplayName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ')
}

export function projectDisplayNameError(name: string): string | null {
  const normalized = normalizeProjectDisplayName(name)
  if (!normalized) return '请输入项目名称。'
  return Array.from(normalized).length > PROJECT_DISPLAY_NAME_MAX_LENGTH
    ? `项目名称最多 ${PROJECT_DISPLAY_NAME_MAX_LENGTH} 个字符。`
    : null
}

export function projectDirectoryName(projectPath: string): string {
  return projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? projectPath
}
