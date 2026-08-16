---
document_type: version-overview
version: v0.96
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
model_context_change: false
last_updated: 2026-08-17
---

# Rovai-ai v0.96：运行监控与原生 Usage 观测

> 当前状态：clean-break Schema、专用 Usage 模型、统一快照接口、设置页与脱敏导出已实现；自动门禁、
> arm64 macOS 打包和隔离 Application 空态验收已通过。真实 Runtime/version smoke 与 populated/partial
> Application 场景尚未完成，因此未把 Fixture 结果写成完整兼容性结论。
>
> 前置版本：[v0.95 官方 Skill 测试去文案化与协议去重](../v0.95/README.md)

## 版本目标

在设置工作区增加应用级“运行监控”，以三个只读视图呈现运行概览、Usage/成本及性能/可靠性。
Core 从现有 AgentRun、Delivery、Approval、Compaction 和 Canonical Activity 读取可复核事实，同时在
Runtime Transport 边界采集原生 Usage。不同 Runtime 实际上报多少就保存多少；缺失字段保持 `NULL`，
Coverage 明确显示，不使用统一完整能力假设掩盖协议差异。Context omission/Bootstrap redelivery 与
Runtime Probe/认证/活跃 Host 尚未进入本版快照，不能从 enrolled Run health 反推这些事实。

本版本采用监控域 clean break。新监控 collection epoch 之前的 AgentRun、Session、Usage、Tool Duration
和成本不回填、不扫描、不推断，也不进入 v0.96 监控分母。旧 Core 业务事实原样保留，但只有 cutover 后
显式 enrollment 的新 AgentRun 属于监控数据集。

## 设计基线

- 当前实施基线：`4b4fe088`；
- [指标可采集性审计](../../research/runtime-monitoring/README.md)；
- 用户提供的运行监控 HTML、Research 与 Codex Brief 只作为需求和原型输入，不拥有仓库合同；
- [ADR-0201](../../adr/0201-sparse-runtime-usage-and-clean-break-monitoring.md)拥有长期权威边界；
- [Runtime Monitoring v1](../../contracts/runtime-monitoring-v1.md)拥有字段、查询、NULL、Coverage 与成本层级；
- [Runtime Monitoring 架构](../../architecture/runtime-monitoring.md)拥有组件和采集/查询链。

## 交付范围

- 建立持久化 Monitoring Collection Epoch 与逐 AgentRun/execution epoch enrollment；
- 新增独立、稀疏的 Runtime Usage Observation、持久 source dedupe、版本化归一化投影、Run/hour rollup
  与 parser state；Runtime Update 先在内存合并，运行期间由全局 4 秒节拍批量持久化，终态强制 Flush；
- 新增唯一只读 Core 方法 `monitoring.snapshot` 及 Desktop bridge；一次一致性事务组装概览、Usage 与可靠性，
  页面和导出都不为每张卡片重复 IPC；
- recovery execution 保留逐 epoch 事实，但 lifecycle/trend/Coverage 按 logical AgentRun 去重；新 epoch 不重复
  增加 Run rollup，终态迁移首次 enrollment 拥有的唯一状态行；
- 接入 cutover 后的 AgentRun lifecycle、Runtime Input Delivery、Approval、Compaction observation 和
  Canonical Activity；Context omission/Bootstrap redelivery 与 Runtime Probe fleet 仍列在实施计划未完成项；
- 为新 Run 持久化 Native Session resume request、disposition、outcome、fallback 与 reason；
- 对 Rovai 自有 Tool 和具有稳定 operation identity/started/terminal 的 Runtime Activity 计算已覆盖 Tool
  duration，同时返回 paired/eligible/Coverage；
- 扩展 Claude Code、Codex CLI 和 Copilot CLI 的原生 Usage parser 与 Fixture；
- 建立统一 ACP Usage Parser，读取标准 `usage_update` 与经 Fixture 证明的终态私有字段；OpenCode、Kiro、
  Qoder、CodeBuddy、Qwen Code、TRAE CLI 各有独立 Fixture，但尚未完成本机真实版本 smoke；
- Antigravity 原生 Usage 保持 unavailable；本版本没有启用本地 Tokenizer，因此也不制造 Input/Output 粗估、
  Cache 或费用；
- 成本模型可分层保存 Runtime reported/estimate、price estimate、Provider reconciled 与 allocated；当前只展示
  已持久化的 Runtime 层，没有 Provider 对账连接、价格目录或页面刷新时同步；
- 设置页实现“概览 / 用量与成本 / 性能与可靠性”，同步 24h/7d/30d 范围、Runtime/成员筛选、
  available/partial/unavailable、Coverage、freshness 和脱敏聚合导出。页面可见时以 12 秒间隔轮询，隐藏或
  离开设置项即停止；持久化/终态事件通过 300ms debounce 合并刷新。

## 性能与读取边界

- Usage Update 不写 Execution Evidence，也不逐条触发 SQLite 写入或 Renderer 事件；内存合并保留持久 source
  identity dedupe，4 秒批次在一个短事务内更新 observation、Run rollup 与小时 rollup；
- AgentRun terminal、Runtime Host exit 和 Core shutdown 都尝试强制 Flush 尚未持久化的 Usage；
- 历史趋势只读取 `monitoring_run_rollup_hourly`，页面刷新不扫描原始 Usage、Execution Evidence、Blob 或
  Runtime Transcript；首个可见活动与 Evidence 数量读取 enrollment/canonical projection 的标量字段；
- `monitoring.snapshot` 在 Core 单一 Database Mutex 下使用一个短 read transaction；持锁期间不读 Blob、
  不解析 Runtime transcript/大型 JSON、不执行网络请求或 Provider 对账；生命周期/P95、Usage/Context、
  精确十进制 Cost、Delivery、Approval 与 Tool timing 都使用 SQL CTE/window/aggregate 返回标量或受控维度
  分组，不无界物化 Run、Usage、Cost 或活动明细；
- Renderer 同一时刻最多一个 snapshot 请求在途，poll/event/manual/filter 重叠触发只合并一次后续刷新；
- 当前不引入独立 SQLite 读连接。只有实际数据规模和 profiling 证明需要时，才另行设计读写并发。

## Clean-break 边界

- Migration 只创建空监控表和唯一 collection epoch，不为旧 Run 建 enrollment；
- 不扫描旧 Runtime transcript、私有日志或未知路径，不从旧 Resume Attempt 反推精确 Session 延续；
- 不回填 Token、Cache、Context Token、Tool Duration、成本或 rollup；
- 查询窗口截断到 `collectionStartedAt`，并向 Renderer 返回可展示的 collection boundary；
- cutover 时已经 active 的 Run 不 enrollment；下一个新 AgentRun 才开始完整采集；
- clean break 只隔离监控域，不删除或改写旧 AgentRun、Evidence、Approval、Context、Recovery 或 Runtime 状态；
- Runtime 未上报字段仍为 `NULL`，不能因为 clean break 或 parser support 而补零。

## 指标口径

- 成功率分母只含可靠 terminal Run；
- Queue 为 `startedAt - createdAt`；end-to-end 为 `endedAt - createdAt`；execution duration 为
  `endedAt - startedAt`，三者不共享名称；
- Transport input acceptance 为 `acceptedAt - preparedAt`；
- First visible activity 为 enrollment 中持久化的 `firstVisibleActivityAt - acceptedAt`；投影来源仍是首个
  合法 Evidence，但查询不扫描 Evidence，也不称为首 Token；
- Token Cache Read 占比为
  `cacheRead / (uncachedInput + cacheRead + cacheWrite)`；
- Reasoning/Thought 默认是 Output 子分类，不与 Output 重复相加；
- P95 rollup 使用可合并 histogram/sketch 或明细重算，不对小时 P95 再平均；
- Tool duration 同时区分各调用 elapsed sum 与并行区间 wall-clock union；未配对调用只影响 Coverage；
- Session cumulative/gauge 不直接相加；resume baseline 不可靠时只保存 Gauge，不归因到当前 Run；
- ACP Cost 缺少显式合法 currency 时保持未知；Session Gauge Cost 只保存 raw observation，不写 Run/range 总额；
- best-available cost 先逐 logical Run 选择最高质量，再跨 Run 汇总；混合质量保留多项，不丢掉没有高层数据的 Run；
- Provider bucket 无稳定 request linkage 或隔离维度时不得称为单 Run 真实成本。

## 明确不做

- 不回填或兼容读取 pre-cutover 监控数据；
- 不把 Usage 混入 AgentRun Execution Evidence、CampMessage、模型上下文、Memory 或全文搜索；
- 不因同属 ACP 而假设各 Runtime 共享完整 Usage 方言；
- 不把缺失字段、无事件、unsupported Runtime 或未知 parser 结果显示为 0；
- 不把工作区 diff、最终输出或命令标题反推为未报告 Tool Activity；
- 不把首次 Evidence 称为 Provider 首 Token；
- 不默认代理、拦截或重写 Runtime 的 Provider 网络请求；
- 不在运行监控页配置 Provider Admin Key、账单连接、价格凭据、隐私开关或保留周期；
- 不把公开价估算、Tokenizer 粗估、Runtime estimate 或聚合账单分摊称为真实单 Run 账单；
- 不让监控清理删除 Core 权威执行、审批、上下文、恢复或证据事实。

## 验收边界

- pre-cutover 与 cutover 时 active 的 Run 不进入监控快照，三个子视图共享同一 collection boundary；
- 同一原始事件重复、乱序、parser replay、counter reset 或 resume 不会导致 Token/Cost 翻倍；
- Claude、Codex、Copilot 的成功、失败、取消、resume 和重复事件 Fixture 通过；
- 六个 ACP Runtime 分别有当前版本 Fixture；Fixture 没有证明的字段保持 `NULL`；
- Copilot 真实 prompt-response Usage 的 cache-inclusive Input 被正确归一化，Thought 不重复计入 Output；
- Antigravity 不出现原生 Cache、Provider Token 或真实成本；粗估始终显示 `tokenizer_estimated`；
- Native Session 延续率只使用 cutover 后一等 outcome；fallback/new/rejected 可审计；
- Tool Duration 仅使用稳定身份与 started/terminal 配对，并显示 paired/eligible Coverage；
- 成本层不互相覆盖；无法精确映射的 Provider bucket 只显示聚合或 `allocated`；
- 三个 Tab 读取同一 `monitoring.snapshot`，range/filter 一致，切换 Tab 不发起重复 Core 查询；
- 1040×700、1440×920、双主题、键盘、200% zoom 与无页面级横向溢出验收通过；
- Rust、TypeScript、Renderer、Migration、parser fixture、rollup、文档和真实 Runtime smoke 按计划通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.95 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引和前后版本链接建立唯一 current v0.96。 |
| ADR | 已更新 | [ADR-0201](../../adr/0201-sparse-runtime-usage-and-clean-break-monitoring.md)冻结稀疏 Usage、Evidence 分离、collection enrollment、成本粒度和无历史回填边界。 |
| Contracts | 已更新 | [Runtime Monitoring v1](../../contracts/runtime-monitoring-v1.md)定义观察、Session fact、查询、Coverage、NULL、Tool duration 和 Cost wire。 |
| Architecture | 已更新 | [Runtime Monitoring 架构](../../architecture/runtime-monitoring.md)定义 Transport parser、raw observation、projection、rollup、read side 和 Provider bucket 组件职责。 |
| UI | 已更新 | 新增 [Runtime monitoring surface brief](../../../apps/desktop/.impeccable/surfaces/runtime-monitoring.md)，冻结 clean-break、稀疏 Coverage、成本分层、freshness、Tab 与状态矩阵；仍复用现有视觉系统。 |
| Runtime Activity | 确认无需更新 | Usage 与成本明确不进入 Execution Evidence/Canonical Activity；Tool duration 只消费既有稳定 operation identity。若实施新增映射，必须另按 Registry 门禁更新。 |
| Runtime compatibility | 确认无需更新 | 当前仅建立采集计划；Runtime 能力表必须等各版本真实 Fixture/smoke 后按实测更新，不能用协议可能性提前晋升。 |
| Documentation routing | 已更新 | 文档导航、Architecture/Contract 索引、CURRENT/HISTORY 和领域词汇加入运行监控入口。 |
| Root README | 确认无需更新 | 项目定位、常青能力和公开支持范围没有因一个版本内的设置页与观测能力改变。 |

## References

- [实施与验收计划](implementation-plan.md)
- [指标可采集性审计](../../research/runtime-monitoring/README.md)
- [ADR-0201](../../adr/0201-sparse-runtime-usage-and-clean-break-monitoring.md)
- [Runtime Monitoring v1](../../contracts/runtime-monitoring-v1.md)
- [Runtime Monitoring 架构](../../architecture/runtime-monitoring.md)
- [Runtime Activity Mapping 维护指南](../../runtime-activity/README.md)
- [Settings workspace surface brief](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
