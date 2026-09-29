import { getInterfaceLanguage } from './interface-language'

export function localizeExecutionEngineTerms(value: string): string {
  if (getInterfaceLanguage() === 'en') return value
  return value
    .replaceAll('Adapter Installation', '智能体')
    .replaceAll('Agent Runtime', '智能体')
    .replaceAll('Runtime Adapter', '智能体适配器')
    .replaceAll('Runtime', '智能体')
    .replaceAll('Adapter', '适配器')
}
