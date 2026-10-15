// Loaded by the actual Node.exe hosting the official App kernel. No protocol edits.
const fs = require('node:fs'), path = require('node:path')
if (process.argv.some(x => /[\\/]zcode\.cjs$/.test(x))) {
  const root = __dirname, pending = new Map(), buffers = { in: '', out: '' }
  const record = row => fs.appendFileSync(path.join(root, 'wire.jsonl'), JSON.stringify({ ...row,
    stage: fs.readFileSync(path.join(root, 'stage.txt'), 'utf8').trim(), pid: process.pid, cwd: process.cwd() }) + '\n')
  record({ direction: 'launch', target: process.execPath, officialKernel: process.argv.find(x => /[\\/]zcode\.cjs$/.test(x)),
    environment: { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE } })
  function observe(chunk, direction) {
    buffers[direction] += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    let n
    while ((n = buffers[direction].indexOf('\n')) >= 0) {
      const line = buffers[direction].slice(0, n); buffers[direction] = buffers[direction].slice(n + 1)
      let v; try { v = JSON.parse(line) } catch { continue }
      const p = v.params ?? {}, b = v.result ?? {}
      if (direction === 'in' && v.id !== undefined) pending.set(String(v.id), v.method)
      record({ direction, id: v.id, method: v.method, requestMethod: pending.get(String(v.id)), sessionId: p.sessionId,
        resultSessionId: b.sessionId ?? b.session?.sessionId, commandType: p.type,
        target: ['session/resume','session/load'].includes(v.method) ? { sessionId: p.sessionId, cwd: p.cwd } : undefined,
        error: v.error && { code: v.error.code, data: v.error.data },
        [direction === 'in' ? 'businessMarkers' : 'responseMarkers']: [...new Set(line.match(/WIN_RESUME_[A-Z_0-9]+/g) ?? [])] })
    }
  }
  const emit = process.stdin.emit
  process.stdin.emit = function(event, ...args) { if (event === 'data') observe(args[0], 'in'); return Reflect.apply(emit, this, [event, ...args]) }
  const write = process.stdout.write
  process.stdout.write = function(chunk, ...args) { observe(chunk, 'out'); return Reflect.apply(write, this, [chunk, ...args]) }
}
