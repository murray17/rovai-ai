---
document_type: implementation-plan
version: v0.17
lifecycle: historical
authority: implementation-plan-and-acceptance
last_updated: 2026-07-28
---

# Rovai-ai v0.17 实施计划与验收清单

> 状态：生产代码与自动测试已完成；真实 Runtime smoke 和打包 App 验收待完成
>
> 版本范围：[README.md](README.md)
>
> 详细设计：[architecture.md](architecture.md)
>
> 跨版本决策：
> [ADR-0061](decisions.md#adr-0061) ·
> [ADR-0062](decisions.md#adr-0062) ·
> [ADR-0063](decisions.md#adr-0063)

`[x]` 只表示有对应文档、代码、Migration、测试或可复现 App 证据。ADR
`accepted` 不表示实现完成。

## 实施启动门

- [x] 重大架构与 UI 决策逐项确认完成。
- [x] v0.16 三份版本文档冻结为 `historical`，v0.17 成为唯一 `current`。
- [x] ADR-0061/0062/0063、版本设计、CONTEXT 与 UI 约束落文档。
- [x] 向用户交付纯文档变更，并停在生产代码实施之前。
- [x] 用户在该停点后明确要求开始编码。

## 检查点 1：权威存储与 Contracts

- [x] 冻结 Migration v28、Read Model schema v9 和 Evidence 16 KiB inline/blob 阈值。
- [x] 新增 AgentRun Execution Evidence 表、Run 内顺序、幂等身份和 Camp/Run 索引。
- [x] 将 Evidence Blob 引用加入 Managed Blob GC root。
- [x] 为新 Camp system message 增加关闭的 Task/A2A structured presentation payload。
- [x] 不重写旧 system body；Renderer 保留安全纯文本 fallback。
- [ ] Contracts 增加 evidence summary/detail、pagination、truncation 与 content read。
- [ ] AgentRun view 增加 duration、evidence count 和
  `hasUnsettledExternalEffects`。
- [x] Stop response 明确 CampTurn、被 fencing Run 数和未决效果提示。
- [x] Electron Main/Preload 只开放所需只读方法，Renderer 不取得 Blob path/SQLite。

说明：当前 Contracts 已包含 Evidence preview、truncation、Blob 内容读取和
`hasUnsettledExternalEffects`，Camp snapshot 使用最新 1200 条有界恢复；独立分页合同、
AgentRun 聚合 evidence count 字段尚未增加，因此上面两个组合项保持未完成。

验证：

- fresh DB 与 v0.16 fixture migration；
- FK、唯一序号、幂等重复、分页顺序和 Camp authorization；
- inline/Blob 边界、摘要、截断、内容读取与 Camp deletion GC；
- Contracts unknown-field、schema version 和 Main allowlist。

## 检查点 2：Runtime Evidence 与 Agent 隔离

- [x] 为 Codex/App Server 与 ACP 事件建立统一 normalized evidence mapper。
- [x] 只接收 Runtime 公开 reasoning summary，不保存隐藏 reasoning/raw packets。
- [x] tool call/result、command、file change 使用 kind-specific structured payload。
- [x] 大输出写 Managed Blob，SQLite 保存有界 preview 与显式 truncation。
- [x] 先验证 Binding/Run/epoch，再保存 evidence；fenced Run 拒绝新 evidence。
- [x] live event 带稳定 evidence ID，Renderer 可与 snapshot 幂等合并。
- [x] Camp snapshot/专用 API 可在 reload/restart 后恢复有界 Evidence，截断正文可单独读取。
- [x] 删除以 Renderer ring buffer 作为唯一事实源的语义；ring 只作低延迟缓存。

必须增加反向泄漏测试：

- [x] Evidence 表没有 FTS trigger，Camp search 数据源不包含 Evidence。
- [x] Segment/Epoch summary source query 不读取 Evidence/Blob。
- [x] ContextManifest payload 与 Context Read Marker 不引用 Evidence。
- [x] A2A target input 和后续 direct Run input 不包含 evidence marker/content。
- [ ] Memory Proposal/Projection 不能把 Evidence 当来源。
- [x] 新 Evidence mapper 使用公开字段 allowlist，不持久化原始 provider packet。

说明：ContextManifest 反向泄漏、公开字段归一化和取消后迟到 Evidence 已有自动测试；
Memory 路径的专门反向测试仍待补充。

## 检查点 3：可靠停止与恢复

- [x] `campTurns.cancel` 接受 active CampTurn，不再因 delivery/action unknown 拒绝。
- [x] 事务内解析 direct、多目标和 A2A descendant 非终态 Run。
- [x] 建立 cancel fence，关闭 Team Tool、消息、Evidence 和后代创建入口。
- [x] 对 live Runtime 发 native interrupt；queued/waiting/recovering 无进程路径可 ACK。
- [x] Run/CampTurn cancellation terminal 与 external certainty records 解耦。
- [x] 已派发 Action 转为 active unknown；未派发项安全关闭，不伪造回滚。
- [x] Read Side 派生“已停止 · 结果待确认”。
- [x] 迟到 terminal/message、Evidence 与 Team Tool 写入受 Run/epoch/cancel fence 拒绝。
- [x] 取消幂等；Core 重启后 coordinator 可继续处理 cancellation candidate。

验证矩阵：

- direct Run：queued / running / waiting approval / recovering；
- multi-target CampTurn；
- Lead → Agent → Agent 两层 A2A；
- Runtime interrupt 成功、明确失败、无 live process；
- runtime input prepared/delivery_unknown；
- Action executing/outcome_unknown；
- stop 后旧 callback 与新 CampTurn 并存；
- 重复 stop、Core 重启、App 重连。

## 检查点 4：Context 与 A2A correlation

- [x] 提升 formatter version/compatibility digest。
- [x] ordinary user Run 完全不渲染 `[TURN_ENVELOPE]`。
- [x] A2A Run 渲染精确三行最小区段，非 JSON。
- [x] `senderName`/`senderId` 从可信 source AgentProfile 解析并冻结。
- [x] payload 的任何其他区段都不包含 `sourceInboxMessageId` 或 reply linkage ID。
- [x] 旧 ContextManifest 恢复保持原 Blob 字节，不按新 formatter 重组。
- [x] `team.post_message` model-visible Schema 不变。
- [x] 显式 `inReplyToMessageId` 继续按反向关系严格验证。
- [x] 缺省 linkage 只在 recipient=当前 A2A source sender 时后台补全。
- [x] 第三方 recipient、direct user Run、source 无效时不补全。
- [x] 派生 linkage 与命令结果原子保存且幂等。
- [x] 不增加 final auto-return、auto-wake、自动 Run 或 Run/message merge。

验证应直接断言完整 frozen payload，而不是只搜索一个字段。

## 检查点 5：Renderer 会话体验

### Composer

- [x] active CampTurn 时发送按钮在原位置变为 danger“停止”。
- [x] textarea 保持编辑，草稿跨 stop 状态切换不丢失。
- [x] `Enter` 在 send mode 发送、`Shift+Enter` 换行；输入法组合态、@候选和
  stop mode 不误提交或停止。
- [x] 首条消息不重复预检/导航/Lead 校正；Core 在原子提交后立即响应，Run 启动时
  再完成精确 Skill/Memory 投影准备。
- [x] 首条消息的 `commandId` 绑定冻结后的单次请求；仅同一请求在响应未知时复用，
  修改正文、项目或接收成员后生成新 ID，Core 明确接受或拒绝后再次提交也生成新 ID。
- [x] stopping 防重复；刷新权威 snapshot 后恢复发送。
- [x] 未决效果显示警告，但不继续占用 Composer。

### Execution disclosure

- [x] 每个 AgentRun 单独绑定 evidence，不跨 Run/Agent 合并。
- [x] running 外层默认展开；Thinking 流结束折叠、Progress 保持展开、Steps 默认
  折叠；terminal 时三者与外层折叠为 `Worked for …` 类摘要。
- [x] 用户手动展开/折叠在当前页面会话内稳定。
- [x] canceled/failed 且无 final message 的 Run 仍有终态披露。
- [x] reload/restart 从 SQLite 回显，不依赖先前 live events。
- [x] tool/command/file 结构化展示状态、时长、cwd、exit code 与输出。
- [x] truncation、Blob loading/error 状态可见。

### Markdown 与复制

- [x] 新建统一 SafeMarkdown 组件，支持 GFM table/code/list/link。
- [x] 禁止 raw HTML、script、dangerous URL 与 remote embed。
- [x] tool output 不经过 Markdown。
- [x] 用户正文保留纯文本、选择和键盘可访问复制。
- [x] 长表格/代码使用局部滚动容器。

### Timeline cards

- [x] Task event 使用 structured payload，不解析英文 body。
- [x] 卡片显示事件时 title/status/assignee/time，点击打开当前 Task 详情。
- [x] 后续 Task 编辑不改历史卡；Task 当前不可见时给出说明。
- [x] A2A request/result 使用真实 CampMessage sequence/time。
- [x] A2A 卡不显示私有 body、Run/Inbox ID 或 correlation。
- [x] Agent final 和事件始终按 authoritative CampMessage sequence 展示，不人为重排。

## 检查点 6：自动验证与真实 App 验收

计划命令：

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm typecheck
pnpm test
pnpm smoke:core
pnpm smoke:multi-agent
pnpm smoke:team-context
pnpm package:mac
codesign --verify --deep --strict <packaged-app>
```

已新增 `pnpm accept:v0.17`，当前组合：

- v28 migration；
- Evidence persistence/Blob/anti-leak 与公开字段归一化；
- cancellation persistence 与迟到 Evidence fencing；
- Turn Envelope 与 reply correlation exact contracts；
- Renderer SafeMarkdown、Composer stop、evidence fold、Task/A2A cards。

真实 Runtime stop/reload/A2A smoke 与 Day/Night 双尺寸打包 App 截图继续作为发布前手工
验收，不伪装成当前自动脚本已经覆盖。

真实 App 场景：

1. Codex 产生 reasoning summary、plan、command 和 final；运行中展开，完成后折叠；
2. 离开 Camp、重开 Camp、重启 App，证据仍在；
3. 在证据中放一个只存在于 tool output 的唯一词，Camp 搜索和下一 Run 均无法读取；
4. Lead → 第二 Agent → 第三 Agent 的 A2A 链中停止整个 Turn，所有后代终止；
5. 模拟/制造 delivery unknown，Composer 仍恢复并显示结果待确认；
6. 下一条新消息正常执行，旧 callback 不能污染；
7. Task 状态卡打开 Inspector 当前状态，历史卡字段不随更新变化；
8. A2A target payload 只有最小 envelope，显式回信缺省 linkage 得到后台关联；
9. ordinary user payload 无 envelope，且不存在 Inbox correlation ID；
10. Markdown table/code 正确，恶意 HTML/远程图片不执行，用户消息可复制。

## 当前证据

截至 2026-07-28：

- [x] 用户确认 Stop、证据隔离、折叠、Markdown、Task/A2A 卡和最小 Turn Envelope；
- [x] 确认 A2A 仍是显式发送，不自动 return/wake/merge；
- [x] 确认 source Inbox correlation 仅后台关联，不暴露给模型；
- [x] ADR-0061、ADR-0062、ADR-0063 和 v0.17 文档已建立；
- [x] 生产代码；
- [x] Migration v28 与 Contracts/Read Model v9；
- [x] Core 与 Renderer 自动测试；
- [ ] 真实 Runtime smoke；
- [ ] 打包 App 验收。

本轮已通过：

- `cargo test -p rovai-core --lib`：186 passed；
- `cargo clippy -p rovai-core --all-targets -- -D warnings`；
- `pnpm typecheck`；
- `pnpm test`：20 files / 99 tests；
- `pnpm build:desktop`；
- `git diff --check`。
