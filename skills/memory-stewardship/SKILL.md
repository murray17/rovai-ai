---
name: memory-stewardship
description: 在 Rovai-ai 中维护用户治理的长期记忆。用于当稳定偏好、未来协作约定或可复用经验值得跨越后续 AgentRun 保留；用户明确要求记住或更正某件事；或现有 Memory 需要修订时。先用 rovai memory search 与 rovai memory read 核对当前内容，再用 rovai memory write 写入当前 Companion 或可访问的 Relationship，或用 rovai memory propose-hearth 提交 Hearth 建议。
---

# 共同记忆维护 —— 留下路标，不收集脚印

Rovai-ai 的一次 Camp 会留下很多脚印，长期 Memory 只保留未来旅程仍有价值的路标。本文中的“当前
队员”指当前 AgentProfile，“当前执行”指当前 AgentRun；不要用无修饰的“当前 Agent”混指两者。

## 核心流程

1. 判断候选内容是否跨 Run 仍有价值、有明确依据、会改变未来协作，并能原子表达。
2. 先按权威与安全边界排除不应写入的内容。
3. 选择能完整表达含义的最小 Scope、合法 Kind 与 Relationship direction。
4. 依次执行 search、read、dedupe，再决定不写、add、revise 或 propose。
5. 只做完成目标所需的最少 mutation，检查 receipt 后准确说明结果。

用户明确说“记住这个”代表持久意图，但仍须检查 Scope、合法性、重复和正文质量。Memory 不是草稿区；
不确定时选择不写。

## 按需读取

- 判断当前事实与 Memory 的优先级、Entrypoint 是否可信，或内容是否安全时，读取
  [Authority 与安全](references/authority-and-safety.md)。每次使用 Memory 前都应用其中的权威顺序。
- 选择 Hearth、Companion、Relationship、Kind 或 direction 时，读取
  [Scopes](references/scopes.md)。
- 搜索、读取、处理 cache state、查重、新增、修订、提案或确认 receipt 时，读取
  [读写流程](references/read-write-workflow.md)。任何 mutation 都必须先应用该流程。
- 起草正文或 retrieval keys、检查 byte limits 时，读取
  [正文与检索键](references/content-and-keys.md)。

所有 Agent 调用都使用一个具体的 `rovai memory <action>` operation。先查看该 operation 的精确
`--help`；JSON 只能作为它的 stdin 或 `--input-file` 输入，不能把内部 dotted operation 当作 CLI。
