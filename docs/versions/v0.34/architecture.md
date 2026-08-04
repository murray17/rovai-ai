---
document_type: version-architecture
version: v0.34
authority: implementation-contract
status: frozen
implementation_status: in_progress
last_updated: 2026-08-04
---

# v0.34 Benchmark Evidence & Semantic Judge 实施设计

> 范围：[README.md](README.md)
>
> Evidence Schema：[evidence-schema.md](evidence-schema.md)
>
> Judge Schema：[judge-schema.md](judge-schema.md)
>
> 验收：[acceptance-matrix.md](acceptance-matrix.md)

## 1. 当前实现与目标边界

当前 Qualification Runner 已实现稳定 Requirement / Check、封闭 Verifier Observation、三轴 Hard
Outcome、不可变交付快照、同 identity Evaluation recovery、Core 原子执行预算与追加式结果历史。
Core Event 和 AgentRun Execution Evidence 已通过独立分页接口采集；当前 Tool ledger 使用保守的
known-action allowlist，普通消息、reasoning、plan 和未知 activity 不会被推断为 Tool。其 coverage
仍明确为 partial。Formal Runner 已实现 Isolation Profile 的私有文件、版本、digest、Trial binding、
当前 POSIX identity/session、channel authority 与 coverage 的 fail-closed admission，并在交付冻结后
复核同一 profile continuity；操作系统策略本身的正式 fixture 和 effect receipt coverage 尚未完成。
Runner 已生成 schema `1.0.0` 的不可变 Evidence Index artifact，覆盖 Core、Runner、Verifier、Runtime、
Workspace 与派生事实，并在同一 Index 内验证 reference resolution 和 coverage 不提升；恢复评测时创建
新 Index artifact，旧 result revision 仍引用旧 Index。Collaboration、Tool Call 与 Workspace Mutation
Ledger 已生成独立不可变 artifact，并随 recovery 重建到新的 Index reference domain。Workspace Ledger
当前只发布完整最终树差异可以证明的净变化；writer chronology、overlap、overwrite、rollback、effect
identity 与 direct-failure causality 在 authority 不足时保持 partial/indeterminate。后置回填已实现
schema-valid normalization、封闭 Bundle、原子 completion marker、五层 public report、Judge Pack、
双 Replica execution/reconciliation 与独立 Bundle closure verifier。

回填没有改变 Formal 边界：Profile admission 只验证 artifact 合同，不能把共享登录、自声明 policy 或
普通 host session 提升为 ADR-0094 的操作系统隔离实证。没有 dedicated identity/session 与外部
tool-disabled Judge sandbox 时，Formal Trial 和 Formal Semantic Review 必须保持 unavailable。

Core 只拥有通用产品执行事实：CampTurn、AgentRun、Conversation Input、Member Call、授权、预算、
终止和 Read Side evidence。Qualification Case、Trial、Suite、Verifier、Judge、Pass Rate 和语义
结论继续属于外部 evaluator。

当前 Member Call 产品基线是 Read Model schema 18、Attested Team Protocol 4 和 ADR-0099 的独立
前向边。v0.34 不恢复任何 Return、Outcome、自动回联或 response-closure 合同。

## 2. 组件与数据流

```text
sealed Case + Verification Catalog + Environment Manifest
  -> preflight admission
  -> Core accepts CampTurn with frozen generic execution budget
  -> isolated subject execution
  -> Core/Runner/Runtime evidence collection
  -> Delivered Workspace Freeze Barrier
  -> immutable Delivered Workspace Snapshot
  -> verifier observation + evidence normalization
  -> deterministic Hard Outcome + Layers 1-4
  -> allowlist Judge Evidence Pack
  -> two tool-disabled Judge Replicas
  -> advisory Layer 5 reconciliation
  -> private Evidence Bundle + redacted public report
```

Runner 是 workflow owner 和 evaluation-state authority。Core 是 execution admission 与其领域事实的
authority。Verifier 只能报告绑定 Catalog 与 Snapshot 的 check observations。Judge 只产生语义
findings。

## 3. Trial 状态机

### 3.1 Dispatch 前

Runner 验证 Case Seal、Verification Catalog、schema digests、Runner/Core identity、Team
Configuration、Runtime、Toolchain、Intervention Isolation Profile 和外部 effect policy。任何已知
缺失使 attempt `validity=invalid`，且不允许 Core 接受 subject execution。

Demo 模式把 Antigravity Team private root 与 Gemini configuration root 同时绑定到 Trial 临时目录，
不得探测后再改写用户级 Gemini 配置。Formal 模式仍要求 dedicated Benchmark identity 和冻结的隔离
配置，不能把 demo 的临时根当作 Formal Isolation 证明。

未接受 execution 的 invalid attempt 可以在所有冻结 identity 完全相同时 replacement-link 到原
planned slot。它不进入 Pass Rate 分母。

### 3.2 Dispatch 后

Core 接受 initial execution 后，Runtime、权限、Tool、协作、预算、超时、交付和自主恢复失败都是
被测团队的有效结果，不能因不利而重跑。

Runner 必须先完成 Delivered Workspace Freeze Barrier：Turn 被 fence、所有 workspace writer 和
Runtime process 退出、Core evidence boundary 固定、隔离覆盖连续、Runner-owned projection 与交付
文件分离。随后保存内容寻址的 Delivered Workspace Snapshot。

Runner 对 Core 停止前观察到的 Runtime process ancestry 使用有界退出窗口；窗口内全部退出才记录
`runtimeExit=complete` 并冻结交付快照，超时残留不能因随后自行退出而回填为成功。

### 3.3 Evaluation recovery

Verifier process 非零、signal、timeout、schema 不合法、Check 缺失/重复/未知、snapshot 不匹配、
Runner evaluation error 或 Hard authority coverage gap 都产生：

```text
validity = valid
evaluationState = pending
hardOutcome = unavailable
```

只能针对完全相同的 Trial、Case Seal、Snapshot digest、Verifier digest、configuration 和 schema
恢复 evaluation；不得重启 AgentRun、恢复 workspace writer 或重新投递任务。无法在同一 identity
下恢复的投递后 evaluation 缺陷使保留 Trial 转为 Invalid，并使原 Suite 永久不能发布最终 Pass
Rate。

当前确定性 vertical slice 由 `qualification:evaluate` 只读消费保留的内容寻址 Snapshot，并对
Case Seal、Verifier、Verification Catalog、Verifier configuration、result schema 与原 Trial
identity 做全量比对；原 Environment Manifest、Evaluator code digest 与 Node executable digest 也必须
保持一致。每次调用追加一个 evaluation attempt；每次可发布的推导追加一个完整 result revision。
`result.json` 与 `redacted-summary.json` 只是可修复的 current projection，不是历史真源，恢复不得
覆盖旧 attempt、旧 revision 或最初的 `EVALUATION_PENDING` 证据。

若一次已记录的 recovery attempt 证明 Snapshot、Snapshot manifest、baseline、workspace diff 或
change boundary 已无法按原 identity 可信恢复，操作员才可用同一入口显式
`--mark-irrecoverable <typed-reason>`。Runner 必须要求该 reason 与已有失败 attempt 精确匹配，追加
invalidation attempt、Invalid result revision、lifecycle fact 和内容摘要绑定的 `IRRECOVERABLE`
marker；不得改写最初的 capture/pending marker，也不得以 Case、Evaluator 或参数选错作为终止理由。

### 3.4 Scorable state

只有 `validity=valid && evaluationState=complete` 才能产生 `hardOutcome=pass|fail`。Partial fact
可以在 pending 状态显示，但不能作为 provisional outcome。

## 4. Hard Outcome

Hard Outcome 的唯一公式是：

```text
pass = Verified Delivery == pass
       && Orchestration Convergence == pass
       && Post-Dispatch Human Intervention == absent
fail = valid + complete 且不满足 pass
```

Verified Delivery 由 sealed Verification Catalog 的完整 Hard Check 集合推导。每个公开 Delivery
Requirement 都是 Hard Gate；criticality 只用于失败分诊。Withheld Check 必须映射已公开
Requirement，不能增加隐藏义务。Diagnostic Check 永不进入 Verified Delivery。

Orchestration Convergence 分解为：

- Run tree settlement；
- durable Conversation Input settlement；
- Approval settlement；
- CampTurn budget compliance；
- Runtime complete exit；
- External Effect Settlement。

已终止的 failed / cancelled Run 不自动导致 convergence fail，只要其执行责任已正确收口。Budget
Exhaustion、残留责任、未退出 Runtime 或 unsettled effect 会失败；任一必需事实 indeterminate 会使
evaluation pending。

Human Intervention 单独为 `absent|present|indeterminate`。观察到投递后人工消息、审批、编辑、配置
变化、Runtime 控制、重启或其他覆盖动作时 Hard fail；覆盖缺口是 pending，不猜测 absent。

## 5. Requirement 与 Verifier

Qualification Case 公开稳定 Requirement ID、criticality、文字、category 和验收范围。sealed
Verification Catalog 是预期 Check 集合的 completeness authority；每个 Check 有稳定 ID、
`hard|diagnostic`、`verifier|runner` observation authority、可选 Runner check identity、Requirement
references、category、disclosure 和 prerequisites。

Verifier Observation 必须：

- 绑定 Case Seal、Catalog digest、Delivered Workspace Snapshot digest 和 verifier identity；
- process 成功并输出受支持 schema；
- 每个 expected Check ID 恰好出现一次，无未知项；
- Check kind、category、Requirement mapping 与 Catalog 完全一致；
- 使用 `passed|failed|blocked|indeterminate|not_applicable` 的受限状态；
- 提供有界 evidence references，不暴露完整 withheld implementation。

Hard Check 的 `failed`、`blocked` 或不允许的 indeterminate 都使 Verified Delivery fail。Verifier 的
顶层 `verifiedDelivery` Boolean 即使迁移期存在也不具权威性。

## 6. Core 原子执行预算

Initial dispatch 可提供 CampTurn Execution Budget。Core 在接受 root Run 的同一事务冻结：

- `acceptedAt` 与绝对 `deadlineAt`；
- root 加每个已接受 Member Call 的 AgentRun responsibility ceiling；
- canonical Member Call acceptance receipt ceiling。

每个新 Call 在授权、幂等和 fence 校验后，必须在同一事务先占用一个 A2A slot，再创建
InboxMessage 与 Conversation Input。第一个本可接受但超限的请求原子记录 Budget Exhaustion、
不产生部分业务副作用并 fence CampTurn。canonical idempotent replay 只返回原 receipt，不重复
计数或制造副作用。

Core 使用 process 内 monotonic timer，持久化绝对 deadline 用于 restart。Runner 使用相同 deadline
独立 watchdog；不可解释的时钟分歧属于 evaluation integrity loss，而不是挑选更有利的结果。

## 7. Collaboration Evidence

Member Call Lifecycle 只从 canonical acceptance receipt、Inbox/Input 和 recipient Run 推导：

```text
accepted receipt
  -> durable Input persisted
  -> recipient Run materialized
  -> recipient Run started
  -> recipient Run terminal
  -> mechanicalSettlement = settled | unsettled | indeterminate
```

recipient Run terminal 后无需后续 Call，Call 即可 mechanically settled。后续回到 source 的 Call 是
新的 acceptance、slot 和 depth，不关闭前一条边。Schema 不存在 reply、return、response 或 source
consumption 字段。

规则层可计算 acceptance、materialization、settlement、depth、latency segments、exact duplicate
acceptance、forward cycles、repeated route facts、实际角色激活和覆盖范围内的文件 overlap / rollback。
Call 是否必要、角色是否遗漏、内容是否重复、反馈是否被吸收以及 Lead 是否完成集成只进入 Judge。

## 8. Tool 与 Mutation Evidence

Tool Call Ledger 对每个 observed call 保存 source authority、AgentRun、native/canonical identity、
lifecycle、typed error、authorization、retry/replay、receipt、effect identity、timestamps、mutation
intent、verification reference 和 per-field coverage。

Runtime telemetry 不会被提升为 Core-authoritative fact。跨 clock domain 不计算 latency。重复命令不
自动等于 duplicate side effect；只有 authoritative receipt 或完整 effect ledger 能证明重复副作用。

当前实现会完整分页每个 subject AgentRun 的 Execution Evidence，固定 `throughSequence`，并验证
sequence 连续、ID 唯一、cursor 前进和 declared total 一致。Core Team Tool 的 terminal result 保留
canonical identity、authorization decision、error code、idempotent replay 与 receipt；Runtime action
只按明确 item type 进入 ledger。只要 Runtime telemetry completeness 尚未受证明，observed diagnostics
可以报告，但 authoritative totals 必须保持 `null`，redacted report 只导出 allowlist summary。

Workspace Mutation Ledger 与 Tool 分离，因为一个 shell call 可产生多个文件效果，也可能存在无
first-class file Tool 的 writer。当前 Builder 从 Runner 冻结的 baseline/final tree diff 生成
create/modify/delete/metadata net-change record、before/after digest 和 later diff verification relation；
它不会把无法按路径关联的 file Tool 猜成 writer。只有完整 writer chronology 与 isolation coverage
才能客观发布 writer、AgentRun、overlap、overwrite 和 exact rollback；“是否有害”仍为语义判断。

## 9. Evidence schema family

v0.34 使用 [schemas/](schemas/) 中的封闭 JSON Schema family。每个 artifact 有独立 schema ID / version、
producer identity、Trial 或 Suite binding、source boundary 与 payload digest。Evidence Reference 必须
解析到 Evidence Index 中同一 Bundle 的稳定条目。

Schema validation 之外，Runner 还执行跨 artifact invariants：ID 唯一、Catalog 完整、引用闭包、
source sequence 连续、declared total 一致、Hard formula 一致、Suite denominator 合法以及 forbidden
field scan。未知 required field 或不支持的 schema version fail closed。

## 10. Semantic Engineering Review

Judge Evidence Pack 是从 safe normalized evidence 生成的 allowlist projection，不是 private Bundle
的 redacted dump。它不包含 Hard Outcome、participant model identity、hidden reasoning、credential、
environment value、Runtime private log、完整 Withheld Verifier、reference implementation 或 Sealed
Pack locator。

同一冻结 Judge Configuration 对同一 Pack 运行两个 tool-disabled Replica，并 counterbalance
checklist 顺序。每个固定 item 返回 categorical verdict、confidence、Evidence References 和有界
reason。任何 verdict mismatch 产生 `disagreement`，不投票、不平均、不挑选有利结果；任一必需
Replica 不可用或非法使 Review `unavailable`。这些状态都不改变已完成 Hard Outcome。

## 11. 报告与导出

Private Qualification Evidence Bundle 保存 artifact manifest、不可变 delivered snapshot、完整
authority evidence、全部 evaluation attempt 和 completion marker，使用 current-user-only 权限。

公开报告和 Judge Pack 分别由独立 allowlist builder 生成。两者都不接受 raw source object 字段，
并用 secret canary、schema validation、Evidence Reference validation 和 forbidden-field scan 验证。
成功与失败 Trial 使用同一保留政策。

Suite 在所有 planned Formal slots 都以同一冻结 identity 形成 trusted pass/fail 前只能发布进度。
最终 `Pass Rate = passing planned slots / total planned slots`。Calibration、invalid attempt、pending
Trial 和 partial subset 从不形成替代分母。

## 12. 历史兼容

v0.31 与 v0.32 的 Trial、Pass Rate、Runner identity 和 evidence schema 保持不可变。新 reader 可以
显示后来层级 `unavailable`，但不能用 v0.34 规则重算历史 Overall，也不能把旧 Return/Outcome 记录
转换为当前 Member Call lifecycle。
