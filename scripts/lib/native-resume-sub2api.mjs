// Configure only a newly created, ACL-protected native acceptance home.
// The key is read from the caller's environment and never appears in arguments or evidence.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export async function configureSub2api(kind, native, setEnv) {
  const key = process.env.SUB2API_API_KEY
  assert.ok(key, 'SUB2API_API_KEY is required for the explicit BYOK run')
  const base = 'http://127.0.0.1:18080', model = 'gpt-6'
  const json = async (path, value) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(value, null, 2))
  }
  const env = values => { for (const [name, value] of Object.entries(values)) setEnv(name, value) }
  switch (kind) {
    case 'codex-cli':
      await writeFile(join(native, 'config.toml'), `model = "${model}"\nmodel_provider = "sub2api"\nmodel_reasoning_effort = "low"\n[model_providers.sub2api]\nname = "Sub2API acceptance"\nbase_url = "${base}/v1"\nwire_api = "responses"\nenv_key = "SUB2API_API_KEY"\nrequires_openai_auth = false\n`)
      break
    case 'claude-code-cli': {
      const values = { ANTHROPIC_BASE_URL: base, ANTHROPIC_API_KEY: key, ANTHROPIC_AUTH_TOKEN: key,
        ANTHROPIC_MODEL: model, ANTHROPIC_DEFAULT_OPUS_MODEL: model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: model, ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
        CLAUDE_CODE_SUBAGENT_MODEL: model, CLAUDE_CODE_EFFORT_LEVEL: 'low' }
      env(values)
      await json(join(native, 'settings.json'), { env: values, model, effortLevel: 'low' })
      await json(join(native, 'settings.local.json'), {})
      break
    }
    case 'pi':
      await json(join(native, 'settings.json'), { defaultProvider: 'sub2api', defaultModel: model, defaultThinkingLevel: 'low' })
      await json(join(native, 'models.json'), { providers: { sub2api: { baseUrl: `${base}/v1`, api: 'openai-responses', apiKey: key,
        models: [{ id: model, name: model, reasoning: true, input: ['text'], contextWindow: 200000, maxTokens: 8192 }] } } })
      break
    case 'copilot-cli':
      env({ COPILOT_PROVIDER_BASE_URL: `${base}/v1`, COPILOT_PROVIDER_TYPE: 'openai', COPILOT_PROVIDER_API_KEY: key,
        COPILOT_PROVIDER_WIRE_API: 'responses', COPILOT_PROVIDER_TRANSPORT: 'http', COPILOT_MODEL: model })
      break
    case 'qwen-code':
      await json(join(native, 'settings.json'), { $version: 4, model: { name: model }, security: { auth: { selectedType: 'openai' } },
        modelProviders: { openai: [{ id: model, name: model, baseUrl: `${base}/v1`, envKey: 'SUB2API_API_KEY',
          generationConfig: { contextWindowSize: 200000, timeout: 120000, maxRetries: 0 } }] } })
      break
    case 'qoder-cli': {
      const config = JSON.parse(await readFile(join(native, 'settings.json'), 'utf8'))
      const providers = config.providers ?? config.model?.providers
      assert.ok(providers, 'No native Qoder custom provider configuration')
      for (const provider of Object.values(providers)) if (provider.baseUrl?.startsWith(base)) {
        provider.apiKey = key; provider.model = model
      }
      await json(join(native, 'settings.json'), config)
      break
    }
    case 'codebuddy-cli':
      env({ CODEBUDDY_API_KEY: key, CODEBUDDY_BASE_URL: base, CODEBUDDY_MODEL: `custom-local:${model}`,
        CODEBUDDY_BIG_SLOW_MODEL: `custom-local:${model}`, CODEBUDDY_SMALL_FAST_MODEL: `custom-local:${model}`,
        CODEBUDDY_CODE_SUBAGENT_MODEL: `custom-local:${model}` })
      await json(join(native, 'settings.json'), { model: `custom-local:${model}` })
      await json(join(native, 'models.json'), { models: [{ id: model, name: model, vendor: 'Sub2API',
        url: `${base}/v1/chat/completions`, apiKey: key, maxInputTokens: 200000, maxOutputTokens: 8192,
        supportsToolCall: true, supportsImages: false, relatedModels: { lite: model, reasoning: model } }], availableModels: [model] })
      break
    case 'kimi-code-cli':
      env({ KIMI_MODEL_NAME: model, KIMI_MODEL_API_KEY: key, KIMI_MODEL_PROVIDER_TYPE: 'openai_responses',
        KIMI_MODEL_BASE_URL: `${base}/v1`, KIMI_MODEL_MAX_CONTEXT_SIZE: '200000', KIMI_MODEL_CAPABILITIES: 'thinking',
        KIMI_MODEL_THINKING_EFFORT: 'low', KIMI_CODE_NO_AUTO_UPDATE: '1' })
      break
    case 'grok-build':
      await writeFile(join(native, 'config.toml'), `[models]\ndefault = "sub2api"\ndefault_reasoning_effort = "low"\n[model.sub2api]\nmodel = "${model}"\nbase_url = "${base}/v1"\nname = "Sub2API acceptance"\nenv_key = "SUB2API_API_KEY"\napi_backend = "responses"\ncontext_window = 200000\nmax_completion_tokens = 8192\n`)
      break
    case 'opencode-cli':
      await json(join(native, 'config/opencode/opencode.jsonc'), { model: `sub2api/${model}`,
        provider: { sub2api: { npm: '@ai-sdk/openai-compatible', name: 'Sub2API',
          options: { baseURL: `${base}/v1`, apiKey: key }, models: { [model]: { name: model, limit: { context: 200000, output: 8192 } } } } } })
      // A second copied config must not override the explicit fixture selection.
      await json(join(native, 'config/opencode/opencode.json'), {})
      break
    case 'deepseek-harness':
      await json(join(native, 'settings.yaml'), { 'llm-pi-ai': { providers: { sub2api: {
        api: 'openai-responses', baseURL: `${base}/v1`, apiKeyEnv: 'SUB2API_API_KEY',
        models: [{ id: model, contextWindow: 200000, maxTokens: 8192, reasoningEfforts: { low: 'low' } }] } } } })
      return { provider: 'sub2api', model, endpoint: base, memberModel: { mode: 'explicit', modelId: JSON.stringify(['sub2api', model]), options: { reasoning_effort: 'low' } } }
    case 'zcode-app':
      await json(join(native, '.zcode/v2/provider_config.json'), { schemaVersion: 1, config: {
        providerOrder: ['sub2api'],
        providerConfigRules: { providerRules: [{ providerId: 'sub2api', providerName: 'Sub2API acceptance', enabled: true,
          config: { group: 'standard-personal', access: { type: 'api-key', apiKey: key },
            api: { type: 'openai-responses', baseUrl: `${base}/v1` }, personalModelIds: [model], modelOrder: [model] } }] },
        modelConfigRules: { providerModelRules: [{ providerId: 'sub2api', modelId: model,
          config: { enabled: true, properties: { contextWindow: 200000 }, optionSpecs: {
            reasoningLevel: { values: ['low'], map: '{"reasoning":{"effort":reasoningLevel}}' },
            maxOutputTokens: { max: 8192 } } } }], manualProviderModelRules: [] },
        defaultModelSelection: { providerId: 'sub2api', modelId: model, options: { reasoningLevel: 'low' } }
      } })
      break
    case 'trae-cn-cli': {
      const values = { model: { name: 'sub2api-gpt-6' }, disable_model_failover: true,
        models: [{ name: 'sub2api-gpt-6', open_ai: { base_url: `${base}/v1`, api_key: key, model } }] }
      env({ HOME: native, USERPROFILE: native, APPDATA: join(native, 'AppData/Roaming'), LOCALAPPDATA: join(native, 'AppData/Local') })
      await json(join(native, '.trae/trae_cli.yaml'), values)
      await json(join(native, 'AppData/Roaming/trae_cli/trae_cli.yaml'), values)
      return { provider: 'sub2api', model, endpoint: base, isolatedLocal: join(native, 'AppData/Local') }
    }
    default:
      return { provider: 'native-account', reason: 'No established native custom-provider configuration' }
  }
  return { provider: 'sub2api', model, endpoint: base }
}
