---
document_type: implementation-plan
version: v0.31
authority: implementation-status
status: in_progress
implementation_authorized: true
last_updated: 2026-08-02
---

# v0.31 实施与验收计划

> 版本范围：[README.md](README.md)
>
> 实施设计：[architecture.md](architecture.md)
>
> 内置工具对等：[ADR-0089](../../adr/0089-attested-built-in-mcp-tool-parity.md)
>
> 资格证据边界：[ADR-0090](../../adr/0090-team-delivery-qualification-evidence-boundary.md)

## 当前结论

v0.31 的生产实现、打包态十三工具 Gate、Qualification Runner、公开 demo、私有 Sealed Pack
与证据链均已落地。打包态 Antigravity、Codex 与 OpenCode 各自真实执行了完整十三工具目录；
普通非 Rovai `agy` 保持空目录、十三次 `run_not_bound` 与零领域写入。

首个有效 CAL-001 的 `delivery_unknown` 失败永久保留。修复后的新 Team Configuration 使用同一
密封 Case、相同 30 分钟 / 10 AgentRun / 9 A2A 预算完成了有效校准：外部 verifier 与完整 Run
树均通过，四名成员全部参与，实际使用 7 AgentRun / 6 accepted A2A，且没有投递后人工干预。
校准不计分；十二次自主 Trial 仍未启动，因此 Pass Rate 仍不存在。当前结论是协作链路门禁
已通过、自主交付资格尚待正式套件；`implementation_status` 继续为 `in_progress`。

## 实施前本机准备记录（非产品完成度）

2026-08-02 已通过打包 Core 的公开 `agents.runtime.set` 命令保存并在桌面 App 重启后复核：

- [x] 小狐狸：Codex `gpt-5.6-sol`、medium、`danger-full-access / never`；原配置已精确匹配。
- [x] 小河狸：Codex `gpt-5.6-sol`、medium、`danger-full-access / never`。
- [x] 咕咕：OpenCode `opencode/north-mini-code-free`、`permission=allow`。
- [x] 小兔：Antigravity `gemini-3.6-flash-high`、`accept-edits`、sandbox on、skip-permissions off。

四个成员的 Runtime Readiness 在保存后均为 `ready`。本次没有安装或授权 v0.30 的单工具
Antigravity Team Plugin；当时的公开状态仍为 `managedConfig=not_installed`、
`permission=consent_required`、`ambientMcpIsolation=preserved_uncontrolled`。因此这里的 `ready`
只证明 Runtime/模型/原生执行权限可用，不证明 Gate 1、完整十三工具或 Qualification 环境成立。

上述段落是 Gate 1 实施前的时间点记录。当前受管 Plugin 已指向最终 packaged Core，
`~/.gemini/antigravity-cli/settings.json` 中十三条精确规则完整存在、无对应 deny/ask；修复后的
Qualification Team Configuration 另行冻结 per-run `dangerously_skip_permissions=on`，避免
非交互 `agy --print` 等待不可显示的终端审批。它不向 Bridge 写入凭据，实际内置工具能力仍只对
通过 Run attestation 的进程开放；`sandbox=on` 也不被描述为严格 OS 安全边界。

## 里程碑总览

| Checkpoint | 目标 | 状态 | 进入下一阶段的硬门槛 |
|---|---|---|---|
| 0 | 冻结设计、团队配置与证据口径 | `complete` | 用户确认 README、architecture 和两份 ADR |
| 1 | Antigravity 十三工具目录、协议与统一路由 | `complete` | 单元/协议测试通过，无第二份业务 Schema/handler |
| 2 | 十三规则权限 bundle、兼容性与状态投影 | `complete` | 完整 bundle 可独立授权、撤回、恢复并失败关闭 |
| 3 | 真实十三工具正向/负向 Smoke | `complete` | Gate 1 全部通过且 credentialed Runtime 无回归 |
| 4 | Qualification Runner 与公开 demo | `complete` | out-of-process 生命周期、预算和双门槛可重复验证 |
| 5 | Sealed Pack、Case Seal 与外部 verifier host | `complete` | 四案例均通过 admission/determinism/reference 检查 |
| 6 | 私有 Evidence Bundle 与报告 | `complete` | 成败同等保留，脱敏导出不泄漏私有材料 |
| 7 | 校准与十二次 Formal Trial | `calibration_passed_trials_pending` | 修复后 CAL-001 通过；十二次 Trial 尚未运行 |
| 8 | 全仓验收、打包与版本状态收口 | `verified_open` | 修复包与校准已验收；版本等待 Checkpoint 7 的正式 Trial |

## Checkpoint 0：设计与执行授权

- [x] 冻结 Qualification 命题、团队配置、案例组合、预算和 Repeat 口径。
- [x] 冻结 Verified Delivery + Orchestration Convergence 双硬门槛。
- [x] 冻结零人工边界、Invalid/Fail 分界和环境漂移规则。
- [x] 冻结 Antigravity 全部十三个内置 MCP 工具对等要求。
- [x] 冻结非对抗性 withheld verifier、私有原始证据和显式脱敏导出边界。
- [x] 接受 ADR-0089 与 ADR-0090。
- [x] 收到用户对生产代码、正式案例和 Trial 的明确实施授权。

## Checkpoint 1：Antigravity 完整内置工具目录与路由

### Catalog

- [x] 将 canonical name、Antigravity alias、描述、输入/输出 Schema 和 receipt identity 收敛为
  credentialed/attested 两条运输共同使用的单一 catalog。
- [x] 固定十三个 dotless alias，并测试一一映射、无遗漏、无重复和 digest 稳定性。
- [x] 保证 Bridge 不复制 Task、Context、Memory 业务 Schema，不解析领域状态。

### Attested protocol

- [x] 为 attested `Call` 增加 protocol version、catalog digest、alias 与 canonical operation。
- [x] Core 只接受 catalog 闭集映射，不接受任意 command 或客户端自报授权身份。
- [x] 将 `runtime_tool_call_id` 的 canonical digest 扩展到工具 identity 与参数 digest。
- [x] 保持 OS peer PID、直接父进程、启动时间、可执行文件、Claim、lease generation、Binding、
  Epoch 的每次 List/Call 检查。

### Unified authorization

- [x] 将 attested Run identity 接入既有统一 `handle_team_tool_authorized` 路由。
- [x] 复用 A2A、Task、Context、Memory 的 Capability、版本、边界、Policy、配额和 secret filter。
- [x] 删除 `post_message` 专用的授权假设；保留 canonical 结构化错误和零写入保证。
- [x] 验证取消、换绑、Core restart、Bridge reconnect 与 crash 的 fencing 行为。

## Checkpoint 2：权限 bundle、Session 与状态

- [x] 将单一 `mcp(rovai_team/post_message)` 管理提升为有序、版本化的十三规则 bundle。
- [x] Plugin 权限仍由用户单独同意，不修改全局 `dangerously_skip_permissions`；正式
  Qualification Runtime 配置显式冻结 per-run `dangerously_skip_permissions=on`。
- [x] 对完整 bundle 实施 ownership record、锁、全文 CAS、原子替换、journal、未知字段保留和回读。
- [x] 同名用户 Server、用户 deny/ask、未知来源、部分规则、shadowing 或 divergence 全部失败关闭。
- [x] 状态明确区分 Plugin conflict、bundle incomplete、rule blocked、ownership diverged、catalog mismatch
  和 complete parity。
- [x] 将 catalog、alias map、Schema、protocol、permission bundle 与 Charter contract digest 纳入
  Native Session compatibility identity。
- [x] 从单工具迁移时创建新 Binding；旧 Session、旧 lease 和撤销授权不得热升级或复活。
- [x] 保持 `ExternalMcpProjection=Unsupported` 与
  `AmbientMcpIsolation=PreservedUncontrolled` 的真实披露。

## Checkpoint 3：Gate 1 真实十三工具 Smoke

以下验收必须在真实打包 App/Core、真实 Antigravity 账户与真实模型调用上运行；fixture mock、直接
handler 调用或只看 `tools/list` 都不能替代。

- [x] `tools/list` 精确返回十三个 dotless alias。
- [x] `post_message` 完成 A→B→A 投递和回信。
- [x] `create_task → list_tasks → update_task` 覆盖 optimistic version 与“不隐式唤醒”。
- [x] 五个 Context 工具覆盖 frozen boundary、窗口、线程和摘要。
- [x] 四个 Memory 工具覆盖读取、Companion/Relationship write、Hearth proposal 与 Policy。
- [x] 缺 Capability、stale version、越界、不可读、quota、secret filter 均返回 canonical 拒绝。
- [x] bundle 缺失/撤回、Session 换绑、取消、Core restart 和 Bridge crash 均失败关闭。
- [x] 普通非 Rovai `agy` 看到空目录；十三个 direct call 均为 `run_not_bound` 且领域计数零变化。
- [x] Codex、OpenCode 等 credentialed Runtime 的原十三工具全量回归通过。
- [x] 临时 Plugin/权限改动按 exact identity 清理，不删除或覆盖用户配置。

Gate 1 未全部完成时，Checkpoint 4～7 不得产出正式 Qualification 结果。

## Checkpoint 4：Qualification Runner 与公开 demo

### Formal preflight

- [x] 新增 out-of-process CLI Runner，通过公开 stdin JSON-RPC 驱动记录 digest 的 Core。
- [x] 区分 `demo` 与 `formal`；只有 packaged Release Core + sealed private case 可形成正式证据。
- [x] 检测正在运行的 App/Core/attested owner 并拒绝，不自动 quit、kill 或接管。
- [x] 为每次 Trial 创建全新 Core data、workspace、Camp、Conversation、Session、Task 和 Memory。
- [x] 通过公开命令写入冻结四角色配置，不直接编辑 SQLite。
- [x] 采集 Environment Manifest；任何模型、权限、工具、二进制或 Seal 漂移都在投递前停止。

### Dispatch and observation

- [x] 只向 Default Lead 发送一次普通需求，并原子记录 accepted dispatch boundary。
- [x] 投递后不发送消息、审批、命令、修改、Retry、restart 或 continue。
- [x] 轮询权威 AgentRun tree、Camp/Task snapshot 和 Execution Evidence。
- [x] 精确计数 wall time、AgentRun 与 A2A；达到任一阈值自动 CampTurn Stop 并等待 fencing。
- [x] Runtime/tool/auth/timeout 等所有投递后异常记录为有效 Fail，而不是 Invalid。
- [x] 所有 Runtime process 终止后才冻结最终 workspace 并启动 verifier。

### Public demo

- [x] 提供一个公开、非计分 demo fixture、verifier 和固定预期结果。
- [x] 覆盖 baseline materialization、预算停止、人工干预检测、Invalid/Fail 和双门槛聚合。
- [x] 文档明确 demo 只验证 harness，不形成默认团队能力结论。

## Checkpoint 5：Sealed Qualification Pack

- [x] 定义 canonical Pack/Case manifest、Case Seal 和版本迁移。
- [x] Pack 位于用户指定的私有外部目录，不进入开源仓库或 Agent workspace。
- [x] 正式 Prompt 只包含目标、验收约束和允许边界，不含角色名、协作步骤或隐藏评分点。
- [x] Trial workspace 为单 baseline commit、无 Remote 的一次性 Git 仓库。
- [x] 外部保存 baseline tree/file manifest，不信任 Agent 可修改的 `.git`。
- [x] verifier/reference locator、密钥和 pack path 不进入 Runtime env、argv、Prompt 或 Execution Evidence。

每个正式案例必须分别证明：

- [x] 初始 fixture 的 task-independent build/public baseline 健康。
- [x] 初始 tree 在 task-specific verifier 上稳定产生预期失败。
- [x] 独立 reference implementation 通过全部 public/withheld/forbidden checks。
- [x] 两次全新 materialization 的 verifier 结果与规范化输出一致。
- [x] fixture、Prompt、verifier、边界、预算和 reference evidence 共同进入 Seal。

正式 Pack 包含 CAL-001、TQ001 TypeScript、TQ002 Rust 后端可靠性、TQ003 React/TS 交互和
TQ004 Rust/JSON/React 跨层案例。任何修正都提升 case version，不能静默改写已运行 Seal。

## Checkpoint 6：证据、报告与隐私

- [x] 定义 append-only、schema-versioned Qualification Evidence Bundle。
- [x] 保存 Environment Manifest、Case Seal、dispatch boundary、Run tree、预算事件、终止证据、
  final tree manifest、verifier 结果和双门槛结果。
- [x] 成功、失败、停止和 Invalid 使用同一保留策略；中断写入可恢复或明确不可恢复。
- [x] Collaboration Evidence Matrix 只由权威事件推导；无法自动判断的语义写 `indeterminate`。
- [x] 报告分别呈现硬结果、协作矩阵和可选人工盲审材料，不计算综合分或排行榜。
- [x] 只在用户显式操作后导出脱敏摘要；禁止导出凭据、环境变量值、Runtime 私有日志、隐藏推理、
  verifier、reference implementation、Pack locator 或完整隐藏评分点。

## Checkpoint 7：校准与正式 Trial

### Collaboration Path Calibration

- [x] 使用 30 分钟 / 10 AgentRun / 9 A2A 的 CAL-001 显式引导四角色交接。
- [x] 校准验证 Team Tool、Context、Memory、回传、Lead 集成与完整终止链。
- [x] 校准结果只记 Gate，不纳入计分、Pass Rate 或自主协作矩阵。

2026-08-02 的首个有效校准绑定 packaged Release Core 与冻结四角色配置，结果为：

```text
Validity                       valid
Overall                        fail
Verified Delivery              false
Orchestration Convergence      false
Post-Dispatch Human Intervention false
Observed AgentRuns             4
Observed accepted A2A          3
Budget event                   delivery_unknown at 84.5s
Affected Runtime               Antigravity / agent-qilu
Runtime descendants terminated 10/10, no lingerers
Verifier                       public pass; regression pass; requirements fail
```

一次更早的诊断运行在相同 Antigravity 空输出状态出现后被人工终止，仅用于发现 Runner 会等待到
总预算的问题，不构成 Formal Trial。随后 Runner 增加 `delivery_unknown` 立即预算停止规则；上表
结果来自全新环境、全新 suite id 的有效运行，没有投递后人工干预。该失败属于冻结 Team
Configuration 的正式校准结果，不能作为 Invalid 丢弃，也没有进入 Autonomous Pass Rate。

失败诊断与修复没有改写 Case、Seal 或预算：

- attested Prepared Binding 的 Task、Context、Memory 统一复用已证明 Run identity；
- AGY 同时获得 canonical execution workspace 与 attachment root，并隔离宿主 Git 全局配置；
- 已验证 Native Session 但缺少 final text 时结算为确定性 delivered failure，不再误报输入交付未知；
- 非交互 Qualification AGY 使用 per-run skip-permissions；
- A2A 消息中的唯一活动 Task 引用绑定到接收者 AgentRun，Core 明确 Task 结果通道；
- Default Lead 可更新 Camp 内任意非终态 Task 完成集成收口，普通成员仍只能更新自己的 Task 或
  领取未分配 Task。

修复后正式校准 `v031-cal001-repair-20260802-5` 的结果为：

```text
Validity                         valid
Overall                          pass
Verified Delivery                true
Orchestration Convergence        true
Post-Dispatch Human Intervention false
Observed AgentRuns               7 / 10
Observed accepted A2A            6 / 9
Actual members                   Lead, Reviewer, Tester, Frontend
Budget event                     none
```

AGY 原生 transcript 复核到 3 次 Context Search、1 次 Memory Search、1 次 Companion Memory
Write，以及 Task List/Update 和 Team reply；最终四个 Task 均为 `completed`，外部 verifier 与
运行时终止均收敛。该结果只解除校准门禁，不进入 Autonomous Pass Rate。

私有证据根为目录 `0700`、文件 `0600`；仓库只记录以下可核对 digest，不记录 locator：

```text
Team Runtime Compatibility  9dddcec2c0fca928a54e34beebd2321dbada71754fe16885bba4fa14f7054458
Suite Summary sha256         1e455ab6958ab92a2c7630ecbb1f27ed94dde61dccd883892f253f18c7b52899
Environment Manifest sha256  98e99cccec5ca305608adcec6f9cd0a2960aa721165b098fdece0510e189cdfd
Trial Result sha256          59415c4a611d71258486200acb1a2f3bb4e2062b92b99676b472d3c751d14d6e
Observations sha256          536a9436e6ec3376939c38d93c2f35cde4b49c5a0bec0f273525fa8ce35df0e4
```

修复后通过结果的可核对 digest：

```text
Team Runtime Compatibility  e2531b07fe2cd5e54c8a3a6db441ba8f83aeadd5b033c6775b3428ee60bf3e2e
Environment Manifest sha256  974d2c75a75847b653c9538a0fc267f3556d9c2f4c9a3b8a513c645a87f21c92
Trial Result sha256          422894fb8c833338836dbb61039cf9a87d2e3dc7985ef1a6c7789a9808337665
Observations sha256          48a0ece718f7c96c6caf4ef93ced28a1d5ed56fa3c9f469919b088f7ed0bad2d
```

### Autonomous qualification

- [ ] 校准通过后生成记录 seed 的三轮确定性顺序；每轮串行运行四个案例。
- [ ] TQ001：12 分钟 / 3 AgentRun / 2 A2A。
- [ ] TQ002：25 分钟 / 8 AgentRun / 7 A2A。
- [ ] TQ003：25 分钟 / 8 AgentRun / 7 A2A。
- [ ] TQ004：40 分钟 / 12 AgentRun / 11 A2A。
- [ ] 每次 Repeat 使用全新环境，不继承 Session、Task、Memory 或结果。
- [ ] 有效失败继续余下 Trial；只有 drift 或 pre-dispatch Invalid 暂停套件。
- [ ] 报告每案例 `0/3…3/3`、十二次原始结果和总 Pass Rate，不使用 Pass@3。

## Checkpoint 8：仓库与发布验收

2026-08-02 最终验收实际运行：

```text
cargo fmt --check                                                   PASS
cargo test -p rovai-core                                           PASS (241 lib + 54 bin; 5 manual Runtime tests ignored)
cargo clippy --workspace --all-targets --all-features -- -D warnings PASS
pnpm typecheck                                                      PASS
pnpm test                                                           PASS (27 files / 159 tests)
pnpm build                                                          PASS
pnpm package:mac                                                    PASS (macOS arm64 directory package)
codesign --verify --deep --strict dist/mac-arm64/Rovai-ai.app       PASS (ad-hoc, Designated Requirement satisfied)
node scripts/qualification-case.mjs check --case qualification/demo/DEMO-001 PASS
git diff --check                                                    PASS
```

项目没有 `pnpm lint` 或 `pnpm build:mac` script；等价的实际门禁分别由严格 TypeScript/Vitest/
Clippy 和 `pnpm package:mac` 执行，不虚构不存在的命令。

最终打包 Core：

```text
path    dist/mac-arm64/Rovai-ai.app/Contents/Resources/bin/rovai-core
sha256  4886357929c3aa06a20547ade390d6134c67bce8bf084a7db5450cd45d564a3e
```

同一 digest 的打包 Core 已完成：

- Antigravity `1.1.9`：十三个 canonical 工具收据齐全；Task version 2、Context Summary、
  1 个 Memory Revision、1 个 pending Hearth proposal、A2A leaf 与重启不重复全部成立；普通
  非 Rovai `agy` 的 `tools/list` 为空，十三个 direct call 全部 `run_not_bound` 且领域写入为零；
- OpenCode `1.18.5`：十三工具各自使用真实 AgentRun 调用并全部成功，跨 AgentRun provider call ID
  不再误命中旧幂等结果；
- Codex `0.146.0`：十三工具各自使用真实 AgentRun 调用并全部成功；
- public DEMO-001：valid、`verifiedDelivery=true`、`orchestrationConvergence=true`、
  `postDispatchHumanIntervention=false`、overall pass；此结果只证明 harness 正常成功路径；
- Formal CAL-001：原始配置有效失败与修复配置有效通过均按上节保留；当前校准门禁已解除，
  正式 Autonomous Trial 仍为 `0/12 completed`，不是 `0/12 pass`，Pass Rate 为 `null`。

Case admission 另行修复了一个预运行证据非确定性：原实现把含耗时的 public-check stdout/stderr
digest 纳入 reference evidence；现改为只密封稳定的 pass/code/timeout 语义。CAL-001 与四个 TQ
case 在私有权限收紧后连续两次 admission 得到完全相同的 Seal，且初始失败、reference pass 与
verifier 确定性仍全部成立。私有 locator、verifier 与 reference 内容未写入仓库。

## 完成定义

只有同时满足以下条件，才能把 `implementation_status` 改为 `complete`：

1. Antigravity 十三工具真实正向/负向 Smoke 全部通过，普通 `agy` 保持零工具、零领域写入；
2. 完整权限 bundle、Session 兼容、统一授权和 credentialed Runtime 回归有代码与测试证据；
3. Runner、public demo、Sealed Pack admission、withheld verifier 与私有证据链均可重复运行；
4. CAL-001 通过，四案例共十二次 Formal Trial 均已产生有效硬结果和协作矩阵；
5. 全仓测试与 packaged Release 验收完成，文档记录真实 digest、命令、数量和已知限制；
6. 当前版本 README、架构、ADR、Runtime 兼容性事实与实现没有未披露漂移。

正式成绩允许失败；“完成 v0.31 实施”指评测系统和证据链完成，并不等于默认团队必须
`12/12`。如果团队未通过，报告原始失败并保持结论诚实，不调 Prompt、角色或案例后覆盖结果。
