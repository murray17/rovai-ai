// Launch the frozen generic Gate with a reference-only native template.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { runCaptured } from './lib/qualification-common.mjs'
const [planPath, outputPath] = process.argv.slice(2)
assert.ok(planPath && outputPath)
const plan = JSON.parse(await readFile(resolve(planPath), 'utf8'))
const output = resolve(outputPath)
const native = output + '-native-template'
await mkdir(native)
const source = process.env.CODEBUDDY_CONFIG_DIR ?? join(homedir(), '.codebuddy')
const selected = JSON.parse(await readFile(join(source, 'models.json'), 'utf8')).models.find(m => m.id === 'gpt-6-astra')
assert.ok(selected && !selected.apiKey.includes('${') && !selected.url.includes('${'))
const model = Object.fromEntries(['id','name','vendor','api','maxInputTokens','maxOutputTokens','supportsToolCall','supportsImages','supportsReasoning','reasoning','temperature'].filter(k=>Object.hasOwn(selected,k)).map(k=>[k,selected[k]]))
model.apiKey = '${ROVAI_FRR_API_KEY}'
model.url = '${ROVAI_FRR_API_URL}'
await writeFile(join(native,'models.json'),JSON.stringify({models:[model]}),{mode:0o600})
await writeFile(join(native,'settings.json'),JSON.stringify({hooks:{},enabledPlugins:{}}),{mode:0o600})
try {
  const result = await runCaptured(process.execPath,[resolve('scripts/eval-gate.mjs'),'run','--plan',resolve(planPath),'--output',output],{cwd:process.cwd(),timeoutMs:(plan.budget.wallSeconds+120)*1000,maxOutputBytes:16*1024*1024,env:{...process.env,CARGO_BUILD_JOBS:'1',CODEBUDDY_CONFIG_DIR:native,CODEBUDDY_DISABLE_FILE_LOGS:'1',ROVAI_FRR_API_KEY:selected.apiKey,ROVAI_FRR_API_URL:selected.url}})
  const encoded = JSON.stringify(result)
  assert.ok(!encoded.includes(selected.apiKey) && !encoded.includes(selected.url),'Gate output contains private configuration')
  await writeFile(output+'-execution.json',JSON.stringify(result,null,2))
  let keyMatches=0,endpointMatches=0
  async function scan(root){for(const e of await readdir(root,{withFileTypes:true})){const p=join(root,e.name);if(e.isDirectory())await scan(p);else if(e.isFile()){const b=await readFile(p);if(b.includes(Buffer.from(selected.apiKey)))keyMatches++;if(b.includes(Buffer.from(selected.url)))endpointMatches++}}}
  await scan(output)
  await writeFile(output+'-audit.json',JSON.stringify({keyMatches,endpointMatches,templateValuesPersisted:false}))
  console.log(JSON.stringify({exitCode:result.code,timedOut:result.timedOut,keyMatches,endpointMatches,output}))
  process.exitCode=result.code??1
} finally { await rm(join(native,'models.json'),{force:true}) }
