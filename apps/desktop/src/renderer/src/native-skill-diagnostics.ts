import type { NativeSkillDiagnostic } from '@contracts'
import { uiAttribute } from './interface-language'

export function nativeSkillDiagnosticLabel(kind: NativeSkillDiagnostic['kind']): string {
  switch (kind) {
    case 'metadata': return uiAttribute('元数据异常')
    case 'file_read': return uiAttribute('文件读取失败')
    case 'directory_read': return uiAttribute('目录读取失败')
    case 'scan_truncated': return uiAttribute('扫描结果不完整')
  }
}

export function nativeSkillDiagnosticText(diagnostic: NativeSkillDiagnostic): string {
  return `${nativeSkillDiagnosticLabel(diagnostic.kind)} · ${diagnostic.path}\n${diagnostic.message}`
}
