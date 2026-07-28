export function localizeExecutionEngineTerms(value: string): string {
  return value
    .replaceAll('Adapter Installation', '执行引擎')
    .replaceAll('Agent Runtime', '执行引擎')
    .replaceAll('Runtime Adapter', '执行引擎适配器')
    .replaceAll('Runtime', '执行引擎')
    .replaceAll('Adapter', '适配器')
}
