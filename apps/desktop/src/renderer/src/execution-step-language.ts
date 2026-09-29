import {
  executionStepCurrentInstructionTitle,
  executionStepPublicTitle,
  type ExecutionStep
} from '../../shared/execution-presentation'
import { uiAttribute } from './interface-language'

type TranslateCopy = (chinese: string, ...values: Array<string | number>) => string

const appTitles: Readonly<Record<string, readonly string[]>> = {
  shell: ['终端操作'],
  file: ['阅读文件', '文件操作'],
  tool: ['Web 搜索', '工具调用'],
  runtime: ['Agent 运行'],
  unknown: ['系统活动']
}

export function fileOperationVerb(operation: NonNullable<ExecutionStep['fileOperation']>, t: TranslateCopy = uiAttribute): string {
  return operation.operationKind === 'read' ? t('阅读') : operation.changeKind === 'add' ? t('新增') : t('编辑')
}

export function localizedExecutionStepTitle(step: ExecutionStep, active = false, t: TranslateCopy = uiAttribute): string {
  const title = active ? executionStepCurrentInstructionTitle(step) : executionStepPublicTitle(step)
  // Commands and built-in names are Runtime evidence, not interface copy.
  if (step.detailOperationId || step.builtinOperation) return title
  if (step.shellReadSummary) return `${t('阅读')} ${step.shellReadSummary.displayPaths.join(t('，'))}`
  if (step.publicCommand) return title
  if (step.fileOperation) {
    const fileName = step.fileOperation.path.split(/[\\/]/u).filter(Boolean).at(-1) ?? step.fileOperation.path
    return `${fileOperationVerb(step.fileOperation, t)} ${fileName}`
  }
  return appTitles[step.activityDomain]?.includes(title) ? t(title) : title
}
