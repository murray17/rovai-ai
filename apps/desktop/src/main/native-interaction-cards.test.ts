import { describe, expect, it, vi } from 'vitest'
import { feishuNativeAnswer, feishuNativeQuestionCard, feishuNativeResultCard, nativeCardResultText, sendFeishuNativeQuestion,
  dingtalkNativeAnswer, dingtalkNativeQuestionCard, DINGTALK_NATIVE_CARD_PREFIX, type NativeCardSource } from './native-interaction-cards'

function source(kind: 'confirm' | 'select' | 'input', multiline = false): NativeCardSource {
  return { deliveryId: 'delivery', agentDisplayName: '爱丽丝', interaction: { id: 'question', agentRunId: 'run', executionEpoch: 4,
    createdAt: 10, expiresAt: null, status: 'pending', canSkip: true,
    questions: [{ id: 'question', kind, title: ' 原问题\n第二行 ', description: ' 原说明\n保留换行 ', placeholder: ' 原提示 ',
      prefill: '  初始\n中文  ', multiline, options: kind === 'select' ? [{ id: '0', label: 'A' }, { id: '1', label: 'A' }, { id: '2', label: 'Type something.' }] : [] }] } }
}
const nodes = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' ? [value as Record<string, unknown>, ...Object.values(value).flatMap(nodes)] : []
const action = (node: Record<string, unknown>) => (node.behaviors as Array<{ value: unknown }>)[0].value

describe('native channel question cards', () => {
  it('keeps confirmation no, yes and skip distinct without another confirmation', () => {
    const item = source('confirm'), card = feishuNativeQuestionCard(item)
    const buttons = nodes(card).filter(node => node.tag === 'button')
    expect(buttons).toHaveLength(3)
    expect(buttons.map(button => feishuNativeAnswer(action(button), { answer: 'unrelated draft' })!.answer)).toEqual([
      { kind: 'skip' }, { kind: 'confirm', confirmed: false }, { kind: 'confirm', confirmed: true }
    ])
    expect(nodes(card).some(node => 'confirm' in node || node.form_action_type === 'submit')).toBe(false)
    item.interaction.canSkip = false
    expect(nodes(feishuNativeQuestionCard(item)).filter(node => node.tag === 'button')).toHaveLength(2)
  })

  it('uses all stable option IDs even for duplicate labels and Type something.', () => {
    const item = source('select'), card = feishuNativeQuestionCard(item)
    const buttons = nodes(card).filter(node => node.tag === 'button')
    expect(buttons.slice(0, 3).map(button => feishuNativeAnswer(action(button), null)!.answer)).toEqual([
      { kind: 'select', optionId: '0' }, { kind: 'select', optionId: '1' }, { kind: 'select', optionId: '2' }
    ])
    expect(nodes(card).some(node => node.tag === 'input' || node.form_action_type === 'submit')).toBe(false)
    expect(item.interaction.questions[0].options.map(option => option.label)).toEqual(['A', 'A', 'Type something.'])
  })

  it.each([false, true])('preserves exact input and an independent skip callback (multiline=%s)', multiline => {
    const item = source('input', multiline), card = feishuNativeQuestionCard(item)
    const input = nodes(card).find(node => node.tag === 'input')!
    expect(input).toMatchObject({ input_type: multiline ? 'multiline_text' : 'text', required: false, default_value: '  初始\n中文  ' })
    expect(nodes(card).some(node => node.content === item.interaction.questions[0].title)).toBe(true)
    expect(nodes(card).some(node => node.content === item.interaction.questions[0].description)).toBe(true)
    const form = nodes(card).find(node => node.tag === 'form')!
    const submit = nodes(form).find(node => node.form_action_type === 'submit')!
    for (const value of ['', '  中文\n保留空格  ']) expect(feishuNativeAnswer(action(submit), { answer: value })!.answer).toEqual({ kind: 'input', value })
    for (const value of [null, {}, { answer: null }, { answer: 0 }]) expect(() => feishuNativeAnswer(action(submit), value)).toThrow()
    expect(nodes(form).filter(node => node.tag === 'button')).toHaveLength(1)
    const skip = nodes(card).find(node => node.tag === 'button' && (action(node) as { answerKind: string }).answerKind === 'skip')!
    expect(feishuNativeAnswer(action(skip), { answer: 'never submitted' })!.answer).toEqual({ kind: 'skip' })
  })

  it('falls back as a whole instead of truncating options or prefills, with no invented timeout', () => {
    for (const item of [source('select'), source('input')]) {
      if (item.interaction.questions[0].kind === 'select') item.interaction.questions[0].options[1].label = '长'.repeat(101)
      else item.interaction.questions[0].prefill = '长'.repeat(1001)
      const original = structuredClone(item)
      const card = feishuNativeQuestionCard(item)
      expect(nodes(card).some(node => typeof node.content === 'string' && node.content.includes('Rovai Desktop'))).toBe(true)
      expect(nodes(card).filter(node => node.tag === 'button' || node.tag === 'input')).toHaveLength(0)
      expect(item).toEqual(original)
    }
    expect(JSON.stringify(feishuNativeQuestionCard(source('input')))).not.toContain('截止时间')
    const timed = source('input'); timed.interaction.expiresAt = 1_800_000_000_000
    expect(JSON.stringify(feishuNativeQuestionCard(timed))).toContain('截止时间')
    expect(JSON.stringify(feishuNativeResultCard(timed, { status: 'sent', alreadyHandled: true }))).toContain('已处理')
    expect(nativeCardResultText({ status: 'unknown', alreadyHandled: true })).toBe('提交结果待核对')
    expect(nativeCardResultText({ status: 'expired', alreadyHandled: true })).toBe('回答期限已过')
    expect(nodes(feishuNativeResultCard(timed, { status: 'unknown' })).some(node => node.tag === 'input' || node.tag === 'button')).toBe(false)
  })

  it('reuses a delivery UUID on response loss and preserves the original topic routing', async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValue({ code: 0, data: { message_id: 'card' } })
    const reply = vi.fn().mockResolvedValue({ code: 0, data: { message_id: 'topic-card' } })
    const client = { create, reply }, input = { deliveryId: 'delivery', chatId: 'chat', topicKey: '', card: feishuNativeQuestionCard(source('input')) }
    await expect(sendFeishuNativeQuestion(client, input)).rejects.toThrow()
    await expect(sendFeishuNativeQuestion(client, input)).resolves.toBe('card')
    expect(create.mock.calls[0][0].data.uuid).toBe(create.mock.calls[1][0].data.uuid)
    await expect(sendFeishuNativeQuestion(client, { ...input, topicKey: 'topic' })).resolves.toBe('topic-card')
    expect(reply.mock.calls[0][0]).toMatchObject({ path: { message_id: 'topic' }, data: { reply_in_thread: true } })
  })

  it('uses native DingTalk form values without trimming or turning cancel into an answer', () => {
    for (const kind of ['input', 'select', 'confirm'] as const) {
      const item = source(kind), params = dingtalkNativeQuestionCard(item)
      if (kind !== 'input') expect(JSON.parse(params.form).fields.find((field: { name: string }) => field.name === 'answer').type).toBe('CHECKBOX_GROUP')
      const send = (values: Record<string, unknown>) => dingtalkNativeAnswer({ outTrackId: DINGTALK_NATIVE_CARD_PREFIX + item.deliveryId,
        content: JSON.stringify({ cardPrivateData: { actionIds: [params.question_id], params: values } }) })
      expect(send({ user_cancel: 'true', form: { answer: 'must not be forwarded' } })!.answer).toEqual({ kind: 'skip' })
      expect(send({ form: { answer: kind === 'input' ? '' : kind === 'select' ? { value: '2', text: 'ignored label' } : 'false' } })!.answer)
        .toEqual(kind === 'input' ? { kind: 'input', value: '' } : kind === 'select' ? { kind: 'select', optionId: '2' } : { kind: 'confirm', confirmed: false })
      expect(() => send({ form: {} })).toThrow()
    }
    const item = source('input', true), form = JSON.parse(dingtalkNativeQuestionCard(item).form)
    expect(form.fields.find((field: { name: string }) => field.name === 'answer')).toMatchObject({ type: 'TEXT_AREA', required: false, defaultValue: '  初始\n中文  ' })
  })

  it('renders the real follow-up input beside its original selected option without guessing English labels', () => {
    const item = source('input')
    item.interaction.selection = { options: [{ id: 'win', label: 'Windows' }, { id: 'custom', label: '自行填写（本地化）' }], optionId: 'custom' }
    const card = feishuNativeQuestionCard(item)
    const input = nodes(card).find(node => node.tag === 'input')!
    expect(input).toMatchObject({ label: { content: '自行填写（本地化）' }, label_position: 'left', name: 'answer' })
    expect(nodes(card).some(node => node.content === 'Windows')).toBe(true)
    expect(nodes(card).some(node => node.content === item.interaction.questions[0].title)).toBe(true)
    const submit = nodes(card).find(node => node.form_action_type === 'submit')!
    expect(feishuNativeAnswer(action(submit), { answer: '  原文  ' })).toMatchObject({ interactionId: item.interaction.id, answer: { kind: 'input', value: '  原文  ' } })
    const fields = JSON.parse(dingtalkNativeQuestionCard(item).form).fields
    expect(fields.find((field: { name: string }) => field.name === 'selection')).toMatchObject({ type: 'CHECKBOX_GROUP', readOnly: true, defaultValue: { value: 'custom' } })
    expect(fields.find((field: { name: string }) => field.name === 'answer')).toMatchObject({ type: 'TEXT', label: '自行填写（本地化）', required: false })
    item.interaction.questions[0].title = '原生输入问题\nWindows\n请填写回答'
    expect(nodes(feishuNativeQuestionCard(item)).filter(node => node.content === 'Windows')).toHaveLength(0)
    const repeatedFields = JSON.parse(dingtalkNativeQuestionCard(item).form).fields
    expect(repeatedFields.some((field: { name: string }) => field.name === 'selection')).toBe(false)
    expect(repeatedFields.find((field: { name: string }) => field.name === 'answer').label).toBe(item.interaction.questions[0].title)
  })
})
