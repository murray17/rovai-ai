---
document_type: implementation-plan
version: v0.52
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-10
---

# v0.52 实施与验收计划

## Checkpoint 0：版本与合同

- [x] v0.51 冻结为 historical，v0.52 成为唯一 current；
- [x] ADR-0149 与 ContextManifest Evidence v9 冻结 bounded aggregate / exact bounded omission 分界；
- [x] ContextManifest 升到 v9，Profile v2 与 Context Formatter v11 保持；
- [x] Data Contract v0.52/schema 28/Migration 69 与 CampSnapshot schema 27 的独立版本轴明确。

## Checkpoint 1：精确模型字节与恢复

- [x] Public A2A Current Input 从 CampMessage/MessageDelivery/source Run 权威关系投影
  `member_call` sender，普通用户仍精确为 `type:user`；
- [x] preflight、重复 frozen Delivery 与最终 materialization 均 fail closed 校验作者和 lineage，
  Frozen payload 与 Manifest payload 复用同一 source bytes；
- [x] Run Notice 建立单一 rendered result，Frozen Delivery、模型 section、Manifest 共用 exact bytes/digest；
- [x] 增加带 Task 的 A2A preflight → materialize → Manifest 端到端回归；
- [x] structured history 使用持久 `camp_message.body`，与 canonical `camp.read item` continuation 同一文本空间；
- [x] 增加 Mention 发送后改名、长正文截断与前缀+continuation 精确重组回归。

## Checkpoint 2：有界 omission Evidence

- [x] `max_public_messages` 改为 count/sequence envelope aggregate，不保存 `messageIds`；
- [x] history/runtime budget 与 reference closure 的有界 omission 继续保存 exact IDs；
- [x] Core 用 SQLite aggregate 排除 trigger、included 和 already-explained bounded IDs，不构造完整历史 ID Vec；
- [x] 千级消息压力回归证明 Frozen/Manifest omission JSON 不随全部 ID 线性增长。

## Checkpoint 3：current-only cutover 与 Read Model

- [x] Migration 69 只接受 v0.50/schema 27/Migrations 66–68 source，清除旧技术 context/delivery state；
- [x] 保留完成业务历史，终止非终态 Run/Turn 与未完成 Delivery，重置 Binding/Session 水位；
- [x] Rust/TypeScript/Renderer CampSnapshot schemaVersion 统一升到 27；
- [x] 完成定向、workspace、TypeScript、docs 与 diff 验证。

## Checkpoint 4：代码证据优先的 Agent 仓库分析 Skill

- [x] 使用 `skill-creator` 初始化 `analyze-agent-codebase`，并提供匹配的 `agents/openai.yaml`；
- [x] `SKILL.md` 冻结只读默认、代码/测试证据层级、纵向调用链、已确认/推断/未知、文档漂移、
  可选 Camp 证据收集与单一主分析者合并规则；
- [x] 自包含 `references/dossier-structure.md`，规定分析轴、ReAct/Plan-and-Execute、子 Agent、Memory、
  Tool/Skill/权限判据和单一索引的专题文档合同；
- [x] Core bundled manifest、installation test、Skill smoke 与设置页 capture 期望扩展为五个官方 Skill；
- [x] 五个官方目录、frontmatter、默认调用提示、Core manifest 和投影夹具统一移除 `rovai-` 前缀；
- [x] Core 启动时只对精确的旧官方名称做本机原位去前缀，保留 Skill ID 与 Assignment；不提供 alias、
  双份发布、fallback lookup 或 Imported 冲突迁移；
- [x] ADR-0150、`CONTEXT.md`、Arctic Dawn 内置清单与版本影响记录同步；
- [x] 完成 Skill validator、Rust 定向测试、Skill smoke、文档治理、格式和 diff 验证。

## 完成条件

- [x] Rust workspace format/check/clippy/test 全部通过；
- [x] TypeScript typecheck 与 Renderer/Node tests 全部通过；
- [x] `pnpm docs:check` 与 `git diff --check` 通过；
- [x] 第五个官方 Skill 的结构、bundled installation、Runtime discovery 与文档治理验证通过；
- [x] 概览和本计划根据新增范围的真实验证结果恢复为 complete。

## 实际验证结果（2026-08-09）

- `cargo fmt --all -- --check`、`cargo check --workspace --all-targets`、
  `cargo clippy --workspace --all-targets -- -D warnings`：通过；
- Rust Core Library 306 项全部通过；bundled CLI 9 项全部通过；Core Main 54 项通过、3 项真实
  Runtime smoke 按合同 ignored。bundled CLI 的 2 项 Unix socket 测试在受限沙箱中被系统拒绝，
  在同机允许临时 socket 的隔离权限下复跑通过；
- `pnpm typecheck`、39 个 Vitest 文件/239 项测试、Node Qualification 78 项测试全部通过；
- `pnpm docs:check`、以 `origin/main` 为真实 base 的 `pnpm docs:check:ci` 与 `git diff --check` 通过。

## 新增 Skill 验证结果（2026-08-10）

- `quick_validate.py` 对 `analyze-agent-codebase`、`memory-stewardship`、`worktree`、`grill-duo` 和
  `grill-duo-with-docs` 五个目录全部通过；分析 Skill 正文 124 行，按需参考 138 行；
- `cargo test -p rovai-core skill::tests` 7/7、`cargo test -p rovai-core skill_projection::tests` 14/14
  通过；新增按字母排序更靠前的官方 Skill 暴露了冲突测试的
  列表首项依赖，已改为按稳定名称选择并复跑通过；
- `cargo check --workspace --all-targets` 与 `cargo fmt --all -- --check` 通过；
- `pnpm smoke:skills` 在受限沙箱中因私有 Unix socket 被系统拒绝，在允许临时 socket 的同机隔离权限下
  复跑通过：全新 Library 精确安装 `analyze-agent-codebase`、`grill-duo`、`grill-duo-with-docs`、
  `memory-stewardship`、`worktree` 五个默认启用、未分组的官方 Skill，并通过 Codex CLI 0.146.1 的
  native Skill delivery 回合；
- `pnpm docs:test` 21/21、`pnpm docs:check`、`DOCS_BASE_REF=origin/main pnpm docs:check:ci`、
  `pnpm docs:adr:generate -- --check`、两个修改脚本的 `node --check` 与 `git diff --check` 全部通过。
