---
document_type: implementation-plan
version: v0.12
lifecycle: current
authority: implementation-plan-and-acceptance
last_updated: 2026-07-26
---

# Rovai-ai v0.12 实施计划与验收清单

> 状态：实施完成；编码检查点 7/7
>
> 版本范围：[README.md](README.md)
>
> 跨版本决策：[ADR-0049](../../adr/0049-reproducible-context-delivery-v2.md) ·
> [ADR-0050](../../adr/0050-camp-shared-progressive-summaries.md) ·
> [ADR-0051](../../adr/0051-boundary-capped-context-retrieval.md)

检查点按依赖顺序排列，每步独立可验收。demo 阶段原则：直接删除被替代的表、字段与代码路径，
不做冻结保留或兼容读取；历史数据允许有损迁移，但迁移顺序必须尊重外键与状态机依赖。

## 检查点 0：协议切换（三篇 ADR 通过评审时原子执行，先于一切编码）

ADR-0049/0050/0051 已通过评审并与 ADR-0009 的替代关系原子切换：

- [x] ADR-0049/0050/0051 状态置 `accepted`（frontmatter 与索引行）。
- [x] ADR-0009 状态置 `superseded`，`superseded_by: ADR-0049`（frontmatter 与索引行）。
- [x] 8 处规范性引用改指 ADR-0049：0012:122、0016:102、0027:23、0031:20、
  0032:72、0032:105、0033:23、0033:65（0016:19 为历史叙述，保留原文）。

## 检查点

### 1. Context Read Marker 更名

- [x] `conversation.native_delivered_camp_message_sequence` 经 `ALTER TABLE ... RENAME COLUMN`
  更名为 `native_read_through_camp_message_sequence`，数据保留。
- [x] 代码内全部引用点（context.rs / runtime.rs / team_tool.rs / db.rs）随更名同步；
  CAS 单调推进、接受前不推进、模糊崩溃先对账的语义零变更。
- [x] 文档与注释使用 Context Read Marker；不再出现 "delivery cursor" 与 "Lumen"。

### 2. 公共消息去物化与旧摘要机制删除

迁移顺序固定如下，不得调换（外键与状态依赖：`context_compaction_attempt.generated_summary_id`
外键指向 `context_summary`；waiting Run 依赖 attempt 唤醒）：

- [x] ① `agent_run` 新增 `trigger_camp_message_id`，约束按 ADR-0049：
  「二者不得同时非空」+「`input_ready_at` 非空时至少其一非空」，兼容 A2A 延迟投递的
  `queued + input_ready_at IS NULL + 双空` 中间态（collaboration.rs:2092 既有流程）。
  历史 Run 按 `conversation_message.source_camp_message_id` 映射回填
  `trigger_camp_message_id` 并清空对应 `trigger_conversation_message_id`。
- [x] ② 删除全部 camp 来源的 `conversation_message` 行；`conversation_message`
  仅承载 A2A 投递与运行产物。
- [x] ③ 历史 `waiting(context_compaction)` Run 终态收敛，字段按真实 schema：
  `status='cancelled'`、`ended_at=now`、`last_error_code='superseded_by_v012_migration'`、
  清空 `wait_reason`/`wait_deadline_at`、清空 `execution_lease_owner`/`execution_lease_expires_at`
  （成对 CHECK）；不设 `manual_retry_allowed`。所属 CampTurn 按既有规则重算并随之终态；
  「允许重新触发」指用户以新消息发起新 Turn，不承诺原 Turn 复活。
- [x] ④ `context_manifest` 删除 `context_summary_ids_json` 列，新增
  `camp_summary_ids_json TEXT NOT NULL DEFAULT '[]'` 与
  `coverage_baseline_sequence INTEGER`；不改写任何历史行的既有值（旧引用随列删除整体消失，
  审计事实源仍是冻结 Blob）；Manifest 读取方（Inspector 等）改读新列并对 `'[]'` 容忍。
- [x] ⑤ DROP `context_compaction_attempt`（`_v15` 是历史迁移事务内的临时表名，正常库中
  不存在，仅需随代码删除该迁移路径）。
- [x] ⑥ DROP `context_summary`，删除 `visibility_scope_digest` 概念及全部相关代码路径。
- [x] ⑦ 删除公共前缀物化逻辑（collaboration.rs materialize 路径）、gap 校验与
  `conversation.last_seen_camp_message_sequence` 字段；`load_current_input`
  按触发来源分支读取 `camp_message`（含 tombstone 过滤）或 `conversation_message`。

### 3. 派生索引层

- [x] `camp_message` 新增 `content_digest`（正文 SHA-256），写入时计算，历史行回填。
- [x] 建 `camp_message_fts`（FTS5 trigram，external-content 挂 `camp_message.body`），
  含 tombstone 与重建同步逻辑。
- [x] 建 `camp_message_reference`：写入事务内抽取文本模式 `ADR-\d+` / `PR-\d+` /
  `issue-\d+`（大小写归一），以及消息文本中完整 UUID 与 `task.id` 精确比对命中的
  Task 引用（`kind='task'`）；不抽取 `task-\d+`。
- [x] 建 `camp_message_mention`：自 `addressed_agent_profile_ids_json` 派生。
- [x] 单行 meta 表记录 `index_version`；提供整层重建入口，重建后结果与增量维护一致
  （以既有数据做一致性断言测试）。

### 4. camp_summary 与异步生成

- [x] 建 `camp_summary`：camp 归属、`level ∈ {segment, epoch}`、覆盖区间、`source_digest`
  （ADR-0050 规范化输入摘要）、`input_truncated`、正文上限 2,000/4,000 字符、生成者元数据、
  行不可变；`UNIQUE(camp_id, level, from_sequence)` 与 `UNIQUE(camp_id, level, through_sequence)`
  兜底；Epoch 记录有序来源 Segment ID 列表。建 `camp_summary_fts`。
- [x] 建 `camp_summary_frontier(camp_id, level, next_from)`；重建
  `context_compaction_attempt`：锚定 `camp_id + level + 覆盖区间`，携带
  `lease_owner`/`lease_expires_at` 与重试计数；部分唯一索引「`(camp_id, level, from_sequence)`
  WHERE 非终态」；成功事务原子完成「插入摘要 + 前沿 CAS 前进 + attempt 条件终态」；
  自动重试 ≤ 3 次复用同一 `from`，耗尽走失败升级。并发双 Worker 测试：同一 `from`
  只能诞生一条摘要。
- [x] 建 `context_compaction_waiter(attempt_id, agent_run_id UNIQUE)`；attempt 终态时
  处理全部等待者（成功→恢复投递组装；失败→挂到重试 attempt）；并发第二等待者只追加
  waiter 行。Camp 删除路径迁移：按 `camp_id` 取消非终态 attempt，级联删除
  attempt/waiter/frontier/summary（替代经 `attempt.agent_run_id` 的旧 blocker，
  collaboration.rs:3568）。
- [x] 关段规则（ADR-0050）：积压与预算按完整规范化输入字符计；触发 ≥ 60,000 字符或
  ≥ 300 条；贪心吸收至「下一条将越界」或 300 条即关闭（越界强制关闭可产生 < 100 条小段）；
  单消息超限独立成段 + 确定性截断 + `input_truncated`；不得主动清尾。
  专项测试：两条 32K 消息、单条 70K 消息均能产出合法分段。
- [x] 摘要输入契约：未 tombstone 的 `camp_message` + 附件元数据；system 事件消息计入；
  附件正文与私有内容不可达。
- [x] 应用级摘要模型设置（AdapterInstallation + Model）；未配置时异步路径回退
  Default Lead、按需路径回退等待者 Adapter/Model；隔离无工具压缩会话。

### 5. 投递改造

- [x] 统一组成算法（ADR-0049，正常/溢出/Bootstrap 共用）：软预算
  min(Adapter 切片, 60,000 字符) 约束原文部分；预算内全原文；溢出时按
  「摘要正文（≤ 24,000 字符预算，自新向旧）→ Coverage Baseline 声明 →
  未覆盖尾部全部原文 → 最近 30 条无条件原文 → 点名补注（≤ 20 条）→ Briefing」组装；
  未覆盖序列不得静默跳过。
- [x] Manifest 冻结 `camp_summary_ids_json` 与 `coverage_baseline_sequence`。
- [x] Context Briefing：总量 ≤ 8,000 字符；序号锚定区段封顶 boundary（含全史摘要目录
  统计仅计 `through ≤ boundary`、Coverage Baseline 声明、涉及本 Agent ≤ 20、引用聚合 ≤ 20）；
  状态区段（Task/ActionRequest 各 ≤ 10）为组装时点快照并随 Manifest 冻结；
  截断显式标注 `truncated` 与省略数；Bootstrap 专属上次发言位置。
- [x] Marker 四种覆盖证明测试：原文交付、摘要正文交付、当前代际自身输出、
  Coverage Baseline 声明。回归场景：31–99 条未覆盖尾段（普通与 Bootstrap 双路径）、
  未读中含当前代际自身消息、换绑后旧代际自身消息按普通历史投递、
  超长历史 Bootstrap 摘要超预算落入基线。`waiting(context_overloaded)` 语义保留。

### 6. context.* 工具组

- [x] Team MCP 网关新增 `context.search` / `context.get_message` /
  `context.get_message_window` / `context.get_message_thread` / `context.get_summary`，
  只读、无新 Capability、Camp 取自 Run fence、无 `campId` 参数。
- [x] 输出纪律（ADR-0051）：单条正文注入 ≤ 4,000 字符（`bodyTruncated`/`bodyLength`，
  `get_message` 凭 `bodyOffset`/`bodyLimit` 续读）；单次响应 ≤ 16,000 字符（续取游标）；
  附件元数据每条 ≤ 10 项；search `limit` ≤ 20、片段 ≤ 200 字符、
  排序「引用命中 → BM25 → 序号降序」；window 半径 ≤ 25；thread 单次 ≤ 100 条可续取。
- [x] 全部结果封顶 `sequence ≤ camp_message_boundary_sequence`；部分越界摘要整条不可见
  （含 `context.get_summary`）；tombstone 实时过滤。
- [x] 查询字面量化：FTS MATCH 短语包装（内部引号转义）、LIKE `ESCAPE '\'` 转义
  `%`/`_`/`\`；短查询（< 3 字符）回退有界 LIKE 扫描（≤ 10,000 行，
  `scanBounded`/`scannedThroughSequence`/`hasMore`）。
- [x] 专项测试：边界封顶、tombstone 实时性、双字中文查询、`%`/`_`/引号注入、
  超长正文截断与续读、响应总量截断游标、`references` 精确命中优先。

### 7. system 事件消息

- [x] 用户审批决定（批准/拒绝）与 Task 状态变更写入 `author_type='system'` 的
  CampMessage，进入序号轴、增量投递、摘要与搜索。
- [x] UI 将 system 消息渲染为事件行；不新增 recentEvents 旁路通道。

## 验证命令

```bash
cargo fmt --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm typecheck
pnpm test
pnpm smoke:core
```

摘要生成与投递路径必须由不调用真实模型的测试覆盖（关段规则含超长消息、前沿 CAS 与
双 Worker 并发、租约接管、等待者广播、回退链、waiting 状态、Marker 四种覆盖证明、
双路径尾段无缺口、Coverage Baseline、边界封顶、短查询回退与转义、响应体上限、
索引重建一致性）；真实模型 Smoke 仅在检查点 4 与 5 合入后各执行一次。
