---
document_type: protocol-contract
contract: run-process-detail-surface-v43
authority: execution-evidence-block-and-group-pagination
status: accepted
version: 43
source_version: v1.72
last_updated: 2026-10-02
---

# Run Process Detail Surface v43

继承 [v42](run-process-detail-surface-v42.md) 的 operation 生命周期、结果永久预算与纯 Built-in Shell
关联。本版将可见 Run 主线与展开的 Tool 组分别分页，取代 v40 按已读取操作数量切割组摘要的窗口规则。
不新增数据库表、迁移、持久化分组身份或第二份 Evidence；不改变模型上下文和执行事实。

## 读取投影与身份

`agentRunExecution.page/changes` 沿用现有 Thread/AgentRun 归属验证与读取派发。请求不带新选择器时，
继续返回原 schema 2。选择 `projection: "blocks"` 返回 schema 3 的主线块；选择 `groupSequence`
读取一个 Tool 组。两者互斥。历史 CampTurn 归属继续有效，越域和无效游标拒绝。

Core 在同一个 SQLite 读事务内由已有 logical operation index 构造薄索引，只读取分类需要的元数据、
公开命令、canonical 状态与 diff 可用性，不读取普通输出、patch 或完整 narration。无 digest 的历史载体证明是兼容例外：只读取同 epoch 的相邻／包围候选结果，每个候选在一次请求内最多读取一次。正文、plan、diagnostic、
compaction 与 epoch 边界分隔连续 Tool 组；暂不可见的根项仍保留分组边界，以免后续补齐改变已存在组身份。
组键为 `tools:<首逻辑 sequence>`，根项为 `item:<sequence>`，只在当前 Run 范围使用。

块包含 `key/kind/sequence/lastSequence/changeSequence/toolCount/counts/evidence`。变更水位取组内最大
changeSequence，末条 sequence 不承担 revision。`counts` 按 completed/failed/stopped/recorded/running/waiting
完整统计可见逻辑操作；载体纯命令与精确结果关联同时成立时，Shell/Core 只算一步。没有可见 diff 的 patch、
私有思考和原生 userMessage 不增加组数。隐藏或结果未知不能伪造成功。

折叠块只投影最近操作与最近活动操作，及各自至多一个已证明的 Shell 载体，总共最多四条元数据；根块投影一项。
Shell 支持行只恢复原命令展示和结果来源，不增加步骤数。字段继承既有 metadata-only projection，结果和 patch
仍由精确行展开读取。已运行的活动操作可补充到最新页，终态 Run 不补旧活动状态。

## 主线页和增量

page 的 `beforeSequence/afterSequence` 互斥，以块首 sequence 排序和返回下一游标；limit 限制块数，范围
1–48。根项或一个完整折叠组各占一项，与组内命令数量无关。Renderer 首屏按视口估算 4–24 块，后续每页 12 块，
只预取相邻更早一页；输出不预取。

changes 使用 Run-wide `afterChangeSequence`，每次最多 96 个改变的块，按变更水位推进；旧子项结果更新必须更新
同一个组摘要。已读 streaming 正文另用至多 256 个 refreshEvidenceIds 请求 refreshedBlocks，叠加内存正文但不推进持久水位。变成不可见的块返回空摘要，使客户端原位移除其显示。主线最多保留 2,048 块／8 MiB 元数据，
视口和尚未结算活动受保护；超限淘汰相反方向，重新阅读用游标恢复。跨 Run 缓存沿用最多 8 Run／24 MiB。

## 展开组独立分页

`groupSequence` 绑定组首 sequence；返回 schema 3、同组标识、请求/下一 before/after 游标、hasMore、
throughChangeSequence 和有界 Evidence。不存在的组、冲突游标和归属错误拒绝。limit 为 1–96，Renderer 每页
24 个逻辑操作。历史组先读开头；正在跟随的尾组先读末页，可向前补读。载体是组内的物理逻辑项，可能不产生可见行，
分页数量不能作为完成步骤数。

组内增量沿用 schema 2 Evidence changes，额外要求 groupSequence、fromSequence，可带 toSequence。
只更新当前已读区间；已到尾部时可接新操作。每批最多 96 项，完整推进水位，旧 revision 不覆盖新状态。
子窗口最多保留 512 项／2 MiB，和正文、结果、展开状态共用 Run 内容缓存；收起取消在途应用，重开复用已读部分。

组的首尾加载入口留在内容流中，复用 Run 的原生滚动容器，不建立嵌套滚动框。接近边界自动续接，按钮保留键盘
可达与失败重试。失败保留已读内容，停止自动重试；重试仍使用失败操作的方向和游标。前插历史保持可见行锚点，
用户在历史中的位置不被新输出抢走，原有 disclosure、焦点和结果缓存继续有效。

## 初次进入与自动续接

仅可见且展开的 Run 开始读取。首屏如果因折叠摘要短而不足以覆盖视口及 80px 缓冲，自动消费／读取较早页，
最多补三页；内容已足够、无更早项、发生错误、用户开始历史阅读或展开行的锚点生效时停止。
没有滚动条时向上滚轮／键盘到边界也能请求历史，不要求先发生 scroll 事件。组内自动连续读取同样每轮最多三页，
新的用户滚动意图恢复预算。手动入口始终保留。

自动补页不改变 follow-latest 意图；跟随中的最新输出仍到末尾。加载失败把原位重试入口展示在可见区域，停止
自动重试。关闭 Drawer、收起 Run、切换 Thread 或旧异步结果均不能触发后台遍历。

## 性能与验收边界

折叠传输量取决于块数及有限代表项，不取决于长组的命令数。薄索引仍按 Run 历史长度扫描，建立有序候选索引的成本为 O(N log N)，历史包围候选比较另计，
不是常数时间读取，也没有新增持久化聚合表。当前选择减少传输、序列化正文与 Renderer 工作，接受读取端元数据扫描；现代单记录载体只比较相邻 Core 候选，禁止每条 Shell 再扫描整个 Run；
后续如优化索引必须保留相同身份、分类与快照水位，不用缓存猜测执行事实。

验收覆盖：万条闭合 command 的有界首屏；同组双向游标与旧子项更新；纯载体与混合命令计数；首次短内容自动补齐；
首屏与组内错误重试；真实 Electron 两种布局中的滚动锚点、键盘焦点、懒加载输出和缓存重开。
