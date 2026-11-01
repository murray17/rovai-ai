// Read-only replay through the production Renderer projection. Does not run models.
import { createServer } from 'vite'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

const [root] = process.argv.slice(2)
if (!root || !isAbsolute(root)) throw new Error('Usage: node scripts/inspect-native-subagent-smoke.mjs <absolute campaign directory>')
const repo = resolve(import.meta.dirname, '..')
const server = await createServer({ configFile: false, root: repo, logLevel: 'silent',
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null },
  resolve: { alias: { '@contracts': join(repo, 'packages/contracts/src/index.ts') } } })
const read = async path => JSON.parse(await readFile(path, 'utf8'))
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 })
try {
  const { buildLiveExecutionProgress, liveRuntimeEventFromCore } = await server.ssrLoadModule(join(repo, 'apps/desktop/src/shared/execution-presentation/index.ts'))
  const { groupExecutionEventsByRunId } = await server.ssrLoadModule(join(repo, 'apps/desktop/src/renderer/src/execution-events.ts'))
  const reports = []
  for (const name of (await readdir(join(root, 'cases'))).sort()) {
    const dir = join(root, 'cases', name)
    let summary
    try { summary = await read(join(dir, 'summary.json')) } catch { continue }
    let execution = []
    try { execution = await read(join(dir, 'execution.json')) } catch {}
    const events = await read(join(dir, 'events.json'))
    const presentations = execution.map(({ run, evidence, contents, blocks }) => {
      const live = events.map((event, index) => liveRuntimeEventFromCore(event, `observed-${index}`, new Date(event.atMs).toISOString())).filter(Boolean)
      const project = (history, stream) => buildLiveExecutionProgress(
        groupExecutionEventsByRunId([run], history, stream).get(run.id) ?? [], run.id, { textMode: 'complete' })
      const history = project(evidence, [])
      const notifications = project([], live)
      const current = project(evidence, live)
      const tools = progress => progress.items.filter(item => item.kind === 'tool').map(item => item.step)
      const signature = progress => tools(progress).map(row => `${row.id}:${row.status}`)
      const text = progress => progress.items.filter(item => item.kind === 'narration').map(item => item.body)
      const rows = tools(history)
      const nativeIds = new Set(evidence.filter(item => item.payload?.runtimeToolType === 'agent' || item.payload?.runtimeSource?.scope).map(item => item.canonical?.operationId))
      return { run, evidence, contents, blocks, progress: history,
        checks: {
          toolsEqualInOrder: JSON.stringify(signature(history)) === JSON.stringify(signature(current)),
          nativeAgentNotificationsEqual: JSON.stringify(tools(history).filter(row => row.iconKind === 'agent').map(row => `${row.id}:${row.status}`)) === JSON.stringify(tools(notifications).filter(row => row.iconKind === 'agent').map(row => `${row.id}:${row.status}`)),
          nativeAgentAndChildNotificationsEqual: JSON.stringify(tools(history).filter(row => nativeIds.has(row.id)).map(row => `${row.id}:${row.status}`)) === JSON.stringify(tools(notifications).filter(row => nativeIds.has(row.id)).map(row => `${row.id}:${row.status}`)),
          proseEqual: JSON.stringify(text(history)) === JSON.stringify(text(current)),
          uniqueToolRows: new Set(rows.map(row => row.id)).size === rows.length,
          sequenceMonotonic: evidence.every((item, index) => index === 0 || evidence[index - 1].sequence < item.sequence),
          historyTools: rows.length, liveTools: tools(current).length, notificationOnlyTools: tools(notifications).length,
          blockToolCount: blocks.blocks.reduce((total, block) => total + block.toolCount, 0)
        }
      }
    })
    await save(join(dir, 'presentation.json'), presentations)
    const report = { id: name, kind: summary.kind, mode: summary.mode, version: summary.version,
      error: summary.error, elapsedMs: summary.elapsedMs, coreStopped: summary.coreStopped,
      runs: presentations.map(({ run, progress, checks }) => ({ status: run.status, checks,
        tools: progress.items.filter(item => item.kind === 'tool').map(({ step }) => ({
          tool: step.toolName, status: step.status, icon: step.iconKind,
          reportMarker: step.detail.includes('ROVAI_READ_MARKER_7319')
        })),
        narrationCount: progress.items.filter(item => item.kind === 'narration').length,
        possibleChildNarration: progress.items.filter(item => item.kind === 'narration').some(item => /^CHILD_[AB]_BEGIN/.test(item.body.trim()) && !item.body.includes('PARENT_DONE'))
      })) }
    reports.push(report)
    console.log(JSON.stringify(report))
  }
  await save(join(root, 'projection-summary.json'), reports)
} finally { await server.close() }
