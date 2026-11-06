// Controlled provider/tool for native Pi acceptance: no external model or network calls.
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';

export default function (pi: any, questionExtension?: (pi: any) => void) {
  let questionTool: any;
  questionExtension?.(new Proxy(pi, { get(target, key) {
    if (key === 'registerTool') return (tool: any) => { if (tool.name === 'ask_user_question') questionTool = tool; return target.registerTool(tool) };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  }}));
  pi.registerProvider('rovai-native-fixture', {
    baseUrl: 'http://127.0.0.1:1', apiKey: 'fixture-only', api: 'rovai-native-fixture-api',
    models: [{ id: 'native-dialogs', name: 'Native Dialog Fixture', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096 }],
    streamSimple(model: any, context: any) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const messages = context.messages;
        const lastUserIndex = messages.findLastIndex((message: any) => message.role === 'user');
        const done = messages.slice(lastUserIndex + 1).some((message: any) => message.role === 'toolResult');
        const prompt = JSON.stringify(messages[lastUserIndex]?.content ?? '');
        const scenario = prompt.includes('NATIVE_PARALLEL') ? 'parallel' : prompt.includes('NATIVE_TIMEOUT') ? 'timeout' : prompt.includes('NATIVE_STOP') ? 'stop' : 'flow';
        const output = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: Date.now(),
          stopReason: done ? 'stop' : 'toolUse', content: done ? [{ type: 'text', text: 'Native fixture finished.' }]
            : [{ type: 'toolCall', id: crypto.randomUUID(), name: 'native_interaction_probe', arguments: { scenario } }] };
        stream.push({ type: 'start', partial: output });
        stream.push({ type: 'done', reason: output.stopReason, message: output });
        stream.end();
      });
      return stream;
    }
  });
  pi.registerTool({ name: 'native_interaction_probe', label: 'Native Dialog Probe', description: 'Controlled acceptance only.',
    parameters: { type: 'object', properties: { scenario: { type: 'string' } }, required: ['scenario'] },
    async execute(_id: string, params: any, _signal: any, _update: any, ctx: any) {
      const answers: any[] = [];
      if (params.scenario === 'parallel') {
        answers.push(...await Promise.all([ctx.ui.input('Same member input', 'Original input'), ctx.ui.confirm('Same member confirm', 'Independent request ID')]));
      } else if (params.scenario === 'stop') {
        answers.push(await ctx.ui.confirm('Stop waiting', 'An unanswered native dialog must not prevent stopping.'));
      } else if (params.scenario === 'timeout') {
        answers.push(await ctx.ui.input('Native timeout', 'Expires in Pi', { timeout: 1200 }));
      } else {
        answers.push(await ctx.ui.confirm('Confirm yes', 'Original confirmation\n第二行', { timeout: 0 }));
        answers.push(await ctx.ui.confirm('Confirm no', 'No is an explicit answer.'));
        answers.push(await ctx.ui.confirm('Skip confirmation', 'Skip must use cancelled, not confirmed.'));
        const choice = await ctx.ui.select('Select original value', [' Windows ', 'Linux', 'Type something.']);
        answers.push(choice);
        // This is the native plugin flow, never a host-side English-label rule.
        if (choice === 'Type something.') answers.push(await ctx.ui.input('Your own answer', 'Preserve every character'));
        answers.push(await ctx.ui.input('Empty input', 'Empty text is an answer'));
        answers.push(await ctx.ui.editor('Multiline editor', '  预填\n第二行  '));
        answers.push(await ctx.ui.input('Multiple selections as text', '1,3; custom answer'));
        if (questionTool) for (const multiSelect of [false, true]) {
          const result = await questionTool.execute(crypto.randomUUID(), { questions: [{
            question: multiSelect ? 'Plugin multi question' : 'Plugin single question', header: 'Native plugin', multiSelect,
            options: [{ label: 'Windows', description: 'Windows paths' }, { label: 'macOS', description: 'macOS paths' }, { label: 'Linux', description: 'Linux paths' }]
          }] }, undefined, undefined, ctx);
          answers.push(result.details);
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify(answers) }], details: { answers } };
    }
  });
}
