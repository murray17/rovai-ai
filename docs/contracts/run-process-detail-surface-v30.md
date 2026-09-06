---
document_type: protocol-contract
contract: run-process-detail-surface-v30
authority: active-tool-group-current-instruction-presentation
status: accepted
version: 30
source_version: v1.39
last_updated: 2026-09-06
---

# Run Process Detail Surface v30

完整继承 [v29](run-process-detail-surface-v29.md) 的布局、Evidence、Tool 行标题、连续分组、详情交互、
取消终态与 Runtime Compaction 展示。本版只让活动 Tool 组摘要展示当前可证明的具体公开指令；不改变
Canonical Activity 分类、operation identity、lifecycle、稳定 Tool 行标题或渠道卡片文案。

## 当前指令

活动组继续使用“执行中/等待审批 · <当前指令>”，live-tail 继续使用“执行中 · <最近一条指令>”。
`publicCommand` 始终优先；否则 Renderer 按以下顺序选择：

- Shell：完整脱敏的公开 command；没有 command 时依次使用非通用 Runtime title、非通用 toolName；
- File：可靠 typed `runtimeFileOperation` path 或单文件 available Canonical Diff 显示
  `修改 <basename>`，多文件 available Canonical Diff 显示 `修改 N 个文件`；否则依次使用非通用
  Runtime title、非通用 toolName；
- `tool.web.search`：available typed `runtimeSearchOperation` 显示 `搜索 <query>`；多项 query 按既有
  中文逗号规则连接；否则依次使用非通用 Runtime title、非通用 toolName；
- 其他 Tool、Runtime 与 Unknown：依次使用非通用 Runtime title、非通用 toolName。

通用占位包括 Shell/Terminal/command executor、Edit/Read/Write/apply patch、Web Search/Search、
Tool Call/Runtime Activity 及其既有中文 fallback。没有更具体值时必须诚实回退到 v24 冻结的 Tool 行标题，
不能制造空摘要。相同 operation 的 terminal 更新若省略当前指令，Renderer 保留 started/progress 阶段已经
投影的当前指令；后续明确值仍可原位覆盖。

## 证据与表面边界

文件 path/count 和 Web query 只来自既有 typed/Canonical 公开 Evidence。Renderer 不得从 raw input/output、
detail、显示标题或当前文件猜测这些事实。Runtime 明确提供的公开 title 只能原样作为 presentation 使用，
不能反向证明 File/Web 分类或生成新的持久 Evidence。

Desktop 底部执行台与 Inspector 继续移动同一个 Drawer DOM，并使用同一活动组摘要；局域网只读执行台复用
同一共享分组 presentation。展开后的稳定 Tool 行仍使用 v24 标题，飞书/钉钉卡片继续使用既有 public title，
不读取本版 `currentInstruction`。本版不新增 IPC、Schema、Migration、Activity Registry 条目、渠道投递或
视觉结构。

## 验收

- File 的稳定 Tool 行为“文件操作”或 Runtime toolName 时，活动摘要可显示“执行中 · 修改 settings.ts”；
- 多文件 available Diff 显示“修改 N 个文件”，单文件 reliable path 只显示 basename；
- available typed Web query 显示“执行中 · 搜索 <query>”，缺少 typed projection 时不从 payload 猜 query；
- Shell 使用完整脱敏公开 command；只有 `exec_command`/`Shell` 等占位时回退稳定 Tool 行标题；
- sparse terminal update 保留同 operation 已知的具体指令；新 Tool 到达后活动组原位替换；
- Tool 行标题、详情、计数、状态、飞书/钉钉文案与 Runtime Compaction 行均不改变；
- 底部、Inspector、局域网只读执行台和辅助名称表达同一个当前指令。

<a id="text-block-evidence"></a>

## 正文块 Evidence（v1.53 补充）

`agent.text.delta`、`agent.thought.delta`、`agent.reasoning.summary.delta` 只用于实时显示，不逐片写入
SQLite。分别以 `agent.text.block`、`agent.thought.block`、`agent.reasoning.summary.block` 保留每个独立
文本块，不合并整个 Run，也不把中间正文替换为最后的 `final_answer`。工具生命周期、Canonical Activity
与文件变化 Evidence 不受删减；本合同不采集 Adapter 原先未公开的隐藏 reasoning。

块身份限于 Run 与 execution epoch；优先使用原生 item ID。Codex 使用 `item/completed` 的 message/summary，
Claude 使用对应 assistant message 的 text content block，Pi 以 message 边界和 contentIndex 关联流式片段与
`message_end.message`。没有可靠完整结果的 Runtime，按文字种类变化及工具/plan/compaction 等连续边界
定稿；不同原生 item 即使交错输出也不能混合。

首片只插入一个空内容的 `updated` 占位，冻结 ID、sequence 和 occurredAt；后续片段只追加到 Core 所有的
有界缓冲，完成后在同一行填入完整内容，不能另存累计副本或把完成位置排到工具之后。payload 包含
`blockId`、同值 `itemId`、可空 `nativeItemId`、`text`、UTF-16 `textLength`、`blockStartedAt`、
`status = streaming | completed | interrupted` 和 `contentLimitExceeded`。
工具边界只结束无原生身份的连续块；有身份的块等待其完成结果或 Run 收口。

实时 delta 包含 `blockId/itemId`、UTF-16 `textOffset` 与 `blockStartedAt`。Camp Open、完整 Snapshot、
Evidence 分页、SingleChat 和未封存渠道读取叠加已接受的当前内容；Renderer 以偏移去掉重叠片段并以定稿块
替换累计内容。离开 Camp 后返回不依赖本地保存每个 delta。大正文沿用 Blob 及完整内容读取入口。
Renderer 也按带身份的块合并实时缓存，不再在 App 生命周期内累积每个 transport frame；首段位置、
UTF-16 偏移和工具事实保留，旧无块身份的历史事件继续走兼容路径。
执行过程内容按既有展开/激活边界加载 Blob 正文并在原段落位置显示全文；不能把 Blob 预览当成完整历史。
离线聚合保留 sequence 空档，分页以单调序号和最终游标校验完整性，不把 MAX(sequence) 当作行数。

每块内存上限 64 KiB，之后使用私有临时 spool；正文保留上限 8 MiB，使最坏 JSON 转义仍小于既有
64 MiB Blob 上限，未结束块数上限 128。正文超限保留 UTF-8 完整前缀并标明中断/超限，不伪造完整结果。
完成、取消、失败和受控关闭回收 spool。普通 App 退出在 Core drain/settlement 完成前定稿已收到正文；
断电、强制杀进程或无法写盘不在此保证中，不能把丢失的未定稿内容伪装成成功。

原有 delta 历史继续可读，不在启动时自动迁移。仅在用户明确授权、App/Core 退出、完整备份及逐块内容/
顺序/状态校验后，允许离线一次性聚合理解的历史正文；有不明边界、缺失 Blob 或被引用记录时保守保留或
停止操作。不得清空 event_log、回写工具事实、重建已封存渠道快照或顺便 GC 旧 Blob。

## References

- [Run Process Detail Surface v29](run-process-detail-surface-v29.md)
- [Run Process Detail Surface v24](run-process-detail-surface-v24.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md)
