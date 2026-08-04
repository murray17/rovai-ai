---
document_type: version-architecture
version: v0.36
authority: implementation-contract
status: frozen
implementation_status: complete
last_updated: 2026-08-04
---

# v0.36 Collaboration-Value Diagnostic Portfolio 实施设计

## 1. 权威边界

v0.36 不修改 Core 的产品领域，也不重新定义 v0.34 的五层报告。Core 继续只拥有 CampTurn、
AgentRun、Conversation Input、Member Call、授权、预算、终止和 Read Side execution evidence。
Qualification Case、admission、Trial、Portfolio、Verifier、Judge 和诊断结论都属于外部 evaluator。

沿用的有效权威：

- ADR-0092：投递后 evaluator failure 只能恢复同一 Snapshot evaluation；
- ADR-0093：Core 在接受责任前原子执行 elapsed、Run 与 canonical accepted A2A 预算；
- ADR-0094：共享用户环境只能产生 diagnostic evidence，不能冒充 Formal Isolation；
- ADR-0095：Hard Outcome 是唯一资格权威，Collaboration/Judge 不补偿；
- ADR-0097：Evidence Reference、Ledger authority 与 `indeterminate` 传播；
- ADR-0098：Semantic Review 双 Replica 协议与 unavailable 边界；
- ADR-0099：每个 Member Call 是独立前向边，没有 return、response closure 或自动回联。

新增权威只来自 ADR-0101 的 Case v3 admission 与 ADR-0102 的 Diagnostic Portfolio。

## 2. 组件

```text
private schema-v3 Case Pack
  -> qualification-case admit
       -> v3 structural validation
       -> Hermetic initial/reference/public verification x2
       -> Hermetic Challenge Mutant verification x2
       -> admission-v3 + Challenge evidence + Case Seal v3

four admitted Case Seals + frozen execution configuration
  -> diagnostic-portfolio define
       -> immutable Definition + eight planned slots
       -> append-only Ledger
       -> qualification-runner per slot
       -> v0.34 Trial Bundle and five-layer report
       -> bundle verification + non-leakage gate
       -> Hard Outcome Fingerprint
       -> Case Stability
       -> one-time Completion Attestation + public projection
```

`portfolio-status.json`、`result.json` 和 redacted summary 都是可重建 projection。Case Seal、Admission、
Portfolio Definition、Ledger event、Trial Bundle、Hard Outcome Fingerprint 和 Completion Attestation 才是
不可变证据。

## 3. Case manifest v2/v3 dispatch

Reader 先检查整数 `schemaVersion`：

- `2`：调用原 v2 validator、admission、Seal 和 execution behavior；
- `3`：调用 v3 closed validator 与 ADR-0101 admission；
- 其他值：fail closed。

共享函数不得把 v2 object 填默认字段后交给 v3 validator，也不得把 v3 `initialExpectation` 丢弃后按
v2 执行。Case Seal record 和 admission record 使用各自 Case schema version；历史 v2 文件字节保持
不变。

v3 Case ID 使用 `DC-[0-9]{3}`，visibility 固定 `diagnostic`，version 使用 SemVer。v3 manifest 必须精确
包含六个 Requirement、五个 public Check、统一 budget、统一 allowed/protected paths、Hermetic profile
和 private Challenge Manifest locator。Manifest 不允许 `collaboration` 或任何未知字段。

## 4. Verification topology

第一版 Case 使用以下稳定结构：

| Requirement | 类别 | Public Check | 初始预期 | Withheld/Runner |
|---|---|---|---|---|
| R1 | `workstream_a` | Runner `PUB-R1` | `fail` | 至少一个 Verifier `HID-R1-*` |
| R2 | `workstream_b` | Runner `PUB-R2` | `fail` | 至少一个 Verifier `HID-R2-*` |
| R3 | `workstream_c` | Runner `PUB-R3` | `fail` | 至少一个 Verifier `HID-R3-*` |
| R4 | `integration` | Runner `PUB-R4` | `fail` | 至少一个 Verifier `HID-R4-*` |
| R5 | `regression` | Runner `PUB-R5` | `pass` | 无强制 withheld pair |
| R6 | `change_boundary` | 无 | n/a | 唯一 Runner boundary check |

Public Check 是 Runner 在相同 Hermetic Profile 中执行的 Hard Check，withheld Check 由 Verifier 观察；
完整 Catalog 第一版至少包含五个 Runner public Hard Check、四个 Verifier withheld Hard Check和一个
Runner boundary Hard Check。所有 Check ID 全局稳定，每个结果在其对应 authority observation中恰好出现一次。
R1～R4 的 public 与 withheld assertions 必须使用不同输入、boundary 或 property；仅复制同一断言会使
admission 失败。

## 5. Hermetic Verification Profile

v3 Runner 把 manifest 中逻辑 executable `node` 解析为当前冻结的 `process.execPath`，并在 Portfolio/Case
evidence 中记录 version 和 binary digest。命令通过 `spawn` 直接执行，不经过 shell。Public command 只
允许 Node test-runner 参数、明确的受保护 test locator 和 `tests/agent/**/*.test.mjs` pattern。

每个 Check 创建独立 `0700` environment root 与 temporary directory。环境从空 allowlist 构造：

```text
HOME, USERPROFILE, XDG_CONFIG_HOME, XDG_CACHE_HOME
TMPDIR, TMP, TEMP
CI=1, NO_COLOR=1
TZ=UTC, LANG=C, LC_ALL=C
ROVAI_QUALIFICATION_VERIFIER_OFFLINE=1
```

`NODE_OPTIONS` 和用户 package configuration 不继承。Node Permission Model 允许读取 delivered workspace、
Verifier 自身和 Node 必需资源，只允许写入该 Check temporary directory；不授予 network、child process、
worker、addon、FFI、WASI 或 inspector。Public Check 固定 `--test-concurrency=1`。

每个 public Check timeout 30 秒，Verifier aggregate timeout 60 秒，stdout/stderr 各自按总计 1 MiB 上限
捕获。timeout、signal、permission denial、output overflow 或 malformed result 使用 typed evaluator
failure，不伪装为业务 Check failed。每次执行前后比较 delivered tree；任何变化使 observation invalid。

## 6. Admission algorithm

Admission 在一个 private temporary root 中执行，且从不修改 Pack：

1. 校验 Pack root realpath 位于 repository、Trial evidence 和 workspace 之外；验证 root `0700`、regular
   private files `0600`、无 symlinked component escape。
2. 读取 manifest、prompt、fixture、verifier、reference 和 Challenge Manifest；校验 closed schema、
   locator containment、Canary uniqueness 和 forbidden-field absence。
3. 两次独立 copy fixture，分别运行五个 public Checks 和完整 verifier。四个 Target Public Check 必须
   fail，Baseline Public Check 必须 pass；完整初始 Hard Check set 必须精确匹配声明。
4. 两次独立 copy fixture 并 apply reference overlay，过滤 private Canary sidecar；五个 public Checks、
   withheld Checks 和 R6 必须全部 pass，且两次 normalized evidence 完全一致。
5. 对每个 Mutant 两次 copy fixture 并 apply overlay；Verifier 必须正常完成，实际失败 Hard Check set 必须
   与 `expectedFailingCheckIds` 完全相同，其他 Hard Checks 全 pass。
6. 验证前三个 fault class 都存在，至少一个 Mutant public Checks 全 pass 但 withheld fail，
   regression/boundary Mutant 只失败 R5 或 R6。
7. 写入 immutable admission-v3 和 case-seal-v3，绑定所有 tree/observation/policy digest。

Mutant 的数量、失败数和难度不形成 Case score。任何 admission correction 都修改 Case version。

## 7. Delivered change boundary

Baseline tree 与 Delivered Workspace Snapshot 都排除 Runner-owned `.git` 与 managed Runtime projection，
但包含所有交付文件的 path、type、mode、size/content digest 和 symlink target。允许 pattern 固定为：

```json
["src/**", "tests/agent/**"]
```

目录 metadata 只因允许子树创建而变化不构成违规；任意非目录 change 若不匹配 allowlist，或明确命中
protected pattern，则 R6 failed。Public tests、fixtures、package.json 和 README 在 final snapshot 必须
完全不变。

DC-004 还在其 public/withheld test 中通过 injected auditable filesystem adapter 验证所有 write attempt
均位于 root。该 Case 的 temporal invariant 是被测 API behavior，不被夸大为 Runner 对任意 subject
process writer chronology 的完整观察。

## 8. Sealed material non-leakage

Challenge Manifest 声明 reference、verifier、manifest 和每个 Mutant 的独立 high-entropy Canary identity
与 private locator。Canary token 不进入 Case public identity或 Trial configuration。Reference/Mutant overlay
时明确过滤 Canary sidecar；Verifier 内的 Canary 只存在于 evaluator code。

Trial terminal 后，scanner 对 delivered snapshot 和 Evidence Bundle 内所有 regular files做 bounded binary/
UTF-8 scan，并对 public report 与 Judge Pack执行更严格 closed-field scan。匹配 Canary、private Pack absolute
path、Pack basename、reference/mutant locator、credential pattern 或 forbidden schema field时：

- 先保存 immutable leakage finding；
- 不删除原 bundle；
- attempt 进入 irrecoverable/incomplete；
- Portfolio 不允许 replacement execution。

Admission/Case-Seal 本身是合法持有 sealed digest 的私有证据，不允许持有 Canary明文的 Trial Bundle。
clean scan 对外只公开 policy version、scan coverage 和 `no_observed_leak`，不公开 token或 private locator。

## 9. Portfolio Definition

`DCP-001@1.0.1` Definition 在任何 slot dispatch 前生成一次。它按 Case ID 排序绑定四个 Case Seal，按
Case/ordinal生成八个 slot，并绑定：

- `elapsedSeconds=900`、`maxAgentRuns=8`、`maxAcceptedA2a=7`；
- Qualification Runner 中冻结的四个 AgentProfile、adapter、model/options 和 permission；
- Core、Runner、Runtime、Node/toolchain fingerprints；
- Case/Trial/Bundle/Fingerprint schema identities；
- `semanticReviewPolicy=real_provider_unavailable_no_fixture_attachment`；
- `repeatPolicy=exactly_two_no_tiebreaker`；
- non-leakage policy digest。

Definition 不包含 Case、team-private、isolation-profile 或 Evidence Root locator。Operator 在执行时提供
private Seal-to-path resolution；Runner realpath解析后只比较内容 identity，不持久化 locator。
两个 schema catalog 的版本与 raw-byte digest 进入 execution fingerprints，因此 Definition 同时绑定
v0.34 基础 artifact schema 和 v0.36 Case/Portfolio schema family。

## 10. Portfolio Ledger 与 recovery

每个 Ledger event 包含 monotonic sequence、event ID、previous event digest、Portfolio binding、slot、
attempt、typed payload、timestamp、producer identity 和 event digest。Append 使用 exclusive create，目录与
文件保持 `0700/0600`。Loader 从 Definition 和全量 event 重建状态，拒绝 gap、fork、重复 sequence、
digest mismatch、非法 transition 和未知 event type。

允许的核心 transition：

```text
planned
  -> attempt_started
       -> preflight_invalid -> replacement_linked -> attempt_started
       -> dispatch_accepted
            -> evaluation_pending -> evaluation_resumed -> ...
            -> evidence_verified
                 -> non_leakage_passed -> valid_complete
                 -> non_leakage_failed -> incomplete
            -> irrecoverable -> incomplete
```

preflight replacement 必须引用原 attempt、同一 slot 和同一 frozen configuration。dispatch accepted 后
不存在 replacement transition。valid Hard fail 与 Hard pass 使用同一 terminal path。

## 11. Hard Outcome Fingerprint 与 Stability

Fingerprint builder 只接受 bundle-verified、valid、complete Trial。Canonical payload 包含：

- Case ID/version/Seal 与 Portfolio configuration digest；
- Validity、Evaluation State、Verified Delivery、Convergence、Human Intervention、Overall；
- 完整 Convergence subfacts；
- 六个 Requirement 的稳定 ID、category 和 verdict；
- build、regression、change-boundary category verdict。

Builder 不包含 failure stage、messages、Run graph、Tool/Mutation metrics、latency、final response或 Judge。
Case/Portfolio/schema/config drift使两个 Fingerprint不可比较。两次 canonical payload相同才产生
`stable_pass|stable_fail`；不同产生 `investigation_required`；缺少任一 trusted terminal slot产生
`incomplete`。

## 12. Completion 与公开投影

Completion 只有在八个 slot 都完成 non-leakage gate 后生成。它绑定 Definition digest、Ledger head、每个
attempt/slot、Trial Bundle digest、Hard Outcome Fingerprint和四个 Stability。Exclusive create保证一次性。
独立 verifier从 Definition、Ledger和Bundles重算所有引用后才接受。

`complete`和`verify`命令必须接收仓库外的private Evidence Map。该输入只在执行时把八个slot解析到
对应Trial Evidence Directory与private Case Pack，不写入Definition、Ledger、Completion或public report。
命令逐slot重验append-only Result Revision、Environment digest、冻结配置、Bundle、Fingerprint与保留的
non-leakage report；缺失、重复或不匹配的resolution一律阻止Completion。

Public projection只包含 Portfolio identity/config digest、Case public identity/Seal、slot public state、
Hard Outcome public fields、Fingerprint digest、Stability、observed limitations和non-leakage policy outcome。
Schema禁止 private locator、成员真实身份、raw command/message、canary、reference/verifier/mutant detail、
Pass Rate、rank、Pass@k、composite score和formal claim。

## 13. 四个 Case 的实现约束

### DC-001 — 多版本事件归一化管线

- R1：v1/v2 input转为同一 canonical event，不修改输入；
- R2：按 public identity去重，版本冲突 deterministic resolve，输出顺序稳定；
- R3：生成稳定 activity summary 与 canonical JSON serialization；
- R4：batch 与任意 chunks byte-identical；
- R5：legacy helper regression 与 Agent tests；
- R6：统一 change boundary。

### DC-002 — 并发幂等执行协调器

- R1：canonical request identity 与 input digest；
- R2：并发 claim，同 identity/same input合并，不同 input conflict；
- R3：terminal receipt、retry taxonomy、expired claim recovery；
- R4：concurrent original/replay最多一个 managed effect且相同 receipt；
- R5：existing single request success/failure regression；
- R6：统一 change boundary。

### DC-003 — 版本化状态迁移与旧数据保持

- R1：检测并验证 v1/v2/v3；
- R2：v1→v2→v3 preserving migration；
- R3：atomic write、failure rollback、repeat no-op；
- R4：direct/step byte-identical v3且failure不改变source；
- R5：native v3 regression；
- R6：统一 change boundary。

### DC-004 — 受限 Workspace Patch 事务

- R1：path normalization与absolute/traversal/symlink/alias rejection；
- R2：deterministic create/update/delete plan、quota与conflict；
- R3：staging、atomic commit与failure recovery；
- R4：full commit或byte-identical rollback，所有write attempt留在root；
- R5：legal nested create/update/delete regression；
- R6：统一 change boundary。

## 14. 兼容与失败语义

- v2 demo、Case Seal、Suite和历史 Trial字节不变；
- v0.36不生成Formal Pass Rate，不修改v0.34 historical docs中的未完成ADR-0094事实；
- v3 structural/admission failure发生在dispatch前，是Invalid attempt；
- post-dispatch subject failure是valid Hard fail；
- verifier/process/schema failure是Evaluation Pending；
- post-dispatch configuration drift、irrecoverable evidence gap或leak使Portfolio incomplete；
- Judge unavailable不影响Hard Outcome、Fingerprint、Stability或Completion。
