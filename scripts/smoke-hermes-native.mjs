// Opt-in acceptance against the installed native executor and a real model.
// Supply a private, preconfigured Hermes Home. No secret discovery or copying.
import assert from 'node:assert/strict'
import { mkdir, writeFile, realpath } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { openHermesAcp } from './lib/hermes-native-acp.mjs'
import { deflateSync } from 'node:zlib'

// Generated opaque RGB PNG. The prompt contains no color answers; this probes
// actual model vision over official ACP instead of trusting advertised support.
function imageFixture() {
  const crc = bytes => {
    let value = 0xffffffff
    for (const byte of bytes) {
      value ^= byte
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
    }
    return (value ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), prefix = Buffer.alloc(4), suffix = Buffer.alloc(4)
    prefix.writeUInt32BE(data.length); suffix.writeUInt32BE(crc(body))
    return Buffer.concat([prefix, body, suffix])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(128); header.writeUInt32BE(128, 4); header[8] = 8; header[9] = 2
  const pixels = Buffer.alloc(128 * (1 + 128 * 3)), colors = [[0,255,255],[255,0,255],[255,255,0],[0,0,255]]
  for (let y=0; y<128; y++) for (let x=0; x<128; x++) {
    const color = colors[(y>=64?2:0)+(x>=64?1:0)]
    color.forEach((value, n) => { pixels[y*385+1+x*3+n]=value })
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])
}

const home = process.env.ROVAI_HERMES_SMOKE_HOME
assert(home && process.env.ROVAI_HERMES_BIN, 'Set the private Home and official executable')
const root = await realpath(resolve(home, '..')), project = join(root, 'project')
await mkdir(project, { recursive: true })
const fixture = join(root, 'mcp-proof.mjs')
await writeFile(fixture, `import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'hermes-proof',version:'1'}}:
m.method==='tools/list'?{tools:[{name:'probe',description:'Returns the integration verification code.',inputSchema:{type:'object',properties:{}}}]}:
m.method==='tools/call'?{content:[{type:'text',text:process.env.PROOF_CODE??'MCP-COPPER-6842'}]}:{};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`)
await mkdir(join(home, 'skills/rovai-hermes-proof'), { recursive: true })
await writeFile(join(home, 'skills/rovai-hermes-proof/SKILL.md'), '---\nname: rovai-hermes-proof\ndescription: Read this skill to retrieve the native integration proof code.\n---\nThe proof code is SKILL-INDIGO-3941.\n')
const options = { executable: process.env.ROVAI_HERMES_BIN,
  script: resolve(import.meta.dirname, '../crates/rovai-core/src/hermes/host.py'), cwd: project,
  env: { ...process.env, HERMES_HOME: home } }
const mcpServers = [{ name: 'hermesproof', command: process.execPath, args: [fixture], env: [] }]
const bootstrap = 'For the integration check, remember rules code RULES-CERULEAN-7832. Keep it across turns and compression.'
let firstInput = true
const results = {}
let client = await openHermesAcp(options)
async function prompt(sessionId, text) {
  if (firstInput) { text = `[Rovai 协作规则]\n${bootstrap}\n[/Rovai 协作规则]\n\n${text}`; firstInput = false }
  const start = client.events.length
  const result = await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }], _meta: { rovai: { promptId: crypto.randomUUID() } } })
  assert.equal(result.stopReason, 'end_turn')
  const events = client.events.slice(start)
  const output = events.filter(m => m.params?.update?.sessionUpdate === 'agent_message_chunk')
    .map(m => m.params.update.content?.text ?? '').join('')
  return { result, output, events }
}
try {
  const session = await client.request('session/new', { cwd: project, mcpServers })
  const id = session.sessionId
  await client.request('session/set_mode', { sessionId: id, modeId: 'dont_ask' })
  await client.request('session/set_model', { sessionId: id, modelId: session.models.currentModelId })
  const model = await client.request('session/load', {sessionId: id, cwd: project, mcpServers: []})
  assert.equal(model.models.currentModelId, session.models.currentModelId)
  const first = await prompt(id, 'Call the hermesproof MCP probe tool, then use skill_view to read rovai-hermes-proof. Reply with the MCP proof code, skill proof code, and the rules code from your instructions.')
  for (const marker of ['MCP-COPPER-6842','SKILL-INDIGO-3941','RULES-CERULEAN-7832']) assert(first.output.includes(marker), `Missing ${marker}`)
  assert(first.events.some(m => m.params?.update?.sessionUpdate === 'tool_call'))
  console.log('Native MCP, Skill and first-input rules passed')
  results.nativeTools = { mcp: true, skill: true, modelAcknowledged: true, firstUsage: first.result.usage }
  const warm = await prompt(id, 'Return only the rules code again.')
  assert(warm.output.includes('RULES-CERULEAN-7832'))
  results.warmUsage = warm.result.usage
  assert.equal((await client.close()).code, 0)
  client = await openHermesAcp(options)
  await assert.rejects(client.request('session/resume', { sessionId: 'missing-hermes-target', cwd: project, mcpServers }),
    error => error.rpcError?.data?.details === 'not_found')
  await client.request('session/resume', { sessionId: id, cwd: project, mcpServers })
  const resumed = await prompt(id, 'Return the MCP code from the earlier conversation and the current rules code, without calling tools.')
  assert(resumed.output.includes('MCP-COPPER-6842') && resumed.output.includes('RULES-CERULEAN-7832'))
  results.coldResume = true
  // Vision is a separate opt-in qualification: native image transport can work
  // while the configured model/auxiliary route still misidentifies the pixels.
  if (process.env.ROVAI_HERMES_SMOKE_IMAGE === '1') {
    const imageStart = client.events.length
    const imageResult = await client.request('session/prompt', { sessionId: id,
      prompt: [{ type: 'text', text: 'Look at the attached image. Name the four quadrant colors in reading order: top-left, top-right, bottom-left, bottom-right. Use English, no tools, no guesses from history.' },
        { type: 'image', mimeType: 'image/png', data: imageFixture().toString('base64') }], _meta: { rovai: { promptId: crypto.randomUUID() } } })
    assert.equal(imageResult.stopReason, 'end_turn')
    const imageText = client.events.slice(imageStart).filter(m => m.params?.update?.sessionUpdate === 'agent_message_chunk')
      .map(m => m.params.update.content?.text ?? '').join('').toLowerCase()
    results.nativeImage = { correctlyIdentified: /cyan[\s\S]*(?:magenta|fuchsia)[\s\S]*yellow[\s\S]*blue/.test(imageText), response: imageText }
    assert(results.nativeImage.correctlyIdentified, `Native image content was not correctly identified: ${imageText}`)
  }
  console.log(JSON.stringify(results, null, 2))
} finally {
  await writeFile(join(root, 'native-summary.json'), JSON.stringify(results, null, 2))
  console.log('Cleanup:', await client.close())
}
