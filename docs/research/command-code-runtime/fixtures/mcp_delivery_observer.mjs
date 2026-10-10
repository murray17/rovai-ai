// Evidence only: never persist headers, endpoints, message text or tool arguments.
import { createHash } from 'node:crypto';

export const targetName = 'mcp__rovai_delivery64__issue_receipt';
export const digest = value => createHash('sha256').update(
  typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value),
).digest('hex');
export const receipts = value => [...new Set(String(value).match(/RCP_[0-9a-f-]{36}/g) ?? [])];
const name = value => typeof value === 'string' && /^[\w.-]{1,160}$/.test(value) ? value : '[redacted]';

export function requestEvidence(body) {
  const tools = (body.tools ?? []).map(entry => {
    const fn = entry.function ?? entry;
    const schema = fn.parameters ?? fn.input_schema ?? {};
    return { name: name(fn.name), schemaSha256: digest(schema),
      schemaType: schema.type ?? null,
      properties: Object.keys(schema.properties ?? {}).map(name).sort(),
      required: (schema.required ?? []).map(name).sort() };
  });
  const messages = body.messages ?? body.input ?? [];
  const results = messages.filter(entry => entry.role === 'tool' || entry.type === 'function_call_output');
  const resultText = results.map(entry => JSON.stringify(entry.content ?? entry.output ?? '')).join('\n');
  const choice = body.tool_choice;
  return {
    model: name(body.model), stream: body.stream === true, tools,
    toolChoice: typeof choice === 'string' ? choice : choice ? { type: name(choice.type), name: name(choice.function?.name ?? choice.name) } : null,
    parallelToolCalls: body.parallel_tool_calls ?? null,
    targetCallable: tools.some(tool => tool.name === targetName),
    targetSchemaInToolResult: resultText.includes(targetName) && resultText.includes('Parameters:'),
    inputReceipts: receipts(resultText),
  };
}

// The pinned fixture uses OpenAI Chat Completions. Unsupported wires fail explicitly.
export class CompletionObserver {
  constructor() { this.buffer = ''; this.calls = new Map(); this.text = ''; this.finish = []; this.parseErrors = 0; }
  push(chunk) {
    this.buffer += chunk;
    let cut;
    while ((cut = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, cut).trim(); this.buffer = this.buffer.slice(cut + 1);
      if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]') continue;
      try { this.event(JSON.parse(line.slice(5))); } catch { this.parseErrors += 1; }
    }
  }
  event(body) {
    for (const choice of body.choices ?? []) {
      const part = choice.delta ?? choice.message ?? {};
      if (typeof part.content === 'string') this.text += part.content;
      for (const call of part.tool_calls ?? []) {
        const key = `${choice.index ?? 0}:${call.index ?? 0}`;
        const prior = this.calls.get(key) ?? { id: '', name: '', arguments: '' };
        prior.id += call.id ?? ''; prior.name += call.function?.name ?? ''; prior.arguments += call.function?.arguments ?? '';
        this.calls.set(key, prior);
      }
      if (choice.finish_reason) this.finish.push(choice.finish_reason);
    }
  }
  evidence() {
    return { toolCalls: [...this.calls.values()].map(call => ({
      id: name(call.id), name: name(call.name), argumentsSha256: digest(call.arguments),
      emptyArguments: call.arguments.trim() === '{}',
    })), finishReasons: [...new Set(this.finish)], receipts: receipts(this.text),
    unavailable: this.text.trim() === 'UNAVAILABLE', parseErrors: this.parseErrors };
  }
}
