export function localizeExecutionEngineTerms(value: string): string {
  return value
    .replaceAll('Adapter Installation', 'Agent 运行时')
    .replaceAll('Agent Runtime', 'Agent 运行时')
    .replaceAll('Runtime Adapter', 'Agent 运行时适配器')
    .replaceAll('Runtime', 'Agent 运行时')
    .replaceAll('Adapter', '适配器')
}
