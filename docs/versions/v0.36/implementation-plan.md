---
document_type: implementation-plan
version: v0.36
authority: implementation-status
status: complete
last_updated: 2026-08-04
---

# v0.36 实施与验收计划

## Checkpoint 1：冻结设计与权威

- [x] 冻结 README、architecture、Case schema、Portfolio schema 与 acceptance matrix。
- [x] 接受 ADR-0101 与 ADR-0102，保持 ADR-0094/0095/0098/0099 权威不变。
- [x] v0.35 冻结为 historical，并更新唯一 current version pointer。

## Checkpoint 2：Case manifest v3 与历史兼容

- [x] reader 明确支持 v2/v3，禁止隐式转换或重算 v2 Seal。
- [x] v3 强制六 Requirement、五公开 Check、R1～R4 Verification Pair 和 Runner-owned R6。
- [x] v3 拒绝全部 legacy collaboration gate 与旧 response/return 字段。
- [x] `DC-*` Case identity、统一预算、工具链与修改边界 fail closed。
- [x] schema catalog、meta-validation、正负 fixture 通过。

## Checkpoint 3：Hermetic admission 与 Challenge Mutants

- [x] public、verifier、reference 和 Mutant 使用同一 Hermetic Verification Profile。
- [x] initial/reference/public Checks 各自双物化并验证 exact outcome。
- [x] Challenge Manifest、三类 Mutant、exact failing Check IDs 与 observation digest 通过。
- [x] Case Seal v3 绑定 Challenge evidence、verification profile 和 non-leakage policy。
- [x] v2 `DEMO-001` seal check 与历史测试保持通过。

## Checkpoint 4：Portfolio authority

- [x] 实现 immutable Definition 与无 private locator 的配置 identity。
- [x] 实现 append-only hash-chained Ledger、replacement link 和可重建 Status。
- [x] 实现 Hard Outcome Fingerprint 与四态 Case Stability。
- [x] 实现 one-time Completion Attestation、public allowlist projection 和 no-score schema。
- [x] crash recovery、tamper、third-run、partial completion 与 configuration drift 负例通过。

## Checkpoint 5：Non-leakage gate

- [x] Pack realpath/permission/symlink admission 通过。
- [x] reference、verifier、Challenge Manifest 与 Mutants 使用独立 Canary。
- [x] delivered workspace、Trial Bundle、Judge Pack 和 public projection 全量扫描。
- [x] 任一命中保留证据并使 Portfolio incomplete，禁止 replacement execution。
- [x] 自动化明确不把 clean scan 声明为 Formal Isolation。

## Checkpoint 6：四个私有 Case

- [x] `DC-001` initial/reference/Mutants admission 完成。
- [x] `DC-002` initial/reference/Mutants admission 完成。
- [x] `DC-003` initial/reference/Mutants admission 完成。
- [x] `DC-004` initial/reference/Mutants admission 完成。
- [x] Git 只保留 public identities、Seals、schema/tooling 示例和无 locator registry。

## Checkpoint 7：八个固定诊断 Trial

- [x] `DCP-001@1.0.1` Definition 在首个 dispatch 前封存；`1.0.0` incomplete 证据保持不可变。
- [x] 八个 slot 使用相同 observable configuration 和全新 product/workspace state。
- [x] 每个 Trial valid、complete、bundle-verified、non-leaking；Layer 5 为真实 unavailable。
- [x] 四个 Case Stability 由两次 Fingerprint 推导，无第三次或结果选择。
- [x] Completion Attestation 与 public diagnostic report 生成并独立验证。

## Checkpoint 8：全量回归与发布

- [x] Qualification tests、schema tests、compatibility tests 与 demo smoke 通过。
- [x] Core library/bin tests、typecheck、Renderer tests、clippy、rustfmt/diff gate 通过。
- [x] Desktop build 与相关 macOS smoke 通过。
- [x] private Pack、Trial evidence 与临时 Runtime state 不进入 Git。
- [x] 完成证据写回文档后才把本计划和 README 标记 complete。

## 完成实证

- `DCP-001@1.0.1`：8/8 slot `valid_complete`，私有 Evidence Map 驱动的 `complete` 与独立
  `verify` 通过；公开结果见
  [`qualification/diagnostic/v0.36/results/DCP-001-1.0.1.json`](../../../qualification/diagnostic/v0.36/results/DCP-001-1.0.1.json)。
- Stability：`DC-001=investigation_required`；`DC-002`～`DC-004=stable_fail`；未增加第三次、未按结果
  替换 Case、未发布 Pass Rate。
- JavaScript/Renderer/Qualification：29 个 Vitest 文件、179 项测试通过；Node Qualification 78 项通过；
  `pnpm typecheck`、v0.34 25 项验收注册表与 v0.36 private admission 验收通过。
- Rust：`cargo test --workspace` 的 Core lib 279 项、bin 56 项通过，5 个仅手工真实 Runtime smoke 的
  测试按声明忽略；doc tests、`cargo clippy --workspace --all-targets -- -D warnings` 与
  `cargo fmt --all -- --check` 通过。
- macOS：`pnpm build:desktop` 通过；清除外部 Core rendezvous 占用后，隔离 `pnpm smoke:core` 通过。
- 发布边界：公开投影 schema、payload digest、字节一致性、closed-field 与私有材料扫描通过；仓库不包含
  private Pack、Evidence Map、Trial Bundle、Canary、reference、withheld verifier 或临时 Runtime state。

## 实施顺序约束

Case/Portfolio schema 与 deterministic fixtures 先于真实 Trial。四个 Case 必须全部 admission 后才封存
Portfolio Definition；Definition 封存后不得因运行结果修改 Case、团队、预算、toolchain 或 Judge policy。
任何修改先终止原 Portfolio 并创建新版本，不得修复原身份后继续。
