---
document_type: implementation-plan
version: v0.85
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-15
---

# v0.85 实施与验收计划

## Checkpoint 0：版本与长期合同

- [x] 冻结完成的 v0.84 并开启唯一 current v0.85；
- [x] 接受 ADR-0191，完整替代 exactly-twelve inventory 的 ADR-0181；
- [x] 新建 Built-in Tool Transport v12，并把 v11 转为 historical 合同入口；
- [x] 更新 CURRENT、Contract/Architecture/Documentation routing 与 ADR generated history。

## Checkpoint 1：Skill 与 official inventory

- [x] 导入 `member-studio` 的身份、名牌确认和完成报告内容；
- [x] 只调整头像 reference：4:5 原图、轻量方形粗裁、Agent 自选 run-readable 路径、无生图时网上找图、
  最终无能力时无头像；
- [x] 注册第十三项 official Skill，保持 `member-studio` 为 `user_managed`；
- [x] 对启动前已存在的 imported 同名 Skill 做保留 ID/配置的 official 晋升，并增加回归测试；
- [x] 通过 skill-creator quick validation。

## Checkpoint 2：Transport v12 与成员创建

- [x] 增加 closed `member.create` input/result schema、十四项 CLI mapping/help/Charter/golden projection；
- [x] direct user-triggered attestation 阻止 A2A，`creationKey` 绑定领域 command 并提供跨 request replay；
- [x] AgentProfile create command 原子接受受控 `avatarRef`；
- [x] Evidence 只投影头像路径存在性，不保存本地路径；
- [x] 更新 v12 capability fence、qualification 和十四项 Runtime smoke 脚本。

## Checkpoint 3：头像导入

- [x] 增加 PNG/JPEG byte sniff、普通文件/no-symlink、10 MiB、8192 边、3200 万像素和 allocation limits；
- [x] 应用方向、去元数据、最长边 2048 PNG source、默认短边方形粗裁和 192×192 icon；
- [x] 使用 deterministic asset ID、Main-compatible manifest v1、0600/0700、fsync 与 atomic rename；
- [x] 覆盖 4:5 crop、same-key replay 和 different-image conflict。

## Checkpoint 4：文档、smoke 与最终验证

- [x] 更新 Skill/CLI smoke、Settings capture 和 Runtime compatibility 的十三/十四项期望；
- [x] 运行 Rust lib/CLI/Core 测试、format、strict Clippy 与 TypeScript typecheck/相关 Vitest；
- [x] 运行 Skill validation、文档治理、Node syntax 和可执行的确定性 smoke；
- [x] 检查最终 diff、回填真实通过/未运行项，并在完成后标记本版本 complete。

## 最终证据

- `cargo fmt --all -- --check` 与 `cargo clippy -p rovai-core --all-targets -- -D warnings` 通过；
- Rust lib 462/462、`rovai` CLI 12/12、`rovai-core` 75/75 通过；四项明确标注的真实 Runtime manual smoke
  保持 ignored；
- `pnpm typecheck`、`pnpm test` 通过：21 项文档单测、50 个 Vitest 文件中的 340 项测试，以及 179 项 Node
  测试全部通过；
- `member-studio` 通过 skill-creator `quick_validate.py`；四个更新脚本通过 `node --check`；
- `pnpm smoke:core` 在隔离 data-dir 首次物化十三项 official Skill，重启后十三项全部命中 fast path；
  `rovai member create --help` 的实际 CLI 输出通过人工核对；
- 未运行 `pnpm smoke:builtin-cli`、`pnpm smoke:skills`、Settings capture 或真实十 Runtime 十四项联合 matrix；
  本版本只声明脚本、确定性合同和 Core 行为通过，不声明新的实机 Runtime 兼容性证据。
