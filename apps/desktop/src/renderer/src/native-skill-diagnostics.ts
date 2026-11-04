import type { NativeSkillDiagnostic } from '@contracts'
import { uiAttribute } from './interface-language'

/** A readable document whose metadata fell back; it belongs only to that Skill's details. */
export function isNativeSkillMetadataFallback(diagnostic: NativeSkillDiagnostic): boolean {
  return diagnostic.kind === 'metadata' && Boolean(diagnostic.skillId)
}

export function nativeSkillDiagnosticLabel(diagnostic: NativeSkillDiagnostic): string {
  switch (diagnostic.kind) {
    // Metadata without a Skill is the native disable configuration.
    case 'metadata': return uiAttribute(diagnostic.skillId ? '元数据异常' : '禁用配置无法解析')
    case 'file_read': return uiAttribute('文件读取失败')
    case 'directory_read': return uiAttribute('目录读取失败')
    case 'scan_truncated': return uiAttribute('扫描结果不完整')
  }
}

export function nativeSkillDiagnosticText(diagnostic: NativeSkillDiagnostic): string {
  return `${nativeSkillDiagnosticLabel(diagnostic)} · ${diagnostic.path}\n${diagnostic.message}`
}

/** Composer catalog notices exclude recovered document metadata; it does not block selection. */
export function nativeSkillCatalogNotices(diagnostics: readonly NativeSkillDiagnostic[]): string[] {
  return diagnostics.filter((diagnostic) => !isNativeSkillMetadataFallback(diagnostic)).map(nativeSkillDiagnosticText)
}
