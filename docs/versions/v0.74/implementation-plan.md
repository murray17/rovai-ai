---
document_type: implementation-plan
version: v0.74
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-14
---

# v0.74 实施与验收计划

## Checkpoint 0：版本与长期边界

- [x] 从最新 `origin/main` 开启隔离 worktree，以 v0.73 为基线建立唯一 current v0.74；
- [x] 接受 ADR-0181 并替代 ADR-0176，保持两项 `system_required`、十项 `user_managed`；
- [x] 明确自然标题只承担 discovery/阅读，可信 sender、recipient 与 reply relation 继续由 Runtime/Core
  拥有；
- [x] 明确不新增 workflow/session/stage/attempt/message kind 或 Agent-selectable reply target；
- [x] 完成九项跨版本文档影响判断。

## Checkpoint 1：Campfire 与 Grill Duo 系列

- [x] 更新 Campfire trigger，覆盖开场观点续跑并排除最终《篝火纪要》；
- [x] 将共享邀请、成员返回、定向回应、澄清和纪要全部写成显式 `rovai send` 行为；
- [x] 删除“任意选择旧消息作为 reply target”的暗示，跨观点回应改为正文引用；
- [x] 恢复未回复/含糊成员不得代写、一次主动澄清、单场推进与迟到回复边界；
- [x] 增加 accepted recipient/invitation 清单与 Opening Barrier，未收齐回复或权威终态前禁止分岔和纪要；
- [x] 把非 Lead 主持交接改为使用 `defaultLeadAgentId` 的显式 `rovai send --to`；
- [x] 更新 Grill Duo 两个 Skill 的前置触发语义、可信固定搭档验证与 caller return 命令；
- [x] 恢复两个 Grill 的用户回答续跑 trigger，并让新产生的唯一用户问题和最终确认显式 `--to-user`；
- [x] 完成 validator、bundle fixture 与 Core-managed reply topology 的定向回归。

## Checkpoint 2：Review Duo

- [x] 导入十一文件 `review-duo` Skill，保留 original Rovai provenance 与原则级 NOTICE；
- [x] 将触发收窄到明确双人/双轴/团队 review，避免覆盖普通单人 code review；
- [x] 将消息链改为 Core 可执行 topology：Lead 初始 sibling sends、搭档结果回复请求、final 回复结果；
- [x] 补齐 public-only / addressed `rovai send`、accepted、pending、Retry、duplicate、late result 与单场边界；
- [x] 把完整 duo 输入收窄为 Git SHA 或用户已提供的稳定共享 patch/附件；
- [x] 修复 Standards 结果模板引用，并为长 references 增加导航；
- [x] 用 accepted Standards request message ID、唯一 Spec locator、`camp.search` 和 exact `camp.read item`
  形成不依赖 recent history 的确定性 Spec 恢复链，同时保持 Standards 请求先于公开 Spec；
- [x] 为两轴结果增加 30 KiB UTF-8 工作预算、稳定 parts、accepted message ID manifest、digest 与有界 final；
- [ ] 完成正常 duo、wrong sender/parent、retry、stale、missing Spec、solo 与只读 dry-run 验收。

## Checkpoint 3：Official bundle 与 Settings

- [x] 把 `review-duo` 注册到 Core bundled constants、十一文件表和 `BUNDLED_SKILLS`；
- [x] 将 exact inventory 更新为十二项，保持 `review-duo` 为 `user_managed`、无 upstream；
- [x] 保持 `cli-operations` 与 `memory-stewardship` system-required、隐藏、不可关闭、全组投递；
- [x] 将 Settings 截图验收从九项更新为十项可配置 official Skill；
- [x] 通过 Core install/reconcile/provenance/digest/default-group 与 Renderer hidden-row 回归。

## Checkpoint 4：自动化、打包与发布

- [x] 运行四个 Skill validator、Markdown/reference 检查和 `git diff --check`；
- [x] 运行定向 Rust tests、`pnpm test`、`pnpm typecheck`、完整 Rust 与 Desktop build；
- [ ] 让严格 `cargo clippy --workspace --all-targets -- -D warnings` 在当前 `main` 基线上通过；
- [x] 运行文档 `docs:test`、`docs:check`、真实 base 的 `docs:check:ci` 与 ADR generation check；
- [x] 复查最终 diff，不纳入包级 README/CODEX-INSTRUCTIONS/MANIFEST 或其它任务改动；
- [x] 提交并 fast-forward 推送到 `main`；
- [x] 从已推送 commit 执行 macOS package、签名/bundle 检查和隔离 smoke；
- [x] 按用户授权退出旧日常 App，将已验证 `.app` 提升到 `/Applications` 并从安装位置验证。

## 当前证据与缺口

- 已完成：Skill 内容校准、Review Duo bundled source、Core registration、Settings 数量更新和版本设计；
- 已通过：四个 `SKILL.md` validator、定向与完整 Rust tests、Renderer/Node tests、`pnpm typecheck`、
  Desktop build、文档治理、ADR generation、格式和 diff 检查；
- Clippy 基线：严格命令只命中未被本版本修改的 `crates/rovai-core/src/memory.rs` 既有
  `too_many_arguments`；仅豁免该 lint 后，workspace/all-targets 通过；
- 已通过：从已推送 commit 生成 ad-hoc 签名 arm64 App，Core/CLI UUID 与构建产物一致，隔离 App/Core
  启动及 controlled shutdown 成功，并已提升到 `/Applications` 后从安装路径重新启动验证；
- 尚未完成：真实 duo dry-run 与严格 Clippy 基线修复；
- 因此本版本继续保持 `in_progress`。
