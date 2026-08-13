---
document_type: adr
id: ADR-0166
title: Progressive Built-In CLI Teaching
status: accepted
date: 2026-08-12
decision_scope: cross-version
source_version: v0.65
supersedes: []
superseded_by: null
---

# ADR-0166: Progressive Built-In CLI Teaching

## Context

Session Charter 当前同时承担命令清单、输出义务和部分操作指导，容易随字段增加而膨胀；反过来，若
把所有 CLI 决策放进一个宽触发 Skill，普通 send/read/search 也会加载长工作流。CLI 真实 parser 只有
root help、`rovai send --help` 和完整 group+action help；教学中使用 `rovai task --help` 之类不存在的
family entry 会让 Agent 在需要恢复时先遇到第二个错误。

现有 `memory-stewardship` 已拥有完整 Memory authority、安全、cache state、revision 和限制规则。用一份
精简 CLI 文档整体替换它会丢失治理语义。CLI 教学因此需要按稳定全局边界、具体 operation 参数和少数
跨 operation 决策分层，同时保留业务领域 Skill 的既有权威。

## Decision

1. Built-in CLI 教学分为三层：Session Charter 只给稳定全局边界；每个 operation 的精确 `--help`
   拥有 flags/closed input/短例子；`cli-operations` Skill 只拥有命令族选择、message→Task、
   多 operation 协调和复杂 recovery。
2. 统一入口文案是：先运行 `rovai --help` 选择 operation，再运行该 operation 的精确 `--help`；不得
   假设 command family 自己有 help entry。有效例子必须写成 `rovai task create --help`、
   `rovai camp read --help` 等完整路径。
3. `cli-operations` 使用窄 description。普通单一 send、`--to`、`--to-user`、list、get、search 或 read
   不触发该 Skill；只有命令族歧义、普通消息是否升级 Task、同一业务事件协调多个 Rovai operation，
   或 `refresh` / `confirm_outcome` 等复杂业务恢复才触发。
4. `cli-operations/SKILL.md` 只保留触发后的选择与路由，直接链接 `send`、`task`、`camp-history`、
   `memory`、`recovery` 五份一层 reference。规则只保留一个权威落点，不复制完整 operation schema，
   不使用聊天 URL、绝对路径、嵌套 fence 或 family-level help。
5. `confirm_outcome` 有权威 CampMessage locator 时可 exact read；没有 locator 时不得正文猜测、近似
   搜索或盲目重发，必须报告结果不确定并停止该 mutation。
6. `memory-stewardship` 保持现有语义权威，只允许按 references 无损搬移与 Agent-facing CLI 命名整理。
   current authority、Entrypoint cache、read-before-use、状态处理、安全、scope/revision/body/key limits 和
   mutation 顺序都必须由 semantic tests 保留。

`cli-operations` 的 official identity、打包集合与投递策略由 ADR-0167 独立拥有；教学分层不因此获得
required prompt injection、特殊 Capability 或第二套 Skill delivery authority。

本决策细化 ADR-0124 的 CLI-only discovery 与 ADR-0135 的 compact Agent output；不改变其 transport、
projection、用户 Assignment 或 Runtime-native discovery 权威。

## Consequences

- 普通调用用最短上下文得到准确 flag，复杂协调才支付 Skill discovery 与 reference 阅读成本；
- Charter 可以稳定跨字段演进，operation help 与 parser/catalog 保持同一真源；
- `memory-stewardship` 拆分需要 semantic golden checklist，不能以更短字数作为成功标准；
- references、help path、front matter trigger 和 no-locator recovery 都成为自动化验收内容；
- Skill 是否属于 official inventory、默认分配到哪些 Runtime Groups，不再与教学职责混成同一决定。

## Rejected Alternatives

- **把全部 CLI schema 放入 Charter。** 每次字段变更都扩大所有 Session Bootstrap，并复制 catalog 真源。
- **让 `cli-operations` 在任何 Rovai 命令上触发。** 普通单操作会加载无关决策树，违背 progressive
  discovery 并增加模型误选 Task/Memory 的机会。
- **使用 family-level help。** 当前 CLI 没有这些入口，教学不能依赖不存在的命令。
- **整体重写 `memory-stewardship`。** 精简摘要无法无损覆盖 authority、cache invalidation、security、
  revision 与 byte/key 限制。
- **把 CLI 决策树强制注入每个 Session。** 会重新制造 Charter 膨胀，并把按需教学误当作权限或
  Runtime 已读取的事实。
- **无 locator 时 search/guess send outcome。** 相同正文不是 invocation identity，近似命中既不能证明
  成功也不能证明失败，重发会产生重复 mutation。

## References

- [v0.65 版本目标](../versions/v0.65/README.md)
- [v0.65 实现规格](../versions/v0.65/implementation-spec.md)
- [ADR-0124: CLI-Only Transport](0124-cli-only-transport-for-rovai-built-in-operations.md)
- [ADR-0135: Compact Agent Output](0135-compact-agent-output-over-canonical-built-in-tool-envelope.md)
- [ADR-0167: Seven-Skill Official Inventory](0167-seven-skill-official-inventory.md)
- [Built-in Tool Transport v8](../contracts/builtin-tool-transport-v8.md)
- [Built-in Tool Transport v7 (historical)](../contracts/builtin-tool-transport-v7.md)
- [Built-in Tool Runtime architecture](../architecture/builtin-tool-runtime.md)
