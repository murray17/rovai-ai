---
document_type: model-context-change
version: v1.72
revision: 5
confirmed_revision: 5
confirmation_status: confirmed
confirmed_by: Principal (local_user)
confirmed_at: 2026-09-30
last_updated: 2026-09-30
---

# Agent 指令英文化与精简（r5）

范围是进入 Agent 上下文的产品指令：9 项发布 Skill 的 30 份 Markdown、Mission 启动正文和
Agent CLI 的两条例子。完整文本已由 Principal 分轮审阅，本文件将同一 r5 纳入当前版本。
审阅基线为 `8991ca69705d1d523d061b3e43d776b3f8a7925f`；实施基线为
`4c7f5b325d854437352265a32f8c4067f5102599`。
合入前的主线变化未改动这 30 份 Skill，三处短文本补丁仍可直接应用。

## 变更前

[完整前后对照](agent-english-comparison.md)逐文件保存 30 份原文、30 份完整替换文本，
以及 3 处 Rust 字符串的逐字前后行；它是本说明的组成部分。原索引和正文为中文，包含重复说明和
过期的 Task version、Mission 状态消息关联与附件不可变性教学。

`SESSION_CHARTER`、动态上下文固定说明和单聊 guidance 已是英文，未改写。

## 变更后

按完整对照应用，生产变更恰为 32 个文件：

- 平台 Skill：`cli-operations`、`memory-stewardship`。
- 工具箱：`campfire`、`grill-duo`、`grill-duo-with-docs`、`member-studio`、`review-duo`。
- 其他发布 Skill：`analyze-agent-codebase`、`worktree`。
- `collaboration.rs` 的系统 Mission 启动正文：`开始使命` → `Start the current Mission.`。
- `bin/rovai.rs` 的 Mission help 示例：`附件` → `attachments`，`目录导航` → `Directory navigation`。

description 只说明调用范围，正文按需读取并合并重复步骤。实际回复、名牌和 Memory 内容继续跟随用户语言。
30 份 Markdown 从 2,105 行／94,992 UTF-8 字节变为 1,070 行／69,252 字节；这不是 token 或行为效果评测。

经 Principal 修订的语义：

| 位置 | 已确认行为 |
| --- | --- |
| Mission | 所有状态的 `sourceMessageId` 可选；可以直接更新状态，需要时关联已有消息 |
| Task | 更新说明只保留 `Submit only the fields you intend to change.`；不教学不存在的版本参数 |
| 附件 | 只保留发送用法、顺序和纯附件发送；不说明可变性、原位编辑或另存版本 |
| Send | 当前参数为 `--to-principal`；无需唤醒成员的公开记录使用 `--public-only` |
| 等待 | 处理完本批其他输入后结束等待，不轮询或重复催促 |
| 输出 | 用户语言与指令语言分开；保留中文长度目标，其他语言保持相近简洁度 |
| 创建队员 | 头像方案变化仍遵循现有完整名牌确认规则 |

工具箱设置共享这些 description／正文，因此其说明原文也显示英文。Mission 新启动公开记录同样显示英文。
界面按钮和其他 UI 文案不在本次范围。

## 明确不变

- 用户输入、队员身份、任务与使命内容、Memory、历史与引用保持原语言；旧记录不改写。
- Bootstrap／Dynamic Context 的 section、JSON 字段、顺序、选择、预算、权限、摘要和冻结证据格式保持。
- Task、Mission、Send 与 Memory 的 Core schema、权限、状态机及幂等合同保持。
- 发布 Skill 集合、名称、路径和队员选择配置保持；`agents/openai.yaml`、NOTICE 和 LICENSE 不变。
- 不新增数据库迁移、会话切换开关、兼容层或后台刷新机制。

### 版本与恢复

| 轴 | 保持值 |
| --- | --- |
| Bootstrap contract／formatter | `native_session_bootstrap_v5`／5 |
| Charter revision／Binding compatibility revision | 16／16 |
| Codex session guidance | 1 |
| 普通 formatter／manifest | 27／27 |
| 公开批次 formatter／manifest | 31／31 |
| Binding 兼容摘要中的冻结 formatter 轴 | v1.68 的 v4／4／16／26／26 |

已有 Native Binding 优先读取既有 Bootstrap Evidence。此次文本更新不触发 Binding 轮换，旧会话仍可 resume；
必要重投也使用其冻结指令。新 Binding 首次生成 Bootstrap 时读取英文平台 Skill description。
既有身份刷新与投递规则不变，不能把所有身份字节也描述为永久冻结。

安装包继续携带 `skills/`，Core 启动和新 Run preparation 使用既有 `ManagedSkills::sync()`，
按源文件字节更新固定目录。旧会话随后实际读取 Skill 文件时能看到新版；已经进入历史的正文保持原样。
新 Run 的工具箱索引重新准备；同一 Run 恢复继续复用冻结索引。不额外发送刷新消息。

实现依据：`context.rs::prepare_session_bootstrap_evidence_for_snapshot`、
`context.rs::prepare_additional_skills`、`managed_skills.rs::sync_directory`、
`core_subsystems.rs` 的启动同步和 `context_contract.rs` 的兼容摘要。

## 二次确认

Principal 已逐轮审阅完整附件及修订，2026-09-30 的 Camp
`rvcamp_01m3pma9wye29a9921jm0r5vd2` 记录如下：

| 输入 | 对本 revision 的决定 |
| --- | --- |
| `701c620f-ad58-4e60-8341-7c8406f20c7b` | Mission 状态更新无需绑定消息；删除附件不可变语义 |
| `c6a3a665-e3f3-4cd6-81bb-49415a6ee125` | 附件编辑方式完全不作说明 |
| `59569717-82fb-4552-ba0f-9bc19aa41eb1` | Task 不需要说明不存在的版本信息 |
| `40ec9002-2d4b-44ae-8791-adf3c430d7e4` | 旧会话 resume／旧 Bootstrap，新会话新 Bootstrap；升级即更新 Skill；保持简单 |
| `7a2cf264-c04e-43db-aab7-9c748fece522` | 实现者公开 r5 的生效策略与完整附件入口，无兼容版本提升 |
| `e5e679a7-5d58-4c0f-9fc9-8cef9d3721ba` | Principal 在 r5 后要求“完成后pr到main merge”，据此实施、创建 PR 并合并 |

确认覆盖 r5 的文本和生效策略，不把实现者的自检当作 Principal 确认，也不把合并授权当作评测通过。

## 验证

### 静态与兼容验证

- 逐文件核对完整对照与实际内容，扫描 30 份发布 Markdown 中的中文指令残留。
- `pnpm skills:check`、`pnpm skills:test`。
- `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=<实施基线> pnpm docs:check:ci`。
- `cargo fmt --all --check`、`cargo check --workspace`。
- 运行现有 Bootstrap 首次生成／复用、resume、兼容摘要和 managed Skill 同步 owner。
  如需覆盖资源升级，只扩展既有 owner；不添加匹配英文措辞的重复 golden。

### 真实任务 Gate

遵循[双轨评测](../../development/evaluation.md)：共享核心 Skill 影响使用 Suite 2.12.0 的 DEMO-101–112，
评分 2.10.0，同环境基线／候选，每例一次；每 campaign 14,400 秒，Case 并行 2，Judge 2,400 秒，最多两次。
Suite SHA-256：`d6af15a57c5209b15287e4c5ed61d995cb1b96632c395b864de685dc78011a4f`；
scoring SHA-256：`2ad3c7d39b32cbccb32a75935645322c8709642a6cd4c15553c5a2f463041ba4`。
硬失败、关键协作、质量退化、资源退化及未知沿用已冻结 POLICY，不能互相抵消。

Memory 专项为 107／108／113，Review 专项为 106／114／115。其余 Skill 没有独立专项集合，
通用集合不证明它们各自全部边界。当前未新增 Case 或变更评分规则。

实际 Runtime／模型、三名队员与固定 snapshot Judge 尚未冻结，真实任务 Gate 尚未运行。
本地已发现的 Judge 使用 CLI 模型别名，不能提供正式 Gate 要求的固定 snapshot；不能将其诊断结果报为通过。
静态、兼容测试与 CI 的结果在实施后记录，不替代真实模型行为证据。

### 2026-09-30 实施记录

- 全部 30 份原文与实施基线逐字一致，全部英文文件与 r5 完整替换文本逐字一致；候选 Markdown 无中文指令残留。
- `pnpm skills:check` 通过（检查全仓 12 项 Skill）；`pnpm skills:test` 3/3、`pnpm docs:test` 10/10 通过。
- `cargo test -p rovai-core --bin rovai` 29/29 通过，包括 Mission 状态消息关联可选和当前 CLI help 合同。
- `pnpm docs:check`、`DOCS_BASE_REF=4c7f5b32 pnpm docs:check:ci`、`cargo fmt --all --check`、
  `cargo check --workspace` 通过。
- 下述定向 Rust 命令先 `--list` 确认进入清单，再运行，8/8 通过。仅使用独立临时文件／SQLite fixture，
  没有启动日常 App 或真实 Runtime，也没有改写已安装 Skill。

```bash
cargo test -p rovai-core --features slow-tests --lib -- \
  managed_skills::tests:: \
  context_contract::tests:: \
  context::slow_tests::newly_bound_session_bootstraps_on_its_current_generation \
  context::slow_tests::first_payload_resume_does_not_reload_identity_but_native_append_fails_closed \
  context::slow_tests::replacement_binding_bootstrap_keeps_history_on_demand_after_the_accepted_watermark \
  mission::tests::mission_commands_keep_definition_atomic_patch_only_and_start_status_independent
```

既有 `synchronization_repairs_owned_files_and_keeps_unknown_content` owner 新增源资源升级输入，
覆盖同路径正文、description 索引和 reference 更新，以及未知文件保留；原有修复输入保持。
这是既有同步 seam 的输入扩展，无新增独立测试。原测试仅覆盖受管文件被改坏，不能发现升级后仍保留旧正文的回归。
Mission owner 的两处期望随已确认启动正文更新；状态、通知与持久化断言保持。
Bootstrap／resume owner 和全部兼容常量未修改。

以上证明文件发布与 Core 兼容路径，不证明英文提示词的模型行为优于原文，也不是实际客户端升级验收。
真实模型 Gate 未运行。2026-09-30，Principal 在 Camp 输入
`8532f5f7-3d78-4dce-a750-3a130ecfcc1f` 中指示本次豁免该项，并在 CI 通过后直接合并。
此决定仅适用于本次 r5；未改动评测规则或提示词方案，也不将未运行的 Gate 记为通过。
实施提交 `c34fa2b091ef475b9621c7c99c863a42962fa03a` 的
[CI / gate](https://github.com/murray17/rovai-ai/actions/runs/36687564910) 已通过。
