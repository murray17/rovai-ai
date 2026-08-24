---
document_type: contract
name: Runtime Launch and Verification
version: v26
status: accepted
source_version: v1.27
last_updated: 2026-08-24
---

# Runtime Launch and Verification v26

v26 replaces [v25](runtime-launch-and-verification-v25.md). v25 的 launch、verification、permission、
平台准入、Kimi Home/continuation/External MCP、十二种 Runtime 默认权限与 Cursor 隐藏边界全部保持不变；
本版只修正 TRAE CLI CN 实际 ACP Bash input 的大小写 wire shape，不扩大其他 ACP Adapter 的公开输入边界。

## TRAE Bash command allowlist

通用 ACP Adapter 继续只允许非空字符串 `rawInput.command` 进入公开 `input`。`trae-cn-cli` 额外允许
非空字符串 `rawInput.Command`；这是 `traecli 0.120.52` Bash `tool_call` 的实测字段，并且只在当前
Adapter identity 已明确为 `trae-cn-cli` 时生效。

`rawInput.Command` 的相邻 `Description` 及所有未知字段保持私有，只参与完整 `rawInputDigest`。其他
Adapter 收到相同大写字段时必须 fail closed，不公开 command，也不能据此补写 `execute`。TRAE 的公开
Command 在缺少原生 kind 时可补全 `execute`；同一 `toolCallId` 的 terminal update 省略 `rawInput` 时，
Core 从当前 Prompt 的进程内 started observation 携带相同 command、kind 与 digest，不从 title、output
或 digest 反推。结构化 permission request 的 Shell argv 归一化必须复用同一 Adapter-scoped allowlist。

## Acceptance

- TRAE 实测 `tool_call` shape `rawInput = { Command, Description }` 只公开 `Command`，并生成
  `kind = execute` 与完整 raw-input digest；
- `Description` 不进入公开 Evidence、Action result 或 Renderer payload；
- 同一大写 `Command` 对非 TRAE ACP Adapter 不产生公开 input 或 execute kind；
- 稀疏 terminal update 保留 started phase 的 TRAE command、kind 与 digest；
- TRAE stdout、stderr、mixed、empty、nonzero 与 large command-output matrix 均显示原始受控命令，
  其他相邻 raw 字段不公开；v25 的 status 与非零 exit-code 规则保持独立，不用 command 文本或 output
  猜测 Runtime 未报告的 exit code。

## References

- [Runtime Launch and Verification v25](runtime-launch-and-verification-v25.md)
- [Evidence 与 Canonical Activity](../architecture/foundational-invariants.md#evidence-canonical-activity)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md)
- [Run Process Detail Surface v19](run-process-detail-surface-v19.md)
