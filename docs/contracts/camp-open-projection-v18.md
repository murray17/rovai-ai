---
document_type: protocol-contract
contract: camp-open-projection-v18
authority: camp-open-and-execution-window-read-boundaries
status: accepted
version: 18
source_version: v1.58
last_updated: 2026-09-12
---

# Camp Open Projection v18

继承 [v17](camp-open-projection-v17.md) 的业务集合、私有审批隔离、激活、消息分页和 high-water 规则。
本版将执行详情从 Camp 首屏读取中移出：Open schema 提升为 **7**，Snapshot 34、Data Contract 99 不变。
旧 Open schema 不能进入 Renderer 缓存。不迁移或删除已有 Evidence。

## 首屏与刷新

`camps.enter`、`camps.open` 返回的 `executionEvidence` 为空；coverage 的 `loadedCount` 为 0，
`totalCount` 仍是该 Camp 的原始持久 Evidence 行数，`complete` 仅在总数为 0 时成立。
`agentRuns[].executionEvidenceCount` 保留原始行数；它不是正文段落数、可见步骤数或分页项数。
其他业务集合沿用既有窗口。Open 及嵌套 loader 不访问 `event_log`，也不读取执行正文和完整 Diff。

执行台或 Inspector 中真正打开的 Run 首先请求一页执行窗口；关闭的 Run、Drawer、隐藏 Inspector
与地图不读取该 Run 的历史。Run 状态、等待原因、停止和审批入口来自业务投影，独立于详情读取。

## 执行窗口

本地 typed method `agentRunExecution.page` 参数：`campId`、`agentRunId`、可选
`beforeSequence: number | null`、可选 `limit`。缺省 limit 为 24，Core 限制为 1–96。
Core 验证 Run 属于目标 Camp，非空 cursor 必须为正整数。

响应 `AgentRunExecutionWindowPage`：

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 1 |
| `campId` / `agentRunId` | 精确读取目标 |
| `requestedBeforeSequence` | 回显请求 cursor；null 为最新窗口 |
| `throughSequence` | 同一事务读取到的 Run 原始 Evidence 最大 sequence |
| `evidence` | 依逻辑首 sequence 升序排列的一页展示记录 |
| `hasMore` | 当前页之前还有展示记录 |
| `nextBeforeSequence` | 有更早页时为当前页最小逻辑首 sequence，否则 null |
| `activeEvidence` | 最新页之外仍未结束的 Canonical 操作；只在非终态 Run 的最新请求返回 |

按操作与 execution epoch 分页；同一 Canonical 操作的开始、完成及补充证据不拆成两页。
对外保留最新 Evidence ID 用于完整内容读取，展示 sequence 取该操作的首 sequence；补齐较早输入与
最新结果状态。正文 block、同 item 的旧 text delta、计划、诊断及 compaction 保留各自语义身份。
reasoning 和不进入执行台的传输增量不占分页项。`activeEvidence` 不推进历史 cursor，避免漏掉中间历史。

分页选择先查询身份与顺序，再 hydration 当前页；Canonical source IDs 一次展开后按 Evidence ID 关联，
不对每个 Evidence 重扫整个 Run 的所有操作来源。完整输出、Diff 正文和 Core Envelope 不随窗口传输。
文件行携带路径与增删数，Diff 字符串为空，延后到用户展开。窗口记录标记需要 content 读取，不能据此声称
原始 Evidence 或 Blob 被截断、修改或丢失。

已成功的纯 CLI 载体可以携带临时 `payload.executionWindowBuiltinOperation` 关联：Core 仅在完整 JSON
输出精确匹配生命周期内唯一可信 Core 操作的 Agent Result Projection 时提供；Renderer 仍验证 CLI 操作和
纯命令语法后才折叠。此关联支持相邻页边界，不返回用于比较的结果正文，不写回 Evidence 或 Canonical。

## 阅读、缓存与失败

Renderer 按详情可视高度估算页大小（12–48 项），首屏后只预取相邻更早一页。用户向边界滚动或点击
“载入更早记录”才翻页；预取成功不递归预取、不挂载内容。最多保留两页展示数据和一页预取数据，访问过的
cursor 可单独保留。该预算限制的是逻辑项，单条完整正文的像素高度不固定。

向前翻页保留当前阅读锚点，可载入较新记录或回到最新。失败保留已有内容，原位重试同一方向。
Camp/Run 切换、卸载、请求 generation 变化时丢弃旧响应；目标、cursor 或页内顺序不兼容的响应不应用。
运行中 invalidation 合并后刷新最新窗口；阅读历史时暂停跟随，在途刷新返回也不得覆盖历史阅读。

完整详情沿用 Camp-scoped `agentRunEvidence.getContent`，新增可选 `canonical` 返回当前操作的 Diff。
原始 `agentRunEvidence.list`、完整 Snapshot、Blob、审计和模型观察语义保持原边界。
渲染规则见 [Run Process Detail Surface v33](run-process-detail-surface-v33.md)。
