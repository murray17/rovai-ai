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
    expect(buttons.slice(0, 3).map(button => (button.text as { content: string }).content)).toEqual(['A', 'A', 'Type something.'])
    expect(nodes(card).some(node => node.tag === 'input' || node.form_action_type === 'submit')).toBe(false)
    expect(item.interaction.questions[0].options.map(option => option.label)).toEqual(['A', 'A', 'Type something.'])
  })

  it('preserves native labels and shortens only long button text without changing answer IDs', () => {
    const item = source('select')
    const labels = ['A'.repeat(100), '长'.repeat(101), '🪴'.repeat(101), '3. 原生选项', '（四）保留原文', '重复选项', '重复选项']
    item.interaction.questions[0].options = labels.map((label, index) => ({ id: `native-option-${index}`, label }))
    const original = structuredClone(item), card = feishuNativeQuestionCard(item)
    const buttons = nodes(card).filter(node => node.tag === 'button').slice(0, labels.length)
    expect(buttons).toHaveLength(labels.length)
    const texts = buttons.map(button => (button.text as { content: string }).content)
    expect(texts[0]).toBe(labels[0])
    expect(texts[1]).toBe('长'.repeat(99) + '…')
    expect(texts[2]).toBe('🪴'.repeat(99) + '…')
    expect(texts.slice(3)).toEqual(labels.slice(3))
    expect(texts.every(text => Array.from(text).length <= 100)).toBe(true)
    expect(buttons.map(button => feishuNativeAnswer(action(button), null)!.answer)).toEqual(
      original.interaction.questions[0].options.map(option => ({ kind: 'select', optionId: option.id })))
    expect(item).toEqual(original)
    expect(JSON.stringify(card)).not.toContain('Rovai Desktop')
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

  it('falls back only when the card or text field cannot hold the question, with no invented timeout', () => {
    const manyOptions = source('select'), largeCard = source('select'), longPrefill = source('input')
    manyOptions.interaction.questions[0].options = Array.from({ length: 201 }, (_, index) => ({ id: String(index), label: `选项 ${index + 1}` }))
    largeCard.interaction.questions[0].description = '长'.repeat(9000)
    longPrefill.interaction.questions[0].prefill = '长'.repeat(1001)
    for (const item of [manyOptions, largeCard, longPrefill]) {
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

  it('keeps an ordinary selection and a later unrelated input as independent native questions', () => {
    const select = source('select')
    select.interaction.questions[0].options = [{ id: 'win', label: 'Windows' }, { id: 'mac', label: 'macOS' }]
    const selected = nodes(feishuNativeQuestionCard(select)).find(node => node.tag === 'button')!
    expect(feishuNativeAnswer(action(selected), null)).toMatchObject({ interactionId: 'question', answer: { kind: 'select', optionId: 'win' } })
    const input = source('input')
    input.interaction.id = 'project-name'
    input.interaction.questions[0].title = '项目名称'
    const card = feishuNativeQuestionCard(input)
    expect(nodes(card).some(node => node.content === 'Windows' || node.content === 'macOS')).toBe(false)
    expect(nodes(card).find(node => node.tag === 'input')).not.toHaveProperty('label')
    const submit = nodes(card).find(node => node.form_action_type === 'submit')!
    expect(feishuNativeAnswer(action(submit), { answer: '  示例项目  ' })).toMatchObject({ interactionId: 'project-name', answer: { kind: 'input', value: '  示例项目  ' } })
    const fields = JSON.parse(dingtalkNativeQuestionCard(input).form).fields
    expect(fields.find((field: { name: string }) => field.name === 'answer')).toMatchObject({ label: '项目名称', type: 'TEXT' })
    expect(fields.some((field: { type: string }) => field.type === 'CHECKBOX_GROUP')).toBe(false)
  })
})
