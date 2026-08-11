---
document_type: implementation-plan
version: v0.58
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-11
---

# v0.58 实施与验收计划

## Checkpoint 0：长期边界

- [x] 冻结 logical Runtime identity 与 mutable Installation/effective Runtime 的职责；
- [x] 明确一次 rebind 上限和 refresh 后的第二次完整校验；
- [x] 新增 ADR-0156 并更新 Runtime Architecture 与 CURRENT 路由。

## Checkpoint 1：Core 与持久化

- [x] dispatch 对可恢复 blocker/fingerprint drift 执行同步 refresh、re-resolve 与 rebind；
- [x] rebind 原子校验 logical identity、current snapshot、config digest、Run fence 与次数上限；
- [x] Migration 72 增加 initial Runtime evidence 和 `runtime_rebind_count`，既有 Run 原位回填；
- [x] 用户消息与 Message Delivery 两条生产 Run 创建路径写入 initial evidence；
- [x] 成功路径写入 `runtime_drift_detected` / `runtime_rebound`，失败保留具体 blocker/error code。

## Checkpoint 2：验证

- [x] 单元测试覆盖 runtime-default 漂移、Installation/policy identity 拒绝、initial/effective evidence、
  原子 rebind 和第二次 rebind 拒绝；
- [x] 完整 Rust workspace test、Clippy、format 与通用文档门禁通过；
- [x] 回填实际命令、测试计数与当前限制；
- [ ] 使用可控 Copilot CLI v1/v2 fixture 或真实原地升级完成 dispatch smoke，确认同一 Run 继续；
- [ ] 完成 Runtime drift smoke 后把版本状态同步为 complete。

## Checkpoint 3：真实请求复盘修正

- [x] Session Charter 明确 Runtime final 不进入公屏、公开回复必须成功调用 `rovai send`；
- [x] Charter 文案变化不进入 Native Binding compatibility digest，不主动轮换既有 Session；
- [x] ADR-0157 删除未进入 Runtime Context 的 `expectedOutput` IPC、持久化与读模型字段；
- [x] Migration 73 原位删除 `agent_run.expected_output` 并保留历史 Run 其余事实；
- [x] Canonical Activity lifecycle merge 保留 ACP started kind/title，稀疏 terminal 只更新状态；
- [x] Codex 保留 app-server `commandActions` 的安全结构字段，并在 `title` 为空时生成有界 command/file presentation hint；
- [x] Stop 只选择拥有 queued/running/waiting AgentRun 的 running/waiting Turn；
- [x] 增加 Charter、Canonical lifecycle 和 Renderer cancellation 回归测试。

## Checkpoint 4：受管 Skill 默认全 Runtime 投递

- [x] 新安装的 Rovai 内置 Skill 默认启用并创建全部九个 Skill Group Assignment；
- [x] 新导入 Skill 同样默认启用并创建全部九个 Skill Group Assignment；
- [x] Migration 74 为既有 active Skill 一次性补齐缺失分组，并保留当前 Revision 与显式启停状态；
- [x] 迁移后用户删除的分组与禁用状态在后续启动中保持，不由 bundled install 强制恢复；
- [x] Core 回归、Skill smoke 断言、ADR、领域术语和设置 UI 合同同步默认差异。
- [x] Skill 启停事务提交后立即返回，后台触发 projection reconcile；Renderer 只更新当前行且
  Switch 独立显示“已启用 / 已停用”，不再渲染重复状态 Badge。

## Checkpoint 5：内置 Tasteful UI Skill

- [x] 固定 `tasteful-ui` 上游 Revision `159ccd47a320f3a7bd0289d07366d422211895a1`，完整引入 81 个上游文件；
- [x] 补充 MIT `LICENSE`、固定来源 `NOTICE` 与匹配的 `agents/openai.yaml`，不引入启动时网络依赖；
- [x] Core 构建时递归生成完整 84 文件 bundled manifest，拒绝符号链接和非普通文件；
- [x] 新安装 `tasteful-ui` 复用内置 Skill 的默认启用、全九组分配、不可变 Revision 和用户修改保持语义；
- [x] Core、Skill smoke、Renderer acceptance、领域词汇与 ADR 官方集合清单同步为六个。

## Checkpoint 6：会话叙述与工件双宽度

- [x] 用户消息移除独占 `brand-soft` 气泡，与 Agent 普通正文共用开放阅读平面；
- [x] 同一作者的相邻真实消息只收紧间距，不隐藏 metadata 或创建回合模型；
- [x] `min-width: 1800px` 时会话工作列扩展至 1040px，叙述保持约 76ch，代码与表格最多使用 930px；
- [x] Hover、Focus、Copy、A2A、Task、Approval、AgentRun、Composer 与 Inspector 边界保持不变；
- [x] 用户、Agent 与 A2A 消息的 Copy 统一锚定消息内容列右上角，不跟随正文或 footer 尺寸漂移；
- [x] 完成 packaged App 的 1440×920、2560×1440、1040×700 会话视觉验收。

已完成自动化验证：

- `cargo test --workspace`：Library 320、CLI 10、Core binary 54 通过，3 个既有手工 Runtime smoke ignored；
- `pnpm test`：文档治理 21、Vitest 253、Node qualification/benchmark 147 通过；
- `cargo test -p rovai-core codex_ -- --nocapture`：Codex structured presentation、Adapter 与 MCP fixture 通过；
- `cargo test -p rovai-core rebind -- --nocapture`：2 个新增 rebind 测试通过；
- `cargo test -p rovai-core db::tests::v72_backfills_initial_runtime_evidence_without_overwriting_existing_values -- --nocapture`：Migration 72 回填测试通过；
- `cargo test -p rovai-core db::tests::v73_removes_expected_output_without_losing_agent_runs -- --nocapture`：Migration 73 删列与历史 Run 保留测试通过；
- `pnpm exec vitest run apps/desktop/src/renderer/src/theme-tokens.test.ts apps/desktop/src/renderer/src/App.test.ts`：2 个文件、79 项 Renderer 契约通过；
- `pnpm package:mac` 与 `pnpm accept:runtime-activity-ui`：签名 App 验收通过；2560×1440 下会话列 1040px、叙述 622.31px、Composer 1040px，1040×700 无整页或会话列横向溢出；
- `pnpm accept:member-lifecycle-ui`：用户消息透明开放表面、原生文本选择、Copy、Mention、成员页返回与 200% zoom/reduced motion 回归通过；
- `cargo test -p rovai-core official_skills_default_to_all_groups_and_preserve_user_changes -- --nocapture`：内置 Skill 初始九组与后续用户修改保持通过；
- `cargo test -p rovai-core imports_default_to_all_groups_and_updates_preserve_user_changes -- --nocapture`：Imported Skill 初始九组与 Revision 更新保持通过；
- `cargo test -p rovai-core v74_assigns_every_active_skill_to_all_runtime_groups_once -- --nocapture`：Migration 74 对内置与 Imported Skill 的一次性回填通过；
- `cargo clippy --workspace --all-targets -- -D warnings` 与 `cargo fmt --all -- --check` 通过；
- `pnpm docs:test`：21 个测试通过；`pnpm docs:check` 通过，覆盖 58 个版本目录与 158 个 ADR。

当前限制：自动 rebind 按 AgentRun 持久化限制为一次；尚未用真实 Copilot CLI 原地升级验证
`dispatch -> refresh -> rebind -> launch` 的完整进程链路，因此本版本仍为 `in_progress`。

## 完成条件

- [ ] 正常受信 CLI 原地升级不再产生 `runtime_integrity_failed` terminal Run；
- [x] identity/trust/auth/model/permission/protocol 无法重新确认时仍 fail closed；
- [x] 初始与有效 executable evidence 可审计，rebind 次数跨重启保持有界；
- [x] 文档、Migration、Core 实现和测试结论一致。
