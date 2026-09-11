---
document_type: implementation-plan
version: v1.58
status: in_progress
last_updated: 2026-09-10
---

# 评测宿主接入与失败复核

开发者已明确授权走通 CLI、Rovai 定时执行与实际评测，并复核旧十二项回归的失败。此增量不修改产品上下文、内置 Skill 或评分权重。

## 实施边界

用户终端通过 `rovai app eval` 配置一个本机开发者 Runner，手动提交 Gate／weekly 或将 frozen weekly plan 绑定现有 Automation。复用已有源码、Node、Rust 工具链与 Runner，不把开发工具链随普通 App 全量分发。注册时记录执行器和源码身份，发生变化后要求重新注册；不接收任意 shell、环境变量或 Core method。

Main 观察已由现有 Scheduler 正式接纳的 AutomationRun，以该 runId 去重并启动宿主子进程。Agent 不调用 owner IPC、不启动嵌套 Core，只读取当前 Camp 对应的报告回执并解释。辅助等待命令只读文件且有截止时间，不新增 Agent Built-in 或全局上下文注入。手动关闭、取消、超时或 App 退出终止本次子进程；重启保留 interrupted，不自动重派发。Automation 的一小时合同不变，定时评测预算须留下分析时间。

配置和执行回执使用受 User Automation OS denial 保护的本机文件；报告仍在显式输出目录，普通用户未配置时不启动评测、不创建记录。无需数据库新列、独立服务或新工作台。评测执行完成与 Gate 通过是两个字段；Judge 未配置时仍可验证调度链路，但不能宣称质量验收通过。

## 失败复核

按旧证据区分：评测器未生成结果、运行或预算问题、实际交付失败、Case 规则与公开要求不一致。先重放已有证据和产物，再在相同标准下真实重跑。只有能证明公开要求与检查不一致时修订 Case、重新准入和 seal；原始报告保留，不把新规则重算结果覆盖到旧报告。

## 验证

覆盖 owner CLI 与受管拒绝、正式 AutomationRun 触发、同一运行幂等、陈旧报告拒绝、版本漂移、关闭／恢复、取消子进程及隔离 Runtime。真实运行使用独立 userData、Skill Library、MCP 与任务工作区。保留完整尝试、实际配置、模型和未完成原因；验收状态在实现后补充。

### 已保留的失败与修正依据

| 范围 | 证据与处理 |
| --- | --- |
| 旧 DEMO-103／104 | Runner 的交接 call identity 与当前 Delivery 结构不一致，导致没有正式评测结果；修复评测器映射，保留 Case。 |
| 旧 DEMO-105 | 产物已通过，但预算耗尽；此前同标准独立补跑已通过，不覆盖首次失败。 |
| 旧 DEMO-106 | 实际保留的函数仍是初始桩，隐藏功能验收失败；维持原始目标、规则与预算。 |
| 旧 DEMO-109／110 | 预置历史被误记为派发后人工干预；使用已有派发水位修复评测器，保留历史读取要求。 |
| 旧 DEMO-111 | 公开要求允许 unknown，但 verifier 只接受 blocked 和一条固定原因措辞；新增 Case 2.0.0，允许 blocked／unknown 与非空原因，原因语义由固定 Judge 检查。Suite 升为 2.1.0，仍为原十二个通用 Case，评分 2.0.0 与权重不变。旧目录和报告不覆盖。 |
| 工具结果 | 旧轨迹有原生 commandExecution failed，账本却因 activity.completed 记为 succeeded。先复现失败，再按原生失败状态／非零退出码处理；取消与未知不记成功。111 的 minFailedTools 要求保留。 |
| owner CLI 入口 | 实际命令暴露 eval namespace 未进入二级解析。新增无 IPC 的公开入口测试，实际红后修复；35 项 CLI 测试通过。 |
| 宿主与 Core 接口 | 实际接口拒绝 history limit 100，改用合同上限 50；一次性计划消费会自动 disabled，但不改变 owner version，需与用户主动关闭区分。两项均扩展既有 Host 测试先复现再修复。 |

新增 Rust 测试的唯一 owner 为 `app_cli` 公开 namespace 解析：此前 `eval configure --help` 在 flags 层报错；已有 flags 单元测试无法覆盖 namespace 分发。该测试遍历六个操作，不连接 App、数据库或网络。最小验证为 `cargo test -p rovai-core --bin rovai evaluation_actions_reach_their_public_help_without_owner_ipc`。

### 实际链路验收

2026-09-10 使用提交 `4456a8b3` 的构建进行回归宿主验收。此前配置、分页与 once 识别失败均保留在独立验收目录；没有以它们代替真实任务结果，也未消耗一个已经执行的回归 campaign 来更换规则。

每日服务组合验收已完成：真实 owner CLI 配置、Core Scheduler 定时触发、元数据统计、真实 Codex CLI `gpt-5.6-sol` Agent 分析、引用登记及公开交付均完成。报告 ID `2026-09-09-a1347a8d-f4e6-4db4-8103-ad31dc0fc383`；统计 available，分析 complete。数据源为独立空数据库，没有植入模拟历史；零分母和 Memory unavailable 保留，不据此声称真实使用健康或曲线改善。分析登记检查身份和引用存在性，不证明分析结论正确；模型身份字段仍为提交方声明，可另追溯实际 Run。

开发版 `pnpm dev` 的独立 Electron Main 也完成执行器注册、状态查询、手动 Gate 提交与取消。任务 `desktop-gate-cancel-1` 最终 interrupted／cancelled_by_owner；这是同一构建两侧的生命周期检查，未完成新旧质量对照。App 随后受控关闭，报告无未解决执行。未更新或重启日常安装版。

完整定时链路已完成：真实 Scheduler 接纳、宿主重建当前 Core／CLI、合同检查、Runner、周报告／HTML／趋势、当前 Camp 回执和分析 Agent 公开交付均完成。Automation 与 job 状态均 completed，reportStatus 为 degraded，三者不混用。16 项合同标准通过；计划 12 个 Case × 1 次，实际执行 10 个。联合硬性与专项口径为 **5 通过、4 失败、3 未知**：102／107／108／109／110 通过；101／104／105 产物通过但 elapsed 预算耗尽；106 仍是初始桩、未改文件，产物失败且预算耗尽；103 产物与收口通过但账本有缺口；111／112 因剩余预算不足而未运行。

原始 hardOutcome 单独为 6／4／2，不含专项规则。首次分析 Agent 按这个数交付，没有指出 103 的专项缺口，但明确没有 Gate 通过；保留原回复作为分析限制。操作说明改为读取代码生成的匹配 week／attempt 联合统计。Judge 未配置，质量分及关键语义评价不完整；此轮不能充当真实 Judge、基线／候选或保留集验收。

本轮又定位到当前 Core 的 return edge 可恢复到 Lead 的深度 0，而旧账本拒绝零深度，造成 103／104／106 的部分覆盖。执行结束后才修改评测器，升级为跨版本 ledger 1.1.0 与 [Execution Evaluation v3](../../contracts/execution-evaluation-v3.md)，历史 schema 不改写。回归测试先红后绿；旧 1.0.0 可读，forward 的非法零深度仍拒绝，已确认 return 不当 forward_cycle。

独立重放目录 `return-lineage-replay` 使用原始结果内保留的接纳字段和观察中的 edgeKind，不重建缺失的 raw event payload、不重新执行模型、不改写原报告。103／104／106 的账本覆盖恢复完整，原有 A2A 上下限无需改变；104／106 的实际预算和产物失败不被抹除。原字段、文件摘要、新生产者摘要与新账本均保留。

私有证据根目录名：`host-integration-20260910-VPccif`、`daily-host-acceptance-20260910-e5Arok`；精确隔离目录、构建摘要和原始输出由各自 isolation／product／job 记录提供，不提交原始对话或本机认证资料。

111／112 随后在独立自动验收目录 `supplemental` 各补跑一次，沿用原 Case seal、240 秒预算、模型和权限。两项产物／收口与专项规则均通过；111 观察到一次真正的工具失败，112 的 Memory 状态保持不变。Judge 仍未配置。它们不回填原周回归、不替换未运行项、不拼成一次“全套通过”。

本轮完整 JavaScript 检查为 172 个 Vitest 文件、1736 项测试通过，最后一组 Node 246 通过、1 个既有 Windows 平台测试跳过。Rust PR 范围为 547 个 lib、34 个 CLI、309 个 slow integration 通过；随后 CLI 入口回归增加后 35 个 CLI 通过，Clippy 再次通过。typecheck、桌面构建、文档治理及明确 base 的 CI 文档检查均通过。这些是实现验证，不是模型质量样本。

### 演示与边界

按[操作指南](../../development/evaluation.md)注册本机执行器，将 frozen weekly plan 绑定已有 Automation；在报告根目录查看 index.html，再展开本次 report.html 与原 JSON。手动 Gate 使用同一 Runner，通过稳定 job-id 查询或取消；命令运输重复不产生第二次尝试。

这是一项显式开发者能力，需要源码、依赖、Node 和宿主可发现的 Rust／Git 工具链；不会随普通 App 自动安装这些工具。定时预算上限 2700 秒，以便在既有一小时 Automation 内留下分析时间；预算不足的计划样本保留为未运行，不把它们算通过。真实 Judge、完整基线／候选质量对照、独立保留集及打包安装版链路仍需分别验收，不能用服务组合测试或取消检查替代。
