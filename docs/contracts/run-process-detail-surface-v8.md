---
document_type: renderer-contract
contract: run-process-detail-surface-v8
authority: agent-process-detail-placement-and-recovery-surface
status: accepted
last_updated: 2026-08-18
---

# Run Process Detail Surface v8（完整 Tool 时间线与原位结果交互）

本合同完整继承 [Run Process Detail Surface v7](run-process-detail-surface-v7.md) 的执行台位置、
Agent selector、Run stage、Evidence、Recovery Blocker、planned-shutdown、外部效果诚实投影与取消活动
“已停止”展示，并替代 v7 作为当前 Renderer 入口。v8 只收口 Tool 时间线、Built-in 结果展开和超长结果
复制入口。

## 1. 完整时间线

当 Renderer 已获得一个 AgentRun 的 Execution Evidence 时，必须按 Canonical Runtime Activity identity
合并 started/terminal revision，并按首次出现顺序保留所有可呈现 Tool 行。Renderer 不得再用“最后 12 项”
或其他无提示的尾部切片删除较早 Tool 行。

终态 Run 的首屏 Evidence 不完整时，打开执行过程继续使用既有稳定分页读取全部该 Run Evidence；加载状态、
失败和重试仍在原执行过程内呈现。本版不新增“较早 N 项”占位或第二条历史时间线。没有 Canonical Tool
identity 的 Evidence 不能仅因内容相似而补造 Tool 行。

## 2. Built-in Tool 公共结果

`runtime.action` 属于 Core-owned Built-in invocation 时，Tool 行详情读取完整 Core Envelope 中的公共
`result`；失败结果读取公共 `error`。若历史兼容 Evidence 没有完整 Envelope，可以读取
`operationProjection.canonicalResult`。普通 Runtime Tool 继续读取公开 `output`，必要时回退到公开
`input`。

详情与复制内容不得包含 Envelope wrapper、request/receipt identity、canonical input projection、digest、
IPC/lease 信息或其他宿主内部字段。由此，`camp.read`、`camp.search` 等 Built-in terminal 行只要存在公共
结果就必须是可展开 disclosure，而不是静态摘要。

## 3. 超长结果原位复制

Tool disclosure 打开后只渲染既有有界开头预览：最多 10 行或 2,000 个 Unicode scalar，并明确说明后续
内容未显示。需要完整内容时，唯一入口是该次展开结果右上角具名的复制控件：

- 非 Blob 结果直接复制当前 Tool 的完整公共输出；
- Managed Blob 结果仅在点击复制时读取完整 Evidence，并从中提取同一公共输出字段；
- 完整正文不得为了复制先挂载到执行台 DOM；
- 读取或剪贴板失败保留预览，并在原控件反馈可重试状态。

执行台不得再显示独立“查看完整工具调用”按钮、standalone raw Evidence 卡片或完整 Envelope JSON。无法
关联到可呈现 Tool 行的截断 Evidence 继续保留在 Core，不以原始 Payload 绕过 Canonical Activity 边界。

## 4. 验收

- 同一 Run 至少 15 个 Tool operation 时，第一项、最后一项及中间顺序全部保留；
- `camp.read` 与 `camp.search` 的 terminal Built-in Evidence 在顶层 `input/output = null` 时仍可展开；
- 展开内容与复制文本只含公共 `result/error`，不含 Envelope、request、receipt 或 canonical input；
- 长结果 DOM 只有有界开头和一个原位复制控件，复制可以取得完整公共输出；
- 执行台不存在“查看完整工具调用”、`complete-evidence-control` 或 standalone raw Evidence；
- v7 的 cancelled/stopped、unknown effect、Recovery Blocker 与底部/Inspector 单一执行台语义保持不变。
