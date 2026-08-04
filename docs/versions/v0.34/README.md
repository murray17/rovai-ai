---
document_type: version-overview
version: v0.34
lifecycle: historical
authority: version-scope-and-status
design_status: frozen
implementation_status: in_progress
last_updated: 2026-08-04
---

# Rovai-ai v0.34 Benchmark Evidence & Semantic Judge

> 中文名：Benchmark 证据链与语义评审
>
> 状态：历史回填已完成确定性评测、normalization、Evidence Index、三类 Ledger、Bundle、五层报告与 Semantic Judge 协议；ADR-0094 Formal isolation 实证仍未完成
>
> 前置版本：[v0.33 Unified Sidebar Actions](../v0.33/README.md)
>
> 实施设计：[architecture.md](architecture.md)
>
> Evidence Schema：[evidence-schema.md](evidence-schema.md)
>
> Judge Schema：[judge-schema.md](judge-schema.md)
>
> 验收矩阵：[acceptance-matrix.md](acceptance-matrix.md)
>
> 实施门禁：[implementation-plan.md](implementation-plan.md)
>
> 2026-08-04 回填记录：[backfill-acceptance-2026-08-04.md](backfill-acceptance-2026-08-04.md)

## 版本意图

在既有 Team Delivery Qualification 上建立可信、可恢复、可解释的 Benchmark 评测系统。
v0.34 保留确定性规则作为唯一资格权威，并新增完整 Delivery、Collaboration、Tool、Mutation
证据与独立的 Semantic Engineering Review。

本版本不以提高默认团队 Pass Rate 为完成条件。版本完成只表示评测系统、证据链、隔离边界与
Semantic Judge 实验层实现并通过验收。

## 冻结的权威边界

最终报告固定为五层，层与层之间不能加权补偿：

1. **Hard Outcome**：Validity、Evaluation State、Verified Delivery、Orchestration
   Convergence、Post-Dispatch Human Intervention 与 Overall；
2. **Delivery Evidence**：Requirement、Verification Check、分类结果、Failure Fact、交付快照和
   Final Response Evidence；
3. **Collaboration Evidence**：Run graph、独立 Member Call 生命周期、路由、角色、反馈候选和
   文件重叠事实；
4. **Tool & Mutation Evidence**：Tool Call Ledger、Workspace Mutation Ledger、授权、重试、
   receipt、副作用、延迟与验证关系；
5. **Semantic Engineering Review**：双 Judge Replica 的固定 checklist、证据引用、置信度、
   abstain、disagreement 或 unavailable。

只有 Layer 1 决定资格。Semantic Judge 不得创造、阻塞、提升或降低 Hard Outcome。

## 交付范围

- Invalid Trial、Evaluation-Pending Trial 与有效团队失败的严格区分；
- Suite 全量完成前不发布最终 Pass Rate，投递后不可恢复的评测无效使原 Suite 永久无最终率；
- Core 在接受执行责任前原子实施 elapsed、AgentRun 和 accepted A2A 预算；
- 以 canonical Member Call acceptance receipt 计 A2A，每次接受均为独立前向边；
- Dedicated isolation profile、完整 Intervention Coverage 与 External Effect Settlement；
- 稳定 Requirement ID、criticality、Verification Catalog 和完整 Verifier Observation；
- Delivered Workspace Freeze Barrier 与同一内容摘要的不可变评测快照；
- Authority-preserving Evidence Index、Collaboration、Tool 与 Mutation Ledgers；
- allowlist Judge Evidence Pack、冻结 Judge Configuration 与双 Replica reconciliation；
- 五层报告、私有 Evidence Bundle、脱敏公开导出和历史结果不可变策略；
- public demo 与成功、失败、pending、invalid、Judge 异常和泄漏负例的验收 fixtures。

Requirement 的 `critical` / `non_critical` 只表达故障分诊优先级。所有公开 Delivery
Requirement 都是 Hard Gate；真正非门禁的观察必须建模为 Diagnostic Check，不能用权重抵消
Requirement 失败。

## Member Call 基线

v0.34 以 [ADR-0099](../../adr/0099-cost-gated-independent-member-calls.md) 为唯一当前协议：

- `call_member` 只有 `recipient`、`content` 和可选 `taskId`；
- 每次接受独立占用一个 A2A slot 并使逻辑深度增加一；
- recipient 终止不会自动联系 source，也不会创建 source Run、Call Outcome 或回复责任；
- 后续任意方向的 Call 都是新的前向边；
- Call 必要性、重复信息、反馈吸收与 Lead 集成只由 Semantic Review 判断。

新 schema 禁止 `returnPolicy`、Return Obligation、Call Outcome、Response Closure、
`responseProduced`、`sourceReceived`、source Resume 和 Conversation Input kind。历史 v0.31 / v0.32
证据保持原 schema 和原结论，不迁移为新协议。

## 明确不在范围

- Judge 决定 Hard Pass 或 correctness / collaboration 的混合总分；
- 排行榜、Pass@k、Solo Agent 对照、角色消融、Team Configuration 排名；
- 统计显著性声明；
- 根据 Judge 结果自动修改 Prompt、角色、模型、权限或 Tool；
- 以某个预定 Pass Rate 或 Semantic verdict 分布作为版本门禁；
- 将 Trial、Case、Verifier、Judge 或 Pass Rate 领域对象放入 Core。

## 完成定义

[implementation-plan.md](implementation-plan.md) 的全部 Checkpoint 和
[acceptance-matrix.md](acceptance-matrix.md) 的必需 fixture 必须通过。首个实施里程碑要求在完全
不调用 LLM 的情况下，稳定生成 valid / invalid / pending、pass / fail 和五层报告骨架；该门槛
通过前不得接入生产 Judge。

ADR `accepted`、schema `frozen` 和 implementation `complete` 是三个独立事实。后置回填已接入稳定
Requirement / Check、封闭 Verifier Observation、三轴 Hard Outcome、内容寻址 Snapshot、同 identity
Evaluation recovery、Suite 分母门禁、Core 原子预算、Evidence Index、三类 Ledger、schema-valid
normalization、封闭 Bundle、五层公开报告与双 Replica Judge 协议。缺少 authority 的 Tool totals、writer、
effect identity、causality 和语义项继续保持 `null|partial|indeterminate`。

最终 public demo `demo-v034-final-20260804` 得到 `valid + complete + hard pass`、3/3 Requirement、
324 条 Evidence Index record、4 个真实 Tool observation、2 个经 final diff 验证的 Mutation、0 个
accepted Call、Read Model schema 18 / Attested Team Protocol 4，并在 Judge fixture 后由独立 Bundle
verifier 验证 12 个 present role、私有权限、引用闭包和不变 Hard Outcome。Judge fixture 只证明协议，
不冒充 LLM 语义正确性。

本历史版本仍保持 `implementation_status: in_progress`：当前共享登录与普通 host session 明确不满足
[ADR-0094](../../adr/0094-formal-qualification-isolation-and-effect-coverage.md)，仓库也没有可冒充
`tool_disabled_external_sandbox` 的正式 Judge provider。因而未生成隔离 Formal Trial、未发布正式 Pass
Rate，也未将 synthetic Profile 当作操作系统隔离证据。
