import type { AgentRunExecutionEvidenceView } from '@contracts'
import type { ExecutionConsoleSnapshot } from '../shared/execution-presentation/feishu-card'

/** Synthetic, explicitly labelled content. Never executes a command or creates a Core Run. */
export function feishuExecutionPreviewFixture(
  agentRunId: string,
  displayName: string,
  commandCount: number
): ExecutionConsoleSnapshot {
  if (!Number.isInteger(commandCount) || commandCount < 1 || commandCount > 200) {
    throw new Error('feishu_preview_count_invalid')
  }
  const evidence: AgentRunExecutionEvidenceView[] = []
  const event = (kind: 'narration' | 'command', payload: unknown): void => {
    const sequence = evidence.length + 1
    evidence.push({
      id: `${agentRunId}:evidence:${sequence}`, agentRunId, executionEpoch: 1, sequence,
      eventType: kind === 'narration' ? 'agent.text.delta' : 'activity.completed', kind,
      phase: kind === 'narration' ? 'updated' : 'completed', payload,
      contentBlobId: null, contentByteCount: 0, isTruncated: false, canonical: null,
      occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString()
    })
  }
  const text = (delta: string): void => event('narration', { itemId: `text-${evidence.length}`, delta })
  const command = (command: string, aggregatedOutput = ''): void => event('command', {
    item: { type: 'commandExecution', command, status: 'completed', aggregatedOutput }
  })
  text(`这是 ${commandCount} 条 command 的交互预览，命令与结果均为模拟内容，没有实际执行。\n正文与 command 交错排列；每条可独立展开，底部可翻页。`)
  const narration = [
    '先检查文件并定位逻辑，然后查看对应测试结果。',
    '继续检查文件变化和长结果，展开后只显示一个结果框。',
    '下面演示权限信息脱敏和空输出。',
    '正文保持原始顺序，留在对应的 command 之间。',
    '继续检查剩余步骤，再进入下一组示例。'
  ]
  for (let index = 1; index <= commandCount; index += 1) {
    const label = String(index).padStart(3, '0')
    if ((index - 1) % 3 === 0) {
      text(`第 ${index}～${Math.min(index + 2, commandCount)} 条：${narration[Math.floor((index - 1) / 3) % narration.length]}`)
    }
    switch ((index - 1) % 10) {
      case 0:
        command(`sed -n '1,20p' .rovai-preview/step-${label}.txt`, `step ${label}\npreview input loaded\nready`)
        break
      case 1:
        command(`rg -n 'terminal_sealed|execution_console_page' .rovai-preview/step-${label}.ts`, '12: terminal_sealed\n28: execution_console_page')
        break
      case 2:
        command(`pnpm exec vitest run .rovai-preview/case-${label}.test.ts`, `✓ case-${label}\nTest Files  1 passed (1)\nTests       3 passed (3)`)
        break
      case 3:
        command(`git diff --stat -- .rovai-preview/step-${label}.ts`, `step-${label}.ts | 6 ++++--\n1 file changed, 4 insertions(+), 2 deletions(-)`)
        break
      case 4:
        command(`sed -n '1,210p' .rovai-preview/output-${label}.txt`, Array.from({ length: 210 }, (_, line) => `line ${line + 1}`).join('\n'))
        break
      case 5:
        command(`sed -n '5p;15p' .rovai-preview/step-${label}.txt`, '05  first selected line\n15  second selected line')
        break
      case 6:
        command(`cargo test -p rovai-core preview_case_${label} -- --exact`, `running 1 test\ntest preview_case_${label} ... ok\ntest result: ok. 1 passed; 0 failed`)
        break
      case 7:
        command("rovai send --public-only --body '这段测试正文必须隐藏'", 'message sent')
        break
      case 8:
        command(`API_TOKEN=preview-only-secret-${label} curl --header 'Authorization: Bearer preview-only-token-${label}' https://example.test/health`, `Authorization: Bearer preview-only-token-${label}\nCookie: session=preview-only-cookie-${label}\nstatus: ok`)
        break
      case 9:
        command(`git diff --check -- .rovai-preview/step-${label}.ts`)
        break
    }
  }
  return {
    sequence: 1, agentRunId, agentDisplayName: `${displayName} · ${commandCount} 条 command 预览`,
    run: { status: 'succeeded', waitReason: null, terminalReasonCode: null }, evidence,
    publicOutput: `示例时间线结束，共 ${commandCount} 条 command。以上没有执行真实命令。`,
    startedAt: null, terminalAt: null
  }
}
