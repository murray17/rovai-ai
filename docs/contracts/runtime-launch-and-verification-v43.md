---
document_type: contract
name: Runtime Launch and Verification
version: v43
status: accepted
source_version: v1.69
last_updated: 2026-09-24
---

# Runtime Launch and Verification v43

继承 [v42](runtime-launch-and-verification-v42.md) 的 Runtime 启动、检查、恢复、权限、证据和公开失败边界。
本版只修正 Claude Code `stream-json` 在同一进程、同一 Session 返回多个 `type=result` 时的终态选择；
其他 Runtime 及 Claude Code 的输入接受、Tool 活动和公开失败结构不变。

## Claude Code 多个结果事件

Claude Code Adapter 必须消费当前进程的 stdout 直到 EOF，逐条解析 `type=result`。每条结果都必须有
字符串 `subtype`、布尔 `is_error`、字符串 `result` 和与请求精确匹配的有效字符串 `session_id`；
任何一条 JSON、必需字段或 Session 校验失败，仍按既有兼容性失败处理。不能因为出现过一条有效结果而忽略
后续帧，也不能将其他 Session 的结果作为本轮终态。

仅 EOF 前最后一条通过校验的 `result` 决定本轮的成功或失败、最终正文与 Usage。较早的结果不结算
AgentRun，不向公开 Evidence 生成最终正文 fallback；结果之间的 assistant、Tool 和诊断事件仍按既有规则
即时归一。若整轮没有公开的 assistant 文本增量，只有在 EOF 且最后结果为成功、`is_error=false`、
正文非空时，才从该结果生成一次公开 narration fallback。最后结果为失败时，不发布较早成功结果的 fallback。

进程非零退出、缺少结果、最终 Runtime 失败、清理超时和已接受输入禁止自动重放的规则保持不变。
历史失败 Run 不从原生 Session 或邻近事件推断终态，也不回填结果。

## 验证边界

确定性流夹具应覆盖较早成功结果之后的最终成功及 Usage 选择、最终失败不被较早成功掩盖、
后续结果缺字段或跨 Session 仍失败，以及最终 fallback 只在 EOF 后发出。夹具不证明某一次历史
Claude Code 运行产生多个结果的上游原因；真实 Runtime 验收需另行记录原始事件形态和进程终态。
