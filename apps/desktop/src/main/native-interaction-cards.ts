import { createHash } from 'node:crypto'
import type { NativeInteractionAnswer, NativeInteractionResult, NativeInteractionView } from '@contracts'
import { LarkChannelError, type LarkChannel } from '@larksuiteoapi/node-sdk'

export type NativeCardSource = { deliveryId: string; agentDisplayName: string; ownerUserId?: string | null; interaction: NativeInteractionView }
type CardAction = { deliveryId: string; interactionId: string; answer: NativeInteractionAnswer }
type ActionValue = { kind: 'native_interaction'; deliveryId: string; interactionId: string; answerKind: 'confirm' | 'select' | 'input' | 'skip'; confirmed?: boolean; optionId?: string }
export const DINGTALK_QUESTION_TEMPLATE_ID = 'c2a6355b-9724-4f7e-9653-d33fcb3311bb.schema'
export const DINGTALK_NATIVE_CARD_PREFIX = 'rovai_native_'
export function dingtalkNativeFailure(message: string): Record<string, unknown> {
  return { userPrivateData: { cardParamMap: { question_desc: message } }, cardUpdateOptions: { updatePrivateDataByKey: true } }
}
const DINGTALK_QUESTION_ACTION_PREFIX = 'rovai.native.v1.'
const ANSWER_FIELD = 'answer'
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
function parsedObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return object(value)
  try { return object(JSON.parse(value)) } catch { return null }
}
const plain = (content: string): Record<string, unknown> => ({ tag: 'plain_text', content })
const paragraph = (text: string): Record<string, unknown> => ({ tag: 'div', text: plain(text) })
const fallback = '问题内容超出渠道卡片的可用范围，请在 Rovai Desktop 或已登录的 Web 回答。'
const deadline = (source: NativeCardSource): string | null => source.interaction.expiresAt === null ? null
  : `截止时间：${new Date(source.interaction.expiresAt).toISOString().replace('T', ' ').replace('Z', ' UTC')}`
export function nativeCardResultText(result: NativeInteractionResult): string {
  if (result.alreadyHandled && (result.status === 'sent' || result.status === 'skipped')) return '已处理'
  return ({ sent: '已发送', skipped: '已跳过，未提交回答', expired: '回答期限已过', unavailable: '请求已失效',
    unknown: '提交结果待核对', failed: '提交失败，内容已保留', pending: '等待回答' })[result.status]
}
function actionValue(source: NativeCardSource, answer: NativeInteractionAnswer): ActionValue {
  return { kind: 'native_interaction', deliveryId: source.deliveryId, interactionId: source.interaction.id,
    answerKind: answer.kind, ...(answer.kind === 'confirm' ? { confirmed: answer.confirmed } : answer.kind === 'select' ? { optionId: answer.optionId } : {}) }
}
function feishuButton(source: NativeCardSource, text: string, answer: NativeInteractionAnswer, primary = false): Record<string, unknown> {
  return { tag: 'button', text: plain(text), type: primary ? 'primary' : 'default', width: 'fill',
    behaviors: [{ type: 'callback', value: actionValue(source, answer) }] }
}
function feishuShell(source: NativeCardSource, elements: Record<string, unknown>[]): Record<string, unknown> {
  return { schema: '2.0', config: { update_multi: true }, header: { title: plain(`${source.agentDisplayName} · Pi`), template: 'grey' }, body: { elements } }
}
export function feishuNativeResultCard(source: NativeCardSource, result: NativeInteractionResult): Record<string, unknown> {
  return feishuShell(source, [paragraph(nativeCardResultText(result))])
}

export function feishuNativeQuestionCard(source: NativeCardSource): Record<string, unknown> {
  const { interaction } = source
  if (interaction.status !== 'pending') return feishuNativeResultCard(source, { status: interaction.status })
  const question = interaction.questions[0]
  if (interaction.questions.length !== 1 || !question) return feishuShell(source, [paragraph(fallback)])
  const elements: Record<string, unknown>[] = [paragraph(question.title)]
  if (question.description !== null) elements.push(paragraph(question.description))
  const end = deadline(source)
  if (end) elements.push(paragraph(end))
  if (question.kind === 'confirm') {
    const buttons = [...(interaction.canSkip ? [feishuButton(source, '跳过', { kind: 'skip' })] : []),
      feishuButton(source, '否', { kind: 'confirm', confirmed: false }), feishuButton(source, '是', { kind: 'confirm', confirmed: true }, true)]
    elements.push({ tag: 'column_set', columns: buttons.map(button => ({ tag: 'column', width: 'weighted', weight: 1, elements: [button] })) })
  } else if (question.kind === 'select') {
    if (question.options.some(option => option.label.length === 0 || Array.from(option.label).length > 100)) return feishuShell(source, [paragraph(fallback)])
    elements.push(...question.options.map(option => feishuButton(source, option.label, { kind: 'select', optionId: option.id })))
    if (interaction.canSkip) elements.push(feishuButton(source, '跳过', { kind: 'skip' }))
  } else {
    if ([question.prefill, question.placeholder].some(text => text !== null && Array.from(text).length > 1000)) return feishuShell(source, [paragraph(fallback)])
    elements.push({ tag: 'form', name: 'native_answer', elements: [
      { tag: 'input', name: ANSWER_FIELD, input_type: question.multiline ? 'multiline_text' : 'text', required: false,
        max_length: 1000, ...(question.prefill === null ? {} : { default_value: question.prefill }),
        ...(question.placeholder === null ? {} : { placeholder: plain(question.placeholder) }), width: 'fill' },
      { ...feishuButton(source, '提交', { kind: 'input', value: '' }, true), name: 'submit_answer', form_action_type: 'submit' }
    ] })
    // A normal callback outside the form does not submit or reset its draft.
    if (interaction.canSkip) elements.push(feishuButton(source, '跳过', { kind: 'skip' }))
  }
  const card = feishuShell(source, elements)
  const count = (value: unknown): number => {
    if (Array.isArray(value)) return value.reduce((sum, item) => sum + count(item), 0)
    const record = object(value)
    return record ? (typeof record.tag === 'string' ? 1 : 0) + Object.values(record).reduce<number>((sum, item) => sum + count(item), 0) : 0
  }
  return Buffer.byteLength(JSON.stringify(card)) > 24_000 || count(card) > 200 ? feishuShell(source, [paragraph(fallback)]) : card
}

/** Missing/malformed fields are not an empty answer; an explicit "" is valid. */
export function feishuNativeAnswer(value: unknown, formValue: unknown): CardAction | null {
  const action = object(value)
  if (action?.kind !== 'native_interaction') return null
  if (typeof action.deliveryId !== 'string' || typeof action.interactionId !== 'string') throw new Error('native_answer_invalid')
  let answer: NativeInteractionAnswer
  if (action.answerKind === 'skip') answer = { kind: 'skip' }
  else if (action.answerKind === 'confirm' && typeof action.confirmed === 'boolean') answer = { kind: 'confirm', confirmed: action.confirmed }
  else if (action.answerKind === 'select' && typeof action.optionId === 'string') answer = { kind: 'select', optionId: action.optionId }
  else if (action.answerKind === 'input') {
    const fields = object(formValue)
    if (!fields || !Object.hasOwn(fields, ANSWER_FIELD) || typeof fields[ANSWER_FIELD] !== 'string') throw new Error('native_answer_missing_text')
    answer = { kind: 'input', value: fields[ANSWER_FIELD] }
  } else throw new Error('native_answer_invalid')
  return { deliveryId: action.deliveryId, interactionId: action.interactionId, answer }
}

export async function sendFeishuNativeQuestion(client: Pick<LarkChannel['rawClient']['im']['v1']['message'], 'create' | 'reply'>,
  input: { deliveryId: string; chatId: string; topicKey: string; card: Record<string, unknown> }): Promise<string> {
  const data = { msg_type: 'interactive', content: JSON.stringify(input.card),
    uuid: createHash('sha256').update(`native-question-v1\0${input.deliveryId}`).digest('hex').slice(0, 50) }
  const response = input.topicKey ? await client.reply({ path: { message_id: input.topicKey }, data: { ...data, reply_in_thread: true } })
    : await client.create({ params: { receive_id_type: 'chat_id' }, data: { ...data, receive_id: input.chatId } })
  if (response?.code !== 0 || !response.data?.message_id) throw new LarkChannelError('unknown', 'native_question_send_failed')
  return response.data.message_id
}

/** Official Form template: stable values, optional text and independent cancel callback. */
export function dingtalkNativeQuestionCard(source: NativeCardSource): Record<string, string> {
  const question = source.interaction.questions[0]
  const pending = source.interaction.status === 'pending'
  const supported = question && source.interaction.questions.length === 1 && source.interaction.canSkip
    && (question.prefill?.length ?? 0) <= 4000 && (question.placeholder?.length ?? 0) <= 200
    && question.title.length <= 500 && (question.description?.length ?? 0) <= 4000
    && question.options.length <= 30 && question.options.every(option => option.label.length <= 200)
  const metadata = { kind: 'native_interaction', deliveryId: source.deliveryId, interactionId: source.interaction.id, answerKind: question?.kind }
  const fields: Record<string, unknown>[] = []
  if (pending && supported) {
    if (question.description !== null) fields.push({ name: 'description', label: '说明', type: 'TEXT_AREA', readOnly: true, required: false, defaultValue: question.description })
    fields.push({ name: ANSWER_FIELD, label: question.title, required: question.kind !== 'input',
      type: question.kind === 'input' ? question.multiline ? 'TEXT_AREA' : 'TEXT' : 'CHECKBOX_GROUP',
      ...(question.kind === 'input' ? { defaultValue: question.prefill ?? '', ...(question.placeholder === null ? {} : { placeholder: question.placeholder }) }
        : { options: question.kind === 'confirm' ? [{ value: 'true', text: '是' }, { value: 'false', text: '否' }]
          : question.options.map(option => ({ value: option.id, text: option.label })) }) })
  }
  const params: Record<string, string> = {
    question_id: DINGTALK_QUESTION_ACTION_PREFIX + Buffer.from(JSON.stringify(metadata)).toString('base64url'),
    question_title: `${source.agentDisplayName} · Pi`,
    question_desc: pending ? supported ? deadline(source) ?? '' : fallback : nativeCardResultText({ status: source.interaction.status }),
    card_status: pending && supported ? 'pending' : 'submitted', form_btn_text: pending ? '提交' : nativeCardResultText({ status: source.interaction.status }),
    form: JSON.stringify({ fields })
  }
  if (Buffer.byteLength(JSON.stringify(params)) > 24_000) return { ...params, card_status: 'submitted', question_desc: fallback, form: '{"fields":[]}' }
  return params
}

export function dingtalkNativeAnswer(payload: unknown): CardAction | null {
  const envelope = object(payload)
  if (!envelope || typeof envelope.outTrackId !== 'string' || !envelope.outTrackId.startsWith(DINGTALK_NATIVE_CARD_PREFIX)) return null
  const content = parsedObject(envelope.content), privateData = parsedObject(content?.cardPrivateData)
  const ids = privateData?.actionIds, params = parsedObject(privateData?.params)
  if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== 'string' || !ids[0].startsWith(DINGTALK_QUESTION_ACTION_PREFIX) || !params) throw new Error('native_answer_invalid')
  const metadata = parsedObject(Buffer.from(ids[0].slice(DINGTALK_QUESTION_ACTION_PREFIX.length), 'base64url').toString('utf8'))
  if (!metadata || metadata.kind !== 'native_interaction') throw new Error('native_answer_invalid')
  if (params.user_cancel === true || params.user_cancel === 'true') return feishuNativeAnswer({ ...metadata, answerKind: 'skip' }, null)
  const form = parsedObject(params.form)
  if (!form || !Object.hasOwn(form, ANSWER_FIELD)) throw new Error('native_answer_missing_text')
  let value = form[ANSWER_FIELD]
  // Native single-choice lists may wrap the stable value; labels never determine an answer.
  if (metadata.answerKind !== 'input' && object(value)) value = object(value)!.value
  if (metadata.answerKind === 'input') return feishuNativeAnswer(metadata, { [ANSWER_FIELD]: value })
  if (metadata.answerKind === 'select' && typeof value === 'string') return feishuNativeAnswer({ ...metadata, optionId: value }, null)
  if (metadata.answerKind === 'confirm' && (value === 'true' || value === 'false')) return feishuNativeAnswer({ ...metadata, confirmed: value === 'true' }, null)
  throw new Error('native_answer_invalid')
}
