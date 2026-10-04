import { translateUi, useInterfaceLanguage } from './interface-language'

// Contextual labels for the current Thread header and detail panels.
const campDetailCopy = {
  'zh-CN': {
    tasks: '任务',
    members: '队员',
    singleChat: '单聊',
    singleChatTitle: '单聊'
  },
  en: {
    tasks: 'Tasks',
    members: 'Team',
    singleChat: 'DMs',
    singleChatTitle: 'Direct messages'
  }
}

export function useThreadDetailCopy(): typeof campDetailCopy['zh-CN'] & { execution: string } {
  const language = useInterfaceLanguage()
  return { ...campDetailCopy[language], execution: translateUi(language, '执行') }
}
