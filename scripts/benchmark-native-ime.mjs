// Visible, isolated production editor. Native keys are supplied by a person or CUA.
import { execFileSync, spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electron from 'electron'

const root = resolve(import.meta.dirname, '..')
const analyzing = process.argv[2] === '--analyze'
const out = resolve(process.argv[analyzing ? 3 : 2] ?? 'docs/prototypes/native-ime')
if (analyzing) {
  const rows = (await readFile(join(out, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  const timings = rows.filter(row => row.type === 'eventTiming')
  const match = start => timings.find(entry => Math.abs(entry.start - start) < 2)
  const percentile = (values, p) => values.slice().sort((a,b) => a-b)[Math.min(values.length-1, Math.floor(values.length*p))]
  const stats = values => Object.fromEntries([['p50',.5],['p95',.95],['p99',.99]].map(([key,p]) => [key, percentile(values,p)]))
  const calibration = rows.find(row => row.type === 'calibration')
  assert.ok(calibration && match(calibration.start)?.duration >= 64, 'the excluded 65ms endpoint calibration must be observed')
  const selected = (process.argv[4] === '--rounds' ? process.argv[5] : '1,2,3').split(',').map(Number)
  const results = selected.map(round => {
    const keys = rows.filter(row => row.type === 'keydown' && row.round === round
      && !row.metaKey && !row.ctrlKey && !row.altKey && (/^Key/.test(row.code ?? '') || row.code === 'Space'))
    const entries = keys.map(key => match(key.start))
    const commits = rows.filter(row => row.type === 'compositionend' && row.round === round && row.data === '测试').length
    const finalText = rows.filter(row => row.type === 'input' && row.round === round).at(-1)?.text?.replaceAll('\u200b','')
    assert.equal(keys.length,180); assert.equal(commits,30); assert.equal(finalText,'测试'.repeat(30))
    const duration = stats(entries.map(entry => entry?.duration ?? 0))
    return { round, samples:keys.length, durationMs:keys.at(-1).start-keys[0].start, commits, characters:finalText.length,
      eventTimingMs:Object.fromEntries(Object.entries(duration).map(([key,value]) => [key,value || '<16ms'])),
      eventTimingReported:entries.filter(Boolean).length,
      inputDelayMs:stats(keys.flatMap((key,index) => entries[index] ? [entries[index].processingStart-key.start] : [])),
      processingMs:stats(entries.filter(Boolean).map(entry => entry.processingEnd-entry.processingStart)) }
  })
  const result = { environment:rows.find(row => row.type==='environment'), keyIntervalMs:100, keyHoldMs:1,
    rounds:selected, excludedCalibration:{...calibration,...match(calibration.start)}, results,
    measurement:'Visible native IME keydown EventTiming to rendering completion; rounded 8ms, below 16ms censored. Candidate popup pixels are outside this metric. No baseline comparison for native input.' }
  await writeFile(join(out,'results.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify(result,null,2))
  process.exit(0)
}
const fixture = await mkdtemp(join(tmpdir(), 'rovai-native-ime-'))
await mkdir(out, { recursive:true })
const events = join(out, 'events.jsonl')
await writeFile(events, '')
try {
  execFileSync(process.execPath, [join(root, 'scripts/fixtures/run-presence/build.mjs'), fixture], { stdio:'inherit' })
  const main = join(fixture, 'main.cjs')
  await writeFile(main, `const {app,BrowserWindow}=require('electron');const {appendFileSync}=require('node:fs');
app.setPath('userData',${JSON.stringify(join(fixture,'user-data'))});app.setPath('sessionData',${JSON.stringify(join(fixture,'session-data'))});
app.whenReady().then(()=>{const w=new BrowserWindow({show:true,width:1440,height:920,useContentSize:true,
webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
w.webContents.on('console-message',event=>{if(event.message.startsWith('ROVAI_NATIVE_IME '))appendFileSync(${JSON.stringify(events)},event.message.slice(17)+'\\n')});
w.loadFile(${JSON.stringify(join(fixture,'rovai-teammate-presence.html'))},{query:{pure:'1',historyScale:'1000',imeTiming:'1'}})});
app.on('window-all-closed',()=>app.quit());`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, [main], { env, stdio:'inherit' })
  console.log(JSON.stringify({ fixture, events, isolated:true, core:false, runtime:false,
    procedure:'Calibrate once with native A; Escape, Command+A, Backspace starts each round; type ceshi+Space 30 times per round with 1ms hold / 100ms key interval; three rounds. Close this window when finished.' }))
  const code = await new Promise((done,reject) => { child.on('error',reject);child.on('exit',done) })
  process.exitCode = code ?? 1
} finally { await rm(fixture, { recursive:true, force:true }) }
