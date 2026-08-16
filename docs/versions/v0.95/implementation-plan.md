---
document_type: implementation-plan
version: v0.95
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-16
---

# v0.95 实施与验收计划

## 计划状态与使用方式

本计划源自 `CODEX_SKILL_TEST_AND_TRIM_PLAN.md`，原文基于提交
`24b020de1e0524110dbd43450d9eb03530a2b5c4`；当前实施基线为
`44f0b5a8`。原文中的行号和现成代码片段是设计参考，不是可直接执行的补丁。实施者必须先检查当前
`skill.rs`、四个 Skill、有效 ADR、Architecture 和现有测试，再按符号与职责定位修改。

本版本有两个彼此关联的目标：

1. 让 Rust 测试只验证 Core 拥有的 bundled/management 事实；
2. 在行为不漂移的前提下，让每条 Skill 规则只保留一个正文权威位置。

本计划已按当前基线实施完成。附件中的旧行号仅用于定位，最终修改按当前符号、有效 ADR 和实际 bundle
文件集合完成。

## 实施结果

- Core official bootstrap 测试保留原测试函数，通过通用 helper 覆盖 13 个 bundle 的精确文件集合、完整
  bytes、mode、来源、上游元数据和管理策略；删除自然语言与命令次数断言，没有减少 Rust 测试函数。
- 新增通用 `skills:check` 与两项低层 authoring fixture，并纳入 `pnpm test`；13 个仓库 Skill 全部通过。
- Authoring lint adoption 同步修正 `cli-operations`、`member-studio` 的路由描述和 Memory 的界面短描述，
  没有改变这些 Skill 的执行协议。
- Review Duo 根文件从 134 行收敛到 69 行；两份 Grill Duo 分别收敛到 63/69 行；Campfire 根文件和三份
  reference 从 706 行收敛到 368 行。
- [场景 Dry Run](scenario-acceptance.md)覆盖正常、迟到、部分回答、单题失效、换搭档、错误收件人、主持权
  变化、停止和截断分支。没有运行真实 Runtime/model Smoke。
- 自动验证：`pnpm typecheck`；`pnpm test`（21 项文档 fixture、2 项 Skill authoring fixture、
  359 项 Vitest、186 项 Node/benchmark）；`cargo test --workspace`（576 passed、3 manual smoke ignored）；
  Rust fmt、Clippy、Skill validator 和全部文档门禁。

## 不变量

- Review Duo 保持一位 Spec reviewer、一位 Standards reviewer、相同不可变代码范围和四消息正常流程；
- Grill Duo 保持每轮 1–4 个独立问题、固定搭档、部分回答、单题失效复核与当前直接回复；
- Campfire 保持用户请求 Default Lead、第一轮 Gather、最多一次定向回应 Gather、主持权变化和唯一纪要；
- Campfire 新讨论不再由普通成员转交启动；普通成员广播阶段保持静默；
- 所有发送与 Gather 继续服从现有 CLI/Tool 合同，本计划不重新定义 accepted、Delivery 或 recovery；
- Skill 文案和场景规则不能重新迁回 Rust `contains`、正则或命令次数断言。

## Checkpoint 0：治理与替代覆盖

- [x] 按 [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)审计删除的断言，记录其旧职责和新承接层；
- [x] 从 CURRENT 和 Built-in Tool Runtime 复核 Review Duo、Grill Duo、Campfire 的有效长期边界；
- [x] 确认 Campfire 转交入口删除不需要 successor ADR；若有效 ADR 明确拥有该行为，先停止并完成 ADR 流程；
- [x] 列出将由 Skill validator、authoring lint、场景验收和 Core/Tool 测试分别承接的规则；
- [x] 确认没有通过改写措辞或另一种文本匹配继续冻结自然语言；
- [x] 实施前重新记录当前 base，并把所有旧行号解析到当前符号。

## Checkpoint 1：Core bundled 测试去文案化

### 1.1 通用 helper

在 `crates/rovai-core/src/skill.rs` 的测试模块中增加两个通用 helper：

```text
collect_relative_files(root) -> BTreeSet<String>
assert_bundled_skill_materialized(service, skill, definition)
```

`collect_relative_files` 递归遍历 materialized Revision，只接受普通文件，并把路径规范化为 `/` 分隔的
相对路径集合。`assert_bundled_skill_materialized` 必须验证：

- Skill name 与 `BundledDefinition.name` 一致；
- Revision `file_count` 等于 `definition.files.len()`；
- management policy 与 definition 一致；
- upstream repository/revision 的存在性和值与 definition 完全一致；
- materialized 相对文件集合与 `definition.files` 精确相等；
- 每个文件的完整文本 bytes 与编译期 bundled source 一致；
- 每个文件的 permission mode 与 definition 一致。

优先复用测试模块已有的 `BTreeSet`、`PermissionsExt`、`Value`、`SkillView` 与
`BundledDefinition`，不为 helper 增加生产依赖。

### 1.2 统一覆盖 official inventory

- [x] 在 official Skill 顺序、management policy 和 Group assignment 断言之后遍历 `BUNDLED_SKILLS`；
- [x] 为每个 definition 找到同名 Skill，并调用 `assert_bundled_skill_materialized`；
- [x] 用统一循环替代逐 Skill 的 file count、required file、upstream metadata 和文件正文断言；
- [x] 保留 official Skill 顺序、数量、默认启用和 Runtime Group assignment 的结构化断言。

### 1.3 删除自然语言接口

从 `official_skills_apply_management_policy_and_preserve_user_managed_changes` 删除以下类型的断言：

- `analyze-agent-codebase`、Campfire、CLI Operations、两份 Grill Duo、Review Duo、Tasteful UI、
  pinned upstream Skills 和 Memory Stewardship 的自然语言 `contains(...)`；
- 固定标题、description fragment、default prompt、中文规则和旧协议词搜索；
- `rovai send` 或其它文案出现恰好 N 次；
- 只为证明 reference 存在而逐项调用 `is_file()` 的重复代码。

不要把它们替换为英文、正则、snapshot 文本或另一组硬编码字符串。

### 1.4 保留 Core 权威测试

- [x] `diagnosing-bugs` 的 `script_file_count` 与 `executable_file_count`；
- [x] bundled 内容破坏后的 repair、event log 和 Revision/version 变化；
- [x] user-managed Skill 的 enablement 与 Group 修改在 bootstrap 后保留；
- [x] system-required Skill 的 enablement、assignment 和修改限制；
- [x] risk summary 和其它由 Core 计算的结构化结果；
- [x] import、promotion、collision、projection 和完整性门禁的既有测试。

Repair 完成后必须把 `SKILL.md` 的完整内容与对应编译期常量比较；不能只搜索
`name: memory-stewardship` 等片段。

## Checkpoint 2：测试职责重新分层

### 2.1 Skill validator

- [x] 验证 frontmatter、Skill 名称、目录结构、`agents/openai.yaml` 和相对链接；
- [x] 对四个本次修改的 Skill 分别运行 validator；
- [x] 文件集合真值继续由 `BundledDefinition.files` 与通用 Core helper 覆盖。

### 2.2 Authoring lint

- [x] 让 description 路由规则、禁止命令/内部事件等 authoring 约束进入非 Rust 文案 lint；
- [x] lint 报告具体文件和规则类别，不要求固定完整句子；
- [x] 不为单个 Skill 名称、版本或特定中文句子增加 checker 例外。

### 2.3 场景验收

在删除相应 Rust 文案断言前，为角色和消息推进建立可读的 dry-run 或 Runtime fixture：

- [x] Review Duo：用户启动、独立 Spec、可信搭档直接结果、范围不一致、换搭档、迟到结果和最终报告；
- [x] Grill Duo：邀请者、搭档、部分回答、单题变化、旧轮建议和最终确认；
- [x] Grill Duo with Docs：同上，并验证只有用户确认内容进入文档维护；
- [x] Campfire：用户请求 Default Lead、普通成员广播静默、第一轮 completion、可选第二轮、Lead 变化、用户停止和唯一纪要；
- [x] 无效 sender、非直接回复和意外 recipient 不推进流程。

场景验收必须观察角色选择、消息拓扑或实际 Tool fixture，不能只搜索 Skill Markdown。

### 2.4 Core/Tool 行为测试

继续由现有领域测试验证实际 recipients、Core-managed reply relation、accepted、Delivery、Gather Barrier
和 completion 行为。Skill 测试不得复制这些合同，也不得用自然语言代替它们。

## Checkpoint 3：Review Duo 去重

目标文件：`skills/review-duo/SKILL.md`、`references/findings.md`；保持 bundle 仍为五个文件。

- [x] 根文件“结果规模”只说明每轴使用一条有界完整结果、无法保留证据时标记 `partial`，并指向 `findings.md`；
- [x] 最多 8 条、每字段 1–2 句、约 2,000–2,500 个中文字符和详细 partial 规则只保留在 `findings.md`；
- [x] 把消息边界压缩为请求/返回/公开三类方式、实际收件人核对和发送成功后才能继续三条规则；
- [x] 正文中的非寻址 `@` 仍要求代码块或转义；
- [x] 四消息章节只描述各步骤差异，不重复 finding 数量、accepted、recipient 和完成说明；
- [x] 请求发送成功后，Lead 在同一响应中独立完成 Spec，不先等待搭档；
- [x] 结果独立性只在根文件保留内容/ID/严重度/顺序、跨轴不合并、固定展示顺序和无单一总分；
- [x] 最终报告引用原 finding 的详细格式规则只由 `findings.md` 拥有；
- [x] 保留角色与关联、固定输入、两轴职责、Spec 先锁定、搭档更换、迟到结果、当前会话完成边界和四消息拓扑。

## Checkpoint 4：两份 Grill Duo 去重

### 4.1 `skills/grill-duo/SKILL.md`

- [x] 基本流程只说用户回答后继续当前开放轮次，全部关闭后再形成下一轮；
- [x] 部分回答、原编号、内容变化和单题复核细节只由“开放轮次”拥有；
- [x] 更新问题后只采用固定搭档对更新邀请的直接回复，旧建议规则只在角色关联中出现一次；
- [x] “消息方式”只保留三种命令、可信 Agent ID、发送成功后结束当前响应和 CLI recovery 指针；
- [x] 删除这里对 accepted、Delivery、轮询和迟到规则的重复合同解释；
- [x] “本轮内容”只拥有请求字段、搭档输出要求和向用户呈现的内容，不重复角色/部分回答规则；
- [x] “完成”不重复旧轮不能重开的规则。

### 4.2 `skills/grill-duo-with-docs/SKILL.md`

- [x] 使用与普通版相同的开放轮次和短消息方式；
- [x] 基本流程合并用户回答、只维护确认内容和当前轮关闭后的下一轮准入；
- [x] “本轮内容”不重复当前 AgentRun、失效题或迟到建议规则；
- [x] 根文件“维护文档”只保留“只维护用户明确确认内容”和三个 reference 指针；
- [x] 领域词汇、ADR、仓库规则和校验方式分别由 `domain-modeling.md`、`context-format.md`、
  `adr-format.md` 拥有；
- [x] 固定搭档继续只给建议，不修改文档。

两份 Skill 均保持以下结构：角色与关联、基本流程、固定搭档、开放轮次、消息方式、本轮内容、完成；
文档版额外保留 reference 导航与维护文档。

## Checkpoint 5：Campfire 去重与启动收窄

### 5.1 `skills/campfire/SKILL.md`

- [x] 删除 Default Lead 转交请求、普通成员转交和其它 legacy transfer 启动分支；
- [x] 只有用户直接请求当前 Default Lead 可以开始新讨论；普通成员观点或控制消息不能启动；
- [x] 使用边界只保留多人讨论/比较/建议，以及单人任务、持续双人追问、严格盲评和人数不足的排除项；
- [x] 普通成员广播阶段的固定静默输出只由 `references/member.md` 拥有；
- [x] 公共规则收敛为：Default Lead 单场、第一轮 2–3 人、仅关键分歧一次回应、每轮一条完整结果、纪要后结束；
- [x] 删除与公共规则和 Lead 指南重复的用户介入章节；
- [x] 根文件仍按角色指向 Lead、Member 和 Notes references。

### 5.2 `skills/campfire/references/lead.md`

- [x] 删除目录、启动条件和完整章节中的转交请求；
- [x] 建立唯一“Gather 方式”：每轮一次共享请求，调用成功后立即结束，不轮询、不发普通邀请或等待状态；
- [x] 第一轮和第二轮只引用 Gather 方式，不重复 accepted/等待说明；
- [x] 建立唯一“成员回复要求”：200–250 个中文字符、最多 300 个，包含核心判断、两项依据、一项限制、改变判断条件和置信度，无进度消息；
- [x] 第一轮与第二轮模板只引用成员回复要求；第二轮额外要求说明维持、修正或条件化；
- [x] Gather Completion 的 mandatory Current Input 判断只在读取 Completion 章节拥有；
- [x] 第二轮结果只读取本轮 Completion 并形成最终纪要，不重复第一轮 completion 合同；
- [x] 用户介入收敛为停止、替换话题、移除成员和立即总结；立即总结只使用已形成观点并标记未完成成员。

### 5.3 `skills/campfire/references/member.md`

- [x] 删除转交职责、目录项和完整窄范围转交章节；
- [x] 用户广播、`@所有队员` 或同时触达 Default Lead 时不提前发表观点、不调用 A2A、不组织讨论；
- [x] 运行环境必须有最终文本时只输出“等待 Default Lead 发起讨论。”；
- [x] 发送方式只保留一次 `rovai send --to <请求发送者 Agent ID> --body <完整结果>`，不展开 help；
- [x] 回复限制只出现一次：一条完整结果、200–250 字、最多 300 字、所需五类内容、不重复背景或发送进度；
- [x] 发送异常只指向 CLI recovery，最终输出保留同一份完整观点；
- [x] 参与者边界收敛为只完成当前请求，不组织、转发、总结或开启下一轮，发送后结束 Run。

### 5.4 `skills/campfire/references/notes.md`

- [x] 删除短文件中无必要的目录；
- [x] 发布规则只说明 public-only `rovai send`、发送成功后结束、不再邀请或自动处理迟到观点；
- [x] 不重复 `--to`、`--to-user` 和 accepted 的完整通用语义。

## Checkpoint 6：验收与交付

### Core 与 Rust

- [x] `skill.rs` 不再针对上述 Skill 执行自然语言逐字 `contains(...)`；
- [x] 不再断言 `rovai send` 或其它自然语言片段出现次数；
- [x] generic bundled helper 覆盖全部 official Skill 的文件集合、bytes、mode、来源和管理策略；
- [x] repair 比较完整 bundled source；
- [x] 运行 official Skill 定向测试、`cargo test --workspace`、`cargo fmt --all -- --check` 和
  `cargo clippy --workspace --all-targets -- -D warnings`。

### Skill 与场景

- [x] `review-duo` 仍精确包含五个 bundled 文件；
- [x] 两份 Grill Duo 的三种消息方式各只定义一个正文权威位置，但自动测试不通过出现次数判定；
- [x] Campfire 不再包含转交请求，第一轮、可选第二轮、主持权变化和唯一纪要仍可执行；
- [x] 四个 Skill 的相对链接、frontmatter 和 `agents/openai.yaml` 通过 validator/authoring lint；
- [x] 场景 dry-run 或 Runtime fixture 覆盖正常、迟到、部分、失效、换人、停止和错误 sender 分支。

### 文档治理

- [x] 实施后按事实更新本概览的九范围结论；
- [x] 若 Built-in Tool Runtime 仍描述已删除的 Campfire 转交入口，同步更新 Architecture；
- [x] 只有出现新的长期高成本取舍时才新增 ADR；
- [x] 运行 `pnpm docs:test`、`pnpm docs:check`、`pnpm docs:adr:generate -- --check`、带真实 base 的
  `pnpm docs:check:ci` 与 `git diff --check`；
- [x] 记录实际测试数字、未运行 smoke 和剩余风险后，再把本版本标为 complete。
